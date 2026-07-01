import type {
  AssignmentFilter,
  AssignmentFilterRef,
  BaselineSetting,
  ConflictingSetting,
  GroupSummary,
  IntunePolicy,
  Platform,
  PolicyOverlap,
  SimulationGroup,
  SimulationPolicy,
  SimulationResult,
} from "@intune-preflight/shared";
import type { TenantData } from "./intuneData.js";
import { ruleImplies, VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";

/**
 * Whether a single group assignment's filter allows it to apply, given which
 * filter(s) (if any) are selected as representing the simulated device. A
 * device can match more than one Assignment Filter at once (e.g. "Kiosk
 * Devices" AND "Corporate Owned"), so this checks set membership rather than
 * equality. A missing entry means the assignment has no filter, so it always
 * passes.
 */
function passesAssignmentFilter(filterRef: AssignmentFilterRef | undefined, selectedFilterIds: string[]): boolean {
  if (!filterRef) return true;
  if (filterRef.filterType === "exclude") return !selectedFilterIds.includes(filterRef.filterId);
  return selectedFilterIds.includes(filterRef.filterId);
}

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

/**
 * When multiple applied policies set the same CSP setting, only a genuine
 * disagreement (different values) is a Conflict. Multiple policies setting
 * the same value to the same thing is not a conflict -- it's redundant
 * configuration, tracked separately as a Policy Overlap so it doesn't get
 * lost among real conflicts but also isn't reported as a false alarm.
 */
function mergeSettings(
  policies: IntunePolicy[]
): { settings: BaselineSetting[]; conflicts: ConflictingSetting[]; overlaps: PolicyOverlap[] } {
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
  const overlaps: PolicyOverlap[] = [];
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
    } else if (entries.length > 1) {
      overlaps.push({
        settingId,
        cspArea: entries[0].cspArea,
        displayName: entries[0].displayName,
        value: entries[0].value,
        sourcePolicies: entries.map((e) => ({
          sourcePolicyId: e.sourcePolicyId,
          sourcePolicyName: e.sourcePolicyName,
          sourceKind: e.sourceKind,
        })),
      });
    }
  }
  return { settings, conflicts, overlaps };
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

export function listAssignmentFilters(data: TenantData): AssignmentFilter[] {
  return data.assignmentFilters;
}

/**
 * Simulates "what policies apply to this set of Entra groups" -- the
 * Policy-Sets-without-Policy-Sets view. All Devices / All Users always apply,
 * since every real device/user is implicitly a member of those assignment
 * targets. Excludes always win over includes, exactly like Intune itself.
 * An optional platform filter excludes policies targeting a different OS, so
 * e.g. macOS/iOS/Android compliance policies don't clutter a Windows-focused
 * simulation. An optional device filter represents which Assignment Filter
 * (if any) the simulated device matches -- e.g. selecting "Kiosk Devices"
 * correctly excludes policies whose assignment excludes that filter, which
 * group/exclude logic alone can't see. A device can match multiple filters
 * at once, so this accepts a set of selected filter ids.
 */
