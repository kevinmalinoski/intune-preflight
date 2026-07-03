import { useMemo, useState } from "react";
import type { Platform, SimulationResult } from "@intune-preflight/shared";
import { api } from "./api.ts";

type ViewFilter = "all" | "conflicts" | "overlaps";

type DisplayRow =
  | { kind: "normal"; settingId: string; cspArea: string; displayName: string; value: string; sourcePolicyName: string }
  | { kind: "conflict"; settingId: string; cspArea: string; displayName: string; values: { value: string; sourcePolicyName: string }[] }
  | { kind: "overlap"; settingId: string; cspArea: string; displayName: string; value: string; sources: string[] };

/**
 * One display row per setting. Conflicts (genuine value disagreements) stay
 * expanded so both sides are visible. Overlaps (same value across multiple
 * policies) collapse into a single row that can be expanded to reveal the
 * overlapping policies -- otherwise a layered baseline drowns the table in
 * redundant rows.
 */
function buildRows(simulation: SimulationResult): DisplayRow[] {
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));
  const overlapsBySettingId = new Map(simulation.overlaps.map((o) => [o.settingId, o]));
  const rows: DisplayRow[] = [];

  for (const s of simulation.settings) {
    const conflict = conflictsBySettingId.get(s.settingId);
    if (conflict) {
      rows.push({
        kind: "conflict",
        settingId: s.settingId,
        cspArea: conflict.cspArea,
        displayName: conflict.displayName,
        values: conflict.values.map((v) => ({ value: v.value, sourcePolicyName: v.sourcePolicyName })),
      });
      continue;
    }
    const overlap = overlapsBySettingId.get(s.settingId);
    if (overlap) {
      rows.push({
        kind: "overlap",
        settingId: s.settingId,
        cspArea: overlap.cspArea,
        displayName: overlap.displayName,
        value: overlap.value,
        sources: overlap.sourcePolicies.map((sp) => sp.sourcePolicyName),
      });
      continue;
    }
    rows.push({
      kind: "normal",
      settingId: s.settingId,
      cspArea: s.cspArea,
      displayName: s.displayName,
      value: s.value,
      sourcePolicyName: s.sourcePolicyName,
    });
  }
  return rows;
}

function rowMatchesText(row: DisplayRow, needle: string): boolean {
  const hay = [row.cspArea, row.displayName];
  if (row.kind === "normal") hay.push(row.sourcePolicyName, row.value);
  if (row.kind === "conflict") for (const v of row.values) hay.push(v.value, v.sourcePolicyName);
  if (row.kind === "overlap") hay.push(row.value, ...row.sources);
  return hay.some((h) => h.toLowerCase().includes(needle));
}

export function SimulationBaselinePanel({
  simulation,
  groupIds,
  platform,
  deviceFilterIds,
  onClose,
}: {
  simulation: SimulationResult;
  groupIds: string[];
  platform: Platform;
  deviceFilterIds?: string[];
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const [expandedOverlaps, setExpandedOverlaps] = useState<Set<string>>(new Set());

  const toggleOverlap = (id: string) =>
    setExpandedOverlaps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const allRows = useMemo(() => buildRows(simulation), [simulation]);
  const needle = filter.toLowerCase();
  const rows = allRows.filter(
    (r) =>
      (view === "all" || (view === "conflicts" && r.kind === "conflict") || (view === "overlaps" && r.kind === "overlap")) &&
      (!filter || rowMatchesText(r, needle))
  );

  const renderRow = (r: DisplayRow) => {
    if (r.kind === "normal") {
      return [
        <tr key={r.settingId} className="border-t border-ink-800">
          <td className="px-3 py-2 text-slate-400">{r.cspArea}</td>
          <td className="px-3 py-2 text-slate-200">{r.displayName}</td>
          <td className="max-w-[12rem] truncate px-3 py-2 text-slate-300" title={r.value}>
            {r.value}
          </td>
          <td className="px-3 py-2 text-slate-400">{r.sourcePolicyName}</td>
        </tr>,
      ];
    }
    if (r.kind === "conflict") {
      return r.values.map((v, i) => (
        <tr key={`${r.settingId}-c-${i}`} className="border-t border-ink-800 bg-amber-500/10">
          <td className="px-3 py-2 text-slate-400">{i === 0 ? r.cspArea : ""}</td>
          <td className="px-3 py-2 text-slate-200">{i === 0 ? r.displayName : ""}</td>
          <td className="max-w-[12rem] truncate px-3 py-2 text-slate-300" title={v.value}>
            {v.value}
          </td>
          <td className="px-3 py-2 text-slate-400">
            {v.sourcePolicyName}
            <span className="ml-1.5 text-amber-400">⚠</span>
          </td>
        </tr>
      ));
    }
    // overlap -- collapsible
    const isExpanded = expandedOverlaps.has(r.settingId);
    const out = [
      <tr
        key={`${r.settingId}-o`}
        className="cursor-pointer border-t border-ink-800 bg-sky-500/10 hover:bg-sky-500/15"
        onClick={() => toggleOverlap(r.settingId)}
      >
        <td className="px-3 py-2 text-slate-400">{r.cspArea}</td>
        <td className="px-3 py-2 text-slate-200">{r.displayName}</td>
        <td className="max-w-[12rem] truncate px-3 py-2 text-slate-300" title={r.value}>
          {r.value}
        </td>
        <td className="px-3 py-2 text-sky-300">
          <span className="mr-1 inline-block w-3 text-sky-400">{isExpanded ? "▾" : "▸"}</span>
          {r.sources.length} policies
          <span className="ml-1.5 text-sky-400">⇄</span>
        </td>
      </tr>,
    ];
    if (isExpanded) {
      r.sources.forEach((src, i) => {
        out.push(
          <tr key={`${r.settingId}-o-${i}`} className="border-t border-ink-800/50 bg-sky-500/[0.04]">
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5" />
            <td className="px-3 py-1.5 text-[11px] text-slate-500">same value</td>
            <td className="px-3 py-1.5 pl-8 text-slate-400">{src}</td>
          </tr>
        );
      });
    }
    return out;
  };

  return (
    <div className="fixed inset-y-0 right-0 z-20 flex w-full max-w-xl flex-col border-l border-ink-700 bg-ink-900 shadow-2xl">
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
            {" · "}
            <span className={simulation.overlaps.length ? "text-sky-400" : "text-emerald-400"}>
              {simulation.overlaps.length} overlaps
            </span>
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
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-400 hover:bg-ink-800 hover:text-slate-200">
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
                    <span className="text-slate-500"> — excluded via device filter "{p.excludedByFilter.filterName}"</span>
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
          <option value="overlaps" disabled={simulation.overlaps.length === 0}>
            Policy overlap only ({simulation.overlaps.length})
          </option>
        </select>
        <a
          href={api.simulateExportUrl(groupIds, platform, deviceFilterIds, "json")}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
        >
          Export JSON
        </a>
        <a
          href={api.simulateExportUrl(groupIds, platform, deviceFilterIds, "csv")}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
        >
          Export CSV
        </a>
      </div>

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-ink-900 text-slate-400">
            <tr>
              <th className="px-3 py-2 font-medium">CSP Area</th>
              <th className="px-3 py-2 font-medium">Setting</th>
              <th className="px-3 py-2 font-medium">Value</th>
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {rows.flatMap(renderRow)}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No settings match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
