// Simple in-memory TTL cache. No external store -- keeps the app dependency-free.
// Swap this for Redis/SQLite later (see README) if multi-instance or persistence is needed.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  constructor(private ttlSeconds: number) {}

  async getOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.value as T;
    }
    const value = await fetcher();
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlSeconds * 1000 });
    return value;
  }

  clear() {
    this.store.clear();
  }
}
