/**
 * The live build's own chrome: the first-run form that collects a tenant and
 * client ID, and the banner that says who is signed in and how the tenant load
 * is going.
 *
 * Both are in one file so the live build's UI is one import for `App.tsx` to
 * tree-shake away in the other two builds, and so everything that talks to
 * `liveSession.ts` sits together.
 */

import { useState, useSyncExternalStore } from "react";
import { GRAPH_SCOPES } from "./authConfig.ts";
import { liveRedirectUri } from "./auth.ts";
import { getLoadProgress, subscribeLoadProgress } from "./loadProgress.ts";
import { isValidClientId, isValidTenantId } from "./liveConfig.ts";
import { configureAndSignIn, endLiveSession, readLiveConfig, signedInIdentity } from "./liveSession.ts";

const INPUT_CLASS =
  "w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none";

/**
 * The first-run form. Shown when no tenant is configured, which in the live
 * build is the only thing standing between a visitor and their own tenant --
 * there is no `.env` to fill in and no server to restart.
 *
 * It doubles as the setup instructions, because the two values it asks for come
 * from an app registration whose redirect URI has to match this build exactly.
 * Showing that URI here is the difference between a one-minute setup and
 * guessing at an `AADSTS50011` from Microsoft's error page.
 */
function LiveSetupPanel({ onUseSampleTenant }: { onUseSampleTenant: () => void }) {
  const stored = readLiveConfig();
  const [tenantId, setTenantId] = useState(stored?.tenantId ?? "");
  const [clientId, setClientId] = useState(stored?.clientId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tenantOk = isValidTenantId(tenantId.trim());
  const clientOk = isValidClientId(clientId.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantOk || !clientOk) return;
    setBusy(true);
    setError(null);
    try {
      // Navigates to Entra on success, so this does not normally return.
      await configureAndSignIn({ tenantId: tenantId.trim(), clientId: clientId.trim() });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto p-6">
      <form onSubmit={submit} className="w-full max-w-xl rounded-lg border border-ink-700 bg-ink-900 p-5">
        <h2 className="text-sm font-semibold text-slate-100">Connect your Intune tenant</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          You sign in with your own admin account and this page reads your tenant directly from Microsoft Graph. Nothing
          is installed, there is no server, and no client secret exists — this is a public client using PKCE. Everything
          read stays in this tab and goes when you close it.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Directory (tenant) ID
            </span>
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
              className={INPUT_CLASS}
            />
            {tenantId.trim() !== "" && !tenantOk && (
              <span className="mt-1 block text-[11px] text-amber-300">
                Expected a GUID or a verified domain such as contoso.onmicrosoft.com.
              </span>
            )}
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Application (client) ID
            </span>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              autoComplete="off"
              spellCheck={false}
              className={INPUT_CLASS}
            />
            {clientId.trim() !== "" && !clientOk && (
              <span className="mt-1 block text-[11px] text-amber-300">Expected a GUID.</span>
            )}
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-300">
            {error}
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={!tenantOk || !clientOk || busy}
            className="rounded-md bg-emerald-500/20 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Redirecting to sign in…" : "Save and sign in"}
          </button>
          <button
            type="button"
            onClick={onUseSampleTenant}
            className="text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
          >
            Explore the sample tenant instead
          </button>
        </div>

        <div className="mt-5 border-t border-ink-700 pt-4 text-[11px] leading-relaxed text-slate-500">
          <p className="font-medium text-slate-400">Your app registration needs:</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            <li>
              A <span className="text-slate-300">Single-page application</span> redirect URI of exactly{" "}
              <code className="rounded bg-ink-800 px-1 py-0.5 text-slate-300">{liveRedirectUri()}</code> — Entra matches
              this string character for character.
            </li>
            <li>
              These <span className="text-slate-300">delegated</span> Graph permissions, admin-consented:{" "}
              {GRAPH_SCOPES.join(", ")}. All read-only.
            </li>
          </ul>
          <p className="mt-2">
            Neither ID is a secret. Both are kept in this browser, and can be passed in the URL as{" "}
            <code className="rounded bg-ink-800 px-1 py-0.5 text-slate-300">?tenant=…&amp;client=…</code> to bookmark a
            ready-configured page per tenant.
          </p>
        </div>
      </form>
    </div>
  );
}

/**
 * Says that a tenant is authenticated and that the tool is read-only -- and
 * carries the progress counter for a load that runs ~12s on a medium tenant and
 * longer on a large one. Silence for that long reads as a hung page, and the
 * Graph request count is the honest thing to show: it is the work actually being
 * done, not an invented percentage.
 *
 * WHO is signed in is concealed behind the lock rather than printed. This bar
 * sits at the top of the browser build, so it is in every screenshot, every
 * demo and every screen-share of it -- and a UPN and a tenant GUID are the two
 * things least wanted in a published image. Neither is a secret and both are
 * one click away; the point is that publishing them becomes a decision instead
 * of the default.
 */
