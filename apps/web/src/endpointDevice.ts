import { isAutopilotJoinedRule, isGroupTagRule, judgeMembershipRule } from "@intune-preflight/shared";
import type { GroupSummary, Platform, UnassignedPolicy } from "@intune-preflight/shared";

/**
 * The simulated endpoint's definition, and the rules for changing it.
 *
 * This used to be six `useState`s in EndpointSimulator with a chain of
 * `useEffect`s reacting to each other -- one watching `platform` to clear
 * filters, one clearing Autopilot off Windows, one auto-selecting Group Tag
 * groups, one adding Autopilot-joined groups, and so on. Every rule was
 * expressed as "after a render where X changed, also change Y", which made the
 * ORDER of those corrections part of the behaviour and produced two real bugs:
 * React StrictMode's double-invoked mount effect wiped the device filters seeded
 * from a Manifest handoff, and the Autopilot effect silently stripped groups the
 * user had deliberately selected.
 *
 * As a reducer each rule instead belongs to the action that triggers it, and is
 * computed in one synchronous step. Two things stay carefully distinct, because
 * conflating them is what caused both bugs:
 *
 *  - **Invariants** (`applyInvariants`) hold after EVERY action -- e.g. Autopilot
 *    is Windows-only, and a selected group must still be relevant to the
 *    selected OS. Safe to re-apply at any time.
 *  - **Action effects** happen only on the specific action -- e.g. switching OS
 *    clears the device filters, and turning Autopilot OFF drops the groups it
 *    auto-selected. These must NOT become invariants: re-applying them
 *    continuously would fight the user (re-adding a group they just unchecked)
 *    or the Manifest handoff (clearing filters it seeded).
 *
 * It's a plain function of state + action, so it's unit-tested directly in
 * endpointDevice.test.ts -- the effect cascade never could be.
 */
export interface DeviceState {
  /** The group + unassigned-policy catalogs the rules below resolve against. Empty until loaded. */
  groups: GroupSummary[];
  unassignedPolicies: UnassignedPolicy[];
  platform: Platform;
  selectedGroupIds: string[];
  deviceFilterIds: string[];
  unassignedPolicyIds: string[];
  isAutopilotDevice: boolean;
  groupTag: string;
  /**
   * Selected groups that are selected only because a group nested inside them
   * is: the device is in the child, so it is in the parent. Tracked so they can
   * go again when nothing selected still puts the device in them -- and so that
   * unticking one sticks, because that is the admin overriding it.
   */
  nestedAutoIds: string[];
}

export type DeviceAction =
  /** The group / unassigned-policy lists arrived; re-resolve anything that depends on them. */
  | { type: "catalogLoaded"; groups: GroupSummary[]; unassignedPolicies: UnassignedPolicy[] }
  /**
   * The tenant was re-read with the endpoint kept as it is. Like `catalogLoaded`,
   * plus dropping whatever no longer exists: a deleted group or filter, and a
   * waitlisted policy that has since been assigned (it now arrives through its
   * assignment instead, or not at all).
   */
  | {
      type: "catalogReloaded";
      groups: GroupSummary[];
      unassignedPolicies: UnassignedPolicy[];
      filterIds: string[];
    }
  /**
   * Start from a real device: its OS, its Autopilot facts and the groups it is
   * actually in. Group ids the catalog does not have are dropped -- nothing is
   * assigned to them. Transitive membership already includes every parent, so
   * nothing is inferred on top of it.
   */
  | {
      type: "applyRealDevice";
      platform?: Platform;
      groupIds: string[];
      isAutopilot: boolean;
      groupTag?: string;
      /** Assignment Filters Intune says the device matches. */
      filterIds?: string[];
    }
  | { type: "setPlatform"; platform: Platform }
  | { type: "toggleGroup"; id: string }
  | { type: "setGroupTag"; groupTag: string }
  | { type: "toggleAutopilotDevice" }
  | { type: "toggleDeviceFilter"; id: string }
  | { type: "toggleUnassignedPolicy"; id: string }
  | { type: "selectUnassignedPolicies"; ids: string[] }
  | { type: "deselectUnassignedPolicies"; ids: string[] };

