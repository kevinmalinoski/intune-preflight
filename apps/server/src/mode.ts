import { config } from "./config.js";

export type TenantMode = "demo" | "connected";

// The active data source. Defaults to the real tenant when credentials are
// present, otherwise demo. It's a single mutable value because this is a
// single-user, self-hosted tool; the UI flips it at runtime via POST /api/mode.
let currentMode: TenantMode = config.hasCredentials ? "connected" : "demo";

export const getMode = (): TenantMode => currentMode;

export function setMode(mode: TenantMode): void {
  if (mode === "connected" && !config.hasCredentials) {
    throw new Error("No tenant configured — add TENANT_ID / CLIENT_ID / CLIENT_SECRET to .env to connect.");
  }
  currentMode = mode;
}
