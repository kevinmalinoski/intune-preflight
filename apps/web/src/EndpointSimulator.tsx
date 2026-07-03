import { useEffect, useState } from "react";
import { groupTagMatchesRule, isGroupTagRule, isDefaultAutopilotJoinedRule } from "@intune-preflight/shared";
import type { AssignmentFilter, GroupSummary, Platform, SimulationResult } from "@intune-preflight/shared";
import { api } from "./api.ts";
import { EndpointPicker } from "./EndpointPicker.tsx";
import { SimulationDiagram } from "./SimulationDiagram.tsx";
import { SimulationBaselinePanel } from "./SimulationBaselinePanel.tsx";

export function EndpointSimulator() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [filters, setFilters] = useState<AssignmentFilter[]>([]);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [deviceFilterIds, setDeviceFilterIds] = useState<string[]>([]);
  const [isAutopilotDevice, setIsAutopilotDevice] = useState(false);
  const [groupTag, setGroupTag] = useState("");
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

  // Filters selected for one platform won't apply to another -- reset on switch.
  useEffect(() => {
    setDeviceFilterIds([]);
  }, [platform]);

  // Drop selected groups that have no policies for the newly-selected OS, so the
  // selection stays consistent with the (platform-filtered) group list.
  useEffect(() => {
    setSelectedGroupIds((prev) =>
      prev.filter((id) => {
        const g = groups.find((x) => x.id === id);
        return !g || g.platforms.includes(platform);
      })
    );
  }, [platform, groups]);

  // Entering a Group Tag drives selection directly, in real time: every group
  // a device carrying that tag would be a member of (evaluating its [OrderID]
  // clauses -- -eq, -startsWith, and or/and combinations) is auto-selected. A
  // device tagged "SALES-KIOSK-VM" is a member of both a startsWith "SALES-KIOSK"
  // group and an -eq "SALES-KIOSK-VM" group, so both get selected. Group Tag
  // groups the tag no longer matches are dropped; groups with no Group Tag
  // rule are left untouched.
  useEffect(() => {
    const trimmedTag = groupTag.trim();
    if (!trimmedTag) return;
    const matchingIds = groups.filter((g) => groupTagMatchesRule(g.membershipRule, trimmedTag)).map((g) => g.id);
    setSelectedGroupIds((prev) => {
      const kept = prev.filter((id) => {
        const rule = groups.find((g) => g.id === id)?.membershipRule;
        return !isGroupTagRule(rule) || groupTagMatchesRule(rule, trimmedTag);
      });
      const merged = [...kept];
      for (const id of matchingIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      return merged;
    });
  }, [groupTag, groups]);

  // Checking "Autopilot device" links the endpoint to every default
  // Autopilot-joined dynamic group (bare "[ZTDId]" startsWith rule) by
  // selecting them directly, the same way a Group Tag drives selection;
  // unchecking removes them again. This keeps all group selection on the
  // client and the server a pure "given these groups, compute the baseline".
  useEffect(() => {
    const autopilotGroupIds = groups.filter((g) => isDefaultAutopilotJoinedRule(g.membershipRule)).map((g) => g.id);
    if (autopilotGroupIds.length === 0) return;
    setSelectedGroupIds((prev) => {
      if (isAutopilotDevice) {
        const merged = [...prev];
        for (const id of autopilotGroupIds) if (!merged.includes(id)) merged.push(id);
        return merged;
      }
      return prev.filter((id) => !autopilotGroupIds.includes(id));
    });
  }, [isAutopilotDevice, groups]);

  useEffect(() => {
    api
      .simulate(selectedGroupIds, platform, deviceFilterIds)
      .then(setSimulation)
      .catch((e) => setError(e.message));
  }, [selectedGroupIds, platform, deviceFilterIds]);

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const toggleDeviceFilter = (id: string) => {
    setDeviceFilterIds((prev) => (prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]));
  };

  // Unchecking "Autopilot device" turns the endpoint back into a non-Autopilot
  // device: it has no Group Tag and can't belong to any Autopilot-joined or
  // Group Tag group. So clear the tag and drop both kinds of auto-selected
  // groups, rather than leaving stale tag selections behind.
  const toggleAutopilotDevice = () => {
    const nowOn = !isAutopilotDevice;
    setIsAutopilotDevice(nowOn);
    if (!nowOn) {
      setGroupTag("");
      setSelectedGroupIds((prev) =>
        prev.filter((id) => {
          const rule = groups.find((g) => g.id === id)?.membershipRule;
          return !isGroupTagRule(rule) && !isDefaultAutopilotJoinedRule(rule);
        })
      );
    }
  };

  const deviceFilterNames = deviceFilterIds
    .map((id) => filters.find((f) => f.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="flex h-full flex-col">
      <EndpointPicker
        groups={groups}
        selectedGroupIds={selectedGroupIds}
        platform={platform}
        onTogglePlatform={setPlatform}
        onToggleGroup={toggleGroup}
        filters={filters}
        deviceFilterIds={deviceFilterIds}
        onToggleDeviceFilter={toggleDeviceFilter}
        isAutopilotDevice={isAutopilotDevice}
        onToggleAutopilotDevice={toggleAutopilotDevice}
        groupTag={groupTag}
        onGroupTagChange={setGroupTag}
      />

      <div className="relative flex-1 bg-ink-950">
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-8 text-center text-sm text-red-400">
            {error}
          </div>
        )}
        {!error && simulation && (
          <>
            <SimulationDiagram simulation={simulation} deviceFilterNames={deviceFilterNames} />
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
          deviceFilterIds={deviceFilterIds}
          onClose={() => setShowBaseline(false)}
        />
      )}
    </div>
  );
}
