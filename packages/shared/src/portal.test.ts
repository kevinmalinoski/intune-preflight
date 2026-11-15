import { describe, expect, it } from "vitest";
import {
  adminTemplatePortalUrl,
  compliancePortalUrl,
  deviceConfigurationPortalUrl,
  entraGroupPortalUrl,
  featureUpdatePortalUrl,
  intuneAppPortalUrl,
  settingsCatalogPortalUrl,
  windowsScriptPortalUrl,
} from "./index.js";

const ID = "e32e9801-979a-4e0d-a125-fba12999436d";

describe("admin center links", () => {
  it("links an app to its page in Intune", () => {
    expect(intuneAppPortalUrl(ID)).toBe(
      `https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/${ID}`
    );
  });

  it("links a group to its page in Entra", () => {
    expect(entraGroupPortalUrl(ID)).toBe(
      `https://entra.microsoft.com/#view/Microsoft_AAD_IAM/GroupDetailsMenuBlade/~/Overview/groupId/${ID}`
    );
  });

  it("links a Settings Catalog policy, carrying its technologies, template and platform", () => {
    expect(
      settingsCatalogPortalUrl({
        id: ID,
        technologies: "mdm,microsoftSense",
        templateId: "e8c053d6-9f95-42b1-a7f1-ebfd71c67a4b_1",
        platforms: "windows10",
        isAssigned: true,
      })
    ).toBe(
      "https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/PolicySummaryBlade" +
        `/policyId/${ID}/isAssigned~/true/technology/mdm%2CmicrosoftSense` +
        "/templateId/e8c053d6-9f95-42b1-a7f1-ebfd71c67a4b_1/platformName/windows10"
    );
  });

  it("leaves the template segment empty for a policy made without a template", () => {
    expect(
      settingsCatalogPortalUrl({
        id: ID,
        technologies: "mdm",
        templateId: "",
        platforms: "windows10",
        isAssigned: false,
      })
    ).toBe(
      "https://intune.microsoft.com/#view/Microsoft_Intune_Workflows/PolicySummaryBlade" +
        `/policyId/${ID}/isAssigned~/false/technology/mdm/templateId//platformName/windows10`
    );
  });

  it("gives no link when the route's parts are missing, rather than a broken one", () => {
    expect(settingsCatalogPortalUrl({ id: ID, platforms: "windows10", isAssigned: true })).toBeUndefined();
    expect(settingsCatalogPortalUrl({ id: ID, technologies: "mdm", isAssigned: true })).toBeUndefined();
  });

  it("gives no link for an id that is not a Graph object id", () => {
    // The demo tenant's ids, and the two virtual groups.
    expect(intuneAppPortalUrl("app-7zip")).toBeUndefined();
    expect(entraGroupPortalUrl("virtual-all-devices")).toBeUndefined();
    expect(
      settingsCatalogPortalUrl({ id: "pol-oib-av", technologies: "mdm", platforms: "windows10", isAssigned: true })
    ).toBeUndefined();
  });
});

// Each expected address below is one copied from the admin center for a real
// object of that kind, with the id swapped for the test one.
describe("admin center links copied from the portal", () => {
  const DS = "https://intune.microsoft.com/#view/Microsoft_Intune_DeviceSettings";
  const g = (t: string) => `#microsoft.graph.${t}`;

  it("links a Windows platform script", () => {
    expect(windowsScriptPortalUrl(ID)).toBe(`${DS}/ConfigureWMPolicyMenuBlade/~/overview/policyId/${ID}/policyType~/0`);
  });

  it("links a Windows compliance policy, and no other platform's", () => {
    expect(
      compliancePortalUrl({
        id: ID,
        name: "Default Windows Compliance Policy",
        odataType: g("windows10CompliancePolicy"),
      })
    ).toBe(
      `${DS}/CompliancePolicyOverview.ReactView/policyId/${ID}/policyName/Default%20Windows%20Compliance%20Policy/platform~/8/policyType~/35/policyJourneyState~/1`
    );
    expect(compliancePortalUrl({ id: ID, name: "iOS", odataType: g("iosCompliancePolicy") })).toBeUndefined();
  });

  it("links an administrative template", () => {
    expect(
      adminTemplatePortalUrl({ id: ID, name: "WINDOWS - DEVICE - Browser - Firefox - Update Policy", isAssigned: true })
    ).toBe(
      `${DS}/PolicySummaryReportBlade/policyId/${ID}/showReporting~/true/policyType~/71/isAssigned~/true/policyJourneyState~/7/policyName/WINDOWS%20-%20DEVICE%20-%20Browser%20-%20Firefox%20-%20Update%20Policy`
    );
  });

  it("links a custom (OMA-URI) profile and a health monitoring profile by their own codes", () => {
    expect(
      deviceConfigurationPortalUrl({
        id: ID,
        name: "WINDOWS - DEVICE - OMA-URI - SkipUserESP",
        odataType: g("windows10CustomConfiguration"),
        isAssigned: true,
      })
    ).toBe(
      `${DS}/PolicySummaryReportBlade/policyId/${ID}/policyName/WINDOWS%20-%20DEVICE%20-%20OMA-URI%20-%20SkipUserESP/policyJourneyState~/0/policyType~/74/isAssigned~/true`
    );
    expect(
      deviceConfigurationPortalUrl({
        id: ID,
        name: "WINDOWS - DEVICE - Health Monitoring",
        odataType: g("windowsHealthMonitoringConfiguration"),
        isAssigned: true,
      })
    ).toBe(
      `${DS}/PolicySummaryReportBlade/policyId/${ID}/policyName/WINDOWS%20-%20DEVICE%20-%20Health%20Monitoring/policyJourneyState~/0/policyType~/109/isAssigned~/true`
    );
  });

  it("links an update ring to its own blade", () => {
    expect(
      deviceConfigurationPortalUrl({
        id: ID,
        name: "WINDOWS - DEVICE - Update Ring",
        odataType: g("windowsUpdateForBusinessConfiguration"),
        isAssigned: true,
      })
    ).toBe(
      `${DS}/SoftwareUpdatesConfigurationSummaryReportBlade/id/${ID}/softwareUpdatesType/windows/configurationName/WINDOWS%20-%20DEVICE%20-%20Update%20Ring/policyId/${ID}/policyType/Windows10DesktopSoftwareUpdate/policyJourneyState/WindowsUpdates/policyName/WINDOWS%20-%20DEVICE%20-%20Update%20Ring`
    );
  });

  it("links a feature update profile", () => {
    expect(featureUpdatePortalUrl({ id: ID, name: "WINDOWS - DEVICE - Feature Update - 26H2" })).toBe(
      `${DS}/WindowsFeatureUpdateProfileMenu/~/0/profileId/${ID}/profileName/WINDOWS%20-%20DEVICE%20-%20Feature%20Update%20-%2026H2/hasWufbEnabledLicense~/true`
    );
  });

  it("gives no link for a profile type whose code has not been observed", () => {
    expect(
      deviceConfigurationPortalUrl({
        id: ID,
        name: "Restrictions",
        odataType: g("windows10GeneralConfiguration"),
        isAssigned: true,
      })
    ).toBeUndefined();
  });

  it("gives no link when the name holds a slash, which the route splits on", () => {
    expect(adminTemplatePortalUrl({ id: ID, name: "Chrome / Edge", isAssigned: true })).toBeUndefined();
    expect(featureUpdatePortalUrl({ id: ID, name: "A/B" })).toBeUndefined();
  });
});
