// Shared types used by both the server (apps/server) and the web UI (apps/web).
// Kept deliberately small and flat -- this is the contract between the two apps.

export type PolicyKind =
  | "deviceConfiguration"
  | "settingsCatalog"
  | "compliancePolicy"
  | "adminTemplate"
  | "platformScript"
  // Legacy Endpoint Security & Security Baselines stored under
  // deviceManagement/intents (the older template-based "intents" model) --
  // e.g. legacy BitLocker / Disk Encryption, Defender Antivirus, Firewall, ASR.
  | "endpointSecurity";

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
  /**
   * This object's page in the admin center. Set only by the Graph loader, and
   * only for the object types whose address is known with confidence -- see
   * the portal URL builders. Absent in the demo tenant, whose ids are made up.
   */
  portalUrl?: string;
}

/**
 * How two or more policies that configure the SAME setting resolve on the
 * device, when the answer is NOT "one policy overrides another".
 *
 * Conflict detection assumes the override model, and for most policy types that
 * is right: Intune reports a conflict and applies NEITHER value until an admin
 * resolves it. The rules below are the documented exceptions, where several
 * policies configuring one setting is resolved rather than refused -- so
 * reporting a conflict would claim the device is stuck when it isn't.
 *
 * Naming the rule is as far as this goes. The tool does NOT apply it and does
 * NOT compute a winner from it -- see LayeredSetting.
 */
export type ResolutionRule =
  /**
   * Windows Feature Update profiles. Windows Update evaluates every applicable
   * policy and offers only one feature update at a time, "always ... the latest
   * applicable version" -- bounded by the build the device already runs, since a
   * feature update policy never downgrades a device. NOT cumulative, and not a
   * refusal to apply.
   * learn.microsoft.com/intune/device-updates/windows/configure-feature-update-policy#how-feature-update-policies-are-evaluated
   */
  | "latest-version-wins"
  /**
   * Device compliance policies: "If a compliance policy evaluates against the
   * same setting in another compliance policy, then the most restrictive
   * compliance policy setting applies."
   * learn.microsoft.com/intune/device-configuration/troubleshoot-device-profiles#conflicts
   */
  | "most-restrictive-wins"
  /**
   * Windows Driver Update profiles, per update: "Because the status of approved
   * always wins, the driver installs on the device despite any other status for
   * that update that is set in any other policy."
   * learn.microsoft.com/intune/device-updates/windows/driver-updates-faq#policy-basics
   */
  | "approved-wins"
  /**
   * Known NOT to be a plain override, but Microsoft documents no rule for two
   * policies of the type targeting one device -- Windows Quality Update
   * (expedite) profiles, whose documented behaviour is per-device applicability
   * and supersession rather than policy precedence. Reported, never adjudicated.
   * learn.microsoft.com/intune/device-updates/windows/configure-expedite-policy#identify-the-latest-applicable-update
   */
  | "undocumented";

/** Short label for a resolution rule -- a badge, or a CSV cell. */
export function resolutionRuleLabel(rule: ResolutionRule): string {
  switch (rule) {
    case "latest-version-wins":
      return "latest version";
    case "most-restrictive-wins":
      return "most restrictive";
    case "approved-wins":
      return "approved wins";
    case "undocumented":
      return "not documented";
  }
}

/**
 * What the rule means, for a tooltip. Every one of these ends by saying the tool
 * doesn't pick, because that is the whole point of reporting these separately
 * from conflicts: the admin is told the rule and left to apply it.
 */
