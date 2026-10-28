import { GROUP_KIND_STYLE, KIND_STYLE, type GroupRow, type PolicyDetail } from "./manifestRow.ts";

/**
 * The manifest's two row presentations: one policy line (shared with the
 * desktop table) and the compact per-group card. The report next door owns the
 * data; these only render it.
 */

/**
 * One policy in a group's expanded list. A four-column grid on a desktop; below
 * `lg` the fixed columns are dropped and the policy name is allowed to wrap
 * rather than truncate, because at phone width a truncated name is almost
 * always cut before the part that distinguishes it.
 */
export function PolicyDetailRow({
  item,
  matched,
  onToggleFilter,
}: {
  item: PolicyDetail;
  matched: Set<string>;
  onToggleFilter: (id: string) => void;
}) {
  const { row: r, inheritedFrom, implied, filteredOut } = item;
  const kind = KIND_STYLE[r.kind] ?? { label: r.kind, cls: "bg-slate-500/15 text-slate-400" };

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] lg:grid lg:grid-cols-[4rem_8.5rem_minmax(0,1fr)_auto] lg:gap-2 ${
        filteredOut ? "opacity-60" : inheritedFrom ? "opacity-70" : ""
      }`}
    >
      <span
        className={`rounded px-1 py-0.5 text-center text-[9px] font-medium uppercase ${
          filteredOut
            ? "bg-violet-500/15 text-violet-300"
            : r.assignment === "Include"
              ? "bg-emerald-500/15 text-emerald-300"
              : "bg-rose-500/15 text-rose-300"
        }`}
      >
        {filteredOut ? "Filtered" : r.assignment}
      </span>
      <span className={`justify-self-start rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ${kind.cls}`}>
        {kind.label}
      </span>
      <span
        className={`min-w-0 flex-1 break-words lg:flex-none lg:truncate ${
          filteredOut ? "text-slate-400 line-through" : "text-slate-200"
        }`}
      >
        {r.policyName}
      </span>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
        {r.legacyTemplate && (
          <span
            className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300"
            title="Legacy device-configuration template — Microsoft is migrating these to the Settings Catalog and deprecating new template creation. Consider rebuilding it as a Settings Catalog policy. Note: its settings aren't cross-detected for conflicts/overlaps against Settings Catalog policies."
          >
            Legacy template
          </span>
        )}
        {inheritedFrom && (
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] ${
              implied ? "bg-amber-500/15 text-amber-300" : "bg-slate-500/15 text-slate-400"
            }`}
            title={
              implied
                ? `Inherited via implied membership — this group's rule implies membership in "${inheritedFrom}". Best-effort; verify in Entra.`
                : `Inherited — assigned to ${inheritedFrom}, which every member of this group also belongs to`
            }
          >
            via {inheritedFrom}
            {implied ? " (implied)" : ""}
          </span>
        )}
        {r.filterId && r.filterName && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFilter(r.filterId!);
            }}
            className={`rounded px-1.5 py-0.5 text-[9px] transition-colors ${
              matched.has(r.filterId)
                ? "bg-violet-500/30 text-violet-100 ring-1 ring-violet-400/60"
                : "bg-violet-500/15 text-violet-300 hover:bg-violet-500/25"
            }`}
            title={
              r.filterType === "include"
                ? matched.has(r.filterId)
                  ? `Include filter “${r.filterName}”: the device matches it, so this policy applies. Click to simulate a non-matching device (drops it).`
                  : `Include filter “${r.filterName}”: this policy only targets devices that match it, and the simulated device doesn’t — so it isn’t applied. Click to simulate a matching device.`
                : matched.has(r.filterId)
                  ? `Exclude filter “${r.filterName}”: the device matches it, so this policy is dropped. Click to stop matching.`
                  : `Exclude filter “${r.filterName}”: this policy applies now. Click to simulate the device matching it (drops it).`
            }
          >
            ⛃ {r.filterName}
            {r.filterType ? ` (${r.filterType})` : ""}
            {matched.has(r.filterId) ? " ✓" : ""}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The manifest for a narrow window: one card per group instead of a seven-column
 * sortable table.
 *
 * Direct / Inherited / Incl-Excl become a three-up strip of tiles, which is the
 * part of the table worth keeping at this width -- those three numbers are what
 * the view is for. Sorting moves to a `<select>` in the toolbar, since there are
 * no column headers left to click; that is the one thing the table does which
 * has no card equivalent.
 */
