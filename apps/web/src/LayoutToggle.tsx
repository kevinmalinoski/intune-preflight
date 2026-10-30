import { useSyncExternalStore } from "react";
import { isDesktopOverride, isNarrow, setDesktopOverride, subscribeLayout } from "./viewport.ts";

/**
 * The compact/desktop layout switch, as one toolbar button.
 *
 * This was a full-width banner: an icon, "Compact layout for this window
 * size.", the switch, and a dismiss button, on a row of its own under the
 * header. The sentence was the expensive part -- it announced something the
 * admin could already see (the layout they are looking at) and charged a row
 * for it on the screens with the fewest rows to spare.
 *
 * What it carried that mattered is the switch itself, which is the only way
 * back from the 1280px desktop layout once it is on. As a button that is one
 * glyph, it needs no dismissing: there is nothing to get out of the way.
 *
 * Only on a narrow window, because that is the only place the choice exists.
 */
export function LayoutToggle() {
  const narrow = useSyncExternalStore(subscribeLayout, isNarrow, () => false);
  const desktop = useSyncExternalStore(subscribeLayout, isDesktopOverride, () => false);

  if (!narrow) return null;

  return (
    <button
      onClick={() => setDesktopOverride(!desktop)}
      aria-pressed={desktop}
      aria-label={desktop ? "Use the compact layout" : "Use the desktop layout"}
      title={
        desktop
          ? "Desktop layout: the full console at its own width, pinch to zoom and pan. Tap to fold it back down to this window."
          : "Compact layout, folded to fit this window. Tap to show the full desktop console at its own width instead."
      }
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm transition-colors ${
        desktop
          ? "border-sky-400/50 bg-sky-500/15 text-sky-200"
          : "border-ink-700 text-slate-400 hover:bg-ink-800 hover:text-slate-200"
      }`}
    >
      <span aria-hidden>{desktop ? "🖥️" : "📱"}</span>
    </button>
  );
}
