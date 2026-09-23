/**
 * Add `id` to a Set, or remove it if already there, as a `useState` updater:
 *
 *   setExpanded(toggled(id));
 *
 * The UI keeps a lot of "which of these are open / checked / hidden" state in
 * Sets, and every one of them had its own copy-then-mutate-then-return closure.
 * One implementation, eight call sites.
 */
export const toggled =
  <T>(id: T) =>
  (prev: Set<T>): Set<T> => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };
