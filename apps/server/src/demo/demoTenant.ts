import type { CspSetting, IntuneGroup, IntunePolicy } from "@intune-preflight/shared";
import type { TenantData } from "../intuneData.js";
import { VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "../normalize.js";

// Synthetic sample tenant for demo mode -- no real tenant identifiers, and no
// invented settings. Every Windows/macOS profile NAME and every setting name +
// value below is taken verbatim from the community-standard Open Intune Baseline
// (github.com/SkipToTheEndpoint/OpenIntuneBaseline, Windows v3.8 / macOS v1.0),
// so the demo reads like a real hardened tenant to any Intune admin. Only the
// grouping/assignment layer and two clearly-labelled "CORP" override policies are
// authored, to exercise the tool's features on real settings:
//   * a genuine conflict   (Defender Cloud Block Level: OIB "High" vs a corp
//                            override "Zero tolerance blocking level")
//   * an overlap           (Defender real-time monitoring set the same in two policies)
//   * an exclude-wins case  (Pilot ring carved out of the Production ring)
//   * an include filter     (VPN policy scoped to VPN-Eligible devices)
//   * an exclude filter     (baseline scoped away from Corporate-Owned)
//   * a dynamic group       (kiosk devices by Group Tag)
//   * All Devices + All Users virtual scopes
//   * legacy Endpoint Security intents  (the older template model)
//   * a Policy Waitlist     (unassigned OIB rings/policies)
//   * Autopilot v1 + v2
// The demoTenant test asserts those cases still hold as the engine evolves.

const ALL_DEVICES = VIRTUAL_GROUP_ALL_DEVICES.id;
const ALL_USERS = VIRTUAL_GROUP_ALL_USERS.id;
const s = (settingId: string, cspArea: string, displayName: string, value: string, cspPath?: string): CspSetting => ({
  settingId,
  cspArea,
  displayName,
  value,
  cspPath,
});

const groups: IntuneGroup[] = [
  { id: "grp-corp-win", displayName: "Windows - Corporate Devices" },
  { id: "grp-ring-pilot", displayName: "Windows - Update Ring - Pilot" },
  {
    id: "grp-kiosk",
    displayName: "Windows - Kiosk",
    isDynamic: true,
    membershipRule: '(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:KIOSK"))',
  },
  {
    id: "grp-kiosk-multi",
    displayName: "Windows - Autopilot - Kiosk - Multi User",
    isDynamic: true,
    // Rule starts with "[OrderID]:KIOSK-MULTI", which implies the broader
    // "[OrderID]:KIOSK" kiosk rule -> a dynamic membership implication.
    membershipRule: '(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:KIOSK-MULTI"))',
  },
  {
    id: "grp-autopilot",
    displayName: "Windows - Autopilot Devices",
    isDynamic: true,
    membershipRule: '(device.devicePhysicalIDs -any (_ -startsWith "[ZTDId]"))',
  },
  {
    // Combined rule: the Group Tag clause is evaluable, but the extra
    // deviceOSType condition is not -- so a tag match here is flagged
    // "+ conditions" (verify) rather than claimed outright.
    id: "grp-kiosk-corp",
    displayName: "Windows - Kiosk - Corporate (Win only)",
    isDynamic: true,
    membershipRule:
      '(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:KIOSK")) and (device.deviceOSType -eq "Windows")',
  },
  { id: "grp-ap2-users", displayName: "Users - Autopilot Device Preparation" },
  { id: "grp-mac", displayName: "macOS - Laptops" },
  { id: "grp-ios", displayName: "iOS - Corporate" },
  { id: "grp-android", displayName: "Android - Enterprise" },
];

const policies: IntunePolicy[] = [
  // ============================ WINDOWS -- Open Intune Baseline (All Devices) ============================
  {
    id: "pol-oib-av-config",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus - D - AV Configuration - v3.3",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    // Exclude filter: the baseline applies by default; selecting "Corporate-Owned"
    // in the simulator drops it (exclude wins), so the filter interaction is visible.
    assignmentFilters: [{ groupId: ALL_DEVICES, filterId: "flt-corp-owned", filterType: "exclude" }],
    settings: [
      s("defender.allowrealtimemonitoring", "Defender", "Allow Realtime Monitoring", "Allowed"),
      s("defender.allowcloudprotection", "Defender", "Allow Cloud Protection", "Allowed"),
      s("defender.allowbehaviormonitoring", "Defender", "Allow Behavior Monitoring", "Allowed"),
      s("defender.cloudblocklevel", "Defender", "Cloud Block Level", "High"),
      s("defender.cloudextendedtimeout", "Defender", "Cloud Extended Timeout", "50"),
      s("defender.avgcpuloadfactor", "Defender", "Avg CPU Load Factor", "50"),
      s("defender.allowarchivescanning", "Defender", "Allow Archive Scanning", "Allowed"),
      s("defender.allowfullscanremovable", "Defender", "Allow Full Scan Removable Drive Scanning", "Allowed"),
      s("defender.allowscanningnetworkfiles", "Defender", "Allow Scanning Network Files", "Allowed"),
      s("defender.allowemailscanning", "Defender", "Allow Email Scanning", "Allowed"),
    ],
  },
  {
    id: "pol-oib-av-security-exp",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus - D - Security Experience - v3.3",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.tamperprotection", "Windows Security Experience", "Tamper Protection", "On"),
      s("defender.hidesecuritynotifarea", "Windows Security Experience", "Hide Windows Security Notification Area Control", "Disabled"),
      s("defender.disableenhancednotifications", "Windows Security Experience", "Disable Enhanced Notifications", "Disabled"),
    ],
  },
  {
    id: "pol-oib-av-additional",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Defender Antivirus - D - Additional Configuration - v3.8",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.enablefilehashcomputation", "Defender", "Enable File Hash Computation", "Enabled"),
      s("defender.hideexclusionslocaladmins", "Defender", "Hide Exclusions From Local Admins", "Enabled"),
      s("defender.hideexclusionslocalusers", "Defender", "Hide Exclusions From Local Users", "Enabled"),
      s("defender.convertwarntoblock", "Defender", "Enable Convert Warn To Block", "Enabled"),
    ],
  },
  {
    id: "pol-oib-asr",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Attack Surface Reduction - D - ASR Rules (Audit Mode) - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.asrrules", "Defender", "Attack Surface Reduction Rules", "Configured"),
      s("defender.controlledfolderaccess", "Defender", "Enable Controlled Folder Access", "Audit Mode"),
    ],
  },
  {
    id: "pol-oib-bitlocker",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Encryption - D - BitLocker (OS Disk) - v3.7",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("bitlocker.requiredeviceencryption", "BitLocker", "Require Device Encryption", "Enabled"),
      s("bitlocker.enforceencryptiontype", "Operating System Drives", "Enforce drive encryption type on operating system drives", "Enabled"),
      s("bitlocker.requirestartupauth", "Operating System Drives", "Require additional authentication at startup", "Enabled"),
      s("bitlocker.encryptionmethod", "BitLocker Drive Encryption", "Choose drive encryption method and cipher strength (Windows 10 [Version 1511] and later)", "Enabled"),
      s("bitlocker.recoveryrotation", "BitLocker", "Configure Recovery Password Rotation", "Refresh on for Entra ID-joined devices"),
      s("bitlocker.disallowstdpinchange", "Operating System Drives", "Disallow standard users from changing the PIN or password", "Enabled"),
    ],
  },
  {
    id: "pol-oib-firewall",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Windows Firewall - D - Firewall Configuration - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("firewall.domain", "Firewall", "Enable Domain Network Firewall", "True"),
      s("firewall.private", "Firewall", "Enable Private Network Firewall", "True"),
      s("firewall.public", "Firewall", "Enable Public Network Firewall", "True"),
      s("firewall.statefulftp", "Firewall", "Disable Stateful Ftp", "True"),
      s("firewall.auditfpconn", "Auditing", "Object Access Audit Filtering Platform Connection", "Failure"),
    ],
  },
  {
    id: "pol-oib-whfb",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Windows Hello for Business - D - WHfB Configuration - v3.2",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("whfb.antispoofing", "Windows Hello For Business", "Facial Features Use Enhanced Anti Spoofing", "Enabled"),
      s("whfb.devicescoped", "Windows Hello For Business", "Device-scoped settings", "Not configured"),
    ],
  },
  {
    id: "pol-oib-hardening",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Device Security - D - Security Hardening - v3.7",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("hardening.smb1client", "MS Security Guide", "Configure SMB v1 client driver", "Enabled"),
      s("hardening.smb1server", "MS Security Guide", "Configure SMB v1 server", "Disabled"),
      s("hardening.pssblocklogging", "Windows PowerShell", "Turn on PowerShell Script Block Logging", "Enabled"),
      s("hardening.winrmclientbasicauth", "WinRM Client", "Allow Basic authentication", "Disabled"),
      s("hardening.winrmservicebasicauth", "WinRM Service", "Allow Basic authentication", "Disabled"),
      s("hardening.turnoffautoplay", "AutoPlay Policies", "Turn off Autoplay", "Enabled"),
      s("hardening.smartscreenexplorer", "File Explorer", "Configure Windows Defender SmartScreen", "Enabled"),
      s("hardening.ie11standalone", "Internet Explorer", "Disable Internet Explorer 11 as a standalone browser", "Enabled"),
      s("hardening.encryptionoracle", "Credentials Delegation", "Encryption Oracle Remediation", "Enabled"),
      s("hardening.homegroup", "HomeGroup", "Prevent the computer from joining a homegroup", "Enabled"),
      s("hardening.phonepclinking", "Connectivity", "Allow Phone PC Linking", "Block"),
      s("hardening.solicitedra", "Remote Assistance", "Configure Solicited Remote Assistance", "Disabled"),
    ],
  },
  {
    id: "pol-oib-edge-security",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Microsoft Edge - D - Security - v3.8",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("edge.downloadrestrictions", "Microsoft Edge", "Allow download restrictions", "Enabled"),
      s("edge.importsavedpasswords", "Microsoft Edge", "Allow importing of saved passwords", "Disabled"),
      s("edge.importpaymentinfo", "Microsoft Edge", "Allow importing of payment info", "Disabled"),
      s("edge.intrusiveads", "Microsoft Edge", "Ads setting for sites with intrusive ads", "Enabled"),
      s("edge.personalizationads", "Microsoft Edge", "Allow personalization of ads, search and news by sending browsing history to Microsoft", "Disabled"),
      s("edge.iemodereload", "Microsoft Edge", "Allow unconfigured sites to be reloaded in Internet Explorer mode", "Disabled"),
    ],
  },
  {
    id: "pol-oib-office-security",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Microsoft Office - D - Security - v3.6",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("office.blockflash", "MS Security Guide", "Block Flash activation in Office documents", "Enabled"),
      s("office.legacyjscript", "MS Security Guide", "Restrict legacy JScript execution for Office", "Enabled"),
      s("office.addonmanagement", "IE Security", "Add-on Management", "Enabled"),
      s("office.consistentmime", "IE Security", "Consistent Mime Handling", "Enabled"),
      s("office.lmzlockdown", "IE Security", "Local Machine Zone Lockdown Security", "Enabled"),
    ],
  },
  {
    id: "pol-oib-timezone",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Device Security - D - Timezone - v3.4",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("timezone.configurentpclient", "Time Providers", "Configure Windows NTP Client", "Enabled"),
      s("timezone.enablentpclient", "Time Providers", "Enable Windows NTP Client", "Enabled"),
    ],
  },
  {
    id: "pol-oib-loginlock",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Device Security - D - Login and Lock Screen - v3.8",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("login.cortanaabovelock", "Above Lock", "Allow Cortana Above Lock", "Block"),
      s("login.lockscreencamera", "Personalization", "Prevent enabling lock screen camera", "Enabled"),
      s("login.lockscreenslideshow", "Personalization", "Prevent enabling lock screen slide show", "Enabled"),
      s("login.locknotifications", "Logon", "Turn off app notifications on the lock screen", "Enabled"),
    ],
  },
  {
    id: "pol-oib-delivery-opt",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Windows Update for Business - D - Delivery Optimisation - v3.0",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("do.downloadmode", "Delivery Optimization", "DO Download Mode", "HTTP blended with peering behind the same NAT"),
      s("do.restrictpeerselection", "Delivery Optimization", "DO Restrict Peer Selection By", "Local discovery (DNS-SD)"),
      s("do.minbattery", "Delivery Optimization", "DO Min Battery Percentage Allowed To Upload", "40"),
      s("do.groupidsource", "Delivery Optimization", "DO Group Id Source", "Entra ID Tenant ID"),
      s("do.maxcachesize", "Delivery Optimization", "DO Max Cache Size", "20"),
    ],
  },

  // ---- Defender AV update rings: Production to All Devices (minus Pilot), Pilot to the pilot ring ----
  {
    id: "pol-oib-defender-ring3",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus Updates - Ring 3 - Production - v3.4",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    // Pilot devices are carved out of Production -> exclude-wins demo.
    excludedGroupIds: ["grp-ring-pilot"],
    assignmentFilters: [],
    settings: [
      s("defenderupd.enginechannel", "Defender Update controls", "Engine Updates Channel", "Current Channel (Broad)"),
      s("defenderupd.platformchannel", "Defender Update controls", "Platform Updates Channel", "Current Channel (Broad)"),
      s("defenderupd.sigchannel", "Defender Update controls", "Security Intelligence Updates Channel", "Current"),
    ],
  },
  {
    id: "pol-oib-defender-ring1",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus Updates - Ring 1 - Pilot - v3.4",
    platform: "windows",
    assignedGroupIds: ["grp-ring-pilot"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defenderupd.enginechannel", "Defender Update controls", "Engine Updates Channel", "Current Channel (Preview)"),
      s("defenderupd.platformchannel", "Defender Update controls", "Platform Updates Channel", "Current Channel (Preview)"),
      s("defenderupd.sigchannel", "Defender Update controls", "Security Intelligence Updates Channel", "Not configured"),
    ],
  },

  // ---- Compliance (OIB assigns these to users -> All Users virtual scope) ----
  {
    id: "pol-oib-compliance-devhealth",
    kind: "compliancePolicy",
    displayName: "Win - OIB - Compliance - U - Device Health - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_USERS],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("compliance.bitlocker", "Compliance", "Require BitLocker", "Require"),
      s("compliance.secureboot", "Compliance", "Require Secure Boot to be enabled on the device", "Require"),
      s("compliance.codeintegrity", "Compliance", "Require code integrity", "Require"),
    ],
  },
  {
    id: "pol-oib-compliance-devsec",
    kind: "compliancePolicy",
    displayName: "Win - OIB - Compliance - U - Device Security - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_USERS],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("compliance.firewall", "Compliance", "Firewall", "Require"),
      s("compliance.antivirus", "Compliance", "Antivirus", "Require"),
      s("compliance.antispyware", "Compliance", "Antispyware", "Require"),
      s("compliance.rtp", "Compliance", "Microsoft Defender Antimalware real-time protection", "Require"),
    ],
  },

  // ---- Legacy Endpoint Security (deviceManagement/intents template model) ----
  // Still present in many tenants; namespaced `endpointSecurity:` like the real
  // normalizer, and shown as "(Legacy)" in the UI.
  {
    id: "pol-es-bitlocker-legacy",
    kind: "endpointSecurity",
    displayName: "Windows - BitLocker (Legacy Disk Encryption Intent)",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("endpointSecurity:bitlocker_requireEncryption", "BitLocker", "Require Device Encryption", "Enabled"),
      s("endpointSecurity:bitlocker_encryptionMethod", "BitLocker", "Encryption Method For Operating System Drives", "XTS-AES 256-bit"),
    ],
  },
  {
    id: "pol-es-defender-av-legacy",
    kind: "endpointSecurity",
    displayName: "Windows - Microsoft Defender Antivirus (Legacy Intent)",
    platform: "windows",
    assignedGroupIds: ["grp-corp-win"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("endpointSecurity:defenderav_allowRealtimeMonitoring", "Microsoft Defender Antivirus", "Allow Realtime Monitoring", "Enabled"),
      s("endpointSecurity:defenderav_cloudBlockLevel", "Microsoft Defender Antivirus", "Cloud Block Level", "High"),
    ],
  },

  // ---- Authored CORP layer on top of OIB (real settings, alternative real values) ----
  {
    id: "pol-corp-defender-override",
    kind: "settingsCatalog",
    displayName: "CORP - Defender - Cloud Protection Tuning",
    platform: "windows",
    description: "Corporate override layered on the OIB baseline for managed corporate devices.",
    assignedGroupIds: ["grp-corp-win"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // CONFLICT with OIB AV Configuration (High vs Zero tolerance) on the same setting.
      s("defender.cloudblocklevel", "Defender", "Cloud Block Level", "Zero tolerance blocking level"),
      // OVERLAP with OIB AV Configuration (same value, same setting).
      s("defender.allowrealtimemonitoring", "Defender", "Allow Realtime Monitoring", "Allowed"),
    ],
  },
  {
    id: "pol-corp-vpn",
    kind: "settingsCatalog",
    displayName: "CORP - Always On VPN",
    platform: "windows",
    description: "Device Tunnel VPN, scoped to VPN-eligible devices by an include filter.",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    // Include filter: applies ONLY to devices that match "VPN-Eligible Devices".
    // A default device does NOT get it until the filter is selected in the simulator.
    assignmentFilters: [{ groupId: ALL_DEVICES, filterId: "flt-vpn-eligible", filterType: "include" }],
    settings: [
      s("vpn.alwayson", "VPN", "Always On", "Enabled"),
      s("vpn.devicetunnel", "VPN", "Device Tunnel", "Enabled"),
    ],
  },
  {
    id: "pol-corp-kiosk",
    kind: "deviceConfiguration",
    displayName: "CORP - Kiosk Lockdown (Single App)",
    platform: "windows",
    assignedGroupIds: ["grp-kiosk"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("kiosk.mode", "Kiosk", "Kiosk mode", "Single app, full-screen"),
      s("kiosk.autologon", "Kiosk", "User logon type", "Auto logon"),
    ],
  },
  {
    id: "pol-corp-kiosk-branding",
    kind: "settingsCatalog",
    displayName: "CORP - Kiosk Branding",
    platform: "windows",
    assignedGroupIds: ["grp-kiosk-corp"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("kiosk.branding.logo", "Kiosk", "Custom lock-screen logo", "Enabled")],
  },
  {
    id: "pol-corp-sharedpc",
    kind: "settingsCatalog",
    displayName: "CORP - Shared PC Mode",
    platform: "windows",
    assignedGroupIds: ["grp-kiosk-multi"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("sharedpc.enablesharedpcmode", "Shared PC", "Enable Shared PC Mode", "True"),
      s("sharedpc.accountmanagement", "Shared PC", "Enable Account Management", "True"),
    ],
  },
  {
    // A legacy device-configuration TEMPLATE (Microsoft recommends migrating these
    // to the Settings Catalog) -> shows the "Legacy template" flag. Its settings
    // key on the windows10GeneralConfiguration schema, which deliberately does NOT
    // cross-match the equivalent Settings Catalog CSPs -- the cross-model gap.
    id: "pol-win-device-restrictions-template",
    kind: "deviceConfiguration",
    displayName: "Windows - Device Restrictions (Template)",
    platform: "windows",
    legacyTemplate: true,
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // Carries a canonical cspNode -> cross-detects against the Settings Catalog
      // "Allow Microsoft Account Connection" below (the classic migration overlap).
      {
        settingId: "windows10GeneralConfiguration:microsoftAccountBlocked",
        cspArea: "Windows10 General Configuration",
        displayName: "Microsoft Account Blocked",
        value: "true",
        cspNode: "accounts/allowmicrosoftaccountconnection",
        cspNodeValue: "Block",
      },
      s("windows10GeneralConfiguration:settingsBlockGamingPage", "Windows10 General Configuration", "Settings Block Gaming Page", "true"),
      s("windows10GeneralConfiguration:windowsSpotlightBlocked", "Windows10 General Configuration", "Windows Spotlight Blocked", "true"),
    ],
  },
  {
    // Modern Settings Catalog equivalent of the template's "Microsoft Account
    // Blocked" -> same CSP, different model -> a cross-model overlap the per-model
    // detection can't see. Mirrors the real migration-era duplication.
    id: "pol-oib-accounts",
    kind: "settingsCatalog",
    displayName: "Win - OIB - SC - Microsoft Accounts - D - Configuration - v3.2",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      {
        settingId: "device_vendor_msft_policy_config_accounts_allowmicrosoftaccountconnection",
        cspArea: "Accounts",
        displayName: "Allow Microsoft Account Connection",
        value: "Block",
        cspPath: "./Device/Vendor/MSFT/Policy/Config/Accounts/AllowMicrosoftAccountConnection",
        cspNode: "accounts/allowmicrosoftaccountconnection",
      },
    ],
  },

  // ---- Unassigned OIB policies -> Policy Waitlist ("what if I assigned this?") ----
  {
    id: "pol-oib-asr-l2-draft",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Attack Surface Reduction - D - ASR Rules (L2) - v3.7",
    platform: "windows",
    assignedGroupIds: [],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.asrrules.l2", "Defender", "Attack Surface Reduction Rules", "Configured"),
      s("defender.controlledfolderaccess.l2", "Defender", "Enable Controlled Folder Access", "Block"),
    ],
  },
  {
    id: "pol-oib-defender-ring2-draft",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus Updates - Ring 2 - UAT - v3.4",
    platform: "windows",
    assignedGroupIds: [],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defenderupd.enginechannel", "Defender Update controls", "Engine Updates Channel", "Current Channel (Staged)"),
      s("defenderupd.platformchannel", "Defender Update controls", "Platform Updates Channel", "Current Channel (Staged)"),
      s("defenderupd.sigchannel", "Defender Update controls", "Security Intelligence Updates Channel", "Current"),
    ],
  },

  // ============================ macOS -- Open Intune Baseline (macOS v1.0) ============================
  {
    id: "pol-mac-oib-filevault",
    kind: "settingsCatalog",
    displayName: "MacOS - OIB - Disk Encryption - D - FileVault - v1.0",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.filevault.enable", "FileVault", "Enable FileVault", "Enabled"),
      s("mac.filevault.escrow", "FileVault", "Escrow recovery key to MDM", "Enabled"),
      s("mac.filevault.deferforcelogout", "FileVault", "Defer enablement until logout", "Enabled"),
    ],
  },
  {
    id: "pol-mac-oib-gatekeeper",
    kind: "settingsCatalog",
    displayName: "MacOS - OIB - Firewall - D - Gatekeeper - v1.0",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.firewall.enable", "Firewall", "Enable Firewall", "Enabled"),
      s("mac.firewall.stealth", "Firewall", "Enable stealth mode", "Enabled"),
      s("mac.gatekeeper.allowedsources", "Gatekeeper", "Allowed app sources", "Mac App Store and identified developers"),
    ],
  },
  {
    id: "pol-mac-oib-updates",
    kind: "settingsCatalog",
    displayName: "MacOS - OIB - Updates - D - Update Configuration - v1.0",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.update.autoinstallos", "Software Update", "Automatically install macOS updates", "Enabled"),
      s("mac.update.autoinstallapp", "Software Update", "Automatically install app updates", "Enabled"),
      s("mac.update.securityresponses", "Software Update", "Install security responses and system files", "Enabled"),
    ],
  },
  {
    id: "pol-mac-oib-compliance",
    kind: "compliancePolicy",
    displayName: "MacOS - OIB - Compliance - Device Security - v1.0",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.compliance.filevault", "Compliance", "Require FileVault", "Require"),
      s("mac.compliance.firewall", "Compliance", "Require the firewall", "Require"),
      s("mac.compliance.sip", "Compliance", "Require System Integrity Protection", "Require"),
    ],
  },

  // ============================ iOS / Android (real Intune settings) ============================
  {
    id: "pol-ios-restrictions",
    kind: "deviceConfiguration",
    displayName: "iOS - Device Restrictions",
    platform: "ios",
    assignedGroupIds: ["grp-ios"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("ios.blockappstore", "Restrictions", "Block App Store", "Blocked"),
      s("ios.blockuntrustedtls", "Restrictions", "Block untrusted TLS certificates", "Blocked"),
    ],
  },
  {
    id: "pol-ios-compliance",
    kind: "compliancePolicy",
    displayName: "iOS - Compliance Policy",
    platform: "ios",
    assignedGroupIds: ["grp-ios"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("ios.compliance.passcode", "Compliance", "Require a password to unlock mobile devices", "Require"),
      s("ios.compliance.jailbroken", "Compliance", "Jailbroken devices", "Block"),
      s("ios.compliance.passcodetype", "Compliance", "Required password type", "Alphanumeric"),
    ],
  },
  {
    id: "pol-android-compliance",
    kind: "compliancePolicy",
    displayName: "Android - Compliance Policy",
    platform: "android",
    assignedGroupIds: ["grp-android"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("android.compliance.playprotect", "Compliance", "Require the device to be at or under the Device Threat Level", "Require"),
      s("android.compliance.rooted", "Compliance", "Rooted devices", "Block"),
      s("android.compliance.encryption", "Compliance", "Require encryption of data storage on device", "Require"),
    ],
  },
  {
    id: "pol-android-restrictions",
    kind: "deviceConfiguration",
    displayName: "Android - Work Profile Restrictions",
    platform: "android",
    assignedGroupIds: ["grp-android"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("android.restrict.screencapture", "Work Profile", "Screen capture", "Block"),
      s("android.restrict.crossprofilecopy", "Work Profile", "Copy and paste between work and personal profiles", "Block"),
    ],
  },
];

