import type { Node, Edge } from "@xyflow/react";
import type { SimulationGroup, SimulationResult } from "@intune-preflight/shared";
import { filterExclusionReason } from "@intune-preflight/shared";
import type { BaselineScope } from "../SimulationBaselinePanel.tsx";
import type { StackProfile } from "./nodes.tsx";
import {
  AUTOPILOT_COLOR,
  GROUP_NODE_WIDTH,
  KIND_COLOR,
  KIND_LABEL,
  KIND_ORDER,
  LINE_HEIGHT,
  ROW_GAP,
  SOURCE_STYLE,
  STACK_WIDTH,
  TYPE_BUBBLE_CAP,
  TYPE_HEADER_HEIGHT,
  TYPE_LINE_HEIGHT,
  TYPE_PADDING,
  UNASSIGNED_EDGE,
  estimateRowHeight,
  type PolicyStatus,
} from "./theme.ts";

/**
 * Turns a simulation into the nodes and edges React Flow draws: the endpoint
 * stack on the left, the Entra groups in the middle, and either one bubble per
 * policy type or one node per policy on the right.
 *
 * This is the layout engine -- positions, column widths, row heights, which
 * edges exist and what colour they are. It is a pure function of the simulation
 * plus the current visibility state, which is what lets the component memoize
 * it and re-run it only when something it actually reads has changed.
 */

const COLUMN_GAP = 140;

