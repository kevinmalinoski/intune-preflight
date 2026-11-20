import { describe, expect, it } from "vitest";
import type { AutopilotProfile, IntuneGroup, IntunePolicy } from "@intune-preflight/shared";
import { listGroupSummaries, listProfileNameWarnings } from "./baseline.js";
import type { TenantData } from "./tenantData.js";

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
const profile = (displayName: string, assignedGroupIds: string[] = []): AutopilotProfile => ({
  id: displayName,
  displayName,
  osLabel: "Windows",
  generation: "v1",
  assignedGroupIds,
  excludedGroupIds: [],
  settings: [],
});
const tenant = (over: Partial<TenantData>): TenantData => ({
  policies: [],
  groups: [],
  autopilotProfiles: [],
  assignmentFilters: [],
  ...over,
});
const byId = (data: TenantData) => new Map(listGroupSummaries(data).map((g) => [g.id, g]));

describe("listGroupSummaries — nesting", () => {
  it("gives a nested-only group its parents' platforms so the picker shows it", () => {
    const summaries = byId(
      tenant({
        policies: [policy({ id: "p", platform: "macos", assignedGroupIds: ["parent"] })],
        groups: [group("parent"), group("child", { parentGroupIds: ["parent"], nestedOnly: true })],
      })
    );
    expect(summaries.get("child")).toMatchObject({
      platforms: ["macos"],
      nestedOnly: true,
      parentGroupIds: ["parent"],
    });
    // Its own count stays its own: nothing is assigned to it directly.
    expect(summaries.get("child")?.policyCount).toBe(0);
  });
});

describe("listGroupSummaries — enrollment profile names", () => {
  const rule = (name: string) => `(device.enrollmentProfileName -ne "${name}")`;
  const data = (profiles: AutopilotProfile[], membershipRule: string) =>
    tenant({
      policies: [policy({ id: "p", assignedGroupIds: ["g"] })],
      groups: [group("g", { isDynamic: true, membershipRule })],
      autopilotProfiles: profiles,
    });

  it("flags a name no Autopilot profile is called, such as one renamed since", () => {
    const g = byId(data([profile("Kiosk - Shared")], rule("Kiosk Shared"))).get("g");
    expect(g?.staleProfileNames).toEqual([{ name: "Kiosk Shared" }]);
  });

  it("flags a name that differs from a profile's only by a trailing space, and names the profile", () => {
    const g = byId(data([profile("Windows - Autopilot V2 - Kiosk ")], rule("Windows - Autopilot V2 - Kiosk"))).get("g");
    expect(g?.staleProfileNames).toEqual([
      { name: "Windows - Autopilot V2 - Kiosk", closest: "Windows - Autopilot V2 - Kiosk " },
    ]);
  });

  it("matches profile names case-insensitively", () => {
    expect(byId(data([profile("Kiosk Shared")], rule("kiosk shared"))).get("g")?.staleProfileNames).toBeUndefined();
  });

  it("says nothing when no Autopilot profiles were read at all", () => {
    expect(byId(data([], rule("Anything"))).get("g")?.staleProfileNames).toBeUndefined();
  });

  it("leaves Autopilot-for-existing-devices correlator names alone", () => {
    expect(
      byId(data([profile("Kiosk")], rule("OfflineAutopilotprofile-1234"))).get("g")?.staleProfileNames
    ).toBeUndefined();
  });

  it("does not check groups with no Windows assignments, whose names may be Apple or Android profiles", () => {
    const summaries = byId(
      tenant({
        policies: [policy({ id: "p", platform: "ios", assignedGroupIds: ["g"] })],
        groups: [group("g", { isDynamic: true, membershipRule: '(device.enrollmentProfileName -eq "DEP iPhones")' })],
        autopilotProfiles: [profile("Kiosk")],
      })
    );
    expect(summaries.get("g")?.staleProfileNames).toBeUndefined();
  });
});

describe("listProfileNameWarnings — every dynamic group in the tenant", () => {
  const sharedKiosk = (excluded: string[]) =>
    group("shared", {
      displayName: "Device - Security Baseline - Shared & Kiosk",
      isDynamic: true,
      membershipRule: [
        '(device.deviceOSType -eq "Windows")',
        ...excluded.map((n) => `(device.enrollmentProfileName -ne "${n}")`),
      ].join(" and "),
    });

  it("finds a renamed profile in a group nothing is assigned to yet", () => {
    // The profile "User Driven" was renamed; the exclusion still names the old one.
    const warnings = listProfileNameWarnings(
      tenant({
        autopilotProfiles: [profile("Default - User Driven")],
        profileRuleGroups: [sharedKiosk(["User Driven"])],
      })
    );
    expect(warnings).toEqual([
      {
        groupId: "shared",
        displayName: "Device - Security Baseline - Shared & Kiosk",
        assigned: false,
        names: [{ name: "User Driven" }],
      },
    ]);
  });

  it("says nothing once the rule names the current profile", () => {
    expect(
      listProfileNameWarnings(
        tenant({
          autopilotProfiles: [profile("Default - User Driven")],
          profileRuleGroups: [sharedKiosk(["Default - User Driven"])],
        })
      )
    ).toEqual([]);
  });

  it("leaves an unassigned rule alone when nothing marks it as Windows", () => {
    // Could be an Apple Automated Device Enrollment profile, which is not read.
    expect(
      listProfileNameWarnings(
        tenant({
          autopilotProfiles: [profile("Kiosk")],
          profileRuleGroups: [
            group("ade", { isDynamic: true, membershipRule: '(device.enrollmentProfileName -eq "DEP iPhones")' }),
          ],
        })
      )
    ).toEqual([]);
  });

  it("counts a rule as Windows when another of its names is a current Autopilot profile", () => {
    const warnings = listProfileNameWarnings(
      tenant({
        autopilotProfiles: [profile("Kiosk")],
        profileRuleGroups: [
          group("mixed", {
            isDynamic: true,
            membershipRule: '(device.enrollmentProfileName -in ["Kiosk", "Old Kiosk"])',
          }),
        ],
      })
    );
    expect(warnings.map((w) => w.names)).toEqual([[{ name: "Old Kiosk" }]]);
  });

  it("marks an assigned group as assigned and lists each group once", () => {
    const g = sharedKiosk(["Gone"]);
    const warnings = listProfileNameWarnings(
      tenant({
        policies: [policy({ id: "p", assignedGroupIds: ["shared"] })],
        groups: [g],
        profileRuleGroups: [g],
        autopilotProfiles: [profile("Kiosk")],
      })
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0].assigned).toBe(true);
  });
});