export function computeSimulation(
  data: TenantData,
  options: { selectedGroupIds: string[]; platform?: Platform; deviceFilterIds?: string[] }
): SimulationResult {
  const deviceFilterIds = options.deviceFilterIds ?? [];
  const groupMap = new Map(data.groups.map((g) => [g.id, g]));
  const filterNameById = new Map(data.assignmentFilters.map((f) => [f.id, f.displayName]));
  const groups: SimulationGroup[] = [];
  const seen = new Set<string>();

  // The two virtual targets aren't guaranteed to be in data.groups (they're only
  // added there if some policy/Autopilot profile happens to reference them) --
  // fall back to their known display names rather than the raw "virtual-..." id.
  const virtualGroupsById = new Map([
    [VIRTUAL_GROUP_ALL_DEVICES.id, VIRTUAL_GROUP_ALL_DEVICES],
    [VIRTUAL_GROUP_ALL_USERS.id, VIRTUAL_GROUP_ALL_USERS],
  ]);

  const addGroup = (id: string, source: SimulationGroup["source"], impliedByGroupNames?: string[]) => {
    if (seen.has(id)) return;
    const group = groupMap.get(id) ?? virtualGroupsById.get(id) ?? { id, displayName: id };
    groups.push({ ...group, source, impliedByGroupNames });
    seen.add(id);
  };

  for (const groupId of options.selectedGroupIds) {
    addGroup(groupId, "selected");
  }

  // A dynamic group's membership rule can logically guarantee membership in
  // another dynamic group too (e.g. a group scoped to OrderID prefix
  // "SALES-KIOSK-SINGLE" is always a subset of one scoped to "SALES-KIOSK").
  // Surface those as "implied" rather than silently folding them into the
  // selection, since rule-implication detection here is best-effort (see
  // ruleImplies in normalize.ts) and should be eyeballed against Entra.
  const dynamicGroups = data.groups.filter((g) => g.isDynamic && g.membershipRule);
  for (const selectedId of options.selectedGroupIds) {
    const selectedGroup = dynamicGroups.find((g) => g.id === selectedId);
    if (!selectedGroup) continue;
    for (const candidate of dynamicGroups) {
      if (seen.has(candidate.id) || candidate.id === selectedGroup.id) continue;
      if (ruleImplies(selectedGroup.membershipRule, candidate.membershipRule)) {
        addGroup(candidate.id, "implied", [selectedGroup.displayName]);
      }
    }
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
    const rawViaGroupIds = policy.assignedGroupIds.filter((id) => groupIds.includes(id));
    const excludedViaGroupIds = policy.excludedGroupIds.filter((id) => groupIds.includes(id));
    if (rawViaGroupIds.length === 0) continue;

    if (excludedViaGroupIds.length > 0) {
      excludedPolicies.push({
        id: policy.id,
        displayName: policy.displayName,
        kind: policy.kind,
        status: "excluded",
        viaGroupIds: rawViaGroupIds,
        excludedViaGroupIds,
      });
      continue;
    }

    const filterByGroupId = new Map(policy.assignmentFilters.map((f) => [f.groupId, f]));
    const passingGroupIds = rawViaGroupIds.filter((id) => passesAssignmentFilter(filterByGroupId.get(id), deviceFilterIds));

    if (passingGroupIds.length === 0) {
      const failingFilter = filterByGroupId.get(rawViaGroupIds[0]);
      excludedPolicies.push({
        id: policy.id,
        displayName: policy.displayName,
        kind: policy.kind,
        status: "excluded",
        viaGroupIds: rawViaGroupIds,
        excludedViaGroupIds: [],
        excludedByFilter: failingFilter
          ? { filterId: failingFilter.filterId, filterName: filterNameById.get(failingFilter.filterId) ?? failingFilter.filterId }
          : undefined,
      });
      continue;
    }

    policies.push({
      id: policy.id,
      displayName: policy.displayName,
      kind: policy.kind,
      status: "included",
      viaGroupIds: passingGroupIds,
      excludedViaGroupIds: [],
    });
  }

  const appliedPolicyObjs = candidatePolicies.filter((p) => policies.some((sp) => sp.id === p.id));
  const { settings, conflicts, overlaps } = mergeSettings(appliedPolicyObjs);

  return { groups, policies, excludedPolicies, settings, conflicts, overlaps };
}

export function simulationToCsv(simulation: SimulationResult): string {
  const header = ["CSP Area", "Setting", "Value", "Source Policy", "Policy Type", "Conflict", "Policy Overlap"];
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));
  const overlapsBySettingId = new Map(simulation.overlaps.map((o) => [o.settingId, o]));

  const rows: string[][] = [];
  for (const s of simulation.settings) {
    const conflict = conflictsBySettingId.get(s.settingId);
    if (conflict) {
      // One row per conflicting policy/value, all sharing the same setting --
      // so both sides of the disagreement are visible directly in the export,
      // not just flagged on a single row.
      for (const v of conflict.values) {
        rows.push([conflict.cspArea, conflict.displayName, v.value, v.sourcePolicyName, v.sourceKind, "yes", "no"]);
      }
      continue;
    }
    const overlap = overlapsBySettingId.get(s.settingId);
    if (overlap) {
      // Same idea, but for policies that agree on the value -- still worth
      // surfacing as redundant configuration, distinct from a real conflict.
      for (const sp of overlap.sourcePolicies) {
        rows.push([overlap.cspArea, overlap.displayName, overlap.value, sp.sourcePolicyName, sp.sourceKind, "no", "yes"]);
      }
      continue;
    }
    rows.push([s.cspArea, s.displayName, s.value, s.sourcePolicyName, s.sourceKind, "no", "no"]);
  }

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}
