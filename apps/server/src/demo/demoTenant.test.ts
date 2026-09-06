import { describe, expect, it } from "vitest";
import { buildAssignmentReport, computeSimulation, listUnassignedPolicies } from "../baseline.js";
import { demoTenantData } from "./demoTenant.js";

// The demo tenant is the tool's shop window -- assert it keeps exercising every
// headline feature so it can't silently go boring as the engine changes. All
// policy names and settings are the real Open Intune Baseline (Windows v3.8 /
// macOS v1.0); only the assignment layer and the two "CORP" overrides are authored.
describe("demo tenant", () => {
  const data = demoTenantData();

  it("produces a real conflict for a corporate Windows device", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-corp-win"], platform: "windows" });
    // OIB AV Configuration ("High") vs the CORP Cloud Protection Tuning override
    // ("Zero tolerance blocking level") on the same real Defender setting.
    expect(sim.conflicts.some((c) => c.settingId === "defender.cloudblocklevel")).toBe(true);
  });

  it("produces an overlap for a corporate Windows device", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-corp-win"], platform: "windows" });
    // Real-time monitoring is set the same ("Allowed") in both the OIB baseline
    // and the CORP override -> a redundant overlap, not a conflict.
    expect(sim.overlaps.some((o) => o.settingId === "defender.allowrealtimemonitoring")).toBe(true);
  });

  it("applies an exclude-wins carve-out (Pilot ring out of Production)", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-ring-pilot"], platform: "windows" });
    expect(sim.excludedPolicies.some((p) => p.id === "pol-oib-defender-ring3")).toBe(true);
  });

  it("has unassigned policies for the Policy Waitlist", () => {
    const waitlist = listUnassignedPolicies(data, "windows");
    expect(waitlist.some((p) => p.id === "pol-oib-asr-l2-draft")).toBe(true);
    // The Waitlist showcases the OIB update rings (ASR L2 + UAT ring, at least).
    expect(waitlist.length).toBeGreaterThanOrEqual(2);
  });

  it("reads like a real OIB tenant: a rich All Devices baseline", () => {
    const sim = computeSimulation(data, { selectedGroupIds: [], platform: "windows" });
    // The Open Intune Baseline Windows set is broad enough to be representative.
    expect(sim.settings.length).toBeGreaterThan(50);
  });

  it("surfaces legacy Endpoint Security (intents) policies in the merged baseline", () => {
    const sim = computeSimulation(data, { selectedGroupIds: ["grp-corp-win"], platform: "windows" });
    // The org-wide legacy BitLocker intent contributes to the merged baseline,
    // proving legacy intents join the Windows comparison alongside Settings Catalog.
    expect(sim.settings.some((setting) => setting.settingId === "endpointSecurity:bitlocker_requireEncryption")).toBe(true);
    // A legacy Defender Antivirus intent on corporate devices also contributes.
    expect(sim.settings.some((setting) => setting.settingId === "endpointSecurity:defenderav_cloudBlockLevel")).toBe(true);
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

  it("flags a legacy device-config template for the Settings Catalog migration nudge", () => {
    const report = buildAssignmentReport(data, "windows");
    expect(report.rows.some((r) => r.policyId === "pol-win-device-restrictions-template" && r.legacyTemplate)).toBe(true);
  });

  it("surfaces a cross-model overlap (legacy template MS-account block vs the Settings Catalog equivalent)", () => {
    const sim = computeSimulation(data, { selectedGroupIds: [], platform: "windows" });
    const finding = sim.crossModel.find((f) => f.cspNode === "accounts/allowmicrosoftaccountconnection");
    expect(finding).toBeTruthy();
    // Both block -> a redundant cross-model duplicate, and it's NOT a normal conflict/overlap.
    expect(finding?.agreement).toBe("same");
    expect(finding?.entries.some((e) => e.sourceLegacyTemplate)).toBe(true);
  });

  it("covers all four OS platforms", () => {
    for (const platform of ["windows", "macos", "ios", "android"] as const) {
      expect(buildAssignmentReport(data, platform).rows.length).toBeGreaterThan(0);
    }
  });
});
