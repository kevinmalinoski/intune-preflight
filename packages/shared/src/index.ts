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
  /**
   * The real slash CSP path (baseUri + offsetUri from the setting definition),
   * e.g. "./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption". Only present
   * for Settings Catalog settings where the definition metadata was resolved;
   * for OMA-URI the settingId already is the path, and legacy profiles have none.
   */
  cspPath?: string;
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

/** One high-level Autopilot profile setting shown on the simulation card. */
export interface AutopilotProfileSetting {
  label: string;
  value: string;
  /** When the value is an Entra group id (e.g. APv2's just-in-time device group), set so it can be resolved to a name. */
  groupId?: string;
}

export interface AutopilotProfile {
  id: string;
  displayName: string;
  /** Resolved OS label shown in the UI, e.g. "Windows 11 23H2" */
  osLabel: string;
  /**
   * "v1" = Windows Autopilot deployment profile (device-group targeted, e.g.
   * via [ZTDId]/Group Tag dynamic groups). "v2" = Autopilot device preparation
   * policy (USER-group targeted; the policy names a just-in-time device group).
   */
  generation: "v1" | "v2";
  assignedGroupIds: string[];
  /** Exclusions win over includes, exactly like policy assignments. */
  excludedGroupIds: string[];
  /**
   * v2 only: the configured Autopilot device group (the policy's just-in-time
   * device group). Device-focused targeting keys on THIS group -- the user-group
   * assignment is who can enroll, not which device the policy governs.
   */
  deviceGroupId?: string;
  /** High-level configured settings (join type, account type, naming template, ...). */
  settings: AutopilotProfileSetting[];
}

/** An Autopilot profile's targeting outcome for a simulated endpoint. */
export interface SimulationAutopilotProfile {
  id: string;
  displayName: string;
  generation: "v1" | "v2";
  /** "excluded" when an exclusion matched -- shown, but it would NOT deploy. */
  status: "targeted" | "excluded";
  viaGroupIds: string[];
  excludedViaGroupIds: string[];
  settings: AutopilotProfileSetting[];
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

/**
 * A policy that exists in the tenant but has no include assignment -- it isn't
 * deployed to any group (or All Devices/All Users), so it never shows up in a
 * normal simulation. Surfaced so an admin can manually pull one into the
 * endpoint simulation ("what would this do if I assigned it?").
 */
export interface UnassignedPolicy {
  id: string;
  displayName: string;
  kind: PolicyKind;
  platform: Platform;
  settingsCount: number;
}

/** The synthetic source bucket for manually-added, unassigned policies in a simulation. */
export const UNASSIGNED_SOURCE_GROUP = {
  id: "virtual-unassigned",
  displayName: "No assignment (manually added)",
} as const;

/** How a group's membership is defined -- for the assignment report. */
export type GroupKind = "virtual" | "dynamic" | "assigned";

/** One policy-to-group assignment edge (include or exclude), for the tenant-wide assignment report. */
export interface AssignmentReportRow {
  policyId: string;
  policyName: string;
  kind: PolicyKind;
  platform: Platform;
  assignment: "Include" | "Exclude";
  groupId: string;
  groupName: string;
  groupKind: GroupKind;
  /** Assignment Filter scoping this include/exclude to matching devices, if any. */
  filterId?: string;
  filterName?: string;
  filterType?: "include" | "exclude";
}

/** Per-group rollup: how many policies target a group -- the assignment-overlap hotspots. */
export interface GroupOverlapSummary {
  groupId: string;
  groupName: string;
  groupKind: GroupKind;
  includeCount: number;
  excludeCount: number;
  /** Distinct policies targeting this group (include or exclude). */
  policyCount: number;
  platforms: Platform[];
  kinds: PolicyKind[];
  /**
   * Other targeted groups whose membership this (dynamic) group's rule logically
   * implies -- e.g. a Group Tag "[OrderID]:KIOSK-MULTI" group is a subset of a
   * broader startsWith group, so its members also inherit that group's policies.
   * Best-effort (same rule-implication logic as the simulator); verify in Entra.
   */
  impliedGroupIds: string[];
}

export interface AssignmentReport {
  rows: AssignmentReportRow[];
  /** Groups ranked by how many policies target them (most-targeted first). */
  groupOverlaps: GroupOverlapSummary[];
  totals: { policies: number; assigned: number; unassigned: number; groupsTargeted: number };
}

/** Why a group is part of an endpoint simulation. */
export type SimulationGroupSource = "selected" | "all-devices" | "all-users" | "implied" | "unassigned";

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
  /**
   * How many settings this policy *itself* defines -- independent of the merged
   * baseline. A policy whose settings all collide with another (e.g. two Feature
   * Update profiles both targeting a version) is deduped down in the merged
   * `settings`, but still shows its real count here for the diagram.
   */
  settingsCount: number;
  /** Group ids (within this simulation) that assign this policy */
  viaGroupIds: string[];
  /** Group ids (within this simulation) that exclude this policy -- only set when status is "excluded" */
  excludedViaGroupIds: string[];
  /** Set when exclusion is (also/instead) caused by an Assignment Filter. The
   * filterType matters for the reason shown: an INCLUDE filter drops the policy
   * when the device does NOT match it ("only targets matching devices"); an
   * EXCLUDE filter drops it when the device DOES match. */
  excludedByFilter?: { filterId: string; filterName: string; filterType: "include" | "exclude" };
  /** True when this policy was pulled in manually despite having no real group assignment (see UnassignedPolicy). */
  unassigned?: boolean;
}

