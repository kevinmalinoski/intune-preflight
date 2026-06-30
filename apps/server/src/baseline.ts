import type {
  BaselineSetting,
  ConflictingSetting,
  GraphEdge,
  GraphNode,
  GraphPayload,
  GroupBaseline,
  GroupSummary,
  IntuneGroup,
  IntunePolicy,
  AutopilotProfile,
} from "@intune-baseline/shared";
import type { TenantData } from "./intuneData.js";

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
      };
    })
    .sort((a, b) => b.settingsCount - a.settingsCount);
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
