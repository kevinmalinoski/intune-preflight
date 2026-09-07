import { describe, expect, it } from "vitest";
import {
  classifyAutopilotMatch,
  classifyGroupTagMatch,
  filterExclusionReason,
  groupTagMatchesRule,
  groupTagScope,
  isAutopilotJoinedRule,
  isGroupTagRule,
} from "./index.js";

describe("groupTagScope (inline tag display)", () => {
  it("shows a startsWith prefix with a * and an eq value verbatim", () => {
    expect(groupTagScope('(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:KIOSK"))')).toBe("KIOSK*");
    expect(groupTagScope('(device.devicePhysicalIds -any (_ -eq "[OrderID]:KIOSK-01"))')).toBe("KIOSK-01");
  });

  it("returns undefined when there's no OrderID clause", () => {
    expect(groupTagScope('(device.devicePhysicalIDs -any (_ -startsWith "[ZTDId]"))')).toBeUndefined();
    expect(groupTagScope(undefined)).toBeUndefined();
  });
});

describe("classifyGroupTagMatch (Group Tag in the picker)", () => {
  const rule = (r: string) => r;
  const orderId = rule('(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:SALES-KIOSK"))');

  it("confidently matches a flat OrderID rule the tag satisfies", () => {
    const m = classifyGroupTagMatch(orderId, "SALES-KIOSK-01");
    expect(m.state).toBe("match");
    expect(m.fullyEvaluated).toBe(true);
  });

  it("returns none when the tag doesn't satisfy any OrderID clause", () => {
    expect(classifyGroupTagMatch(orderId, "FINANCE-01").state).toBe("none");
    expect(classifyGroupTagMatch(undefined, "SALES").state).toBe("none");
    expect(classifyGroupTagMatch(orderId, "  ").state).toBe("none");
  });

  it("flags a match that also hinges on a property we can't evaluate (not fully evaluated)", () => {
    // The OrderID clause matches, but the rule also requires deviceOSType -> best-effort.
    const combined = rule(
      '(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:SALES-KIOSK")) and (device.deviceOSType -eq "Windows")'
    );
    const m = classifyGroupTagMatch(combined, "SALES-KIOSK-01");
    expect(m.state).toBe("match"); // OrderID satisfied (the flat evaluator ignores deviceOSType)
    expect(m.fullyEvaluated).toBe(false); // ...but it wasn't fully evaluated -> surface the rule
  });

  it("marks a satisfied OrderID clause the flat evaluator can't confirm as conditional", () => {
    // Two ANDed OrderID tags: the tag satisfies one but not the other -> not a confident match,
    // yet the tag IS referenced, so it's worth surfacing.
    const twoTags = rule(
      '(device.devicePhysicalIds -any (_ -eq "[OrderID]:SALES-KIOSK-01")) and (device.devicePhysicalIds -any (_ -eq "[OrderID]:OTHER"))'
    );
    const m = classifyGroupTagMatch(twoTags, "SALES-KIOSK-01");
    expect(m.state).toBe("conditional");
  });
});

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

describe("classifyAutopilotMatch (Autopilot in the picker)", () => {
  it("reports a clean bare [ZTDId] rule as a confident match (auto-selected)", () => {
    expect(classifyAutopilotMatch(ztdId).state).toBe("match");
    expect(
      classifyAutopilotMatch('(device.devicePhysicalIds -any (_ -contains "[ZTDId]"))').state
    ).toBe("match");
    // [ZTDId] as one branch of an `or` still grants membership on its own.
    expect(classifyAutopilotMatch(`${ztdId} or ${orderIdStartsWith("SALES")}`).state).toBe("match");
  });

  it("reports [ZTDId] ANDed with a device condition as conditional (surface, opt-in)", () => {
    // The real tenant rule that motivated this: Autopilot devices excluding Cloud PCs.
    expect(
      classifyAutopilotMatch(
        '(device.devicePhysicalIDs -any (_ -contains "[ZTDId]")) and (device.deviceModel -not -startsWith "Cloud PC")'
      ).state
    ).toBe("conditional");
    expect(classifyAutopilotMatch(`${ztdId} and (device.deviceOSType -eq "Windows")`).state).toBe(
      "conditional"
    );
  });

  it("reports no [ZTDId] marker as none", () => {
    expect(classifyAutopilotMatch(orderIdStartsWith("SALES")).state).toBe("none");
    expect(classifyAutopilotMatch('(device.deviceOSType -eq "Windows")').state).toBe("none");
    // A [ZTDId] pinned to one specific device is not the "any Autopilot device" marker.
    expect(
      classifyAutopilotMatch('(device.devicePhysicalIds -any (_ -eq "[ZTDId]:1234-5678"))').state
    ).toBe("none");
    expect(classifyAutopilotMatch(undefined).state).toBe("none");
  });
});
