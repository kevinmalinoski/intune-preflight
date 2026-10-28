import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Platform, PolicyKind, SimulationResult } from "@intune-preflight/shared";
import { filterExclusionReason, resolutionRuleDetail, resolutionRuleLabel } from "@intune-preflight/shared";
import { api } from "./api.ts";
import { BaselineSettingList } from "./BaselineSettingList.tsx";
import { buildRows, cspRef, isLegacyRow, type DisplayRow } from "./baselineRow.ts";
import { CspRef } from "./CspRef.tsx";
import { saveDownload } from "./download.ts";
import { readStored, readStoredJson, writeStored } from "./storage.ts";
import { toggled } from "./collections.ts";
import { isCompact, subscribeLayout } from "./viewport.ts";

type ViewFilter = "all" | "conflicts" | "layered" | "overlaps" | "legacy" | "collision";

// Render the table in chunks: a 150+ policy tenant can produce thousands of
// setting rows, and mounting them all at once visibly stalls the panel. Chunks
// (with a "Show more" row) avoid that without a virtualization library, which
// would fight this table's variable-height row groups (conflict rows expand to
// one row per value, overlaps expand on click).
const ROW_RENDER_CHUNK = 300;

// The table is a small data grid: fixed layout driven by a column model, with
// per-column drag-resize and an Intune-style column picker. Widths and hidden
// columns persist per browser. "Setting" is the anchor column and can't hide.
type ColumnId = "cspArea" | "setting" | "value" | "source" | "cspPath";

const COLUMN_DEFS: { id: ColumnId; label: string; width: number; min: number; hideable: boolean }[] = [
  { id: "cspArea", label: "CSP Area", width: 150, min: 90, hideable: true },
  { id: "setting", label: "Setting", width: 230, min: 120, hideable: false },
  { id: "value", label: "Value", width: 170, min: 90, hideable: true },
  { id: "source", label: "Source", width: 190, min: 100, hideable: true },
  { id: "cspPath", label: "CSP path", width: 340, min: 140, hideable: true },
];

const COL_WIDTHS_KEY = "baselineColWidths";
const HIDDEN_COLS_KEY = "baselineHiddenCols";
const DEFAULT_WIDTHS = Object.fromEntries(COLUMN_DEFS.map((c) => [c.id, c.width])) as Record<ColumnId, number>;

/** Restrict the baseline panel to one policy type, or one policy. */
export type BaselineScope = { kind: PolicyKind; label: string } | { policyId: string; label: string };

/** Narrow a simulation's settings to the scope so buildRows only shows those rows. */
function applyScope(simulation: SimulationResult, scope: BaselineScope | null | undefined): SimulationResult {
  if (!scope) return simulation;
  if ("kind" in scope) {
    return { ...simulation, settings: simulation.settings.filter((s) => s.sourceKind === scope.kind) };
  }
  const pid = scope.policyId;
  // Include settings this policy won, plus any conflict/layered/overlap finding
  // it takes part in (where another policy's value won the merge) so its full
  // involvement shows.
  const involved = new Set<string>();
  for (const c of simulation.conflicts) if (c.values.some((v) => v.sourcePolicyId === pid)) involved.add(c.settingId);
  for (const l of simulation.layered) if (l.values.some((v) => v.sourcePolicyId === pid)) involved.add(l.settingId);
  for (const o of simulation.overlaps)
    if (o.sourcePolicies.some((sp) => sp.sourcePolicyId === pid)) involved.add(o.settingId);
  return {
    ...simulation,
    settings: simulation.settings.filter((s) => s.sourcePolicyId === pid || involved.has(s.settingId)),
  };
}

function rowMatchesText(row: DisplayRow, needle: string): boolean {
  const hay = [row.cspArea, row.displayName];
  if (row.kind === "normal") hay.push(row.sourcePolicyName, row.value);
  if (row.kind === "conflict" || row.kind === "layered")
    for (const v of row.values) hay.push(v.value, v.sourcePolicyName);
  if (row.kind === "layered") hay.push(resolutionRuleLabel(row.rule));
  if (row.kind === "overlap") hay.push(row.value, ...row.sources);
  return hay.some((h) => h.toLowerCase().includes(needle));
}

