import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load the repo-root .env regardless of which directory the process was started from.
// `quiet: true` suppresses dotenv v17's promotional startup banner (harmless
// console tips, e.g. the "auth for agents [www.vestauth.com]" line) so it
// doesn't clutter logs or look alarming.
loadDotenv({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env"), quiet: true });

// Browsers only hit the API cross-origin in the split dev setup (web :5173 ->
// api :4000); in production the web app is served same-origin behind a proxy,
// so CORS isn't exercised there. Default to the local dev origins and allow an
// explicit override for anyone serving the web UI from a different host.
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const tenantId = process.env.TENANT_ID ?? "";
const clientId = process.env.CLIENT_ID ?? "";
const clientSecret = process.env.CLIENT_SECRET ?? "";

export const config = {
  tenantId,
  clientId,
  clientSecret,
  // When all three are present the app can connect to a real tenant; otherwise
  // it runs in demo mode against bundled sample data (no app registration
  // needed). Missing creds is no longer fatal -- the server still starts.
  hasCredentials: Boolean(tenantId && clientId && clientSecret),
  port: Number(process.env.PORT ?? 4000),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 300),
  corsOrigins,
};
