import type {
  AssignmentFilter,
  AssignmentFilterRef,
  AutopilotProfile,
  AutopilotProfileSetting,
  IntuneGroup,
  IntunePolicy,
  Platform,
} from "@intune-preflight/shared";
import { type GraphClient, isGraphStatus, mapWithConcurrency } from "./graphClient.js";
import {
  demoTenantData,
  flattenIntentSettings,
  flattenScriptToCspSettings,
  flattenSettingsCatalogEntries,
  flattenToCspSettings,
  indexIntentSettingDefinitions,
  type IntentSettingDef,
  isLegacyTemplateType,
  isSecurityIntentTemplate,
  mapWellKnownGroupId,
  parseAssignmentTarget,
  platformFromAssignmentFilter,
  platformFromIntentTemplate,
  platformFromOdataType,
  platformFromSettingsCatalog,
  type TenantData,
  VIRTUAL_GROUP_ALL_DEVICES,
  VIRTUAL_GROUP_ALL_USERS,
} from "@intune-preflight/engine";
import type { TtlCache } from "./cache.js";

/** Which data source a load reads from. The caller decides; this package never guesses. */
export type TenantMode = "demo" | "connected";

/**
 * What every fetcher below needs: the Graph client to read through, and the sink
 * for warnings that mean the baseline came back INCOMPLETE -- per-item drops and
 * unexpected category failures. Warnings are collected so a partial load is
 * surfaced to the user (and logged) rather than failing silently; the tool's core
 * promise is that it never quietly misses policies.
 *
 * Both are passed explicitly rather than read from module state, so the same code
 * can serve an app-only server load and a delegated browser load -- and so two
 * concurrent loads can't bleed warnings or telemetry into each other.
 */
interface LoadContext {
  client: GraphClient;
  recordWarning: (msg: string) => void;
}

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
 * Templates, Autopilot profiles) 400 with "Resource not found for the segment"
 * on v1.0 in some tenants. Fall back to the beta endpoint when that happens,
 * and report which base URL worked so sibling/child requests for the same
 * resource type can skip straight to it instead of re-discovering.
 *
 * Only a 400/404 triggers the fallback -- the statuses that actually mean "this
 * path doesn't exist on this endpoint". Retrying EVERY failure on beta (which
 * this used to do) meant a 403 for a missing permission, or an outage with no
 * connectivity at all, was quietly attempted twice: double the wait, and the
 * error that finally surfaced came from the beta attempt, pointing at the wrong
 * URL. Transient failures never reach here -- graphGetCollection has already
 * retried them.
 */
