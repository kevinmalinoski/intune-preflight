// Shared types used by both the server (apps/server) and the web UI (apps/web).
// Kept deliberately small and flat -- this is the contract between the two apps.

export type PolicyKind =
  | "deviceConfiguration"
  | "settingsCatalog"
  | "compliancePolicy"
  | "adminTemplate"
  | "platformScript";

/** Target OS platform for a policy. "other" covers resource types we can't confidently classify. */
export type Platform = "windows" | "macos" | "ios" | "android" | "other";

export interface IntuneGroup {
  id: string;
  displayName: string;
  /** True for the two Graph "virtual" targets: All Devices / All Users */
  isVirtual?: boolean;
  /** True when the group's membership is computed from a rule rather than explicit adds */
  isDynamic?: boolean;
  /** The Entra dynamic membership rule, e.g. (device.deviceOSType -eq "Windows") */
  membershipRule?: string;
}

export interface CspSetting {
  /** Stable id of the underlying setting/definition, used to detect conflicts across policies */
  settingId: string;
  /** Human readable CSP area, e.g. "Device Restrictions", "BitLocker", "Defender" */
  cspArea: string;
  displayName: string;
  value: string;
}

export interface OptionDefinition {
  /** The stable item id for the option (matches choice value seen in policies) */
  itemId: string;
  /** Human-readable label for the option shown in UI */
  displayName: string;
  /** Optional programmatic name */
  name?: string;
  /** Optional description/help text for the option */
  description?: string;
  helpText?: string;
}

export interface SettingCatalogDefinition {
  /** Graph resource id */
  id: string;
  /** The concatenated settingDefinitionId used in policies (stable key) */
  settingDefinitionId: string;
  /** Human-readable setting name */
  displayName: string;
  name?: string;
  description?: string;
  helpText?: string;
  version?: string;
  categoryId?: string;
  uxBehavior?: string;
  visibility?: string;
  riskLevel?: string;
  /** Choice options for choice-type settings */
  options?: OptionDefinition[];
  defaultOptionId?: string;
  baseUri?: string;
  offsetUri?: string;
  rootDefinitionId?: string | null;
}

/** An Intune Assignment Filter, used to scope an assignment to devices matching a rule (e.g. "Kiosk Devices"). */
export interface AssignmentFilter {
  id: string;
  displayName: string;
  platform: Platform;
  rule: string;
}

export interface AssignmentFilterRef {
  /** Real group id, or the virtual All Devices/All Users id, that this filter is attached to */
  groupId: string;
  filterId: string;
  filterType: "include" | "exclude";
}

export interface IntunePolicy {
  id: string;
  kind: PolicyKind;
  displayName: string;
  description?: string;
  platform: Platform;
  settings: CspSetting[];
  /** Groups (or virtual All Devices/All Users) this policy is assigned to INCLUDE */
  assignedGroupIds: string[];
  /** Groups explicitly EXCLUDED from this policy -- excludes always win over includes */
  excludedGroupIds: string[];
  /** Assignment Filters attached to specific group assignments above, scoping them to matching devices */
  assignmentFilters: AssignmentFilterRef[];
}

export interface AutopilotProfile {
  id: string;
  displayName: string;
  /** Resolved OS label shown in the UI, e.g. "Windows 11 23H2" */
  osLabel: string;
  assignedGroupIds: string[];
}

/** Two or more applied policies set the same CSP setting to DIFFERENT values -- a real disagreement. */
export interface ConflictingSetting {
  settingId: string;
  cspArea: string;
  displayName: string;
  values: { value: string; sourcePolicyId: string; sourcePolicyName: string; sourceKind: PolicyKind }[];
}

/** Two or more applied policies set the same CSP setting to the SAME value -- redundant, not a disagreement. */
export interface PolicyOverlap {
  settingId: string;
  cspArea: string;
  displayName: string;
  value: string;
  sourcePolicies: { sourcePolicyId: string; sourcePolicyName: string; sourceKind: PolicyKind }[];
}

export interface BaselineSetting extends CspSetting {
  sourcePolicyId: string;
  sourcePolicyName: string;
  sourceKind: PolicyKind;
}

export interface GroupSummary {
  id: string;
  displayName: string;
  policyCount: number;
  settingsCount: number;
  conflictCount: number;
  isDynamic?: boolean;
  membershipRule?: string;
  /** OS platforms this group has assigned (or excluded) policies for -- used to hide it when a different OS is simulated. */
  platforms: Platform[];
}

/** Why a group is part of an endpoint simulation. */
export type SimulationGroupSource = "selected" | "all-devices" | "all-users" | "implied";

export interface SimulationGroup extends IntuneGroup {
  source: SimulationGroupSource;
  /**
   * Set when source is "implied": the selected group(s) whose dynamic
   * membership rule logically implies membership in this one too (e.g.
   * selecting a group scoped to OrderID "SALES-KIOSK-SINGLE" implies
   * membership in a broader "SALES-KIOSK" group). Best-effort -- verify
   * against the actual rules in Entra before relying on it.
   */
  impliedByGroupNames?: string[];
}

export interface SimulationPolicy {
  id: string;
  displayName: string;
  kind: PolicyKind;
  status: "included" | "excluded";
  /** Group ids (within this simulation) that assign this policy */
  viaGroupIds: string[];
  /** Group ids (within this simulation) that exclude this policy -- only set when status is "excluded" */
  excludedViaGroupIds: string[];
  /** Set when exclusion is (also/instead) caused by an Assignment Filter not matching the selected device filter */
  excludedByFilter?: { filterId: string; filterName: string };
}

