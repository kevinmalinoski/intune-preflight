import { describe, expect, it } from "vitest";
import type { GroupSummary, Platform, UnassignedPolicy } from "@intune-preflight/shared";
import { deviceReducer, initialDeviceState, type DeviceAction, type DeviceState } from "./endpointDevice.ts";

const group = (id: string, over: Partial<GroupSummary> = {}): GroupSummary => ({
  id,
  displayName: id,
  policyCount: 1,
  settingsCount: 1,
  conflictCount: 0,
  platforms: ["windows"],
  ...over,
});

/** A dynamic group whose rule a device carrying `tag` would match. */
const tagGroup = (id: string, tag: string, over: Partial<GroupSummary> = {}) =>
  group(id, {
    isDynamic: true,
    membershipRule: `(device.devicePhysicalIds -any (_ -eq "[OrderID]:${tag}"))`,
    ...over,
  });

/** A default Autopilot-joined dynamic group (bare [ZTDId] clause). */
const autopilotGroup = (id: string, over: Partial<GroupSummary> = {}) =>
  group(id, {
    isDynamic: true,
    membershipRule: `(device.devicePhysicalIds -any (_ -startsWith "[ZTDId]"))`,
    ...over,
  });

const unassigned = (id: string, platform: UnassignedPolicy["platform"] = "windows"): UnassignedPolicy => ({
  id,
  kind: "deviceConfiguration",
  displayName: id,
  platform,
  settingsCount: 1,
});

const run = (state: DeviceState, ...actions: DeviceAction[]) => actions.reduce(deviceReducer, state);

type Handoff = { groupIds: string[]; platform: Platform; filterIds: string[] };

/** A configured device with its catalogs loaded -- optionally seeded from a Manifest handoff. */
const loaded = (groups: GroupSummary[], policies: UnassignedPolicy[] = [], handoff?: Handoff) =>
  deviceReducer(initialDeviceState(handoff), {
    type: "catalogLoaded",
    groups,
    unassignedPolicies: policies,
  });

describe("deviceReducer — Group Tag selection", () => {
  it("selects every group a tagged device would belong to", () => {
    const state = run(loaded([tagGroup("eq", "SALES-KIOSK-VM"), tagGroup("other", "HR"), group("static")]), {
      type: "setGroupTag",
      groupTag: "SALES-KIOSK-VM",
    });
    expect(state.selectedGroupIds).toEqual(["eq"]);
  });

  it("matches -startsWith and -eq rules together, as Entra would", () => {
    const prefix = group("prefix", {
      isDynamic: true,
      membershipRule: `(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:SALES-KIOSK"))`,
    });
    const state = run(loaded([prefix, tagGroup("exact", "SALES-KIOSK-VM")]), {
      type: "setGroupTag",
      groupTag: "SALES-KIOSK-VM",
    });
    expect(state.selectedGroupIds.sort()).toEqual(["exact", "prefix"]);
  });

  it("drops Group Tag groups the tag no longer matches, keeping hand-picked ones", () => {
    const state = run(
      loaded([tagGroup("sales", "SALES"), tagGroup("hr", "HR"), group("static")]),
      { type: "toggleGroup", id: "static" },
      { type: "setGroupTag", groupTag: "SALES" },
      { type: "setGroupTag", groupTag: "HR" }
    );
    expect(state.selectedGroupIds).toContain("static"); // no Group Tag rule -- untouched
    expect(state.selectedGroupIds).toContain("hr");
    expect(state.selectedGroupIds).not.toContain("sales");
  });

  it("does not re-add a matched group the user then unchecked", () => {
    // The rule runs on the actions that can change the answer, never as a
    // continuously-applied invariant -- otherwise unchecking would snap back.
    const state = run(
      loaded([tagGroup("sales", "SALES")]),
      { type: "setGroupTag", groupTag: "SALES" },
      { type: "toggleGroup", id: "sales" }
    );
    expect(state.selectedGroupIds).toEqual([]);
  });
});

