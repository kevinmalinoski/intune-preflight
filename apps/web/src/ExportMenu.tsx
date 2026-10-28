import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The "Export ▾" control: one button in the toolbar, opening a menu of the
 * formats that export is offered in.
 *
 * It replaced a button per format. Three of them (Excel, CSV, JSON) is clutter
 * in a toolbar that also holds a filter, a view selector and a column picker,
 * and below `lg` that toolbar already wraps onto a second line -- so the third
 * format would have cost a row of vertical space on a phone to say something
 * the admin reads once.
 *
 * Deliberately the same popover as the baseline panel's column picker rather
 * than a new pattern: a plain absolutely-positioned panel, a fixed backdrop
 * underneath it that closes on click, and Escape to dismiss. `open` is held by
 * the host because the host may need to know -- the baseline panel's own Escape
 * handler has to leave an open menu alone instead of closing the whole panel.
 */
/** How close the open menu may come to the edge of the window, in pixels. */
const GUTTER = 8;

export interface ExportFormatOption<F extends string> {
  format: F;
  label: string;
  /** The one line under the label, saying when to pick this format. */
  hint: string;
}

export function ExportMenu<F extends string>({
  options,
  onExport,
  open,
  onOpenChange,
  className,
}: {
  options: ExportFormatOption<F>[];
  /** Called with the chosen format, straight from the click -- see below. */
  onExport: (format: F) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger's own styling, so each toolbar keeps the button it had. */
  className?: string;
}) {
  /**
   * How far the open menu has to slide to stay on screen.
   *
   * It hangs off the trigger's right edge, which is right for the baseline
   * panel's toolbar, where the trigger sits at the right. In the manifest's
   * toolbar at phone width the same trigger wraps onto its own line at the LEFT
   * edge, and a 14rem panel anchored to its right runs off the side of the
   * screen -- the first two menu items were cut in half at 375px. There is no
   * CSS that knows which edge it is near, so it is measured: one read after the
   * menu mounts, and a nudge if either side is outside the viewport.
   */
  const menuRef = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }
    const rect = menuRef.current?.getBoundingClientRect();
    if (!rect) return;
    const past = (edge: number) => (edge > 0 ? edge : 0);
    setShift(past(GUTTER - rect.left) - past(rect.right - (window.innerWidth - GUTTER)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  return (
    <div className="relative">
      <button onClick={() => onOpenChange(!open)} aria-haspopup="menu" aria-expanded={open} className={className}>
        Export ▾
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-30" onClick={() => onOpenChange(false)} />
          <div
            ref={menuRef}
            role="menu"
            style={shift === 0 ? undefined : { transform: `translateX(${shift}px)` }}
            className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-ink-700 bg-ink-900 p-1 shadow-2xl"
          >
            {options.map((option) => (
              <button
                key={option.format}
                role="menuitem"
                // The export is built inside this click with nothing awaited
                // first: iOS only treats a download as user-initiated within
                // the click's own task, which is why the API's export helpers
                // are synchronous. Closing the menu afterwards keeps that true.
                onClick={() => {
                  onExport(option.format);
                  onOpenChange(false);
                }}
                // py-3 below lg, like the pickers: a menu item on a phone is a
                // touch target before it is a line of text.
                className="block w-full rounded px-2 py-3 text-left hover:bg-ink-800 lg:py-1.5"
              >
                <span className="block text-xs text-slate-200">{option.label}</span>
                <span className="block text-[10px] leading-snug text-slate-500">{option.hint}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
