// Shared types used by both the server (apps/server) and the web UI (apps/web).
// Kept deliberately small and flat -- this is the contract between the two apps.

export type PolicyKind =
  | "deviceConfiguration"
  | "settingsCatalog"
  | "compliancePolicy"
  | "adminTemplate";

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
  settings: CspSetting[];
  assignedGroupIds: string[];
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

export interface GroupBaseline {
  group: IntuneGroup;
  policies: { id: string; displayName: string; kind: PolicyKind }[];
  settings: BaselineSetting[];
  conflicts: ConflictingSetting[];
}

// --- Graph visualization payload ---

export type GraphNodeType = "group" | "policy" | "autopilot";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  kind?: PolicyKind;
  osLabel?: string;
  settingsCount?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
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

export interface AutopilotProfileSummary {
  id: string;
  displayName: string;
  osLabel: string;
  assignedGroupIds: string[];
}

/** Why a group is part of an endpoint simulation. */
export type SimulationGroupSource = "autopilot" | "selected" | "all-devices" | "all-users";

export interface SimulationGroup extends IntuneGroup {
  source: SimulationGroupSource;
}

export interface SimulationPolicy {
  id: string;
  displayName: string;
  kind: PolicyKind;
  /** Group ids (within this simulation) that assign this policy */
  viaGroupIds: string[];
}

export interface SimulationResult {
  groups: SimulationGroup[];
  policies: SimulationPolicy[];
  settings: BaselineSetting[];
  conflicts: ConflictingSetting[];
}
