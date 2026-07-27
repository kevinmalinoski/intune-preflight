import { describe, expect, it } from "vitest";
import type { AutopilotProfile, CspSetting, IntuneGroup, IntunePolicy } from "@intune-preflight/shared";
import { UNASSIGNED_SOURCE_GROUP } from "@intune-preflight/shared";
import { assignmentReportToCsv, buildAssignmentReport, computeSimulation, listUnassignedPolicies } from "./baseline.js";
import { VIRTUAL_GROUP_ALL_DEVICES } from "./normalize.js";
import type { TenantData } from "./intuneData.js";

const setting = (settingId: string, value: string): CspSetting => ({
  settingId,
  cspArea: "Test",
  displayName: settingId,
  value,
});

const policy = (over: Partial<IntunePolicy> & Pick<IntunePolicy, "id">): IntunePolicy => ({
  kind: "deviceConfiguration",
  displayName: over.id,
  platform: "windows",
  settings: [],
  assignedGroupIds: [],
  excludedGroupIds: [],
  assignmentFilters: [],
  ...over,
});

const group = (id: string, over: Partial<IntuneGroup> = {}): IntuneGroup => ({ id, displayName: id, ...over });

const tenant = (over: Partial<TenantData> = {}): TenantData => ({
  policies: [],
  groups: [],
  autopilotProfiles: [],
  assignmentFilters: [],
  ...over,
});

describe("computeSimulation", () => {
  it("includes a policy assigned to a selected group", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [policy({ id: "p1", assignedGroupIds: ["g1"], settings: [setting("s1", "on")] })],
    });
    const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });
    expect(sim.policies.map((p) => p.id)).toContain("p1");
    expect(sim.settings.map((s) => s.settingId)).toContain("s1");
  });

  it("an include filter drops the policy by default and applies it when the device matches", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [
        policy({
          id: "p1",
          assignedGroupIds: ["g1"],
          assignmentFilters: [{ groupId: "g1", filterId: "f1", filterType: "include" }],
          settings: [setting("s1", "on")],
        }),
      ],
    });
    // Device does NOT match the include filter -> not applied, flagged with the filter type.
    const off = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });
    expect(off.policies.map((p) => p.id)).not.toContain("p1");
    expect(off.excludedPolicies.find((p) => p.id === "p1")?.excludedByFilter?.filterType).toBe("include");
    // Device matches the include filter -> applies.
    const on = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows", deviceFilterIds: ["f1"] });
    expect(on.policies.map((p) => p.id)).toContain("p1");
  });

  it("applies exclude-wins over include", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [policy({ id: "p1", assignedGroupIds: [VIRTUAL_GROUP_ALL_DEVICES.id], excludedGroupIds: ["g1"] })],
    });
    const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });
    expect(sim.policies.map((p) => p.id)).not.toContain("p1");
    expect(sim.excludedPolicies.map((p) => p.id)).toContain("p1");
  });

  it("always applies All Devices, even with no groups selected", () => {
    const data = tenant({
      policies: [policy({ id: "p1", assignedGroupIds: [VIRTUAL_GROUP_ALL_DEVICES.id] })],
    });
    const sim = computeSimulation(data, { selectedGroupIds: [], platform: "windows" });
    expect(sim.policies.map((p) => p.id)).toContain("p1");
  });

  it("filters out policies of a different platform", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [
        policy({ id: "win", platform: "windows", assignedGroupIds: ["g1"] }),
        policy({ id: "mac", platform: "macos", assignedGroupIds: ["g1"] }),
      ],
    });
    const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });
    const ids = sim.policies.map((p) => p.id);
    expect(ids).toContain("win");
    expect(ids).not.toContain("mac");
  });

  it("flags a genuine conflict (same setting, different values)", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [
        policy({ id: "a", assignedGroupIds: ["g1"], settings: [setting("s1", "on")] }),
        policy({ id: "b", assignedGroupIds: ["g1"], settings: [setting("s1", "off")] }),
      ],
    });
    const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });
    expect(sim.conflicts.map((c) => c.settingId)).toContain("s1");
  });

  it("suppresses conflicts and overlaps off Windows (only trustworthy there)", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [
        policy({ id: "a", platform: "macos", assignedGroupIds: ["g1"], settings: [setting("s1", "on")] }),
        policy({ id: "b", platform: "macos", assignedGroupIds: ["g1"], settings: [setting("s1", "off")] }),
      ],
    });
    const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "macos" });
    // The conflicting setting is still merged into the baseline...
    expect(sim.settings.map((s) => s.settingId)).toContain("s1");
    // ...but not reported as a conflict/overlap off Windows.
    expect(sim.conflicts).toEqual([]);
    expect(sim.overlaps).toEqual([]);
  });

  it("reports each policy's own settingsCount even when settings collide", () => {
    // Two Feature-Update-like policies set the same settingId to different values;
    // the merge keeps one entry, but both must still report their own count.
    const data = tenant({
      groups: [group("g1")],
      policies: [
        policy({ id: "v24h2", assignedGroupIds: ["g1"], settings: [setting("featureupdate.version", "24H2")] }),
        policy({ id: "v25h2", assignedGroupIds: ["g1"], settings: [setting("featureupdate.version", "25H2")] }),
      ],
    });
    const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });
    expect(sim.settings).toHaveLength(1); // merged/deduped
    expect(sim.policies.find((p) => p.id === "v24h2")?.settingsCount).toBe(1);
    expect(sim.policies.find((p) => p.id === "v25h2")?.settingsCount).toBe(1);
  });

  it("injects a manually-added unassigned policy via the synthetic bucket", () => {
    const data = tenant({
      policies: [policy({ id: "orphan", assignedGroupIds: [], settings: [setting("s9", "v")] })],
    });
    const sim = computeSimulation(data, { selectedGroupIds: [], platform: "windows", unassignedPolicyIds: ["orphan"] });
    const injected = sim.policies.find((p) => p.id === "orphan");
    expect(injected?.unassigned).toBe(true);
    expect(injected?.viaGroupIds).toContain(UNASSIGNED_SOURCE_GROUP.id);
    expect(sim.settings.map((s) => s.settingId)).toContain("s9");
  });
});

