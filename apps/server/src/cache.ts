// Simple in-memory TTL cache. No external store -- keeps the app dependency-free.
// Swap this for Redis/SQLite later (see README) if multi-instance or persistence is needed.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, Entry<unknown>>();
  // In-flight fetches, keyed the same as `store`. Lets concurrent callers share
  // a single fetch instead of each kicking off their own -- the web UI fires
  // groups + filters + simulate together on load, so a cold cache would
  // otherwise trigger three full tenant loads at once.
  private inFlight = new Map<string, Promise<unknown>>();

  constructor(private ttlSeconds: number) {}

  async getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = (async () => {
      try {
        const value = await fetcher();
        this.store.set(key, { value, expiresAt: Date.now() + this.ttlSeconds * 1000 });
        return value;
      } finally {
        // Clear the in-flight entry whether the fetch succeeded or failed, so a
        // failure isn't cached and the next request retries cleanly.
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise as Promise<T>;
  }

  clear() {
    // Only drop cached values; any in-flight fetch self-clears on completion.
    this.store.clear();
  }
}
