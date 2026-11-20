import type {
  AssignmentFilter,
  AssignmentReport,
  AssignmentReportRow,
  BaselineSetting,
  ConflictingSetting,
  CrossModelFinding,
  GroupKind,
  GroupOverlapSummary,
  GroupSummary,
  IntuneGroup,
  IntunePolicy,
  LayeredSetting,
  Platform,
  PolicyKind,
  PolicyOverlap,
  ProfileNameWarning,
  SimulationGroup,
  SimulationAutopilotProfile,
  SimulationPolicy,
  SimulationResult,
  UnassignedPolicy,
} from "@intune-preflight/shared";
import {
  APP_DETECTION_METHOD_LABEL,
  APP_FINDING_RULES,
  APP_FAMILY_LABEL,
  APP_LOB_LEARN_URL,
  appIntentLabel,
  enrollmentProfileNamesInRule,
  resolutionRuleLabel,
  UNASSIGNED_SOURCE_GROUP,
} from "@intune-preflight/shared";
import type { TenantData } from "./tenantData.js";
import { appPlatforms, simulateApps } from "./apps.js";
import { passesAssignmentFilter } from "./assignmentFilter.js";
import { ruleImplies, VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";
import { rowsToXlsx, sheetsToXlsx } from "./xlsx.js";

/** A policy with no include assignment is deployed nowhere -- not to any group, nor All Devices/All Users. */
function isUnassigned(policy: IntunePolicy): boolean {
  return policy.assignedGroupIds.length === 0;
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
 * When multiple applied policies set the same CSP setting, the outcome falls
 * into exactly one of three buckets:
 *
 *   Conflict -- they disagree, and the policy type resolves that by one policy
 *     overriding another, which Intune refuses to do: it reports a conflict and
 *     applies NEITHER value until an admin resolves it.
 *   Layered  -- they disagree, but the type resolves it under a documented rule
 *     instead (feature update profiles take the latest version, compliance
 *     policies the most restrictive, ...). Calling that a conflict would tell an
 *     admin the device is stuck when it isn't. See LayeredSetting.
 *   Overlap  -- they agree. Not a disagreement at all, just redundant
 *     configuration, tracked separately so it doesn't get lost among real
 *     conflicts and isn't reported as a false alarm. Agreement is redundancy
 *     whatever the type's resolution rule, so this arm is reached regardless.
 *
 * No bucket computes a winner. A layered finding names the rule and lists every
 * contributing value with equal standing -- it does not apply the rule.
 */
function mergeSettings(policies: IntunePolicy[]): {
  settings: BaselineSetting[];
  conflicts: ConflictingSetting[];
  layered: LayeredSetting[];
  overlaps: PolicyOverlap[];
} {
  const bySettingId = new Map<string, BaselineSetting[]>();
  for (const policy of policies) {
    for (const setting of policy.settings) {
      const entry: BaselineSetting = {
        ...setting,
        sourcePolicyId: policy.id,
        sourcePolicyName: policy.displayName,
        sourceKind: policy.kind,
        sourceLegacyTemplate: policy.legacyTemplate,
      };
      const list = bySettingId.get(setting.settingId) ?? [];
      list.push(entry);
      bySettingId.set(setting.settingId, list);
    }
  }

  const settings: BaselineSetting[] = [];
  const conflicts: ConflictingSetting[] = [];
  const layered: LayeredSetting[] = [];
  const overlaps: PolicyOverlap[] = [];
  for (const [settingId, entries] of bySettingId) {
    const distinctValues = new Set(entries.map((e) => e.value));
    const disagrees = distinctValues.size > 1;
    // A setting's resolution rule comes from its policy TYPE, and the settingId
    // is namespaced by that type (`<typeKey>:<key>`) -- so every entry in a
    // bucket necessarily carries the same rule. Requiring them to agree makes
    // that a checked assumption rather than an assumed one: a mixed bucket
    // falls back to `undefined`, i.e. the conservative "this is a conflict"
    // reading, rather than silently adopting whichever entry came first.
    const rules = new Set(entries.map((e) => e.resolution));
    const rule = rules.size === 1 ? entries[0].resolution : undefined;
    // ONE baseline row per setting. When the contributing policies disagree,
    // that row is the first one reached -- an arbitrary pick, not a computed
    // winner -- so flag it. That is as true of a layered setting as a conflicted
    // one: `layered` does NOT mean `value` is what the rule would select. The UI
    // and CSV expand either kind of disagreement to a row per value; the flags
    // are what stop a JSON/API consumer reading this single `value` as the
    // effective one. See BaselineSetting.conflicted / .layered.
    const flagged: BaselineSetting = !disagrees
      ? entries[0]
      : rule
        ? { ...entries[0], layered: true }
        : { ...entries[0], conflicted: true };
    settings.push(flagged);
    const common = { settingId, cspArea: entries[0].cspArea, displayName: entries[0].displayName };
    const contributors = entries.map((e) => ({
      value: e.value,
      sourcePolicyId: e.sourcePolicyId,
      sourcePolicyName: e.sourcePolicyName,
      sourceKind: e.sourceKind,
    }));
    if (disagrees && rule) {
      // List a layered setting's values in ascending natural order (24H2, 25H2,
      // 26H2; ISO dates oldest first), ties broken by policy name. Merge order
      // is just the order Graph happened to return the policies, which reads as
      // random next to a rule called "latest version". Ordering is NOT ranking:
      // no winner is implied, the list is only made scannable. Sorted here, not
      // in a renderer, so the exports agree with the screen.
      const ordered = [...contributors].sort(
        (a, b) =>
          String(a.value).localeCompare(String(b.value), undefined, { numeric: true, sensitivity: "base" }) ||
          a.sourcePolicyName.localeCompare(b.sourcePolicyName, undefined, { numeric: true, sensitivity: "base" })
      );
      layered.push({ ...common, rule, values: ordered });
    } else if (disagrees) {
      conflicts.push({ ...common, values: contributors });
    } else if (entries.length > 1) {
      overlaps.push({
        ...common,
        value: entries[0].value,
        sourcePolicies: entries.map((e) => ({
          sourcePolicyId: e.sourcePolicyId,
          sourcePolicyName: e.sourcePolicyName,
          sourceKind: e.sourceKind,
        })),
      });
    }
  }

  // Order the merged baseline by CSP area, A-Z.
  //
  // Until now it came out in merge order -- the order the policies happened to
  // be walked -- which is an implementation detail of the loop above, not
  // anything a reader can use. On a real tenant that scatters the areas:
  // Bitlocker, then Microsoft, then two unrelated OneDrive ADMX areas, then
  // Bitlocker again if a second policy touched it. Nothing on screen explains
  // the sequence, because there is nothing to explain.
  //
  // The sort is stable, so settings WITHIN an area keep merge order, which does
  // mean something: they arrive in the order their policy declares them, and a
  // policy's own settings stay together.
  //
  // Sorted here rather than in a renderer because the exports read this array
  // too (`simulationRows`). Sorting in the UI would have the .xlsx disagree
  // with the screen it was exported from.
  //
  // An empty area sorts last: the UI renders those under "Other", and a
  // nameless bucket belongs at the end rather than above "Accounts".
  settings.sort((a, b) => {
    if (!a.cspArea !== !b.cspArea) return a.cspArea ? -1 : 1;
    return a.cspArea.localeCompare(b.cspArea, undefined, { sensitivity: "base" });
  });

  return { settings, conflicts, layered, overlaps };
}

/**
 * The enrollment profile names a rule compares against exactly that no
 * Windows Autopilot profile or device preparation policy is called, each with
 * the profile it differs from only by spaces, if any. Empty when the tenant's
 * profiles were not read: with none to compare against, every name would look
 * stale.
 *
 * Entra compares these strings ignoring case but not spaces, so names are
 * matched lowercased and NOT trimmed -- a trailing space in a profile's name
 * really does stop a rule written without it from matching.
 */
function staleProfileNamesIn(rule: string | undefined, data: TenantData): { name: string; closest?: string }[] {
  if (data.autopilotProfiles.length === 0) return [];
  const exact = new Set(data.autopilotProfiles.map((a) => a.displayName.toLowerCase()));
  const byTrimmed = new Map(data.autopilotProfiles.map((a) => [a.displayName.trim().toLowerCase(), a.displayName]));
  return enrollmentProfileNamesInRule(rule)
    .filter(
      (name) =>
        !exact.has(name.toLowerCase()) &&
        // Autopilot for existing devices writes this prefix; it names no profile.
        !name.trim().toLowerCase().startsWith("offlineautopilotprofile-")
    )
    .map((name) => {
      const closest = byTrimmed.get(name.trim().toLowerCase());
      return closest ? { name, closest } : { name };
    });
}

/**
 * Whether a rule's enrollment profile names are Windows ones, judged from the
 * rule itself -- for groups nothing is assigned to, which have no platform to
 * go by. Apple and Android enrollment profiles use the same property, so a
 * name matching no Autopilot profile is only worth flagging when the rule is
 * evidently about Windows: it tests the OS against Windows, or another of its
 * names is a current Autopilot profile.
 */
function isWindowsProfileRule(rule: string | undefined, data: TenantData): boolean {
  if (!rule) return false;
  if (/device\.deviceOSType\s+-(?:eq|startsWith|contains)\s+"windows/i.test(rule)) return true;
  const names = new Set(data.autopilotProfiles.map((a) => a.displayName.toLowerCase()));
  return enrollmentProfileNamesInRule(rule).some((n) => names.has(n.toLowerCase()));
}

/**
 * Every dynamic group in the tenant -- assigned or not -- whose rule names an
 * enrollment profile that no Windows Autopilot profile or device preparation
 * policy is called. An assigned group counts when it carries Windows
 * assignments; an unassigned one when its rule is evidently about Windows.
 */
export function listProfileNameWarnings(data: TenantData): ProfileNameWarning[] {
  const assigned = new Map(listGroupSummaries(data).map((g) => [g.id, g]));
  const candidates = new Map<string, IntuneGroup>();
  for (const g of [...data.groups, ...(data.profileRuleGroups ?? [])]) {
    if (g.isDynamic && g.membershipRule && !candidates.has(g.id)) candidates.set(g.id, g);
  }
  const out: ProfileNameWarning[] = [];
  for (const g of candidates.values()) {
    const summary = assigned.get(g.id);
    const isAssigned = Boolean(summary && !summary.nestedOnly);
    const windows = summary?.platforms.includes("windows") || isWindowsProfileRule(g.membershipRule, data);
    if (!windows) continue;
    const names = staleProfileNamesIn(g.membershipRule, data);
    if (names.length === 0) continue;
    out.push({ groupId: g.id, displayName: g.displayName, portalUrl: g.portalUrl, assigned: isAssigned, names });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

export function listGroupSummaries(data: TenantData): GroupSummary[] {
  // Every OS platform a group is meaningfully involved with -- either included
  // or excluded by a policy of that platform. Autopilot profiles are
  // Windows-only, so a group assigned to one counts as Windows. Used by the
  // picker to hide groups that are irrelevant to the simulated OS.
  const ownPlatforms = (groupId: string): Set<Platform> => {
    const platforms = new Set<Platform>();
    for (const p of data.policies) {
      if (p.assignedGroupIds.includes(groupId) || p.excludedGroupIds.includes(groupId)) platforms.add(p.platform);
    }
    if (
      data.autopilotProfiles.some(
        (a) =>
          a.assignedGroupIds.includes(groupId) || a.excludedGroupIds.includes(groupId) || a.deviceGroupId === groupId
      )
    )
      platforms.add("windows");
    // A group that only delivers apps is still one an admin may simulate, so
    // it has to count toward its apps' platforms or the picker would hide it.
    for (const app of data.apps ?? []) {
      if (app.assignments.some((a) => a.groupId === groupId)) for (const p of appPlatforms(app)) platforms.add(p);
    }
    return platforms;
  };
  const own = new Map(data.groups.map((g) => [g.id, ownPlatforms(g.id)]));

  return data.groups
    .filter(
      (g) =>
        !g.isVirtual ||
        data.policies.some((p) => p.assignedGroupIds.includes(g.id)) ||
        (data.apps ?? []).some((a) => a.assignments.some((x) => !x.exclude && x.groupId === g.id)) ||
        data.autopilotProfiles.some((a) => a.assignedGroupIds.includes(g.id))
    )
    .map((group) => {
      const applied = data.policies.filter((p) => appliesTo(p, [group.id]));
      const { settings, conflicts } = mergeSettings(applied);
      // A nested group delivers what its parents deliver, so it is relevant on
      // their platforms as well as on its own.
      const platforms = new Set(own.get(group.id));
      for (const parent of group.parentGroupIds ?? []) for (const p of own.get(parent) ?? []) platforms.add(p);
      const staleProfileNames = platforms.has("windows") ? staleProfileNamesIn(group.membershipRule, data) : [];
      return {
        id: group.id,
        displayName: group.displayName,
        portalUrl: group.portalUrl,
        policyCount: applied.length,
        settingsCount: settings.length,
        conflictCount: conflicts.length,
        isDynamic: group.isDynamic,
        membershipRule: group.membershipRule,
        platforms: [...platforms],
        ...(group.parentGroupIds?.length ? { parentGroupIds: group.parentGroupIds } : {}),
        ...(group.nestedOnly ? { nestedOnly: true } : {}),
        ...(staleProfileNames.length ? { staleProfileNames } : {}),
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
    const rowBase = {
      policyId: policy.id,
      policyName: policy.displayName,
      kind: policy.kind,
      platform: policy.platform,
      legacyTemplate: policy.legacyTemplate,
    };

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
        filterName: filter ? (filterNameById.get(filter.filterId) ?? filter.filterId) : undefined,
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
    .map(({ policyIds, ...rest }) => ({
      ...rest,
      policyCount: policyIds.size,
      impliedGroupIds: impliedFor(rest.groupId),
    }))
    .sort(
      (a, b) =>
        b.policyCount - a.policyCount || b.includeCount - a.includeCount || a.groupName.localeCompare(b.groupName)
    );

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

/**
 * Rows to CSV text, with a UTF-8 BOM and CRLF between records.
 *
 * Excel is where these files are going and it is stricter than the format they
 * are in. Without the BOM it guesses the encoding, and Excel on iPadOS refuses
 * the file outright as corrupt rather than guessing wrong visibly. RFC 4180
 * specifies CRLF between records; desktop Excel forgives LF and mobile Excel
 * does not. Quick Look renders the same bytes perfectly either way, which is
 * what makes this present as a mystery rather than as a format problem.
 *
 * It lives here, not at the download, so the self-hosted, demo and browser
 * builds cannot emit different bytes for the same export -- the server streams
 * this string straight out of /api/.../export and the browser builds wrap it in
 * a Blob, and those two have drifted before.
 */
function toCsv(rows: string[][]): string {
  return "\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * The assignment report as a header row plus one row per assignment -- the one
 * description of the export's content, shared by every format it is offered in.
 *
 * Split out from the CSV producer when xlsx joined it: two exporters each
 * building their own rows is two places for a column to be added, and the
 * formats would eventually have disagreed about what the report says.
 */
function assignmentReportRows(report: AssignmentReport): string[][] {
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
  return [header, ...rows];
}

export function assignmentReportToCsv(report: AssignmentReport): string {
  return toCsv(assignmentReportRows(report));
}

/**
 * The same report as an .xlsx workbook.
 *
 * Offered alongside the CSV because Excel for iPadOS will not open the CSV at
 * all, however correct it is -- see xlsx.ts for why that is the format's
 * problem and not the file's.
 */
export function assignmentReportToXlsx(report: AssignmentReport): Uint8Array {
  return rowsToXlsx(assignmentReportRows(report), { sheetName: "Assignments" });
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
        portalUrl: policy.portalUrl,
        legacyTemplate: policy.legacyTemplate,
        status: "excluded",
        settingsCount: policy.settings.length,
        viaGroupIds: rawViaGroupIds,
        excludedViaGroupIds,
      });
      continue;
    }

    const filterByGroupId = new Map(policy.assignmentFilters.map((f) => [f.groupId, f]));
    const passingGroupIds = rawViaGroupIds.filter((id) =>
      passesAssignmentFilter(filterByGroupId.get(id), deviceFilterIds)
    );

    if (passingGroupIds.length === 0) {
      const failingFilter = filterByGroupId.get(rawViaGroupIds[0]);
      excludedPolicies.push({
        id: policy.id,
        displayName: policy.displayName,
        kind: policy.kind,
        portalUrl: policy.portalUrl,
        legacyTemplate: policy.legacyTemplate,
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
      portalUrl: policy.portalUrl,
      legacyTemplate: policy.legacyTemplate,
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
        portalUrl: policy.portalUrl,
        legacyTemplate: policy.legacyTemplate,
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
      const targetGroupIds =
        ap.generation === "v2" ? (ap.deviceGroupId ? [ap.deviceGroupId] : []) : ap.assignedGroupIds;
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

  // Apps resolve against the same groups and device filters as policies, but
  // never enter the merged baseline -- see apps.ts.
  const apps = simulateApps(data, { groupIds, platform: options.platform, deviceFilterIds });

  const appliedPolicyObjs = candidatePolicies.filter((p) => policies.some((sp) => sp.id === p.id));
  const { settings, conflicts, layered, overlaps } = mergeSettings(appliedPolicyObjs);

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
  const platformLayered = isWindows ? layered : [];
  const platformOverlaps = isWindows ? overlaps : [];
  const crossModel = isWindows ? detectCrossModel(settings) : [];
  // `conflicted` and `layered` follow the same platform gate, so a flag on a
  // setting always pairs with an entry in `conflicts` / `layered` it can be
  // cross-referenced against. Left set off Windows they would point at a
  // deliberately empty list.
  const platformSettings = isWindows
    ? settings
    : settings.map((s) => {
        if (!s.conflicted && !s.layered) return s;
        const { conflicted, layered: isLayered, ...rest } = s;
        void conflicted;
        void isLayered;
        return rest;
      });

  return {
    groups,
    autopilotProfiles,
    policies,
    excludedPolicies,
    settings: platformSettings,
    conflicts: platformConflicts,
    layered: platformLayered,
    overlaps: platformOverlaps,
    crossModel,
    ...(apps ? { apps } : {}),
  };
}

/**
 * Cross-MODEL detection: the SAME underlying CSP (`cspNode`) configured by
 * policies of DIFFERENT models -- e.g. a legacy Device Restrictions template and
 * a Settings Catalog policy -- which the per-model settingId keying never sees as
 * a conflict/overlap. Only settings with a known canonical `cspNode` participate
 * (Settings Catalog + OMA-URI via their real path; legacy templates via the
 * curated crosswalk), so this is best-effort over common settings. Operates on
 * the already-deduped merged `settings` (one entry per settingId), so two
 * policies of the SAME model don't trigger it -- that's a normal conflict/overlap.
 */
function detectCrossModel(settings: BaselineSetting[]): CrossModelFinding[] {
  const byNode = new Map<string, BaselineSetting[]>();
  for (const s of settings) {
    if (!s.cspNode) continue;
    const list = byNode.get(s.cspNode) ?? [];
    list.push(s);
    byNode.set(s.cspNode, list);
  }
  const canonical = (e: BaselineSetting): string | undefined => (e.sourceLegacyTemplate ? e.cspNodeValue : e.value);
  // Coarse block/allow bucketing so equivalent labels across models
  // ("Block" / "Not allowed" / "0" -- "Allow" / "Allowed" / "1") don't read as a
  // false conflict. Anything unrecognized compares on its own lowercased value.
  const RESTRICT = new Set([
    "block",
    "blocked",
    "not allowed",
    "notallowed",
    "disabled",
    "deny",
    "denied",
    "0",
    "false",
  ]);
  const PERMIT = new Set(["allow", "allowed", "enabled", "1", "true"]);
  const coarse = (v: string): string => {
    const t = v.trim().toLowerCase();
    return RESTRICT.has(t) ? "restrict" : PERMIT.has(t) ? "permit" : t;
  };
  // The setting's policy MODEL, from its settingId scheme. A single policy's
  // settings all share one model, so requiring 2+ models is what makes this
  // cross-MODEL -- NOT merely 2+ settingIds (a complex/collection Settings Catalog
  // setting expands into many sub-settings that all normalize to one cspNode
  // within the SAME policy, which must not be flagged).
  const modelOf = (id: string): string =>
    id.startsWith("omaUri:")
      ? "oma"
      : id.startsWith("endpointSecurity:")
        ? "intent"
        : id.includes(":")
          ? "template"
          : "catalog";
  const findings: CrossModelFinding[] = [];
  for (const [cspNode, group] of byNode) {
    // Collapse to one representative per source POLICY -- a complex Settings
    // Catalog setting contributes several sub-settings on one node from one policy.
    const perPolicy = [...new Map(group.map((g) => [g.sourcePolicyId, g])).values()];
    // Genuinely cross-model only when 2+ policies of 2+ DIFFERENT models touch it.
    if (perPolicy.length < 2 || new Set(perPolicy.map((g) => modelOf(g.settingId))).size < 2) continue;
    const cvs = perPolicy.map(canonical);
    const agreement: CrossModelFinding["agreement"] = cvs.some((v) => v === undefined)
      ? "unknown"
      : new Set(cvs.map((v) => coarse(v as string))).size > 1
        ? "differs"
        : "same";
    findings.push({
      cspNode,
      // Prefer a Settings Catalog entry's name (nicest), else any entry's.
      displayName: (perPolicy.find((g) => !g.sourceLegacyTemplate) ?? perPolicy[0]).displayName,
      agreement,
      entries: perPolicy.map((e) => ({
        settingId: e.settingId,
        value: e.value,
        canonicalValue: canonical(e),
        sourcePolicyId: e.sourcePolicyId,
        sourcePolicyName: e.sourcePolicyName,
        sourceKind: e.sourceKind,
        sourceLegacyTemplate: e.sourceLegacyTemplate,
      })),
    });
  }
  return findings.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

/**
 * The merged baseline as a header row plus one row per contributing value --
 * the single description of the export's content, whatever format it is asked
 * for. See `assignmentReportRows` for why this is not inside a formatter.
 */
function simulationRows(simulation: SimulationResult): string[][] {
  const header = [
    "CSP Area",
    "Setting",
    "CSP Path",
    "Value",
    "Source Policy",
    "Policy Type",
    "Conflict",
    "Policy Overlap",
    // Blank unless the row is a layered disagreement, where it names the rule
    // that resolves it. Deliberately the RULE and not a winner: every
    // contributing value still gets its own row, none of them marked effective.
    "Resolution",
  ];
  const conflictsBySettingId = new Map(simulation.conflicts.map((c) => [c.settingId, c]));
  const layeredBySettingId = new Map(simulation.layered.map((l) => [l.settingId, l]));
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
        rows.push([
          conflict.cspArea,
          conflict.displayName,
          path,
          v.value,
          v.sourcePolicyName,
          v.sourceKind,
          "yes",
          "no",
          "",
        ]);
      }
      continue;
    }
    const layered = layeredBySettingId.get(s.settingId);
    if (layered) {
      // A disagreement, like a conflict, so it expands the same way -- but NOT
      // flagged as one: these resolve on the device under `rule` rather than
      // being refused, and "Conflict: yes" in a spreadsheet is acted on.
      for (const v of layered.values) {
        rows.push([
          layered.cspArea,
          layered.displayName,
          path,
          v.value,
          v.sourcePolicyName,
          v.sourceKind,
          "no",
          "no",
          resolutionRuleLabel(layered.rule),
        ]);
      }
      continue;
    }
    const overlap = overlapsBySettingId.get(s.settingId);
    if (overlap) {
      // Same idea, but for policies that agree on the value -- still worth
      // surfacing as redundant configuration, distinct from a real conflict.
      for (const sp of overlap.sourcePolicies) {
        rows.push([
          overlap.cspArea,
          overlap.displayName,
          path,
          overlap.value,
          sp.sourcePolicyName,
          sp.sourceKind,
          "no",
          "yes",
          "",
        ]);
      }
      continue;
    }
    rows.push([s.cspArea, s.displayName, path, s.value, s.sourcePolicyName, s.sourceKind, "no", "no", ""]);
  }

  return [header, ...rows];
}

export function simulationToCsv(simulation: SimulationResult): string {
  return toCsv(simulationRows(simulation));
}

/**
 * The apps half of a simulation as rows: one per (app, intent), the ones that
 * land first and the carved-out ones after, in the order the Apps view lists
 * them. Null when there is nothing to tabulate -- no app data in the source, or
 * a tenant whose apps could not be read -- so a caller can leave the sheet out
 * rather than ship an empty one that reads as "this device gets no apps".
 */
function simulationAppRows(simulation: SimulationResult): string[][] | null {
  const apps = simulation.apps;
  if (!apps || apps.unavailable) return null;
  const header = [
    "App",
    "Publisher",
    "App Type",
    "Family",
    "Intent",
    "Applies",
    "Delivered Via",
    "Not Applied Because",
    // Blank unless the app also lands under another intent. Names the other
    // intents and nothing more: like "Resolution" on the baseline sheet, it
    // reports the overlap and leaves the outcome to Intune's documented rule.
    "Also Assigned As",
    // "yes" when this app lands both to install and to uninstall.
    "Intent Conflict",
    // Why an assignment on this row is doing no work, when one is.
    "Redundant",
    // Other app objects that look like the same product. A name match, so a
    // prompt to check rather than a finding to act on unread.
    "Same Product As",
    // Microsoft's packaging guidance, where it applies to this row.
    "Recommendation",
    // How Intune decides the app is installed: the app's own detection rule,
    // as configured. Several rules must ALL pass. A custom script is named as
    // one and its content is left out.
    "Detection Method",
    "Detection Rule",
    "Without Enrollment",
  ];
  const groupName = new Map(simulation.groups.map((g) => [g.id, g.displayName]));
  const names = (ids: string[]) => ids.map((id) => groupName.get(id) ?? id).join("; ");

  const landedIntents = new Map<string, string[]>();
  for (const a of apps.apps) landedIntents.set(a.id, [...(landedIntents.get(a.id) ?? []), a.intent]);
  const conflicted = new Set(apps.conflicts.map((c) => c.appId));
  const requiredAndAvailable = new Set(
    apps.redundant.filter((r) => r.kind === "required-and-available").map((r) => r.appId)
  );
  const multiGroup = new Set(
    apps.redundant.filter((r) => r.kind === "multiple-groups").map((r) => `${r.appId}:${r.intent}`)
  );
  const lobMsi = new Set(apps.lobMsi.map((l) => l.appId));
  const sameProduct = new Map<string, string>();
  for (const finding of apps.sameProduct) {
    for (const app of finding.apps) {
      const others = finding.apps.filter((o) => o.appId !== app.appId).map((o) => o.displayName);
      sameProduct.set(app.appId, `${others.join("; ")}${finding.opposing ? " (opposing intents)" : ""}`);
    }
  }

  const rows = [...apps.apps, ...apps.excluded].map((a) => {
    const landed = a.status === "included";
    const reason = landed
      ? ""
      : a.excludedByFilter
        ? `Assignment filter “${a.excludedByFilter.filterName}” (${a.excludedByFilter.filterType})`
        : `Excluded group: ${names(a.excludedViaGroupIds)}`;
    const also = landed
      ? (landedIntents.get(a.id) ?? [])
          .filter((i) => i !== a.intent)
          .map((i) => appIntentLabel(i as typeof a.intent))
          .join("; ")
      : "";
    const redundant: string[] = [];
    // The Available assignment is the surplus one, so it carries the note.
    if (landed && a.intent === "available" && requiredAndAvailable.has(a.id)) redundant.push("Already Required");
    if (landed && multiGroup.has(`${a.id}:${a.intent}`)) redundant.push("Delivered by more than one group");
    return [
      a.displayName,
      a.publisher ?? "",
      a.appType,
      APP_FAMILY_LABEL[a.family].tag,
      appIntentLabel(a.intent),
      landed ? "yes" : "no",
      names(a.viaGroupIds),
      reason,
      also,
      landed && conflicted.has(a.id) ? "yes" : "no",
      redundant.join("; "),
      landed ? (sameProduct.get(a.id) ?? "") : "",
      landed && lobMsi.has(a.id) ? `Convert to a Win32 app (${APP_LOB_LEARN_URL})` : "",
      [...new Set((a.detection ?? []).map((d) => APP_DETECTION_METHOD_LABEL[d.method]))].join(" + "),
      (a.detection ?? []).map((d) => d.summary).join(" AND "),
      a.withoutEnrollment ? "yes" : "no",
    ];
  });
  return [header, ...rows];
}

/**
 * How every app finding is detected, as a sheet. The rows come straight from
 * APP_FINDING_RULES, which is what the engine's own comments and the UI's
 * explanations are written against -- so the definitions that travel with an
 * exported workbook are the ones that produced its flags.
 */
function appFindingRows(): string[][] {
  return [
    ["Finding", "Column", "Kind", "Detected when", "What it means", "What to do", "Microsoft reference"],
    ...APP_FINDING_RULES.map((r) => [r.finding, r.column, r.kind, r.detectedWhen, r.meaning, r.action, r.reference]),
    [],
    [
      "Scope",
      "",
      "",
      "Everything on the Apps sheet is for ONE simulated endpoint: the groups, platform and Assignment Filters selected when it was exported. A finding means that endpoint is affected; it is not a tenant-wide audit.",
    ],
    [
      "Not read",
      "",
      "",
      "Win32 supersedence and dependencies, app protection and app configuration policies, and install status. Whether a group holds users or devices is not known, so user-versus-device rules are stated, not applied.",
    ],
  ];
}

const APPS_SHEETS = (appRows: string[][]) => [
  { name: "Apps", rows: appRows },
  { name: "Finding definitions", rows: appFindingRows() },
];

/** The simulated endpoint's apps as CSV, or null when there is no app data to export. */
export function simulationAppsToCsv(simulation: SimulationResult): string | null {
  const rows = simulationAppRows(simulation);
  return rows ? toCsv(rows) : null;
}

/**
 * The simulated endpoint's apps as a workbook of their own: the Apps sheet and
 * the detection logic behind its flags. Null when there is no app data.
 */
export function simulationAppsToXlsx(simulation: SimulationResult): Uint8Array | null {
  const rows = simulationAppRows(simulation);
  return rows ? sheetsToXlsx(APPS_SHEETS(rows)) : null;
}

/**
 * The same baseline as an .xlsx workbook -- the format mobile Excel will open.
 * A workbook can hold what a CSV cannot, so the endpoint's apps ride along as a
 * second sheet whenever the simulation has them, with a third explaining how
 * their flags are detected.
 */
export function simulationToXlsx(simulation: SimulationResult): Uint8Array {
  const appRows = simulationAppRows(simulation);
  return sheetsToXlsx([
    { name: "Endpoint baseline", rows: simulationRows(simulation) },
    ...(appRows ? APPS_SHEETS(appRows) : []),
  ]);
}
