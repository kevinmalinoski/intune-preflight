import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import type { AssignmentFilter, Platform, SimulationResult } from "@intune-preflight/shared";
import { api, type AppsExportFormat } from "./api.ts";
import type { AppsFocus } from "./AppsList.tsx";
import { countApps } from "./appsView.ts";
import { AppsPanel, AppsPeek } from "./AppsPanel.tsx";
import { BaselinePeek } from "./BaselinePeek.tsx";
import { appFamilyOf, isAppKind } from "./diagram/theme.ts";
import { deviceReducer, initialDeviceState } from "./endpointDevice.ts";
import { EndpointPicker, EndpointSummary } from "./EndpointPicker.tsx";
import { GroupTagPill } from "./GroupTagPill.tsx";
import { PolicyPreflight } from "./PolicyPreflight.tsx";
import { SimulationDiagram } from "./SimulationDiagram.tsx";
import { SimulationBaselinePanel, type BaselineScope } from "./SimulationBaselinePanel.tsx";
import { saveDownload } from "./download.ts";
import { readStored, writeStored } from "./storage.ts";
import { isCompact, subscribeLayout } from "./viewport.ts";

const RAIL_TAB_KEY = "simulatorRailTab";
const SHOW_AVAILABLE_KEY = "appsShowAvailable";
const SIDEBAR_KEY = "endpointSidebarCollapsed";
type RailTab = "baseline" | "apps";

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

  const compact = useSyncExternalStore(subscribeLayout, isCompact, () => false);
  const [filters, setFilters] = useState<AssignmentFilter[]>([]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const [baselineScope, setBaselineScope] = useState<BaselineScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Apps have two homes, like the baseline: a tab in the rail where there is a
  // rail, and a docked panel where there isn't (below `lg`, and in focus mode).
  //
  // `railTab` is also what the DIAGRAM draws: Baseline shows the policies, Apps
  // shows the apps, never both on one canvas. One piece of state on purpose --
  // the list on the right and the picture on the left are the same question,
  // and two switches for it could be left disagreeing.
  const [railTab, setRailTab] = useState<RailTab>(() => (readStored(RAIL_TAB_KEY) === "apps" ? "apps" : "baseline"));
  const [showApps, setShowApps] = useState(false);
  // Apps that are only Available are hidden until asked for, in the list and
  // the diagram together -- an offer in Company Portal changes nothing on the
  // device, and the space goes to what installs and what is removed.
  const [showAvailableApps, setShowAvailableAppsState] = useState(() => readStored(SHOW_AVAILABLE_KEY) === "1");
  const setShowAvailableApps = useCallback((show: boolean) => {
    setShowAvailableAppsState(show);
    writeStored(SHOW_AVAILABLE_KEY, show ? "1" : "0");
  }, []);
  const [appsFocus, setAppsFocus] = useState<AppsFocus | null>(null);
  const hasRail = !focus && !compact;
  // The endpoint sidebar: open by default, collapsible to a strip when the
  // diagram wants the width. Below `lg` it is a slide-over instead.
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => readStored(SIDEBAR_KEY) === "1");
  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setSidebarCollapsedState(collapsed);
    writeStored(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, []);
  const [endpointSheetOpen, setEndpointSheetOpen] = useState(false);
  useEffect(() => {
    if (!compact) setEndpointSheetOpen(false);
  }, [compact]);

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
  const selectRailTab = useCallback((tab: RailTab) => {
    setRailTab(tab);
    writeStored(RAIL_TAB_KEY, tab);
  }, []);

  const openApps = useCallback(
    (family?: AppsFocus["family"]) => {
      if (family) setAppsFocus({ family, nonce: Date.now() });
      selectRailTab("apps");
      if (!hasRail) setShowApps(true);
    },
    [hasRail, selectRailTab]
  );

  // The diagram reports every click as a baseline scope. Apps ride the policy
  // column as `app:` kinds (see theme.ts), and an app has no settings to scope
  // the baseline to -- so those clicks go to the Apps list instead.
  const openBaseline = useCallback(
    (scope: BaselineScope | null) => {
      const target = scope ? ("kind" in scope ? scope.kind : scope.policyId) : "";
      if (isAppKind(target)) {
        openApps(appFamilyOf(target));
        return;
      }
      setBaselineScope(scope);
      setShowBaseline(true);
    },
    [openApps]
  );

  // Built on click, like the baseline's exports: in the browser-only builds the
  // download is bytes rather than a URL, so there is nothing to prepare ahead.
  const exportApps = useCallback(
    (format: AppsExportFormat) =>
      saveDownload(
        api.simulateExport({ groupIds: selectedGroupIds, platform, deviceFilterIds, unassignedPolicyIds }, format),
        `endpoint-apps.${format === "apps-xlsx" ? "xlsx" : "csv"}`
      ),
    [selectedGroupIds, platform, deviceFilterIds, unassignedPolicyIds]
  );

  // Leaving the layout that has no rail takes its stand-in panel with it;
  // otherwise it would sit on top of the rail it was standing in for.
  useEffect(() => {
    if (hasRail) setShowApps(false);
  }, [hasRail]);

  // Memoized so its identity is stable across renders -- the diagram keys a
  // layout memo on it, and a fresh array each render would thrash that memo (and
  // the diagram's node-measurement pass) every render.
  const baselineOverlay = simulation && (
    <>
      {/* Wherever the baseline rail isn't. At `lg` and up the rail is on screen
          with the same counts and its own Open button, and two buttons for one
          panel is how a UI starts to look accreted -- but focus mode hides the
          rail, and below `lg` there is no rail at all now, so this is the only
          way through to the whole baseline. */}
      <button
        onClick={() => openBaseline(null)}
        className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-lg backdrop-blur hover:bg-emerald-500/20"
      >
        View merged baseline ({simulation.settings.length} settings
        {simulation.conflicts.length > 0 ? `, ${simulation.conflicts.length} conflicts` : ""})
      </button>
      {simulation.apps && (
        <button
          onClick={() => openApps()}
          className={`rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur ${
            simulation.apps.unavailable
              ? "border-amber-400/50 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
              : "border-teal-400/50 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20"
          }`}
        >
          {simulation.apps.unavailable
            ? simulation.apps.unavailable.reason === "permission"
              ? "Apps need a permission"
              : "Apps couldn’t be loaded"
            : `View apps (${countApps(simulation.apps)})`}
        </button>
      )}
      {simulation.excludedPolicies.length > 0 && (
        <div className="rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 shadow-lg backdrop-blur">
          {simulation.excludedPolicies.length} polic
          {simulation.excludedPolicies.length === 1 ? "y" : "ies"} explicitly excluded for this selection
        </div>
      )}
    </>
  );

  const deviceFilterNames = useMemo(
    () =>
      deviceFilterIds
        .map((id) => filters.find((f) => f.id === id)?.displayName)
        .filter((name): name is string => Boolean(name)),
    [deviceFilterIds, filters]
  );

  // The endpoint's definition: OS, Autopilot, filters, groups, and the waitlist
  // as its last section. One body, two homes -- the sidebar at `lg` and up, a
  // slide-over below it -- so the two cannot offer different controls.
  const endpointControls = (
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
  );

  return (
    <div className="flex h-full flex-col">
      {/* Below `lg` there is no room for a sidebar beside the canvas, so the
          endpoint is one line that opens the same controls as a slide-over. */}
      {compact && !focus && (
        <EndpointSummary
          groups={groups}
          selectedGroupIds={selectedGroupIds}
          platform={platform}
          filters={filters}
          deviceFilterIds={deviceFilterIds}
          isAutopilotDevice={isAutopilotDevice}
          groupTag={groupTag}
          onOpen={() => setEndpointSheetOpen(true)}
        />
      )}

      {/* Three columns at `lg`, in the order the tool is used and the diagram
          is drawn: define the endpoint, watch it resolve, read the result.
          The inputs used to be full-width bars ABOVE the canvas, so every
          control that was open took its height from the diagram and the graph
          refitted each time. Beside it, nothing in the sidebar can resize it.
          `min-h-0` throughout, or a flex child refuses to shrink under its own
          content and pushes its neighbours off the bottom of the window. */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {!compact &&
          !focus &&
          (sidebarCollapsed ? (
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Show the endpoint controls"
              aria-label="Show the endpoint controls"
              aria-expanded={false}
              className="flex w-9 shrink-0 flex-col items-center gap-3 border-r border-ink-700 bg-ink-900 py-3 text-slate-400 hover:bg-ink-800/60 hover:text-slate-200"
            >
              <span aria-hidden>»</span>
              <span className="text-[10px] font-medium uppercase tracking-wide [writing-mode:vertical-rl]">
                Endpoint · {selectedGroupIds.length} group{selectedGroupIds.length === 1 ? "" : "s"}
              </span>
            </button>
          ) : (
            <aside
              aria-label="Simulated endpoint"
              className="flex min-h-0 w-80 shrink-0 flex-col border-r border-ink-700 bg-ink-900"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-2">
                <span className="text-sm" aria-hidden>
                  💻
                </span>
                <span className="min-w-0 flex-1 text-xs font-semibold text-slate-200">Simulated endpoint</span>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  title="Collapse the endpoint controls to give the diagram the width"
                  aria-label="Collapse the endpoint controls"
                  aria-expanded
                  className="shrink-0 rounded-md border border-ink-700 px-2 py-0.5 text-xs text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                >
                  «
                </button>
              </div>
              {endpointControls}
            </aside>
          ))}

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
                content={railTab === "apps" ? "apps" : "policies"}
                onContentChange={(next) => selectRailTab(next === "apps" ? "apps" : "baseline")}
                showAvailableApps={showAvailableApps}
                onShowAvailableAppsChange={setShowAvailableApps}
                focus={focus}
                baselineOpen={showBaseline}
              />
              {/* Capped so these can't run off a narrow canvas -- the excluded-
              policies note is a full sentence. Below `lg` they also drop to a
              band of their own under the diagram's own top-left controls, which
              is the only arrangement that holds however many cards are
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
                {/* Focus mode keeps these top-right, where the canvas is wide
                and nothing competes. Below `lg` they move to the bottom-left
                corner instead -- the viewport aims the policy column just
                right of centre, so a top-right button lands squarely on the
                chips. */}
                {focus && baselineOverlay}
              </div>
              {compact && !focus && (
                <div className="absolute bottom-14 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-2">
                  {baselineOverlay}
                </div>
              )}
            </>
          )}
        </div>

        {/* The rail, at `lg` and up only.
            Below it this was a collapsed bar that opened a 45vh accordion of
            the baseline by CSP area, over the canvas. It was the fourth list
            on a phone -- after the policy types, their policies, and the
            settings themselves -- and it arrived from the bottom of the screen
            rather than from anything you had tapped, grouped by an axis the
            diagram doesn't use. Reaching the baseline is now the end of one
            path: a type, then a policy, then its settings, with the overlay's
            button for the whole thing. That is what focus mode always did, and
            it is the arrangement that reads cleanly at phone width.

            The rail stays at `lg`, where it costs nothing and cause and effect
            being on screen together is the whole argument for it. */}
        {hasRail && !error && simulation && (
          <SimulationRail
            simulation={simulation}
            tab={simulation.apps ? railTab : "baseline"}
            onSelectTab={selectRailTab}
            appsFocus={appsFocus}
            onExportApps={exportApps}
            showAvailableApps={showAvailableApps}
            onShowAvailableAppsChange={setShowAvailableApps}
            onOpenBaseline={() => openBaseline(null)}
          />
        )}
      </div>

      {compact && endpointSheetOpen && !focus && (
        <>
          <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setEndpointSheetOpen(false)} />
          <div
            role="dialog"
            aria-label="Simulated endpoint"
            className="fixed inset-y-0 left-0 z-40 flex w-[min(22rem,92vw)] flex-col border-r border-ink-700 bg-ink-900 shadow-2xl"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-ink-700 px-3 py-2">
              <span className="min-w-0 flex-1 text-xs font-semibold text-slate-200">Simulated endpoint</span>
              <button
                onClick={() => setEndpointSheetOpen(false)}
                aria-label="Close the endpoint controls"
                className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
              >
                Done
              </button>
            </div>
            {endpointControls}
          </div>
        </>
      )}

      {showApps && !hasRail && simulation?.apps && (
        <AppsPanel
          simulation={simulation}
          focus={appsFocus}
          onClose={() => setShowApps(false)}
          onExport={exportApps}
          showAvailable={showAvailableApps}
          onShowAvailableChange={setShowAvailableApps}
        />
      )}

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