async function getCollectionWithBetaFallback<T>(
  ctx: LoadContext,
  path: string
): Promise<{ items: T[]; useBeta: boolean }> {
  try {
    return { items: await ctx.client.graphGetCollection<T>(path), useBeta: false };
  } catch (err) {
    if (!isGraphStatus(err, 400, 404)) throw err;
    return { items: await ctx.client.graphGetCollection<T>(path, true), useBeta: true };
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

/** Records and skips a single failed item so it doesn't drop its whole category.
 * graphFetch already retried every transient error before this, so reaching here
 * means the item is genuinely unloadable (or a rare persistent failure) -- either
 * way the baseline is now missing it, so it's surfaced, not just logged. */
function warnSkippedItem(ctx: LoadContext, kind: string, id: unknown, err: unknown): void {
  ctx.recordWarning(
    `Dropped one ${kind} (${(id as string) ?? "unknown"}) after retries — it is missing from the baseline: ${(err as Error).message}`
  );
}

/**
 * Map raw Graph items to policies with bounded concurrency. Failed items are
 * warned and skipped (same per-item resilience the old sequential loops had),
 * so one malformed policy never drops its whole category.
 */
async function mapItems<T>(
  ctx: LoadContext,
  items: Record<string, unknown>[],
  label: string,
  fn: (item: Record<string, unknown>) => Promise<T>
): Promise<T[]> {
  const mapped = await mapWithConcurrency(items, ctx.client.concurrency, async (item) => {
    try {
      return await fn(item);
    } catch (err) {
      warnSkippedItem(ctx, label, item.id, err);
      return null;
    }
  });
  return mapped.filter((p): p is Awaited<T> => p !== null);
}

async function fetchDeviceConfigurations(ctx: LoadContext): Promise<IntunePolicy[]> {
  // Read deviceConfigurations from BETA directly. Several newer types -- notably
  // the Apple/Android Wi-Fi profiles (macOSWiFiConfiguration, iosWiFiConfiguration,
  // aospDeviceOwnerWiFiConfiguration) plus a couple of Windows ones -- are only
  // returned on the beta endpoint. v1.0 returns a PARTIAL 200, so the generic
  // "fall back to beta on error" helper never triggers and those profiles would
  // silently vanish from the baseline. Beta is a strict superset here.
  // $expand=assignments returns each policy's assignments INLINE with the
  // collection, eliminating a per-policy round-trip (the dominant cost, and
  // 5xx surface, on large tenants). Same for every fetcher below.
  const items = await ctx.client.graphGetCollection<Record<string, unknown>>(
    "/deviceManagement/deviceConfigurations?$expand=assignments",
    true
  );
  return mapItems(ctx, items, "device configuration", async (item): Promise<IntunePolicy> => {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
    return {
      id,
      kind: "deviceConfiguration",
      displayName,
      description: item.description as string | undefined,
      platform: platformFromOdataType(item["@odata.type"] as string | undefined),
      settings: flattenToCspSettings(item),
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
      legacyTemplate: isLegacyTemplateType(item["@odata.type"] as string | undefined),
    };
  });
}

async function fetchCompliancePolicies(ctx: LoadContext): Promise<IntunePolicy[]> {
  // Read from BETA directly. On v1.0, compliance policies for newer types --
  // e.g. aospDeviceOwnerCompliancePolicy -- come back with NO @odata.type, so
  // they classify as "other" and disappear. Beta returns the proper type.
  const items = await ctx.client.graphGetCollection<Record<string, unknown>>(
    "/deviceManagement/deviceCompliancePolicies?$expand=assignments",
    true
  );
  return mapItems(ctx, items, "compliance policy", async (item): Promise<IntunePolicy> => {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
    return {
      id,
      kind: "compliancePolicy",
      displayName,
      description: item.description as string | undefined,
      platform: platformFromOdataType(item["@odata.type"] as string | undefined),
      settings: flattenToCspSettings(item),
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
    };
  });
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

async function fetchSettingsCatalogPolicies(ctx: LoadContext): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    ctx,
    "/deviceManagement/configurationPolicies?$expand=assignments"
  );
  return mapItems(
    ctx,
    items.filter((item) => !isEnrollmentTimePolicy(item)),
    "Settings Catalog policy",
    async (item): Promise<IntunePolicy> => {
      const id = item.id as string;
      const displayName = (item.name as string) ?? (item.displayName as string) ?? "Untitled";
      // Assignments come inline via $expand above; only the settings still need a
      // per-policy call (settings can't be expanded on the collection).
      const settingEntries = await ctx.client.graphGetCollection<{
        settingInstance?: Record<string, unknown>;
        settingDefinitions?: Record<string, unknown>[];
        // Expand the setting definitions so each setting carries its human name,
        // real CSP path (baseUri + offsetUri), and option value labels -- only the
        // definitions this policy actually uses, not the whole multi-thousand catalog.
      }>(`/deviceManagement/configurationPolicies/${id}/settings?$expand=settingDefinitions`, useBeta);
      const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
      const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
      return {
        id,
        kind: "settingsCatalog",
        displayName,
        description: item.description as string | undefined,
        platform: platformFromSettingsCatalog(item.platforms as string | undefined),
        settings: flattenSettingsCatalogEntries(settingEntries),
        assignedGroupIds: includedGroupIds,
        excludedGroupIds,
        assignmentFilters,
      };
    }
  );
}

async function fetchAdminTemplates(ctx: LoadContext): Promise<IntunePolicy[]> {
  const { items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
    ctx,
    "/deviceManagement/groupPolicyConfigurations?$expand=assignments"
  );
  return mapItems(ctx, items, "administrative template", async (item): Promise<IntunePolicy> => {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
    // Assignments come inline via $expand; only the ADMX definition values still
    // need a per-policy call. Expand the definition so each setting carries its
    // real name and category path (a genuine CSP-style area) instead of a bare
    // index, and so its settingId keys on the definition -- letting the same ADMX
    // setting configured by two policies be detected as a conflict/overlap.
    const definitionValues = await ctx.client.graphGetCollection<Record<string, unknown>>(
      `/deviceManagement/groupPolicyConfigurations/${id}/definitionValues?$expand=definition`,
      useBeta
    );
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
    return {
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
    };
  });
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
async function fetchPlatformScripts(ctx: LoadContext): Promise<IntunePolicy[]> {
  const sources: { path: string; platform: "windows" | "macos"; assignmentStyle: "standard" | "groupOnly" }[] = [
    { path: "/deviceManagement/deviceManagementScripts", platform: "windows", assignmentStyle: "standard" },
    { path: "/deviceManagement/deviceShellScripts", platform: "macos", assignmentStyle: "groupOnly" },
  ];

  const result: IntunePolicy[] = [];
  for (const source of sources) {
    let items: Record<string, unknown>[];
    let useBeta: boolean;
    // Standard-assignment scripts expand assignments inline; the macOS shell
    // scripts use a different groupAssignments sub-resource, fetched per item.
    const expand = source.assignmentStyle === "standard" ? "?$expand=assignments" : "";
    try {
      ({ items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
        ctx,
        `${source.path}${expand}`
      ));
    } catch (err) {
      // Platform scripts require an extra Graph permission
      // (DeviceManagementScripts.Read.All) beyond the core set. Treat this
      // as optional rather than failing the whole tenant load.
      console.warn(
        `Skipping ${source.path}: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementScripts.Read.All to enable Platform Scripts.")}`
      );
      continue;
    }
    result.push(
      ...(await mapItems(ctx, items, "platform script", async (item): Promise<IntunePolicy> => {
        const id = item.id as string;
        const displayName = (item.displayName as string) ?? (item.fileName as string) ?? "Untitled";

        let includedGroupIds: string[];
        let excludedGroupIds: string[];
        let assignmentFilters: AssignmentFilterRef[];
        if (source.assignmentStyle === "groupOnly") {
          const assignments = await ctx.client.graphGetCollection<RawGroupAssignment>(
            `${source.path}/${id}/groupAssignments`,
            useBeta
          );
          includedGroupIds = resolveGroupAssignmentIds(assignments);
          excludedGroupIds = [];
          assignmentFilters = [];
        } else {
          const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
          ({ includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments));
        }

        return {
          id,
          kind: "platformScript",
          displayName,
          description: item.description as string | undefined,
          platform: source.platform,
          settings: flattenScriptToCspSettings(item, id),
          assignedGroupIds: includedGroupIds,
          excludedGroupIds,
          assignmentFilters,
        };
      }))
    );
  }
  return result;
}

async function fetchAutopilotProfiles(ctx: LoadContext): Promise<AutopilotProfile[]> {
  let items: Record<string, unknown>[];
  try {
    ({ items } = await getCollectionWithBetaFallback<Record<string, unknown>>(
      ctx,
      "/deviceManagement/windowsAutopilotDeploymentProfiles?$expand=assignments"
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
  return mapItems(ctx, items, "Autopilot profile", async (item): Promise<AutopilotProfile> => {
    const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
    const { includedGroupIds, excludedGroupIds } = resolveAssignmentGroupIds(assignments);
    return {
      id: item.id as string,
      displayName: (item.displayName as string) ?? "Untitled",
      osLabel: "Windows 11",
      generation: "v1",
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      settings: autopilotV1Settings(item),
    };
  });
}

/**
 * High-level Autopilot v1 deployment-profile settings for the simulation card.
 * Field names differ between v1.0 (outOfBoxExperienceSettings, hideEULA, ...)
 * and newer beta (outOfBoxExperienceSetting, eulaHidden, ...) -- read both
 * shapes and include only what's present.
 */
function autopilotV1Settings(item: Record<string, unknown>): AutopilotProfileSetting[] {
  const settings: AutopilotProfileSetting[] = [];
  const add = (label: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    settings.push({ label, value: v === true ? "Yes" : v === false ? "No" : String(v) });
  };
  const odataType = (item["@odata.type"] as string) ?? "";
  add(
    "Join type",
    odataType.includes("activeDirectory")
      ? "Hybrid Entra joined"
      : odataType.includes("azureAD")
        ? "Microsoft Entra joined"
        : undefined
  );
  const oobe = (item.outOfBoxExperienceSetting ?? item.outOfBoxExperienceSettings) as
    Record<string, unknown> | undefined;
  add("Deployment mode", oobe?.deviceUsageType);
  add("User account type", oobe?.userType);
  add("Device name template", item.deviceNameTemplate);
  add("Pre-provisioning allowed", item.enableWhiteGlove ?? item.preprovisioningAllowed);
  add("Convert targeted devices to Autopilot", item.extractHardwareHash ?? item.hardwareHashExtractionEnabled);
  add("Hide privacy settings", oobe?.hidePrivacySettings ?? oobe?.privacySettingsHidden);
  add("Hide EULA", oobe?.hideEULA ?? oobe?.eulaHidden);
  add("Language", item.language ?? item.locale);
  return settings;
}

/**
 * Autopilot v2 -- "Windows Autopilot device preparation" policies. They live in
 * configurationPolicies (which fetchSettingsCatalogPolicies deliberately skips
 * as enrollment-time config) and are identified by their
 * enrollment_autopilot_dpp_* settings. Targeting is USER-group driven, and the
 * policy itself names a just-in-time device security group that enrolling
 * devices are added to -- surfaced here with the group id marked for name
 * resolution in loadTenantData.
 */
async function fetchAutopilotV2Policies(ctx: LoadContext): Promise<AutopilotProfile[]> {
  let items: Record<string, unknown>[];
  let useBeta: boolean;
  try {
    ({ items, useBeta } = await getCollectionWithBetaFallback<Record<string, unknown>>(
      ctx,
      "/deviceManagement/configurationPolicies?$expand=assignments"
    ));
  } catch (err) {
    console.warn(
      `Skipping Autopilot device preparation policies: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementConfiguration.Read.All.")}`
    );
    return [];
  }
  const candidates = items.filter(isEnrollmentTimePolicy);
  const mapped = await mapItems(
    ctx,
    candidates,
    "Autopilot device preparation policy",
    async (item): Promise<AutopilotProfile | null> => {
      const id = item.id as string;
      const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
      const settingEntries = await ctx.client.graphGetCollection<{
        settingInstance?: Record<string, unknown>;
        settingDefinitions?: Record<string, unknown>[];
      }>(`/deviceManagement/configurationPolicies/${id}/settings?$expand=settingDefinitions`, useBeta);
      const dppSettings = flattenSettingsCatalogEntries(settingEntries).filter((s) =>
        s.settingId.includes("_autopilot_dpp_")
      );
      // Other enrollment-time config (ESP variants etc.) shares the endpoint; only
      // device-preparation policies carry _autopilot_dpp_ settings.
      if (dppSettings.length === 0) return null;
      const { includedGroupIds, excludedGroupIds } = resolveAssignmentGroupIds(assignments);
      // The configured Autopilot device group. Some tenants carry it as an
      // enrollment_autopilot_dpp_devicegroup setting; current tenants store it as
      // the policy's enrollment-time device membership target, readable app-only
      // via this GET function (the portal's retrieveJustInTimeConfiguration
      // action rejects app-only tokens -- verified live).
      let deviceGroupId = dppSettings.find((s) => s.settingId.includes("_dpp_devicegroup"))?.value;
      if (!deviceGroupId) {
        try {
          const membership = await ctx.client.graphGetObject<{
            enrollmentTimeDeviceMembershipTargetValidationStatuses?: { targetId?: string }[];
          }>(`/deviceManagement/configurationPolicies('${id}')/retrieveEnrollmentTimeDeviceMembershipTarget`, useBeta);
          deviceGroupId = membership.enrollmentTimeDeviceMembershipTargetValidationStatuses?.[0]?.targetId;
        } catch (err) {
          console.warn(`Could not read the device group of device preparation policy ${id}: ${(err as Error).message}`);
        }
      }
      const settings: AutopilotProfileSetting[] = dppSettings
        // The allowed apps/scripts payload lists are deployment CONTENT, not
        // policy context -- this is a policy engine, so keep the card to the
        // deployment context (mode, join/account type, device group, timeout).
        .filter((s) => !s.settingId.includes("_dpp_allowedapp") && !s.settingId.includes("_dpp_allowedscript"))
        .map((s) => ({
          label: s.displayName,
          value: s.value,
          groupId: s.settingId.includes("_dpp_devicegroup") ? s.value : undefined,
        }));
      // Surface the device group on the card even when it came from the
      // membership-target function rather than a policy setting; the raw id is
      // resolved to the group's display name in loadTenantData.
      if (deviceGroupId && !settings.some((s) => s.groupId)) {
        settings.unshift({ label: "Device group (just-in-time)", value: deviceGroupId, groupId: deviceGroupId });
      }
      return {
        id,
        displayName: (item.name as string) ?? (item.displayName as string) ?? "Untitled",
        osLabel: "Windows 11",
        generation: "v2",
        assignedGroupIds: includedGroupIds,
        excludedGroupIds,
        deviceGroupId,
        settings,
      };
    }
  );
  return mapped.filter((p): p is AutopilotProfile => p !== null);
}

async function fetchAssignmentFilters(ctx: LoadContext): Promise<AssignmentFilter[]> {
  let items: Record<string, unknown>[];
  try {
    items = (await getCollectionWithBetaFallback<Record<string, unknown>>(ctx, "/deviceManagement/assignmentFilters"))
      .items;
  } catch (err) {
    console.warn(
      `Skipping Assignment Filters: ${skipReason(err as Error, "If this is a 403, grant the required permission to enable them.")}`
    );
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
async function fetchWindowsUpdateProfiles(ctx: LoadContext): Promise<IntunePolicy[]> {
  const sources = [
    { path: "windowsFeatureUpdateProfiles", type: "windowsFeatureUpdateProfile" },
    { path: "windowsQualityUpdateProfiles", type: "windowsQualityUpdateProfile" },
    { path: "windowsDriverUpdateProfiles", type: "windowsDriverUpdateProfile" },
  ];
  const result: IntunePolicy[] = [];
  for (const source of sources) {
    let items: Record<string, unknown>[];
    try {
      items = await ctx.client.graphGetCollection<Record<string, unknown>>(
        `/deviceManagement/${source.path}?$expand=assignments`,
        true
      );
    } catch (err) {
      console.warn(
        `Skipping ${source.path}: ${skipReason(err as Error, "If this is a 403, grant DeviceManagementConfiguration.Read.All.")}`
      );
      continue;
    }
    result.push(
      ...(await mapItems(ctx, items, "Windows update profile", async (item): Promise<IntunePolicy> => {
        const id = item.id as string;
        const displayName = (item.displayName as string) ?? "Untitled";
        const assignments = (item.assignments as RawAssignment[] | undefined) ?? [];
        const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);
        return {
          id,
          kind: "deviceConfiguration",
          displayName,
          description: item.description as string | undefined,
          platform: "windows",
          settings: flattenToCspSettings({ ...item, "@odata.type": `#microsoft.graph.${source.type}` }),
          assignedGroupIds: includedGroupIds,
          excludedGroupIds,
          assignmentFilters,
        };
      }))
    );
  }
  return result;
}

/**
 * Resolve each legacy intent template's settings to their real Intune metadata
 * (display name + enum value labels), keyed `templateId -> (definitionId -> def)`.
 * These live on the template's `settingDefinitions` (the same metadata the
 * Settings Catalog uses). Fetched via the intent's own categories --
 * `/intents/{id}/categories` then per-category `/settingDefinitions` (the
 * endpoints Graph actually exposes; a template-level expand isn't available) --
 * and, because every intent built from a template shares the same definitions,
 * resolved once per template using one representative intent and reused.
 *
 * A per-template failure just yields an empty map, so the caller falls back to
 * the `definitionId`-derived heuristic and raw values rather than dropping data.
 */
async function loadIntentSettingDefinitions(
  ctx: LoadContext,
  templateReps: Array<{ templateId: string; intentId: string }>
): Promise<Map<string, Map<string, IntentSettingDef>>> {
  const byTemplate = new Map<string, Map<string, IntentSettingDef>>();
  await mapWithConcurrency(templateReps, 3, async ({ templateId, intentId }) => {
    const allDefs: Record<string, unknown>[] = [];
    try {
      const categories = await ctx.client.graphGetCollection<Record<string, unknown>>(
        `/deviceManagement/intents/${intentId}/categories`,
        true
      );
      for (const cat of categories) {
        const catId = cat.id as string | undefined;
        if (!catId) continue;
        const defs = await ctx.client.graphGetCollection<Record<string, unknown>>(
          `/deviceManagement/intents/${intentId}/categories/${catId}/settingDefinitions`,
          true
        );
        allDefs.push(...defs);
      }
    } catch (err) {
      console.warn(
        `Could not read setting definitions for template ${templateId} (its settings fall back to the definitionId + raw values): ${(err as Error).message}`
      );
    }
    byTemplate.set(templateId, indexIntentSettingDefinitions(allDefs));
  });
  return byTemplate;
}

/**
 * Legacy Endpoint Security & Security Baseline policies -- BitLocker / Disk
 * Encryption, Defender Antivirus, Firewall, Attack Surface Reduction, Account
 * Protection, EDR -- created under the older `deviceManagement/intents` model
 * rather than the Settings Catalog. Each intent references a `templateId` whose
 * template gives the category name (BitLocker, Firewall, ...) and platform; the
 * intent's settings come from a per-intent `/settings` sub-collection.
 *
 * Modern Endpoint Security policies already surface via the Settings Catalog
 * fetcher; this covers only tenants that still have the legacy intents-based
 * ones. Windows-centric, so they join Windows conflict/overlap detection.
 */
export async function fetchEndpointSecurityIntents(ctx: LoadContext): Promise<IntunePolicy[]> {
  // Intents are a legacy resource served on BETA -- the per-intent /assignments
  // and /settings sub-collections 400 on v1.0 -- so read the whole feature on beta.
  let intents: Record<string, unknown>[];
  try {
    intents = await ctx.client.graphGetCollection<Record<string, unknown>>("/deviceManagement/intents", true);
  } catch (err) {
    console.warn(
      `Skipping legacy Endpoint Security (intents): ${skipReason(err as Error, "If this is a 403, grant DeviceManagementConfiguration.Read.All to enable legacy Endpoint Security / Security Baselines.")}`
    );
    return [];
  }
  if (intents.length === 0) return [];

  // Resolve each intent's template once (id -> category name + platform + whether
  // it's a security/baseline template). A failure just falls back to a generic
  // label rather than dropping the intents. templateType/@odata.type drive the
  // security check, so a non-security intent isn't mislabeled Endpoint Security.
  const templateInfo = new Map<string, { area: string; platform: Platform; isSecurity: boolean }>();
  try {
    const templates = await ctx.client.graphGetCollection<Record<string, unknown>>(
      "/deviceManagement/templates?$select=id,displayName,platformType,templateType",
      true
    );
    for (const t of templates) {
      const id = t.id as string | undefined;
      if (id) {
        templateInfo.set(id, {
          area: (t.displayName as string) ?? "Endpoint Security",
          platform: platformFromIntentTemplate(t.platformType as string | undefined),
          isSecurity: isSecurityIntentTemplate(t),
        });
      }
    }
  } catch (err) {
    console.warn(`Could not read intent templates (categories will be generic): ${(err as Error).message}`);
  }

  // Resolve real setting names + value labels per template (once each, via one
  // representative intent), so the merged baseline shows Intune's names and
  // human values rather than definitionIds and raw enum codes.
  const templateReps = [
    ...new Map(
      intents
        .filter((i) => i.templateId && i.id)
        .map((i) => [i.templateId as string, { templateId: i.templateId as string, intentId: i.id as string }])
    ).values(),
  ];
  const defsByTemplate = await loadIntentSettingDefinitions(ctx, templateReps);

  return mapItems(ctx, intents, "Endpoint Security (legacy)", async (item): Promise<IntunePolicy> => {
    const id = item.id as string;
    const displayName = (item.displayName as string) ?? "Untitled";
    const info = templateInfo.get(item.templateId as string);
    const cspArea = info?.area ?? "Endpoint Security";
    const defs = defsByTemplate.get(item.templateId as string);
    // Only genuine security/baseline templates get the "(Legacy) Endpoint
    // Security" label. A rare intent from a non-security template (e.g. a legacy
    // Office 365 device-config template) is a legacy device configuration, not ES.
    // When the template is unknown (info absent), default to endpointSecurity --
    // intents are overwhelmingly ES/baselines.
    const kind: IntunePolicy["kind"] = info && !info.isSecurity ? "deviceConfiguration" : "endpointSecurity";

    // Assignments MUST come from the per-intent sub-collection. The collection's
    // $expand=assignments returns an EMPTY array even for assigned intents
    // (verified live: isAssigned=true, expanded assignments []), so relying on it
    // silently drops every group. Fetched on beta (the v1.0 sub-collection 400s);
    // same target shape as every other resource, so exclude-wins and filters just
    // work through the shared resolver.
    const assignments = await ctx.client.graphGetCollection<RawAssignment>(
      `/deviceManagement/intents/${id}/assignments`,
      true
    );
    const { includedGroupIds, excludedGroupIds, assignmentFilters } = resolveAssignmentGroupIds(assignments);

    const rawSettings = await ctx.client.graphGetCollection<Record<string, unknown>>(
      `/deviceManagement/intents/${id}/settings`,
      true
    );
    return {
      id,
      kind,
      displayName,
      description: item.description as string | undefined,
      platform: info?.platform ?? "windows",
      settings: flattenIntentSettings(rawSettings, cspArea, defs),
      assignedGroupIds: includedGroupIds,
      excludedGroupIds,
      assignmentFilters,
    };
  });
}

/**
 * Wraps a top-level resource fetch so one failing category -- a missing
 * permission, a transient Graph error, a malformed policy -- degrades to empty
 * instead of failing the entire tenant load with a 502. Each category is
 * independent, so the rest of the baseline still renders and the failure is
 * logged rather than swallowed silently.
 */
async function safeFetch<T>(ctx: LoadContext, label: string, fn: (ctx: LoadContext) => Promise<T[]>): Promise<T[]> {
  try {
    return await fn(ctx);
  } catch (err) {
    // Reaching here means a whole category failed even after per-request retries
    // -- so the entire category is missing, not just one item. Surface it.
    ctx.recordWarning(
      `Could not load ${label} after retries — this entire category is missing from the baseline: ${(err as Error).message}`
    );
    return [];
  }
}

export interface LoadTenantDataOptions {
  /** Reads Graph through this client -- app-only on the server, delegated in a browser. */
  client: GraphClient;
  /** Which source to read: the bundled sample tenant, or the real one via Graph. */
  mode: TenantMode;
  /**
   * Caches the loaded tenant. Owned by the caller because its lifetime is the
   * caller's: a server process keeps one for its configured TTL and clears it on
   * refresh, where a browser session's ends with the tab.
   */
  cache: TtlCache;
}

export async function loadTenantData({ client, mode, cache }: LoadTenantDataOptions): Promise<TenantData> {
  // Demo mode serves bundled sample data and never touches Graph. Cache keys are
  // per-mode so switching Demo <-> Connected doesn't require a manual refresh.
  if (mode === "demo") {
    return cache.getOrFetch("tenant-data:demo", async () => demoTenantData());
  }
  return cache.getOrFetch("tenant-data:connected", async () => {
    const loadWarnings: string[] = [];
    const ctx: LoadContext = {
      client,
      recordWarning: (msg: string) => {
        loadWarnings.push(msg);
        console.warn(msg);
      },
    };
    client.resetGraphStats();
    const startedAt = Date.now();
    const [
      deviceConfigs,
      compliance,
      settingsCatalog,
      adminTemplates,
      platformScripts,
      updateProfiles,
      endpointSecurity,
      autopilotV1,
      autopilotV2,
      assignmentFilters,
    ] = await Promise.all([
      safeFetch(ctx, "device configurations", fetchDeviceConfigurations),
      safeFetch(ctx, "compliance policies", fetchCompliancePolicies),
      safeFetch(ctx, "Settings Catalog policies", fetchSettingsCatalogPolicies),
      safeFetch(ctx, "administrative templates", fetchAdminTemplates),
      safeFetch(ctx, "platform scripts", fetchPlatformScripts),
      safeFetch(ctx, "Windows update profiles", fetchWindowsUpdateProfiles),
      safeFetch(ctx, "legacy Endpoint Security (intents)", fetchEndpointSecurityIntents),
      safeFetch(ctx, "Autopilot profiles", fetchAutopilotProfiles),
      safeFetch(ctx, "Autopilot device preparation policies", fetchAutopilotV2Policies),
      safeFetch(ctx, "assignment filters", fetchAssignmentFilters),
    ]);
    const autopilotProfiles = [...autopilotV1, ...autopilotV2];

    const policies = [
      ...deviceConfigs,
      ...compliance,
      ...settingsCatalog,
      ...adminTemplates,
      ...platformScripts,
      ...updateProfiles,
      ...endpointSecurity,
    ];

    const groupIds = new Set<string>();
    for (const p of policies) {
      for (const g of p.assignedGroupIds) groupIds.add(g);
      for (const g of p.excludedGroupIds) groupIds.add(g);
    }
    for (const a of autopilotProfiles) {
      for (const g of a.assignedGroupIds) groupIds.add(g);
      for (const g of a.excludedGroupIds) groupIds.add(g);
      // APv2's configured (just-in-time) device group -- targeting keys on it,
      // and its settings-row value is resolved to a name below.
      if (a.deviceGroupId) groupIds.add(a.deviceGroupId);
      for (const s of a.settings) if (s.groupId) groupIds.add(s.groupId);
    }

    const realGroupIds = [...groupIds].filter(
      (id) => id !== VIRTUAL_GROUP_ALL_DEVICES.id && id !== VIRTUAL_GROUP_ALL_USERS.id
    );

    const groups: IntuneGroup[] = [];
    if (groupIds.has(VIRTUAL_GROUP_ALL_DEVICES.id)) groups.push(VIRTUAL_GROUP_ALL_DEVICES);
    if (groupIds.has(VIRTUAL_GROUP_ALL_USERS.id)) groups.push(VIRTUAL_GROUP_ALL_USERS);

    // Resolve referenced groups with the same bounded concurrency as policy
    // detail calls -- tenants with many groups were paying one sequential
    // round-trip per group. A referenced group can be gone (a policy still
    // assigned to a deleted group) or unreadable -- in both cases Graph
    // returns no match; label it clearly rather than leaving a bare GUID.
    const resolved = await mapWithConcurrency(realGroupIds, client.concurrency, async (id): Promise<IntuneGroup> => {
      const unresolvedLabel = `⚠ Deleted or inaccessible group (${id.slice(0, 8)}…)`;
      try {
        const group = await client.graphGetCollection<Record<string, unknown>>(
          `/groups?$filter=id eq '${id}'&$select=id,displayName,groupTypes,membershipRule`
        );
        const match = group[0];
        const groupTypes = (match?.groupTypes as string[] | undefined) ?? [];
        return {
          id,
          displayName: (match?.displayName as string) ?? unresolvedLabel,
          isDynamic: groupTypes.includes("DynamicMembership"),
          membershipRule: match?.membershipRule as string | undefined,
        };
      } catch {
        return { id, displayName: unresolvedLabel };
      }
    });
    groups.push(...resolved);

    // Resolve APv2 just-in-time device-group ids to display names now that the
    // referenced groups are loaded.
    const groupNameById = new Map(groups.map((g) => [g.id, g.displayName]));
    for (const a of autopilotProfiles) {
      for (const s of a.settings) {
        if (s.groupId) s.value = groupNameById.get(s.groupId) ?? s.value;
      }
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const s = client.getGraphStats();
    // Telemetry so a slow load is diagnosable: how many Graph calls, and whether
    // the time went to throttling (429s + retries) vs sheer call volume.
    const detail = `${s.requests} Graph calls, ${s.retries} retried (${s.throttled} throttled, ${s.serverErrors} server errors, ${s.timeouts} timeouts)`;
    if (loadWarnings.length > 0) {
      console.warn(
        `⚠ Tenant load finished in ${seconds}s with ${loadWarnings.length} warning(s) — the baseline is INCOMPLETE. ${detail}. See the warnings above.`
      );
    } else {
      console.log(
        `Tenant load finished in ${seconds}s: ${policies.length} policies, ${groups.length} groups — complete. ${detail}.`
      );
    }

    return { policies, groups, autopilotProfiles, assignmentFilters, warnings: loadWarnings };
  });
}