export function resolutionRuleDetail(rule: ResolutionRule): string {
  switch (rule) {
    case "latest-version-wins":
      return "Several policies configure this, and they aren't resolved by one overriding another: Windows Update offers only one feature update at a time and takes the latest applicable version. Every targeted version is listed — this tool doesn't work out which one a given device lands on.";
    case "most-restrictive-wins":
      return "Several compliance policies evaluate this setting. Intune applies the most restrictive of them rather than reporting a conflict. Every value is listed — this tool doesn't rank them.";
    case "approved-wins":
      return "Several driver update policies cover this. An approved status always wins over any other status for the same update, so these don't resolve by one policy overriding another. Every value is listed — this tool doesn't pick.";
    case "undocumented":
      return "Several policies configure this, and Microsoft documents no resolution rule for this policy type. Treat every value as in play and verify on a device — this tool won't guess.";
  }
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
  /**
   * An explicit Microsoft Learn documentation URL for this setting, when the
   * source provides one directly (legacy Endpoint Security intents carry a
   * `documentationUrl` on their setting definition). Preferred over the link
   * derived from `cspPath`/`settingId`, which is only a best-effort guess.
   */
  docUrl?: string;
  /**
   * A model-agnostic canonical CSP identity (e.g. "accounts/allowmicrosoftaccountconnection")
   * shared across policy models when known: derived from the real CSP path for
   * Settings Catalog / OMA-URI, or from the template→CSP crosswalk for a legacy
   * device-config template property. Lets the SAME underlying CSP configured via
   * different models be cross-detected (see CrossModelFinding). Absent when no
   * canonical identity is known -- most legacy settings have none.
   */
  cspNode?: string;
  /**
   * For a crosswalked legacy-template setting: its raw value mapped into the
   * canonical CSP value space (e.g. `microsoftAccountBlocked: "true"` -> "Block"),
   * so cross-model agreement can be judged against a Settings Catalog value.
   */
  cspNodeValue?: string;
  /**
   * Set when this setting's policy TYPE resolves multiple configuring policies
   * by a documented rule other than "one policy overrides another" (see
   * ResolutionRule). Classified once at normalize time from the policy's
   * `@odata.type`, so it is present whether or not another policy happens to
   * configure the same setting -- it describes the type, not the collision.
   *
   * The merge consults it only when policies actually DISAGREE, and routes
   * those to `SimulationResult.layered` instead of `conflicts`.
   */
  resolution?: ResolutionRule;
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
  /**
   * True for the deprecated device-configuration TEMPLATE types Microsoft is
   * migrating to the Settings Catalog -- Device restrictions/features, Endpoint
   * protection, Extensions. Surfaced as a "Legacy template" flag nudging a
   * Settings Catalog migration. The still-current templates (certificates, VPN,
   * Wi-Fi, email, wired network) are deliberately NOT flagged.
   */
  legacyTemplate?: boolean;
  /**
   * This object's page in the admin center. Set only by the Graph loader, and
   * only for the object types whose address is known with confidence -- see
   * the portal URL builders. Absent in the demo tenant, whose ids are made up.
   */
  portalUrl?: string;
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

/**
 * Two or more applied policies set the same CSP setting to DIFFERENT values,
 * but the policy type does NOT resolve that by one policy overriding another --
 * so it is not a ConflictingSetting. Windows Feature Update profiles naming
 * three versions are the motivating case: Windows Update takes the latest
 * applicable one, it does not refuse to apply any of them.
 *
 * The distinction is operational, not cosmetic. A `ConflictingSetting` means
 * Intune applies NEITHER value until an admin intervenes, which is what an
 * admin acts on when they see one. These resolve instead, under `rule`.
 *
 * `rule` is reported, never applied: `values` lists every contributing policy
 * with equal standing and nothing here marks one of them as the effective
 * value. Microsoft's own pages are not always self-consistent about the
 * tiebreak, and the device's current state (its installed build, for a feature
 * update) is outside what a tenant-side simulation can see -- so computing a
 * winner would be a guess dressed as an answer. Same principle as
 * `BaselineSetting.conflicted`, applied to a second kind of finding.
 */
export interface LayeredSetting {
  settingId: string;
  cspArea: string;
  displayName: string;
  /** The documented resolution rule for this setting's policy type. */
  rule: ResolutionRule;
  /** Every contributing policy and its value -- in no significant order. */
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
  /** True when the source policy is a deprecated device-config template. */
  sourceLegacyTemplate?: boolean;
  /**
   * True when two or more applied policies set this setting to DIFFERENT values.
   *
   * Read this before trusting `value`: the merged baseline carries ONE row per
   * setting, so for a conflicted setting `value` (and `sourcePolicyId` /
   * `sourcePolicyName` / `sourceKind` with it) is just the first contributing
   * policy the tenant load happened to reach -- NOT a computed winner. The tool
   * deliberately doesn't claim to know which value wins on the device; the full
   * disagreement is in `SimulationResult.conflicts`, keyed by the same
   * `settingId`.
   *
   * The UI and the CSV export already expand conflicts to one row per value.
   * This flag is for consumers of the JSON export and `GET /api/simulate`, where
   * a single `value` would otherwise read as the effective one.
   *
   * Set for a genuine conflict ONLY, so it always has a `SimulationResult.conflicts`
   * entry to point at. A setting whose policies disagree under a documented
   * resolution rule carries `layered` below instead.
   */
  conflicted?: boolean;
  /**
   * True when two or more applied policies set this setting to DIFFERENT values
   * AND the policy type resolves that by a documented rule rather than by one
   * policy overriding another -- see LayeredSetting and ResolutionRule.
   *
   * Carries exactly the same warning as `conflicted`: `value` here is the first
   * contributing policy the tenant load happened to reach, NOT the value the
   * rule would select. The tool names the rule and lists every value; it does
   * not apply the rule. The full picture is in `SimulationResult.layered`, keyed
   * by the same `settingId`.
   *
   * Mutually exclusive with `conflicted`.
   */
  layered?: boolean;
}

/**
 * The SAME underlying CSP configured by two or more policies of DIFFERENT models
 * (Settings Catalog, legacy device-config template, OMA-URI custom) -- which the
 * per-model settingId keying can't see, so it never shows as a normal
 * conflict/overlap. Best-effort: only settings with a known canonical `cspNode`
 * participate (Settings Catalog + OMA-URI via their real path, plus the curated
 * template→CSP crosswalk), so this checks common settings, not every one.
 */
export interface CrossModelFinding {
  /** Canonical CSP identity shared by the entries. */
  cspNode: string;
  displayName: string;
  /**
   * How the entries' canonical values compare: "differs" = a real cross-model
   * conflict; "same" = redundant cross-model overlap; "unknown" = a value we
   * couldn't map into a common space, so verify manually.
   */
  agreement: "same" | "differs" | "unknown";
  entries: {
    settingId: string;
    /** The value as shown in its own model (raw), for display. */
    value: string;
    /** The value mapped to the canonical CSP space when known, for comparison. */
    canonicalValue?: string;
    sourcePolicyId: string;
    sourcePolicyName: string;
    sourceKind: PolicyKind;
    sourceLegacyTemplate?: boolean;
  }[];
}

export interface GroupSummary {
  id: string;
  displayName: string;
  /** See IntunePolicy.portalUrl. */
  portalUrl?: string;
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
  /** True for a deprecated device-config template (see IntunePolicy.legacyTemplate). */
  legacyTemplate?: boolean;
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

/**
 * What an app assignment asks Intune to do with the app. Graph's fourth intent,
 * `availableWithoutEnrollment`, is folded into "available" with a flag (see
 * AppAssignment.withoutEnrollment): to an enrolled device it IS an available
 * assignment, and a preflight only ever simulates an enrolled device.
 */
export type AppIntent = "required" | "available" | "uninstall";

/** Section order for anything that lists apps by intent. */
export const APP_INTENTS: readonly AppIntent[] = ["required", "available", "uninstall"];

export function appIntentLabel(intent: AppIntent): string {
  switch (intent) {
    case "required":
      return "Required";
    case "available":
      return "Available";
    case "uninstall":
      return "Uninstall";
  }
}

/** One assignment edge of an app: an intent, a group, and whether it includes or excludes. */
export interface AppAssignment {
  intent: AppIntent;
  /** Graph's `availableWithoutEnrollment` -- "Available with or without enrollment" in the portal. */
  withoutEnrollment?: boolean;
  /** Real group id, or the virtual All Devices / All Users id. */
  groupId: string;
  /** True for an exclusion. Exclusions sit under an intent, as they do in the portal. */
  exclude: boolean;
  filter?: { filterId: string; filterType: "include" | "exclude" };
}

/**
 * Which OS an app installs on. "all" is a web link, which Intune offers on every
 * platform; "other" is a type this tool can't place, kept out of a
 * platform-scoped simulation rather than guessed into one.
 */
export type AppPlatform = Platform | "all";

/**
 * How an app is packaged and delivered, reduced to the handful of families an
 * admin actually thinks in. `appType` is the precise name ("Windows
 * line-of-business app (MSI)"); this is what a tag or a tally groups by.
 *
 * "catalog" is the Enterprise App Catalog (Enterprise App Management); "lob" is
 * a line-of-business upload on any platform; "package" is a macOS PKG or DMG.
 * "builtin" is the apps Intune ships its own app type for, with no installer
 * to upload -- Microsoft 365 Apps, Microsoft Edge, Microsoft Defender. One
 * family, because there are only ever one or two of each and they are the same
 * kind of thing: Microsoft's own, configured rather than packaged.
 */
export type AppFamily = "win32" | "store" | "catalog" | "lob" | "builtin" | "web" | "vpp" | "package" | "other";

/** Display order for anything that tallies apps by family. */
export const APP_FAMILIES: readonly AppFamily[] = [
  "win32",
  "catalog",
  "store",
  "lob",
  "builtin",
  "vpp",
  "package",
  "web",
  "other",
];

/** The short tag for a family, and the name it abbreviates. */
export const APP_FAMILY_LABEL: Record<AppFamily, { tag: string; name: string }> = {
  win32: { tag: "Win32", name: "Win32 app (.intunewin)" },
  catalog: { tag: "EAM", name: "Enterprise App Catalog (Enterprise App Management)" },
  store: { tag: "Store", name: "Store app" },
  lob: { tag: "LOB", name: "Line-of-business app" },
  builtin: { tag: "Built-in", name: "Built-in Microsoft apps" },
  vpp: { tag: "VPP", name: "Apple volume-purchased app" },
  package: { tag: "PKG", name: "macOS package (PKG / DMG)" },
  web: { tag: "Web", name: "Web link" },
  other: { tag: "Other", name: "Other app type" },
};

/**
 * One of the checks Intune uses to decide whether an app is installed -- the
 * app's own detection rule, as configured on the app in Intune.
 *
 * `summary` is the rule in words ("File C:\\Program Files\\7-Zip\\7z.exe exists").
 * A custom detection script is reported as a script and nothing more: its
 * content is code, not a rule that reads as one line, and it is never loaded
 * into the simulation or an export.
 */
export interface AppDetection {
  method: "file" | "registry" | "msi" | "script" | "store" | "other";
  summary: string;
}

/** What each detection method is called in an export. */
export const APP_DETECTION_METHOD_LABEL: Record<AppDetection["method"], string> = {
  file: "File",
  registry: "Registry",
  msi: "MSI product code",
  script: "Custom script",
  store: "Store package",
  other: "Other",
};

/** An Intune app (deviceAppManagement/mobileApps) that has at least one assignment. */
export interface IntuneApp {
  id: string;
  displayName: string;
  /** See IntunePolicy.portalUrl. */
  portalUrl?: string;
  publisher?: string;
  /** Human-readable app type, e.g. "Windows app (Win32)". */
  appType: string;
  family: AppFamily;
  /**
   * True for a Windows line-of-business app uploaded as an .msi
   * (`windowsMobileMSI`) -- the one type Microsoft's guidance says to repackage
   * as a Win32 app. See AppLobMsiFinding. Not set for MSIX/AppX line-of-business
   * apps, which install by a different mechanism and are not part of that advice.
   */
  lobMsi?: boolean;
  /**
   * How Intune detects the app as installed. Every rule must pass. Absent for
   * app types that have no configurable detection (Microsoft 365 Apps, Edge,
   * web links, ...).
   */
  detection?: AppDetection[];
  platform: AppPlatform;
  assignments: AppAssignment[];
}

/**
 * Why the tenant's apps are not in a load. Deliberately NOT a load warning:
 * warnings mean the BASELINE is incomplete, and apps are not part of the
 * baseline. A tenant that never granted the apps permission has a complete
 * baseline and no Apps view, which is a state to explain, not an alarm to raise.
 */
export interface AppsUnavailable {
  /** "permission": Graph refused the read (403). "error": anything else. */
  reason: "permission" | "error";
  detail: string;
}

/** The Graph permission the Apps view needs, named once so every message agrees. */
export const APPS_GRAPH_PERMISSION = "DeviceManagementApps.Read.All";

/** One app under one intent, as it lands on the simulated endpoint. */
export interface SimulationApp {
  id: string;
  displayName: string;
  /** See IntunePolicy.portalUrl. */
  portalUrl?: string;
  publisher?: string;
  appType: string;
  family: AppFamily;
  /** See IntuneApp.lobMsi. */
  lobMsi?: boolean;
  /** See IntuneApp.detection. */
  detection?: AppDetection[];
  platform: AppPlatform;
  intent: AppIntent;
  /** Set when every assignment delivering it is "available with or without enrollment". */
  withoutEnrollment?: boolean;
  status: "included" | "excluded";
  /** Group ids (within this simulation) whose assignment delivers the app under this intent. */
  viaGroupIds: string[];
  /** Group ids (within this simulation) excluded under this intent -- only set when status is "excluded". */
  excludedViaGroupIds: string[];
  /** Set when an Assignment Filter is why it doesn't land (see SimulationPolicy.excludedByFilter). */
  excludedByFilter?: { filterId: string; filterName: string; filterType: "include" | "exclude" };
}

/** An app's landed intents and the groups behind each, as a finding lists them. */
export interface AppIntentVia {
  intent: AppIntent;
  viaGroupIds: string[];
}

/**
 * The three things the Apps view detects, each the counterpart of a settings
 * finding. The aim they all serve: one product should reach a device once,
 * under one intent.
 *
 *   Conflict     -- one app lands to be installed AND to be uninstalled.
 *                   (Settings: a conflict.)
 *   Redundant    -- one app lands under Required and Available, or under one
 *                   intent through several groups. Nothing is contested; an
 *                   assignment is doing no work. (Settings: an overlap.)
 *   Same product -- DIFFERENT app objects that look like one product. Intune
 *                   never compares these, so it reports nothing however they
 *                   are assigned. (Settings: a cross-model collision.)
 */

/**
 * One app reaching the endpoint both to be installed (Required or Available)
 * and to be uninstalled, with no exclusion keeping the two apart.
 *
 * Intune resolves this by a documented table rather than refusing to act --
 * Required always beats Uninstall -- but Available against Uninstall depends on
 * whether each assignment targets a USER group or a DEVICE group, which this
 * tool cannot tell apart. So, as with LayeredSetting, it names the rule and
 * lists every assignment with equal standing. It does not pick.
 * learn.microsoft.com/intune/intune-service/apps/apps-deploy#how-conflicts-between-app-intents-are-resolved
 */
export interface AppIntentConflict {
  appId: string;
  displayName: string;
  intents: AppIntentVia[];
}

export const APP_INTENT_CONFLICT_DETAIL =
  "This app is assigned both to install and to uninstall on this device, and nothing excludes one from the other. Intune resolves it by a documented table: Required always wins over Uninstall, but Available against Uninstall depends on whether each group holds users or devices, which this tool can't see. Every assignment is listed — this tool doesn't work out which wins. To settle it, exclude one group from the other assignment (exclusions only take precedence between groups of the same kind).";

/**
 * An assignment that changes nothing about what the device gets.
 *
 * "required-and-available": the app is Required, so it installs regardless, and
 * is also Available. Every row of Microsoft's table resolves that pairing to
 * "Required and Available", so it is supported -- but the Available assignment
 * adds only a Company Portal listing.
 *
 * "multiple-groups": one intent delivered through several of the endpoint's
 * groups (All Devices and a specific group, say). `intent` names which.
 */
export interface AppRedundancy {
  appId: string;
  displayName: string;
  kind: "required-and-available" | "multiple-groups";
  /** Set for "multiple-groups": the intent that arrives more than once. */
  intent?: AppIntent;
  intents: AppIntentVia[];
}

export function appRedundancyDetail(redundancy: AppRedundancy): string {
  return redundancy.kind === "required-and-available"
    ? "Assigned as both Required and Available. The app installs either way, so the Available assignment isn't needed to deliver it — it only keeps the app listed in Company Portal. Keep it if you want that; otherwise it is one assignment more than this needs."
    : "The same intent reaches this device through more than one group. Any one of them would deliver the app, so the others change nothing here — though they may matter for devices that are in only one of those groups.";
}

/**
 * Several DIFFERENT app objects that appear to be one product -- a Store app
 * and a Win32 package of the same title, or three versions of one installer.
 *
 * Intune's intent rules apply within one app object and never across two, so
 * it reports no conflict here whatever the assignments are: a device can be
 * told to install one object and uninstall another of the same product. That
 * is `opposing`.
 *
 * Matched on NAME, after stripping versions, architecture and packaging words
 * (see appProductKey in the engine). That is a heuristic and is reported as
 * one: "verify", never "conflict". A package whose whole job is to remove
 * something will pair with the thing it removes, and that is often deliberate.
 */
export interface AppProductFinding {
  /** The normalized name the apps matched on. */
  product: string;
  /** True when one of the apps lands as Uninstall and a different one as Required or Available. */
  opposing: boolean;
  apps: { appId: string; displayName: string; appType: string; intents: AppIntent[] }[];
}

export const APP_SAME_PRODUCT_DETAIL =
  "These are separate apps in Intune that look like the same product. Intune only compares assignments within one app, never across two, so it reports nothing here — even when one is set to install and another to uninstall. Matched on name, which is a guess: check whether they really are the same thing and whether the device should get more than one.";

/**
 * A Windows line-of-business .msi that lands on the endpoint. A recommendation
 * rather than a fault: the app works, but Microsoft's guidance is to deploy
 * Windows apps through the Win32 app type exclusively.
 *
 * The reason is concrete. An LOB .msi is installed by the MDM agent and a Win32
 * app by the Intune Management Extension, and both go through the Windows
 * TrustedInstaller service, which runs one installation at a time. During
 * Windows Autopilot's Enrollment Status Page the two collide, the Win32 install
 * fails with "Another installation is in progress", and ESP fails with it.
 * Windows Autopilot device preparation does not use ESP and supports the mix.
 * learn.microsoft.com/intune/app-management/deployment/win32
 * learn.microsoft.com/intune/device-enrollment/windows/setup-status-page#esp-tracking
 */
export interface AppLobMsiFinding {
  appId: string;
  displayName: string;
  intents: AppIntent[];
}

/** Microsoft's Win32 app management article, which carries the recommendation. */
export const APP_LOB_LEARN_URL = "https://learn.microsoft.com/intune/app-management/deployment/win32";
/** The Enrollment Status Page article, which states the "don't mix" rule outright. */
export const APP_LOB_ESP_LEARN_URL =
  "https://learn.microsoft.com/intune/device-enrollment/windows/setup-status-page#esp-tracking";

export const APP_LOB_MSI_DETAIL =
  "A line-of-business .msi. Microsoft recommends deploying Windows apps as Win32 apps exclusively: repackage the .msi as an .intunewin with the Win32 Content Prep Tool. Win32 apps add detection rules, requirements, dependencies, supersedence and Delivery Optimization, and avoid the install clash described below.";

export const APP_LOB_MIXED_DETAIL =
  "This endpoint gets line-of-business .msi apps and Win32 apps together. Both install through the Windows TrustedInstaller service, which runs one installation at a time, so during Windows Autopilot enrollment a Win32 install can fail with “Another installation is in progress” and take the Enrollment Status Page down with it. Windows Autopilot device preparation supports the mix; classic Autopilot does not.";

/**
 * How each app finding is detected, written out once.
 *
 * A flag nobody can check is a flag nobody should act on. These are the exact
 * conditions the engine tests (see simulateApps), in plain words, and they are
 * the single source for both the "Finding definitions" sheet in the Excel export
 * and anything in the UI that explains a finding -- so the definition an admin
 * reads is the one the code runs, not a paraphrase that can drift from it.
 */
export interface AppFindingRule {
  id: "conflict" | "redundant-available" | "redundant-groups" | "same-product" | "lob-msi" | "lob-mixed";
  finding: string;
  /** The export column this finding appears in. */
  column: string;
  /** How much weight to give it. */
  kind: "Conflict" | "Redundant" | "Verify" | "Recommendation";
  detectedWhen: string;
  meaning: string;
  action: string;
  reference: string;
}

const APPS_DEPLOY_URL =
  "https://learn.microsoft.com/intune/intune-service/apps/apps-deploy#how-conflicts-between-app-intents-are-resolved";

export const APP_FINDING_RULES: readonly AppFindingRule[] = [
  {
    id: "conflict",
    finding: "Install + uninstall conflict",
    column: "Intent Conflict",
    kind: "Conflict",
    detectedWhen:
      "One app object lands on the endpoint under Uninstall AND under Required or Available. Only assignments that actually land are compared: an intent removed by an exclusion group or an Assignment Filter does not count.",
    meaning:
      "The device is told to install and to remove the same app. Intune resolves it by rule: Required always beats Uninstall; Available against Uninstall depends on whether each group holds users or devices, which this tool cannot see. No winner is computed.",
    action:
      "Exclude one group from the other assignment. Exclusions only take precedence between groups of the same kind (user with user, device with device).",
    reference: APPS_DEPLOY_URL,
  },
  {
    id: "redundant-available",
    finding: "Redundant: Available on a Required app",
    column: "Redundant",
    kind: "Redundant",
    detectedWhen: "One app object lands on the endpoint under both Required and Available.",
    meaning:
      "Supported, and Intune treats it as “Required and Available”. The app installs either way; the Available assignment only keeps it listed in Company Portal.",
    action: "Remove the Available assignment unless you want the app shown in Company Portal.",
    reference: APPS_DEPLOY_URL,
  },
  {
    id: "redundant-groups",
    finding: "Redundant: one intent through several groups",
    column: "Redundant",
    kind: "Redundant",
    detectedWhen: "One app object lands under a single intent through two or more of the endpoint’s groups.",
    meaning:
      "Any one of those groups would deliver the app to this endpoint. The others change nothing here, though they may matter to devices in only one of the groups.",
    action: "Check whether every one of those assignments is still needed.",
    reference: APPS_DEPLOY_URL,
  },
  {
    id: "same-product",
    finding: "Same product, several apps",
    column: "Same Product As",
    kind: "Verify",
    detectedWhen:
      "Two or more DIFFERENT app objects that land on the endpoint have the same name once bracketed text, dotted version numbers and packaging words (x64, msi, win32, store, auto-update, installer, uninstaller, …) are removed. Marked “opposing intents” when one lands as Uninstall and another as Required or Available.",
    meaning:
      "Intune compares assignments within one app object and never across two, so it reports no conflict here even when one object installs and another removes the same product. A name match is a guess: an uninstaller package pairs with the app it removes, often on purpose.",
    action: "Confirm they are the same product and decide which one object the device should get.",
    reference: APPS_DEPLOY_URL,
  },
  {
    id: "lob-msi",
    finding: "Line-of-business .msi",
    column: "Recommendation",
    kind: "Recommendation",
    detectedWhen:
      "An app of Intune type “Windows line-of-business app (MSI)” (Graph: windowsMobileMSI) lands under Required or Available. MSIX/AppX line-of-business apps, and apps assigned only to uninstall, are not flagged.",
    meaning:
      "It works, but Microsoft recommends deploying Windows apps through the Win32 app type exclusively. Win32 apps add detection rules, requirements, dependencies, supersedence and Delivery Optimization.",
    action:
      "Repackage the .msi as an .intunewin with the Microsoft Win32 Content Prep Tool and deploy it as a Win32 app.",
    reference: "https://learn.microsoft.com/intune/app-management/deployment/win32",
  },
  {
    id: "lob-mixed",
    finding: "Line-of-business .msi mixed with Win32",
    column: "Recommendation",
    kind: "Recommendation",
    detectedWhen:
      "At least one line-of-business .msi is flagged (above) AND a Win32 or Enterprise App Catalog app also lands under Required or Available.",
    meaning:
      "Both install through the Windows TrustedInstaller service, one at a time. During classic Windows Autopilot a Win32 install can fail with “Another installation is in progress” and fail the Enrollment Status Page. Autopilot device preparation supports the mix.",
    action: "Convert the line-of-business apps to Win32, or enroll with Autopilot device preparation.",
    reference: "https://learn.microsoft.com/intune/device-enrollment/windows/setup-status-page#esp-tracking",
  },
];

/** The Apps half of a simulation. */
export interface SimulationApps {
  /** Set when the tenant's apps could not be read; every list is then empty. */
  unavailable?: AppsUnavailable;
  /** Apps that land, one entry per (app, intent), ordered by intent then name. */
  apps: SimulationApp[];
  /** Apps a selected group would deliver but an exclusion or Assignment Filter carves out. */
  excluded: SimulationApp[];
  /** One app assigned to install and to uninstall. See AppIntentConflict. */
  conflicts: AppIntentConflict[];
  /** Assignments that change nothing. See AppRedundancy. */
  redundant: AppRedundancy[];
  /** Different app objects that look like one product. Best-effort. See AppProductFinding. */
  sameProduct: AppProductFinding[];
  /** Line-of-business .msi apps that land -- a "convert to Win32" recommendation. See AppLobMsiFinding. */
  lobMsi: AppLobMsiFinding[];
  /** True when `lobMsi` apps land alongside Win32-family apps, which is the combination that breaks ESP. */
  lobMixedWithWin32: boolean;
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
  /** See IntunePolicy.portalUrl. */
  portalUrl?: string;
  /** True for a deprecated device-config template (see IntunePolicy.legacyTemplate). */
  legacyTemplate?: boolean;
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
  /**
   * Settings several applied policies disagree on where the policy type does
   * NOT resolve by one policy overriding another -- Windows Feature Update
   * profiles, compliance policies, driver update profiles. Reported apart from
   * `conflicts` because "Intune applies neither value" is false of these, and
   * that is what a conflict tells an admin. See LayeredSetting. Windows-only,
   * like conflicts/overlaps.
   */
  layered: LayeredSetting[];
  overlaps: PolicyOverlap[];
  /**
   * Cross-MODEL findings: the same CSP configured via different policy models
   * (e.g. a legacy Device Restrictions template AND a Settings Catalog policy),
   * which the per-model `conflicts`/`overlaps` above can't detect. Best-effort /
   * common-settings only. Windows-only, like conflicts/overlaps.
   */
  crossModel: CrossModelFinding[];
  /**
   * Apps the endpoint's groups deliver, by intent. Absent when the data source
   * carries no app data at all (the bundled demo tenant), which is different
   * from `apps.unavailable` -- a real tenant whose apps could not be read.
   */
  apps?: SimulationApps;
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
    clauses.push({
      tag: match[2].toLowerCase(),
      op: match[1].toLowerCase() as "eq" | "startswith",
      value: match[3] ?? "",
    });
  }
  return clauses;
}

/** Whether a membership rule scopes on an Autopilot Group Tag ([OrderID]) at all. */
export function isGroupTagRule(membershipRule: string | undefined): boolean {
  if (!membershipRule) return false;
  return parsePhysicalIdClauses(membershipRule).some((c) => c.tag === "orderid");
}

/**
 * A compact display of the Group Tag(s) a rule is scoped to, for showing inline
 * next to a group in the picker -- e.g. `-startsWith "[OrderID]:KIOSK"` -> "KIOSK*"
 * (the `*` marks a prefix match), `-eq "[OrderID]:KIOSK-01"` -> "KIOSK-01". Returns
 * undefined when the rule has no `[OrderID]` clause.
 */
export function groupTagScope(membershipRule: string | undefined): string | undefined {
  if (!membershipRule) return undefined;
  const orderIds = parsePhysicalIdClauses(membershipRule).filter((c) => c.tag === "orderid");
  if (orderIds.length === 0) return undefined;
  return orderIds.map((c) => (c.op === "startswith" ? `${c.value}*` : c.value)).join(", ");
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
 * Whether a membership rule references device/user properties BEYOND the
 * `devicePhysicalIds` (Group Tag / Autopilot) clauses -- e.g. `device.deviceOSType`,
 * `device.deviceCategory`, an `extensionAttribute`. A simulated Group Tag can't
 * decide those, so a match that hinges on them isn't fully evaluated.
 */
export function ruleReferencesOtherProperties(membershipRule: string | undefined): boolean {
  if (!membershipRule) return false;
  const stripped = membershipRule.replace(/device\.devicePhysicalIDs?\s+-any\s*\([^)]*\)/gi, " ");
  return /\b(?:device|user)\.[a-zA-Z]/.test(stripped);
}

/** How a dynamic group's rule relates to a simulated Group Tag (for the picker). */
export interface GroupTagMatch {
  /**
   * "match": the Group Tag confidently satisfies the rule's `[OrderID]` clauses
   * (auto-selected). "conditional": an `[OrderID]` clause IS satisfied by the tag
   * but the combined rule can't be confirmed by the flat evaluator (nesting /
   * multiple ANDed tags) -- surface it, don't auto-select. "none": tag not referenced.
   */
  state: "match" | "conditional" | "none";
  /**
   * False when the rule also hinges on properties a Group Tag can't decide (see
   * ruleReferencesOtherProperties) -- the result is best-effort on the tag alone.
   */
  fullyEvaluated: boolean;
}

/**
 * Classify a dynamic group's membership rule against a simulated Autopilot Group
 * Tag. Practical by design: the Group Tag ([OrderID]) is evaluated; other device
 * properties are NOT guessed -- they only downgrade `fullyEvaluated` so the UI can
 * show the rule and let a human confirm, rather than over-claiming a match.
 */
export function classifyGroupTagMatch(membershipRule: string | undefined, groupTag: string): GroupTagMatch {
  const tag = groupTag.trim();
  if (!membershipRule || !tag) return { state: "none", fullyEvaluated: true };
  const gt = tag.toLowerCase();
  const orderIdSatisfied = parsePhysicalIdClauses(membershipRule).some(
    (c) => c.tag === "orderid" && (c.op === "eq" ? gt === c.value.toLowerCase() : gt.startsWith(c.value.toLowerCase()))
  );
  if (!orderIdSatisfied) return { state: "none", fullyEvaluated: true };
  return {
    state: groupTagMatchesRule(membershipRule, tag) ? "match" : "conditional",
    fullyEvaluated: !ruleReferencesOtherProperties(membershipRule),
  };
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
const BARE_ZTDID_CLAUSE = /device\.devicePhysicalIDs?\s+-any\s*\(?\s*_\s*-(?:startsWith|contains|eq)\s+"\[ZTDId\]"/i;

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

/** How a dynamic group's rule relates to a simulated Autopilot device (for the picker). */
export interface AutopilotMatch {
  /**
   * "match": a bare `[ZTDId]` clause grants membership on its own -- every
   * Autopilot device qualifies (auto-selected; identical to isAutopilotJoinedRule).
   * "conditional": the rule DOES key on Autopilot (a bare `[ZTDId]` clause) but ANDs
   * it with a device condition the flat evaluator can't check -- e.g.
   * `... and (device.deviceModel -not -startsWith "Cloud PC")` -- so surface it and
   * show the rule, don't auto-select. "none": no bare `[ZTDId]` Autopilot marker.
   */
  state: "match" | "conditional" | "none";
}

/**
 * Classify a dynamic group's membership rule against a simulated Autopilot device.
 * Mirrors classifyGroupTagMatch: the `[ZTDId]` Autopilot marker is recognized, but
 * ANDed device conditions are NOT guessed -- an `and` next to the `[ZTDId]` clause
 * downgrades a clean "match" to "conditional" so the picker can surface the group
 * (with its rule) for a human to opt into, rather than over-matching on a condition
 * it can't evaluate. A single-device `"[ZTDId]:<guid>"` rule is not a marker (see
 * BARE_ZTDID_CLAUSE) and stays "none".
 */
export function classifyAutopilotMatch(membershipRule: string | undefined): AutopilotMatch {
  if (!membershipRule) return { state: "none" };
  if (isAutopilotJoinedRule(membershipRule)) return { state: "match" };
  return { state: BARE_ZTDID_CLAUSE.test(membershipRule) ? "conditional" : "none" };
}

// ---------------------------------------------------------------------------
// Admin center links
//
// Microsoft documents no per-object address for the Intune admin center. These
// are the portal's own routes, and each one here has a source it can be held
// to: a Microsoft-authored one (the ZeroTrustAssessment PowerShell module for a
// Settings Catalog policy and an Entra group, the Microsoft Intune support
// team's blog for an app), or an address copied from the admin center itself
// for that exact kind of object and confirmed to open (2026-11).
//
// Several routes carry a numeric code for the profile type that is published
// nowhere. Only the codes actually observed are in the table below; a profile
// type that is not in it gets no link rather than a guessed one. So do macOS
// shell scripts, non-Windows compliance policies and legacy endpoint security,
// for which there is no observed address at all.
//
// A route Microsoft changes is one line to fix, and a wrong one opens the
// portal's own "not found", in the admin's session -- it cannot change anything.
// ---------------------------------------------------------------------------

const INTUNE_PORTAL = "https://intune.microsoft.com/";
const ENTRA_PORTAL = "https://entra.microsoft.com/";
/** Graph object ids are GUIDs; anything else is not something to put in a URL. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function intuneAppPortalUrl(appId: string): string | undefined {
  if (!GUID.test(appId)) return undefined;
  return `${INTUNE_PORTAL}#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/${appId}`;
}

export function entraGroupPortalUrl(groupId: string): string | undefined {
  if (!GUID.test(groupId)) return undefined;
  return `${ENTRA_PORTAL}#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/~/Overview/groupId/${groupId}`;
}

/**
 * A Settings Catalog policy (`configurationPolicies`), which includes the
 * Endpoint Security policies built on it. The route carries the policy's own
 * `technologies`, template id and `platforms` exactly as Graph returns them,
 * so without all of `technologies` and `platforms` there is no link.
 */
export function settingsCatalogPortalUrl(policy: {
  id: string;
  technologies?: string;
  templateId?: string;
  platforms?: string;
  isAssigned: boolean;
}): string | undefined {
  if (!GUID.test(policy.id) || !policy.technologies || !policy.platforms) return undefined;
  const seg = encodeURIComponent;
  return (
    `${INTUNE_PORTAL}#view/Microsoft_Intune_Workflows/PolicySummaryBlade` +
    `/policyId/${policy.id}` +
    `/isAssigned~/${policy.isAssigned}` +
    `/technology/${seg(policy.technologies)}` +
    `/templateId/${seg(policy.templateId ?? "")}` +
    `/platformName/${seg(policy.platforms)}`
  );
}

const DEVICE_SETTINGS = `${INTUNE_PORTAL}#view/Microsoft_Intune_DeviceSettings`;

/**
 * A display name as a route segment. The portal splits its routes on "/", and
 * how it escapes one inside a name has not been observed, so a name holding
 * one gets no link.
 */
function nameSegment(name: string): string | undefined {
  if (!name || name.includes("/")) return undefined;
  return encodeURIComponent(name);
}

const bareType = (odataType?: string) => (odataType ?? "").replace(/^#microsoft\.graph\./, "");

/** A Windows PowerShell platform script (`deviceManagementScripts`). */
export function windowsScriptPortalUrl(id: string): string | undefined {
  if (!GUID.test(id)) return undefined;
  return `${DEVICE_SETTINGS}/ConfigureWMPolicyMenuBlade/~/overview/policyId/${id}/policyType~/0`;
}

/** The portal's own `policyType` code for a device configuration profile, by Graph type. */
const DEVICE_CONFIGURATION_POLICY_TYPE: Record<string, number> = {
  windows10CustomConfiguration: 74,
  windowsHealthMonitoringConfiguration: 109,
};

/**
 * A device configuration profile (`deviceConfigurations`), for the profile
 * types whose route is known: custom (OMA-URI), health monitoring, and update
 * rings, which have a blade of their own.
 */
export function deviceConfigurationPortalUrl(policy: {
  id: string;
  name: string;
  odataType?: string;
  isAssigned: boolean;
}): string | undefined {
  const name = nameSegment(policy.name);
  if (!GUID.test(policy.id) || !name) return undefined;
  const type = bareType(policy.odataType);

  if (type === "windowsUpdateForBusinessConfiguration") {
    return (
      `${DEVICE_SETTINGS}/SoftwareUpdatesConfigurationSummaryReportBlade` +
      `/id/${policy.id}/softwareUpdatesType/windows/configurationName/${name}` +
      `/policyId/${policy.id}/policyType/Windows10DesktopSoftwareUpdate` +
      `/policyJourneyState/WindowsUpdates/policyName/${name}`
    );
  }

  const policyType = DEVICE_CONFIGURATION_POLICY_TYPE[type];
  if (policyType === undefined) return undefined;
  return (
    `${DEVICE_SETTINGS}/PolicySummaryReportBlade/policyId/${policy.id}/policyName/${name}` +
    `/policyJourneyState~/0/policyType~/${policyType}/isAssigned~/${policy.isAssigned}`
  );
}

/** A Windows feature update profile (`windowsFeatureUpdateProfiles`). */
export function featureUpdatePortalUrl(profile: { id: string; name: string }): string | undefined {
  const name = nameSegment(profile.name);
  if (!GUID.test(profile.id) || !name) return undefined;
  return `${DEVICE_SETTINGS}/WindowsFeatureUpdateProfileMenu/~/0/profileId/${profile.id}/profileName/${name}/hasWufbEnabledLicense~/true`;
}

/** A compliance policy. Windows only: the other platforms' codes are not known. */
export function compliancePortalUrl(policy: { id: string; name: string; odataType?: string }): string | undefined {
  const name = nameSegment(policy.name);
  if (!GUID.test(policy.id) || !name) return undefined;
  if (bareType(policy.odataType) !== "windows10CompliancePolicy") return undefined;
  return (
    `${DEVICE_SETTINGS}/CompliancePolicyOverview.ReactView/policyId/${policy.id}/policyName/${name}` +
    `/platform~/8/policyType~/35/policyJourneyState~/1`
  );
}

/** An administrative template (`groupPolicyConfigurations`). */
export function adminTemplatePortalUrl(policy: { id: string; name: string; isAssigned: boolean }): string | undefined {
  const name = nameSegment(policy.name);
  if (!GUID.test(policy.id) || !name) return undefined;
  return (
    `${DEVICE_SETTINGS}/PolicySummaryReportBlade/policyId/${policy.id}/showReporting~/true` +
    `/policyType~/71/isAssigned~/${policy.isAssigned}/policyJourneyState~/7/policyName/${name}`
  );
}