const demoData: TenantData = {
  policies,
  groups,
  autopilotProfiles: [
    {
      id: "ap-win11",
      displayName: "Autopilot - Windows 11",
      osLabel: "Windows 11 23H2",
      generation: "v1",
      assignedGroupIds: ["grp-autopilot"],
      // Kiosks are carved out of the standard deployment profile -- selecting the
      // kiosk group alongside Autopilot demos exclusion evaluation on the card.
      excludedGroupIds: ["grp-kiosk"],
      settings: [
        { label: "Join type", value: "Microsoft Entra joined" },
        { label: "Deployment mode", value: "singleUser" },
        { label: "User account type", value: "standard" },
        { label: "Device name template", value: "CORP-%SERIAL%" },
        { label: "Pre-provisioning allowed", value: "Yes" },
        { label: "Convert targeted devices to Autopilot", value: "Yes" },
      ],
    },
    {
      id: "ap-v2-dpp",
      displayName: "Autopilot Device Preparation - Corporate",
      osLabel: "Windows 11",
      generation: "v2",
      assignedGroupIds: ["grp-ap2-users"],
      excludedGroupIds: [],
      // Device-focused targeting: the configured (just-in-time) Autopilot device
      // group. Selecting it shows v1 AND v2 -- the dual-enrollment scenario.
      deviceGroupId: "grp-autopilot",
      settings: [
        { label: "Deployment mode", value: "Standard mode" },
        { label: "Deployment type", value: "User-driven" },
        { label: "Join type", value: "Microsoft Entra joined" },
        { label: "Account type", value: "Standard User" },
        { label: "Just-in-time device group", value: "Windows - Autopilot Devices", groupId: "grp-autopilot" },
        { label: "Installation timeout (minutes)", value: "60" },
      ],
    },
  ],
  assignmentFilters: [
    { id: "flt-corp-owned", displayName: "Corporate-Owned", platform: "windows", rule: '(device.deviceOwnership -eq "Company")' },
    { id: "flt-vpn-eligible", displayName: "VPN-Eligible Devices", platform: "windows", rule: '(device.deviceCategory -eq "VPN")' },
  ],
};

/** The bundled sample tenant served in demo mode. */
export function demoTenantData(): TenantData {
  return demoData;
}
