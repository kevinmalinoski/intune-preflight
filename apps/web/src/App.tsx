import { useState } from "react";
import { api } from "./api.ts";
import { EndpointSimulator } from "./EndpointSimulator.tsx";

export default function App() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshed(false);
    try {
      await api.refresh();
      setRefreshKey((k) => k + 1);
      setRefreshed(true);
      setTimeout(() => setRefreshed(false), 2500);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Intune Preflight</h1>
          <p className="text-xs text-slate-400">
            Simulate an endpoint and preview the exact Intune baseline it would receive — no device required.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Clears the server-side cache and re-fetches all policies, assignments and groups from Intune — use this after making changes in the Intune admin center."
          className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
            refreshed
              ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
              : "border-ink-700 text-slate-300 hover:bg-ink-800"
          } disabled:cursor-wait disabled:opacity-60`}
        >
          <span className={refreshing ? "animate-spin" : ""}>{refreshing ? "⟳" : refreshed ? "✓" : "⟳"}</span>
          {refreshing ? "Refreshing…" : refreshed ? "Data refreshed" : "Refresh from Intune"}
        </button>
      </header>

      <EndpointSimulator key={refreshKey} />
    </div>
  );
}
