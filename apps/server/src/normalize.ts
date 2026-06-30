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
  filterId?: string;
  filterType?: "include" | "exclude";
}

/**
 * Intune assignment targets come in distinct OData types. Critically,
 * `#microsoft.graph.exclusionGroupAssignmentTarget` looks identical to a
 * normal group target (same `groupId` field) but means the OPPOSITE: members
 * of that group are excluded from the policy, even if included by another
 * assignment (e.g. All Devices). Treating it as an include -- which earlier
 * versions of this app did -- silently misattributes excluded policies as
 * applied.
 *
 * Independently, an assignment can also carry an Assignment Filter
 * (`deviceAndAppManagementAssignmentFilterId`/`...FilterType`) that further
 * scopes it to devices matching a rule -- e.g. a policy assigned to All
 * Devices but with an `exclude` filter for "Kiosk Devices" does NOT apply to
 * kiosks, even though the group-level logic alone would say it does.
 */
export function parseAssignmentTarget(assignment: {
  target?: {
    "@odata.type"?: string;
    groupId?: string;
    deviceAndAppManagementAssignmentFilterId?: string | null;
    deviceAndAppManagementAssignmentFilterType?: string;
  };
}): AssignmentTarget {
  const target = assignment.target;
  const type = target?.["@odata.type"] ?? "";
  const filterId = target?.deviceAndAppManagementAssignmentFilterId ?? undefined;
  const filterType =
    target?.deviceAndAppManagementAssignmentFilterType === "include" ||
    target?.deviceAndAppManagementAssignmentFilterType === "exclude"
      ? target.deviceAndAppManagementAssignmentFilterType
      : undefined;
  const filter: Pick<AssignmentTarget, "filterId" | "filterType"> = filterId && filterType ? { filterId, filterType } : {};

  if (type.includes("exclusionGroupAssignmentTarget")) return { groupId: target?.groupId, isExclude: true, ...filter };
  if (type.includes("allDevices")) return { isAllDevices: true, ...filter };
  if (type.includes("allLicensedUsers")) return { isAllUsers: true, ...filter };
  return { groupId: target?.groupId, ...filter };
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

/** Assignment Filters expose platform via a Graph enum like "windows10AndLater", "iOSMobileApplicationManagement". */
export function platformFromAssignmentFilter(platform: string | undefined): Platform {
  const value = (platform ?? "").toLowerCase();
  if (value.includes("macos")) return "macos";
  if (value.includes("ios")) return "ios";
  if (value.includes("android")) return "android";
  if (value.includes("windows")) return "windows";
  return "other";
}

interface RuleClause {
  property: string;
  op: "startsWith" | "eq";
  value: string;
}

/**
 * Extracts simple `device.<property> -startsWith "value"` / `-eq "value"`
 * clauses (including the `-any (_ -startsWith "value")` form used for
 * collection properties like devicePhysicalIds) from an Entra dynamic group
 * membership rule. This is NOT a full parser for the rule language --
 * boolean structure (and/or/not), other operators (-contains, -match, -in,
 * etc.), and non-device properties are ignored. It only extracts what's
 * needed to detect the common "one rule's prefix is a prefix of another
 * rule's prefix" case, which is what makes selecting one dynamic group
 * imply membership in another.
 */
function parseMembershipRuleClauses(rule: string | undefined): RuleClause[] {
  if (!rule) return [];
  const pattern = /device\.(\w+)\s*(?:-any\s*\(\s*_\s*)?-(startsWith|eq)\s*"([^"]*)"/gi;
  const clauses: RuleClause[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rule))) {
    clauses.push({ property: match[1].toLowerCase(), op: match[2].toLowerCase() as "startsWith" | "eq", value: match[3] });
  }
  return clauses;
}

/**
 * Whether every real device that satisfies `selectedRule` is GUARANTEED to
 * also satisfy `otherRule`, based on the extracted clauses. For two clauses
 * on the same property: if the selected clause's value starts with the
 * other clause's value, anything matching the (narrower) selected clause
 * necessarily matches the (broader) other clause too -- e.g. selecting a
 * group scoped to OrderID "MALO-KIOSK-SINGLE" implies membership in a
 * broader group scoped to "MALO-KIOSK", since every device in the former
 * has an OrderID starting with the latter's prefix as well.
 *
 * Deliberately conservative/best-effort: only handles single-clause-vs-single-clause
 * matches on the same property and op pairing described above. Rules with
 * "and"/"or"/"not" combinators are still scanned (the regex finds all
 * clauses regardless of structure), which can occasionally produce a false
 * positive for rules that "and" together unrelated clauses -- this is why
 * implied groups are surfaced to the user for verification rather than
 * silently merged into the simulation.
 */
export function ruleImplies(selectedRule: string | undefined, otherRule: string | undefined): boolean {
  const selectedClauses = parseMembershipRuleClauses(selectedRule);
  const otherClauses = parseMembershipRuleClauses(otherRule);
  if (selectedClauses.length === 0 || otherClauses.length === 0) return false;

  return selectedClauses.some((selected) =>
    otherClauses.some((other) => {
      if (selected.property !== other.property) return false;
      if (selected.value.length === 0 || other.value.length === 0) return false;
      if (other.op === "eq") return selected.op === "eq" && selected.value === other.value;
      // other.op === "startsWith": anything starting with `selected.value`
      // also starts with `other.value` iff `other.value` is a prefix of it.
      return selected.value.startsWith(other.value) && selected.value !== other.value;
    })
  );
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
