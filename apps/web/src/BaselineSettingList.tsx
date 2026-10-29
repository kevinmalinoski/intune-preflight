import { useMemo, useState } from "react";
import { resolutionRuleDetail, resolutionRuleLabel } from "@intune-preflight/shared";
import { toggled } from "./collections.ts";
import { cspRef, isLegacyRow, type DisplayRow } from "./baselineRow.ts";
import { CspRef } from "./CspRef.tsx";

/**
 * The merged baseline for a narrow window: the same rows the desktop data grid
 * renders, grouped into collapsed CSP areas instead of laid out in five fixed
 * columns.
 *
 * The grid is `tableLayout: fixed` at ~1080px with drag-resize handles, which
 * on a phone is a horizontal scroll with no good answer. Grouping on the column
 * that already exists turns a tenant's 90-odd settings into a few dozen rows
 * you can actually scan, and the counts and badges on each header mean the
 * things worth finding -- a conflict, a legacy policy -- are visible without
 * opening anything.
 *
 * It takes rows rather than a simulation on purpose: the filter, the view
 * selector and the scope have already been applied by the panel, so the two
 * presentations cannot disagree about what is on screen. See `DisplayRow`.
 */
export function BaselineSettingList({ rows }: { rows: DisplayRow[] }) {
  // Group in row order, which the engine now sorts by CSP area A-Z -- so the
  // areas come out alphabetical here, in the grid and in the exports without
  // any of the three sorting for itself. See mergeSettings.
  const areas = useMemo(() => {
    const byArea = new Map<string, DisplayRow[]>();
    for (const row of rows) {
      const area = row.cspArea || "Other";
      const bucket = byArea.get(area);
      if (bucket) bucket.push(row);
      else byArea.set(area, [row]);
    }
    return [...byArea].map(([area, areaRows]) => ({
      area,
      rows: areaRows,
      conflicts: areaRows.filter((r) => r.kind === "conflict").length,
      layered: areaRows.filter((r) => r.kind === "layered").length,
      overlaps: areaRows.filter((r) => r.kind === "overlap").length,
      legacy: areaRows.some(isLegacyRow),
    }));
  }, [rows]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  // A search or a view filter has already narrowed this to what was asked for,
  // so collapsing everything would hide the answer. One area left means the
  // choice has been made for you.
  const singleArea = areas.length === 1;

  if (areas.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-slate-500">No settings match.</div>;
  }

  return (
    <div>
      {areas.map(({ area, rows: areaRows, conflicts, layered, overlaps, legacy }) => {
        const isOpen = singleArea || open.has(area);
        return (
          <div key={area}>
            <button
              onClick={() => setOpen(toggled(area))}
              aria-expanded={isOpen}
              className={`flex w-full items-center gap-2.5 border-b border-ink-800 px-4 py-3 text-left transition-colors hover:bg-ink-800/60 ${
                isOpen ? "bg-ink-800/40" : ""
              }`}
            >
              <span className={`shrink-0 text-[10px] text-slate-600 transition-transform ${isOpen ? "rotate-90" : ""}`}>
                ▶
              </span>
              {/* `break-words`: a CSP area is sometimes one unbroken token
                  (chromeintunev141~policy~googlechrome~activedirectory), which
                  otherwise runs straight through the badges and the count. */}
              <span className="min-w-0 flex-1 break-words text-xs font-semibold text-slate-100">{area}</span>
              {conflicts > 0 && (
                <span
                  className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-semibold leading-none text-amber-200"
                  title={`${conflicts} setting${conflicts === 1 ? "" : "s"} configured to different values by different policies`}
                >
                  {conflicts} conflict{conflicts === 1 ? "" : "s"}
                </span>
              )}
              {layered > 0 && (
                <span
                  className="shrink-0 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[9px] font-semibold leading-none text-indigo-300"
                  title={`${layered} setting${layered === 1 ? "" : "s"} configured differently by more than one policy, where the policy type resolves that under a documented rule rather than refusing to apply anything — so not conflicts`}
                >
                  {layered} layered
                </span>
              )}
              {overlaps > 0 && (
                <span
                  className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[9px] font-semibold leading-none text-sky-300"
                  title={`${overlaps} setting${overlaps === 1 ? "" : "s"} configured to the same value by more than one policy`}
                >
                  {overlaps} overlap{overlaps === 1 ? "" : "s"}
                </span>
              )}
              {legacy && (
                <span
                  className="shrink-0 rounded-full bg-rose-500/15 px-2 py-0.5 text-[9px] font-semibold leading-none text-rose-300"
                  title="At least one setting here comes from a legacy Endpoint Security (intents) policy."
                >
                  legacy
                </span>
              )}
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{areaRows.length}</span>
            </button>
            {isOpen && areaRows.map((row) => <SettingCard key={`${row.settingId}-${row.kind}`} row={row} />)}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One setting as a stack of lines rather than a row of cells. The five grid
 * columns map onto it exactly: CSP Area is the accordion header above (so it
 * stops repeating on every row), Setting and its badges are line one, Value and
 * Source are line two, and the CSP path wraps underneath.
 */
function SettingCard({ row }: { row: DisplayRow }) {
  const [showPath, setShowPath] = useState(false);
  const reference = cspRef(row);

  return (
    <div
      className={`border-b border-ink-800 bg-ink-950/40 py-2.5 pl-9 pr-4 ${
        row.kind === "conflict" ? "border-l-2 border-l-amber-400/70 bg-amber-500/[0.04]" : ""
      } ${row.kind === "layered" ? "border-l-2 border-l-indigo-400/70 bg-indigo-500/[0.04]" : ""}`}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-xs font-medium leading-snug text-slate-100">{row.displayName}</span>
        {row.kind === "conflict" && (
          <span
            className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-amber-200"
            title="More than one applied policy sets this setting, to different values. Which one a device ends up with is resolved on the device — this tool doesn't predict it."
          >
            conflict
          </span>
        )}
        {row.kind === "layered" && (
          <span
            className="shrink-0 rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-indigo-300"
            title={resolutionRuleDetail(row.rule)}
          >
            {resolutionRuleLabel(row.rule)}
          </span>
        )}
        {row.kind === "overlap" && (
          <span className="shrink-0 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold leading-none text-sky-300">
            overlap {row.sources.length}
          </span>
        )}
        {row.kind === "normal" && row.sourceLegacyTemplate && (
          <span
            className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] leading-none text-amber-300"
            title="Legacy device-configuration template — Microsoft is migrating these to the Settings Catalog."
          >
            legacy template
          </span>
        )}
      </div>

      {row.kind === "conflict" || row.kind === "layered" ? (
        // Every value is rendered identically and NONE is marked as the one
        // that applies. The merge computes no winner -- it keeps the first
        // contributing policy the tenant load happened to reach, which
        // `BaselineSetting.conflicted` / `.layered` exist to say out loud -- and
        // the desktop grid has always drawn these as equal sibling rows for the
        // same reason.
        //
        // An earlier version of this card ranked them WINS/ALSO. That invented
        // a resolution the tool does not model, and it is not merely unearned:
        // where a policy type doesn't resolve by one policy overriding another
        // -- Feature Update profiles turned out to be exactly that case -- naming
        // a winner is advice an admin could act on and be wrong. Emerald is
        // reserved for a settled value on purpose; neither kind has got one.
        //
        // A layered row renders the same way for the same reason. Its badge
        // names the documented rule, which is the one thing that differs: the
        // device resolves this rather than refusing to apply anything. The rule
        // is still not applied here -- no value is promoted under it.
        <div className="mt-1.5 space-y-1.5">
          {row.values.map((v, i) => (
            <div key={`${v.sourcePolicyName}-${i}`} className="flex gap-2">
              <span
                className={`w-3 shrink-0 pt-0.5 text-[10px] leading-none ${
                  row.kind === "layered" ? "text-indigo-400" : "text-amber-400"
                }`}
                title={
                  row.kind === "layered"
                    ? resolutionRuleDetail(row.rule)
                    : "This policy sets the setting to a different value."
                }
                aria-hidden
              >
                {row.kind === "layered" ? "⧫" : "⚠"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-xs font-semibold text-slate-200">{v.value}</span>
                <span className="mt-0.5 block break-words text-[11px] leading-snug text-slate-500">
                  {v.sourcePolicyName}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-[11px] leading-snug">
          <span className="font-semibold text-emerald-300">{row.value}</span>
          <span className="text-slate-500">
            {" · "}
            {row.kind === "overlap" ? row.sources.join(" · ") : row.sourcePolicyName}
          </span>
        </div>
      )}

      {/* The CSP path is the longest thing here and the least often wanted, so
          it is one tap away rather than wrapping across four lines by default. */}
      <button
        onClick={() => setShowPath((v) => !v)}
        aria-expanded={showPath}
        className="mt-1.5 text-[10px] text-slate-600 transition-colors hover:text-slate-400"
      >
        {showPath ? "hide path" : "CSP path"}
      </button>
      {showPath && (
        <div className="mt-1 border-l border-ink-700 pl-2">
          <CspRef refValue={reference} docUrl={row.docUrl} />
        </div>
      )}
    </div>
  );
}
