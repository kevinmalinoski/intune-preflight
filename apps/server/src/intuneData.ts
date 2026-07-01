import type { AssignmentFilter, AssignmentFilterRef, AutopilotProfile, IntuneGroup, IntunePolicy } from "@intune-preflight/shared";
import { graphGetCollection } from "./graphClient.js";
import {
  flattenScriptToCspSettings,
  flattenSettingsCatalogEntries,
  flattenToCspSettings,
  parseAssignmentTarget,
  platformFromAssignmentFilter,
  platformFromOdataType,
  platformFromSettingsCatalog,
  VIRTUAL_GROUP_ALL_DEVICES,
  VIRTUAL_GROUP_ALL_USERS,
} from "./normalize.js";
import { TtlCache } from "./cache.js";
import { config } from "./config.js";

const cache = new TtlCache(config.cacheTtlSeconds);

interface RawAssignment {
  target?: {
    "@odata.type"?: string;
    groupId?: string;
    deviceAndAppManagementAssignmentFilterId?: string | null;
    deviceAndAppManagementAssignmentFilterType?: string;
  };
}

/**
 * A handful of newer deviceManagement resources (Settings Catalog, Admin
 * Templates, Autopilot profiles) 400 with "Resource not found for the
 * segment" on v1.0 in some tenants. Fall back to the beta endpoint when that
 * happens, and report which base URL worked so sibling/child requests for the
 * same resource type can skip straight to it instead of re-discovering.
 */
async function getCollectionWithBetaFallback<T>(path: string): Promise<{ items: T[]; useBeta: boolean }> {
  try {
    return { items: await graphGetCollection<T>(path), useBeta: false };
  } catch {
    return { items: await graphGetCollection<T>(path, true), useBeta: true };
  }
}

interface ResolvedAssignments {
  includedGroupIds: string[];
  excludedGroupIds: string[];
  assignmentFilters: AssignmentFilterRef[];
}

function resolveAssignmentGroupIds(assignments: RawAssignment[]): ResolvedAssignments {
  const included = new Set<string>();
  const excluded = new Set<string>();
  const assignmentFilters: AssignmentFilterRef[] = [];

  for (const assignment of assignments) {
    const parsed = parseAssignmentTarget(assignment);
    let groupId: string | undefined;
    if (parsed.isExclude && parsed.groupId) {
      excluded.add(parsed.groupId);
      groupId = parsed.groupId;
    } else if (parsed.isAllDevices) {
      included.add(VIRTUAL_GROUP_ALL_DEVICES.id);
      groupId = VIRTUAL_GROUP_ALL_DEVICES.id;
    } else if (parsed.isAllUsers) {
      included.add(VIRTUAL_GROUP_ALL_USERS.id);
      groupId = VIRTUAL_GROUP_ALL_USERS.id;
    } else if (parsed.groupId) {
      included.add(parsed.groupId);
      groupId = parsed.groupId;
    }
    if (groupId && parsed.filterId && parsed.filterType) {
      assignmentFilters.push({ groupId, filterId: parsed.filterId, filterType: parsed.filterType });
    }
  }
  return { includedGroupIds: [...included], excludedGroupIds: [...excluded], assignmentFilters };
}

async function fetchDeviceConfigurations(): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/deviceConfigurations"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const assignments = await graphGetCollection<RawAssignment>(
      `/deviceManagement/deviceConfigurations/${id}/assignments`,
      useBeta
    );
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
    result.push({
      id,
      kind: "deviceConfiguration",
      displayName,
      description: item.description as string | undefined,
      platform: platformFromOdataType(item["@odata.type"] as string | undefined),
      settings: flattenToCspSettings(item),
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
    });
  }
  return result;
}

async function fetchCompliancePolicies(): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/deviceCompliancePolicies"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const assignments = await graphGetCollection<RawAssignment>(
      `/deviceManagement/deviceCompliancePolicies/${id}/assignments`,
      useBeta
    );
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
    result.push({
      id,
      kind: "compliancePolicy",
      displayName,
      description: item.description as string | undefined,
      platform: platformFromOdataType(item["@odata.type"] as string | undefined),
      settings: flattenToCspSettings(item),
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
    });
  }
  return result;
}

/**
 * Settings Catalog also surfaces enrollment-time configuration (Device
 * Preparation policies, ESP, etc.) through the same `configurationPolicies`
 * endpoint. These aren't device baseline settings -- they only run once
 * during enrollment -- and Intune tags them distinctly via `technologies`
 * and `templateReference.templateFamily`, so they can be filtered out
 * without relying on the policy's display name.
 */
function isEnrollmentTimePolicy(item: Record<string, unknown>): boolean {
  const technologies = ((item.technologies as string) ?? "").toLowerCase();
  const templateFamily = (
    (item.templateReference as Record<string, unknown> | undefined)?.templateFamily as string | undefined
  )?.toLowerCase();
  return technologies.includes("enrollment") || templateFamily === "enrollmentconfiguration";
}

