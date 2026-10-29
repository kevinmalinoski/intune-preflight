import type { SimulationResult } from "@intune-preflight/shared";
import { filterExclusionReason } from "@intune-preflight/shared";
import { KIND_COLOR, KIND_LABEL, KIND_ORDER, type PolicyStatus } from "./theme.ts";

/**
 * Which policies a simulated endpoint gets, and how they group by type.
 *
 * This is the diagram's data model with the geometry taken out. `buildGraph`
 * used to derive it inline, because the layout was the only thing that needed
 * it -- so the answer to "which policies, grouped how" was expressed as x/y
 * coordinates and reachable only by drawing a graph.
 *
 * It lives here because the same grouping has a second presentation coming: a
 * drill-down list for touch screens, where a 120x40 node with 8px type inside
 * it is the wrong way to read a policy name. The rule that has held twice
 * already in this app -- the merged baseline's grid and accordion share
 * `buildRows`, the manifest's table and cards share `PolicyDetailRow` -- is
 * that two presentations of one thing read one source, so they cannot disagree
 * about what is on screen. This is that source for the third pair.
 *
 * Labels and colours come from `theme.ts` here rather than in each renderer,
 * for the same reason the legend derives its swatches from it: a colour that is
 * looked up twice is a colour that can drift.
 */

/** One policy as the diagram and the list both see it. */
export type VisiblePolicy = {
  id: string;
  name: string;
  kind: string;
  status: PolicyStatus;
  /** Set only when a device filter excluded it, as a readable sentence. */
  excludedReason?: string;
  settingsCount: number;
  /** Ids of the still-visible groups bringing this policy in. */
  sources: string[];
};

/** Policies of one kind, in the order the type bubbles are laid out. */
export type PolicyTypeGroup = {
  kind: string;
  label: string;
  color: string;
  count: number;
  policies: VisiblePolicy[];
};

/**
 * The applied and excluded policies that survive the group-hiding lens.
 *
 * A policy drops out only when every group bringing it in is hidden; one still
 * visible source keeps it. Policies with no source at all (the waitlist) are
 * never hidden this way, which is why the emptiness check is on
 * `sourceGroupIds` rather than on the filtered list.
 */
export function visiblePolicies(simulation: SimulationResult, hiddenGroupIds: Set<string>): VisiblePolicy[] {
  const visible: VisiblePolicy[] = [];
  for (const p of [...simulation.policies, ...simulation.excludedPolicies]) {
    const excluded = simulation.excludedPolicies.includes(p);
    // Group-exclude and filter-exclude are mutually exclusive per policy (see computeSimulation).
    const sourceGroupIds = excluded && p.excludedViaGroupIds.length > 0 ? p.excludedViaGroupIds : p.viaGroupIds;
    const visibleSources = sourceGroupIds.filter((id) => !hiddenGroupIds.has(id));
    // A policy survives only while at least one group bringing it in is still visible.
    if (sourceGroupIds.length > 0 && visibleSources.length === 0) continue;
    visible.push({
      id: p.id,
      name: p.displayName,
      kind: p.kind,
      status: excluded ? "excluded" : p.unassigned ? "unassigned" : "included",
      excludedReason: p.excludedByFilter
        ? filterExclusionReason(p.excludedByFilter.filterName, p.excludedByFilter.filterType)
        : undefined,
      // Each policy's OWN settings, not its share of the merged baseline -- a
      // policy whose settings all collide with another (a 25H2 Feature Update
      // profile deduped under 24H2, say) still reports its real count.
      settingsCount: p.settingsCount,
      sources: visibleSources,
    });
  }
  return visible;
}

/**
 * Group them by policy type, ordered by `KIND_ORDER`.
 *
 * A kind the order does not list sorts to the end rather than being dropped --
 * a policy type we have not catalogued still has to appear somewhere.
 */
export function groupByKind(visible: VisiblePolicy[]): PolicyTypeGroup[] {
  const byKind = new Map<string, VisiblePolicy[]>();
  for (const vp of visible) {
    const list = byKind.get(vp.kind) ?? [];
    list.push(vp);
    byKind.set(vp.kind, list);
  }
  const rank = (k: string) => (KIND_ORDER.indexOf(k) === -1 ? 99 : KIND_ORDER.indexOf(k));
  return [...byKind.keys()]
    .sort((a, b) => rank(a) - rank(b))
    .map((kind) => {
      const policies = byKind.get(kind)!;
      return {
        kind,
        label: KIND_LABEL[kind] ?? kind,
        color: KIND_COLOR[kind] ?? "#94a3b8",
        count: policies.length,
        policies,
      };
    });
}
