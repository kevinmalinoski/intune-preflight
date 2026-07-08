import type { AssignmentFilter, AssignmentFilterRef, AutopilotProfile, IntuneGroup, IntunePolicy, SettingCatalogDefinition } from "@intune-preflight/shared";
import { graphGetCollection } from "./graphClient.js";
import {
  flattenScriptToCspSettings,
  flattenSettingsCatalogEntries,
  flattenToCspSettings,
  mapWellKnownGroupId,
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

/**
 * Builds the log line for an optional resource that failed to load. The cause
 * is usually one of two very different things -- a missing Graph permission
 * (403) or a network failure (the server can't reach Graph at all) -- so the
 * message must not assume "grant a permission" when it's really connectivity.
 */
function skipReason(err: Error, grantHint: string): string {
  if (/network|ENETUNREACH|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|fetch failed/i.test(err.message)) {
    return `${err.message} -- this is a network error reaching Microsoft Graph, NOT a permissions problem; check the server's outbound connectivity.`;
  }
  return `${err.message}. ${grantHint}`;
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

/** Logs and skips a single malformed/failed item so it doesn't drop its whole category. */
function warnSkippedItem(kind: string, id: unknown, err: unknown): void {
  console.warn(`Skipping one ${kind} (${(id as string) ?? "unknown"}): ${(err as Error).message}`);
}

async function fetchDeviceConfigurations(): Promise<IntunePolicy[]> {
  // Read deviceConfigurations from BETA directly. Several newer types -- notably
  // the Apple/Android Wi-Fi profiles (macOSWiFiConfiguration, iosWiFiConfiguration,
  // aospDeviceOwnerWiFiConfiguration) plus a couple of Windows ones -- are only
  // returned on the beta endpoint. v1.0 returns a PARTIAL 200, so the generic
  // "fall back to beta on error" helper never triggers and those profiles would
  // silently vanish from the baseline. Beta is a strict superset here.
  const items = await graphGetCollection<Record<string, unknown>>("/deviceManagement/deviceConfigurations", true);
  const result: IntunePolicy[] = [];
  for (const item of items) {
    try {
      const id = item.id as string;
      const displayName = (item.displayName as string) ?? "Untitled";
      const assignments = await graphGetCollection<RawAssignment>(
        `/deviceManagement/deviceConfigurations/${id}/assignments`,
        true
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
    } catch (err) {
      warnSkippedItem("device configuration", item.id, err);
    }
  }
  return result;
}

async function fetchCompliancePolicies(): Promise<IntunePolicy[]> {
  // Read from BETA directly. On v1.0, compliance policies for newer types --
  // e.g. aospDeviceOwnerCompliancePolicy -- come back with NO @odata.type, so
  // they classify as "other" and disappear. Beta returns the proper type.
  const items = await graphGetCollection<Record<string, unknown>>("/deviceManagement/deviceCompliancePolicies", true);
  const result: IntunePolicy[] = [];
  for (const item of items) {
    try {
      const id = item.id as string;
      const displayName = (item.displayName as string) ?? "Untitled";
      const assignments = await graphGetCollection<RawAssignment>(
        `/deviceManagement/deviceCompliancePolicies/${id}/assignments`,
        true
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
    } catch (err) {
      warnSkippedItem("compliance policy", item.id, err);
    }
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

async function fetchSettingsCatalogPolicies(definitions: SettingCatalogDefinition[] = []): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/configurationPolicies"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    if (isEnrollmentTimePolicy(item)) continue;
    try {
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
        settings: flattenSettingsCatalogEntries(settingEntries, definitions),
        assignedGroupIds: includedGroupIds,
        excludedGroupIds,
        assignmentFilters,
      });
    } catch (err) {
      warnSkippedItem("Settings Catalog policy", item.id, err);
    }
  }
  return result;
}

export async function fetchSettingsCatalogDefinitions(): Promise<SettingCatalogDefinition[]> {
  return cache.getOrFetch<SettingCatalogDefinition[]>("settings-catalog-definitions", async () => {
    try {
      const { items } = await getCollectionWithBetaFallback<Record<string, unknown>>("/deviceManagement/configurationSettings");
      const defs: SettingCatalogDefinition[] = items.map((item) => {
        const optionsRaw = (item.options as Record<string, unknown>[] | undefined) ?? [];
        const options = optionsRaw.map((o) => ({
          itemId: (o.itemId as string) ?? (o.id as string) ?? (o.name as string) ?? "",
          displayName: (o.displayName as string) ?? (o.name as string) ?? "",
          name: o.name as string | undefined,
          description: o.description as string | undefined,
          helpText: o.helpText as string | undefined,
        }));

        return {
          id: item.id as string,
          settingDefinitionId: (item.settingDefinitionId as string) ?? (item.name as string) ?? (item.id as string),
          displayName: (item.displayName as string) ?? (item.name as string) ?? (item.settingDefinitionId as string) ?? (item.id as string),
          name: item.name as string | undefined,
          description: item.description as string | undefined,
          helpText: item.helpText as string | undefined,
          version: item.version as string | undefined,
          categoryId: item.categoryId as string | undefined,
          uxBehavior: item.uxBehavior as string | undefined,
          visibility: item.visibility as string | undefined,
          riskLevel: item.riskLevel as string | undefined,
          options: options.length ? options : undefined,
          defaultOptionId: item.defaultOptionId as string | undefined,
          baseUri: item.baseUri as string | undefined,
          offsetUri: item.offsetUri as string | undefined,
          rootDefinitionId: item.rootDefinitionId as string | undefined,
        };
      });
      return defs;
    } catch (err) {
      console.warn(
        `Skipping Settings Catalog definitions: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementConfiguration.Read.All to enable definitions.")}`
      );
      return [];
    }
  });
}

async function fetchAdminTemplates(): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    "/deviceManagement/groupPolicyConfigurations"
  );
  const result: IntunePolicy[] = [];
  for (const item of items) {
    try {
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
    } catch (err) {
      warnSkippedItem("administrative template", item.id, err);
    }
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
  return [
    ...new Set(
      assignments
        .map((a) => a.targetGroupId)
        .filter((id): id is string => Boolean(id))
        .map(mapWellKnownGroupId)
    ),
  ];
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
        `Skipping ${source.path}: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementScripts.Read.All to enable Platform Scripts.")}`
      );
      continue;
    }
    for (const item of items) {
      try {
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
      } catch (err) {
        warnSkippedItem("platform script", item.id, err);
      }
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
      `Skipping Autopilot profiles: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementServiceConfig.Read.All to enable them.")}`
    );
    return [];
  }
  const result: AutopilotProfile[] = [];
  for (const item of items) {
    try {
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
    } catch (err) {
      warnSkippedItem("Autopilot profile", item.id, err);
    }
  }
  return result;
}

