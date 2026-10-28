import type { PolicyKind, ResolutionRule, SimulationResult } from "@intune-preflight/shared";

/**
 * One merged-baseline setting, ready to render.
 *
 * It lives here, with `buildRows` below it, rather than inside the panel,
 * because the baseline now has three presentations -- the desktop data grid,
 * the compact accordion and the always-on peek beside the diagram -- and they
 * must never be able to disagree about what a row IS. `buildRows` produces
 * these once per simulation; every renderer only reads them.
 *
 * `sourceKinds` is EVERY policy kind that contributes this setting, not just
 * the one whose value landed in the merged row. That distinction is the "Legacy
 * policies" view: a conflicted setting configured by both a Settings Catalog
 * policy and a legacy Endpoint Security intent must appear under it whichever
 * source the merge happened to reach first.
 */
export type DisplayRow =
  | {
      kind: "normal";
      sourceKinds: PolicyKind[];
      sourceLegacyTemplate?: boolean;
      settingId: string;
      cspPath?: string;
      docUrl?: string;
      cspArea: string;
      displayName: string;
      value: string;
      sourcePolicyName: string;
    }
  | {
      kind: "conflict";
      sourceKinds: PolicyKind[];
      settingId: string;
      cspPath?: string;
      docUrl?: string;
      cspArea: string;
      displayName: string;
      values: { value: string; sourcePolicyName: string }[];
    }
  | {
      // Several policies configure this and they disagree, but the policy type
      // resolves that under a documented rule rather than refusing to apply
      // anything -- Feature Update profiles take the latest version, compliance
      // policies the most restrictive. Carries the same `values` shape as a
      // conflict, deliberately: it is the same disagreement, and it is rendered
      // the same way, with no value marked as the effective one. Only the
      // reading differs, and `rule` is what says which reading applies.
      kind: "layered";
      sourceKinds: PolicyKind[];
      settingId: string;
      cspPath?: string;
      docUrl?: string;
      cspArea: string;
      displayName: string;
      rule: ResolutionRule;
      values: { value: string; sourcePolicyName: string }[];
    }
  | {
      kind: "overlap";
      sourceKinds: PolicyKind[];
      settingId: string;
      cspPath?: string;
      docUrl?: string;
      cspArea: string;
      displayName: string;
      value: string;
      sources: string[];
    };

/** The real CSP path if we resolved one, else the setting id (OMA-URI / type:key). */
export const cspRef = (r: DisplayRow) => r.cspPath ?? r.settingId;

/**
 * Does any policy contributing this setting come from the legacy intents-based
 * Endpoint Security model? Keyed on every contributing source, so a setting a
 * legacy intent only CO-configures (with a Settings Catalog policy, say) still
 * counts -- it's exactly the setting a migration needs to look at.
 */
export function isLegacyRow(row: DisplayRow): boolean {
  return row.sourceKinds.includes("endpointSecurity");
}

/**
 * One display row per setting. Conflicts (value disagreements Intune refuses to
 * resolve) and layered settings (disagreements the device resolves under a
 * documented rule) both stay expanded, so every contributing value is visible.
 * Overlaps (same value across multiple policies) collapse into a single row that
 * can be expanded to reveal the overlapping policies -- otherwise a layered
 * baseline drowns the table in redundant rows.
 */
export function buildRows(simulation: SimulationResult): DisplayRow[] {
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));
  const layeredBySettingId = new Map(simulation.layered.map((l) => [l.settingId, l]));
  const overlapsBySettingId = new Map(simulation.overlaps.map((o) => [o.settingId, o]));
  const rows: DisplayRow[] = [];

  for (const s of simulation.settings) {
    const layered = layeredBySettingId.get(s.settingId);
    if (layered) {
      rows.push({
        kind: "layered",
        sourceKinds: [...new Set(layered.values.map((v) => v.sourceKind))],
        settingId: s.settingId,
        cspPath: s.cspPath,
        docUrl: s.docUrl,
        cspArea: layered.cspArea,
        displayName: layered.displayName,
        rule: layered.rule,
        values: layered.values.map((v) => ({ value: v.value, sourcePolicyName: v.sourcePolicyName })),
      });
      continue;
    }
    const conflict = conflictsBySettingId.get(s.settingId);
    if (conflict) {
      rows.push({
        kind: "conflict",
        sourceKinds: [...new Set(conflict.values.map((v) => v.sourceKind))],
        settingId: s.settingId,
        cspPath: s.cspPath,
        docUrl: s.docUrl,
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
        sourceKinds: [...new Set(overlap.sourcePolicies.map((sp) => sp.sourceKind))],
        settingId: s.settingId,
        cspPath: s.cspPath,
        docUrl: s.docUrl,
        cspArea: overlap.cspArea,
        displayName: overlap.displayName,
        value: overlap.value,
        sources: overlap.sourcePolicies.map((sp) => sp.sourcePolicyName),
      });
      continue;
    }
    rows.push({
      kind: "normal",
      sourceKinds: [s.sourceKind],
      sourceLegacyTemplate: s.sourceLegacyTemplate,
      settingId: s.settingId,
      cspPath: s.cspPath,
      docUrl: s.docUrl,
      cspArea: s.cspArea,
      displayName: s.displayName,
      value: s.value,
      sourcePolicyName: s.sourcePolicyName,
    });
  }
  return rows;
}
