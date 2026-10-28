/**
 * Which layout the app is rendering: the dense desktop console, or the compact
 * one a narrow window gets.
 *
 * Two things decide it. The window's width is the obvious one -- below
 * COMPACT_MAX_WIDTH the endpoint picker's three columns have nowhere to go and
 * overlap each other. The other is an explicit override, because "narrow" is
 * not the same question as "wants the simplified layout": an admin on a tablet
 * may well prefer the full console and a pinch-zoom over a layout that folds
 * things away, and saying so should stick across reloads.
 *
 * A module-level store rather than React state threaded through five
 * components, for the same reason `loadProgress` is one: the window's width is
 * a property of the window, not of any component, and one matchMedia listener
 * shared through `useSyncExternalStore` beats five of them drifting apart.
 */

import { readStored, writeStored } from "./storage.ts";

/**
 * The widest window that still gets the compact layout. One below Tailwind's
 * `lg`, so every `lg:` prefix in the components is the same boundary as this
 * number -- change one and you must change the other.
 */
export const COMPACT_MAX_WIDTH = 1023;

const QUERY = `(max-width: ${COMPACT_MAX_WIDTH}px)`;
const OVERRIDE_KEY = "layoutDesktopOverride";

const listeners = new Set<() => void>();

function safeMatchMedia(): MediaQueryList | null {
  try {
    return window.matchMedia(QUERY);
  } catch {
    // No matchMedia at all: fall back to the desktop layout, which is the only
    // one anything that old ever had.
    return null;
  }
}

/**
 * Kept in a module variable rather than created inline where it is listened to.
 * A MediaQueryList nothing holds a reference to can be collected along with its
 * listener, and the symptom is the layout working once and then never changing
 * again -- intermittently, on whichever page lived long enough for a GC.
 */
const mediaQuery = safeMatchMedia();

let narrow = mediaQuery?.matches ?? false;
let override = readStored(OVERRIDE_KEY) === "1";

function notify(): void {
  applyDocumentLayout();
  for (const listener of listeners) listener();
}

/**
 * Mirrors the override onto <html>, where a stylesheet can widen the page so a
 * narrow viewport pans and zooms over the desktop console instead of squeezing
 * it. A document-level effect of a document-level setting, so it does not live
 * in a component that might not be mounted.
 */
function applyDocumentLayout(): void {
  try {
    document.documentElement.classList.toggle("desktop-layout", narrow && override);
  } catch {
    // No document (a test importing this transitively) -- nothing to mirror.
  }
}

mediaQuery?.addEventListener("change", (e) => {
  narrow = e.matches;
  notify();
});

applyDocumentLayout();

/** True when the window is narrow AND the admin has not asked for the desktop layout. */
export function isCompact(): boolean {
  return narrow && !override;
}

/** True when the window is narrow, whichever layout is being shown in it. */
export function isNarrow(): boolean {
  return narrow;
}

export function isDesktopOverride(): boolean {
  return override;
}

export function setDesktopOverride(on: boolean): void {
  override = on;
  writeStored(OVERRIDE_KEY, on ? "1" : "0");
  notify();
}

/** Subscribes to changes; returns the unsubscribe, as `useSyncExternalStore` wants. */
export function subscribeLayout(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
