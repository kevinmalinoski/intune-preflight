import type { CspSetting, Platform } from "@intune-preflight/shared";

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

/** Strips the `#microsoft.graph.` prefix from an @odata.type, e.g. -> "windowsUpdateForBusinessConfiguration". */
function odataTypeKey(raw: Record<string, unknown>): string {
  const odataType = (raw["@odata.type"] as string | undefined) ?? "";
  return odataType.replace(/^#?microsoft\.graph\./i, "") || "deviceConfiguration";
}

/**
 * ADDITIVE profile types: a device can legitimately carry many of them at once,
 * so two instances are NOT a conflict or overlap -- pushing several is normal,
 * expected configuration. Wi-Fi networks, VPNs, certificates, email accounts,
 * and custom (OMA-URI / .mobileconfig) profiles all belong here. Their settings
 * still show in the baseline, but are namespaced per policy so they never merge
 * into a false conflict/overlap. Only singleton "system config" settings
 * (device restrictions, endpoint protection, Windows Update, Windows Hello,
 * Settings Catalog CSPs, Administrative Templates, ...) are compared.
 *
 * Matched as substrings against the @odata.type so it covers every platform's
 * variant (windowsWifiConfiguration, iosWiFiConfiguration, macOSWiFiConfiguration,
 * ...) without enumerating them all.
 */
const ADDITIVE_TYPE_KEYWORDS = [
  "wifi",
  "vpn",
  "certificate",
  "scep",
  "pkcs",
  "trustedroot",
  "importedpfx",
  "pfxcertificate",
  "derivedcredential",
  "custom", // OMA-URI (Windows) / .mobileconfig (macOS, iOS) custom profiles
  "email",
  "wirednetwork",
];

function isAdditivePolicyType(odataType: string | undefined): boolean {
  const type = (odataType ?? "").toLowerCase();
  return ADDITIVE_TYPE_KEYWORDS.some((keyword) => type.includes(keyword));
}

/**
 * Flattens a raw Graph device-management resource (deviceConfiguration,
 * deviceCompliancePolicy, etc.) into a normalized list of CSP-level settings.
 * Intune's own resource shapes already expose each configurable property as a
 * top-level field, so flattening the object is a reasonable, schema-agnostic
 * way to get "every CSP setting in one place" without hand-mapping every
 * Intune profile type.
 *
 * The settingId is keyed on the resource's @odata.type plus the property name --
 * NOT the policy's display name. Two policies of the same type that set the same
 * property therefore share one settingId, which is what lets the merge step flag
 * it as a conflict (different values) or overlap (same value). Keying on the
 * policy name instead makes every setting unique per policy and silently hides
 * every cross-policy conflict -- e.g. two Windows Update rings targeting the same
 * device would never be reported as conflicting.
 */
/**
 * Windows Custom (OMA-URI) profiles carry their settings in an `omaSettings`
 * array, where each entry targets a specific CSP path (`omaUri`). Unlike an
 * opaque macOS/iOS .mobileconfig payload, an OMA-URI IS a real CSP setting, so
 * two custom profiles setting the same URI genuinely overlap (same value) or
 * conflict (different values). Keying each on its URI -- stable across policies
 * -- makes that detection work, which is why OMA-URI custom profiles are
 * exempt from the additive treatment that opaque custom payloads get.
 */
function flattenOmaSettings(omaSettings: Array<Record<string, unknown>>): CspSetting[] {
  const settings: CspSetting[] = [];
  for (const oma of omaSettings) {
    const uri = oma["omaUri"] as string | undefined;
    if (!uri) continue;
    const value = stringifyValue(oma["value"]);
    if (value === undefined) continue;
    const lastSegment = uri.split("/").filter(Boolean).pop() ?? uri;
    settings.push({
      settingId: `omaUri:${uri}`,
      cspArea: "Custom (OMA-URI)",
      displayName: (oma["displayName"] as string) || lastSegment,
      value,
    });
  }
  return settings;
}

export function flattenToCspSettings(raw: Record<string, unknown>): CspSetting[] {
  // Windows Custom (OMA-URI) profiles are the one "custom" type worth comparing
  // -- their omaSettings target real CSP paths. Opaque .mobileconfig payloads
  // (macOS/iOS) have no omaSettings and fall through to the additive path below.
  const omaSettings = raw["omaSettings"];
  if (Array.isArray(omaSettings)) return flattenOmaSettings(omaSettings as Array<Record<string, unknown>>);

  const typeKey = odataTypeKey(raw);
  const cspArea = friendlyLabel(typeKey);
  // Additive profiles (Wi-Fi, VPN, certificates, custom, ...) are namespaced by
  // policy id so multiple instances never collapse into a false conflict/overlap;
  // singleton system-config types keep a shared "<type>:<key>" id so genuine
  // cross-policy disagreements are still detected.
  const additive = isAdditivePolicyType(raw["@odata.type"] as string | undefined);
  const policyId = (raw["id"] as string) ?? "";
  const settings: CspSetting[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (METADATA_KEYS.has(key)) continue;
    const stringValue = stringifyValue(value);
    if (stringValue === undefined) continue;
    // "notConfigured" is Intune's sentinel for "this legacy setting isn't set".
    // Dropping it keeps unset defaults out of the baseline and, crucially, out
    // of conflict/overlap detection -- a policy that leaves a setting unset does
    // not actually disagree with one that sets it.
    if (stringValue.toLowerCase() === "notconfigured") continue;
    settings.push({
      settingId: additive ? `${typeKey}:${policyId}:${key}` : `${typeKey}:${key}`,
      cspArea,
      displayName: friendlyLabel(key),
      value: stringValue,
    });
  }
  return settings;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Derives a human CSP area and setting name from a Settings Catalog
 * settingDefinitionId, e.g.
 *   device_vendor_msft_policy_config_update_configuredeadlineforqualityupdates
 * -> { area: "Update", name: "configuredeadlineforqualityupdates" }.
 * The boilerplate scope/vendor tokens are dropped; the first remaining segment
 * is the CSP area and the rest is the setting name. The setting names in these
 * ids are lowercase-concatenated with no word boundaries, so `name` can't be
 * perfectly prettified -- but it's accurate and, together with the full
 * definitionId used as settingId, uniquely identifies the setting.
 */
function parseCatalogDefinitionId(definitionId: string): { area: string; name: string } {
  const boilerplate = new Set(["device", "user", "vendor", "msft", "policy", "config", "admx"]);
  const parts = definitionId.split("_").filter((p) => p && !boilerplate.has(p.toLowerCase()));
  if (parts.length === 0) return { area: "Settings Catalog", name: definitionId };
  return { area: titleCase(parts[0]), name: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] };
}

/**
 * A Settings Catalog *choice* value is itself an option id of the form
 * "<settingDefinitionId>_<option>" (e.g. "..._allowautoupdate_3", "..._block").
 * Strip the shared definition prefix so the value shows just the selected
 * option ("3", "block") rather than the full CSP string. (Fully human option
 * labels would require a separate settings-catalog definition lookup.)
 */
function cleanChoiceOptionId(optionId: string, definitionId: string): string {
  if (definitionId && optionId.startsWith(definitionId)) {
    return optionId.slice(definitionId.length).replace(/^_+/, "") || optionId;
  }
  const parts = optionId.split("_");
  return parts[parts.length - 1] || optionId;
}

/**
 * Extracts a human-readable value from a Settings Catalog settingInstance,
 * which comes in several shapes. Choice settings carry an option-id string
 * (cleaned above); simple settings a real scalar; simple/group collections a
 * list. Without this, choice settings leak the raw CSP option id while simple
 * settings show a normal value -- the inconsistency this fixes.
 */
function extractCatalogValue(instance: Record<string, unknown>, definitionId: string): string | undefined {
  const choice = instance["choiceSettingValue"] as { value?: unknown } | undefined;
  if (choice && typeof choice.value === "string") return cleanChoiceOptionId(choice.value, definitionId);

  const choiceCollection = instance["choiceSettingCollectionValue"] as Array<{ value?: unknown }> | undefined;
  if (Array.isArray(choiceCollection)) {
    const values = choiceCollection
      .map((c) => (typeof c.value === "string" ? cleanChoiceOptionId(c.value, definitionId) : undefined))
      .filter((v): v is string => v !== undefined);
    return values.length ? values.join(", ") : undefined;
  }

  const simple = instance["simpleSettingValue"] as { value?: unknown } | undefined;
  if (simple && "value" in simple) return stringifyValue(simple.value);

  const simpleCollection = instance["simpleSettingCollectionValue"] as Array<{ value?: unknown }> | undefined;
  if (Array.isArray(simpleCollection)) {
    const values = simpleCollection.map((v) => stringifyValue(v?.value)).filter((v): v is string => v !== undefined);
    return values.length ? values.join(", ") : undefined;
  }

  // Group collections (and any container without a direct value) hold their
  // real settings as child instances -- those are pulled out by the recursive
  // walk in flattenSettingsCatalogEntries, so there's no scalar value here.
  return undefined;
}

/**
 * Settings Catalog policies expose settings via a separate /settings
 * sub-collection. Graph only returns settings that are actually configured
 * here (unlike legacy device configurations), so these merge cleanly. The
 * settingDefinitionId is a stable, policy-independent id -- used directly as
 * the settingId so the same setting across policies is detected as a conflict
 * or overlap -- and also yields the CSP area and setting name for display.
 */
export function flattenSettingsCatalogEntries(
  entries: Array<{ settingInstance?: Record<string, unknown> }>
): CspSetting[] {
  const bySettingId = new Map<string, CspSetting>();

  const visit = (instance: Record<string, unknown> | undefined): void => {
    if (!instance) return;
    const definitionId = instance["settingDefinitionId"] as string | undefined;
    if (definitionId) {
      const value = extractCatalogValue(instance, definitionId);
      if (value !== undefined && !bySettingId.has(definitionId)) {
        const { area, name } = parseCatalogDefinitionId(definitionId);
        bySettingId.set(definitionId, { settingId: definitionId, cspArea: area, displayName: name, value });
      }
    }
    // Settings Catalog settings are hierarchical -- a choice or group can carry
    // dependent child settings (e.g. a "Device Lock" parent -> "Max Inactivity
    // Time Device Lock"). Walk every nesting so those children aren't dropped.
    const choice = instance["choiceSettingValue"] as { children?: unknown[] } | undefined;
    choice?.children?.forEach((c) => visit(c as Record<string, unknown>));
    const choiceCollection = instance["choiceSettingCollectionValue"] as Array<{ children?: unknown[] }> | undefined;
    choiceCollection?.forEach((c) => c.children?.forEach((child) => visit(child as Record<string, unknown>)));
    const groupCollection = instance["groupSettingCollectionValue"] as Array<{ children?: unknown[] }> | undefined;
    groupCollection?.forEach((g) => g.children?.forEach((child) => visit(child as Record<string, unknown>)));
  };

  for (const entry of entries) visit(entry.settingInstance);
  return [...bySettingId.values()];
}

/**
 * Platform Scripts (Windows PowerShell `deviceManagementScripts`, macOS shell
 * `deviceShellScripts`) don't have CSP-style settings -- they're a script
 * plus a handful of execution options. `scriptContent` is base64-encoded in
 * Graph and needs decoding to be human-readable; everything else is flattened
 * the same schema-agnostic way as other policy types.
 *
 * settingId is namespaced with the policy id so two unrelated scripts never
 * collapse into one setting -- scripts don't "conflict" the way a shared CSP
 * setting does, and treating identical run options across different scripts as
 * an overlap would just be noise.
 */
export function flattenScriptToCspSettings(raw: Record<string, unknown>, policyId: string): CspSetting[] {
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
      settingId: `platformScript:${policyId}:${key}`,
      cspArea: "Platform Script",
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
 *
 * Finally, some assignments reference the built-in All Devices / All Users
 * targets via a plain `groupAssignmentTarget` carrying Intune's well-known
 * GUIDs, rather than the dedicated `allDevices`/`allLicensedUsers` OData types.
 * Those GUIDs aren't real Entra groups, so treating them as one leaves an
 * unresolvable raw GUID in the UI -- map them to the virtual targets instead.
 */
const WELL_KNOWN_ALL_DEVICES_GUID = "adadadad-808e-44e2-905a-0b7873a8a531";
const WELL_KNOWN_ALL_USERS_GUID = "acacacac-9df4-4c7d-9d50-4ef0226f57a9";

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
  const groupId = target?.groupId;
  const wellKnown = groupId?.toLowerCase();
  const filterId = target?.deviceAndAppManagementAssignmentFilterId ?? undefined;
  const filterType =
    target?.deviceAndAppManagementAssignmentFilterType === "include" ||
    target?.deviceAndAppManagementAssignmentFilterType === "exclude"
      ? target.deviceAndAppManagementAssignmentFilterType
      : undefined;
  const filter: Pick<AssignmentTarget, "filterId" | "filterType"> = filterId && filterType ? { filterId, filterType } : {};

  if (type.includes("exclusionGroupAssignmentTarget")) return { groupId, isExclude: true, ...filter };
  if (type.includes("allDevices") || wellKnown === WELL_KNOWN_ALL_DEVICES_GUID) return { isAllDevices: true, ...filter };
  if (type.includes("allLicensedUsers") || wellKnown === WELL_KNOWN_ALL_USERS_GUID) return { isAllUsers: true, ...filter };
  return { groupId, ...filter };
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
  /** True when this came from the `-any (_ -op "value")` collection form, e.g. devicePhysicalIds entries. */
  isAnyCollection: boolean;
}

/** A clause value like `[ZTDid]` or `[OrderID]` with nothing after the closing bracket -- "has any entry of this tag type" rather than a specific one. */
const BARE_TAG = /^\[[^\]]+\]$/;

