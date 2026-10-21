/**
 * The live build's session: the one place that knows about the tenant/client
 * config, MSAL, and the fact that a page load might be the tail of a sign-in
 * redirect. `api.ts` wires `liveApi` to these functions; the header chrome reads
 * them to say who is signed in.
 *
 * It exists so `liveApi.ts` can stay free of the MSAL runtime (see its header)
 * and so `App.tsx` never has to sequence an init step -- everything that needs
 * auth awaits `ensureReady()`, which is idempotent.
 */

import { acquireGraphToken, currentAccount, endSession, initAuth, signIn } from "./auth.ts";
import { forgetLiveMode, rememberConnectedMode } from "./liveApi.ts";
import { type LiveConfig, readLiveConfig, resolveLiveConfig, saveLiveConfig } from "./liveConfig.ts";

// Resolved once per page load: `resolveLiveConfig` persists whatever the query
// string supplied, and re-running it on every caller would mean re-writing
// localStorage over and over for no reason.
let config: LiveConfig | null | undefined;

export function getLiveConfig(): LiveConfig | null {
  if (config === undefined) config = resolveLiveConfig(window.location.search);
  return config;
}

export function isConfigured(): boolean {
  return getLiveConfig() !== null;
}

let readying: Promise<void> | null = null;

export function ensureReady(): Promise<void> {
  if (!readying) {
    readying = (async () => {
      const cfg = getLiveConfig();
      // Nothing configured yet: there is no authority to build MSAL against,
      // and Demo mode needs none. Staying silent here is what makes an
      // unconfigured live build behave exactly like the public demo.
      if (!cfg) return;
      await initAuth(cfg);
    })();
  }
  return readying;
}

/**
 * Adopts a config from the first-run form and goes straight to sign-in, rather
 * than saving it and making the admin click Connected as a second step.
 *
 * Both memos are reset because they were populated by an UNCONFIGURED load:
 * `ensureReady` resolved without building MSAL, and there is no authority for it
 * to have used. Clearing them is what lets the new tenant take effect without a
 * page reload.
 */
export async function configureAndSignIn(next: LiveConfig): Promise<void> {
  saveLiveConfig(next);
  config = next;
  readying = null;
  // `signIn` navigates to Entra, so the mode has to be remembered first.
  rememberConnectedMode();
  await ensureSignedIn();
}

export async function ensureSignedIn(): Promise<void> {
  const cfg = getLiveConfig();
  if (!cfg) {
    throw new Error("No tenant configured. Add a tenant ID and client ID to sign in.");
  }
  await ensureReady();
  if (currentAccount()) return;
  // Navigates to Entra; this does not return on the success path.
  await signIn();
}

export function isSignedIn(): boolean {
  return currentAccount() !== null;
}

export async function getToken(): Promise<string> {
  await ensureReady();
  return acquireGraphToken();
}

export interface LiveSessionIdentity {
  /** UPN of the signed-in admin. */
  username: string;
  /** Display name, when the token carried one. */
  name?: string;
  /** The tenant the token is for, as Entra reported it. */
  tenantId: string;
}

export function signedInIdentity(): LiveSessionIdentity | null {
  const account = currentAccount();
  if (!account) return null;
  return {
    username: account.username,
    name: account.name,
    // Prefer the tenant the TOKEN is for over the one we asked for: if an admin
    // configured a domain name, this is the GUID it resolved to, and if the two
    // ever disagree the token is the truth.
    tenantId: account.tenantId || (getLiveConfig()?.tenantId ?? ""),
  };
}

/**
 * Ends the session: drops the tokens, forgets the remembered mode, and reloads
 * so the in-memory tenant data goes with the page. A reload is the only way to
 * be sure 15MB of someone's tenant is actually gone from the tab rather than
 * still reachable from a closure somewhere.
 *
 * The tenant/client config is deliberately KEPT -- it is not sensitive, and the
 * admin would otherwise have to retype it to sign in again.
 */
export async function endLiveSession(): Promise<void> {
  forgetLiveMode();
  await endSession();
  window.location.reload();
}

/** The config as stored, ignoring the query string -- for the setup form's initial values. */
export { readLiveConfig };