describe("deviceReducer — Autopilot toggle", () => {
  it("adds Autopilot-joined groups when turned on", () => {
    const state = run(loaded([autopilotGroup("ap"), group("static")]), { type: "toggleAutopilotDevice" });
    expect(state.isAutopilotDevice).toBe(true);
    expect(state.selectedGroupIds).toEqual(["ap"]);
  });

  it("turning it off clears the tag and the groups those rules selected", () => {
    const state = run(
      loaded([autopilotGroup("ap"), tagGroup("sales", "SALES"), group("static")]),
      { type: "toggleGroup", id: "static" },
      { type: "toggleAutopilotDevice" },
      { type: "setGroupTag", groupTag: "SALES" },
      { type: "toggleAutopilotDevice" }
    );
    expect(state.isAutopilotDevice).toBe(false);
    expect(state.groupTag).toBe("");
    expect(state.selectedGroupIds).toEqual(["static"]);
  });

  it("REGRESSION: an Autopilot-joined group selected by hand survives while the toggle is off", () => {
    // Shipped bug: the Autopilot effect ran as an invariant and stripped
    // Autopilot-joined groups whenever the toggle was off -- silently dropping a
    // group the user had picked directly, or that the Manifest handed off.
    const state = run(loaded([autopilotGroup("ap")]), { type: "toggleGroup", id: "ap" });
    expect(state.isAutopilotDevice).toBe(false);
    expect(state.selectedGroupIds).toEqual(["ap"]);
  });

  it("REGRESSION: an Autopilot-joined group handed off from the Manifest survives the catalog load", () => {
    const state = loaded([autopilotGroup("ap")], [], {
      groupIds: ["ap"],
      platform: "windows",
      filterIds: [],
    });
    expect(state.selectedGroupIds).toEqual(["ap"]);
  });
});

describe("deviceReducer — platform rules", () => {
  it("clears device filters on a real OS switch", () => {
    const state = run(
      loaded([group("mac", { platforms: ["macos"] })]),
      { type: "toggleDeviceFilter", id: "f1" },
      { type: "setPlatform", platform: "macos" }
    );
    expect(state.deviceFilterIds).toEqual([]);
  });

  it("REGRESSION: filters seeded by a Manifest handoff survive, with no OS switch to clear them", () => {
    // Shipped bug: a "skip first mount" flag guarded the clear-on-platform-change
    // effect, and StrictMode's double-invoked mount effect got past it and wiped
    // the handoff's filters. Seeded state is now just initial state -- there is no
    // effect to double-invoke.
    const state = loaded([group("g1")], [], {
      groupIds: ["g1"],
      platform: "windows",
      filterIds: ["f1", "f2"],
    });
    expect(state.deviceFilterIds).toEqual(["f1", "f2"]);
    expect(state.selectedGroupIds).toEqual(["g1"]);
  });

  it("re-selecting the same OS changes nothing (so filters are not clobbered)", () => {
    const before = run(loaded([group("g1")]), { type: "toggleDeviceFilter", id: "f1" });
    const after = deviceReducer(before, { type: "setPlatform", platform: "windows" });
    expect(after).toBe(before);
  });

  it("turns Autopilot and the Group Tag off when the OS is not Windows", () => {
    const state = run(
      loaded([autopilotGroup("ap"), tagGroup("sales", "SALES"), group("mac", { platforms: ["macos"] })]),
      { type: "toggleAutopilotDevice" },
      { type: "setGroupTag", groupTag: "SALES" },
      { type: "setPlatform", platform: "macos" }
    );
    expect(state.isAutopilotDevice).toBe(false);
    expect(state.groupTag).toBe("");
    // The Windows-only groups carry no macOS policy, so they leave the selection.
    expect(state.selectedGroupIds).toEqual([]);
  });

  it("drops selected groups with no policy for the new OS, keeping cross-platform ones", () => {
    const state = run(
      loaded([group("both", { platforms: ["windows", "macos"] }), group("winOnly")]),
      { type: "toggleGroup", id: "both" },
      { type: "toggleGroup", id: "winOnly" },
      { type: "setPlatform", platform: "macos" }
    );
    expect(state.selectedGroupIds).toEqual(["both"]);
  });

  it("keeps a handed-off group the catalog has not loaded yet", () => {
    // The catalog arrives asynchronously; an unknown id must not be assumed
    // off-platform and silently dropped before it lands.
    const seeded = initialDeviceState({ groupIds: ["not-loaded-yet"], platform: "windows", filterIds: [] });
    expect(deviceReducer(seeded, { type: "toggleGroup", id: "x" }).selectedGroupIds).toContain("not-loaded-yet");
  });
});