/**
 * The rail beside the diagram: the merged baseline, and -- when the data source
 * has apps -- a second tab for them.
 *
 * Tabs rather than two stacked lists because the rail is 24rem wide and both
 * lists want all of its height. With no app data (the demo tenant) there is no
 * strip at all and the rail is exactly what it was.
 */
function SimulationRail({
  simulation,
  tab,
  onSelectTab,
  appsFocus,
  onExportApps,
  showAvailableApps,
  onShowAvailableAppsChange,
  onOpenBaseline,
}: {
  simulation: SimulationResult;
  tab: RailTab;
  onSelectTab: (tab: RailTab) => void;
  appsFocus: AppsFocus | null;
  onExportApps: (format: AppsExportFormat) => void;
  showAvailableApps: boolean;
  onShowAvailableAppsChange: (show: boolean) => void;
  onOpenBaseline: () => void;
}) {
  const apps = simulation.apps;
  const tabButton = (id: RailTab, label: string, badge: string, attention = false) => (
    <button
      role="tab"
      aria-selected={tab === id}
      onClick={() => onSelectTab(id)}
      className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
        tab === id
          ? "border-sky-400 text-slate-100"
          : "border-transparent text-slate-500 hover:bg-ink-800/60 hover:text-slate-300"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
          attention ? "bg-amber-500/15 text-amber-300" : "bg-ink-800 text-slate-400"
        }`}
      >
        {badge}
      </span>
    </button>
  );
  const tabs = apps && (
    <div role="tablist" aria-label="Endpoint results" className="flex shrink-0 border-b border-ink-700">
      {tabButton("baseline", "Baseline", String(simulation.settings.length))}
      {apps.unavailable
        ? tabButton("apps", "Apps", "Needs setup", true)
        : tabButton("apps", "Apps", String(countApps(apps)))}
    </div>
  );
  return tab === "apps" ? (
    <AppsPeek
      simulation={simulation}
      focus={appsFocus}
      tabs={tabs}
      onExport={onExportApps}
      showAvailable={showAvailableApps}
      onShowAvailableChange={onShowAvailableAppsChange}
    />
  ) : (
    <BaselinePeek simulation={simulation} onOpen={onOpenBaseline} tabs={tabs} />
  );
}
