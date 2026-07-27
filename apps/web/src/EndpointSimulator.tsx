import { useCallback, useEffect, useState } from "react";
import { groupTagMatchesRule, isGroupTagRule, isAutopilotJoinedRule } from "@intune-preflight/shared";
import type {
  AssignmentFilter,
  GroupSummary,
  Platform,
  SimulationResult,
  UnassignedPolicy,
} from "@intune-preflight/shared";
import { api } from "./api.ts";
import { EndpointPicker } from "./EndpointPicker.tsx";
import { PolicyPreflight } from "./PolicyPreflight.tsx";
import { SimulationDiagram } from "./SimulationDiagram.tsx";
import { SimulationBaselinePanel, type BaselineScope } from "./SimulationBaselinePanel.tsx";

export function EndpointSimulator() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [filters, setFilters] = useState<AssignmentFilter[]>([]);
  const [platform, setPlatform] = useState<Platform>("windows");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [deviceFilterIds, setDeviceFilterIds] = useState<string[]>([]);
  const [unassignedPolicies, setUnassignedPolicies] = useState<UnassignedPolicy[]>([]);
  const [unassignedPolicyIds, setUnassignedPolicyIds] = useState<string[]>([]);
  const [isAutopilotDevice, setIsAutopilotDevice] = useState(false);
  const [groupTag, setGroupTag] = useState("");
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineScope, setBaselineScope] = useState<BaselineScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.groups(), api.filters(), api.unassignedPolicies()])
      .then(([allGroups, allFilters, allUnassigned]) => {
        setGroups(allGroups.filter((g) => !g.id.startsWith("virtual-")));
        setFilters(allFilters);
        setUnassignedPolicies(allUnassigned);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Filters selected for one platform won't apply to another -- reset on switch.
  useEffect(() => {
    setDeviceFilterIds([]);
  }, [platform]);

  // Autopilot is Windows-only -- turn it (and any Group Tag) off when the
  // simulated OS isn't Windows, so stale Autopilot state can't linger.
  useEffect(() => {
    if (platform !== "windows") {
      setIsAutopilotDevice(false);
      setGroupTag("");
    }
  }, [platform]);

  // Manually-added unassigned policies are OS-specific too -- drop any whose
  // platform no longer matches when the simulated OS changes.
  useEffect(() => {
    setUnassignedPolicyIds((prev) =>
      prev.filter((id) => unassignedPolicies.find((p) => p.id === id)?.platform === platform)
    );
  }, [platform, unassignedPolicies]);

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
    const autopilotGroupIds = groups.filter((g) => isAutopilotJoinedRule(g.membershipRule)).map((g) => g.id);
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

  // Recompute the simulation whenever the endpoint definition changes. Debounced
  // and abortable: a single OS switch cascades into several state updates (reset
  // filters, drop off-platform groups/unassigned), and without this each would
  // fire its own request and re-render the graph. The debounce coalesces them
  // into one call and the AbortController cancels any superseded request.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .simulate({ groupIds: selectedGroupIds, platform, deviceFilterIds, unassignedPolicyIds }, controller.signal)
        .then(setSimulation)
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedGroupIds, platform, deviceFilterIds, unassignedPolicyIds]);

  const toggleUnassignedPolicy = (id: string) => {
    setUnassignedPolicyIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const selectUnassignedPolicies = (ids: string[]) => {
    setUnassignedPolicyIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const deselectUnassignedPolicies = (ids: string[]) => {
    const remove = new Set(ids);
    setUnassignedPolicyIds((prev) => prev.filter((id) => !remove.has(id)));
  };

  // Open the merged-baseline panel, optionally scoped to a policy type or a
  // single policy (from clicking in the diagram). null = the whole baseline.
  const openBaseline = useCallback((scope: BaselineScope | null) => {
    setBaselineScope(scope);
    setShowBaseline(true);
  }, []);

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
          return !isGroupTagRule(rule) && !isAutopilotJoinedRule(rule);
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
        loading={loading}
      />

      <PolicyPreflight
        policies={unassignedPolicies}
        selectedIds={unassignedPolicyIds}
        onToggle={toggleUnassignedPolicy}
        onSelectMany={selectUnassignedPolicies}
        onDeselectMany={deselectUnassignedPolicies}
        platform={platform}
      />

      <div className="relative flex-1 bg-ink-950">
        {error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-8 text-center text-sm text-red-400">
            {error}
          </div>
        )}
        {!error && loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-700 border-t-sky-400" aria-hidden />
            <div className="text-sm text-slate-300">Loading tenant data from Intune…</div>
            <div className="max-w-xs text-xs text-slate-600">
              The first load reads every policy and assignment in the tenant — this can take a little while.
            </div>
          </div>
        )}
        {!error && !loading && simulation && (
          <>
            <SimulationDiagram
              simulation={simulation}
              deviceFilterNames={deviceFilterNames}
              onOpenBaseline={openBaseline}
            />
            <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
              <button
                onClick={() => openBaseline(null)}
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
          unassignedPolicyIds={unassignedPolicyIds}
          scope={baselineScope}
          onClearScope={() => setBaselineScope(null)}
          onClose={() => setShowBaseline(false)}
        />
      )}
    </div>
  );
}
