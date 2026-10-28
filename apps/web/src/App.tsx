import { useEffect, useState } from "react";
import type { Platform } from "@intune-preflight/shared";
import { api, LIVE_MODE, STATIC_DEMO } from "./api.ts";
import { EndpointSimulator } from "./EndpointSimulator.tsx";
import { AssignmentReport } from "./AssignmentReport.tsx";
import { CompactLayoutBanner } from "./CompactLayoutBanner.tsx";
import { LiveFirstRunGate, LiveSessionBanner } from "./LiveSession.tsx";

// Public repo, for the "deploy your own / self-host" nudges shown in demo mode.
const REPO_URL = "https://github.com/kevinmalinoski/intune-preflight";

type Tab = "simulate" | "assignments";

const TABS: { value: Tab; label: string; icon: string }[] = [
  { value: "simulate", label: "Endpoint Preflight", icon: "💻" },
  { value: "assignments", label: "Assignment Manifest", icon: "📋" },
];

export default function App() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tab, setTab] = useState<Tab>("simulate");
  // Focus mode lives here rather than in the simulator because the app header
  // and the banners are part of what it hides. Leaving the simulate tab drops
  // it: the manifest has no diagram to focus on, and coming back to a chromeless
  // app you did not ask for would be a nasty surprise.
  const [focus, setFocus] = useState(false);
  // One-shot handoff from the Assignment Manifest: "simulate a device in these
  // groups". Set it and switch to the simulator; the simulator seeds from it on
  // its fresh mount (the tabs unmount, so this is a true ground-up recompute)
  // and clears it so a later manual tab switch doesn't re-apply a stale device.
  const [handoff, setHandoff] = useState<{ groupIds: string[]; platform: Platform; filterIds: string[] } | null>(null);

  // Data-source mode. `demo === null` until the server status loads.
  const [demo, setDemo] = useState<boolean | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  // Live build only: whether the admin has asked to see the sample tenant, which
  // dismisses the first-run setup panel. It lives here rather than inside the
  // gate because BOTH the panel's own link and the header's Demo button have to
  // set it -- see LiveFirstRunGate for what went wrong while the gate owned it.
  const [sampleTenantChosen, setSampleTenantChosen] = useState(false);
  // Non-empty when the last connected load was incomplete (a category/policy
  // failed even after retries). Surfaced as a banner so a partial load is never
  // silent.
  const [loadWarnings, setLoadWarnings] = useState<string[]>([]);

  useEffect(() => {
    api
      .health()
      .then((s) => {
        setDemo(s.demo);
        setHasCredentials(s.hasCredentials);
        setLoadWarnings(s.loadWarnings ?? []);
      })
      .catch(() => setDemo(null));
    // The first view load triggers the tenant fetch; re-poll health shortly after
    // to pick up any warnings it produced.
    const t = setTimeout(() => {
      api
        .health()
        .then((s) => setLoadWarnings(s.loadWarnings ?? []))
        .catch(() => {});
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshed(false);
    try {
      const { warnings } = await api.refresh();
      setLoadWarnings(warnings);
      setRefreshKey((k) => k + 1);
      setRefreshed(true);
      setTimeout(() => setRefreshed(false), 2500);
    } finally {
      setRefreshing(false);
    }
  };

  const switchMode = async (target: "demo" | "connected") => {
    // Choosing Demo always dismisses the live build's setup panel, and does so
    // BEFORE the no-op guard below. An unconfigured live build already reports
    // `demo === true`, so the guard returns immediately -- which used to leave
    // the header's Demo button doing nothing at all while the panel sat there.
    if (target === "demo") setSampleTenantChosen(true);
    if (switching || demo === (target === "demo")) return;
    setSwitching(true);
    setModeError(null);
    try {
      const status = await api.setMode(target);
      setDemo(status.demo);
      setHasCredentials(status.hasCredentials);
      setLoadWarnings([]); // demo has none; connected re-populates on the next health poll
      setRefreshKey((k) => k + 1); // remount views so they refetch from the new source
      if (target === "connected") {
        setTimeout(() => {
          api
            .health()
            .then((s) => setLoadWarnings(s.loadWarnings ?? []))
            .catch(() => {});
        }, 3000);
      }
    } catch (e) {
      setModeError((e as Error).message);
    } finally {
      setSwitching(false);
    }
  };

  const MODES: { value: "demo" | "connected"; label: string }[] = [
    { value: "connected", label: "Connected" },
    { value: "demo", label: "Demo" },
  ];

  const views =
    tab === "simulate" ? (
      <EndpointSimulator
        key={refreshKey}
        handoff={handoff}
        onHandoffConsumed={() => setHandoff(null)}
        focus={focus}
        onToggleFocus={() => setFocus((f) => !f)}
      />
    ) : (
      <AssignmentReport
        key={refreshKey}
        onSimulateGroups={(groupIds, platform, filterIds) => {
          setHandoff({ groupIds, platform, filterIds });
          setFocus(false);
          setTab("simulate");
        }}
      />
    );

  return (
    <div className="flex h-full flex-col">
      {/* Single top bar: brand · view tabs · mode · refresh. It wraps rather
          than squeezing, and the tabs take a full row of their own below the
          brand once there isn't width for one line -- a segmented control is
          the shape a narrow window wants anyway. */}
      {/* Every bit of app chrome, hidden together in focus mode: the point of
          that mode is the diagram having the window, and a header left behind
          would just be the part we forgot. */}
      {!focus && (
        <>
          <header className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-ink-700 bg-ink-900 px-3 py-2 sm:px-5 sm:py-2.5">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold text-slate-100">Intune Preflight</h1>
              <span className="hidden text-[11px] text-slate-500 md:inline">read-only · no device required</span>
            </div>

            <nav className="order-last flex w-full items-center gap-1 lg:order-none lg:w-auto">
              {TABS.map((t) => (
                <button
                  key={t.value}
                  onClick={() => {
                    setFocus(false);
                    setTab(t.value);
                  }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors lg:flex-none lg:justify-start lg:py-1.5 ${
                    tab === t.value
                      ? "bg-sky-500/15 text-sky-300"
                      : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                  }`}
                >
                  <span aria-hidden>{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </nav>

            {/* Data-source toggle: Connected (real tenant) vs Demo (sample data) */}
            {/* The two right-hand controls travel together, so a header that wraps
            moves both or neither -- rather than stranding Refresh on a row of
            its own under them. */}
            <div className="ml-auto flex items-center gap-2">
              {demo !== null && (
                <div className="flex items-center rounded-md border border-ink-700 bg-ink-800 p-0.5">
                  {MODES.map((m) => {
                    const active = demo === (m.value === "demo");
                    const disabled = m.value === "connected" && !hasCredentials;
                    // Static public demo: there's no backend to connect, so the
                    // "Connected" control becomes a nudge to self-host on GitHub.
                    if (STATIC_DEMO && m.value === "connected") {
                      return (
                        <a
                          key={m.value}
                          href={REPO_URL}
                          target="_blank"
                          rel="noreferrer"
                          title="Connect your own Intune tenant by self-hosting — see the setup on GitHub."
                          className="rounded px-2.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:text-emerald-300"
                        >
                          Connect your tenant ↗
                        </a>
                      );
                    }
                    return (
                      <button
                        key={m.value}
                        onClick={() => switchMode(m.value)}
                        disabled={disabled || switching}
                        title={
                          disabled
                            ? LIVE_MODE
                              ? "No tenant configured — add your tenant ID and client ID to sign in."
                              : "No tenant configured — add TENANT_ID / CLIENT_ID / CLIENT_SECRET to .env to connect."
                            : m.value === "demo"
                              ? "Use bundled sample data — no tenant required."
                              : LIVE_MODE
                                ? "Sign in with your own admin account and read your tenant from Microsoft Graph."
                                : "Use your connected Intune tenant."
                        }
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? m.value === "demo"
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/15 text-emerald-300"
                            : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title={
                  demo
                    ? "Reloads the bundled demo data."
                    : LIVE_MODE
                      ? "Re-reads every policy, assignment and group from Microsoft Graph in this tab — use this after making changes in the Intune admin center."
                      : "Clears the server-side cache and re-fetches all policies, assignments and groups from Intune — use this after making changes in the Intune admin center."
                }
                className={`flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  refreshed
                    ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
                    : "border-ink-700 text-slate-300 hover:bg-ink-800"
                } disabled:cursor-wait disabled:opacity-60`}
              >
                <span className={refreshing ? "animate-spin" : ""}>{refreshing ? "⟳" : refreshed ? "✓" : "⟳"}</span>
                {/* Label only once there's room for it; the glyph carries it below. */}
                <span className="hidden sm:inline">
                  {refreshing
                    ? "Refreshing…"
                    : refreshed
                      ? "Data refreshed"
                      : demo
                        ? "Reload demo data"
                        : "Refresh from Intune"}
                </span>
              </button>
            </div>
          </header>

          <CompactLayoutBanner />

          {/* Demo banner */}
          {demo && (
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1 text-[11px] text-amber-300">
              <span aria-hidden>🧪</span>
              {STATIC_DEMO ? (
                <span>
                  <span className="font-medium">Sample tenant</span> — synthetic data modelled on the{" "}
                  <a
                    href="https://github.com/SkipToTheEndpoint/OpenIntuneBaseline"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-amber-400/40 underline-offset-2 hover:text-amber-200"
                  >
                    Open Intune Baseline
                  </a>
                  . Nothing here is connected to a real tenant.{" "}
                  <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-emerald-300 underline decoration-emerald-400/40 underline-offset-2 hover:text-emerald-200"
                  >
                    Deploy your own to see your Intune →
                  </a>
                </span>
              ) : (
                <span>
                  <span className="font-medium">Demo data</span> — a synthetic sample tenant, not connected to Intune.
                  {hasCredentials
                    ? " Switch to Connected to use your tenant."
                    : LIVE_MODE
                      ? " Add your tenant ID and client ID to sign in to your own."
                      : " Add a .env to connect your own tenant."}
                </span>
              )}
            </div>
          )}
          {/* Live build: who is signed in, which tenant, and how the load is going. */}
          {LIVE_MODE && !demo && <LiveSessionBanner />}

          {modeError && (
            <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-1 text-center text-[11px] text-red-300">
              {modeError}
            </div>
          )}

          {/* Incomplete-load banner: the tenant fetch dropped something even after
          retries, so the baseline is missing data. Never let that be silent. */}
          {!demo && loadWarnings.length > 0 && (
            <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-1.5 text-[11px] text-red-300">
              <div className="flex items-start gap-2">
                <span aria-hidden>⚠️</span>
                <div>
                  <span className="font-semibold">
                    Incomplete load — {loadWarnings.length} item(s) failed to import.
                  </span>{" "}
                  The baseline may be missing policies. Try <span className="font-medium">Refresh from Intune</span>; if
                  it persists, check the {LIVE_MODE ? "browser console" : "server logs"}.
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-red-300/80">
                    {loadWarnings.slice(0, 4).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                    {loadWarnings.length > 4 && (
                      <li>
                        …and {loadWarnings.length - 4} more (see the {LIVE_MODE ? "browser console" : "server logs"}).
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Live build with nothing configured: the first-run form is the only
          setup step there is, so it takes the content area. The gate carries its
          own state so the other two builds keep none of it. */}
      <div className="min-h-0 flex-1">
        {LIVE_MODE ? (
          <LiveFirstRunGate
            configured={demo === null ? null : hasCredentials}
            sampleTenantChosen={sampleTenantChosen}
            onUseSampleTenant={() => setSampleTenantChosen(true)}
          >
            {views}
          </LiveFirstRunGate>
        ) : (
          views
        )}
      </div>
    </div>
  );
}