async function fetchAssignmentFilters(): Promise<AssignmentFilter[]> {
  let items: Record<string, unknown>[];
  try {
    items = (await getCollectionWithBetaFallback<Record<string, unknown>>("/deviceManagement/assignmentFilters")).items;
  } catch (err) {
    console.warn(`Skipping Assignment Filters: ${skipReason(err as Error, "If this is a 403, grant the required permission to enable them.")}`);
    return [];
  }
  return items.map((item) => ({
    id: item.id as string,
    displayName: (item.displayName as string) ?? "Untitled",
    platform: platformFromAssignmentFilter(item.platform as string | undefined),
    rule: (item.rule as string) ?? "",
  }));
}

/**
 * Windows Update policies live under their own top-level endpoints (Feature,
 * Quality and Driver update profiles) rather than deviceConfigurations, and
 * they carry no @odata.type. Inject a synthetic one so flattenToCspSettings
 * namespaces the settingId per update-profile kind (and derives a sensible CSP
 * area), then treat them as Windows device configurations for the baseline.
 * These are genuine baseline inputs -- e.g. which feature update version a
 * device is targeted to -- and two profiles targeting different versions are a
 * real conflict.
 */
async function fetchWindowsUpdateProfiles(): Promise<IntunePolicy[]> {
  const sources = [
    { path: "windowsFeatureUpdateProfiles", type: "windowsFeatureUpdateProfile" },
    { path: "windowsQualityUpdateProfiles", type: "windowsQualityUpdateProfile" },
    { path: "windowsDriverUpdateProfiles", type: "windowsDriverUpdateProfile" },
  ];
  const result: IntunePolicy[] = [];
  for (const source of sources) {
    let items: Record<string, unknown>[];
    try {
      items = await graphGetCollection<Record<string, unknown>>(`/deviceManagement/${source.path}`, true);
    } catch (err) {
      console.warn(`Skipping ${source.path}: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementConfiguration.Read.All.")}`);
      continue;
    }
    for (const item of items) {
      try {
        const id = item.id as string;
        const displayName = (item.displayName as string) ?? "Untitled";
        const assignments = await graphGetCollection<RawAssignment>(`/deviceManagement/${source.path}/${id}/assignments`, true);
        const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
        result.push({
          id,
          kind: "deviceConfiguration",
          displayName,
          description: item.description as string | undefined,
          platform: "windows",
          settings: flattenToCspSettings({ ...item, "@odata.type": `#microsoft.graph.${source.type}` }),
          assignedGroupIds: includedGroupIds,
          excludedGroupIds,
          assignmentFilters,
        });
      } catch (err) {
        warnSkippedItem("Windows update profile", item.id, err);
      }
    }
  }
  return result;
}

