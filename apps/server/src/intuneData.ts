import type { AutopilotProfile, IntuneGroup, IntunePolicy, PolicyKind } from "@intune-baseline/shared";
import { graphGetCollection } from "./graphClient.js";
import {
  flattenSettingsCatalogEntries,
  flattenToCspSettings,
  parseAssignmentTarget,
  VIRTUAL_GROUP_ALL_DEVICES,
  VIRTUAL_GROUP_ALL_USERS,
} from "./normalize.js";
import { TtlCache } from "./cache.js";
import { config } from "./config.js";

const cache = new TtlCache(config.cacheTtlSeconds);

interface RawAssignment {
  target?: { "@odata.type"?: string; groupId?: string };
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

async function resolveAssignedGroupIds(assignments: RawAssignment[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const assignment of assignments) {
    const parsed = parseAssignmentTarget(assignment);
    if (parsed.isAllDevices) ids.add(VIRTUAL_GROUP_ALL_DEVICES.id);
    else if (parsed.isAllUsers) ids.add(VIRTUAL_GROUP_ALL_USERS.id);
    else if (parsed.groupId) ids.add(parsed.groupId);
  }
  return [...ids];
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
    result.push({
      id,
      kind: "deviceConfiguration",
      displayName,
      description: item.description as string | undefined,
      settings: flattenToCspSettings(item, displayName),
      assignedGroupIds: await resolveAssignedGroupIds(assignments),
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
    result.push({
      id,
      kind: "compliancePolicy",
      displayName,
      description: item.description as string | undefined,
      settings: flattenToCspSettings(item, displayName),
      assignedGroupIds: await resolveAssignedGroupIds(assignments),
    });
  }
  return result;
}

async function fetchSettingsCatalogPolicies(): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/configurationPolicies"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    const id = item.id as string;
    const displayName = (item.name as string) ?? (item.displayName as string) ?? "Untitled";
    const [assignments, settingEntries] = await Promise.all([
      graphGetCollection<RawAssignment>(`/deviceManagement/configurationPolicies/${id}/assignments`, useBeta),
      graphGetCollection<{ settingInstance?: Record<string, unknown> }>(
        `/deviceManagement/configurationPolicies/${id}/settings`,
        useBeta
      ),
    ]);
    result.push({
      id,
      kind: "settingsCatalog",
      displayName,
      description: item.description as string | undefined,
      settings: flattenSettingsCatalogEntries(settingEntries, displayName),
      assignedGroupIds: await resolveAssignedGroupIds(assignments),
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
      graphGetCollection<Record<string, unknown>>(
        `/deviceManagement/groupPolicyConfigurations/${id}/definitionValues`,
        useBeta
      ),
    ]);
    const settings = definitionValues.map((dv, idx) => ({
      settingId: (dv.id as string) ?? `${id}-${idx}`,
      cspArea: displayName,
      displayName: `Policy setting ${idx + 1}`,
      value: dv.enabled ? "Enabled" : "Disabled",
    }));
    result.push({
      id,
      kind: "adminTemplate",
      displayName,
      description: item.description as string | undefined,
      settings,
      assignedGroupIds: await resolveAssignedGroupIds(assignments),
    });
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
      assignedGroupIds: await resolveAssignedGroupIds(assignments),
    });
  }
  return result;
}

export interface TenantData {
  policies: IntunePolicy[];
  groups: IntuneGroup[];
  autopilotProfiles: AutopilotProfile[];
}

export async function loadTenantData(): Promise<TenantData> {
  return cache.getOrFetch("tenant-data", async () => {
    const [deviceConfigs, compliance, settingsCatalog, adminTemplates, autopilotProfiles] = await Promise.all([
      fetchDeviceConfigurations(),
      fetchCompliancePolicies(),
      fetchSettingsCatalogPolicies(),
      fetchAdminTemplates(),
      fetchAutopilotProfiles(),
    ]);

    const policies = [...deviceConfigs, ...compliance, ...settingsCatalog, ...adminTemplates];

    const groupIds = new Set<string>();
    for (const p of policies) for (const g of p.assignedGroupIds) groupIds.add(g);
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

    return { policies, groups, autopilotProfiles };
  });
}

export function clearTenantDataCache() {
  cache.clear();
}

export const PolicyKindLabel: Record<PolicyKind, string> = {
  deviceConfiguration: "Device Configuration",
  settingsCatalog: "Settings Catalog",
  compliancePolicy: "Compliance Policy",
  adminTemplate: "Administrative Template",
};
