import type { CspSetting, IntuneGroup, IntunePolicy } from "@intune-preflight/shared";
import type { TenantData } from "../intuneData.js";
import { VIRTUAL_GROUP_ALL_DEVICES } from "../normalize.js";

// Synthetic sample tenant for demo mode -- no real tenant identifiers. Crafted
// to exercise every feature the tool surfaces: a conflict, an overlap, an
// exclude-wins case, dynamic group-tag implication, an unassigned policy (for
// Policy Waitlist), an assignment filter, and Autopilot, across four OSes.
// Keep it in sync with the demo test in intuneData/demo — that test asserts the
// data still produces those interesting cases as the engine evolves.
//
// The Windows set mirrors the naming and structure of the Open Intune Baseline
// (openintunebaseline.com), a community-standard set of Intune profiles, so the
// demo reads like a real hardened tenant to any Intune admin. It is recognizable
// sample data only -- no configuration is copied verbatim.

const ALL_DEVICES = VIRTUAL_GROUP_ALL_DEVICES.id;
const s = (settingId: string, cspArea: string, displayName: string, value: string, cspPath?: string): CspSetting => ({
  settingId,
  cspArea,
  displayName,
  value,
  cspPath,
});

const groups: IntuneGroup[] = [
  { id: "grp-corp-win", displayName: "Windows - Corporate Devices" },
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
    membershipRule: '(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:KIOSK-MULTI"))',
  },
  {
    id: "grp-autopilot",
    displayName: "Windows - Autopilot Devices",
    isDynamic: true,
    membershipRule: '(device.devicePhysicalIDs -any (_ -startsWith "[ZTDId]"))',
  },
  { id: "grp-ap2-users", displayName: "Users - Autopilot Device Preparation" },
  { id: "grp-mac", displayName: "macOS - Laptops" },
  { id: "grp-ios", displayName: "iOS - Corporate" },
  { id: "grp-android", displayName: "Android - Enterprise" },
];