/**
 * Who is signed in, and how the tenant load is going -- as one lock in the
 * toolbar rather than a band across the window.
 *
 * This replaces a full-width banner. The banner was honest and expensive: it
 * said "Authenticated to tenant · read-only · End session" on a row of its own,
 * above a second row for the compact-layout notice, above the picker summary,
 * above the waitlist. Four rows of status before any policy. On a phone that
 * left the diagram about 150px. None of it is the data anyone opened the app
 * for -- it is the app describing its own condition, and condition belongs in
 * an icon that changes rather than a sentence that persists.
 *
 * So: closed, it is a lock. It spins while the tenant is loading, because the
 * thing being read IS the tenant it is locked to, and it goes red if that
 * failed. Open -- on hover, or pinned by a click so touch and keyboard reach it
 * too -- it is everything the banner said.
 *
 * The identity stays concealed until then, which is the point the lock was
 * given in 2.3.1: a screenshot of this app should not publish an admin's UPN
 * and tenant id. Hovering is deliberate, not persisted, and closes on leave.
 */
export function SessionLock() {
  const progress = useSyncExternalStore(subscribeLoadProgress, getLoadProgress);
  const identity = signedInIdentity();
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [ending, setEnding] = useState(false);

  if (!identity) return null;

  const loading = progress.phase === "loading";
  const failed = progress.phase === "failed";
  const endIt = async () => {
    setEnding(true);
    // Reloads the page, so nothing after this runs on the success path.
    await endLiveSession();
  };
  const close = () => {
    setPinned(false);
    setOpen(false);
  };

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => !pinned && setOpen(false)}>
      <button
        onClick={() => {
          setPinned((v) => !v);
          setOpen(true);
        }}
        aria-expanded={open}
        aria-label={
          failed ? "Tenant load failed" : loading ? "Reading your tenant" : "Authenticated to tenant — read-only"
        }
        title={
          failed
            ? `Load failed: ${progress.error}`
            : loading
              ? `Reading your tenant from Microsoft Graph — ${progress.requests} request${progress.requests === 1 ? "" : "s"}`
              : "Authenticated to tenant — read-only. Hover or click for details."
        }
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm transition-colors ${
          failed
            ? "border-red-400/40 bg-red-500/10 text-red-300"
            : "border-emerald-400/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
        }`}
      >
        {/* The lock itself is the spinner. A separate spinner beside it would
            be a second thing to look at saying the same thing. */}
        <span className={loading ? "inline-block animate-spin" : ""} aria-hidden>
          {failed ? "⚠" : loading ? "🔓" : "🔒"}
        </span>
      </button>

      {open && (
        <>
          {/* Only while pinned: a click-away layer during hover would swallow
              the first click anywhere else in the toolbar. */}
          {pinned && <div className="fixed inset-0 z-30" onClick={close} />}
          <div
            className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg border border-ink-700 bg-ink-900 p-3 text-[11px] shadow-2xl"
            role="status"
          >
            <div className="flex items-baseline gap-1.5">
              <span aria-hidden>{failed ? "⚠" : "🔓"}</span>
              <span className="font-medium text-emerald-300">
                {failed ? "Tenant load failed" : "Authenticated to tenant"}
              </span>
            </div>
            <div className="mt-1.5 break-words font-medium text-slate-200">{identity.name ?? identity.username}</div>
            {identity.name && <div className="break-all text-slate-400">{identity.username}</div>}
            <div className="mt-1 text-slate-400">
              tenant <code className="break-all font-mono text-slate-300">{identity.tenantId}</code>
            </div>

            <div className="mt-2 border-t border-ink-800 pt-2 text-slate-500">
              read-only — this tool never writes to a tenant
            </div>

            {loading && (
              <div className="mt-1 text-sky-300">
                Reading from Microsoft Graph… {progress.requests} request{progress.requests === 1 ? "" : "s"}
              </div>
            )}
            {failed && <div className="mt-1 break-words text-red-300">{progress.error}</div>}

            <button
              onClick={endIt}
              disabled={ending}
              title="Discards the access token and the tenant data held in this tab, then reloads. Closing the tab does the same."
              className="mt-2 w-full rounded border border-emerald-400/40 px-2 py-1.5 font-medium text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {ending ? "Ending…" : "End session"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Shows the first-run form instead of the app until a tenant is configured, or
 * until the visitor says they would rather look at the sample tenant.
 *
 * The "would rather" state lives here, not in `App.tsx`, so the other two builds
 * carry none of it: `App` renders this only behind `LIVE_MODE`, which folds to
 * false and takes the whole component -- and MSAL with it -- out of the bundle.
 */
export function LiveFirstRunGate({
  configured,
  sampleTenantChosen,
  onUseSampleTenant,
  children,
}: {
  /** Null while health is still in flight, so a configured tab doesn't flash the form. */
  configured: boolean | null;
  /**
   * Whether the admin has asked for the sample tenant. Owned by `App` rather
   * than by this gate, because the header's Demo button has to dismiss the panel
   * too. While it lived here, that button was a silent no-op: an unconfigured
   * live build is ALREADY in demo mode, so `switchMode` returned early on
   * `demo === (target === "demo")` and nothing could clear the gate. Two
   * controls that look like they do the same thing, and only one of them worked.
   */
  sampleTenantChosen: boolean;
  onUseSampleTenant: () => void;
  children: React.ReactNode;
}) {
  if (configured === false && !sampleTenantChosen) {
    return <LiveSetupPanel onUseSampleTenant={onUseSampleTenant} />;
  }
  return <>{children}</>;
}