export interface TenantData {
  policies: IntunePolicy[];
  groups: IntuneGroup[];
  autopilotProfiles: AutopilotProfile[];
  assignmentFilters: AssignmentFilter[];
  settingsCatalogDefinitions: SettingCatalogDefinition[];
}

/**
 * Wraps a top-level resource fetch so one failing category -- a missing
 * permission, a transient Graph error, a malformed policy -- degrades to empty
 * instead of failing the entire tenant load with a 502. Each category is
 * independent, so the rest of the baseline still renders and the failure is
 * logged rather than swallowed silently.
 */
async function safeFetch<T>(label: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`Could not load ${label}: ${(err as Error).message}. Continuing without it.`);
    return [];
  }
}

export async function loadTenantData(): Promise<TenantData> {
  return cache.getOrFetch("tenant-data", async () => {
    const [
      deviceConfigs,
      compliance,
      settingsCatalogDefinitions,
      adminTemplates,
      platformScripts,
      updateProfiles,
      autopilotProfiles,
      assignmentFilters,
    ] =
      await Promise.all([
        safeFetch("device configurations", fetchDeviceConfigurations),
        safeFetch("compliance policies", fetchCompliancePolicies),
        safeFetch("Settings Catalog definitions", fetchSettingsCatalogDefinitions),
        safeFetch("administrative templates", fetchAdminTemplates),
        safeFetch("platform scripts", fetchPlatformScripts),
        safeFetch("Windows update profiles", fetchWindowsUpdateProfiles),
        safeFetch("Autopilot profiles", fetchAutopilotProfiles),
        safeFetch("assignment filters", fetchAssignmentFilters),
      ]);

    const settingsCatalog = await safeFetch("Settings Catalog policies", () =>
      fetchSettingsCatalogPolicies(settingsCatalogDefinitions)
    );

    const policies = [...deviceConfigs, ...compliance, ...settingsCatalog, ...adminTemplates, ...platformScripts, ...updateProfiles];

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
      // A referenced group can be gone (a policy still assigned to a deleted
      // group) or unreadable -- in both cases Graph returns no match. Label it
      // clearly rather than leaving a bare GUID that looks like a real group.
      const unresolvedLabel = `⚠ Deleted or inaccessible group (${id.slice(0, 8)}…)`;
      try {
        const group = await graphGetCollection<Record<string, unknown>>(
          `/groups?$filter=id eq '${id}'&$select=id,displayName,groupTypes,membershipRule`
        );
        const match = group[0];
        const groupTypes = (match?.groupTypes as string[] | undefined) ?? [];
        groups.push({
          id,
          displayName: (match?.displayName as string) ?? unresolvedLabel,
          isDynamic: groupTypes.includes("DynamicMembership"),
          membershipRule: match?.membershipRule as string | undefined,
        });
      } catch {
        groups.push({ id, displayName: unresolvedLabel });
      }
    }

    return { policies, groups, autopilotProfiles, assignmentFilters, settingsCatalogDefinitions };
  });
}

export function clearTenantDataCache() {
  cache.clear();
}
