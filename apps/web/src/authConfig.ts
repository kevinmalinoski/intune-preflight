/**
 * The delegated-auth configuration, kept free of MSAL's runtime and of `window`
 * so it can be unit-tested. `auth.ts` is the thin wrapper that feeds it the real
 * browser values; everything decided here is decided from explicit arguments.
 *
 * The redirect URI is the reason this file exists. Entra matches a redirect URI
 * against the app registration by EXACT STRING -- `/app/` and `/app` are two
 * different registrations, as are `http` and `https` -- and a mismatch surfaces
 * as `AADSTS50011`, an error page on Microsoft's domain with nothing in the
 * browser console to debug from. So the value is built by one function with one
 * documented rule, and that rule has tests.
 */

import type { Configuration } from "@azure/msal-browser";

/**
 * Delegated Graph scopes for a read-only tenant inspection. All five require
 * admin consent; the first four are what a full load actually reads, and the
 * tool stays read-only by never asking for a write scope (see CONTRIBUTING).
 */
export const GRAPH_SCOPES = [
  "DeviceManagementConfiguration.Read.All",
  "DeviceManagementServiceConfig.Read.All",
  "DeviceManagementScripts.Read.All",
  "Group.Read.All",
] as const;

export interface RedirectUriInputs {
  /** `VITE_REDIRECT_URI`, when the deploy sets one. */
  configured?: string;
  /** `window.location.origin` -- scheme + host + port, never a trailing slash. */
  origin: string;
  /** Vite's `BASE_URL`: the path the bundle was built for, e.g. `/preflight-spike/app/`. */
  basePath?: string;
}

/**
 * The redirect URI this build will send to Entra.
 *
 * A configured value is used VERBATIM (bar surrounding whitespace). That is the
 * point of the override: it is literally the string pasted into the app
 * registration, so normalizing it would defeat the one case where the derived
 * value is wrong.
 *
 * Otherwise it is `origin + basePath`, normalized to end in a slash. Vite
 * already guarantees `BASE_URL` starts and ends with `/` for a directory base,
 * but the normalization is explicit because the two ways it can not be are both
 * real: a relative base (`--base=./`) sets `BASE_URL` to `./`, which would
 * concatenate into the nonsense `https://host./`, and a hand-written
 * `--base=/app` would produce `https://host/app` -- a different string from the
 * `https://host/app/` the page is actually served at. Both collapse to the
 * directory form, which is what you register.
 */
export function resolveRedirectUri({ configured, origin, basePath }: RedirectUriInputs): string {
  const explicit = configured?.trim();
  if (explicit) return explicit;

  // A base that isn't an absolute path (`./`, `` , `assets/`) tells us nothing
  // about where the app is mounted, so fall back to the origin root.
  const path = basePath?.startsWith("/") ? basePath : "/";
  return `${origin.replace(/\/+$/, "")}${path.endsWith("/") ? path : `${path}/`}`;
}

export interface MsalConfigInputs {
  tenantId: string;
  clientId: string;
  redirectUri: string;
}

export function buildMsalConfig({ tenantId, clientId, redirectUri }: MsalConfigInputs): Configuration {
  return {
    auth: {
      clientId,
      // Single-tenant authority: the admin signs in to the tenant they are
      // inspecting, and a token for the wrong tenant is a confusing failure
      // rather than a useful one.
      authority: `https://login.microsoftonline.com/${tenantId}`,
      redirectUri,
    },
    cache: {
      // Deliberate: the session dies with the tab. That is the property being
      // sold -- an admin opens a URL, inspects their tenant, closes the tab and
      // nothing of theirs is left behind. localStorage would survive the close
      // and turn a borrowed browser into a lasting foothold.
      cacheLocation: "sessionStorage",
    },
  };
}

/**
 * Options for `handleRedirectPromise`, where msal-browser v5 moved
 * `navigateToLoginRequestUrl` (it was a `cache` config option through v4).
 *
 * Off, because the redirect URI IS the app's own URL: by the time MSAL has
 * handled the response we are already where we want to be. Left on (the
 * default) it costs a second full navigation back to the URL the sign-in
 * started from -- another page load, another MSAL init, and a second ~12s
 * tenant load if one had already begun.
 */
export const REDIRECT_HANDLING = { navigateToLoginRequestUrl: false } as const;
