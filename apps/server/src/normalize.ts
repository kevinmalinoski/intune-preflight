import type { CspSetting, PolicyKind, Platform } from "@intune-baseline/shared";

// Metadata fields present on most Graph device-management resources that aren't
// actual configuration settings -- excluded when flattening a policy into CSP settings.
const METADATA_KEYS = new Set([
  "id",
  "displayName",
  "description",
  "@odata.type",
  "@odata.context",
  "createdDateTime",
  "lastModifiedDateTime",
  "version",
  "roleScopeTagIds",
  "supportsScopeTags",
  "deviceManagementApplicabilityRuleOsEdition",
  "deviceManagementApplicabilityRuleOsVersion",
  "deviceManagementApplicabilityRuleDeviceMode",
  "assignments",
]);

function friendlyLabel(key: string): string {
  // camelCase -> "Camel Case"
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function stringifyValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    if (Object.keys(value as object).length === 0) return undefined;
    return JSON.stringify(value);
  }
  return undefined;
}

/**
 * Flattens a raw Graph device-management resource (deviceConfiguration,
 * deviceCompliancePolicy, etc.) into a normalized list of CSP-level settings.
 * Intune's own resource shapes already expose each configurable property as a
 * top-level field, so flattening the object is a reasonable, schema-agnostic
 * way to get "every CSP setting in one place" without hand-mapping every
 * Intune profile type.
 */
export function flattenToCspSettings(raw: Record<string, unknown>, cspArea: string): CspSetting[] {
  const settings: CspSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (METADATA_KEYS.has(key)) continue;
    const stringValue = stringifyValue(value);
    if (stringValue === undefined) continue;
    settings.push({
      settingId: `${cspArea}:${key}`,
      cspArea,
      displayName: friendlyLabel(key),
      value: stringValue,
    });
  }
  return settings;
}

/** Settings Catalog policies expose settings via a separate /settings sub-collection. */
export function flattenSettingsCatalogEntries(
  entries: Array<{ settingInstance?: Record<string, unknown> }>,
  cspArea: string
): CspSetting[] {
  const settings: CspSetting[] = [];
  for (const entry of entries) {
    const instance = entry.settingInstance;
    if (!instance) continue;
    const definitionId = (instance.settingDefinitionId as string) ?? "unknown";
    const valueHolder =
      (instance["choiceSettingValue"] as Record<string, unknown> | undefined) ??
      (instance["simpleSettingValue"] as Record<string, unknown> | undefined) ??
      (instance["groupSettingCollectionValue"] as unknown) ??
      instance;
    const stringValue = stringifyValue((valueHolder as Record<string, unknown>)?.value ?? valueHolder);
    if (stringValue === undefined) continue;
    settings.push({
      settingId: definitionId,
      cspArea,
      displayName: definitionId.split("_").slice(-2).join(" "),
      value: stringValue,
    });
  }
  return settings;
}

/**
 * Platform Scripts (Windows PowerShell `deviceManagementScripts`, macOS shell
 * `deviceShellScripts`) don't have CSP-style settings -- they're a script
 * plus a handful of execution options. `scriptContent` is base64-encoded in
 * Graph and needs decoding to be human-readable; everything else is flattened
 * the same schema-agnostic way as other policy types.
 */
export function flattenScriptToCspSettings(raw: Record<string, unknown>, cspArea: string): CspSetting[] {
  const settings: CspSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (METADATA_KEYS.has(key)) continue;
    let stringValue: string | undefined;
    if (key === "scriptContent" && typeof value === "string") {
      try {
        stringValue = Buffer.from(value, "base64").toString("utf-8");
      } catch {
        stringValue = value;
      }
    } else {
      stringValue = stringifyValue(value);
    }
    if (stringValue === undefined) continue;
    settings.push({
      settingId: `${cspArea}:${key}`,
      cspArea,
      displayName: key === "scriptContent" ? "Script content" : friendlyLabel(key),
      value: stringValue,
    });
  }
  return settings;
}

export interface AssignmentTarget {
  groupId?: string;
  isAllDevices?: boolean;
  isAllUsers?: boolean;
  isExclude?: boolean;
}

/**
 * Intune assignment targets come in distinct OData types. Critically,
 * `#microsoft.graph.exclusionGroupAssignmentTarget` looks identical to a
 * normal group target (same `groupId` field) but means the OPPOSITE: members
 * of that group are excluded from the policy, even if included by another
 * assignment (e.g. All Devices). Treating it as an include -- which earlier
 * versions of this app did -- silently misattributes excluded policies as
 * applied.
 */
export function parseAssignmentTarget(assignment: {
  target?: { "@odata.type"?: string; groupId?: string };
}): AssignmentTarget {
  const target = assignment.target;
  const type = target?.["@odata.type"] ?? "";
  if (type.includes("exclusionGroupAssignmentTarget")) return { groupId: target?.groupId, isExclude: true };
  if (type.includes("allDevices")) return { isAllDevices: true };
  if (type.includes("allLicensedUsers")) return { isAllUsers: true };
  return { groupId: target?.groupId };
}

/**
 * Derives the target OS platform from a Graph resource's @odata.type, which
 * for deviceConfigurations and deviceCompliancePolicies always encodes the
 * platform (e.g. #microsoft.graph.windows10CompliancePolicy,
 * #microsoft.graph.iosCompliancePolicy, #microsoft.graph.macOSGeneralDeviceConfiguration).
 * "ios" types cover both iOS and iPadOS in Graph's model.
 */
export function platformFromOdataType(odataType: string | undefined): Platform {
  const type = (odataType ?? "").toLowerCase();
  if (type.includes("macos")) return "macos";
  if (type.includes("ios")) return "ios";
  if (type.includes("android")) return "android";
  if (type.includes("windows")) return "windows";
  return "other";
}

/** Settings Catalog (configurationPolicies) resources expose platform directly via the `platforms` field. */
export function platformFromSettingsCatalog(platforms: string | undefined): Platform {
  const value = (platforms ?? "").toLowerCase();
  if (value.includes("macos")) return "macos";
  if (value.includes("ios")) return "ios";
  if (value.includes("android")) return "android";
  if (value.includes("windows")) return "windows";
  return "other";
}

export const VIRTUAL_GROUP_ALL_DEVICES = { id: "virtual-all-devices", displayName: "All Devices", isVirtual: true };
export const VIRTUAL_GROUP_ALL_USERS = { id: "virtual-all-users", displayName: "All Users", isVirtual: true };

export const KIND_LABELS: Record<PolicyKind, string> = {
  deviceConfiguration: "Device Configuration",
  settingsCatalog: "Settings Catalog",
  compliancePolicy: "Compliance Policy",
  adminTemplate: "Administrative Template",
  platformScript: "Platform Script",
};
