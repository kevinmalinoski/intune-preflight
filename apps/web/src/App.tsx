import { useState } from "react";
import { EndpointSimulator } from "./EndpointSimulator.tsx";
import { FullGraphExplorer } from "./FullGraphExplorer.tsx";

type Tab = "simulate" | "explore";

export default function App() {
  const [tab, setTab] = useState<Tab>("simulate");

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Intune Policy Baseline</h1>
          <p className="text-xs text-slate-400">
            An intelligent, no-Policy-Sets view of what's actually assigned to each device group.
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg border border-ink-700 bg-ink-800 p-1">
          <button
            onClick={() => setTab("simulate")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === "simulate" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Simulate endpoint
          </button>
          <button
            onClick={() => setTab("explore")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              tab === "explore" ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Full graph (advanced)
          </button>
        </nav>
      </header>

      {tab === "simulate" ? <EndpointSimulator /> : <FullGraphExplorer />}
    </div>
  );
}