export function SimulationBaselinePanel({
  simulation,
  groupIds,
  platform,
  deviceFilterIds,
  unassignedPolicyIds,
  scope,
  onClearScope,
  onClose,
}: {
  simulation: SimulationResult;
  groupIds: string[];
  platform: Platform;
  deviceFilterIds?: string[];
  unassignedPolicyIds?: string[];
  scope?: BaselineScope | null;
  onClearScope?: () => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  // Live, not read-once: resizing the window has to swap the renderer, because
  // the two are different DOM for the same rows rather than a different state.
  const compact = useSyncExternalStore(subscribeLayout, isCompact, () => false);

  // Built here, in the click, with nothing awaited before `saveDownload` -- iOS
  // only opens the share sheet inside the click's own task. The export always
  // covers the WHOLE baseline, never the on-screen filter or scope; that is what
  // the "filters and exports always cover everything" row promises.
  const exportBaseline = (format: "json" | "csv") =>
    saveDownload(
      api.simulateExport({ groupIds, platform, deviceFilterIds, unassignedPolicyIds }, format),
      `endpoint-baseline.${format}`
    );
  const [expandedOverlaps, setExpandedOverlaps] = useState<Set<string>>(new Set());

  // Resizable panel width (docked to the right edge, so width = viewport - cursorX).
  // Persisted so it stays where the user left it.
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(readStored("baselinePanelWidth"));
    return saved >= 380 ? saved : 720;
  });
  useEffect(() => {
    writeStored("baselinePanelWidth", String(Math.round(width)));
  }, [width]);

  // Escape backs out one level: a drill-down scope first (so you return to the
  // full baseline rather than losing the panel), then the panel itself. Same
  // behaviour as the group policy list's Escape, which this panel was missing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Optional handler: with no way to clear the scope, Escape just closes.
      if (scope && onClearScope) onClearScope();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scope, onClearScope, onClose]);

  // Move focus into the panel when it opens and hand it back to whatever opened
  // it on close -- the "View merged baseline" button, or a node in the diagram.
  // Without this, opening the panel left focus behind it and closing it dropped
  // focus to the document, so a keyboard user had to tab in from the top of the
  // page again.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      // The opener can be gone by now (a diagram node that re-rendered), in
      // which case focus just stays where the browser put it.
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(Math.max(window.innerWidth - ev.clientX, 380), window.innerWidth - 80);
      setWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const toggleOverlap = (id: string) => setExpandedOverlaps(toggled(id));

  const scoped = useMemo(() => applyScope(simulation, scope), [simulation, scope]);
  const allRows = useMemo(() => buildRows(scoped), [scoped]);
  // Count of settings ANY of whose contributing policies is a legacy Endpoint
  // Security (intents) policy, for the "Legacy policies" view option. Counted
  // off the unscoped rows -- like the conflict/overlap counts shown alongside it
  // -- and via the same `sourceKinds` the view filters on, so the number in the
  // dropdown can't disagree with the rows it selects.
  const legacyCount = useMemo(() => buildRows(simulation).filter(isLegacyRow).length, [simulation]);
  const needle = filter.toLowerCase();
  const rows = allRows.filter(
    (r) =>
      (view === "all" ||
        (view === "conflicts" && r.kind === "conflict") ||
        (view === "layered" && r.kind === "layered") ||
        (view === "overlaps" && r.kind === "overlap") ||
        (view === "legacy" && isLegacyRow(r))) &&
      (!filter || rowMatchesText(r, needle))
  );

  // Chunked rendering (see ROW_RENDER_CHUNK). Filtering/search always runs over
  // the FULL row set above -- only the DOM is chunked -- and exports are
  // server-side, so nothing is ever missing from them.
  const [renderLimit, setRenderLimit] = useState(ROW_RENDER_CHUNK);
  useEffect(() => {
    setRenderLimit(ROW_RENDER_CHUNK);
  }, [filter, view, scope]);
  const visibleRows = rows.slice(0, renderLimit);
  const remaining = rows.length - visibleRows.length;

  // --- Column layout: persisted widths + hidden set, drag-resize, picker ---
  const [colWidths, setColWidths] = useState<Record<ColumnId, number>>(() => ({
    ...DEFAULT_WIDTHS,
    ...readStoredJson<Partial<Record<ColumnId, number>>>(COL_WIDTHS_KEY, {}),
  }));
  const [hiddenCols, setHiddenCols] = useState<Set<ColumnId>>(
    () => new Set(readStoredJson<ColumnId[]>(HIDDEN_COLS_KEY, []))
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  useEffect(() => {
    writeStored(COL_WIDTHS_KEY, JSON.stringify(colWidths));
  }, [colWidths]);
  useEffect(() => {
    writeStored(HIDDEN_COLS_KEY, JSON.stringify([...hiddenCols]));
  }, [hiddenCols]);

  const visibleDefs = COLUMN_DEFS.filter((d) => !hiddenCols.has(d.id));
  const totalWidth = visibleDefs.reduce((sum, d) => sum + colWidths[d.id], 0);

  const startColResize = (id: ColumnId) => (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[id];
    const min = COLUMN_DEFS.find((d) => d.id === id)?.min ?? 80;
    const onMove = (ev: MouseEvent) => {
      setColWidths((prev) => ({ ...prev, [id]: Math.min(Math.max(startW + ev.clientX - startX, min), 900) }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const toggleCol = (id: ColumnId) => setHiddenCols(toggled(id));

  const resetLayout = () => {
    setColWidths({ ...DEFAULT_WIDTHS });
    setHiddenCols(new Set());
  };

  /** One cell, rendered only when its column is visible -- rows stay in sync with the colgroup. */
  const cell = (id: ColumnId, cls: string, content: ReactNode) =>
    hiddenCols.has(id) ? null : (
      <td key={id} className={cls}>
        {content}
      </td>
    );

  /**
   * A layered setting: the same row shape as a conflict -- one row per
   * contributing value, none of them marked as the one that applies -- because
   * it is the same disagreement. Indigo rather than amber, and a rule badge in
   * place of the ⚠, because the reading differs: the device resolves this under
   * a documented rule, it isn't stuck on it.
   *
   * Nothing here ranks the values or applies the rule. Naming a winner is what
   * started all this; see LayeredSetting in the shared types.
   */
  const renderLayered = (r: Extract<DisplayRow, { kind: "layered" }>) =>
    r.values.map((v, i) => (
      <tr key={`${r.settingId}-l-${i}`} className="border-t border-ink-800 bg-indigo-500/10">
        {cell("cspArea", "px-3 py-2 align-top text-slate-400", i === 0 ? r.cspArea : "")}
        {cell(
          "setting",
          "px-3 py-2 align-top text-slate-200",
          i === 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              {r.displayName}
              <span
                className="rounded bg-indigo-500/20 px-1 py-0.5 text-[9px] font-medium text-indigo-300"
                title={resolutionRuleDetail(r.rule)}
              >
                {resolutionRuleLabel(r.rule)}
              </span>
            </span>
          ) : (
            ""
          )
        )}
        {cell("value", "truncate px-3 py-2 align-top text-slate-300", <span title={v.value}>{v.value}</span>)}
        {cell(
          "source",
          "px-3 py-2 align-top text-slate-400",
          <>
            {v.sourcePolicyName}
            <span className="ml-1.5 text-indigo-400" title={resolutionRuleDetail(r.rule)}>
              ⧫
            </span>
          </>
        )}
        {cell("cspPath", "px-3 py-2 align-top", i === 0 ? <CspRef refValue={cspRef(r)} docUrl={r.docUrl} /> : "")}
      </tr>
    ));

  const renderRow = (r: DisplayRow) => {
    if (r.kind === "normal") {
      return [
        <tr key={r.settingId} className="border-t border-ink-800">
          {cell("cspArea", "px-3 py-2 align-top text-slate-400", r.cspArea)}
          {cell("setting", "px-3 py-2 align-top text-slate-200", r.displayName)}
          {cell("value", "truncate px-3 py-2 align-top text-slate-300", <span title={r.value}>{r.value}</span>)}
          {cell(
            "source",
            "px-3 py-2 align-top text-slate-400",
            <span className="inline-flex flex-wrap items-center gap-1">
              {r.sourcePolicyName}
              {r.sourceLegacyTemplate && (
                <span
                  className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-300"
                  title="Legacy device-config template — Microsoft recommends migrating to the Settings Catalog. Its settings also aren't cross-detected for conflicts/overlaps against Settings Catalog policies."
                >
                  Legacy
                </span>
              )}
            </span>
          )}
          {cell("cspPath", "px-3 py-2 align-top", <CspRef refValue={cspRef(r)} docUrl={r.docUrl} />)}
        </tr>,
      ];
    }
    if (r.kind === "conflict") {
      return r.values.map((v, i) => (
        <tr key={`${r.settingId}-c-${i}`} className="border-t border-ink-800 bg-amber-500/10">
          {cell("cspArea", "px-3 py-2 align-top text-slate-400", i === 0 ? r.cspArea : "")}
          {cell("setting", "px-3 py-2 align-top text-slate-200", i === 0 ? r.displayName : "")}
          {cell("value", "truncate px-3 py-2 align-top text-slate-300", <span title={v.value}>{v.value}</span>)}
          {cell(
            "source",
            "px-3 py-2 align-top text-slate-400",
            <>
              {v.sourcePolicyName}
              <span className="ml-1.5 text-amber-400">⚠</span>
            </>
          )}
          {cell("cspPath", "px-3 py-2 align-top", i === 0 ? <CspRef refValue={cspRef(r)} docUrl={r.docUrl} /> : "")}
        </tr>
      ));
    }
    if (r.kind === "layered") return renderLayered(r);
    // overlap -- collapsible
    const isExpanded = expandedOverlaps.has(r.settingId);
    const out = [
      <tr
        key={`${r.settingId}-o`}
        className="cursor-pointer border-t border-ink-800 bg-sky-500/10 hover:bg-sky-500/15"
        onClick={() => toggleOverlap(r.settingId)}
      >
        {cell("cspArea", "px-3 py-2 align-top text-slate-400", r.cspArea)}
        {cell("setting", "px-3 py-2 align-top text-slate-200", r.displayName)}
        {cell("value", "truncate px-3 py-2 align-top text-slate-300", <span title={r.value}>{r.value}</span>)}
        {cell(
          "source",
          "px-3 py-2 align-top text-sky-300",
          <>
            <span className="mr-1 inline-block w-3 text-sky-400">{isExpanded ? "▾" : "▸"}</span>
            {r.sources.length} policies
            <span className="ml-1.5 text-sky-400">⇄</span>
          </>
        )}
        {cell("cspPath", "px-3 py-2 align-top", <CspRef refValue={cspRef(r)} docUrl={r.docUrl} />)}
      </tr>,
    ];
    if (isExpanded) {
      r.sources.forEach((src, i) => {
        out.push(
          <tr key={`${r.settingId}-o-${i}`} className="border-t border-ink-800/50 bg-sky-500/[0.04]">
            {cell("cspArea", "px-3 py-1.5", "")}
            {cell("setting", "px-3 py-1.5", "")}
            {cell("value", "px-3 py-1.5 text-[11px] text-slate-500", "same value")}
            {cell("source", "px-3 py-1.5 pl-8 text-slate-400", src)}
            {cell("cspPath", "px-3 py-1.5", "")}
          </tr>
        );
      });
    }
    return out;
  };

  // Legacy-collision rows (view === "collision"): each cross-model finding is a
  // group of one row per policy that targets the same CSP through a different model.
  const collisionFindings =
    view === "collision"
      ? simulation.crossModel.filter(
          (f) =>
            !needle ||
            f.cspNode.includes(needle) ||
            f.displayName.toLowerCase().includes(needle) ||
            f.entries.some(
              (e) => e.sourcePolicyName.toLowerCase().includes(needle) || e.value.toLowerCase().includes(needle)
            )
        )
      : [];

  const renderCollision = (f: SimulationResult["crossModel"][number]) => {
    const badge =
      f.agreement === "differs"
        ? { t: "conflict", c: "bg-rose-500/20 text-rose-300" }
        : f.agreement === "same"
          ? { t: "duplicate", c: "bg-sky-500/20 text-sky-300" }
          : { t: "verify", c: "bg-slate-500/20 text-slate-300" };
    const bg = f.agreement === "differs" ? "bg-rose-500/10" : "bg-amber-500/10";
    return f.entries.map((e, i) => (
      <tr key={`${f.cspNode}-${i}`} className={`border-t border-ink-800 ${bg}`}>
        {cell(
          "cspArea",
          "px-3 py-2 align-top",
          i === 0 ? <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${badge.c}`}>{badge.t}</span> : ""
        )}
        {cell("setting", "px-3 py-2 align-top text-slate-200", i === 0 ? f.displayName : "")}
        {cell("value", "truncate px-3 py-2 align-top text-slate-300", <span title={e.value}>{e.value}</span>)}
        {cell(
          "source",
          "px-3 py-2 align-top text-slate-400",
          <span className="inline-flex flex-wrap items-center gap-1">
            {e.sourcePolicyName}
            {e.sourceLegacyTemplate && (
              <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[9px] text-amber-300">Legacy</span>
            )}
          </span>
        )}
        {cell(
          "cspPath",
          "px-3 py-2 align-top",
          i === 0 ? <span className="break-all font-mono text-[11px] text-slate-400">{f.cspNode}</span> : ""
        )}
      </tr>
    ));
  };

  return (
    // A docked side panel rather than a screen-covering modal -- the diagram
    // stays visible and usable beside it -- so it's a focusable `dialog` WITHOUT
    // aria-modal, which would tell a screen reader the rest of the page is
    // inert when it isn't.
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Merged baseline"
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-20 flex max-w-full flex-col border-l border-ink-700 bg-ink-900 shadow-2xl outline-none"
      style={{ width }}
    >
      {/* Drag handle on the left edge to resize the panel */}
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        // Mouse-only, and below `lg` the panel is the full width of the window
        // anyway -- so there is nothing to drag and nowhere to drag it to.
        className="group absolute inset-y-0 left-0 z-30 hidden w-1.5 cursor-col-resize hover:bg-sky-500/40 active:bg-sky-500/60 lg:block"
      >
        <div className="absolute inset-y-0 -left-1 w-3" />
      </div>
      <div className="flex items-start justify-between border-b border-ink-700 p-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Endpoint baseline</div>
          <h2 className="text-lg font-semibold text-slate-100">
            {simulation.groups.length} groups · {simulation.policies.length} policies applied
          </h2>
          <div className="mt-1 text-xs text-slate-400">
            {simulation.settings.length} merged settings ·{" "}
            <span className={simulation.conflicts.length ? "text-amber-400" : "text-emerald-400"}>
              {simulation.conflicts.length} conflicts
            </span>
            {simulation.layered.length > 0 && (
              <>
                {" · "}
                <span
                  className="text-indigo-300"
                  title="Settings more than one policy configures differently, where the policy type resolves that under a documented rule rather than refusing to apply anything — so not conflicts."
                >
                  {simulation.layered.length} layered
                </span>
              </>
            )}
            {" · "}
            <span className={simulation.overlaps.length ? "text-sky-400" : "text-emerald-400"}>
              {simulation.overlaps.length} overlaps
            </span>
            {simulation.crossModel.length > 0 && (
              <>
                {" · "}
                <span className="text-amber-400">
                  {simulation.crossModel.length} legacy collision{simulation.crossModel.length > 1 ? "s" : ""}
                </span>
              </>
            )}
            {simulation.excludedPolicies.length > 0 && (
              <>
                {" · "}
                <span className="text-rose-400">{simulation.excludedPolicies.length} excluded</span>
              </>
            )}
          </div>
          {platform !== "windows" && (
            <div className="mt-1 text-[11px] text-slate-500">Overlap detection is Windows-only for now.</div>
          )}
          {simulation.crossModel.length > 0 && (
            <div className="mt-1.5 text-[11px] text-amber-300/90">
              ⚠ {simulation.crossModel.length} legacy policy collision{simulation.crossModel.length > 1 ? "s" : ""} — a
              legacy template that targets the same CSP as the Settings Catalog can reflect the setting using opposite
              vocabulary. Update your legacy policies to the Settings Catalog to participate in conflict/overlap
              detection.{" "}
              <button
                onClick={() => setView("collision")}
                className="underline decoration-amber-400/50 hover:text-amber-200"
              >
                Review
              </button>{" "}
              <span className="text-amber-300/60">· best-effort</span>
            </div>
          )}
          {scope && (
            <div className="mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
                <span className="text-sky-400">{"kind" in scope ? "Type" : "Policy"}:</span>
                <span className="max-w-[16rem] truncate font-medium">{scope.label}</span>
                <span className="text-sky-300/70">· {scoped.settings.length} settings</span>
                <button
                  onClick={onClearScope}
                  title="Show the whole baseline"
                  className="ml-0.5 rounded px-1 text-sky-300 hover:bg-sky-500/20"
                >
                  ✕
                </button>
              </span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close the merged baseline"
          title="Close (Esc)"
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-ink-800 hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      {simulation.excludedPolicies.length > 0 && (
        <div className="border-b border-ink-700 bg-rose-500/5 p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-rose-300">
            Excluded for this selection
          </div>
          <ul className="space-y-1">
            {simulation.excludedPolicies.map((p) => {
              const excludingGroups = p.excludedViaGroupIds
                .map((id) => simulation.groups.find((g) => g.id === id)?.displayName ?? id)
                .join(", ");
              return (
                <li key={p.id} className="text-xs text-slate-300">
                  <span className="font-medium text-rose-300">{p.displayName}</span>
                  {p.excludedByFilter ? (
                    <span className="text-slate-500">
                      {" — "}
                      {filterExclusionReason(p.excludedByFilter.filterName, p.excludedByFilter.filterType)}
                      {p.excludedByFilter.filterType === "include" && (
                        <span className="text-slate-600"> (select it under Device Filters to simulate a match)</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-slate-500"> — excluded via {excludingGroups}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-ink-700 p-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter settings…"
          className="flex-1 rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
        />
        <select
          value={view}
          onChange={(e) => setView(e.target.value as ViewFilter)}
          className="rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-slate-300 focus:border-emerald-400 focus:outline-none"
        >
          <option value="all">All settings</option>
          <option value="conflicts" disabled={simulation.conflicts.length === 0}>
            Conflicts only ({simulation.conflicts.length})
          </option>
          <option value="layered" disabled={simulation.layered.length === 0}>
            Layered (rule-resolved) only ({simulation.layered.length})
          </option>
          <option value="overlaps" disabled={simulation.overlaps.length === 0}>
            Policy overlap only ({simulation.overlaps.length})
          </option>
          <option value="legacy" disabled={legacyCount === 0}>
            Legacy policies only ({legacyCount})
          </option>
          <option value="collision" disabled={simulation.crossModel.length === 0}>
            Legacy collisions ({simulation.crossModel.length})
          </option>
        </select>
        {/* Buttons rather than anchors: in the browser-only builds the export is
            bytes, not a URL, and building it on click is also what stops the
            whole simulation being re-serialised on every render of this panel. */}
        <button
          onClick={() => exportBaseline("json")}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
        >
          Export JSON
        </button>
        <button
          onClick={() => exportBaseline("csv")}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
        >
          Export CSV
        </button>
        {/* Nothing to pick when there are no columns: the compact layout renders
            the baseline as cards, and every field is already on them. */}
        <div className="relative hidden lg:block">
          <button
            onClick={() => setShowColumnPicker((v) => !v)}
            title="Choose which columns to show"
            className={`rounded-md border px-3 py-1.5 text-xs ${
              showColumnPicker || hiddenCols.size > 0
                ? "border-sky-400/50 bg-sky-500/10 text-sky-300"
                : "border-ink-700 text-slate-300 hover:bg-ink-800"
            }`}
          >
            ⚙ Columns{hiddenCols.size > 0 ? ` (${visibleDefs.length}/${COLUMN_DEFS.length})` : ""}
          </button>
          {showColumnPicker && (
            <>
              {/* Click-away backdrop */}
              <div className="fixed inset-0 z-30" onClick={() => setShowColumnPicker(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-ink-700 bg-ink-900 p-2 shadow-2xl">
                <div className="mb-1 px-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Show columns
                </div>
                {COLUMN_DEFS.map((d) => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${
                      d.hideable ? "cursor-pointer text-slate-200 hover:bg-ink-800" : "cursor-default text-slate-500"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenCols.has(d.id)}
                      disabled={!d.hideable}
                      onChange={() => toggleCol(d.id)}
                      className="shrink-0 accent-emerald-400"
                    />
                    {d.label}
                    {!d.hideable && <span className="ml-auto text-[9px] uppercase text-slate-600">always</span>}
                  </label>
                ))}
                <button
                  onClick={resetLayout}
                  className="mt-1.5 w-full rounded-md border border-ink-700 px-2 py-1 text-[11px] text-slate-400 hover:bg-ink-800 hover:text-slate-200"
                >
                  Reset columns &amp; widths
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Compact: the same rows as a collapsed accordion of CSP areas. It takes
          the FULL row set rather than the chunked `visibleRows`, because a
          collapsed area renders nothing -- the accordion bounds the DOM by
          itself, and that keeps the count on each header honest. The legacy-
          collision view keeps the table either way: it has its own row shape
          and is a niche diagnostic, not something to read on a phone. */}
      {compact && view !== "collision" ? (
        <div className="flex-1 overflow-y-auto">
          <BaselineSettingList rows={rows} />
        </div>
      ) : (
        <>
          {/* Both axes scroll: fixed column widths can exceed the panel, and that's
          the point -- widen a column to read it, scroll to reach the rest. */}
          <div className="flex-1 overflow-auto">
            <table className="text-left text-xs" style={{ tableLayout: "fixed", width: totalWidth, minWidth: "100%" }}>
              <colgroup>
                {visibleDefs.map((d) => (
                  <col key={d.id} style={{ width: colWidths[d.id] }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-ink-900 text-slate-400">
                <tr>
                  {visibleDefs.map((d) => (
                    <th
                      key={d.id}
                      className="relative border-b border-ink-700 px-3 py-2 font-medium"
                      title={
                        d.id === "cspPath"
                          ? "The CSP OMA-URI path (Settings Catalog: baseUri + offsetUri), falling back to the raw setting id where no path exists. Windows CSP paths link to their Microsoft Learn reference."
                          : undefined
                      }
                    >
                      <span className="block truncate">{d.label}</span>
                      {/* Drag handle on the column's right edge */}
                      <span
                        onMouseDown={startColResize(d.id)}
                        title="Drag to resize column"
                        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize hover:bg-sky-500/50 active:bg-sky-500/70"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view === "collision" ? collisionFindings.flatMap(renderCollision) : visibleRows.flatMap(renderRow)}
                {view !== "collision" && remaining > 0 && (
                  <tr className="border-t border-ink-800">
                    <td colSpan={visibleDefs.length} className="p-0">
                      <button
                        onClick={() => setRenderLimit((n) => n + ROW_RENDER_CHUNK)}
                        className="w-full px-3 py-2.5 text-center text-xs font-medium text-sky-300 transition-colors hover:bg-ink-800"
                      >
                        Show {Math.min(ROW_RENDER_CHUNK, remaining)} more ({remaining} remaining — filters and exports
                        always cover everything)
                      </button>
                    </td>
                  </tr>
                )}
                {(view === "collision" ? collisionFindings.length === 0 : rows.length === 0) && (
                  <tr>
                    <td colSpan={visibleDefs.length} className="px-3 py-6 text-center text-slate-500">
                      {view === "collision" ? "No legacy collisions match." : "No settings match."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