// Build the graph for the current visibility state. Hidden groups stay in the
// group column as dimmed toggles (so they can be clicked back on), but the
// policy column is laid out from ONLY the visible policies -- so hiding a group
// collapses the gaps its policies leave behind instead of punching holes.
export function buildGraph(
  simulation: SimulationResult,
  deviceFilterNames: string[],
  hiddenGroupIds: Set<string>,
  settingsCount: Record<string, number>,
  grouped: boolean,
  expandedKinds: Set<string>,
  onToggleKind: (kind: string) => void,
  expandedAps: Set<string>,
  onToggleAp: (id: string) => void,
  /** The endpoint stack's measured height, so it can be centered exactly. */
  stackHeight: number,
  onHeight: (height: number) => void,
  onOpen?: (scope: BaselineScope) => void
) {
  const groupNames = simulation.groups.filter((g) => g.source === "selected").map((g) => g.displayName);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // --- Autopilot enrollment: the profiles this endpoint's VISIBLE groups reach ---
  // A profile belongs in the stack while at least one group that TARGETS it is
  // still shown; hiding that group takes the profile with it, the same way it
  // takes the policies it brings in. Exclusion is re-evaluated against the
  // visible groups too, so hiding the group that carves the device out flips the
  // card back to "Targeted" instead of leaving a stale exclusion notice behind.
  const visibleAps: StackProfile[] = (simulation.autopilotProfiles ?? [])
    .filter((ap) => ap.viaGroupIds.some((id) => !hiddenGroupIds.has(id)))
    .map((ap) => {
      const excludedViaGroupIds = ap.excludedViaGroupIds.filter((id) => !hiddenGroupIds.has(id));
      return {
        ...ap,
        status: excludedViaGroupIds.length > 0 ? ("excluded" as const) : ("targeted" as const),
        viaGroupIds: ap.viaGroupIds.filter((id) => !hiddenGroupIds.has(id)),
        excludedViaGroupIds,
        excludedNames: excludedViaGroupIds.map((id) => simulation.groups.find((g) => g.id === id)?.displayName ?? id),
      };
    });

  // --- Group column (all groups; hidden ones dimmed) ---
  // The always-applies buckets (All Devices, then All Users) sit at the top;
  // the specific selected/implied groups stack underneath them.
  // All Devices, All Users at the top; the synthetic "No assignment" bucket last.
  const groupRank = (g: SimulationGroup) =>
    g.source === "all-devices" ? 0 : g.source === "all-users" ? 1 : g.source === "unassigned" ? 3 : 2;
  const orderedGroups = [...simulation.groups].sort((a, b) => groupRank(a) - groupRank(b));

  const groupX = STACK_WIDTH + COLUMN_GAP;
  let groupY = 0;
  for (const g of orderedGroups) {
    const off = hiddenGroupIds.has(g.id);
    const h = estimateRowHeight(g.displayName) + (g.impliedByGroupNames?.length ? LINE_HEIGHT : 0);
    nodes.push({
      id: `group:${g.id}`,
      type: "entraGroup",
      position: { x: groupX, y: groupY },
      style: { opacity: off ? 0.4 : 1 },
      data: {
        label: g.displayName,
        source: g.source,
        isDynamic: g.isDynamic,
        impliedByGroupNames: g.impliedByGroupNames,
        off,
      },
    });
    groupY += h;
  }
  // estimateRowHeight already includes a trailing ROW_GAP; drop the last one.
  const groupSpan = Math.max(groupY - ROW_GAP, 0);

  // --- Visible policies (shared by both views) ---
  const policyX = groupX + GROUP_NODE_WIDTH + COLUMN_GAP;
  type VP = {
    id: string;
    name: string;
    kind: string;
    status: PolicyStatus;
    excludedReason?: string;
    settingsCount: number;
    sources: string[];
  };
  const visible: VP[] = [];
  for (const p of [...simulation.policies, ...simulation.excludedPolicies]) {
    const excluded = simulation.excludedPolicies.includes(p);
    // Group-exclude and filter-exclude are mutually exclusive per policy (see computeSimulation).
    const sourceGroupIds = excluded && p.excludedViaGroupIds.length > 0 ? p.excludedViaGroupIds : p.viaGroupIds;
    const visibleSources = sourceGroupIds.filter((id) => !hiddenGroupIds.has(id));
    // A policy survives only while at least one group bringing it in is still visible.
    if (sourceGroupIds.length > 0 && visibleSources.length === 0) continue;
    visible.push({
      id: p.id,
      name: p.displayName,
      kind: p.kind,
      status: excluded ? "excluded" : p.unassigned ? "unassigned" : "included",
      excludedReason: p.excludedByFilter
        ? filterExclusionReason(p.excludedByFilter.filterName, p.excludedByFilter.filterType)
        : undefined,
      settingsCount: settingsCount[p.id] ?? 0,
      sources: visibleSources,
    });
  }

  // --- Enrollment edges: one line per (profile, targeted group) ---
  // The device and its profiles are a single node, so enrollment adds no edge of
  // its own -- only profile -> target group lines, leaving from that profile's
  // own card. Those groups carry ONWARD to their policies, so the direct
  // device -> group edge is dropped for them (below) to avoid a duplicate line.
  // Exclusions are shown on the card text, not as extra edges.
  const apTargetedGroupIds = new Set<string>();
  for (const ap of visibleAps) {
    for (const gid of ap.viaGroupIds) {
      apTargetedGroupIds.add(gid);
      edges.push({
        id: `ap-${ap.id}->${gid}`,
        source: "endpoint",
        sourceHandle: `ap:${ap.id}`,
        target: `group:${gid}`,
        type: "default",
        style: { stroke: AUTOPILOT_COLOR, opacity: 0.55, strokeWidth: 1.5 },
      });
    }
  }

  // --- Policy column: one bubble per type (grouped) or one node per policy ---
  let policySpan = 0;
  if (grouped) {
    const byKind = new Map<string, VP[]>();
    for (const vp of visible) {
      const list = byKind.get(vp.kind) ?? [];
      list.push(vp);
      byKind.set(vp.kind, list);
    }
    const rank = (k: string) => (KIND_ORDER.indexOf(k) === -1 ? 99 : KIND_ORDER.indexOf(k));
    const kinds = [...byKind.keys()].sort((a, b) => rank(a) - rank(b));

    let y = 0;
    for (const kind of kinds) {
      const list = byKind.get(kind)!;
      const expanded = expandedKinds.has(kind);
      // Height must mirror what PolicyTypeNode renders: capped rows plus the
      // "+N more / Show fewer" footer row when the list exceeds the cap.
      const capped = list.length > TYPE_BUBBLE_CAP;
      const shownRows = (expanded ? list.length : Math.min(list.length, TYPE_BUBBLE_CAP)) + (capped ? 1 : 0);
      nodes.push({
        id: `type:${kind}`,
        type: "policyType",
        position: { x: policyX, y },
        data: {
          kind,
          label: KIND_LABEL[kind] ?? kind,
          color: KIND_COLOR[kind] ?? "#94a3b8",
          count: list.length,
          policies: list.map((vp) => ({
            id: vp.id,
            name: vp.name,
            status: vp.status,
            settingsCount: vp.settingsCount,
          })),
          expanded,
          onToggleExpand: () => onToggleKind(kind),
          onOpen,
        },
      });
      y += TYPE_HEADER_HEIGHT + shownRows * TYPE_LINE_HEIGHT + TYPE_PADDING + ROW_GAP;
    }
    policySpan = Math.max(y - ROW_GAP, 0);

    // One edge per (group, kind); solid when the group contributes an applied
    // policy of that kind, otherwise dashed (rose exclude / orange unassigned).
    const edgeAgg = new Map<string, { groupId: string; kind: string; include: boolean; unassigned: boolean }>();
    for (const vp of visible) {
      for (const gid of vp.sources) {
        const key = `${gid}::${vp.kind}`;
        const agg = edgeAgg.get(key) ?? { groupId: gid, kind: vp.kind, include: false, unassigned: false };
        if (vp.status === "included") agg.include = true;
        if (vp.status === "unassigned") agg.unassigned = true;
        edgeAgg.set(key, agg);
      }
    }
    for (const agg of edgeAgg.values()) {
      const style = agg.include
        ? { stroke: "#64748b", opacity: 0.4, strokeWidth: 1.5 }
        : agg.unassigned
          ? { stroke: UNASSIGNED_EDGE, strokeDasharray: "5 5", opacity: 0.6, strokeWidth: 1.5 }
          : { stroke: "#fb7185", strokeDasharray: "5 5", opacity: 0.55, strokeWidth: 1.5 };
      edges.push({
        id: `${agg.groupId}->type:${agg.kind}`,
        source: `group:${agg.groupId}`,
        target: `type:${agg.kind}`,
        type: "default",
        style,
      });
    }
  } else {
    let y = 0;
    for (const vp of visible) {
      nodes.push({
        id: `policy:${vp.id}`,
        type: "policy",
        position: { x: policyX, y },
        data: {
          label: vp.name,
          kind: vp.kind,
          settingsCount: vp.settingsCount,
          excluded: vp.status === "excluded",
          excludedReason: vp.excludedReason,
          unassigned: vp.status === "unassigned",
          policyId: vp.id,
          onOpen,
        },
      });
      y += estimateRowHeight(vp.name);
    }
    policySpan = Math.max(y - ROW_GAP, 0);

    for (const vp of visible) {
      for (const gid of vp.sources) {
        edges.push({
          id: `${vp.status === "excluded" ? "exclude-" : vp.status === "unassigned" ? "unassigned-" : ""}${gid}->${vp.id}`,
          source: `group:${gid}`,
          target: `policy:${vp.id}`,
          type: "default",
          style:
            vp.status === "excluded"
              ? { stroke: "#fb7185", strokeDasharray: "5 5", opacity: 0.55, strokeWidth: 1.5 }
              : vp.status === "unassigned"
                ? { stroke: UNASSIGNED_EDGE, strokeDasharray: "5 5", opacity: 0.6, strokeWidth: 1.5 }
                : { stroke: "#64748b", opacity: 0.4, strokeWidth: 1.5 },
        });
      }
    }
  }

  // Center the policy column on the same line as the groups.
  const centerline = groupSpan / 2;
  const policyOffset = centerline - policySpan / 2;
  for (const n of nodes) {
    if (n.type === "policy" || n.type === "policyType") n.position = { ...n.position, y: n.position.y + policyOffset };
  }

  // The device + its enrollment cards are one node in the left column, centered
  // on the group centerline. Its height is whatever the browser makes it, so the
  // node measures itself and reports back (`onHeight`) and we position it from
  // that. On a rebuild that doesn't change the stack's size -- most of them --
  // the height we already have is exact, so nothing moves.
  nodes.unshift({
    id: "endpoint",
    type: "endpoint",
    position: { x: 0, y: centerline - stackHeight / 2 },
    data: { groupNames, filterNames: deviceFilterNames, profiles: visibleAps, expandedAps, onToggleAp, onHeight },
  });
  for (const g of simulation.groups) {
    // Groups an Autopilot profile targets get their line FROM the profile card
    // (profile -> group), so skip the direct device -> group edge for them to
    // avoid a duplicate line. Every other group hangs directly off the device.
    if (apTargetedGroupIds.has(g.id)) continue;
    const off = hiddenGroupIds.has(g.id);
    // The "No assignment" bucket isn't a real membership path -- draw it dashed
    // orange so it doesn't read like the device belongs to it.
    const unassigned = g.source === "unassigned";
    edges.push({
      id: `device->${g.id}`,
      source: "endpoint",
      sourceHandle: "device",
      target: `group:${g.id}`,
      type: "default",
      style: {
        stroke: SOURCE_STYLE[g.source].border,
        opacity: off ? 0.1 : 0.5,
        strokeWidth: 2,
        ...(unassigned ? { strokeDasharray: "5 5" } : {}),
      },
    });
  }

  return { nodes, edges, centerline };
}
