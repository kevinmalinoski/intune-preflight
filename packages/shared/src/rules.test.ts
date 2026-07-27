import { describe, expect, it } from "vitest";
import { filterExclusionReason, groupTagMatchesRule, isAutopilotJoinedRule, isGroupTagRule } from "./index.js";

describe("filterExclusionReason (include vs exclude are opposites)", () => {
  it("include: phrased as 'only targets matching devices, this one doesn't'", () => {
    const r = filterExclusionReason("VPN-Eligible", "include");
    expect(r).toMatch(/only applies to devices matching/i);
    expect(r).toMatch(/doesn.t match/i);
  });

  it("exclude: phrased as 'this device matches, which the policy excludes'", () => {
    const r = filterExclusionReason("Kiosk Devices", "exclude");
    expect(r).toMatch(/this device matches/i);
    expect(r).toMatch(/excludes/i);
  });
});

const orderIdEq = (tag: string) =>
  `(device.devicePhysicalIds -any (_ -eq "[OrderID]:${tag}"))`;
const orderIdStartsWith = (prefix: string) =>
  `(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:${prefix}"))`;
const ztdId = `(device.devicePhysicalIDs -any (_ -startsWith "[ZTDId]"))`;

describe("isGroupTagRule", () => {
  it("recognises [OrderID] physical-id rules", () => {
    expect(isGroupTagRule(orderIdEq("SALES-KIOSK"))).toBe(true);
    expect(isGroupTagRule(orderIdStartsWith("SALES"))).toBe(true);
  });

  it("rejects non-group-tag rules", () => {
    expect(isGroupTagRule(ztdId)).toBe(false);
    expect(isGroupTagRule('(device.deviceOSType -eq "Windows")')).toBe(false);
    expect(isGroupTagRule(undefined)).toBe(false);
  });
});

describe("groupTagMatchesRule", () => {
  it("matches an exact -eq tag case-insensitively", () => {
    expect(groupTagMatchesRule(orderIdEq("SALES-KIOSK"), "SALES-KIOSK")).toBe(true);
    expect(groupTagMatchesRule(orderIdEq("SALES-KIOSK"), "sales-kiosk")).toBe(true);
    expect(groupTagMatchesRule(orderIdEq("SALES-KIOSK"), "SALES-KIOSK-VM")).toBe(false);
  });

  it("matches a -startsWith prefix", () => {
    expect(groupTagMatchesRule(orderIdStartsWith("SALES-KIOSK"), "SALES-KIOSK-VM")).toBe(true);
    expect(groupTagMatchesRule(orderIdStartsWith("SALES-KIOSK"), "SALES")).toBe(false);
  });

  it("requires ALL clauses when combined with 'and', ANY with 'or'", () => {
    const andRule = `${orderIdStartsWith("SALES")} and ${orderIdStartsWith("SALES-KIOSK")}`;
    expect(groupTagMatchesRule(andRule, "SALES-KIOSK-1")).toBe(true);
    expect(groupTagMatchesRule(andRule, "SALES-DESK")).toBe(false); // fails the KIOSK clause

    const orRule = `${orderIdEq("KIOSK")} or ${orderIdEq("DESK")}`;
    expect(groupTagMatchesRule(orRule, "DESK")).toBe(true);
    expect(groupTagMatchesRule(orRule, "OTHER")).toBe(false);
  });

  it("does not match when no group tag is provided", () => {
    expect(groupTagMatchesRule(orderIdEq("SALES-KIOSK"), "")).toBe(false);
    expect(groupTagMatchesRule(orderIdEq("SALES-KIOSK"), "   ")).toBe(false);
  });
});

describe("isAutopilotJoinedRule", () => {
  it("matches the bare [ZTDId] startsWith rule", () => {
    expect(isAutopilotJoinedRule(ztdId)).toBe(true);
    expect(isAutopilotJoinedRule('(device.devicePhysicalIds -any (_ -startsWith "[ZTDId]"))')).toBe(true);
  });

  // The common real-tenant shape: a ZTDId branch OR'd with something else. Any
  // satisfied branch grants membership, and every Autopilot device satisfies the
  // ZTDId branch -- so these must be selected too.
  it("matches when the [ZTDId] clause is one branch of an `or`", () => {
    expect(isAutopilotJoinedRule(`${ztdId} or ${orderIdStartsWith("SALES")}`)).toBe(true);
    expect(isAutopilotJoinedRule(`${orderIdStartsWith("SALES")} or ${ztdId}`)).toBe(true);
    expect(isAutopilotJoinedRule(`${ztdId} or (device.deviceOSType -eq "Windows")`)).toBe(true);
    // three-way or, ZTDId in the middle
    expect(
      isAutopilotJoinedRule(`${orderIdEq("A")} or ${ztdId} or ${orderIdStartsWith("B")}`)
    ).toBe(true);
  });

  it("accepts the paren-less and -contains clause shapes tenants write", () => {
    expect(isAutopilotJoinedRule('(device.devicePhysicalIds -any _ -startsWith "[ZTDId]")')).toBe(true);
    expect(isAutopilotJoinedRule('(device.devicePhysicalIds -any (_ -contains "[ZTDId]"))')).toBe(true);
  });

  // `and` binds tighter than `or`, so an `and` chain OR'd with a ZTDId clause
  // still guarantees membership via the ZTDId branch. Real rule from a tenant.
  it("matches when an `and` chain is OR'd with the [ZTDId] clause (precedence)", () => {
    const real =
      '(device.deviceOwnership -eq "Company") and (device.deviceTrustType -eq "AzureAD") and ' +
      '(device.deviceManagementAppId -contains "0000") and (device.deviceOSType -eq "Windows") or ' +
      '(device.devicePhysicalIDs -any (_ -contains "[ZTDId]"))';
    expect(isAutopilotJoinedRule(real)).toBe(true);
  });

  it("stays conservative when the `and` is inside the ZTDId branch itself", () => {
    expect(isAutopilotJoinedRule(`${ztdId} and (device.deviceOSType -eq "Windows")`)).toBe(false);
    expect(isAutopilotJoinedRule(`${ztdId} and device.deviceOwnership -eq "Company"`)).toBe(false);
    // Real tenant rule: Autopilot devices *excluding* Cloud PCs — the extra
    // condition can't be evaluated, so it's left for manual selection.
    expect(
      isAutopilotJoinedRule(
        '(device.devicePhysicalIDs -any (_ -contains "[ZTDId]")) and (device.deviceModel -not -startsWith "Cloud PC")'
      )
    ).toBe(false);
  });

  it("does not split on an `or` nested inside parentheses", () => {
    // (A or ZTDId) and (B) -> membership still depends on B, so no match.
    expect(
      isAutopilotJoinedRule(
        `((device.deviceOSType -eq "Windows") or (device.devicePhysicalIDs -any (_ -contains "[ZTDId]"))) and (device.deviceOwnership -eq "Company")`
      )
    ).toBe(false);
  });

  it("does not treat an `and` inside a quoted Group Tag as a boolean operator", () => {
    expect(isAutopilotJoinedRule(`${ztdId} or ${orderIdEq("Sales and Marketing")}`)).toBe(true);
  });

  it("rejects a [ZTDId] pinned to one specific device, and non-Autopilot rules", () => {
    expect(
      isAutopilotJoinedRule('(device.devicePhysicalIds -any (_ -eq "[ZTDId]:1234-5678"))')
    ).toBe(false);
    expect(isAutopilotJoinedRule(orderIdStartsWith("SALES"))).toBe(false);
    expect(isAutopilotJoinedRule(undefined)).toBe(false);
  });
});
