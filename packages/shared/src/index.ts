// Shared types used by both the server (apps/server) and the web UI (apps/web).
// Kept deliberately small and flat -- this is the contract between the two apps.

export type PolicyKind =
  | "deviceConfiguration"
  | "settingsCatalog"
  | "compliancePolicy"
  | "adminTemplate";

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
  values: { value: string; sourcePolicyId: string; sourcePolicyName: string }[];
}

export interface BaselineSetting extends CspSetting {
  sourcePolicyId: string;
  sourcePolicyName: string;
  sourceKind: PolicyKind;
}

export interface ExcludedPolicy {
  id: string;
  displayName: string;
  kind: PolicyKind;
  /** Which of the queried group(s) caused the exclusion */
  excludedViaGroupIds: string[];
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
}

export interface SimulationResult {
  groups: SimulationGroup[];
  /** Policies that apply -- included and not excluded */
  policies: SimulationPolicy[];
  /** Policies that would otherwise apply but are explicitly excluded for one of the selected groups */
  excludedPolicies: SimulationPolicy[];
  settings: BaselineSetting[];
  conflicts: ConflictingSetting[];
}