describe("deviceReducer — policy waitlist", () => {
  it("drops waitlisted policies that don't match the new OS", () => {
    const base = loaded(
      [group("both", { platforms: ["windows", "macos"] })],
      [unassigned("win"), unassigned("mac", "macos")]
    );
    const onWindows = deviceReducer(base, { type: "selectUnassignedPolicies", ids: ["win"] });
    expect(onWindows.unassignedPolicyIds).toEqual(["win"]);
    // Switching OS drops it -- it can't apply to a macOS device.
    const onMac = deviceReducer(onWindows, { type: "setPlatform", platform: "macos" });
    expect(onMac.unassignedPolicyIds).toEqual([]);
    // ...and the macOS one is selectable there.
    expect(deviceReducer(onMac, { type: "selectUnassignedPolicies", ids: ["mac"] }).unassignedPolicyIds).toEqual([
      "mac",
    ]);
  });

  it("refuses a waitlisted policy that isn't for the current OS", () => {
    // The picker only offers current-OS policies, so this is a guard rather than
    // a reachable flow -- but it keeps "waitlist matches the simulated OS" true
    // by construction rather than by the UI remembering to filter.
    const state = deviceReducer(loaded([group("g1")], [unassigned("mac", "macos")]), {
      type: "toggleUnassignedPolicy",
      id: "mac",
    });
    expect(state.unassignedPolicyIds).toEqual([]);
  });

  it("toggles and bulk-deselects without duplicating ids", () => {
    const state = run(
      loaded([group("g1")], [unassigned("a"), unassigned("b")]),
      { type: "toggleUnassignedPolicy", id: "a" },
      { type: "selectUnassignedPolicies", ids: ["a", "b"] },
      { type: "deselectUnassignedPolicies", ids: ["a"] }
    );
    expect(state.unassignedPolicyIds).toEqual(["b"]);
  });
});

describe("deviceReducer — refresh that keeps the setup", () => {
  const reloaded = (groups: GroupSummary[], policies: UnassignedPolicy[] = [], filterIds: string[] = []) =>
    ({ type: "catalogReloaded", groups, unassignedPolicies: policies, filterIds }) as const;

  it("keeps the endpoint as it was when everything still exists", () => {
    const before = run(
      loaded([group("g1"), group("g2")], [unassigned("p")]),
      { type: "toggleGroup", id: "g1" },
      { type: "toggleDeviceFilter", id: "f1" },
      { type: "toggleUnassignedPolicy", id: "p" }
    );
    const after = deviceReducer(before, reloaded([group("g1"), group("g2")], [unassigned("p")], ["f1"]));
    expect(after.selectedGroupIds).toEqual(["g1"]);
    expect(after.deviceFilterIds).toEqual(["f1"]);
    expect(after.unassignedPolicyIds).toEqual(["p"]);
    expect(after.platform).toBe("windows");
  });

  it("drops a group and a filter that were deleted in Intune", () => {
    const before = run(
      loaded([group("g1"), group("gone")]),
      { type: "toggleGroup", id: "g1" },
      { type: "toggleGroup", id: "gone" },
      { type: "toggleDeviceFilter", id: "f1" },
      { type: "toggleDeviceFilter", id: "deleted" }
    );
    const after = deviceReducer(before, reloaded([group("g1")], [], ["f1"]));
    expect(after.selectedGroupIds).toEqual(["g1"]);
    expect(after.deviceFilterIds).toEqual(["f1"]);
  });

  it("takes a waitlisted policy off the waitlist once it has been assigned", () => {
    const before = run(loaded([group("g1")], [unassigned("p"), unassigned("q")]), {
      type: "selectUnassignedPolicies",
      ids: ["p", "q"],
    });
    // `p` was assigned in the admin center, so it is no longer unassigned.
    const after = deviceReducer(before, reloaded([group("g1")], [unassigned("q")]));
    expect(after.unassignedPolicyIds).toEqual(["q"]);
  });

  it("drops a group that no longer carries a policy for this OS", () => {
    const before = run(loaded([group("g1"), group("g2")]), { type: "toggleGroup", id: "g2" });
    const after = deviceReducer(before, reloaded([group("g1"), group("g2", { platforms: ["macos"] })]));
    expect(after.selectedGroupIds).toEqual([]);
  });

  it("keeps the Group Tag and Autopilot settings, re-resolving them against the new groups", () => {
    const before = run(
      loaded([tagGroup("t1", "KIOSK"), autopilotGroup("ap")]),
      { type: "toggleAutopilotDevice" },
      { type: "setGroupTag", groupTag: "KIOSK" }
    );
    expect(before.selectedGroupIds.sort()).toEqual(["ap", "t1"]);
    // A second group with the same tag rule was created in Entra.
    const after = deviceReducer(
      before,
      reloaded([tagGroup("t1", "KIOSK"), tagGroup("t2", "KIOSK"), autopilotGroup("ap")])
    );
    expect(after.isAutopilotDevice).toBe(true);
    expect(after.groupTag).toBe("KIOSK");
    expect(after.selectedGroupIds.sort()).toEqual(["ap", "t1", "t2"]);
  });
});

