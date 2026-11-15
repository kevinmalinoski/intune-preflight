import { useContext, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PortalDemoContext } from "./portalDemo.ts";

const ICON = (
  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
    <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
  </svg>
);

const DEMO_NOTE = "With your own tenant connected, this opens it in the admin center.";

/**
 * "Open in Intune": a small mark beside a policy, app or group that opens its
 * page in the admin center in a new tab.
 *
 * It is a plain link. An earlier version asked twice, with a card between the
 * mark and the link, because these sit in rows whose main click already does
 * something. The mark is a small, separate target and never fires the row, so
 * the second step protected against a slip that does not happen in practice.
 *
 * Without a URL it renders nothing: that is every object the loader has no
 * confident address for. The sample tenant is the exception. Its ids are made
 * up, so there the mark is shown inactive, and says on hover what it would do.
 */
export function PortalLink({
  url,
  name,
  compact = false,
  className = "",
}: {
  url?: string;
  name: string;
  /** A smaller mark, for rows whose height the diagram has already measured. */
  compact?: boolean;
  className?: string;
}) {
  const demo = useContext(PortalDemoContext);
  const size = compact ? "h-4 w-4" : "h-5 w-5";
  // `nodrag nopan`: inside the diagram a press here must not start a drag.
  const shape = `nodrag nopan inline-flex ${size} shrink-0 items-center justify-center rounded transition-colors`;

  if (!url) return demo ? <DemoMark shape={shape} className={className} /> : null;

  const portal = url.startsWith("https://entra.microsoft.com/") ? "Entra" : "Intune";
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      aria-label={`Open ${name} in ${portal} (new tab)`}
      title={`Open in ${portal} ↗`}
      className={`${shape} text-slate-500 hover:bg-ink-700 hover:text-sky-300 focus-visible:text-sky-300 ${className}`}
      // The row underneath has a click of its own; the link's own navigation
      // is the default action and is left alone.
      onClick={(e) => e.stopPropagation()}
    >
      {ICON}
    </a>
  );
}

/**
 * The mark in the sample tenant: there, and going nowhere. A note appears on
 * hover, on keyboard focus, or on a tap, since a phone has no hover.
 */
function DemoMark({ shape, className }: { shape: string; className: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const mark = useRef<HTMLButtonElement>(null);

  // Placed from the mark and portalled out: these sit inside scrolling lists
  // and a zoomed diagram, either of which would clip a note in the flow.
  useLayoutEffect(() => {
    if (!open || !mark.current) return;
    const r = mark.current.getBoundingClientRect();
    const width = 208;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8));
    const below = r.bottom + 6;
    setPos({ top: below + 48 > window.innerHeight ? r.top - 48 : below, left });
  }, [open]);

  return (
    <>
      <button
        ref={mark}
        type="button"
        aria-disabled="true"
        // Short, because a screen reader meets one of these on every row.
        aria-label="Open in Intune, unavailable in the sample tenant"
        className={`${shape} cursor-default text-slate-600 hover:text-slate-400 focus-visible:text-slate-400 ${className}`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          // Inactive, but still not the row's click.
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
      >
        {ICON}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: pos.top, left: pos.left, width: 208 }}
            className="pointer-events-none fixed z-[90] rounded-md border border-ink-700 bg-ink-900 px-2 py-1.5 text-center text-[11px] leading-snug text-slate-300 shadow-xl"
          >
            {DEMO_NOTE}
          </div>,
          document.body
        )}
    </>
  );
}