export interface SimulationResult {
  groups: SimulationGroup[];
  /** Policies that apply -- included and not excluded */
  policies: SimulationPolicy[];
  /** Policies that would otherwise apply but are explicitly excluded for one of the selected groups, or filtered out by an Assignment Filter */
  excludedPolicies: SimulationPolicy[];
  settings: BaselineSetting[];
  conflicts: ConflictingSetting[];
  overlaps: PolicyOverlap[];
}

interface PhysicalIdClause {
  /** Lowercased physical-id tag name, e.g. "orderid" (Group Tag) or "ztdid" (Autopilot). */
  tag: string;
  op: "eq" | "startswith";
  /** Text after "[Tag]:" -- the Group Tag value; "" for bare tags like "[ZTDid]". */
  value: string;
}

/**
 * Pulls every `device.devicePhysicalIds -any (_ -eq/-startsWith "[Tag]:value")`
 * clause out of a membership rule. Autopilot writes several tagged entries
 * into the `devicePhysicalIds` collection -- the Group Tag lives under the
 * `[OrderID]` tag (a legacy Autopilot/Entra naming quirk), the Autopilot
 * device id under `[ZTDId]`, etc. Boolean structure isn't parsed here; see
 * groupTagMatchesRule for how the clauses are combined.
 *
 * NOTE (v1): this regex-based extraction only handles flat clauses. Combined /
 * nested dynamic-group rules (nested parens, mixed device properties, operators
 * beyond -eq/-startsWith) are not fully evaluated -- a proper rule-expression
 * parser/evaluator is the planned replacement. See ROADMAP.md.
 */
function parsePhysicalIdClauses(rule: string): PhysicalIdClause[] {
  const pattern = /device\.devicePhysicalIDs?\s+-any\s*\(\s*_\s*-(eq|startsWith)\s+"\[([^\]]+)\](?::([^"]*))?"/gi;
  const clauses: PhysicalIdClause[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rule))) {
    clauses.push({ tag: match[2].toLowerCase(), op: match[1].toLowerCase() as "eq" | "startswith", value: match[3] ?? "" });
  }
  return clauses;
}

/** Whether a membership rule scopes on an Autopilot Group Tag ([OrderID]) at all. */
export function isGroupTagRule(membershipRule: string | undefined): boolean {
  if (!membershipRule) return false;
  return parsePhysicalIdClauses(membershipRule).some((c) => c.tag === "orderid");
}

/**
 * Whether a device carrying Autopilot Group Tag `groupTag` would be a member
 * of the group with this membership rule, evaluated over its `[OrderID]`
 * (Group Tag) clauses:
 *
 *   -eq "[OrderID]:X"         matches when groupTag === X
 *   -startsWith "[OrderID]:X" matches when groupTag starts with X
 *
 * so e.g. a device tagged "SALES-KIOSK-VM" is a member of both a
 * `-startsWith "[OrderID]:SALES-KIOSK"` group and a `-eq "[OrderID]:SALES-KIOSK-VM"`
 * group. All matching is case-insensitive (Entra treats Group Tags that way).
 *
 * Clauses are combined with OR by default (the common `(... ) or (... )`
 * shape); if the rule joins clauses with `and`, all must match. Non-Group-Tag
 * clauses (e.g. a bare `[ZTDId]` Autopilot check) are treated as satisfied,
 * since the Group Tag field is only usable once the endpoint is already
 * flagged as an Autopilot device. This is a best-effort evaluator for the flat
 * clause shapes Autopilot Group Tag groups actually use -- it does not parse
 * arbitrarily nested boolean expressions.
 */
export function groupTagMatchesRule(membershipRule: string | undefined, groupTag: string): boolean {
  if (!membershipRule || !groupTag.trim()) return false;
  const clauses = parsePhysicalIdClauses(membershipRule);
  if (!clauses.some((c) => c.tag === "orderid")) return false;
  const gt = groupTag.trim().toLowerCase();
  const evaluate = (c: PhysicalIdClause): boolean => {
    if (c.tag !== "orderid") return true;
    const v = c.value.toLowerCase();
    return c.op === "eq" ? gt === v : gt.startsWith(v);
  };
  const combinesWithAnd = /\)\s+and\s+\(/i.test(membershipRule);
  return combinesWithAnd ? clauses.every(evaluate) : clauses.some(evaluate);
}

/**
 * Whether a membership rule is the default Autopilot-joined dynamic group,
 * i.e. the syntax Microsoft documents for "every Autopilot-registered device":
 *
 *   (device.devicePhysicalIds -any (_ -startsWith "[ZTDId]"))
 *
 * Every Autopilot device is assigned a ZTDId (Zero-Touch Device ID) written
 * into `devicePhysicalIds`, so this bare `[ZTDId]` startsWith check is what
 * "is this an Autopilot device" groups use. Like extractGroupTagStartsWithPrefix
 * this is anchored to match ONLY this single clause -- compound rules, `-eq`,
 * and other physical-id tags return false -- so the "Autopilot device" toggle
 * links to exactly these groups and nothing else.
 */
export function isDefaultAutopilotJoinedRule(membershipRule: string | undefined): boolean {
  if (!membershipRule) return false;
  return /^\s*\(?\s*device\.devicePhysicalIDs?\s+-any\s*\(\s*_\s*-startsWith\s+"\[ZTDId\]"\s*\)\s*\)?\s*$/i.test(
    membershipRule.trim()
  );
}
