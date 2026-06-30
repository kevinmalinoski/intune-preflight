import { useEffect, useState } from "react";
import type { GroupSummary, SimulationResult } from "@intune-baseline/shared";
import { api } from "./api.ts";
import { EndpointPicker } from "./EndpointPicker.tsx";
import { SimulationDiagram } from "./SimulationDiagram.tsx";
import { SimulationBaselinePanel } from "./SimulationBaselinePanel.tsx";

export function EndpointSimulator() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .groups()
      .then((allGroups) => setGroups(allGroups.filter((g) => !g.id.startsWith("virtual-"))))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    api
      .simulate(selectedGroupIds)
      .then(setSimulation)
      .catch((e) => setError(e.message));
  }, [selectedGroupIds]);

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  return (
    <div className="flex h-full flex-col">
      <EndpointPicker groups={groups} selectedGroupIds={selectedGroupIds} onToggleGroup={toggleGroup} />

      <div className="relative flex-1 bg-ink-950">
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-8 text-center text-sm text-red-400">
            {error}
          </div>
        )}
        {!error && simulation && (
          <>
            <SimulationDiagram simulation={simulation} />
            <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
              <button
                onClick={() => setShowBaseline(true)}
                className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-lg hover:bg-emerald-500/20"
              >
                View merged baseline ({simulation.settings.length} settings
                {simulation.conflicts.length > 0 ? `, ${simulation.conflicts.length} conflicts` : ""})
              </button>
              {simulation.excludedPolicies.length > 0 && (
                <div className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 shadow-lg">
                  {simulation.excludedPolicies.length} polic{simulation.excludedPolicies.length === 1 ? "y" : "ies"}{" "}
                  explicitly excluded for this selection
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showBaseline && simulation && (
        <SimulationBaselinePanel
          simulation={simulation}
          groupIds={selectedGroupIds}
          onClose={() => setShowBaseline(false)}
        />
      )}
    </div>
  );
}
