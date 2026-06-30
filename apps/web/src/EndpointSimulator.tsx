import { useEffect, useState } from "react";
import type { AssignmentFilter, GroupSummary, Platform, SimulationResult } from "@intune-baseline/shared";
import { api } from "./api.ts";
import { EndpointPicker } from "./EndpointPicker.tsx";
import { SimulationDiagram } from "./SimulationDiagram.tsx";
import { SimulationBaselinePanel } from "./SimulationBaselinePanel.tsx";

export function EndpointSimulator() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [filters, setFilters] = useState<AssignmentFilter[]>([]);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [deviceFilterId, setDeviceFilterId] = useState("");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.groups(), api.filters()])
      .then(([allGroups, allFilters]) => {
        setGroups(allGroups.filter((g) => !g.id.startsWith("virtual-")));
        setFilters(allFilters);
      })
      .catch((e) => setError(e.message));
  }, []);

  // A filter selected for one platform won't apply to another -- reset on switch.
  useEffect(() => {
    setDeviceFilterId("");
  }, [platform]);

  useEffect(() => {
    api
      .simulate(selectedGroupIds, platform, deviceFilterId || undefined)
      .then(setSimulation)
      .catch((e) => setError(e.message));
  }, [selectedGroupIds, platform, deviceFilterId]);

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  return (
    <div className="flex h-full flex-col">
      <EndpointPicker
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        platform={platform}
        onTogglePlatform={setPlatform}
        onToggleGroup={toggleGroup}
        filters={filters}
        deviceFilterId={deviceFilterId}
        onChangeDeviceFilter={setDeviceFilterId}
      />

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
          platform={platform}
          deviceFilterId={deviceFilterId || undefined}
          onClose={() => setShowBaseline(false)}
        />
      )}
    </div>
  );
}
