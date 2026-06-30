import { useEffect, useState } from "react";
import type { GraphPayload, GroupSummary } from "@intune-baseline/shared";
import { api } from "./api.ts";
import { PolicyGraph } from "./PolicyGraph.tsx";
import { BaselinePanel } from "./BaselinePanel.tsx";

export function FullGraphExplorer() {
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
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-72 overflow-y-auto border-r border-ink-700 bg-ink-900 p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Device groups</div>
        <p className="mb-3 text-[11px] text-slate-500">
          Every assigned group and policy at once — useful for auditing, but use the Simulator tab to reason about one
          endpoint at a time.
        </p>
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
                <div className="flex items-center gap-1.5 font-medium">
                  {g.displayName}
                  {g.isDynamic && (
                    <span
                      className="rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-300"
                      title={g.membershipRule ?? "Dynamic membership"}
                    >
                      dynamic
                    </span>
                  )}
                </div>
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

      {selectedGroup && <BaselinePanel groupId={selectedGroup} onClose={() => setSelectedGroup(null)} />}
    </div>
  );
}
