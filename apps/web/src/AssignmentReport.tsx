import { Fragment, useEffect, useMemo, useState } from "react";
import type { AssignmentReport as Report, AssignmentReportRow, Platform, PolicyKind } from "@intune-preflight/shared";
import { api } from "./api.ts";
import { GroupHeatCluster, type ClusterPolicy } from "./GroupHeatCluster.tsx";
import { GroupPolicyList } from "./GroupPolicyList.tsx";

// An endpoint is defined by its OS, so the manifest is always scoped to one --
// a mixed-OS view mixes assignments no single device would ever see.
const OS_FILTERS: { value: Platform; label: string }[] = [
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" },
  { value: "ios", label: "iOS" },
  { value: "android", label: "Android" },
];

// Color-coded type chips, matching the diagram's kind palette, so the policy
// type reads as a uniform labeled column instead of loose grey text.
const KIND_STYLE: Record<PolicyKind, { label: string; cls: string }> = {
  deviceConfiguration: { label: "Device Config", cls: "bg-sky-500/15 text-sky-300" },
  settingsCatalog: { label: "Settings Catalog", cls: "bg-violet-500/15 text-violet-300" },
  compliancePolicy: { label: "Compliance", cls: "bg-orange-500/15 text-orange-300" },
  adminTemplate: { label: "Admin Template", cls: "bg-yellow-500/15 text-yellow-300" },
  platformScript: { label: "Script", cls: "bg-emerald-500/15 text-emerald-300" },
  endpointSecurity: { label: "Endpoint Security (Legacy)", cls: "bg-rose-500/15 text-rose-300" },
};

const GROUP_KIND_STYLE: Record<string, string> = {
  virtual: "bg-slate-500/20 text-slate-300",
  dynamic: "bg-violet-500/20 text-violet-300",
  assigned: "bg-sky-500/20 text-sky-300",
};

type SortKey = "group" | "direct" | "inherited" | "excl";

/** A clickable column header that shows the active sort direction. */
function SortTh({
  label,
  col,
  sort,
  onSort,
  align = "left",
  title,
}: {
  label: string;
  col: SortKey;
  sort: { key: SortKey; dir: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = sort.key === col;
  return (
    <th className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : ""}`} title={title}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-300 ${
          active ? "text-slate-200" : ""
        }`}
      >
        {label}
        <span className={active ? "text-sky-400" : "text-slate-700"}>{active ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}</span>
      </button>
    </th>
  );
}

