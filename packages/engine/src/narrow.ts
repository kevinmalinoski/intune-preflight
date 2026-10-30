import type { PolicyKind, SimulationResult } from "@intune-preflight/shared";
import { resolutionRuleLabel } from "@intune-preflight/shared";

/**
 * Narrowing a baseline to what is actually being looked at.
 *
 * The merged-baseline panel has always had three of these stacked -- a scope
 * (one policy, or one policy type), a view (conflicts / layered / overlaps /
 * legacy) and a search box -- but they lived in the panel and applied to the
 * rendered rows, so the exports could not see them. Exporting while reading one
 * configuration profile handed you the whole tenant's baseline.
 *
 * They live here now because the export runs in three different places: the
 * server serialises for the self-hosted build, and the browser does it for the
 * demo and live builds. Three copies of "what counts as on screen" would be
 * three chances to disagree with the screen. One function, applied by the panel
 * to decide what to render and by each export to decide what to write.
 *
 * It narrows the SimulationResult rather than the display rows so that
 * `simulationToCsv` / `simulationToXlsx` / the JSON export keep working exactly
 * as they did -- the filtered export and the full export go through the same
 * serialiser, and cannot drift into two column layouts.
 */
export type BaselineView = "all" | "conflicts" | "layered" | "overlaps" | "legacy";

export interface BaselineCriteria {
  /** Only settings contributed by this policy type. */
  scopeKind?: PolicyKind;
  /** Only settings this policy contributed to, including findings it takes part in. */
  scopePolicyId?: string;
  view?: BaselineView;
  /** Free-text search, matched the way the panel's filter box matches. */
  query?: string;
}

/** True when nothing would be narrowed, so callers can skip the work entirely. */
export function isWholeBaseline(criteria: BaselineCriteria | undefined): boolean {
  if (!criteria) return true;
  const { scopeKind, scopePolicyId, view, query } = criteria;
  return !scopeKind && !scopePolicyId && (!view || view === "all") && !query?.trim();
}

/** Every policy kind that contributes a setting -- the merged row's own, plus each finding's. */
function contributingKinds(sim: SimulationResult, settingId: string, fallback: PolicyKind): PolicyKind[] {
  const conflict = sim.conflicts.find((c) => c.settingId === settingId);
  if (conflict) return conflict.values.map((v) => v.sourceKind);
  const layered = sim.layered.find((l) => l.settingId === settingId);
  if (layered) return layered.values.map((v) => v.sourceKind);
  const overlap = sim.overlaps.find((o) => o.settingId === settingId);
  if (overlap) return overlap.sourcePolicies.map((sp) => sp.sourceKind);
  return [fallback];
}

/**
 * The text a search matches against: everything the row would show.
 *
 * Mirrors what the panel's rows display, because a search that matched fields
 * the reader cannot see would be a different filter wearing the same box.
 */
function haystack(sim: SimulationResult, settingId: string): string[] {
  const setting = sim.settings.find((s) => s.settingId === settingId);
  if (!setting) return [];
  const out = [setting.cspArea, setting.displayName];
  const conflict = sim.conflicts.find((c) => c.settingId === settingId);
  const layered = sim.layered.find((l) => l.settingId === settingId);
  const overlap = sim.overlaps.find((o) => o.settingId === settingId);
  if (conflict) for (const v of conflict.values) out.push(v.value, v.sourcePolicyName);
  else if (layered) {
    for (const v of layered.values) out.push(v.value, v.sourcePolicyName);
    out.push(resolutionRuleLabel(layered.rule));
  } else if (overlap) {
    out.push(overlap.value, ...overlap.sourcePolicies.map((sp) => sp.sourcePolicyName));
  } else {
    out.push(setting.value, setting.sourcePolicyName);
  }
  return out;
}

export function narrowSimulation(sim: SimulationResult, criteria: BaselineCriteria = {}): SimulationResult {
  if (isWholeBaseline(criteria)) return sim;

  let settings = sim.settings;

  if (criteria.scopeKind) {
    settings = settings.filter((s) => s.sourceKind === criteria.scopeKind);
  }

  if (criteria.scopePolicyId) {
    // A policy's settings are the ones it won outright PLUS any finding it takes
    // part in, even where another policy's value landed in the merged row --
    // otherwise scoping to a policy hides the disagreements it is involved in,
    // which are the rows most worth reading.
    const pid = criteria.scopePolicyId;
    const involved = new Set<string>();
    for (const c of sim.conflicts) if (c.values.some((v) => v.sourcePolicyId === pid)) involved.add(c.settingId);
    for (const l of sim.layered) if (l.values.some((v) => v.sourcePolicyId === pid)) involved.add(l.settingId);
    for (const o of sim.overlaps)
      if (o.sourcePolicies.some((sp) => sp.sourcePolicyId === pid)) involved.add(o.settingId);
    settings = settings.filter((s) => s.sourcePolicyId === pid || involved.has(s.settingId));
  }

  const view = criteria.view ?? "all";
  if (view !== "all") {
    const conflictIds = new Set(sim.conflicts.map((c) => c.settingId));
    const layeredIds = new Set(sim.layered.map((l) => l.settingId));
    const overlapIds = new Set(sim.overlaps.map((o) => o.settingId));
    settings = settings.filter((s) => {
      if (view === "conflicts") return conflictIds.has(s.settingId);
      if (view === "layered") return layeredIds.has(s.settingId);
      if (view === "overlaps") return overlapIds.has(s.settingId);
      // Legacy: ANY contributing policy comes from the intents-based Endpoint
      // Security model, not just the one whose value won the merge -- that is
      // exactly the setting a migration has to look at.
      return contributingKinds(sim, s.settingId, s.sourceKind).includes("endpointSecurity");
    });
  }

  const needle = criteria.query?.trim().toLowerCase();
  if (needle) {
    settings = settings.filter((s) => haystack(sim, s.settingId).some((h) => h.toLowerCase().includes(needle)));
  }

  // Keep the findings in step with the settings that survived. A conflict whose
  // setting has been filtered away would otherwise still be counted in the
  // header and still expand to rows in the export.
  const kept = new Set(settings.map((s) => s.settingId));
  return {
    ...sim,
    settings,
    conflicts: sim.conflicts.filter((c) => kept.has(c.settingId)),
    layered: sim.layered.filter((l) => kept.has(l.settingId)),
    overlaps: sim.overlaps.filter((o) => kept.has(o.settingId)),
    // crossModel is deliberately left whole. It is its own view in the panel
    // and appears in no export, and a cross-model finding spans SEVERAL
    // settings across different policy models -- there is no single settingId
    // to test it against, so narrowing it would mean picking one of its
    // entries and calling that the finding. Leaving it alone is the honest
    // answer; nothing downstream of this reads it per-setting.
  };
}
