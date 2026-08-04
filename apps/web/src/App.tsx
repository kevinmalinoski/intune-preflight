import { useEffect, useState } from "react";
import type { Platform } from "@intune-preflight/shared";
import { api } from "./api.ts";
import { EndpointSimulator } from "./EndpointSimulator.tsx";
import { AssignmentReport } from "./AssignmentReport.tsx";

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
      api.health().then((s) => setLoadWarnings(s.loadWarnings ?? [])).catch(() => {});
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
          api.health().then((s) => setLoadWarnings(s.loadWarnings ?? [])).catch(() => {});
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

  return (
    <div className="flex h-full flex-col">
      {/* Single top bar: brand · view tabs · mode · refresh */}
      <header className="flex items-center gap-5 border-b border-ink-700 bg-ink-900 px-5 py-2.5">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-slate-100">Intune Preflight</h1>
          <span className="hidden text-[11px] text-slate-500 md:inline">read-only · no device required</span>
        </div>

        <nav className="flex items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.value ? "bg-sky-500/15 text-sky-300" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>

        {/* Data-source toggle: Connected (real tenant) vs Demo (sample data) */}
        {demo !== null && (
          <div className="ml-auto flex items-center rounded-md border border-ink-700 bg-ink-800 p-0.5">
            {MODES.map((m) => {
              const active = demo === (m.value === "demo");
              const disabled = m.value === "connected" && !hasCredentials;
              return (
                <button
                  key={m.value}
                  onClick={() => switchMode(m.value)}
                  disabled={disabled || switching}
                  title={
                    disabled
                      ? "No tenant configured — add TENANT_ID / CLIENT_ID / CLIENT_SECRET to .env to connect."
                      : m.value === "demo"
                        ? "Use bundled sample data — no tenant required."
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
              : "Clears the server-side cache and re-fetches all policies, assignments and groups from Intune — use this after making changes in the Intune admin center."
          }
          className={`${demo === null ? "ml-auto" : ""} flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            refreshed
              ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
              : "border-ink-700 text-slate-300 hover:bg-ink-800"
          } disabled:cursor-wait disabled:opacity-60`}
        >
          <span className={refreshing ? "animate-spin" : ""}>{refreshing ? "⟳" : refreshed ? "✓" : "⟳"}</span>
          {refreshing ? "Refreshing…" : refreshed ? "Data refreshed" : demo ? "Reload demo data" : "Refresh from Intune"}
        </button>
      </header>

      {/* Demo banner */}
      {demo && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1 text-[11px] text-amber-300">
          <span aria-hidden>🧪</span>
          <span>
            <span className="font-medium">Demo data</span> — a synthetic sample tenant, not connected to Intune.
            {hasCredentials ? " Switch to Connected to use your tenant." : " Add a .env to connect your own tenant."}
          </span>
        </div>
      )}
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
              <span className="font-semibold">Incomplete load — {loadWarnings.length} item(s) failed to import.</span> The
              baseline may be missing policies. Try <span className="font-medium">Refresh from Intune</span>; if it persists,
              check the server logs.
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-red-300/80">
                {loadWarnings.slice(0, 4).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {loadWarnings.length > 4 && <li>…and {loadWarnings.length - 4} more (see server logs).</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {tab === "simulate" ? (
          <EndpointSimulator key={refreshKey} handoff={handoff} onHandoffConsumed={() => setHandoff(null)} />
        ) : (
          <AssignmentReport
            key={refreshKey}
            onSimulateGroups={(groupIds, platform, filterIds) => {
              setHandoff({ groupIds, platform, filterIds });
              setTab("simulate");
            }}
          />
        )}
      </div>
    </div>
  );
}