/**
 * Multi-valued identity collections Intune/Autopilot populate on a device --
 * currently just devicePhysicalIds (Graph also accepts the differently-cased
 * "devicePhysicalIDs" in some rule exports). Several distinct tag-prefixed
 * entries (ZTDid, OrderID, GroupTag, PurchaseOrderId, SerialNumber, ...) are
 * written into this same array together at Autopilot enrollment, so two
 * `-any` clauses against it using different tags aren't competing
 * alternatives -- a real device can, and typically does, satisfy both at
 * once.
 */
const MULTI_TAG_COLLECTION_PROPERTIES = new Set(["devicephysicalids"]);

/**
 * Extracts simple `device.<property> -startsWith "value"` / `-eq "value"`
 * clauses (including the `-any (_ -startsWith "value")` form used for
 * collection properties like devicePhysicalIds) from an Entra dynamic group
 * membership rule. This is NOT a full parser for the rule language --
 * boolean structure (and/or/not), other operators (-contains, -match, -in,
 * etc.), and non-device properties are ignored. It only extracts what's
 * needed to detect the implication patterns below.
 */
function parseMembershipRuleClauses(rule: string | undefined): RuleClause[] {
  if (!rule) return [];
  const pattern = /device\.(\w+)\s*(-any\s*\(\s*_\s*)?-(startsWith|eq)\s*"([^"]*)"/gi;
  const clauses: RuleClause[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rule))) {
    clauses.push({
      property: match[1].toLowerCase(),
      op: match[3].toLowerCase() as "startsWith" | "eq",
      value: match[4],
      isAnyCollection: Boolean(match[2]),
    });
  }
  return clauses;
}

