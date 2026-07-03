import { ConfidentialClientApplication } from "@azure/msal-node";
import { config } from "./config.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const GRAPH_BETA = "https://graph.microsoft.com/beta";
const SCOPE = "https://graph.microsoft.com/.default";

const msalApp = new ConfidentialClientApplication({
  auth: {
    clientId: config.clientId,
    authority: `https://login.microsoftonline.com/${config.tenantId}`,
    clientSecret: config.clientSecret,
  },
});

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const result = await msalApp.acquireTokenByClientCredential({ scopes: [SCOPE] });
  if (!result?.accessToken) {
    throw new Error("Failed to acquire Graph access token. Check TENANT_ID/CLIENT_ID/CLIENT_SECRET and app permissions.");
  }
  cachedToken = {
    token: result.accessToken,
    expiresAt: result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3000 * 1000,
  };
  return cachedToken.token;
}

async function graphFetch(url: string): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph request failed (${res.status} ${res.statusText}) for ${url}: ${body}`);
  }
  return res.json();
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