export function ManifestGroupCards({
  groups,
  details,
  meta,
  expanded,
  onToggleExpanded,
  canSimulate,
  checked,
  onToggleChecked,
  matched,
  onToggleFilter,
  emptyMessage,
}: {
  groups: GroupRow[];
  details: Map<string, PolicyDetail[]>;
  meta: Map<string, { direct: number; inherited: number }>;
  expanded: Set<string>;
  onToggleExpanded: (groupId: string) => void;
  canSimulate: boolean;
  checked: Set<string>;
  onToggleChecked: (groupId: string) => void;
  matched: Set<string>;
  onToggleFilter: (id: string) => void;
  emptyMessage: string;
}) {
  if (groups.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-slate-500">{emptyMessage}</div>;
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.map((o) => {
        const open = expanded.has(o.groupId);
        const detail = details.get(o.groupId) ?? [];
        const { direct, inherited } = meta.get(o.groupId) ?? { direct: 0, inherited: 0 };
        const virtual = o.groupKind === "virtual";

        return (
          <div key={o.groupId} className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
            <div className="flex items-start gap-2.5 p-3">
              {canSimulate && (
                <input
                  type="checkbox"
                  checked={virtual ? true : checked.has(o.groupId)}
                  disabled={virtual}
                  onChange={() => onToggleChecked(o.groupId)}
                  title={
                    virtual
                      ? "Always applies — every device inherits All Devices / All Users, so there's nothing to select"
                      : `Add “${o.groupName}” to the device to simulate`
                  }
                  className={`mt-0.5 h-5 w-5 shrink-0 accent-sky-400 ${
                    virtual ? "cursor-not-allowed opacity-40" : "cursor-pointer"
                  }`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="break-words text-xs font-semibold leading-snug text-slate-100">{o.groupName}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${GROUP_KIND_STYLE[o.groupKind] ?? ""}`}>
                    {o.groupKind}
                  </span>
                  <span className="text-[10px] text-slate-500">{o.platforms.join(", ")}</span>
                </div>
              </div>
            </div>

            <div className="flex gap-1.5 px-3 pb-3">
              <Tile
                n={direct}
                label="Direct"
                title="Policies assigned directly to this group that apply (after Intune's exclude-wins)."
                strong
              />
              <Tile
                n={inherited}
                label="Inherited"
                title="Policies this group additionally receives from All Devices / All Users and implied memberships. Roughly the same for every group — the tenant-wide baseline."
              />
              <div
                className="flex-1 rounded-md bg-ink-800 px-1.5 py-2 text-center"
                title="Raw direct assignment edges configured in Intune (before exclude-wins)."
              >
                <div className="text-sm font-semibold tabular-nums">
                  <span className="text-emerald-300">{o.includeCount}</span>
                  <span className="text-slate-600">/</span>
                  <span className={o.excludeCount > 0 ? "text-rose-300" : "text-slate-600"}>{o.excludeCount}</span>
                </div>
                <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">Incl / Excl</div>
              </div>
            </div>

            <button
              onClick={() => onToggleExpanded(o.groupId)}
              aria-expanded={open}
              className="w-full border-t border-ink-800 px-3 py-2.5 text-left text-[11px] text-slate-400 transition-colors hover:bg-ink-800/60"
            >
              <span className="mr-1.5 text-slate-600">{open ? "▾" : "▸"}</span>
              {detail.length} polic{detail.length === 1 ? "y" : "ies"} this device would get
            </button>

            {open && (
              <div className="flex flex-col gap-2 border-t border-ink-800 bg-ink-950/40 px-3 py-2.5">
                {detail.map(({ row: r, inheritedFrom, implied, filteredOut }, i) => (
                  <PolicyDetailRow
                    key={`${r.policyId}-${r.assignment}-${i}`}
                    item={{ row: r, inheritedFrom, implied, filteredOut }}
                    matched={matched}
                    onToggleFilter={onToggleFilter}
                  />
                ))}
                {detail.length === 0 && <div className="text-[11px] text-slate-500">No policies apply here.</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Tile({ n, label, title, strong = false }: { n: number; label: string; title: string; strong?: boolean }) {
  return (
    <div className="flex-1 rounded-md bg-ink-800 px-1.5 py-2 text-center" title={title}>
      <div
        className={`text-sm font-semibold tabular-nums ${
          n > 0 ? (strong ? "text-slate-100" : "text-slate-300") : "text-slate-600"
        }`}
      >
        {n}
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}
