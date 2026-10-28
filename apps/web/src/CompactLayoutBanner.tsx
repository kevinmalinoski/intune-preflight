import { useState, useSyncExternalStore } from "react";
import { readSession, writeSession } from "./storage.ts";
import { isDesktopOverride, isNarrow, setDesktopOverride, subscribeLayout } from "./viewport.ts";

// What a narrow window gets instead of the full-screen "Built for a bigger
// screen" wall this replaces.
//
// The wall was honest about the problem and useless about it: it covered the
// app at <768px, which caught phones and left every iPad (744-834pt in
// portrait) looking at a desktop layout it was never told about. Now the layout
// itself folds down, and this is a one-line note saying so with the way out.
//
// It stays put while the desktop layout is forced, and loses its dismiss
// button there: that button is the only way back to the compact layout, so
// dismissing it would strand an admin on a 1280px-wide page on a phone.
const DISMISS_KEY = "ip-compact-banner-dismissed";

export function CompactLayoutBanner() {
  const narrow = useSyncExternalStore(subscribeLayout, isNarrow, () => false);
  const desktop = useSyncExternalStore(subscribeLayout, isDesktopOverride, () => false);
  const [dismissed, setDismissed] = useState(() => readSession(DISMISS_KEY) === "1");

  if (!narrow) return null;
  if (dismissed && !desktop) return null;

  const dismiss = () => {
    writeSession(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-3 py-1.5 text-[11px] leading-snug text-sky-200">
      <span aria-hidden>{desktop ? "🖥️" : "📱"}</span>
      <span className="min-w-0 flex-1">
        {desktop ? (
          <>
            <span className="font-medium">Desktop layout</span> — pinch to zoom and pan.
          </>
        ) : (
          <>
            <span className="font-medium">Compact layout</span> for this window size.
          </>
        )}
      </span>
      <button
        onClick={() => setDesktopOverride(!desktop)}
        title={
          desktop
            ? "Fold the layout back down to fit this window."
            : "Show the full desktop console at its own width and pan around it."
        }
        className="shrink-0 rounded-md border border-sky-400/30 px-2.5 py-1 text-[11px] font-medium text-sky-200 transition-colors hover:bg-sky-500/15"
      >
        {desktop ? "Use compact layout" : "Use desktop layout"}
      </button>
      {!desktop && (
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          title="Hide this for the rest of the session"
          className="shrink-0 rounded px-1.5 py-1 text-sky-300/70 transition-colors hover:bg-sky-500/15 hover:text-sky-200"
        >
          ✕
        </button>
      )}
    </div>
  );
}
