import { ConfidentialClientApplication } from "@azure/msal-node";
import { config } from "./config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA = "https://graph.microsoft.com/beta";
const SCOPE = "https://graph.microsoft.com/.default";

// Built lazily so the server can start (in demo mode) without credentials --
// constructing MSAL with empty clientId/authority would throw at import time.
let msalApp: ConfidentialClientApplication | null = null;
function getMsalApp(): ConfidentialClientApplication {
  if (!config.hasCredentials) {
    throw new Error(
      "No tenant configured. Set TENANT_ID / CLIENT_ID / CLIENT_SECRET in .env to connect to Intune, or use demo mode."
    );
  }
  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: config.clientId,
        authority: `https://login.microsoftonline.com/${config.tenantId}`,
        clientSecret: config.clientSecret,
      },
    });
  }
  return msalApp;
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const result = await getMsalApp().acquireTokenByClientCredential({ scopes: [SCOPE] });
  if (!result?.accessToken) {
    throw new Error("Failed to acquire Graph access token. Check TENANT_ID/CLIENT_ID/CLIENT_SECRET and app permissions.");
  }
  cachedToken = {
    token: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3000 * 1000,
  };
  return cachedToken.token;
}

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

// Transient HTTP statuses worth retrying: throttling (429) and server/gateway
// failures (500, 502, 503, 504). Everything else (esp. 400/401/403/404) is a
// permanent error -- a bad request, a missing permission, or a deleted item --
// and must NOT be retried, so the beta-fallback and per-item skip paths still
// react immediately.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

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
let stats: GraphStats = { requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 };
export function resetGraphStats(): void {
  stats = { requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 };
}
export function getGraphStats(): GraphStats {
  return { ...stats };
}

async function graphFetch(url: string, init?: { method?: string; body?: string }): Promise<unknown> {
  // Retries the transient failures that plague large-tenant loads -- 429
  // throttling, 502/503/504 gateway timeouts, and dropped connections -- with a
  // per-request timeout so a wedged socket can't stall the whole load. Only
  // transient failures retry; a 4xx surfaces immediately. Honors Retry-After.
  for (let attempt = 1; ; attempt++) {
    const token = await getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
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
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") stats.timeouts++;
      if (isRetryableNetworkError(err) && attempt < MAX_ATTEMPTS) {
        stats.retries++;
        await sleep(backoffMs(attempt));
        continue;
      }
      const reason = err instanceof Error && err.name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS}ms` : String(err);
      throw new Error(`Graph request to ${url} failed after ${attempt} attempt(s): ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) return res.status === 204 ? undefined : res.json();

    if (res.status === 429) stats.throttled++;
    else if (res.status >= 500) stats.serverErrors++;

    if (isRetryableStatus(res.status) && attempt < MAX_ATTEMPTS) {
      stats.retries++;
      const retryAfter = Number(res.headers.get("Retry-After"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs(attempt);
      await sleep(waitMs);
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(`Graph request failed (${res.status} ${res.statusText}) for ${url}: ${body}`);
  }
}

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

/** Fetches a single (non-collection) Graph resource or GET-style function result. */
export async function graphGetObject<T>(path: string, useBeta = false): Promise<T> {
  const base = useBeta ? GRAPH_BETA : GRAPH_BASE;
  return (await graphFetch(`${base}${path}`)) as T;
}


/** Fetches every page of a Graph collection endpoint, following @odata.nextLink. */
export async function graphGetCollection<T>(path: string, useBeta = false): Promise<T[]> {
  const base = useBeta ? GRAPH_BETA : GRAPH_BASE;
  let url: string | undefined = path.startsWith("http") ? path : `${base}${path}`;
  const items: T[] = [];

  while (url) {
    const page = (await graphFetch(url)) as { value?: T[]; "@odata.nextLink"?: string };
    items.push(...(page.value ?? []));
    url = page["@odata.nextLink"];
  }

  return items;
}