/** Seed state, optionally from a Manifest "simulate these groups" handoff. */
export function initialDeviceState(
  handoff?: {
    groupIds: string[];
    platform: Platform;
    filterIds: string[];
  } | null
): DeviceState {
  return {
    groups: [],
    unassignedPolicies: [],
    platform: handoff?.platform ?? "windows",
    selectedGroupIds: handoff?.groupIds ?? [],
    deviceFilterIds: handoff?.filterIds ?? [],
    unassignedPolicyIds: [],
    isAutopilotDevice: false,
    groupTag: "",
    nestedAutoIds: [],
  };
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

const union = (list: string[], add: string[]) => {
  const merged = [...list];
  for (const id of add) if (!merged.includes(id)) merged.push(id);
  return merged;
};

/**
 * Rules that must hold after every action, regardless of what caused it.
 * Each one only ever DROPS something that the new state makes impossible, so
 * re-applying it can never fight a deliberate selection.
 */
function applyInvariants(state: DeviceState): DeviceState {
  let next = state;

  // Autopilot (and therefore a Group Tag) is Windows-only.
  if (next.platform !== "windows" && (next.isAutopilotDevice || next.groupTag)) {
    next = { ...next, isAutopilotDevice: false, groupTag: "" };
  }

  // A selected group the catalog says carries no policy for this OS is not part
  // of this device. Groups the catalog doesn't know yet are left alone -- the
  // catalog loads asynchronously and a handoff can name a group before it lands.
  const onPlatform = next.selectedGroupIds.filter((id) => {
    const group = next.groups.find((g) => g.id === id);
    return !group || group.platforms.includes(next.platform);
  });
  if (onPlatform.length !== next.selectedGroupIds.length) {
    next = { ...next, selectedGroupIds: onPlatform };
  }

  // Waitlisted policies are OS-specific too.
  const onPlatformPolicies = next.unassignedPolicyIds.filter(
    (id) => next.unassignedPolicies.find((p) => p.id === id)?.platform === next.platform
  );
  if (onPlatformPolicies.length !== next.unassignedPolicyIds.length) {
    next = { ...next, unassignedPolicyIds: onPlatformPolicies };
  }

  // Only selected groups can be selected-because-nested.
  const auto = next.nestedAutoIds.filter((id) => next.selectedGroupIds.includes(id));
  if (auto.length !== next.nestedAutoIds.length) next = { ...next, nestedAutoIds: auto };

  return next;
}

/** The catalog groups `id` sits inside -- already flattened to every depth by the loader. */
const parentsOf = (state: DeviceState, id: string) => state.groups.find((g) => g.id === id)?.parentGroupIds ?? [];

/**
 * Nesting, in two steps. Every group in `added` brings the groups it is nested
 * in, marked as selected-because-nested. Then any of those that nothing
 * selected in its own right still sits inside is dropped -- the child that put
 * it there was unticked, or its Group Tag no longer matches.
 *
 * Only groups just ADDED expand. Re-expanding everything on every action would
 * put back a parent the admin had deliberately unticked to see the device
 * without it, which is the override this exists to allow.
 */
function settleNesting(state: DeviceState, added: string[]): DeviceState {
  let selected = state.selectedGroupIds;
  let auto = state.nestedAutoIds;
  for (const id of added) {
    for (const parent of parentsOf(state, id)) {
      if (!selected.includes(parent)) {
        selected = [...selected, parent];
        auto = [...auto, parent];
      }
    }
  }
  const implied = new Set(selected.filter((id) => !auto.includes(id)).flatMap((id) => parentsOf(state, id)));
  const drop = auto.filter((id) => !implied.has(id));
  if (drop.length > 0) {
    selected = selected.filter((id) => !drop.includes(id));
    auto = auto.filter((id) => !drop.includes(id));
  }
  return selected === state.selectedGroupIds && auto === state.nestedAutoIds
    ? state
    : { ...state, selectedGroupIds: selected, nestedAutoIds: auto };
}

/**
 * The common tail of every action that can change which groups are selected:
 * expand what was added, apply the invariants, then drop nesting they orphaned.
 */
function finish(prev: DeviceState, next: DeviceState): DeviceState {
  const added = next.selectedGroupIds.filter((id) => !prev.selectedGroupIds.includes(id));
  return settleNesting(applyInvariants(settleNesting(next, added)), []);
}

/**
 * Re-resolve the groups a Group Tag and/or Autopilot membership implies.
 *
 * A Group Tag drives selection directly: every group a device carrying that tag
 * would be a member of (by its `[OrderID]` clauses -- `-eq`, `-startsWith`, and
 * or/and combinations) is selected. A device tagged "SALES-KIOSK-VM" belongs to
 * both a startsWith "SALES-KIOSK" group and an -eq "SALES-KIOSK-VM" group, so
 * both get selected; Group Tag groups the tag no longer matches are dropped,
 * and groups with no Group Tag rule are untouched. "Autopilot device" likewise
 * adds every default Autopilot-joined group (a bare `[ZTDId]` startsWith rule).
 *
 * Only ever called from the actions that can change the answer -- NOT as an
 * invariant: re-running it on every action would re-add a matched group the user
 * had just unchecked.
 */
function resolveImpliedGroups(state: DeviceState): DeviceState {
  const tag = state.groupTag.trim();
  let selected = state.selectedGroupIds;

  if (tag) {
    // Judged three-valued (judgeMembershipRule): a group is added only when its
    // rule makes this device a member whatever its unmodelled parts say, and
    // dropped only when the rule rules it out. A tag match ANDed with, say, an
    // OS version is "unknown" -- left for the admin, never ticked on a guess.
    // A Group Tag only exists on an Autopilot registration, so one implies the other.
    const inputs = { platform: state.platform, isAutopilot: true, groupTag: tag };
    selected = selected.filter((id) => {
      const rule = state.groups.find((g) => g.id === id)?.membershipRule;
      return !isGroupTagRule(rule) || judgeMembershipRule(rule, inputs) !== "not-member";
    });
    selected = union(
      selected,
      state.groups
        .filter((g) => isGroupTagRule(g.membershipRule) && judgeMembershipRule(g.membershipRule, inputs) === "member")
        .map((g) => g.id)
    );
  }

  if (state.isAutopilotDevice) {
    selected = union(
      selected,
      state.groups.filter((g) => isAutopilotJoinedRule(g.membershipRule)).map((g) => g.id)
    );
  }

  return selected === state.selectedGroupIds ? state : { ...state, selectedGroupIds: selected };
}

export function deviceReducer(state: DeviceState, action: DeviceAction): DeviceState {
  switch (action.type) {
    case "catalogLoaded":
      // The catalogs are what the tag / Autopilot rules resolve against, so a
      // device configured before they landed is re-resolved against them now --
      // nesting included, which is why every selected group counts as added.
      return finish(
        { ...state, selectedGroupIds: [] },
        resolveImpliedGroups({
          ...state,
          groups: action.groups,
          unassignedPolicies: action.unassignedPolicies,
        })
      );

    case "catalogReloaded": {
      // Unlike the first load, nothing can legitimately name a group the
      // catalog hasn't seen yet -- the catalog IS the tenant now -- so an
      // unknown group is one that was deleted. Waitlist picks need no pruning
      // here: the invariant already drops any id the new catalog lacks.
      const groupIds = new Set(action.groups.map((g) => g.id));
      const filterIds = new Set(action.filterIds);
      return finish(
        state,
        resolveImpliedGroups({
          ...state,
          groups: action.groups,
          unassignedPolicies: action.unassignedPolicies,
          selectedGroupIds: state.selectedGroupIds.filter((id) => groupIds.has(id)),
          deviceFilterIds: state.deviceFilterIds.filter((id) => filterIds.has(id)),
        })
      );
    }

    case "applyRealDevice": {
      const known = new Set(state.groups.map((g) => g.id));
      const platform = action.platform ?? state.platform;
      const autopilot = platform === "windows" && action.isAutopilot;
      return applyInvariants({
        ...state,
        platform,
        isAutopilotDevice: autopilot,
        groupTag: autopilot ? (action.groupTag ?? "") : "",
        selectedGroupIds: [...new Set(action.groupIds)].filter((id) => known.has(id)),
        deviceFilterIds: [...new Set(action.filterIds ?? [])],
        nestedAutoIds: [],
      });
    }

    case "setPlatform": {
      if (action.platform === state.platform) return state;
      // Action effect: filters matched for one OS don't carry to another. This
      // fires ONLY on a real OS switch, which is why a handoff's seeded filters
      // survive -- they arrive as initial state, with no switch to clear them.
      return finish(state, resolveImpliedGroups({ ...state, platform: action.platform, deviceFilterIds: [] }));
    }

    case "toggleGroup":
      // Unticking a selected-because-nested group makes it the admin's choice:
      // it leaves the nested set, so nothing re-adds it until a child is ticked again.
      return finish(state, {
        ...state,
        selectedGroupIds: toggle(state.selectedGroupIds, action.id),
        nestedAutoIds: state.nestedAutoIds.filter((id) => id !== action.id),
      });

    case "setGroupTag":
      return finish(state, resolveImpliedGroups({ ...state, groupTag: action.groupTag }));

    case "toggleAutopilotDevice": {
      const nowOn = !state.isAutopilotDevice;
      if (nowOn) return finish(state, resolveImpliedGroups({ ...state, isAutopilotDevice: true }));
      // Action effect: turning it OFF makes this a non-Autopilot device, which
      // can carry no Group Tag and belong to no Autopilot-joined group -- so
      // drop what those rules selected. Deliberately not an invariant: as one it
      // would strip an Autopilot-joined group the user picked by hand (or the
      // Manifest handed off) merely because the toggle happens to be off.
      return finish(state, {
        ...state,
        isAutopilotDevice: false,
        groupTag: "",
        selectedGroupIds: state.selectedGroupIds.filter((id) => {
          const rule = state.groups.find((g) => g.id === id)?.membershipRule;
          return !isGroupTagRule(rule) && !isAutopilotJoinedRule(rule);
        }),
      });
    }

    case "toggleDeviceFilter":
      return { ...state, deviceFilterIds: toggle(state.deviceFilterIds, action.id) };

    case "toggleUnassignedPolicy":
      return applyInvariants({
        ...state,
        unassignedPolicyIds: toggle(state.unassignedPolicyIds, action.id),
      });

    case "selectUnassignedPolicies":
      return applyInvariants({
        ...state,
        unassignedPolicyIds: union(state.unassignedPolicyIds, action.ids),
      });

    case "deselectUnassignedPolicies": {
      const remove = new Set(action.ids);
      return { ...state, unassignedPolicyIds: state.unassignedPolicyIds.filter((id) => !remove.has(id)) };
    }
  }
}