/**
 * Whether every real device that satisfies `selectedRule` is GUARANTEED to
 * also satisfy `otherRule`, based on the extracted clauses. Two patterns are
 * recognized:
 *
 * 1. Same property, prefix relationship: if the selected clause's value
 *    starts with the other clause's value, anything matching the (narrower)
 *    selected clause necessarily matches the (broader) other clause too --
 *    e.g. selecting a group scoped to OrderID "SALES-KIOSK-SINGLE" implies
 *    membership in a broader group scoped to "SALES-KIOSK".
 *
 * 2. Same multi-tag identity collection (e.g. devicePhysicalIds), other
 *    clause is a bare tag wildcard ("[ZTDid]" with nothing after it, i.e.
 *    "has any entry of this tag type"): implied by ANY other `-any` clause
 *    against that same collection, regardless of tag, since these arrays are
 *    populated with multiple tag types together at Autopilot enrollment --
 *    e.g. selecting an OrderID-scoped Kiosk group implies membership in a
 *    generic "is this device Autopilot-enrolled" group scoped to a bare
 *    "[ZTDid]" check, because a Kiosk device is itself Autopilot-enrolled
 *    and therefore also carries a ZTDid entry.
 *
 * Deliberately conservative/best-effort: only handles single-clause-vs-single-clause
 * matches. Rules with "and"/"or"/"not" combinators are still scanned (the
 * regex finds all clauses regardless of structure), which can occasionally
 * produce a false positive for rules that "and" together unrelated clauses --
 * this is why implied groups are surfaced to the user for verification
 * rather than silently merged into the simulation.
 */
