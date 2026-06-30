import type {
  BaselineSetting,
  ConflictingSetting,
  GroupSummary,
  IntunePolicy,
  Platform,
  SimulationGroup,
  SimulationPolicy,
  SimulationResult,
} from "@intune-baseline/shared";
import type { TenantData } from "./intuneData.js";
import { VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";

/**
 * A policy applies to a set of group ids if at least one of those ids is an
 * include target AND none of them is an exclude target. Excludes always win,
 * even if the same group set also matches an include (e.g. via All Devices) --
 * this mirrors how Intune itself resolves assignment conflicts.
 */
function appliesTo(policy: IntunePolicy, groupIds: string[]): boolean {
  const included = policy.assignedGroupIds.some((id) => groupIds.includes(id));
  const excluded = policy.excludedGroupIds.some((id) => groupIds.includes(id));
  return included && !excluded;
}

function mergeSettings(policies: IntunePolicy[]): { settings: BaselineSetting[]; conflicts: ConflictingSetting[] } {
  const bySettingId = new Map<string, BaselineSetting[]>();
  for (const policy of policies) {
    for (const setting of policy.settings) {
      const entry: BaselineSetting = {
        ...setting,
        sourcePolicyId: policy.id,
        sourcePolicyName: policy.displayName,
        sourceKind: policy.kind,
      };
      const list = bySettingId.get(setting.settingId) ?? [];
      list.push(entry);
      bySettingId.set(setting.settingId, list);
    }
  }

  const settings: BaselineSetting[] = [];
  const conflicts: ConflictingSetting[] = [];
  for (const [settingId, entries] of bySettingId) {
    settings.push(entries[0]);
    const distinctValues = new Set(entries.map((e) => e.value));
    if (distinctValues.size > 1) {
      conflicts.push({
        settingId,
        cspArea: entries[0].cspArea,
        displayName: entries[0].displayName,
        values: entries.map((e) => ({
          value: e.value,
          sourcePolicyId: e.sourcePolicyId,
          sourcePolicyName: e.sourcePolicyName,
          sourceKind: e.sourceKind,
        })),
      });
    }
  }
  return { settings, conflicts };
}

export function listGroupSummaries(data: TenantData): GroupSummary[] {
  return data.groups
    .filter(
      (g) =>
        !g.isVirtual ||
        data.policies.some((p) => p.assignedGroupIds.includes(g.id)) ||
        data.autopilotProfiles.some((a) => a.assignedGroupIds.includes(g.id))
    )
    .map((group) => {
      const applied = data.policies.filter((p) => appliesTo(p, [group.id]));
      const { settings, conflicts } = mergeSettings(applied);
      return {
        id: group.id,
        displayName: group.displayName,
        policyCount: applied.length,
        settingsCount: settings.length,
        conflictCount: conflicts.length,
        isDynamic: group.isDynamic,
        membershipRule: group.membershipRule,
      };
    })
    .sort((a, b) => b.settingsCount - a.settingsCount);
}

/**
 * Simulates "what policies apply to this set of Entra groups" -- the
 * Policy-Sets-without-Policy-Sets view. All Devices / All Users always apply,
 * since every real device/user is implicitly a member of those assignment
 * targets. Excludes always win over includes, exactly like Intune itself.
 * An optional platform filter excludes policies targeting a different OS, so
 * e.g. macOS/iOS/Android compliance policies don't clutter a Windows-focused
 * simulation.
 */
export function computeSimulation(
  data: TenantData,
  options: { selectedGroupIds: string[]; platform?: Platform }
): SimulationResult {
  const groupMap = new Map(data.groups.map((g) => [g.id, g]));
  const groups: SimulationGroup[] = [];
  const seen = new Set<string>();

  const addGroup = (id: string, source: SimulationGroup["source"]) => {
    if (seen.has(id)) return;
    const group = groupMap.get(id) ?? { id, displayName: id };
    groups.push({ ...group, source });
    seen.add(id);
  };

  for (const groupId of options.selectedGroupIds) {
    addGroup(groupId, "selected");
  }
  addGroup(VIRTUAL_GROUP_ALL_DEVICES.id, "all-devices");
  addGroup(VIRTUAL_GROUP_ALL_USERS.id, "all-users");

  const groupIds = groups.map((g) => g.id);
  const candidatePolicies = options.platform
    ? data.policies.filter((p) => p.platform === options.platform)
    : data.policies;

  const policies: SimulationPolicy[] = [];
  const excludedPolicies: SimulationPolicy[] = [];

  for (const policy of candidatePolicies) {
    const viaGroupIds = policy.assignedGroupIds.filter((id) => groupIds.includes(id));
    const excludedViaGroupIds = policy.excludedGroupIds.filter((id) => groupIds.includes(id));
    if (viaGroupIds.length === 0) continue;

    const entry: SimulationPolicy = {
      id: policy.id,
      displayName: policy.displayName,
      kind: policy.kind,
      status: excludedViaGroupIds.length > 0 ? "excluded" : "included",
      viaGroupIds,
      excludedViaGroupIds,
    };
    (entry.status === "excluded" ? excludedPolicies : policies).push(entry);
  }

  const appliedPolicyObjs = candidatePolicies.filter((p) => policies.some((sp) => sp.id === p.id));
  const { settings, conflicts } = mergeSettings(appliedPolicyObjs);

  return { groups, policies, excludedPolicies, settings, conflicts };
}

export function simulationToCsv(simulation: SimulationResult): string {
  const header = ["CSP Area", "Setting", "Value", "Source Policy", "Policy Type", "Conflict"];
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));

  const rows: string[][] = [];
  for (const s of simulation.settings) {
    const conflict = conflictsBySettingId.get(s.settingId);
    if (!conflict) {
      rows.push([s.cspArea, s.displayName, s.value, s.sourcePolicyName, s.sourceKind, "no"]);
      continue;
    }
    // One row per conflicting policy/value, all sharing the same setting --
    // so both sides of the disagreement are visible directly in the export,
    // not just flagged on a single row.
    for (const v of conflict.values) {
      rows.push([conflict.cspArea, conflict.displayName, v.value, v.sourcePolicyName, v.sourceKind, "yes"]);
    }
  }

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}
