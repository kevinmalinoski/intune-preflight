import { describe, expect, it } from "vitest";
import { buildAssignmentReport, computeSimulation, listUnassignedPolicies } from "../baseline.js";
import { demoTenantData } from "./demoTenant.js";

// The demo tenant is the tool's shop window -- assert it keeps exercising every
// headline feature so it can't silently go boring as the engine changes.
describe("demo tenant", () => {
  const data = demoTenantData();

  it("produces a real conflict for a corporate Windows device", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-corp-win"], platform: "windows" });
    expect(sim.conflicts.some((c) => c.settingId === "password.minlength")).toBe(true);
  });

  it("produces an overlap and an exclude for a kiosk device", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-kiosk"], platform: "windows" });
    expect(sim.overlaps.length).toBeGreaterThan(0);
    // Kiosk is explicitly excluded from the feature-update profile.
    expect(sim.excludedPolicies.some((p) => p.id === "pol-win-feature-update")).toBe(true);
  });

  it("has an unassigned policy for the Policy Waitlist", () => {
    expect(listUnassignedPolicies(data, "windows").some((p) => p.id === "pol-win-edge-draft")).toBe(true);
  });

  it("reads like a real OIB tenant: a rich baseline with the Defender submit-samples conflict", () => {
    const sim = computeSimulation(data, { selectedGroupIds: [], platform: "windows" });
    // Rich enough to be representative (the Open Intune Baseline Windows set).
    expect(sim.settings.length).toBeGreaterThan(100);
    // The AV Configuration vs Security Baseline "Submit samples consent"
    // disagreement -- the headline conflict admins actually hit.
    expect(sim.conflicts.some((c) => c.settingId === "defender.submitsamplesconsent")).toBe(true);
    // The Waitlist showcases the OIB update rings, not just the one draft.
    expect(listUnassignedPolicies(data, "windows").length).toBeGreaterThanOrEqual(3);
  });

  it("surfaces legacy Endpoint Security (intents) policies, merged and compared", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-corp-win"], platform: "windows" });
    // Org-wide + corp-override legacy BitLocker intents disagree on the cipher
    // -> a real conflict, proving legacy intents join Windows conflict detection.
    expect(sim.conflicts.some((c) => c.settingId === "endpointSecurity:bitlocker_encryptionMethod")).toBe(true);
    // A legacy Defender Antivirus intent contributes to the merged baseline.
    expect(sim.settings.some((setting) => setting.settingId === "endpointSecurity:defenderav_cloudBlockLevel")).toBe(true);
    // An unassigned legacy Firewall intent is available in the Policy Waitlist.
    expect(listUnassignedPolicies(data, "windows").some((p) => p.id === "pol-es-firewall-draft")).toBe(true);
  });

  it("has an implied membership in the manifest (kiosk-multi implies kiosk)", () => {
    const report = buildAssignmentReport(data, "windows");
    const multi = report.groupOverlaps.find((o) => o.groupId === "grp-kiosk-multi");
    expect(multi?.impliedGroupIds).toContain("grp-kiosk");
  });

  it("targets Autopilot v1, with the kiosk exclusion flagged", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-autopilot"], platform: "windows" });
    expect(sim.autopilotProfiles?.find((a) => a.id === "ap-win11")?.status).toBe("targeted");
    const kiosk = computeSimulation(data, { selectedGroupIds: ["grp-autopilot", "grp-kiosk"], platform: "windows" });
    expect(kiosk.autopilotProfiles?.find((a) => a.id === "ap-win11")?.status).toBe("excluded");
  });

  it("shows Autopilot v1 and v2 together via the shared device group (dual enrollment)", () => {
    // v2 targets through its configured just-in-time DEVICE group, not the
    // user-group assignment -- so the one device group lights up both.
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-autopilot"], platform: "windows" });
    expect(sim.autopilotProfiles?.map((a) => a.generation).sort()).toEqual(["v1", "v2"]);
    // The user-group assignment alone does NOT target the device-focused card.
    const userOnly = computeSimulation(data, { selectedGroupIds: ["grp-ap2-users"], platform: "windows" });
    expect(userOnly.autopilotProfiles).toEqual([]);
  });

  it("covers all four OS platforms", () => {
    for (const platform of ["windows", "macos", "ios", "android"] as const) {
      expect(buildAssignmentReport(data, platform).rows.length).toBeGreaterThan(0);
    }
  });
});