async function fetchSettingsCatalogPolicies(): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/configurationPolicies"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    if (isEnrollmentTimePolicy(item)) continue;
    const id = item.id as string;
    const displayName = (item.name as string) ?? (item.displayName as string) ?? "Untitled";
    const [assignments, settingEntries] = await Promise.all([
      graphGetCollection<RawAssignment>(`/deviceManagement/configurationPolicies/${id}/assignments`, useBeta),
      graphGetCollection<{ settingInstance?: Record<string, unknown> }>(
        `/deviceManagement/configurationPolicies/${id}/settings`,
        useBeta
      ),
    ]);
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
    result.push({
      id,
      kind: "settingsCatalog",
      displayName,
      description: item.description as string | undefined,
      platform: platformFromSettingsCatalog(item.platforms as string | undefined),
      settings: flattenSettingsCatalogEntries(settingEntries),
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
    });
  }
  return result;
}

async function fetchAdminTemplates(): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/groupPolicyConfigurations"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const [assignments, definitionValues] = await Promise.all([
      graphGetCollection<RawAssignment>(`/deviceManagement/groupPolicyConfigurations/${id}/assignments`, useBeta),
      // Expand the ADMX definition so each setting carries its real name and
      // category path (a genuine CSP-style area) instead of a bare index, and
      // so its settingId keys on the definition -- letting the same ADMX
      // setting configured by two policies be detected as a conflict/overlap.
      graphGetCollection<Record<string, unknown>>(
        `/deviceManagement/groupPolicyConfigurations/${id}/definitionValues?$expand=definition`,
        useBeta
      ),
    ]);
    const settings = definitionValues.map((dv, idx) => {
      const def = (dv.definition as Record<string, unknown> | undefined) ?? {};
      const defId = (def.id as string) ?? (dv.id as string) ?? `${id}-${idx}`;
      const category = ((def.categoryPath as string) ?? "").replace(/^\\+/, "").trim();
      return {
        settingId: `adminTemplate:${defId}`,
        cspArea: category || "Administrative Templates",
        displayName: (def.displayName as string) ?? `Policy setting ${idx + 1}`,
        value: dv.enabled ? "Enabled" : "Disabled",
      };
    });
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
    result.push({
      id,
      kind: "adminTemplate",
      displayName,
      description: item.description as string | undefined,
      // Administrative Templates (ADMX-backed) are Windows-only by design.
      platform: "windows",
      settings,
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
    });
  }
  return result;
}

interface RawGroupAssignment {
  targetGroupId?: string;
}

/**
 * macOS shell scripts (`deviceShellScripts`) don't support the standard
 * assignment model -- no excludes, no All Devices/All Users -- only plain
 * group targeting via a separate `groupAssignments` sub-resource shaped as
 * `{ targetGroupId }` rather than `{ target: {...} }`.
 */
function resolveGroupAssignmentIds(assignments: RawGroupAssignment[]): string[] {
  return [...new Set(assignments.map((a) => a.targetGroupId).filter((id): id is string => Boolean(id)))];
}

/**
 * Platform Scripts: Windows PowerShell scripts (`deviceManagementScripts`,
 * standard assignment model) and macOS shell scripts (`deviceShellScripts`,
 * group-only assignment via `groupAssignments`). Deliberately excludes
 * Proactive Remediations (`deviceHealthScripts`, detection+remediation
 * script pairs) -- a separate, broader feature out of scope for now.
 */
