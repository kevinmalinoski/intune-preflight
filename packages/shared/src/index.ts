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

export interface ConflictingSetting {
  settingId: string;
  cspArea: string;
  displayName: string;
  values: { value: string; sourcePolicyId: string; sourcePolicyName: string; sourceKind: PolicyKind }[];
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
}

/** Why a group is part of an endpoint simulation. */
export type SimulationGroupSource = "selected" | "all-devices" | "all-users";

export interface SimulationGroup extends IntuneGroup {
  source: SimulationGroupSource;
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
}
