import type {
  AssignmentFilter,
  AssignmentFilterRef,
  AssignmentReport,
  AssignmentReportRow,
  BaselineSetting,
  ConflictingSetting,
  GroupKind,
  GroupOverlapSummary,
  GroupSummary,
  IntuneGroup,
  IntunePolicy,
  Platform,
  PolicyKind,
  PolicyOverlap,
  SimulationGroup,
  SimulationAutopilotProfile,
  SimulationPolicy,
  SimulationResult,
  UnassignedPolicy,
} from "@intune-preflight/shared";
import { UNASSIGNED_SOURCE_GROUP } from "@intune-preflight/shared";
import type { TenantData } from "./intuneData.js";
import { ruleImplies, VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";

/** A policy with no include assignment is deployed nowhere -- not to any group, nor All Devices/All Users. */
function isUnassigned(policy: IntunePolicy): boolean {
  return policy.assignedGroupIds.length === 0;
}

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
      // Every OS platform this group is meaningfully involved with -- either
      // included or excluded by a policy of that platform. Autopilot profiles
      // are Windows-only, so a group assigned to one counts as Windows. Used by
      // the picker to hide groups that are irrelevant to the simulated OS.
      const platforms = new Set<Platform>();
      for (const p of data.policies) {
        if (p.assignedGroupIds.includes(group.id) || p.excludedGroupIds.includes(group.id)) platforms.add(p.platform);
      }
      if (
        data.autopilotProfiles.some(
          (a) =>
            a.assignedGroupIds.includes(group.id) ||
            a.excludedGroupIds.includes(group.id) ||
            a.deviceGroupId === group.id
        )
      )
        platforms.add("windows");
      return {
        id: group.id,
        displayName: group.displayName,
        policyCount: applied.length,
        settingsCount: settings.length,
        conflictCount: conflicts.length,
        isDynamic: group.isDynamic,
        membershipRule: group.membershipRule,
        platforms: [...platforms],
      };
    })
    .sort((a, b) => b.settingsCount - a.settingsCount);
}

export function listAssignmentFilters(data: TenantData): AssignmentFilter[] {
  return data.assignmentFilters;
}

/**
 * Policies that exist in the tenant but are assigned to no group (nor All
 * Devices/All Users) -- so they never surface in a normal simulation. Returned
 * so the UI can offer them as manually-addable "what if I assigned this?"
 * policies. Optionally scoped to a single OS platform.
 */