const policies: IntunePolicy[] = [
  {
    id: "pol-win-vpn",
    kind: "settingsCatalog",
    displayName: "Windows - Always-On VPN",
    platform: "windows",
    // All Devices, but scoped by an INCLUDE filter: it only applies to devices
    // that MATCH "VPN-Eligible Devices". So by default (a device that doesn't
    // match) it is NOT applied -- the inverse of the exclude case below, and the
    // one that's easy to misread. Selecting the filter in the simulator makes it
    // apply.
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [{ groupId: ALL_DEVICES, filterId: "flt-vpn-eligible", filterType: "include" }],
    settings: [s("vpn.alwayson", "VPN", "Always On VPN", "Enabled")],
  },
  {
    id: "pol-win-baseline",
    kind: "settingsCatalog",
    displayName: "Windows - Security Baseline",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    // An exclude-type Corporate-Owned filter, to demo assignment filters: the
    // baseline applies by default, and selecting the filter in the simulator
    // drops it (exclude wins), so the interaction is visible without hiding the
    // baseline from the out-of-the-box view.
    assignmentFilters: [{ groupId: ALL_DEVICES, filterId: "flt-corp-owned", filterType: "exclude" }],
    settings: [
      s("bitlocker.require", "BitLocker", "Require device encryption", "Enabled", "./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption"),
      s("defender.realtime", "Defender", "Real-time protection", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring"),
      s("password.minlength", "Password", "Minimum password length", "8", "./Device/Vendor/MSFT/Policy/Config/DeviceLock/MinDevicePasswordLength"),
    ],
  },
  {
    id: "pol-win-corp",
    kind: "deviceConfiguration",
    displayName: "Windows - Device Restrictions",
    platform: "windows",
    assignedGroupIds: ["grp-corp-win"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // Conflicts with the baseline's "8" -> a real conflict on a corp device.
      s("password.minlength", "Password", "Minimum password length", "12"),
      s("firewall.enable", "Firewall", "Enable Windows Firewall", "Enabled"),
    ],
  },
  {
    id: "pol-win-compliance",
    kind: "compliancePolicy",
    displayName: "Windows - Compliance Policy",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // Same value as the baseline -> a (redundant) overlap, not a conflict.
      s("defender.realtime", "Defender", "Real-time protection", "Enabled"),
      s("compliance.minosversion", "Compliance", "Minimum OS version", "10.0.22631"),
    ],
  },
  {
    id: "pol-win-kiosk",
    kind: "deviceConfiguration",
    displayName: "Windows - Kiosk Lockdown",
    platform: "windows",
    assignedGroupIds: ["grp-kiosk"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("kiosk.mode", "Kiosk", "Kiosk mode", "Single-app"),
      s("password.minlength", "Password", "Minimum password length", "8"),
    ],
  },
  {
    id: "pol-win-feature-update",
    kind: "deviceConfiguration",
    displayName: "Windows - Feature Update Deferral",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    // Kiosk devices are carved out -> exclude-wins demo.
    excludedGroupIds: ["grp-kiosk"],
    assignmentFilters: [],
    settings: [s("update.deferfeature", "Windows Update", "Feature update deferral (days)", "30")],
  },
  // Legacy Endpoint Security (deviceManagement/intents model) -- BitLocker /
  // Disk Encryption and Defender Antivirus created the old template-based way,
  // still present in many tenants. Settings are namespaced `endpointSecurity:`
  // like the real normalizer, so an org-wide BitLocker intent and a corp
  // override are detected as a genuine conflict (encryption method) plus an
  // overlap (require encryption) -- Windows-only, like every other comparison.
  {
    id: "pol-es-bitlocker",
    kind: "endpointSecurity",
    displayName: "Windows - BitLocker (Endpoint Security)",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("endpointSecurity:bitlocker_requireEncryption", "BitLocker", "Require Device Encryption", "Enabled"),
      s("endpointSecurity:bitlocker_encryptionMethod", "BitLocker", "Encryption Method For Operating System Drives", "XTS-AES 128-bit"),
    ],
  },
  {
    id: "pol-es-bitlocker-corp",
    kind: "endpointSecurity",
    displayName: "Windows - BitLocker Corp Override (Endpoint Security)",
    platform: "windows",
    assignedGroupIds: ["grp-corp-win"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // Same value as the org-wide intent -> overlap; stronger cipher -> conflict.
      s("endpointSecurity:bitlocker_requireEncryption", "BitLocker", "Require Device Encryption", "Enabled"),
      s("endpointSecurity:bitlocker_encryptionMethod", "BitLocker", "Encryption Method For Operating System Drives", "XTS-AES 256-bit"),
    ],
  },
  {
    id: "pol-es-defender-av",
    kind: "endpointSecurity",
    displayName: "Windows - Microsoft Defender Antivirus (Endpoint Security)",
    platform: "windows",
    assignedGroupIds: ["grp-corp-win"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("endpointSecurity:defenderav_allowRealtimeMonitoring", "Microsoft Defender Antivirus", "Allow Realtime Monitoring", "Enabled"),
      s("endpointSecurity:defenderav_cloudBlockLevel", "Microsoft Defender Antivirus", "Cloud Block Level", "High"),
      s("endpointSecurity:defenderav_puaProtection", "Microsoft Defender Antivirus", "PUA Protection", "Block"),
    ],
  },
  {
    id: "pol-es-firewall-draft",
    kind: "endpointSecurity",
    displayName: "Windows - Firewall (Endpoint Security) (DRAFT)",
    platform: "windows",
    // No assignment -> shows up in the Policy Waitlist as a legacy ES intent.
    assignedGroupIds: [],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("endpointSecurity:firewall_enableDomainNetworkFirewall", "Microsoft Defender Firewall", "Enable Domain Network Firewall", "Enabled"),
    ],
  },
  {
    id: "pol-win-sharedpc",
    kind: "settingsCatalog",
    displayName: "Windows - Shared PC Mode",
    platform: "windows",
    assignedGroupIds: ["grp-kiosk-multi"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("sharedpc.enabled", "Shared PC", "Enable shared PC mode", "True")],
  },
  {
    id: "pol-win-edge-draft",
    kind: "settingsCatalog",
    displayName: "Windows - Edge Hardening (DRAFT)",
    platform: "windows",
    // No assignment -> shows up in the Policy Waitlist as unassigned.
    assignedGroupIds: [],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("edge.smartscreen", "Edge", "SmartScreen", "Enabled"),
      s("edge.passwordmanager", "Edge", "Built-in password manager", "Disabled"),
    ],
  },

  // ---- Open Intune Baseline (OIB) style Windows set (applied to All Devices) ----
  // A realistic hardened baseline. Note the Defender "Submit samples consent"
  // CONFLICT between AV Configuration and the Security Baseline below, and the
  // several Defender/BitLocker OVERLAPS with the existing policies above.
  {
    id: "pol-oib-av-config",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus - D - AV Configuration - v3.3",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.realtime", "Defender", "Real-time protection", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring"),
      s("defender.cloudprotection", "Defender", "Cloud-delivered protection", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/AllowCloudProtection"),
      s("defender.submitsamplesconsent", "Defender", "Submit samples consent", "Send safe samples automatically", "./Device/Vendor/MSFT/Policy/Config/Defender/SubmitSamplesConsent"),
      s("defender.pua", "Defender", "Detect potentially unwanted apps", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/PUAProtection"),
      s("defender.cloudblocklevel", "Defender", "Cloud block level", "High", "./Device/Vendor/MSFT/Policy/Config/Defender/CloudBlockLevel"),
      s("defender.cloudchecktimeout", "Defender", "Cloud extended timeout (s)", "50", "./Device/Vendor/MSFT/Policy/Config/Defender/CloudExtendedTimeout"),
      s("defender.scanarchives", "Defender", "Scan archive files", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/AllowArchiveScanning"),
      s("defender.networkprotection", "Defender", "Network protection", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/EnableNetworkProtection"),
      s("defender.scanremovable", "Defender", "Scan removable drives", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/AllowFullScanRemovableDriveScanning"),
      s("defender.signatureupdatehours", "Defender", "Signature update interval (hours)", "4", "./Device/Vendor/MSFT/Policy/Config/Defender/SignatureUpdateInterval"),
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
      s("defender.tamperprotection", "Security Experience", "Tamper protection", "Enabled"),
      s("defender.notifications", "Security Experience", "Hide non-critical notifications", "Enabled"),
      s("defender.headlessuimode", "Security Experience", "Hide Windows Security UI", "Disabled"),
      s("defender.ransomwaredatafolder", "Security Experience", "Controlled folder access", "Audit Mode"),
    ],
  },
  {
    id: "pol-oib-asr",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Attack Surface Reduction - D - ASR Rules - v3.7",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("asr.blockexecutablecontent", "ASR", "Block executable content from email/webmail", "Block"),
      s("asr.blockofficecreateprocess", "ASR", "Block Office apps creating child processes", "Block"),
      s("asr.blockofficecreateexe", "ASR", "Block Office apps creating executable content", "Block"),
      s("asr.blockcredentialstealing", "ASR", "Block credential stealing from LSASS", "Block"),
      s("asr.blockuntrustedusb", "ASR", "Block untrusted/unsigned USB processes", "Block"),
      s("asr.blockadobechild", "ASR", "Block Adobe Reader child processes", "Block"),
      s("asr.blockscriptdownloaded", "ASR", "Block JS/VBS launching downloaded content", "Block"),
      s("asr.blockpersistencewmi", "ASR", "Block persistence via WMI event subscription", "Audit Mode"),
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
      s("bitlocker.require", "BitLocker", "Require device encryption", "Enabled", "./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption"),
      s("bitlocker.osencryptiontype", "BitLocker", "OS drive encryption type", "Full encryption", "./Device/Vendor/MSFT/BitLocker/SystemDrivesEncryptionType"),
      s("bitlocker.startupauth", "BitLocker", "Startup authentication", "TPM required", "./Device/Vendor/MSFT/BitLocker/SystemDrivesRequireStartupAuthentication"),
      s("bitlocker.minpinlength", "BitLocker", "Minimum PIN length", "6", "./Device/Vendor/MSFT/BitLocker/SystemDrivesMinimumPINLength"),
      s("bitlocker.encryptionmethod", "BitLocker", "Encryption method", "XTS-AES 256-bit", "./Device/Vendor/MSFT/BitLocker/EncryptionMethodByDriveType"),
      s("bitlocker.recoverystore", "BitLocker", "Save recovery info to Entra", "Required", "./Device/Vendor/MSFT/BitLocker/SystemDrivesRecoveryOptions"),
    ],
  },
  {
    id: "pol-oib-security-baseline",
    kind: "settingsCatalog",
    displayName: "Win - OIB - Device - D - Security Baseline - 24H2",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // Conflicts with pol-oib-av-config: "Send all samples" vs "Send safe samples".
      s("defender.submitsamplesconsent", "Defender", "Submit samples consent", "Send all samples automatically", "./Device/Vendor/MSFT/Policy/Config/Defender/SubmitSamplesConsent"),
      s("defender.realtime", "Defender", "Real-time protection", "Enabled", "./Device/Vendor/MSFT/Policy/Config/Defender/AllowRealtimeMonitoring"),
      s("password.minlength", "Password", "Minimum password length", "8", "./Device/Vendor/MSFT/Policy/Config/DeviceLock/MinDevicePasswordLength"),
      s("smartscreen.enabled", "SmartScreen", "SmartScreen for Explorer", "Enabled", "./Device/Vendor/MSFT/Policy/Config/SmartScreen/EnableSmartScreenInShell"),
      s("smartscreen.blockoverride", "SmartScreen", "Block user override", "Enabled", "./Device/Vendor/MSFT/Policy/Config/SmartScreen/PreventOverride"),
      s("uac.adminapproval", "User Account Control", "Admin approval mode", "Enabled", "./Device/Vendor/MSFT/Policy/Config/LocalPoliciesSecurityOptions/UserAccountControl_RunAllAdministratorsInAdminApprovalMode"),
      s("uac.elevationprompt", "User Account Control", "Elevation prompt for admins", "Prompt for consent on secure desktop"),
      s("lsa.runasppl", "Local Security Authority", "LSA protection (RunAsPPL)", "Enabled with UEFI lock"),
      s("credentialguard.enable", "Credential Guard", "Virtualization-based Credential Guard", "Enabled with UEFI lock"),
      s("firewall.domainprofile", "Firewall", "Domain profile enabled", "Enabled"),
      s("firewall.privateprofile", "Firewall", "Private profile enabled", "Enabled"),
      s("firewall.publicprofile", "Firewall", "Public profile enabled", "Enabled"),
      s("rdp.nla", "Remote Desktop", "Require Network Level Authentication", "Enabled"),
      s("powershell.scriptblocklogging", "PowerShell", "Script block logging", "Enabled"),
      s("autorun.disable", "AutoPlay", "Disable AutoRun for all drives", "Enabled"),
      s("netbios.disable", "Network", "Disable NetBIOS over TCP/IP", "Enabled"),
      s("legacyprotocols.smb1", "Network", "SMBv1 client", "Disabled"),
      s("wdigest.disable", "Credentials", "WDigest credential caching", "Disabled"),
      s("password.history", "Password", "Enforce password history", "24"),
      s("account.lockoutthreshold", "Account", "Account lockout threshold", "10"),
      s("smb.signing", "Network", "SMB client signing", "Required"),
      s("ldap.clientsigning", "Network", "LDAP client signing", "Negotiate signing"),
      s("kerberos.encryptiontypes", "Credentials", "Kerberos supported encryption", "AES128 + AES256"),
      s("audit.logon", "Audit", "Audit logon events", "Success and Failure"),
      s("audit.processcreation", "Audit", "Audit process creation", "Success"),
      s("attachmentmanager.antivirus", "Attachment Manager", "Notify antivirus on open", "Enabled"),
      s("dma.blocknewdevices", "Device Guard", "Block DMA until sign-in", "Enabled"),
      s("installer.elevatedalways", "Windows Installer", "Always install elevated", "Disabled"),
      s("rpc.restrictremoteclients", "Remote Procedure Call", "Restrict unauthenticated RPC clients", "Authenticated"),
      s("wifi.autoconnecthotspots", "Network", "Auto-connect to open hotspots", "Disabled"),
      s("cloud.consumeraccounts", "Accounts", "Block Microsoft consumer accounts", "Enabled"),
      s("edge.baseline.smartscreen", "Microsoft Edge", "SmartScreen enabled", "Enabled"),
      s("edge.baseline.typosquatting", "Microsoft Edge", "Typosquatting checker", "Enabled"),
      s("winrm.basicauth", "Remote Management", "WinRM Basic authentication", "Disabled"),
    ],
  },
  {
    id: "pol-oib-firewall",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Firewall - D - Configuration - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("fw.domain.enabled", "Firewall", "Domain profile — firewall enabled", "Enabled"),
      s("fw.domain.inbound", "Firewall", "Domain profile — default inbound action", "Block"),
      s("fw.domain.outbound", "Firewall", "Domain profile — default outbound action", "Allow"),
      s("fw.private.enabled", "Firewall", "Private profile — firewall enabled", "Enabled"),
      s("fw.private.inbound", "Firewall", "Private profile — default inbound action", "Block"),
      s("fw.public.enabled", "Firewall", "Public profile — firewall enabled", "Enabled"),
      s("fw.public.inbound", "Firewall", "Public profile — default inbound action", "Block"),
      s("fw.public.notifications", "Firewall", "Public profile — display notifications", "Disabled"),
      s("fw.public.localrules", "Firewall", "Public profile — allow local rule merge", "Disabled"),
      s("fw.logging.droppedpackets", "Firewall", "Log dropped packets", "Enabled"),
    ],
  },
  {
    id: "pol-oib-update-ring",
    kind: "deviceConfiguration",
    displayName: "Win - OIB - Update - D - Windows Update Ring - Production - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      // Conflicts with "Windows - Feature Update Deferral" (30 vs 7 days).
      s("update.deferfeature", "Windows Update", "Feature update deferral (days)", "7"),
      s("update.deferquality", "Windows Update", "Quality update deferral (days)", "3"),
      s("update.automaticupdatemode", "Windows Update", "Automatic update behavior", "Auto install at maintenance time"),
      s("update.activehoursstart", "Windows Update", "Active hours start", "8"),
      s("update.activehoursend", "Windows Update", "Active hours end", "17"),
      s("update.deadlinequality", "Windows Update", "Quality update deadline (days)", "5"),
      s("update.deadlinefeature", "Windows Update", "Feature update deadline (days)", "7"),
      s("update.gracedays", "Windows Update", "Deadline grace period (days)", "2"),
      s("update.deliveryoptimization", "Delivery Optimization", "Download mode", "HTTP + peering (LAN)"),
      s("update.pauseupdates", "Windows Update", "Allow user to pause updates", "Disabled"),
      s("update.prereleasebuilds", "Windows Update", "Pre-release builds", "Disabled"),
      s("update.driverupdates", "Windows Update", "Exclude drivers from quality updates", "Allow"),
    ],
  },
  {
    id: "pol-oib-device-restrictions",
    kind: "deviceConfiguration",
    displayName: "Win - OIB - Device - D - Device Restrictions - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("restrict.cortana", "Device Restrictions", "Cortana", "Blocked"),
      s("restrict.consumerfeatures", "Device Restrictions", "Consumer features", "Blocked"),
      s("restrict.tips", "Device Restrictions", "Windows tips", "Blocked"),
      s("restrict.spotlight", "Device Restrictions", "Windows Spotlight", "Blocked"),
      s("restrict.telemetry", "Device Restrictions", "Diagnostic data", "Required only"),
      s("restrict.oneddrivesync", "Device Restrictions", "Block personal OneDrive sync", "Enabled"),
      s("restrict.storagecard", "Device Restrictions", "Removable storage", "Allowed"),
      s("restrict.camera", "Device Restrictions", "Camera", "Allowed"),
      s("restrict.copypaste", "Device Restrictions", "Clipboard cloud sync", "Blocked"),
      s("restrict.locationservices", "Device Restrictions", "Location services", "User controlled"),
      s("restrict.findmydevice", "Device Restrictions", "Find My Device", "Enabled"),
      s("restrict.addprovisioningpackage", "Device Restrictions", "Add provisioning packages", "Blocked"),
      s("restrict.devicediscovery", "Device Restrictions", "Nearby device discovery", "Blocked"),
      s("restrict.inkworkspace", "Device Restrictions", "Ink Workspace", "Blocked above lock"),
    ],
  },
  {
    id: "pol-oib-hello",
    kind: "settingsCatalog",
    displayName: "Win - OIB - Device - D - Windows Hello for Business - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("hello.usepassport", "Windows Hello", "Use Windows Hello for Business", "Enabled"),
      s("hello.requiresecuritydevice", "Windows Hello", "Require TPM", "Enabled"),
      s("hello.minpinlength", "Windows Hello", "Minimum PIN length", "6"),
      s("hello.enhancedantispoofing", "Windows Hello", "Enhanced anti-spoofing", "Enabled"),
    ],
  },
  {
    id: "pol-oib-laps",
    kind: "settingsCatalog",
    displayName: "Win - OIB - Device - D - LAPS - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("laps.backupdirectory", "LAPS", "Backup directory", "Microsoft Entra ID"),
      s("laps.passwordage", "LAPS", "Password age (days)", "30"),
      s("laps.passwordcomplexity", "LAPS", "Password complexity", "Large + small letters + numbers + specials"),
      s("laps.postauthaction", "LAPS", "Post-authentication action", "Reset password and logoff"),
    ],
  },
  {
    id: "pol-oib-compliance-password",
    kind: "compliancePolicy",
    displayName: "Win - OIB - Compliance - U - Password - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("compliance.passwordrequired", "Compliance", "Require a password", "Required"),
      s("compliance.passwordminlength", "Compliance", "Minimum password length", "8"),
      s("compliance.passwordtype", "Compliance", "Required password type", "Alphanumeric"),
      s("compliance.passwordexpirydays", "Compliance", "Password expiration (days)", "0"),
    ],
  },
  {
    id: "pol-oib-compliance-devsec",
    kind: "compliancePolicy",
    displayName: "Win - OIB - Compliance - U - Device Security - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("compliance.bitlocker", "Compliance", "Require BitLocker", "Required"),
      s("compliance.securebootrequired", "Compliance", "Require Secure Boot", "Required"),
      s("compliance.codeintegrity", "Compliance", "Require code integrity", "Required"),
      s("compliance.tpm", "Compliance", "Require TPM", "Required"),
      s("compliance.defenderav", "Compliance", "Microsoft Defender Antivirus", "Required"),
    ],
  },
  {
    id: "pol-oib-chrome",
    kind: "adminTemplate",
    displayName: "Win - OIB - Device - D - 3rd Party Browser Policy - Chrome - v3.1",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("chrome.passwordmanager", "Google Chrome", "Password manager enabled", "Disabled"),
      s("chrome.safebrowsing", "Google Chrome", "Safe Browsing protection level", "Enhanced"),
      s("chrome.metricsreporting", "Google Chrome", "Metrics reporting", "Disabled"),
    ],
  },
  {
    id: "pol-oib-timezone",
    kind: "platformScript",
    displayName: "Win - OIB - Device - D - Set Time Zone",
    platform: "windows",
    assignedGroupIds: [ALL_DEVICES],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("script.file", "Platform Script", "Script", "Set-TimeZone.ps1 (runs in system context)")],
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
      s("asr.blockofficecomms", "ASR", "Block Office communication child processes", "Block"),
      s("asr.blockwin32api", "ASR", "Block Win32 API calls from Office macros", "Block"),
      s("asr.useadvancedprotection", "ASR", "Use advanced ransomware protection", "Block"),
    ],
  },
  {
    id: "pol-oib-av-ring1-draft",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus Updates - Ring 1 - Pilot - v3.4",
    platform: "windows",
    assignedGroupIds: [],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.engineupdatechannel", "Defender Updates", "Engine update channel", "Beta"),
      s("defender.platformupdatechannel", "Defender Updates", "Platform update channel", "Beta"),
      s("defender.definitionupdatechannel", "Defender Updates", "Security intelligence channel", "Current"),
    ],
  },
  {
    id: "pol-oib-av-ring3-draft",
    kind: "settingsCatalog",
    displayName: "Win - OIB - ES - Defender Antivirus Updates - Ring 3 - Production - v3.4",
    platform: "windows",
    assignedGroupIds: [],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("defender.engineupdatechannel", "Defender Updates", "Engine update channel", "Broad"),
      s("defender.platformupdatechannel", "Defender Updates", "Platform update channel", "Broad"),
      s("defender.definitionupdatechannel", "Defender Updates", "Security intelligence channel", "Current"),
    ],
  },
  {
    id: "pol-mac-compliance",
    kind: "compliancePolicy",
    displayName: "macOS - Compliance Policy",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("mac.filevault", "FileVault", "Require FileVault encryption", "Enabled")],
  },
  {
    id: "pol-mac-wifi",
    kind: "deviceConfiguration",
    displayName: "macOS - Corporate Wi-Fi",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("mac.wifi.ssid", "Wi-Fi", "SSID", "CorpNet")],
  },
  {
    id: "pol-ios-restrictions",
    kind: "deviceConfiguration",
    displayName: "iOS - Device Restrictions",
    platform: "ios",
    assignedGroupIds: ["grp-ios"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("ios.appstore", "Restrictions", "Block App Store", "Blocked")],
  },
  {
    id: "pol-android-compliance",
    kind: "compliancePolicy",
    displayName: "Android - Compliance Policy",
    platform: "android",
    assignedGroupIds: ["grp-android"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [s("android.minosversion", "Compliance", "Minimum OS version", "13")],
  },

  // ---- macOS Open Intune Baseline–style set (inspired by the macOS OIB) ----
  {
    id: "pol-mac-oib-filevault",
    kind: "settingsCatalog",
    displayName: "macOS - OIB - Endpoint Security - FileVault - v1.3",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.filevault.enable", "FileVault", "Enable FileVault", "Enabled"),
      s("mac.filevault.escrow", "FileVault", "Escrow personal recovery key", "Enabled"),
      s("mac.filevault.deferforceatlogout", "FileVault", "Defer enablement until logout", "Enabled"),
      s("mac.filevault.recoverykeyrotation", "FileVault", "Rotate recovery key (days)", "180"),
      s("mac.filevault.showrecoverykey", "FileVault", "Show recovery key to user", "Disabled"),
    ],
  },
  {
    id: "pol-mac-oib-firewall-gatekeeper",
    kind: "settingsCatalog",
    displayName: "macOS - OIB - Endpoint Security - Firewall & Gatekeeper - v1.3",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.firewall.enable", "Firewall", "Enable firewall", "Enabled"),
      s("mac.firewall.blockall", "Firewall", "Block all incoming connections", "Disabled"),
      s("mac.firewall.stealth", "Firewall", "Enable stealth mode", "Enabled"),
      s("mac.gatekeeper.allowedsource", "Gatekeeper", "Allowed app sources", "App Store and identified developers"),
      s("mac.gatekeeper.allowoverride", "Gatekeeper", "Allow user override", "Disabled"),
    ],
  },
  {
    id: "pol-mac-oib-softwareupdate",
    kind: "settingsCatalog",
    displayName: "macOS - OIB - Device - Software Update - v1.3",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.update.automaticcheck", "Software Update", "Automatically check for updates", "Enabled"),
      s("mac.update.autoinstallos", "Software Update", "Automatically install macOS updates", "Enabled"),
      s("mac.update.autoinstallapp", "Software Update", "Automatically install app updates", "Enabled"),
      s("mac.update.criticalupdates", "Software Update", "Install security responses", "Enabled"),
      s("mac.update.deferdays", "Software Update", "Defer major OS updates (days)", "7"),
    ],
  },
  {
    id: "pol-mac-oib-compliance",
    kind: "compliancePolicy",
    displayName: "macOS - OIB - Compliance - Device Security - v1.3",
    platform: "macos",
    assignedGroupIds: ["grp-mac"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("mac.compliance.filevault", "Compliance", "Require FileVault", "Required"),
      s("mac.compliance.firewall", "Compliance", "Require firewall", "Required"),
      s("mac.compliance.sip", "Compliance", "System Integrity Protection", "Required"),
      s("mac.compliance.gatekeeper", "Compliance", "Gatekeeper", "App Store and identified developers"),
      s("mac.compliance.minosversion", "Compliance", "Minimum OS version", "14.0"),
    ],
  },

  // ---- iOS / Android: a second policy each so those tabs aren't bare ----
  {
    id: "pol-ios-compliance",
    kind: "compliancePolicy",
    displayName: "iOS - Compliance Policy",
    platform: "ios",
    assignedGroupIds: ["grp-ios"],
    excludedGroupIds: [],
    assignmentFilters: [],
    settings: [
      s("ios.compliance.passcode", "Compliance", "Require a passcode", "Required"),
      s("ios.compliance.minosversion", "Compliance", "Minimum OS version", "17.0"),
      s("ios.compliance.jailbroken", "Compliance", "Block jailbroken devices", "Block"),
      s("ios.compliance.threatlevel", "Compliance", "Max mobile threat level", "Secured"),
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
      s("android.restrict.screencapture", "Work Profile", "Block screen capture", "Blocked"),
      s("android.restrict.crossprofilecopy", "Work Profile", "Block copy/paste to personal", "Blocked"),
      s("android.restrict.minpasswordlength", "Work Profile", "Minimum password length", "6"),
      s("android.restrict.playprotect", "Work Profile", "Require Google Play Protect", "Required"),
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
