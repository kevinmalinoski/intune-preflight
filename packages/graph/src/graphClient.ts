/**
 * The Microsoft Graph HTTP client: retries, backoff, timeouts, paging and
 * per-load telemetry.
 *
 * It takes its access token as an injected `getToken` callback rather than
 * acquiring one itself. That is the whole reason this package exists outside
 * `apps/server`: the server supplies an app-only (client-credential) token from
 * MSAL-node, while a browser build supplies a delegated one from the signed-in
 * user -- and the fetching, retry and fallback behaviour is identical either
 * way. Everything here runs on `fetch` and `AbortController`, both of which are
 * native in Node 20+ and in the browser, so nothing in this file is tied to a
 * server runtime.
 */

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA = "https://graph.microsoft.com/beta";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Attempts per request (1 initial + retries) and the ceiling on backoff between
// them. Five attempts with exponential backoff spans ~30s of retrying, which
// clears the transient Graph blips (throttling, gateway timeouts) that were
// silently dropping policies before.
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 16_000;

// Per-request timeout. Graph's deviceManagement backend can be slow, but a
// request still open past this is almost always a wedged connection, not real
// work. Without it, Node's undici lets a stuck socket hang for minutes and,
// under the bounded-concurrency workers, that collapses the whole load's
// throughput -- the "went from seconds to minutes" symptom. Abort and retry.
const REQUEST_TIMEOUT_MS = 45_000;

// How many per-item Graph detail calls run in flight at once. High enough to
// make a 150+ policy tenant load in seconds instead of minutes, low enough to
// stay clear of Intune's service throttling (graphFetch also retries 429s).
const DEFAULT_CONCURRENCY = 8;

// Transient HTTP statuses worth retrying: throttling (429) and server/gateway
// failures (500, 502, 503, 504). Everything else (esp. 400/401/403/404) is a
// permanent error -- a bad request, a missing permission, or a deleted item --
// and must NOT be retried, so the beta-fallback and per-item skip paths still
// react immediately.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/**
 * A Graph failure that must NOT be retried or reported as a network problem --
 * a 4xx, or a retryable status that has exhausted its attempts. It exists so
 * the body-reading `await` can live inside the same try block as the fetch (so
 * the timeout covers it) without the catch mistaking a real HTTP error for a
 * transient socket failure, and so callers can branch on the STATUS rather than
 * pattern-matching an error message.
 */
export class GraphHttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GraphHttpError";
  }
}

/**
 * Did this request fail with one of the given HTTP statuses? Lets a caller react
 * to a specific Graph response (e.g. the v1.0 "Resource not found for the
 * segment" 400 that the beta fallback exists for) without treating an unrelated
 * failure -- a 403 for a missing permission, or no connectivity at all -- as the
 * same thing.
 */
export function isGraphStatus(err: unknown, ...statuses: number[]): boolean {
  return err instanceof GraphHttpError && statuses.includes(err.status);
}

/** Whether an HTTP status is a transient failure worth retrying (vs a permanent 4xx). */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

/** Network-level failures (no HTTP response) that are worth retrying. */
export function isRetryableNetworkError(err: unknown): boolean {
  if (err instanceof Error && err.name === "AbortError") return true; // our timeout fired
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /fetch failed|terminated|network|socket|econnreset|etimedout|econnrefused|enetunreach|enotfound|eai_again|und_err/.test(
    msg
  );
}

const backoffMs = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS) + Math.random() * 250;

// Lightweight per-load telemetry so a slow load can be diagnosed as "throttled"
// vs "just a lot of calls" without guessing. Reset at the start of each load and
// summarized in the load log.
export interface GraphStats {
  requests: number; // total HTTP attempts made
  retries: number; // attempts that were retried
  throttled: number; // 429 responses seen
  serverErrors: number; // 5xx responses seen
  timeouts: number; // our per-request timeout fired
}

const emptyStats = (): GraphStats => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 });

/**
 * Run an async mapper over items with bounded parallelism. Graph detail calls
 * (per-policy assignments/settings) were previously awaited one at a time --
 * fine for a lab, but a 150+ policy tenant meant 150+ sequential round-trips
 * and a first load measured in minutes. Eight in flight keeps well inside
 * Intune's service limits while cutting load time roughly 8x.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface GraphClientOptions {
  /**
   * Supplies a bearer token for `https://graph.microsoft.com`. Called before
   * every attempt (including retries), so the implementation is responsible for
   * caching it and for refreshing one that has expired mid-load.
   */
  getToken: () => Promise<string>;
  /** Per-request timeout before the attempt is aborted and retried. */
  timeoutMs?: number;
  /** Attempts per request, counting the first one. */
  maxAttempts?: number;
  /** Default parallelism for `mapWithConcurrency` callers. */
  concurrency?: number;
}