export function ruleImplies(selectedRule: string | undefined, otherRule: string | undefined): boolean {
  const selectedClauses = parseMembershipRuleClauses(selectedRule);
  const otherClauses = parseMembershipRuleClauses(otherRule);
  if (selectedClauses.length === 0 || otherClauses.length === 0) return false;

  return selectedClauses.some((selected) =>
    otherClauses.some((other) => {
      if (selected.property !== other.property) return false;
      if (selected.value.length === 0 || other.value.length === 0) return false;

      if (
        selected.isAnyCollection &&
        other.isAnyCollection &&
        MULTI_TAG_COLLECTION_PROPERTIES.has(other.property) &&
        BARE_TAG.test(other.value)
      ) {
        return true;
      }

      if (other.op === "eq") return selected.op === "eq" && selected.value === other.value;
      // other.op === "startsWith": anything starting with `selected.value`
      // also starts with `other.value` iff `other.value` is a prefix of it.
      return selected.value.startsWith(other.value) && selected.value !== other.value;
    })
  );
}

export const VIRTUAL_GROUP_ALL_DEVICES = { id: "virtual-all-devices", displayName: "All Devices", isVirtual: true };
export const VIRTUAL_GROUP_ALL_USERS = { id: "virtual-all-users", displayName: "All Users", isVirtual: true };

/**
 * Maps Intune's well-known All Devices / All Users GUIDs to the virtual group
 * ids. Use this on any groupId collected straight from Graph (e.g. the macOS
 * shell-script `groupAssignments` shape, which carries a raw `targetGroupId`
 * and never passes through parseAssignmentTarget) so those built-in targets
 * don't surface as unresolvable raw GUIDs. Any other id is returned unchanged.
 */
export function mapWellKnownGroupId(groupId: string): string {
  const g = groupId.toLowerCase();
  if (g === WELL_KNOWN_ALL_DEVICES_GUID) return VIRTUAL_GROUP_ALL_DEVICES.id;
  if (g === WELL_KNOWN_ALL_USERS_GUID) return VIRTUAL_GROUP_ALL_USERS.id;
  return groupId;
}
