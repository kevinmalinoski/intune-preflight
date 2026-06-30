import { useMemo, useState } from "react";
import type { BaselineSetting, Platform, SimulationResult } from "@intune-baseline/shared";
import { api } from "./api.ts";

interface DisplayRow extends BaselineSetting {
  isConflict: boolean;
}

/** Expands conflicting settings into one row per disagreeing policy, instead of hiding all but the first. */
function buildRows(simulation: SimulationResult): DisplayRow[] {
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));
  const rows: DisplayRow[] = [];

  for (const s of simulation.settings) {
    const conflict = conflictsBySettingId.get(s.settingId);
    if (!conflict) {
      rows.push({ ...s, isConflict: false });
      continue;
    }
    for (const v of conflict.values) {
      rows.push({
        settingId: s.settingId,
        cspArea: conflict.cspArea,
        displayName: conflict.displayName,
        value: v.value,
        sourcePolicyId: v.sourcePolicyId,
        sourcePolicyName: v.sourcePolicyName,
        sourceKind: v.sourceKind,
        isConflict: true,
      });
    }
  }
  return rows;
}

export function SimulationBaselinePanel({
  simulation,
  groupIds,
  platform,
  deviceFilterId,
  onClose,
}: {
  simulation: SimulationResult;
  groupIds: string[];
  platform: Platform;
  deviceFilterId?: string;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [conflictsOnly, setConflictsOnly] = useState(false);

  const allRows = useMemo(() => buildRows(simulation), [simulation]);
  const rows = allRows.filter(
    (s) =>
      (!conflictsOnly || s.isConflict) &&
      (!filter ||
        s.displayName.toLowerCase().includes(filter.toLowerCase()) ||
        s.cspArea.toLowerCase().includes(filter.toLowerCase()) ||
        s.sourcePolicyName.toLowerCase().includes(filter.toLowerCase()))
  );

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
            {simulation.excludedPolicies.length > 0 && (
              <>
                {" · "}
                <span className="text-rose-400">{simulation.excludedPolicies.length} excluded</span>
              </>
            )}
          </div>
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
        <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-slate-300">
          <input
            type="checkbox"
            checked={conflictsOnly}
            onChange={(e) => setConflictsOnly(e.target.checked)}
            className="accent-amber-400"
            disabled={simulation.conflicts.length === 0}
          />
          Conflicts only
        </label>
        <a
          href={api.simulateExportUrl(groupIds, platform, deviceFilterId, "json")}
          className="rounded-md border border-ink-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
        >
          Export JSON
        </a>
        <a
          href={api.simulateExportUrl(groupIds, platform, deviceFilterId, "csv")}
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
            {rows.map((s, idx) => (
              <tr
                key={`${s.settingId}-${idx}`}
                className={`border-t border-ink-800 ${s.isConflict ? "bg-amber-500/10" : ""}`}
              >
                <td className="px-3 py-2 text-slate-400">{s.cspArea}</td>
                <td className="px-3 py-2 text-slate-200">{s.displayName}</td>
                <td className="max-w-[12rem] truncate px-3 py-2 text-slate-300" title={s.value}>
                  {s.value}
                </td>
                <td className="px-3 py-2 text-slate-400">
                  {s.sourcePolicyName}
                  {s.isConflict && <span className="ml-1.5 text-amber-400">⚠</span>}
                </td>
              </tr>
            ))}
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
