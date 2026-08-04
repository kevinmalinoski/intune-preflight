import { describe, expect, it } from "vitest";
import {
  flattenIntentSettings,
  flattenSettingsCatalogEntries,
  flattenToCspSettings,
  parseAssignmentTarget,
  platformFromIntentTemplate,
  platformFromOdataType,
  ruleImplies,
} from "./normalize.js";

describe("platformFromOdataType (platform classification)", () => {
  it("classifies the obvious platforms", () => {
    expect(platformFromOdataType("#microsoft.graph.androidCompliancePolicy")).toBe("android");
    expect(platformFromOdataType("#microsoft.graph.macOSCustomConfiguration")).toBe("macos");
    expect(platformFromOdataType("#microsoft.graph.iosCompliancePolicy")).toBe("ios");
  });

  it("treats AOSP (which lacks 'android') as Android", () => {
    expect(platformFromOdataType("#microsoft.graph.aospDeviceOwnerCompliancePolicy")).toBe("android");
  });

  it("classifies windowsKioskConfiguration as Windows, not iOS (the 'k-ios-k' trap)", () => {
    expect(platformFromOdataType("#microsoft.graph.windowsKioskConfiguration")).toBe("windows");
  });

  it("falls back to 'other' for unknown types", () => {
    expect(platformFromOdataType("#microsoft.graph.somethingUnclassifiable")).toBe("other");
    expect(platformFromOdataType(undefined)).toBe("other");
  });
});

describe("ruleImplies (dynamic-rule implication)", () => {
  const startsWith = (prefix: string) => `(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:${prefix}"))`;

  it("a narrower prefix implies a broader one", () => {
    expect(ruleImplies(startsWith("SALES-KIOSK-MULTI"), startsWith("SALES-KIOSK"))).toBe(true);
  });

  it("a broader prefix does NOT imply a narrower one", () => {
    expect(ruleImplies(startsWith("SALES-KIOSK"), startsWith("SALES-KIOSK-MULTI"))).toBe(false);
  });

  it("returns false when either rule is missing", () => {
    expect(ruleImplies(undefined, startsWith("SALES"))).toBe(false);
    expect(ruleImplies(startsWith("SALES"), undefined)).toBe(false);
  });

  // Regression: two unrelated real-tenant rules that merely SHARE a condition
  // (both scoped to Company-owned devices) were reported as implying each other,
  // so a Windows group surfaced a macOS group as "implied by rule" -- in both
  // directions. Implication is only provable over devicePhysicalIds clauses.
  it("does not imply across rules that only share an unrelated condition", () => {
    const win =
      '(device.deviceOwnership -eq "Company") and (device.deviceTrustType -eq "AzureAD") and ' +
      '(device.deviceManagementAppId -contains "0000") and (device.deviceOSType -eq "Windows") or ' +
      '(device.devicePhysicalIDs -any (_ -contains "[ZTDId]"))';
    const mac =
      '(device.deviceOwnership -eq "Company") and (device.managementType -eq "MDM") and ' +
      '((device.deviceOSType -contains "mac") or (device.deviceOSType -contains "OS X")) and ' +
      '(device.deviceId -ne "00000000-0000-0000-0000-000000000000")';
    expect(ruleImplies(win, mac)).toBe(false);
    expect(ruleImplies(mac, win)).toBe(false);
  });

  it("ignores rules that mix in any non-devicePhysicalIds condition", () => {
    const tagPlusOs = `${startsWith("SALES-KIOSK-MULTI")} and (device.deviceOSType -eq "Windows")`;
    // The prefix relationship still holds, but membership also depends on a
    // condition we can't evaluate -- so no implication is claimed.
    expect(ruleImplies(tagPlusOs, startsWith("SALES-KIOSK"))).toBe(false);
    expect(ruleImplies(startsWith("SALES-KIOSK-MULTI"), tagPlusOs)).toBe(false);
  });

  it("requires EVERY branch of an or-chain to imply, not just one", () => {
    const twoTags = `${startsWith("SALES-KIOSK-VM")} or ${startsWith("HR-LAPTOP")}`;
    // Only the first branch is under SALES-KIOSK; an HR-LAPTOP device would not
    // be a member, so the group as a whole does not imply it.
    expect(ruleImplies(twoTags, startsWith("SALES-KIOSK"))).toBe(false);
    // Both branches under the same broader prefix -> implication holds.
    const bothUnder = `${startsWith("SALES-KIOSK-VM")} or ${startsWith("SALES-KIOSK-SINGLE")}`;
    expect(ruleImplies(bothUnder, startsWith("SALES-KIOSK"))).toBe(true);
  });
});

