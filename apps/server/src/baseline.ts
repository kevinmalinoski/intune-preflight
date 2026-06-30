import type {
  AutopilotProfileSummary,
  BaselineSetting,
  ConflictingSetting,
  GraphEdge,
  GraphNode,
  GraphPayload,
  GroupBaseline,
  GroupSummary,
  SimulationGroup,
  SimulationPolicy,
  SimulationResult,
} from "@intune-baseline/shared";
import type { TenantData } from "./intuneData.js";
import { VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";

/** Pure function: no I/O. Computes, for one group, the merged CSP baseline and any conflicts. */
export function computeGroupBaseline(data: TenantData, groupId: string): GroupBaseline | undefined {
  const group = data.groups.find((g) => g.id === groupId);
  if (!group) return undefined;

  const assignedPolicies = data.policies.filter((p) => p.assignedGroupIds.includes(groupId));

  const bySettingId = new Map<string, BaselineSetting[]>();
  for (const policy of assignedPolicies) {
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
        })),
      });
    }
  }

  return {
    group,
    policies: assignedPolicies.map((p) => ({ id: p.id, displayName: p.displayName, kind: p.kind })),
    settings,
    conflicts,
  };
}

export function listGroupSummaries(data: TenantData): GroupSummary[] {
  return data.groups
    .filter((g) => !g.isVirtual || data.policies.some((p) => p.assignedGroupIds.includes(g.id)) || data.autopilotProfiles.some((a) => a.assignedGroupIds.includes(g.id)))
    .map((group) => {
      const baseline = computeGroupBaseline(data, group.id);
      return {
        id: group.id,
        displayName: group.displayName,
        policyCount: baseline?.policies.length ?? 0,
        settingsCount: baseline?.settings.length ?? 0,
        conflictCount: baseline?.conflicts.length ?? 0,
        isDynamic: group.isDynamic,
        membershipRule: group.membershipRule,
      };
    })
    .sort((a, b) => b.settingsCount - a.settingsCount);
}

export function listAutopilotProfiles(data: TenantData): AutopilotProfileSummary[] {
  return data.autopilotProfiles.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    osLabel: p.osLabel,
    assignedGroupIds: p.assignedGroupIds,
  }));
}

/**
 * Simulates "what policies apply to an endpoint" given the Entra groups it's a
 * member of (and/or an Autopilot deployment profile it would enroll through).
 * All Devices / All Users always apply, regardless of selection, since every
 * real device and user is implicitly a member of those Graph assignment targets.
 */
export function computeSimulation(
  data: TenantData,
  options: { selectedGroupIds: string[]; autopilotProfileId?: string }
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

  const autopilotProfile = data.autopilotProfiles.find((p) => p.id === options.autopilotProfileId);
  if (autopilotProfile) {
    for (const groupId of autopilotProfile.assignedGroupIds) {
      if (groupId === VIRTUAL_GROUP_ALL_DEVICES.id || groupId === VIRTUAL_GROUP_ALL_USERS.id) continue;
      addGroup(groupId, "autopilot");
    }
  }
  for (const groupId of options.selectedGroupIds) {
    addGroup(groupId, "selected");
  }
  addGroup(VIRTUAL_GROUP_ALL_DEVICES.id, "all-devices");
  addGroup(VIRTUAL_GROUP_ALL_USERS.id, "all-users");

  const groupIds = groups.map((g) => g.id);
  const policyMap = new Map<string, SimulationPolicy>();
  const bySettingId = new Map<string, BaselineSetting[]>();

  for (const policy of data.policies) {
    const viaGroupIds = policy.assignedGroupIds.filter((id) => groupIds.includes(id));
    if (viaGroupIds.length === 0) continue;

    policyMap.set(policy.id, { id: policy.id, displayName: policy.displayName, kind: policy.kind, viaGroupIds });

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
        })),
      });
    }
  }

  return { groups, policies: [...policyMap.values()], settings, conflicts };
}

export function simulationToCsv(simulation: SimulationResult): string {
  const header = ["CSP Area", "Setting", "Value", "Source Policy", "Policy Type", "Conflict"];
  const conflictIds = new Set(simulation.conflicts.map((c) => c.settingId));
  const rows = simulation.settings.map((s) => [
    s.cspArea,
    s.displayName,
    s.value,
    s.sourcePolicyName,
    s.sourceKind,
    conflictIds.has(s.settingId) ? "yes" : "no",
  ]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

export function buildGraphPayload(data: TenantData): GraphPayload {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const groupsInUse = new Set<string>();
  for (const p of data.policies) for (const g of p.assignedGroupIds) groupsInUse.add(g);
  for (const a of data.autopilotProfiles) for (const g of a.assignedGroupIds) groupsInUse.add(g);

  for (const group of data.groups) {
    if (!groupsInUse.has(group.id)) continue;
    nodes.push({ id: `group:${group.id}`, type: "group", label: group.displayName });
  }

  for (const policy of data.policies) {
    if (policy.assignedGroupIds.length === 0) continue;
    nodes.push({
      id: `policy:${policy.id}`,
      type: "policy",
      label: policy.displayName,
      kind: policy.kind,
      settingsCount: policy.settings.length,
    });
    for (const groupId of policy.assignedGroupIds) {
      edges.push({ id: `${policy.id}->${groupId}`, source: `policy:${policy.id}`, target: `group:${groupId}` });
    }
  }

  for (const profile of data.autopilotProfiles) {
    if (profile.assignedGroupIds.length === 0) continue;
    nodes.push({ id: `autopilot:${profile.id}`, type: "autopilot", label: profile.displayName, osLabel: profile.osLabel });
    for (const groupId of profile.assignedGroupIds) {
      edges.push({ id: `${profile.id}->${groupId}`, source: `autopilot:${profile.id}`, target: `group:${groupId}` });
    }
  }

  return { nodes, edges };
}

export function baselineToCsv(baseline: GroupBaseline): string {
  const header = ["CSP Area", "Setting", "Value", "Source Policy", "Policy Type", "Conflict"];
  const conflictIds = new Set(baseline.conflicts.map((c) => c.settingId));
  const rows = baseline.settings.map((s) => [
    s.cspArea,
    s.displayName,
    s.value,
    s.sourcePolicyName,
    s.sourceKind,
    conflictIds.has(s.settingId) ? "yes" : "no",
  ]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}