describe("deviceReducer — nested groups", () => {
  // `child` sits inside `parent`, which sits inside `grand` (the loader flattens
  // parentGroupIds to every depth). `other` is an unrelated child of `parent`.
  const nested = () => [
    group("grand"),
    group("parent", { parentGroupIds: ["grand"] }),
    group("child", { parentGroupIds: ["grand", "parent"] }),
    group("other", { parentGroupIds: ["parent"] }),
  ];

  it("selects every group a ticked group is nested in, marked as nested", () => {
    const state = run(loaded(nested()), { type: "toggleGroup", id: "child" });
    expect(state.selectedGroupIds.sort()).toEqual(["child", "grand", "parent"]);
    expect(state.nestedAutoIds.sort()).toEqual(["grand", "parent"]);
  });

  it("lets a nested parent be unticked, and later actions do not put it back", () => {
    const state = run(
      loaded(nested()),
      { type: "toggleGroup", id: "child" },
      { type: "toggleGroup", id: "parent" },
      { type: "toggleAutopilotDevice" },
      { type: "setGroupTag", groupTag: "ANY" }
    );
    expect(state.selectedGroupIds.sort()).toEqual(["child", "grand"]);
  });

  it("drops nested parents once nothing selected puts the device in them", () => {
    const state = run(loaded(nested()), { type: "toggleGroup", id: "child" }, { type: "toggleGroup", id: "child" });
    expect(state.selectedGroupIds).toEqual([]);
    expect(state.nestedAutoIds).toEqual([]);
  });

  it("keeps a nested parent while another selected child still implies it", () => {
    const state = run(
      loaded(nested()),
      { type: "toggleGroup", id: "child" },
      { type: "toggleGroup", id: "other" },
      { type: "toggleGroup", id: "child" }
    );
    expect(state.selectedGroupIds.sort()).toEqual(["other", "parent"]);
  });

  it("never drops a parent the admin ticked themselves", () => {
    const state = run(
      loaded(nested()),
      { type: "toggleGroup", id: "parent" },
      { type: "toggleGroup", id: "child" },
      { type: "toggleGroup", id: "child" }
    );
    // `grand` stays too: the device is in `parent`, which is inside it.
    expect(state.selectedGroupIds.sort()).toEqual(["grand", "parent"]);
    expect(state.nestedAutoIds).toEqual(["grand"]);
  });

  it("brings the parents of an Autopilot group the checkbox selects", () => {
    const state = run(
      loaded([group("all-kiosks"), autopilotGroup("ap", { parentGroupIds: ["all-kiosks"], nestedOnly: true })]),
      { type: "toggleAutopilotDevice" }
    );
    expect(state.selectedGroupIds.sort()).toEqual(["all-kiosks", "ap"]);
    const off = deviceReducer(state, { type: "toggleAutopilotDevice" });
    expect(off.selectedGroupIds).toEqual([]);
  });

  it("expands a Manifest handoff once the catalog says what it is nested in", () => {
    const state = loaded(nested(), [], { groupIds: ["child"], platform: "windows", filterIds: [] });
    expect(state.selectedGroupIds.sort()).toEqual(["child", "grand", "parent"]);
  });

  it("does not re-add an unticked parent on a refresh that keeps the setup", () => {
    const before = run(loaded(nested()), { type: "toggleGroup", id: "child" }, { type: "toggleGroup", id: "parent" });
    const after = deviceReducer(before, {
      type: "catalogReloaded",
      groups: nested(),
      unassignedPolicies: [],
      filterIds: [],
    });
    expect(after.selectedGroupIds.sort()).toEqual(["child", "grand"]);
  });
});