export interface GraphClient {
  /** Fetches a single (non-collection) Graph resource or GET-style function result. */
  graphGetObject<T>(path: string, useBeta?: boolean): Promise<T>;
  /** Fetches every page of a Graph collection endpoint, following @odata.nextLink. */
  graphGetCollection<T>(path: string, useBeta?: boolean): Promise<T[]>;
  mapWithConcurrency: typeof mapWithConcurrency;
  /** How many per-item detail calls this client's callers should run at once. */
  concurrency: number;
  resetGraphStats(): void;
  getGraphStats(): GraphStats;
}

/**
 * Builds a Graph client over an injected token source. The telemetry counters
 * belong to the returned client rather than to this module, so two clients (a
 * server process serving two tenants, or a browser session signed in twice)
 * can't corrupt each other's load stats.
 */
export function createGraphClient({
  getToken,
  timeoutMs = REQUEST_TIMEOUT_MS,
  maxAttempts = MAX_ATTEMPTS,
  concurrency = DEFAULT_CONCURRENCY,
}: GraphClientOptions): GraphClient {
  let stats: GraphStats = emptyStats();

  async function graphFetch(url: string, init?: { method?: string; body?: string }): Promise<unknown> {
    // Retries the transient failures that plague large-tenant loads -- 429
    // throttling, 502/503/504 gateway timeouts, and dropped connections -- with a
    // per-request timeout so a wedged socket can't stall the whole load. Only
    // transient failures retry; a 4xx surfaces immediately. Honors Retry-After.
    for (let attempt = 1; ; attempt++) {
      const token = await getToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      let parsed: unknown;
      stats.requests++;
      try {
        res = await fetch(url, {
          method: init?.method ?? "GET",
          body: init?.body,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
        });

        // Count the outcome before any branch can throw, so the LAST attempt of a
        // losing request still shows up in the load telemetry.
        if (res.status === 429) stats.throttled++;
        else if (res.status >= 500) stats.serverErrors++;

        // Read the body INSIDE the try, while the abort signal is still armed.
        // `fetch` resolves as soon as the headers arrive, so a response whose body
        // then stalls mid-stream would otherwise hang forever -- past the timeout
        // that exists precisely to stop a wedged socket from pinning one of the
        // bounded-concurrency workers and collapsing the whole load's throughput.
        if (res.ok) {
          parsed = res.status === 204 ? undefined : await res.json();
        } else if (!isRetryableStatus(res.status) || attempt >= maxAttempts) {
          // Terminal failure: read the body for the error message.
          const body = await res.text().catch(() => "");
          throw new GraphHttpError(
            `Graph request failed (${res.status} ${res.statusText}) for ${url}: ${body}`,
            res.status
          );
        }
      } catch (err) {
        if (err instanceof GraphHttpError) throw err;
        if (err instanceof Error && err.name === "AbortError") stats.timeouts++;
        if (isRetryableNetworkError(err) && attempt < maxAttempts) {
          stats.retries++;
          await sleep(backoffMs(attempt));
          continue;
        }
        const reason =
          err instanceof Error && err.name === "AbortError" ? `timed out after ${timeoutMs}ms` : String(err);
        throw new Error(`Graph request to ${url} failed after ${attempt} attempt(s): ${reason}`);
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) return parsed;

      // Only retryable statuses with attempts left reach here -- the terminal case
      // threw above, and the status was already counted.
      stats.retries++;
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      await sleep(waitMs);
    }
  }

  return {
    async graphGetObject<T>(path: string, useBeta = false): Promise<T> {
      const base = useBeta ? GRAPH_BETA : GRAPH_BASE;
      return (await graphFetch(`${base}${path}`)) as T;
    },

    async graphGetCollection<T>(path: string, useBeta = false): Promise<T[]> {
      const base = useBeta ? GRAPH_BETA : GRAPH_BASE;
      let url: string | undefined = path.startsWith("http") ? path : `${base}${path}`;
      const items: T[] = [];

      while (url) {
        // `graphFetch` returns undefined for a 204, so read the page defensively --
        // an empty collection is an empty result, not a TypeError from a blind
        // dereference several frames away from the request that caused it.
        const page = (await graphFetch(url)) as { value?: T[]; "@odata.nextLink"?: string } | undefined;
        items.push(...(page?.value ?? []));
        url = page?.["@odata.nextLink"];
      }

      return items;
    },

    mapWithConcurrency,
    concurrency,

    resetGraphStats(): void {
      stats = emptyStats();
    },

    getGraphStats(): GraphStats {
      return { ...stats };
    },
  };
}
