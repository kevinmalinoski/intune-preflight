import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import type { AssignmentFilter, Platform, SimulationResult } from "@intune-preflight/shared";
import { api } from "./api.ts";
import { BaselinePeek } from "./BaselinePeek.tsx";
import { deviceReducer, initialDeviceState } from "./endpointDevice.ts";
import { EndpointPicker } from "./EndpointPicker.tsx";
import { GroupTagPill } from "./GroupTagPill.tsx";
import { PolicyPreflight } from "./PolicyPreflight.tsx";
import { SimulationDiagram } from "./SimulationDiagram.tsx";
import { SimulationBaselinePanel, type BaselineScope } from "./SimulationBaselinePanel.tsx";

export function EndpointSimulator({
  handoff,
  onHandoffConsumed,
  focus = false,
  onToggleFocus,
}: {
  /** One-shot "simulate a device in these groups" payload from the Manifest. */
  handoff?: { groupIds: string[]; platform: Platform; filterIds: string[] } | null;
  onHandoffConsumed?: () => void;
  /** Focus mode: every picker hidden, the diagram gets the window. Owned by
   *  App, because the app header is part of what this hides. */
  focus?: boolean;
  onToggleFocus?: () => void;
} = {}) {
  // The simulated endpoint's whole definition -- OS, groups, filters, Autopilot,
  // Group Tag, waitlisted policies -- lives in one reducer. See endpointDevice.ts
  // for why (the rules relating these fields used to be a chain of effects).
  // A Manifest handoff is consumed here as initial state on this fresh mount, so
  // nothing can run later and stomp it.
  const [device, dispatch] = useReducer(deviceReducer, handoff, initialDeviceState);
  const {
    groups,
    platform,
    selectedGroupIds,
    deviceFilterIds,
    unassignedPolicies,
    unassignedPolicyIds,
    isAutopilotDevice,
    groupTag,
  } = device;

  const [filters, setFilters] = useState<AssignmentFilter[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineScope, setBaselineScope] = useState<BaselineScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The handoff was consumed by the reducer's initial state above; clear it once
  // so returning to this tab later (without re-copying) starts a blank device.
  useEffect(() => {
    if (handoff) onHandoffConsumed?.();
  }, [handoff, onHandoffConsumed]);

  useEffect(() => {
    Promise.all([api.groups(), api.filters(), api.unassignedPolicies()])
      .then(([allGroups, allFilters, allUnassigned]) => {
        setFilters(allFilters);
        dispatch({
          type: "catalogLoaded",
          groups: allGroups.filter((g) => !g.id.startsWith("virtual-")),
          unassignedPolicies: allUnassigned,
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Recompute the simulation whenever the endpoint definition changes. Debounced
  // and abortable: the debounce coalesces a burst of changes (typing a Group Tag
  // re-resolves group selection on each keystroke) into one call, and the
  // AbortController cancels any superseded request.
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

  // Open the merged-baseline panel, optionally scoped to a policy type or a
  // single policy (from clicking in the diagram). null = the whole baseline.
  const openBaseline = useCallback((scope: BaselineScope | null) => {
    setBaselineScope(scope);
    setShowBaseline(true);
  }, []);

  // Memoized so its identity is stable across renders -- the diagram keys a
  // layout memo on it, and a fresh array each render would thrash that memo (and
  // the diagram's node-measurement pass) every render.
  const deviceFilterNames = useMemo(
    () =>
      deviceFilterIds
        .map((id) => filters.find((f) => f.id === id)?.displayName)
        .filter((name): name is string => Boolean(name)),
    [deviceFilterIds, filters]
  );

  return (
    <div className="flex h-full flex-col">
      {!focus && (
        <>
          <EndpointPicker
            groups={groups}
            selectedGroupIds={selectedGroupIds}
            platform={platform}
            onTogglePlatform={(p) => dispatch({ type: "setPlatform", platform: p })}
            onToggleGroup={(id) => dispatch({ type: "toggleGroup", id })}
            filters={filters}
            deviceFilterIds={deviceFilterIds}
            onToggleDeviceFilter={(id) => dispatch({ type: "toggleDeviceFilter", id })}
            isAutopilotDevice={isAutopilotDevice}
            onToggleAutopilotDevice={() => dispatch({ type: "toggleAutopilotDevice" })}
            groupTag={groupTag}
            onGroupTagChange={(groupTag) => dispatch({ type: "setGroupTag", groupTag })}
            loading={loading}
          />

          <PolicyPreflight
            policies={unassignedPolicies}
            selectedIds={unassignedPolicyIds}
            onToggle={(id) => dispatch({ type: "toggleUnassignedPolicy", id })}
            onSelectMany={(ids) => dispatch({ type: "selectUnassignedPolicies", ids })}
            onDeselectMany={(ids) => dispatch({ type: "deselectUnassignedPolicies", ids })}
            platform={platform}
          />
        </>
      )}

      {/* Canvas and baseline rail side by side at `lg`, stacked below it.
          `min-h-0` on both, or a flex child refuses to shrink under its own
          content and the rail pushes the canvas off the bottom of the window. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* `overflow-hidden` contains the floating overlays: the legend is taller
            than this area gets once the picker is open on a phone, and without
            this it spills upwards over the bars above instead of being clipped
            to the canvas it belongs to. */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-ink-950">
          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-8 text-center text-sm text-red-400">
              {error}
            </div>
          )}
          {!error && loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 text-center">
              <span
                className="h-8 w-8 animate-spin rounded-full border-2 border-ink-700 border-t-sky-400"
                aria-hidden
              />
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
                focus={focus}
              />
              {/* Capped so these can't run off a narrow canvas -- the excluded-
                policies note is a full sentence. Below `lg` they also drop to a
                band of their own under the diagram's own top-left controls,
                which is the only arrangement that holds however many cards are
                showing. */}
              <div className="absolute right-4 top-14 z-10 flex max-w-[calc(100%-2rem)] flex-col items-end gap-2 lg:top-4">
                <div className="flex items-start gap-2">
                  {/* Autopilot is a Windows-only enrollment path, so off Windows
                    there is no Group Tag to keep and the pill isn't rendered. */}
                  {focus && platform === "windows" && (
                    <GroupTagPill
                      groups={groups}
                      isAutopilotDevice={isAutopilotDevice}
                      onToggleAutopilotDevice={() => dispatch({ type: "toggleAutopilotDevice" })}
                      groupTag={groupTag}
                      onGroupTagChange={(value) => dispatch({ type: "setGroupTag", groupTag: value })}
                      selectedGroupCount={selectedGroupIds.length}
                      settingsCount={simulation.settings.length}
                      conflictsCount={simulation.conflicts.length}
                    />
                  )}
                  {onToggleFocus && (
                    <button
                      onClick={onToggleFocus}
                      title={
                        focus
                          ? "Leave focus mode and bring the pickers back"
                          : "Focus mode: hide every picker and give the diagram the whole window"
                      }
                      aria-pressed={focus}
                      className="flex min-h-[36px] items-center rounded-lg border border-ink-700 bg-ink-900/90 px-2.5 py-1.5 text-xs text-slate-300 shadow-lg backdrop-blur transition-colors hover:bg-ink-800"
                    >
                      {focus ? "✕" : "⛶"}
                    </button>
                  )}
                </div>
                {/* Focus mode only. Everywhere else the rail is on screen with
                  the same counts and its own Open button, and two buttons for
                  one panel is how a UI starts to look accreted. */}
                {focus && (
                  <button
                    onClick={() => openBaseline(null)}
                    className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-lg hover:bg-emerald-500/20"
                  >
                    View merged baseline ({simulation.settings.length} settings
                    {simulation.conflicts.length > 0 ? `, ${simulation.conflicts.length} conflicts` : ""})
                  </button>
                )}
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

        {/* Hidden in focus mode -- focus means the diagram and nothing else,
            and the overlay keeps a way through to the full panel. */}
        {!focus && !error && simulation && <BaselinePeek simulation={simulation} onOpen={() => openBaseline(null)} />}
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