describe("deviceReducer — start from a real device", () => {
  it("takes the device's OS, Autopilot facts and the groups the catalog knows", () => {
    const before = run(loaded([group("g1"), group("g2"), group("mac", { platforms: ["macos"] })]), {
      type: "toggleDeviceFilter",
      id: "f1",
    });
    const state = deviceReducer(before, {
      type: "applyRealDevice",
      platform: "windows",
      groupIds: ["g2", "unassigned-elsewhere", "mac"],
      isAutopilot: true,
      groupTag: "KIOSK",
    });
    expect(state.selectedGroupIds).toEqual(["g2"]);
    expect(state.isAutopilotDevice).toBe(true);
    expect(state.groupTag).toBe("KIOSK");
    expect(state.deviceFilterIds).toEqual([]);
    expect(state.nestedAutoIds).toEqual([]);
  });

  it("keeps Autopilot off for a device that is not Windows", () => {
    const state = deviceReducer(loaded([group("m", { platforms: ["macos"] })]), {
      type: "applyRealDevice",
      platform: "macos",
      groupIds: ["m"],
      isAutopilot: true,
      groupTag: "X",
    });
    expect(state.platform).toBe("macos");
    expect(state.isAutopilotDevice).toBe(false);
    expect(state.groupTag).toBe("");
    expect(state.selectedGroupIds).toEqual(["m"]);
  });
});

describe("deviceReducer — Group Tag groups the tag cannot settle", () => {
  it("does not auto-select a tag match ANDed with a property it cannot check", () => {
    const state = run(
      loaded([
        tagGroup("plain", "PREFLIGHT-A"),
        group("versioned", {
          isDynamic: true,
          membershipRule:
            '(device.devicePhysicalIds -any (_ -eq "[OrderID]:PREFLIGHT-A")) and (device.deviceOSVersion -startsWith "26")',
        }),
        group("either", {
          isDynamic: true,
          membershipRule:
            '(device.devicePhysicalIds -any (_ -eq "[OrderID]:PREFLIGHT-A")) or (device.deviceModel -eq "Virtual Machine")',
        }),
      ]),
      { type: "toggleAutopilotDevice" },
      { type: "setGroupTag", groupTag: "PREFLIGHT-A" }
    );
    expect(state.selectedGroupIds.sort()).toEqual(["either", "plain"]);
  });

  it("keeps an undecidable tag group the admin ticked, and drops it once the tag rules it out", () => {
    const versioned = group("versioned", {
      isDynamic: true,
      membershipRule:
        '(device.devicePhysicalIds -any (_ -eq "[OrderID]:PREFLIGHT-A")) and (device.deviceOSVersion -startsWith "26")',
    });
    const ticked = run(
      loaded([versioned]),
      { type: "toggleAutopilotDevice" },
      { type: "setGroupTag", groupTag: "PREFLIGHT-A" },
      { type: "toggleGroup", id: "versioned" },
      { type: "setGroupTag", groupTag: "PREFLIGHT-A " }
    );
    expect(ticked.selectedGroupIds).toEqual(["versioned"]);
    expect(deviceReducer(ticked, { type: "setGroupTag", groupTag: "OTHER" }).selectedGroupIds).toEqual([]);
  });
});