export interface SimulationResult {
  groups: SimulationGroup[];
  /** Autopilot deployment profiles (v1) and device-preparation policies (v2) this endpoint's groups target. Windows only. */
  autopilotProfiles?: SimulationAutopilotProfile[];
  /** Policies that apply -- included and not excluded */
  policies: SimulationPolicy[];
  /** Policies that would otherwise apply but are explicitly excluded for one of the selected groups, or filtered out by an Assignment Filter */
  excludedPolicies: SimulationPolicy[];
  settings: BaselineSetting[];
  conflicts: ConflictingSetting[];
  overlaps: PolicyOverlap[];
}

/**
 * Plain-English reason a policy didn't apply because of an Assignment Filter,
 * phrased for the filter's DIRECTION. The two cases are opposites and reading
 * one as the other is the confusing part: an *include* filter scopes a policy to
 * only the devices that match it, so a non-matching device simply isn't targeted;
 * an *exclude* filter drops the policy precisely from the devices that do match.
 */
export function filterExclusionReason(filterName: string, filterType: "include" | "exclude"): string {
  return filterType === "include"
    ? `Only applies to devices matching the “${filterName}” filter — this device doesn’t match, so it isn’t applied`
    : `This device matches the “${filterName}” filter, which this policy excludes`;
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
 * A *bare* `[ZTDId]` clause -- "this device has an Autopilot device id at all",
 * with no `:value` suffix pinning it to one specific device. Every
 * Autopilot-registered device satisfies it, which is what makes it the
 * "is this an Autopilot device?" test.
 *
 * Accepts the shapes tenants actually write: the documented
 * `-any (_ -startsWith "[ZTDId]")`, the paren-less `-any _ -startsWith ...`,
 * and the `-contains` / `-eq` variants. Requires the quote immediately after
 * `]`, so `"[ZTDId]:<guid>"` (a single-device rule) deliberately does not match.
 */
const BARE_ZTDID_CLAUSE =
  /device\.devicePhysicalIDs?\s+-any\s*\(?\s*_\s*-(?:startsWith|contains|eq)\s+"\[ZTDId\]"/i;

/**
 * Splits a membership rule into its top-level `or` branches.
 *
 * Entra applies standard boolean precedence -- `and` binds tighter than `or` --
 * so `A and B or C` means `(A and B) or C`, and each top-level branch
 * independently grants membership. An `or` nested inside parentheses, or sitting
 * inside a quoted value, is not a split point.
 */
function splitTopLevelOr(rule: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < rule.length; i++) {
    const ch = rule[i];
    if (ch === '"') {
      inString = !inString;
    } else if (!inString) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0) {
        const m = /^\s+-?or\s+/i.exec(rule.slice(i));
        if (m) {
          branches.push(rule.slice(start, i));
          start = i + m[0].length;
          i = start - 1;
        }
      }
    }
  }
  branches.push(rule.slice(start));
  return branches;
}

/**
 * Whether every Autopilot-registered device would be a member of the group with
 * this membership rule -- i.e. whether the "Autopilot device" toggle should
 * select it.
 *
 * True when any **top-level `or` branch** is satisfied purely by a bare
 * `[ZTDId]` clause. That covers the documented standalone rule:
 *
 *   (device.devicePhysicalIds -any (_ -startsWith "[ZTDId]"))
 *
 * and -- the shape real tenants actually use -- the same clause as one branch of
 * an `or`, including when the *other* branch is itself a chain of `and`s:
 *
 *   (device.deviceOwnership -eq "Company") and (device.deviceOSType -eq "Windows")
 *     or (device.devicePhysicalIDs -any (_ -contains "[ZTDId]"))
 *
 * Because `and` binds tighter, that parses as `(ownership and osType) or (ZTDId)`
 * -- so an Autopilot device is a member via the ZTDId branch no matter what the
 * `and` chain says. Selecting the group is therefore correct, not a guess.
 *
 * An `and` *within the ZTDId branch itself* is the opposite case -- e.g.
 * `(ZTDId) and (device.deviceModel -not -startsWith "Cloud PC")` -- because
 * membership then also depends on a condition this evaluator can't check. Those
 * branches don't qualify, and the group is left for manual selection rather than
 * risking an over-match. String literals are blanked before the `and` test so a
 * Group Tag like "Sales and Marketing" can't read as a boolean operator.
 */
export function isAutopilotJoinedRule(membershipRule: string | undefined): boolean {
  if (!membershipRule) return false;
  return splitTopLevelOr(membershipRule).some((branch) => {
    if (!BARE_ZTDID_CLAUSE.test(branch)) return false;
    return !/\s+-?and\s+/i.test(branch.replace(/"[^"]*"/g, '""'));
  });
}
