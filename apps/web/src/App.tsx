import { useEffect, useState } from "react";
import type { GraphPayload, GroupSummary } from "@intune-baseline/shared";
import { api } from "./api.ts";
import { PolicyGraph } from "./PolicyGraph.tsx";
import { BaselinePanel } from "./BaselinePanel.tsx";

export default function App() {
  const [graph, setGraph] = useState<GraphPayload | null>(null);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.graph(), api.groups()])
      .then(([g, s]) => {
        setGraph(g);
        setGroups(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-ink-700 bg-ink-900 px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Intune Policy Baseline</h1>
          <p className="text-xs text-slate-400">
            An intelligent, no-Policy-Sets view of what's actually assigned to each device group.
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 overflow-y-auto border-r border-ink-700 bg-ink-900 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Device groups</div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <ul className="space-y-1">
            {groups.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => setSelectedGroup(g.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-ink-800 ${
                    selectedGroup === g.id ? "bg-ink-800 text-emerald-300" : "text-slate-300"
                  }`}
                >
                  <div className="font-medium">{g.displayName}</div>
                  <div className="text-[11px] text-slate-500">
                    {g.policyCount} policies · {g.settingsCount} settings
                    {g.conflictCount > 0 && <span className="text-amber-400"> · {g.conflictCount} conflicts</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="relative flex-1 bg-ink-950">
          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-8 text-center text-sm text-red-400">
              {error}. Check your .env credentials and that the server is running.
            </div>
          )}
          {!error && graph && <PolicyGraph graph={graph} onSelectGroup={setSelectedGroup} />}
        </main>
      </div>

      {selectedGroup && <BaselinePanel groupId={selectedGroup} onClose={() => setSelectedGroup(null)} />}
    </div>
  );
}