export function listUnassignedPolicies(data: TenantData, platform?: Platform): UnassignedPolicy[] {
  return data.policies
    .filter((p) => isUnassigned(p) && (!platform || p.platform === platform))
    .map((p) => ({
      id: p.id,
      displayName: p.displayName,
      kind: p.kind,
      platform: p.platform,
      settingsCount: mergeSettings([p]).settings.length,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

function groupKindOf(group: IntuneGroup): GroupKind {
  if (group.isVirtual) return "virtual";
  if (group.isDynamic) return "dynamic";
  return "assigned";
}

/**
 * Tenant-wide policy-to-group assignment report. One row per assignment edge
 * (each include and each exclude), plus a per-group rollup ranking groups by how
 * many policies target them -- the assignment-overlap hotspots. Independent of
 * any endpoint simulation: this is the raw "who is assigned to what" inventory.
 */
export function buildAssignmentReport(data: TenantData, platform?: Platform): AssignmentReport {
  const policies = platform ? data.policies.filter((p) => p.platform === platform) : data.policies;
  const groupById = new Map<string, IntuneGroup>(data.groups.map((g) => [g.id, g]));
  const virtualById = new Map<string, IntuneGroup>([
    [VIRTUAL_GROUP_ALL_DEVICES.id, { ...VIRTUAL_GROUP_ALL_DEVICES, isVirtual: true }],
    [VIRTUAL_GROUP_ALL_USERS.id, { ...VIRTUAL_GROUP_ALL_USERS, isVirtual: true }],
  ]);
  const filterNameById = new Map(data.assignmentFilters.map((f) => [f.id, f.displayName]));

  const resolveGroup = (id: string): { name: string; kind: GroupKind } => {
    const g = groupById.get(id) ?? virtualById.get(id);
    return g ? { name: g.displayName, kind: groupKindOf(g) } : { name: id, kind: "assigned" };
  };

  const rows: AssignmentReportRow[] = [];
  for (const policy of policies) {
    const filterByGroupId = new Map(policy.assignmentFilters.map((f) => [f.groupId, f]));
    const rowBase = { policyId: policy.id, policyName: policy.displayName, kind: policy.kind, platform: policy.platform };

    for (const groupId of policy.assignedGroupIds) {
      const { name, kind } = resolveGroup(groupId);
      const filter = filterByGroupId.get(groupId);
      rows.push({
        ...rowBase,
        assignment: "Include",
        groupId,
        groupName: name,
        groupKind: kind,
        filterId: filter?.filterId,
        filterName: filter ? filterNameById.get(filter.filterId) ?? filter.filterId : undefined,
        filterType: filter?.filterType,
      });
    }
    for (const groupId of policy.excludedGroupIds) {
      const { name, kind } = resolveGroup(groupId);
      rows.push({ ...rowBase, assignment: "Exclude", groupId, groupName: name, groupKind: kind });
    }
  }

  // Roll up per group: distinct policies, include/exclude counts, platforms, kinds.
  const byGroup = new Map<string, Omit<GroupOverlapSummary, "impliedGroupIds"> & { policyIds: Set<string> }>();
  for (const row of rows) {
    let entry = byGroup.get(row.groupId);
    if (!entry) {
      entry = {
        groupId: row.groupId,
        groupName: row.groupName,
        groupKind: row.groupKind,
        includeCount: 0,
        excludeCount: 0,
        policyCount: 0,
        platforms: [],
        kinds: [],
        policyIds: new Set<string>(),
      };
      byGroup.set(row.groupId, entry);
    }
    if (row.assignment === "Include") entry.includeCount += 1;
    else entry.excludeCount += 1;
    entry.policyIds.add(row.policyId);
    if (!entry.platforms.includes(row.platform)) entry.platforms.push(row.platform);
    if (!entry.kinds.includes(row.kind)) entry.kinds.push(row.kind);
  }

  // Rule-implication (same best-effort logic the simulator uses): a dynamic
  // group's members are also members of any dynamic group whose rule its own
  // rule implies -- so it inherits that group's policies too. Only surface
  // implied groups that are themselves targeted (otherwise nothing to inherit).
  const dynamicGroups = data.groups.filter((g) => g.isDynamic && g.membershipRule);
  const impliedFor = (groupId: string): string[] => {
    const g = groupById.get(groupId);
    if (!g?.isDynamic || !g.membershipRule) return [];
    return dynamicGroups
      .filter((h) => h.id !== g.id && byGroup.has(h.id) && ruleImplies(g.membershipRule!, h.membershipRule!))
      .map((h) => h.id);
  };

  const groupOverlaps: GroupOverlapSummary[] = [...byGroup.values()]
    .map(({ policyIds, ...rest }) => ({ ...rest, policyCount: policyIds.size, impliedGroupIds: impliedFor(rest.groupId) }))
    .sort((a, b) => b.policyCount - a.policyCount || b.includeCount - a.includeCount || a.groupName.localeCompare(b.groupName));

  const unassigned = policies.filter(isUnassigned).length;
  return {
    rows,
    groupOverlaps,
    totals: {
      policies: policies.length,
      assigned: policies.length - unassigned,
      unassigned,
      groupsTargeted: byGroup.size,
    },
  };
}

/**
 * Escapes one CSV cell. Beyond RFC-4180 quoting, this neutralizes CSV/formula
 * injection: a value beginning with `= + - @` (or a tab/CR) is interpreted as a
 * formula by Excel/Sheets when the file is opened, so a policy or group named
 * e.g. `=HYPERLINK("http://evil","click")` in Intune could run against the admin
 * who exports and opens the report. Prefixing such values with a single quote
 * (the OWASP mitigation) forces them to be treated as text.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function assignmentReportToCsv(report: AssignmentReport): string {
  const header = ["Policy", "Policy Type", "Platform", "Assignment", "Group", "Group Type", "Assignment Filter"];
  const kindLabel = (k: PolicyKind) => k;
  const rows = report.rows.map((r) => [
    r.policyName,
    kindLabel(r.kind),
    r.platform,
    r.assignment,
    r.groupName,
    r.groupKind,
    r.filterName ? `${r.filterName}${r.filterType ? ` (${r.filterType})` : ""}` : "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
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
  options: {
    selectedGroupIds: string[];
    platform?: Platform;
    deviceFilterIds?: string[];
    /** Ids of otherwise-unassigned policies the admin manually pulled into the simulation. */
    unassignedPolicyIds?: string[];
  }
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
    [UNASSIGNED_SOURCE_GROUP.id, { ...UNASSIGNED_SOURCE_GROUP, isVirtual: true }],
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
        settingsCount: policy.settings.length,
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
        settingsCount: policy.settings.length,
        viaGroupIds: rawViaGroupIds,
        excludedViaGroupIds: [],
        excludedByFilter: failingFilter
          ? {
              filterId: failingFilter.filterId,
              filterName: filterNameById.get(failingFilter.filterId) ?? failingFilter.filterId,
              filterType: failingFilter.filterType,
            }
          : undefined,
      });
      continue;
    }

    policies.push({
      id: policy.id,
      displayName: policy.displayName,
      kind: policy.kind,
      status: "included",
      settingsCount: policy.settings.length,
      viaGroupIds: passingGroupIds,
      excludedViaGroupIds: [],
    });
  }

  // Manually-added unassigned policies: pulled in despite having no real group
  // assignment. They attach to a synthetic "No assignment" bucket so the
  // diagram can show they bypass the group layer, and they merge into the
  // baseline like any applied policy (so they surface conflicts/overlaps too).
  const requestedUnassigned = new Set(options.unassignedPolicyIds ?? []);
  const injectedUnassigned = requestedUnassigned.size
    ? candidatePolicies.filter(
        (p) => requestedUnassigned.has(p.id) && isUnassigned(p) && !policies.some((sp) => sp.id === p.id)
      )
    : [];
  if (injectedUnassigned.length > 0) {
    addGroup(UNASSIGNED_SOURCE_GROUP.id, "unassigned");
    for (const policy of injectedUnassigned) {
      policies.push({
        id: policy.id,
        displayName: policy.displayName,
        kind: policy.kind,
        status: "included",
        settingsCount: policy.settings.length,
        viaGroupIds: [UNASSIGNED_SOURCE_GROUP.id],
        excludedViaGroupIds: [],
        unassigned: true,
      });
    }
  }

  // Autopilot targeting (Windows-only): which v1 deployment profiles and v2
  // device-preparation policies the simulated endpoint's groups reach. A profile
  // whose exclusion matches is still returned -- flagged "excluded" -- because
  // "you thought this would deploy but it's carved out" is exactly what a
  // preflight should surface. Both generations can match at once (some
  // environments retro-enroll v1 after a v2 enrollment); the UI shows both.
  const autopilotProfiles: SimulationAutopilotProfile[] = [];
  if (!options.platform || options.platform === "windows") {
    for (const ap of data.autopilotProfiles) {
      // v1 targets the device groups it's assigned to. v2 is device-focused via
      // the policy's configured (just-in-time) Autopilot device group -- the
      // user-group assignment governs who may enroll, not which device this is.
      const targetGroupIds = ap.generation === "v2" ? (ap.deviceGroupId ? [ap.deviceGroupId] : []) : ap.assignedGroupIds;
      const viaGroupIds = targetGroupIds.filter((id) => groupIds.includes(id));
      if (viaGroupIds.length === 0) continue;
      const excludedViaGroupIds = ap.excludedGroupIds.filter((id) => groupIds.includes(id));
      autopilotProfiles.push({
        id: ap.id,
        displayName: ap.displayName,
        generation: ap.generation,
        status: excludedViaGroupIds.length > 0 ? "excluded" : "targeted",
        viaGroupIds,
        excludedViaGroupIds,
        settings: ap.settings,
      });
    }
  }

  const appliedPolicyObjs = candidatePolicies.filter((p) => policies.some((sp) => sp.id === p.id));
  const { settings, conflicts, overlaps } = mergeSettings(appliedPolicyObjs);

  // Conflict AND overlap detection is only trustworthy on Windows today. Other
  // platforms share profile metadata (macOS .mobileconfig deploymentChannel,
  // payload file names, ...) that surfaces as false overlaps, and their policy
  // frameworks don't map cleanly onto value-level comparison -- e.g. the
  // OIB-style pattern of one-concern-per-macOS-compliance-policy produces false
  // conflicts from schema defaults. Suppress both off Windows until each platform
  // gets proper per-platform handling (see ROADMAP.md). The merged baseline
  // (every applied setting) is still shown on all platforms.
  const isWindows = options.platform === "windows";
  const platformConflicts = isWindows ? conflicts : [];
  const platformOverlaps = isWindows ? overlaps : [];

  return {
    groups,
    autopilotProfiles,
    policies,
    excludedPolicies,
    settings,
    conflicts: platformConflicts,
    overlaps: platformOverlaps,
  };
}

