/**
 * Where the live build gets the two values it needs before it can sign anyone
 * in: the tenant ID and the app registration's client ID.
 *
 * Neither is a secret -- a public client has no secret to keep, which is the
 * whole reason this build can exist -- so they persist in `localStorage` and are
 * accepted from the query string. The query-string route is for consultants with
 * many tenants: one bookmark per client, each self-configuring the page.
 *
 * Which is also why both values are VALIDATED. A `?tenant=` arrives from
 * whatever link someone was sent, and it is interpolated into the authority URL
 * (`https://login.microsoftonline.com/{tenantId}`); anything carrying a slash,
 * a colon, an `@` or whitespace could try to walk out of that path segment. MSAL
 * checks the authority's HOST for us, but the path segment is ours to keep
 * clean, so only the two shapes Entra actually issues are accepted.
 */

import { readStored, removeStored, writeStored } from "./storage.ts";

export interface LiveConfig {
  tenantId: string;
  clientId: string;
}

const TENANT_KEY = "preflight.live.tenantId";
const CLIENT_KEY = "preflight.live.clientId";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A verified domain: dot-separated labels of letters, digits and dashes. Covers
// `contoso.onmicrosoft.com` and vanity domains. The required dot is what keeps
// the multi-tenant aliases (`common`, `organizations`) out -- this build is
// single-tenant by design, and an authority of `common` would sign someone in
// to a tenant other than the one on screen.
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** A tenant ID is a GUID or a verified domain name. */
export function isValidTenantId(value: string): boolean {
  return GUID.test(value) || DOMAIN.test(value);
}

/** A client ID is always a GUID -- Entra issues nothing else as an app ID. */
export function isValidClientId(value: string): boolean {
  return GUID.test(value);
}

/**
 * Reads `?tenant=…&client=…` from a query string. Each value is independent:
 * a link may carry only the tenant (the client ID being the same app
 * registration for every tenant a consultant manages), and an invalid value is
 * dropped rather than replacing a good stored one.
 */
export function parseLiveConfigQuery(search: string): Partial<LiveConfig> {
  const params = new URLSearchParams(search);
  const out: Partial<LiveConfig> = {};
  const tenant = params.get("tenant")?.trim();
  const client = params.get("client")?.trim();
  if (tenant && isValidTenantId(tenant)) out.tenantId = tenant;
  if (client && isValidClientId(client)) out.clientId = client;
  return out;
}

/** The persisted config, or null if either half is missing or no longer valid. */
export function readLiveConfig(): LiveConfig | null {
  const tenantId = readStored(TENANT_KEY) ?? "";
  const clientId = readStored(CLIENT_KEY) ?? "";
  if (!isValidTenantId(tenantId) || !isValidClientId(clientId)) return null;
  return { tenantId, clientId };
}

export function saveLiveConfig({ tenantId, clientId }: LiveConfig): void {
  writeStored(TENANT_KEY, tenantId);
  writeStored(CLIENT_KEY, clientId);
}

export function clearLiveConfig(): void {
  removeStored(TENANT_KEY);
  removeStored(CLIENT_KEY);
}

/**
 * The config this page should use: query parameters over anything stored, and
 * what the query supplied is persisted so a later visit without the parameters
 * still works.
 *
 * The parameters are deliberately left in the address bar. They are the
 * bookmark -- stripping them would quietly break the URL the user came here to
 * save, or to forward to a colleague -- and neither value is sensitive.
 */
export function resolveLiveConfig(search: string): LiveConfig | null {
  const stored = readLiveConfig();
  const fromQuery = parseLiveConfigQuery(search);
  const merged: Partial<LiveConfig> = { ...stored, ...fromQuery };
  if (!merged.tenantId || !merged.clientId) return null;
  const config: LiveConfig = { tenantId: merged.tenantId, clientId: merged.clientId };
  // Only write when the query actually changed something, so a blocked-storage
  // browser isn't asked to write on every load.
  if (fromQuery.tenantId || fromQuery.clientId) saveLiveConfig(config);
  return config;
}