export function AssignmentReport({
  onSimulateGroups,
}: {
  /** Send the checked groups (and any simulated device filters) to the Simulator
   *  as a fresh device. When omitted, the checkbox column and selection bar are
   *  hidden (the Manifest is read-only). */
  onSimulateGroups?: (groupIds: string[], platform: Platform, filterIds: string[]) => void;
} = {}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [os, setOs] = useState<Platform>("windows");
  // Real Entra groups checked to send to the Simulator (never the virtual
  // All Devices / All Users — those always apply). Cleared when the OS changes,
  // since each OS tab shows a different set of groups.
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // The group whose seating chart is expanded into the full chip list, if any.
  const [openCluster, setOpenCluster] = useState<{ id: string; name: string } | null>(null);
  const canSimulate = !!onSimulateGroups;
  const colCount = canSimulate ? 7 : 6;
  const [showInherited, setShowInherited] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Default to Direct, descending: the most directly-assigned groups (the real
  // per-group differentiator) rise to the top -- the "assignment hotspot" view.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "direct", dir: "desc" });
  // Assignment filters the simulated device is treated as matching. Empty (the
  // default) = the broadest view, matching no filter -- exactly as before.
  const [matched, setMatched] = useState<Set<string>>(new Set());

  // Refetch when the OS filter changes -- the server recomputes rows, the group
  // rollup, AND the totals (incl. the per-OS unassigned count, which can't be
  // derived client-side since unassigned policies produce no assignment rows).
  useEffect(() => {
    let live = true;
    setChecked(new Set()); // the group set differs per OS; don't carry a stale selection across tabs
    api
      .assignmentReport(os)
      .then((r) => live && setReport(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [os]);

  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Policies targeting each group, for the expandable detail rows.
  const rowsByGroup = useMemo(() => {
    const m = new Map<string, AssignmentReportRow[]>();
    for (const r of report?.rows ?? []) {
      const list = m.get(r.groupId) ?? [];
      list.push(r);
      m.set(r.groupId, list);
    }
    return m;
  }, [report]);

  // Every member of any group also inherits the All Devices / All Users
  // assignments (the two "virtual" groups), so those get listed under each real
  // group too. Deduped so a policy on both All Devices and All Users shows once.
  const inheritedRows = useMemo(() => {
    const seen = new Set<string>();
    const out: AssignmentReportRow[] = [];
    for (const r of report?.rows ?? []) {
      if (r.groupKind !== "virtual") continue;
      const key = `${r.policyId}:${r.assignment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [report]);

  // Merged detail for a group: what a member effectively receives. Directly-
  // assigned policies + policies inherited from All Devices / All Users, but
  // applying Intune's rule that EXCLUDE WINS -- an inherited All Devices policy
  // is dropped if this group is explicitly excluded from it (otherwise a Kiosk
  // group excluded from an All Devices profile would wrongly show it as applied
  // and then again as an exclude). The exclude rows are kept at the end so it's
  // clear why those policies don't apply. Virtual groups don't self-inherit.
  const detailFor = (
    groupId: string,
    groupKind: string,
    impliedGroupIds: string[],
    withInherited: boolean,
    matched: Set<string>
  ) => {
    const direct = rowsByGroup.get(groupId) ?? [];
    const directIncludes = direct.filter((r) => r.assignment === "Include");
    const directExcludes = direct.filter((r) => r.assignment === "Exclude");

    // Implied (superset) groups this group's members also belong to. Skipped
    // entirely when inheritance is toggled off (then only direct rows show).
    const inheritApplies = groupKind !== "virtual" && withInherited;
    const impliedRows = inheritApplies ? impliedGroupIds.flatMap((hid) => rowsByGroup.get(hid) ?? []) : [];
    const impliedIncludes = impliedRows.filter((r) => r.assignment === "Include");
    const impliedExcludes = impliedRows.filter((r) => r.assignment === "Exclude");

    // Exclude wins: a policy is excluded for this group if the group -- directly
    // OR via an implied (superset) group it belongs to -- is excluded from it.
    const excludedPolicyIds = new Set([...directExcludes, ...impliedExcludes].map((r) => r.policyId));

    type Source = "direct" | "inherited" | "implied";
    type Entry = {
      row: AssignmentReportRow;
      inheritedFrom: string | null;
      implied: boolean;
      filteredOut?: boolean;
    };
    const entry = (row: AssignmentReportRow, source: Source): Entry => ({
      row,
      inheritedFrom: source === "direct" ? null : row.groupName,
      implied: source === "implied",
    });

    // Whether an assignment's filter lets it apply, given which filters the
    // simulated device matches. Mirrors the simulator's passesAssignmentFilter:
    // an exclude filter suppresses the assignment when matched; an include filter
    // requires a match. No filter = always applies.
    const passesFilter = (row: AssignmentReportRow) => {
      if (!row.filterId || !row.filterType) return true;
      return row.filterType === "exclude" ? !matched.has(row.filterId) : matched.has(row.filterId);
    };

    // Evaluate include assignments across every source in priority order. A
    // policy applies if ANY of its includes passes its filter and isn't
    // group-excluded (the best passing source is shown). A policy whose every
    // include is suppressed by a matched filter is surfaced separately as
    // "filtered out" so the toggle's effect is visible, not just a silent drop.
    const candidates: { row: AssignmentReportRow; source: Source }[] = [
      ...directIncludes.map((row) => ({ row, source: "direct" as Source })),
      ...(inheritApplies ? inheritedRows.map((row) => ({ row, source: "inherited" as Source })) : []),
      ...(inheritApplies ? impliedIncludes.map((row) => ({ row, source: "implied" as Source })) : []),
    ];
    const includeEntries: Entry[] = [];
    const applied = new Set<string>();
    const suppressed = new Map<string, { row: AssignmentReportRow; source: Source }>();
    for (const c of candidates) {
      if (excludedPolicyIds.has(c.row.policyId) || applied.has(c.row.policyId)) continue;
      if (passesFilter(c.row)) {
        applied.add(c.row.policyId);
        includeEntries.push(entry(c.row, c.source));
      } else if (!suppressed.has(c.row.policyId)) {
        suppressed.set(c.row.policyId, c);
      }
    }
    const filteredEntries: Entry[] = [];
    for (const [pid, c] of suppressed) {
      if (applied.has(pid)) continue; // still applies via another (unfiltered) source
      filteredEntries.push({ ...entry(c.row, c.source), filteredOut: true });
    }

    // Group excludes to show (why those policies don't apply): direct + implied,
    // de-duped by policy, direct preferred.
    const excludeEntries: Entry[] = [];
    const takenExc = new Set<string>();
    const addExcludes = (rows: AssignmentReportRow[], source: Source) => {
      for (const r of rows) {
        if (r.assignment !== "Exclude" || takenExc.has(r.policyId)) continue;
        takenExc.add(r.policyId);
        excludeEntries.push(entry(r, source));
      }
    };
    addExcludes(directExcludes, "direct");
    if (inheritApplies) addExcludes(impliedExcludes, "implied");

    // Applied first, then filter-suppressed, then group-excludes; A→Z within each.
    const rank = (e: Entry) => (e.filteredOut ? 1 : e.row.assignment === "Exclude" ? 2 : 0);
    const merged = [...includeEntries, ...filteredEntries, ...excludeEntries];
    merged.sort(
      (a, b) => rank(a) - rank(b) || a.row.policyName.localeCompare(b.row.policyName, undefined, { sensitivity: "base" })
    );
    return merged;
  };

  // Compute each group's effective detail ONCE (it was also being recomputed
  // per row on every render -- expensive at 150+ policies). Yields the per-group
  // applied-policy counts the table's columns are built from.
  const details = useMemo(() => {
    const m = new Map<string, ReturnType<typeof detailFor>>();
    for (const o of report?.groupOverlaps ?? []) {
      m.set(o.groupId, detailFor(o.groupId, o.groupKind, o.impliedGroupIds, showInherited, matched));
    }
    return m;
    // detailFor closes over report-derived memos, so report is the only real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, showInherited, matched]);

  // The assignment filters that appear anywhere in this platform's assignments,
  // for the "Simulate device filters" toggles. Empty on platforms with none.
  const filtersInPlay = useMemo(() => {
    const m = new Map<string, { id: string; name: string; type: "include" | "exclude" }>();
    for (const r of report?.rows ?? []) {
      if (r.filterId && !m.has(r.filterId)) {
        m.set(r.filterId, { id: r.filterId, name: r.filterName ?? r.filterId, type: r.filterType ?? "exclude" });
      }
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [report]);

  const toggleFilter = (id: string) =>
    setMatched((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Per-group counts of APPLIED includes, split into directly-assigned vs
  // inherited (All Devices / All Users + implied) -- distinct from the raw
  // include/exclude assignment EDGE counts (o.includeCount / o.excludeCount),
  // which count what's configured before Intune's exclude-wins is applied.
  const meta = useMemo(() => {
    const byGroup = new Map<string, { direct: number; inherited: number }>();
    for (const [gid, detail] of details) {
      const applied = detail.filter((d) => !d.filteredOut && d.row.assignment === "Include");
      const direct = applied.filter((d) => !d.inheritedFrom).length;
      const inherited = applied.filter((d) => d.inheritedFrom).length;
      byGroup.set(gid, { direct, inherited });
    }
    return byGroup;
  }, [details]);

  // Filter by search, then sort by the chosen column. Numeric sorts tie-break
  // A→Z so the order is stable; the group column sorts alphabetically.
  const overlaps = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (report?.groupOverlaps ?? []).filter((o) => !q || o.groupName.toLowerCase().includes(q));
    const dir = sort.dir === "asc" ? 1 : -1;
    const valueOf = (groupId: string, includeCount: number, excludeCount: number) => {
      const m = meta.get(groupId) ?? { direct: 0, inherited: 0 };
      switch (sort.key) {
        case "direct":
          return m.direct;
        case "inherited":
          return m.inherited;
        case "excl":
          return excludeCount;
        default:
          return 0;
      }
    };
    return [...list].sort((a, b) => {
      if (sort.key === "group") return dir * a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" });
      const diff = valueOf(a.groupId, a.includeCount, a.excludeCount) - valueOf(b.groupId, b.includeCount, b.excludeCount);
      if (diff !== 0) return dir * diff;
      return a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" });
    });
  }, [report, search, sort, meta]);

  // Toggle direction on the active column; a new column starts descending for
  // the numeric hotspot columns and ascending (A→Z) for the group name.
  const sortBy = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "group" ? "asc" : "desc" }));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // "Which groups carry each policy" -- powers the per-group seating charts.
  // Real (non-virtual) Include edges only: the All Devices / All Users baseline
  // is shared by everyone by definition, so counting it would wash every group
  // hot and hide the real containment-vs-bleed signal.
  const sharedWithByPolicy = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of report?.rows ?? []) {
      if (r.assignment !== "Include" || r.groupKind === "virtual") continue;
      const s = m.get(r.policyId) ?? new Set<string>();
      s.add(r.groupName);
      m.set(r.policyId, s);
    }
    return m;
  }, [report]);

  // Policies scoped to the virtual All Devices / All Users targets. Intune's UI
  // disables adding groups once you pick All Devices/Users (it's either/or), so a
  // policy that is on one of these AND also directly on a group is an ANOMALY --
  // it can only be created outside the portal. Flag it where it appears in a
  // group's own list rather than mistaking it for the group's own policy.
  const universalByPolicy = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of report?.rows ?? []) {
      if (r.assignment !== "Include" || r.groupKind !== "virtual") continue;
      (m.get(r.policyId) ?? m.set(r.policyId, new Set<string>()).get(r.policyId)!).add(r.groupName);
    }
    return m;
  }, [report]);

  const clusterFor = (groupId: string, groupName: string): ClusterPolicy[] => {
    const seen = new Set<string>();
    const out: ClusterPolicy[] = [];
    for (const r of report?.rows ?? []) {
      if (r.groupId !== groupId || r.assignment !== "Include" || seen.has(r.policyId)) continue;
      seen.add(r.policyId);
      const names = [...(sharedWithByPolicy.get(r.policyId) ?? new Set<string>())];
      out.push({
        id: r.policyId,
        name: r.policyName,
        shared: names.length || 1,
        sharedWith: names.filter((n) => n !== groupName),
        universal: [...(universalByPolicy.get(r.policyId) ?? new Set<string>())],
      });
    }
    return out;
  };

  if (error) {
    return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-red-400">{error}</div>;
  }
  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-ink-700 border-t-sky-400" aria-hidden />
        <div className="text-sm text-slate-300">Building assignment report…</div>
      </div>
    );
  }

  const { totals } = report;
  const osLabel = OS_FILTERS.find((f) => f.value === os)?.label ?? os;

  return (
    <div className="relative flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 py-3">
        <div className="mr-auto flex max-w-xl items-start gap-2">
          <span className="mt-0.5 text-sm" aria-hidden>📋</span>
          <div>
            <div className="text-xs font-semibold text-slate-200">Assignment Manifest</div>
            <div className="text-[11px] leading-snug text-slate-400">
              Which groups carry which policies across your tenant — find your assignment hotspots, and see what a device in
              any group effectively receives.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="rounded bg-ink-800 px-2 py-1">
            <span className="font-medium text-slate-200">{totals.policies}</span> {osLabel} policies
          </span>
          <span className="rounded bg-ink-800 px-2 py-1">{totals.assigned} assigned</span>
          <span className="rounded bg-orange-500/15 px-2 py-1 text-orange-300">{totals.unassigned} unassigned</span>
          <span className="rounded bg-ink-800 px-2 py-1">{totals.groupsTargeted} groups targeted</span>
        </div>
        <a
          href={api.assignmentReportCsvUrl(os)}
          className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
        >
          Download CSV
        </a>
      </div>

      {/* OS filter */}
      <div className="flex items-center gap-1 border-b border-ink-800 bg-ink-900/60 px-4 py-1.5">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Platform</span>
        {OS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setOs(f.value)}
            className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
              os === f.value ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
        <label
          className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-slate-400"
          title="Show policies each group inherits from All Devices / All Users and implied memberships. Off = directly-assigned policies only."
        >
          <input
            type="checkbox"
            checked={showInherited}
            onChange={(e) => setShowInherited(e.target.checked)}
            className="shrink-0 accent-sky-400"
          />
          Show inherited
        </label>
      </div>

      {/* Body */}
      <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-3 ${canSimulate && checked.size > 0 ? "pb-56" : ""}`}>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="w-full max-w-xs rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <span className="text-[10px] text-slate-500">Click a column header to sort · click a row to expand</span>
          {filtersInPlay.length > 0 && (
            <div
              className="ml-auto flex items-center gap-1.5"
              title="Treat the simulated device as matching an Assignment Filter, and watch every group recompute. Off (default) = the broadest view, matching no filter."
            >
              <span className="text-[10px] uppercase tracking-wide text-slate-500">Simulate device filters</span>
              {filtersInPlay.map((f) => {
                const on = matched.has(f.id);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggleFilter(f.id)}
                    className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                      on
                        ? "bg-violet-500/30 text-violet-100 ring-1 ring-violet-400/60"
                        : "bg-violet-500/10 text-violet-300 hover:bg-violet-500/20"
                    }`}
                    title={`Device ${on ? "matches" : "does not match"} “${f.name}” (${f.type}). Click to ${
                      on ? "stop matching" : "match"
                    } it.`}
                  >
                    ⛃ {f.name}
                    {on ? " ✓" : ""}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-ink-700">
          <table className="w-full text-left text-xs">
            <thead className="bg-ink-900 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                {canSimulate && <th className="w-9 px-2 py-2" title="Select groups to send to the Simulator" />}
                <SortTh label="Group" col="group" sort={sort} onSort={sortBy} />
                <th className="px-3 py-2 font-medium">Type</th>
                <SortTh
                  label="Direct"
                  col="direct"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                  title="Policies assigned directly to this group that apply (after Intune's exclude-wins)."
                />
                <SortTh
                  label="Inherited"
                  col="inherited"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                  title="Policies this group additionally receives from All Devices / All Users and implied memberships. Roughly the same for every group — the tenant-wide baseline."
                />
                <SortTh
                  label="Incl / Excl"
                  col="excl"
                  sort={sort}
                  onSort={sortBy}
                  align="right"
                  title="Raw direct assignment edges configured in Intune (before exclude-wins). Sorts by exclude count — find the groups carved out of the most policies."
                />
                <th className="px-3 py-2 font-medium">Platforms</th>
              </tr>
            </thead>
            <tbody>
              {overlaps.map((o) => {
                const open = expanded.has(o.groupId);
                const detail = details.get(o.groupId) ?? [];
                const { direct, inherited } = meta.get(o.groupId) ?? { direct: 0, inherited: 0 };
                return (
                  <Fragment key={o.groupId}>
                    <tr
                      onClick={() => toggle(o.groupId)}
                      className="cursor-pointer border-t border-ink-800 hover:bg-ink-800/60"
                    >
                      {canSimulate && (
                        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                          {o.groupKind === "virtual" ? (
                            <input
                              type="checkbox"
                              checked
                              disabled
                              title="Always applies — every device inherits All Devices / All Users, so there's nothing to select"
                              className="cursor-not-allowed opacity-40 accent-sky-400"
                            />
                          ) : (
                            <input
                              type="checkbox"
                              checked={checked.has(o.groupId)}
                              onChange={() => toggleChecked(o.groupId)}
                              title={`Add “${o.groupName}” to the device to simulate`}
                              className="cursor-pointer accent-sky-400"
                            />
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-500">{open ? "▾" : "▸"}</span>
                          <span className="font-medium text-slate-200">{o.groupName}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${GROUP_KIND_STYLE[o.groupKind] ?? ""}`}>
                          {o.groupKind}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={direct > 0 ? "font-medium text-slate-100" : "text-slate-600"}>{direct}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={inherited > 0 ? "text-slate-300" : "text-slate-600"}>{inherited}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                        <span className="text-emerald-300">{o.includeCount}</span>
                        {" / "}
                        <span className={o.excludeCount > 0 ? "text-rose-300" : "text-slate-600"}>{o.excludeCount}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-slate-400">{o.platforms.join(", ")}</span>
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-t border-ink-800 bg-ink-950/40">
                        <td colSpan={colCount} className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {detail.map(({ row: r, inheritedFrom, implied, filteredOut }, i) => {
                              const kind = KIND_STYLE[r.kind] ?? { label: r.kind, cls: "bg-slate-500/15 text-slate-400" };
                              return (
                                <div
                                  key={`${r.policyId}-${r.assignment}-${i}`}
                                  className={`grid grid-cols-[4rem_8.5rem_minmax(0,1fr)_auto] items-center gap-2 text-[11px] ${
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
                                  <span
                                    className={`justify-self-start rounded px-1.5 py-0.5 text-[9px] font-medium uppercase ${kind.cls}`}
                                  >
                                    {kind.label}
                                  </span>
                                  <span className={`min-w-0 truncate ${filteredOut ? "text-slate-400 line-through" : "text-slate-200"}`}>
                                    {r.policyName}
                                  </span>
                                  <div className="flex shrink-0 items-center justify-end gap-1.5">
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
                                          toggleFilter(r.filterId!);
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
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {overlaps.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-3 py-6 text-center text-slate-500">
                    {search ? `No groups match “${search}”.` : "No policy assignments for this platform."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Reading key — labeled, scannable, replacing the old run-on paragraph. */}
        <div className="mt-3 space-y-2 text-[11px] leading-snug text-slate-500">
          <dl className="space-y-1">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium text-slate-200">Direct</dt>
              <dd>Policies assigned straight to this group. Sort by it to find your assignment hotspots.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium text-slate-300">Inherited</dt>
              <dd>Also received from All Devices / All Users and implied groups — ≈ the same for every group, so it's a count, not a ranking.</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium">
                <span className="text-emerald-300">Incl</span> / <span className="text-rose-300">Excl</span>
              </dt>
              <dd>The raw assignment edges configured in Intune.</dd>
            </div>
          </dl>

          <p>
            <span className="text-slate-400">Expand any row</span> for the full set a device in that group effectively gets —
            sorted A→Z, excludes last. Intune's “exclude wins” rule is applied, so a policy the group is excluded from is
            dropped from the applied list and shown only as an exclude.
          </p>

          {filtersInPlay.length > 0 && (
            <p>
              <span className="text-violet-300">⛃ Simulate a filter:</span> click a filter chip (or the toggles up top) to
              treat the device as matching it. Every group recomputes live, and policies the filter drops move to a
              struck-through <span className="text-violet-300">Filtered</span> line.
            </p>
          )}

          <p className="text-slate-600">Export the CSV for the raw per-assignment detail — pivot by Group or Policy in Excel.</p>
        </div>
      </div>

      {/* Selection bar — rises from the bottom when ≥1 group is checked, and sends
          the checked groups to the Simulator as a fresh, ground-up device. */}
      {canSimulate && (
        <div
          className={`absolute inset-x-0 bottom-0 z-20 border-t border-ink-700 bg-ink-900/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur transition-transform duration-200 ${
            checked.size > 0 ? "translate-y-0" : "pointer-events-none translate-y-full"
          }`}
        >
          {/* Seating charts — one per checked group: policies as bubbles, cool =
              this group's own, hot = shared. A preflight check for overcrowding. */}
          {checked.size > 0 && (
            <div className="mx-auto mb-2 flex max-w-6xl gap-2 overflow-x-auto pb-1">
              {[...checked].map((gid) => {
                const gname = overlaps.find((o) => o.groupId === gid)?.groupName ?? gid;
                return (
                  <GroupHeatCluster
                    key={gid}
                    name={gname}
                    policies={clusterFor(gid, gname)}
                    onOpen={() => setOpenCluster({ id: gid, name: gname })}
                  />
                );
              })}
            </div>
          )}
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <span className="text-xs text-slate-300">
              <span className="font-semibold text-slate-100">{checked.size}</span> group{checked.size === 1 ? "" : "s"} selected
            </span>
            <span className="hidden text-[11px] text-slate-500 sm:inline">
              All Devices / All Users always apply and are included automatically.
            </span>
            {matched.size > 0 && (
              <span className="text-[11px] text-violet-300" title="The device filters you're simulating here carry over to the Simulator">
                ⛃ carrying {matched.size} device filter{matched.size === 1 ? "" : "s"}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setChecked(new Set())}
                className="rounded-md px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200"
              >
                Clear
              </button>
              <button
                onClick={() => onSimulateGroups?.([...checked], os, [...matched])}
                className="rounded-md border border-emerald-400/50 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
              >
                Simulate a device in these {checked.size} group{checked.size === 1 ? "" : "s"} →
              </button>
            </div>
          </div>
        </div>
      )}

      {openCluster && (
        <GroupPolicyList
          name={openCluster.name}
          policies={clusterFor(openCluster.id, openCluster.name)}
          onClose={() => setOpenCluster(null)}
        />
      )}
    </div>
  );
}
