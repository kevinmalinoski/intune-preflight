/**
 * A one-value store for "what is the live session doing right now", so the
 * header can say something during a tenant load that takes ~12 seconds on a
 * medium tenant and projects to ~35 on a large one. Silence for that long reads
 * as a hung page.
 *
 * It is a module-level store rather than React state because the thing that
 * knows the progress (`liveApi`) is not a component and is reached through the
 * `api` surface, which is deliberately identical across all three builds. A
 * two-line pub/sub keeps that surface alone and costs nothing in the builds
 * where nobody subscribes.
 */

export type LivePhase = "idle" | "signing-in" | "loading" | "ready" | "failed";

export interface LoadProgress {
  phase: LivePhase;
  /** Graph HTTP attempts made so far by the load in flight. */
  requests: number;
  /** Set when `phase` is `"failed"`. */
  error?: string;
}

let current: LoadProgress = { phase: "idle", requests: 0 };
const listeners = new Set<() => void>();

export function getLoadProgress(): LoadProgress {
  return current;
}

export function setLoadProgress(next: LoadProgress): void {
  current = next;
  for (const listener of listeners) listener();
}

/** Subscribes to changes; returns the unsubscribe, as `useSyncExternalStore` wants. */
export function subscribeLoadProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