describe("flattenIntentSettings (legacy Endpoint Security intents)", () => {
  const defId = "deviceConfiguration--windows10EndpointProtectionConfiguration_bitLockerEncryptDevice";

  it("normalizes scalar settings from `value`, keying on the definitionId", () => {
    const [setting] = flattenIntentSettings(
      [{ "@odata.type": "#microsoft.graph.deviceManagementBooleanSettingInstance", definitionId: defId, value: true }],
      "BitLocker"
    );
    expect(setting.settingId).toBe(`endpointSecurity:${defId}`);
    expect(setting.cspArea).toBe("BitLocker");
    expect(setting.displayName).toBe("Bit Locker Encrypt Device");
    expect(setting.value).toBe("true");
  });

  it("falls back to valueJson when there is no typed `value`", () => {
    const [setting] = flattenIntentSettings(
      [{ definitionId: "x_encryptionMethodWithXtsOsDrive", valueJson: "7" }],
      "BitLocker"
    );
    expect(setting.value).toBe("7");
  });

  it("drops the notConfigured sentinel", () => {
    expect(flattenIntentSettings([{ definitionId: "x_startupAuthenticationRequired", valueJson: '"notConfigured"' }], "BitLocker")).toEqual([]);
  });

  it("walks child instances of a complex/collection setting", () => {
    const settings = flattenIntentSettings(
      [
        {
          definitionId: "x_firewallRules",
          value: [
            { definitionId: "x_firewallRules_enableDomainNetworkFirewall", value: "allowed" },
            { definitionId: "x_firewallRules_enablePublicNetworkFirewall", valueJson: '"allowed"' },
          ],
        },
      ],
      "Firewall"
    );
    expect(settings.map((s) => s.settingId)).toEqual([
      "endpointSecurity:x_firewallRules_enableDomainNetworkFirewall",
      "endpointSecurity:x_firewallRules_enablePublicNetworkFirewall",
    ]);
  });

  it("defaults an unknown/absent template platform to Windows, not 'other'", () => {
    expect(platformFromIntentTemplate("windows10AndLater")).toBe("windows");
    expect(platformFromIntentTemplate("macOS")).toBe("macos");
    expect(platformFromIntentTemplate(undefined)).toBe("windows");
  });
});

describe("flattenSettingsCatalogEntries (definition enrichment)", () => {
  const defId = "device_vendor_msft_bitlocker_requiredeviceencryption";
  const entry = {
    settingInstance: {
      settingDefinitionId: defId,
      choiceSettingValue: { value: `${defId}_1` },
    },
    settingDefinitions: [
      {
        id: defId,
        displayName: "Require Device Encryption",
        baseUri: "./Device/Vendor/MSFT/BitLocker",
        offsetUri: "/RequireDeviceEncryption",
        options: [
          { itemId: `${defId}_0`, displayName: "Not configured" },
          { itemId: `${defId}_1`, displayName: "Enabled" },
        ],
      },
    ],
  };

  it("resolves the human name, CSP path, and choice value label", () => {
    const [setting] = flattenSettingsCatalogEntries([entry]);
    expect(setting.displayName).toBe("Require Device Encryption");
    expect(setting.cspPath).toBe("./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption");
    expect(setting.value).toBe("Enabled");
  });

  it("falls back gracefully when no definition is expanded", () => {
    const [setting] = flattenSettingsCatalogEntries([{ settingInstance: entry.settingInstance }]);
    expect(setting.cspPath).toBeUndefined();
    expect(setting.value).toBe("1"); // stripped option id, not the human label
  });
});

describe("flattenToCspSettings (compliance default suppression)", () => {
  // A macOS compliance policy that only configures a password rule. Graph still
  // serializes the whole fixed schema, defaulting the untouched fields -- those
  // must not leak in as configured settings (the "hallucinated settings" bug).
  const macCompliance = {
    id: "c1",
    "@odata.type": "#microsoft.graph.macOSCompliancePolicy",
    passwordRequired: true,
    passwordMinimumLength: 8,
    storageRequireEncryption: false, // default: not enforced
    firewallEnabled: false, // default: not enforced
    passwordRequiredType: "deviceDefault", // enum default: not enforced
    deviceThreatProtectionRequiredSecurityLevel: "unavailable", // enum default
    gatekeeperAllowedAppSource: "notConfigured", // enum default
    osMinimumVersion: null,
  };

  it("keeps only the enforced rules, dropping schema defaults", () => {
    const settings = flattenToCspSettings(macCompliance);
    const byId = Object.fromEntries(settings.map((s) => [s.settingId.split(":").pop(), s.value]));
    expect(byId).toEqual({ passwordRequired: "true", passwordMinimumLength: "8" });
  });

  it("does NOT suppress `false` on a non-compliance config profile", () => {
    // A device-restriction profile can legitimately enforce a `false` (e.g.
    // "camera blocked = false"), so the compliance-only suppression must not
    // reach it.
    const restriction = {
      id: "r1",
      "@odata.type": "#microsoft.graph.macOSGeneralDeviceConfiguration",
      cameraBlocked: false,
    };
    const settings = flattenToCspSettings(restriction);
    expect(settings.map((s) => s.value)).toContain("false");
  });
});

describe("parseAssignmentTarget (well-known virtual targets)", () => {
  const ALL_DEVICES = "adadadad-808e-44e2-905a-0b7873a8a531";
  const ALL_USERS = "acacacac-9df4-4c7d-9d50-4ef0226f57a9";

  it("maps the All Devices well-known GUID", () => {
    expect(parseAssignmentTarget({ target: { groupId: ALL_DEVICES } }).isAllDevices).toBe(true);
  });

  it("maps the All Users well-known GUID", () => {
    expect(parseAssignmentTarget({ target: { groupId: ALL_USERS } }).isAllUsers).toBe(true);
  });

  it("recognises the allDevices assignment target type", () => {
    expect(
      parseAssignmentTarget({ target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } }).isAllDevices
    ).toBe(true);
  });

  it("flags exclusion targets", () => {
    const t = parseAssignmentTarget({
      target: { "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget", groupId: "g1" },
    });
    expect(t.isExclude).toBe(true);
    expect(t.groupId).toBe("g1");
  });

  it("passes through a plain group id", () => {
    expect(parseAssignmentTarget({ target: { groupId: "g2" } }).groupId).toBe("g2");
  });
});
