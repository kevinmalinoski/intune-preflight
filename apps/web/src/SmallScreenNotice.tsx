import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Intune Preflight is a dense admin console -- the simulation diagram, seating
// charts and merged-baseline tables are laid out for a desktop-sized display and
// don't reflow usefully onto a phone. Rather than show a broken layout, greet
// small screens with an honest notice and a way through if they insist.
//
// Rendered through a portal to <body> (and with body scroll locked while shown)
// so it fills the viewport rather than centering against the app's wide layout.
const REPO_URL = "https://github.com/kevinmalinoski/intune-preflight";
const DISMISS_KEY = "ip-smallscreen-dismissed";

export function SmallScreenNotice() {
  const [small, setSmall] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setSmall(mq.matches);
    update();
    mq.addEventListener("change", update);
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // sessionStorage can throw in private modes -- default to showing the notice.
    }
    return () => mq.removeEventListener("change", update);
  }, []);

  const shown = small && !dismissed;

  // Lock the page behind the notice so its (wide) horizontal scroll can't leak.
  useEffect(() => {
    if (!shown) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [shown]);

  if (!shown) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore -- worst case the notice reappears next load
    }
    setDismissed(true);
  };

  return createPortal(
    <div
      style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", zIndex: 100 }}
      className="flex flex-col items-center justify-center gap-5 overflow-hidden bg-ink-950 px-8 text-center"
    >
      <div className="text-5xl" aria-hidden>
        🖥️
      </div>
      <h1 className="text-xl font-semibold text-slate-100">Built for a bigger screen</h1>
      <p className="max-w-[300px] text-sm leading-relaxed text-slate-400">
        Intune Preflight is a dense admin console. The simulation diagram, group seating charts and merged-baseline tables
        are designed for a <span className="text-slate-200">desktop-sized display</span> — open it on a laptop or desktop for
        the full experience.
      </p>
      <div className="flex w-full max-w-[240px] flex-col items-stretch gap-2.5">
        <button
          onClick={dismiss}
          className="rounded-md border border-ink-700 bg-ink-800 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-ink-700"
        >
          Continue anyway
        </button>
        <a
          href={REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="rounded-md px-4 py-2 text-sm font-medium text-emerald-300 transition-colors hover:text-emerald-200"
        >
          View on GitHub ↗
        </a>
      </div>
    </div>,
    document.body
  );
}
