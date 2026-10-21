/**
 * localStorage that cannot take the page down.
 *
 * Every `localStorage` access throws -- not just writes -- when a browser is
 * set to block site data (Safari's "Block all cookies", Chrome's blocked-site-
 * data setting, some enterprise policies), and a write can throw on quota at
 * any time. These values are all small conveniences (a panel width, which
 * columns are hidden), so failing to read or save one should be invisible;
 * before this, an unguarded `setItem` inside a render effect would propagate
 * and blank the page.
 */

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Parse a stored JSON value, falling back when it's absent, blocked, or corrupt. */
export function readStoredJson<T>(key: string, fallback: T): T {
  const raw = readStored(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked or out of quota -- the preference just won't persist.
  }
}

export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Same as above: nothing to do if site data is blocked.
  }
}

/**
 * The same guards over `sessionStorage`, for the values whose lifetime is the
 * TAB rather than the browser profile. The live (delegated-auth) build keeps its
 * sign-in state here on purpose, alongside MSAL's own token cache: closing the
 * tab ends the session and leaves nothing behind.
 */

export function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Blocked or out of quota -- the value just won't survive a reload.
  }
}

export function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