async function fetchPlatformScripts(): Promise<IntunePolicy[]> {
  const sources: { path: string; platform: "windows" | "macos"; assignmentStyle: "standard" | "groupOnly" }[] = [
    { path: "/deviceManagement/deviceManagementScripts", platform: "windows", assignmentStyle: "standard" },
    { path: "/deviceManagement/deviceShellScripts", platform: "macos", assignmentStyle: "groupOnly" },
  ];

  const result: IntunePolicy[] = [];
  for (const source of sources) {
    let items: Record<string, unknown>[];
    let useBeta: boolean;
    try {
      ({ items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(source.path));
    } catch (err) {
      // Platform scripts require an extra Graph permission
      // (DeviceManagementScripts.Read.All) beyond the core set. Treat this
      // as optional rather than failing the whole tenant load.
      console.warn(
        `Skipping ${source.path}: ${(err as Error).message}. Grant the app DeviceManagementScripts.Read.All permission to enable Platform Scripts.`
      );
      continue;
    }
    for (const item of items) {
      const id = item.id as string;
      const displayName = (item.displayName as string) ?? (item.fileName as string) ?? "Untitled";

      let includedGroupIds: string[];
      let excludedGroupIds: string[];
      let assignmentFilters: AssignmentFilterRef[];
      if (source.assignmentStyle === "groupOnly") {
        const assignments = await graphGetCollection<RawGroupAssignment>(`${source.path}/${id}/groupAssignments`, useBeta);
        includedGroupIds = resolveGroupAssignmentIds(assignments);
        excludedGroupIds = [];
        assignmentFilters = [];
      } else {
        const assignments = await graphGetCollection<RawAssignment>(`${source.path}/${id}/assignments`, useBeta);
        ({ includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments));
      }

      result.push({
        id,
        kind: "platformScript",
        displayName,
        description: item.description as string | undefined,
        platform: source.platform,
        settings: flattenScriptToCspSettings(item, id),
        assignedGroupIds: includedGroupIds,
        excludedGroupIds,
        assignmentFilters,
      });
    }
  }
  return result;
}

async function fetchAutopilotProfiles(): Promise<AutopilotProfile[]> {
  let items: Record<string, unknown>[];
  let useBeta: boolean;
  try {
    ({ items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
      "/deviceManagement/windowsAutopilotDeploymentProfiles"
    ));
  } catch (err) {
    // Autopilot profiles require an extra Graph permission
    // (DeviceManagementServiceConfig.Read.All) beyond the core set. Treat this
    // as optional rather than failing the whole tenant load.
    console.warn(
      `Skipping Autopilot profiles: ${(err as Error).message}. Grant the app DeviceManagementServiceConfig.Read.All permission to enable them.`
    );
    return [];
  }
  const result: AutopilotProfile[] = [];
  for (const item of items) {
    const id = item.id as string;
    const assignments = await graphGetCollection<RawAssignment>(
      `/deviceManagement/windowsAutopilotDeploymentProfiles/${id}/assignments`,
      useBeta
    );
    result.push({
      id,
      displayName: (item.displayName as string) ?? "Untitled",
      osLabel: "Windows 11",
      assignedGroupIds: resolveAssignmentGroupIds(assignments).includedGroupIds,
    });
  }
  return result;
}

async function fetchAssignmentFilters(): Promise<AssignmentFilter[]> {
  let items: Record<string, unknown>[];
  try {
    items = (await getCollectionWithBetaFallback<Record<string, unknown>>("/deviceManagement/assignmentFilters")).items;
  } catch (err) {
    console.warn(`Skipping Assignment Filters: ${(err as Error).message}.`);
    return [];
  }
  return items.map((item) => ({
    id: item.id as string,
    displayName: (item.displayName as string) ?? "Untitled",
    platform: platformFromAssignmentFilter(item.platform as string | undefined),
    rule: (item.rule as string) ?? "",
  }));
}

export interface TenantData {
  policies: IntunePolicy[];
  groups: IntuneGroup[];
  autopilotProfiles: AutopilotProfile[];
  assignmentFilters: AssignmentFilter[];
}

export async function loadTenantData(): Promise<TenantData> {
  return cache.getOrFetch("tenant-data", async () => {
    const [deviceConfigs, compliance, settingsCatalog, adminTemplates, platformScripts, autopilotProfiles, assignmentFilters] =
      await Promise.all([
        fetchDeviceConfigurations(),
        fetchCompliancePolicies(),
        fetchSettingsCatalogPolicies(),
        fetchAdminTemplates(),
        fetchPlatformScripts(),
        fetchAutopilotProfiles(),
        fetchAssignmentFilters(),
      ]);

    const policies = [...deviceConfigs, ...compliance, ...settingsCatalog, ...adminTemplates, ...platformScripts];

    const groupIds = new Set<string>();
    for (const p of policies) {
      for (const g of p.assignedGroupIds) groupIds.add(g);
      for (const g of p.excludedGroupIds) groupIds.add(g);
    }
    for (const a of autopilotProfiles) for (const g of a.assignedGroupIds) groupIds.add(g);

    const realGroupIds = [...groupIds].filter(
      (id) => id !== VIRTUAL_GROUP_ALL_DEVICES.id && id !== VIRTUAL_GROUP_ALL_USERS.id
    );

    const groups: IntuneGroup[] = [];
    if (groupIds.has(VIRTUAL_GROUP_ALL_DEVICES.id)) groups.push(VIRTUAL_GROUP_ALL_DEVICES);
    if (groupIds.has(VIRTUAL_GROUP_ALL_USERS.id)) groups.push(VIRTUAL_GROUP_ALL_USERS);

    for (const id of realGroupIds) {
      try {
        const group = await graphGetCollection<Record<string, unknown>>(
          `/groups?$filter=id eq '${id}'&$select=id,displayName,groupTypes,membershipRule`
        );
        const match = group[0];
        const groupTypes = (match?.groupTypes as string[] | undefined) ?? [];
        groups.push({
          id,
          displayName: (match?.displayName as string) ?? id,
          isDynamic: groupTypes.includes("DynamicMembership"),
          membershipRule: match?.membershipRule as string | undefined,
        });
      } catch {
        groups.push({ id, displayName: id });
      }
    }

    return { policies, groups, autopilotProfiles, assignmentFilters };
  });
}

export function clearTenantDataCache() {
  cache.clear();
}
