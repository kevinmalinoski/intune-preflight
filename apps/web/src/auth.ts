/**
 * Delegated (user sign-in) auth for the live build: a thin wrapper over
 * `@azure/msal-browser` that hands `packages/graph` a `getToken`.
 *
 * The app registration this talks to is a PUBLIC client -- there is no client
 * secret anywhere, in the bundle or otherwise, because PKCE replaces it. That is
 * what makes a backend-free build possible at all; everything else here is
 * plumbing around it.
 *
 * All the decisions worth arguing about -- the redirect URI, the cache location,
 * the scopes -- live in `authConfig.ts`, which has no MSAL runtime and is
 * unit-tested. This file only supplies the browser values and sequences the
 * calls.
 */

import {
  type AccountInfo,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type SilentRequest,
} from "@azure/msal-browser";
import { buildMsalConfig, GRAPH_SCOPES, REDIRECT_HANDLING, resolveRedirectUri } from "./authConfig.ts";
import type { LiveConfig } from "./liveConfig.ts";

const SCOPES = [...GRAPH_SCOPES];

/**
 * The redirect URI this build sends to Entra, and the string that has to appear
 * verbatim under "Single-page application" in the app registration. Computed on
 * demand rather than at module scope: the setup and error UI both show it (it is
 * the one thing worth reading when a sign-in comes back `AADSTS50011`), and a
 * module-scope call to it would be a side effect the other two builds have to
 * tree-shake around.
 */
export function liveRedirectUri(): string {
  return resolveRedirectUri({
    configured: import.meta.env.VITE_REDIRECT_URI,
    origin: window.location.origin,
    basePath: import.meta.env.BASE_URL,
  });
}

let app: PublicClientApplication | null = null;
let account: AccountInfo | null = null;

/**
 * Creates the MSAL app and, if this page load is the tail of a sign-in redirect,
 * consumes the response. Safe to call more than once: the second call returns
 * the account the first one found rather than rebuilding MSAL, because
 * `handleRedirectPromise` has a response exactly once.
 *
 * Returns the signed-in account, or null if nobody is signed in yet.
 */
export async function initAuth(config: LiveConfig): Promise<AccountInfo | null> {
  if (app) return account;

  const instance = new PublicClientApplication(
    buildMsalConfig({ tenantId: config.tenantId, clientId: config.clientId, redirectUri: liveRedirectUri() })
  );
  await instance.initialize();
  app = instance;

  // Must run on every load before anything else touches MSAL -- it is what turns
  // the code in the URL into a cached token. It resolves null on an ordinary
  // load, which is the common case.
  const result = await instance.handleRedirectPromise(REDIRECT_HANDLING);
  account = result?.account ?? instance.getAllAccounts()[0] ?? null;
  if (account) instance.setActiveAccount(account);
  return account;
}

export function currentAccount(): AccountInfo | null {
  return account;
}

/**
 * Starts an interactive sign-in. Redirect rather than popup: a popup is the
 * first thing a managed browser blocks, and the redirect flow also survives
 * third-party-cookie blocking, which the popup flow has come to depend on.
 *
 * This navigates the page away, so it does not return in the normal case --
 * callers should treat it as the end of their work.
 */
export async function signIn(): Promise<void> {
  const instance = requireApp();
  // Note the absence of `prompt: "select_account"`. The spike used it to test
  // several accounts in one browser; in use it forces every admin through an
  // account picker they did not ask for, including the ones with exactly one
  // account.
  await instance.loginRedirect({ scopes: SCOPES, redirectUri: liveRedirectUri() });
}

// Token cache, mirroring the server's shape in apps/server/src/tenantData.ts.
// `getToken` is called before EVERY Graph attempt -- 143 of them on a medium
// tenant, more with retries -- so this exists to keep that from being 143 trips
// through MSAL. The 30s skew means a token is replaced before it expires rather
// than after a 401 has already come back, and `inFlight` keeps the eight
// concurrent Graph workers sharing one acquisition instead of racing.
let cachedToken: { token: string; expiresAt: number } | null = null;
let inFlight: Promise<string> | null = null;

export async function acquireGraphToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const instance = requireApp();
      if (!account) throw new Error("Not signed in. Choose Connected to sign in to your tenant.");
      const request: SilentRequest = { scopes: SCOPES, account };
      const result = await instance.acquireTokenSilent(request);
      cachedToken = {
        token: result.accessToken,
        expiresAt: result.expiresOn ? result.expiresOn.getTime() : Date.now() + 3000 * 1000,
      };
      return cachedToken.token;
    } catch (err) {
      if (err instanceof InteractionRequiredAuthError) {
        // The refresh token is gone or consent was revoked. There is no quiet
        // recovery in a SPA: hand the page back to Entra. This can land
        // mid-load, in which case the load dies with the navigation and reruns
        // once we come back -- which is still better than a half-read tenant.
        await requireApp().acquireTokenRedirect({ scopes: SCOPES, redirectUri: liveRedirectUri() });
        // Unreachable in practice; the line above navigates away.
        throw err;
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Ends the tool's session: drops MSAL's cached tokens and forgets the account.
 *
 * Deliberately `clearCache` rather than `logoutRedirect`. Signing the admin out
 * at Entra would also sign them out of the Intune portal and everything else in
 * that browser, which is far more than "I am finished looking at this". Closing
 * the tab has the same effect as this does, since the cache is `sessionStorage`;
 * the button exists so the admin does not have to take that on trust.
 */
export async function endSession(): Promise<void> {
  const instance = app;
  cachedToken = null;
  account = null;
  if (instance) await instance.clearCache();
}

function requireApp(): PublicClientApplication {
  if (!app) throw new Error("Auth is not initialized -- initAuth() must run first.");
  return app;
}
