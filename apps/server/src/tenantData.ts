import { ConfidentialClientApplication } from "@azure/msal-node";
import { createGraphClient, loadTenantData as loadFromGraph, TtlCache } from "@intune-preflight/graph";
import type { TenantData } from "@intune-preflight/engine";
import { config } from "./config.js";
import { getMode } from "./mode.js";

/**
 * Wires the portable Graph layer (`packages/graph`) to this server's
 * environment: an app-only MSAL token, the configured cache TTL, and the
 * runtime Demo/Connected mode.
 *
 * Everything server-specific about reading a tenant lives here, which is what
 * keeps the package itself free of `process.env`, MSAL-node and `./mode.js` --
 * the same fetching code can run in a browser against a delegated token. The
 * routes see the same three functions they always did.
 */

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
    throw new Error(
      "Failed to acquire Graph access token. Check TENANT_ID/CLIENT_ID/CLIENT_SECRET and app permissions."
    );
  }
  cachedToken = {
    token: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3000 * 1000,
  };
  return cachedToken.token;
}

const client = createGraphClient({ getToken: getAccessToken });
const cache = new TtlCache(config.cacheTtlSeconds);

// Warnings from the most recent CONNECTED load. Kept here rather than in the
// package because it exists for the /api/health surface: a non-empty list means
// the last baseline was incomplete. Demo loads never touch it, so a glance at
// the demo tenant doesn't erase the record of a bad connected load.
let lastLoadWarnings: string[] = [];
// When the connected data being served was read. Read off the data itself on
// every load, so a cache hit leaves it alone and the TTL's silent re-read
// moves it forward -- it always describes what the API is answering from.
let lastLoadedAt: string | undefined;

export async function loadTenantData(): Promise<TenantData> {
  const mode = getMode();
  const data = await loadFromGraph({ client, mode, cache });
  if (mode === "connected") {
    lastLoadWarnings = data.warnings ?? [];
    lastLoadedAt = data.loadedAt;
  }
  return data;
}

/** Warnings from the most recent connected tenant load, for the /api/health surface. */
export function getLastLoadWarnings(): string[] {
  return lastLoadWarnings;
}

/** When the most recent connected tenant load finished, for the /api/health surface. */
export function getLastLoadedAt(): string | undefined {
  return lastLoadedAt;
}

export function clearTenantDataCache() {
  cache.clear();
}