export function simulationToCsv(simulation: SimulationResult): string {
  const header = ["CSP Area", "Setting", "CSP Path", "Value", "Source Policy", "Policy Type", "Conflict", "Policy Overlap"];
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));
  const overlapsBySettingId = new Map(simulation.overlaps.map((o) => [o.settingId, o]));

  const rows: string[][] = [];
  for (const s of simulation.settings) {
    const path = s.cspPath ?? s.settingId;
    const conflict = conflictsBySettingId.get(s.settingId);
    if (conflict) {
      // One row per conflicting policy/value, all sharing the same setting --
      // so both sides of the disagreement are visible directly in the export,
      // not just flagged on a single row.
      for (const v of conflict.values) {
        rows.push([conflict.cspArea, conflict.displayName, path, v.value, v.sourcePolicyName, v.sourceKind, "yes", "no"]);
      }
      continue;
    }
    const overlap = overlapsBySettingId.get(s.settingId);
    if (overlap) {
      // Same idea, but for policies that agree on the value -- still worth
      // surfacing as redundant configuration, distinct from a real conflict.
      for (const sp of overlap.sourcePolicies) {
        rows.push([overlap.cspArea, overlap.displayName, path, overlap.value, sp.sourcePolicyName, sp.sourceKind, "no", "yes"]);
      }
      continue;
    }
    rows.push([s.cspArea, s.displayName, path, s.value, s.sourcePolicyName, s.sourceKind, "no", "no"]);
  }

  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}