describe("computeSimulation Autopilot targeting", () => {
  const ap = (over: Partial<AutopilotProfile> & Pick<AutopilotProfile, "id" | "generation">): AutopilotProfile => ({
    displayName: over.id,
    osLabel: "Windows 11",
    assignedGroupIds: [],
    excludedGroupIds: [],
    settings: [],
    ...over,
  });

  it("targets a v1 profile via its device group, and exclusion wins", () => {
    const data = tenant({
      groups: [group("g-ap"), group("g-kiosk")],
      autopilotProfiles: [ap({ id: "v1", generation: "v1", assignedGroupIds: ["g-ap"], excludedGroupIds: ["g-kiosk"] })],
    });
    const targeted = computeSimulation(data, { selectedGroupIds: ["g-ap"], platform: "windows" }).autopilotProfiles;
    expect(targeted?.[0]).toMatchObject({ id: "v1", status: "targeted" });

    const excluded = computeSimulation(data, { selectedGroupIds: ["g-ap", "g-kiosk"], platform: "windows" }).autopilotProfiles;
    expect(excluded?.[0]).toMatchObject({ status: "excluded", excludedViaGroupIds: ["g-kiosk"] });
  });

  it("targets v2 via its configured device group, never the user assignment", () => {
    const data = tenant({
      groups: [group("g-dev"), group("g-users")],
      autopilotProfiles: [
        ap({ id: "v1", generation: "v1", assignedGroupIds: ["g-dev"] }),
        ap({ id: "v2", generation: "v2", assignedGroupIds: ["g-users"], deviceGroupId: "g-dev" }),
      ],
    });
    // The shared device group lights up both generations (dual enrollment)...
    const both = computeSimulation(data, { selectedGroupIds: ["g-dev"], platform: "windows" }).autopilotProfiles;
    expect(both?.map((a) => a.id).sort()).toEqual(["v1", "v2"]);
    // ...the v2 user-group assignment alone targets nothing...
    expect(computeSimulation(data, { selectedGroupIds: ["g-users"], platform: "windows" }).autopilotProfiles).toEqual([]);
    // ...and none of it applies off Windows.
    expect(computeSimulation(data, { selectedGroupIds: ["g-dev"], platform: "macos" }).autopilotProfiles).toEqual([]);
  });
});

describe("assignmentReportToCsv (formula-injection safe)", () => {
  it("prefixes formula-triggering values with a quote and RFC-4180 quotes them", () => {
    const data = tenant({
      groups: [group("g1")],
      policies: [policy({ id: "=HYPERLINK(\"http://evil\",\"x\")", displayName: "=HYPERLINK(\"http://evil\",\"x\")", assignedGroupIds: ["g1"] })],
    });
    const csv = assignmentReportToCsv(buildAssignmentReport(data, "windows"));
    // The dangerous cell is neutralized: leading single quote, wrapped in quotes.
    expect(csv).toContain('"\'=HYPERLINK');
    // A benign value is not altered.
    expect(csv).toContain('"g1"');
  });
});

describe("listUnassignedPolicies", () => {
  it("returns only policies with no include assignment, scoped to the platform", () => {
    const data = tenant({
      policies: [
        policy({ id: "assigned", assignedGroupIds: ["g1"] }),
        policy({ id: "orphanWin", assignedGroupIds: [] }),
        policy({ id: "orphanMac", platform: "macos", assignedGroupIds: [] }),
      ],
    });
    const ids = listUnassignedPolicies(data, "windows").map((p) => p.id);
    expect(ids).toEqual(["orphanWin"]);
  });
});

describe("buildAssignmentReport", () => {
  const data = tenant({
    groups: [group("g1"), group("g2")],
    policies: [
      policy({ id: "p1", assignedGroupIds: ["g1", "g2"] }),
      policy({ id: "p2", assignedGroupIds: ["g1"], excludedGroupIds: ["g2"] }),
      policy({ id: "orphan", assignedGroupIds: [] }),
    ],
  });

  it("emits one row per include/exclude edge", () => {
    const report = buildAssignmentReport(data, "windows");
    // p1 -> g1, p1 -> g2, p2 -> g1 (include), p2 -> g2 (exclude) = 4 rows
    expect(report.rows).toHaveLength(4);
    expect(report.rows.filter((r) => r.assignment === "Exclude")).toHaveLength(1);
  });

  it("rolls up per-group policy counts, ranked most-targeted first", () => {
    const report = buildAssignmentReport(data, "windows");
    const g1 = report.groupOverlaps.find((o) => o.groupId === "g1");
    expect(g1?.policyCount).toBe(2); // p1 + p2
    expect(report.groupOverlaps[0].policyCount).toBeGreaterThanOrEqual(report.groupOverlaps[1].policyCount);
  });

  it("counts unassigned policies in totals but not in rows", () => {
    const report = buildAssignmentReport(data, "windows");
    expect(report.totals.policies).toBe(3);
    expect(report.totals.unassigned).toBe(1);
    expect(report.rows.some((r) => r.policyId === "orphan")).toBe(false);
  });
});
