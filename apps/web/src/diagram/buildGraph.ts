import type { Node, Edge } from "@xyflow/react";
import type { SimulationGroup, SimulationResult } from "@intune-preflight/shared";
import type { BaselineScope } from "../SimulationBaselinePanel.tsx";
import type { StackProfile } from "./nodes.tsx";
import { groupByKind, visiblePolicies } from "./policyGroups.ts";
import {
  AUTOPILOT_COLOR,
  GROUP_NODE_WIDTH,
  LINE_HEIGHT,
  POLICY_NODE_WIDTH,
  ROW_GAP,
  SOURCE_STYLE,
  STACK_WIDTH,
  TYPE_BUBBLE_CAP,
  TYPE_CHIP_GAP,
  TYPE_CHIP_WIDTH,
  TYPE_HEADER_HEIGHT,
  TYPE_LINE_HEIGHT,
  TYPE_PADDING,
  UNASSIGNED_EDGE,
  estimateChipHeight,
  estimateRowHeight,
  isAppKind,
} from "./theme.ts";

/**
 * What the right-hand column of the diagram is drawing: the endpoint's
 * policies, or its apps. One or the other, never both -- with both, a tenant of
 * any size had ten bubbles stacked in one column, the fit-to-view scale dropped
 * until no name was readable, and the policies and the apps each got in the way
 * of reading the other.
 */
export type DiagramContent = "policies" | "apps";

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
export function buildGraph({
  simulation,
  deviceFilterNames,
  hiddenGroupIds,
  content,
  showAvailableApps,
  grouped,
  compact,
  expandedKinds,
  onToggleKind,
  onPopOut,
  expandedAps,
  onToggleAp,
  stackHeight,
  onHeight,
  onOpen,
}: {
  simulation: SimulationResult;
  deviceFilterNames: string[];
  hiddenGroupIds: Set<string>;
  content: DiagramContent;
  /** Whether apps that are only Available are drawn. Off by default -- see countAvailableOnly. */
  showAvailableApps: boolean;
  grouped: boolean;
  /** Below `lg`: type bubbles become chips and their policies move to a pop-out. */
  compact: boolean;
  expandedKinds: Set<string>;
  onToggleKind: (kind: string) => void;
  onPopOut: (kind: string) => void;
  expandedAps: Set<string>;
  onToggleAp: (id: string) => void;
  /** The endpoint stack's measured height, so it can be centered exactly. */
  stackHeight: number;
  onHeight: (height: number) => void;
  onOpen?: (scope: BaselineScope) => void;
}) {
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
  // Derived in policyGroups.ts, not here: everything below this line is
  // geometry, and the drill-down list reads the same two functions.
  const policyX = groupX + GROUP_NODE_WIDTH + COLUMN_GAP;
  const visible = visiblePolicies(simulation, hiddenGroupIds, { showAvailableApps }).filter(
    (vp) => isAppKind(vp.kind) === (content === "apps")
  );

  // --- Enrollment edges: one line per (profile, targeted group) ---
  // Two different relations meet at a group, and they are drawn as two
  // different lines. The device is a MEMBER of each of its groups: a solid line
  // from the device card, for every group (below). An Autopilot profile is
  // ASSIGNED to some of those groups: a dotted line from that profile's own
  // card, leaving from its name.
  //
  // It used to be one line doing both jobs. A group a profile targeted lost its
  // line from the device and hung off the Autopilot card instead, so the
  // endpoint appeared not to belong to exactly the groups that enrolled it,
  // and a reader had to know the convention to see otherwise.
  //
  // An excluded profile's line is the dashed rose every other exclusion uses:
  // it is assigned to that group and will not deploy, which is the catch.
  for (const ap of visibleAps) {
    const excluded = ap.status === "excluded";
    for (const gid of ap.viaGroupIds) {
      edges.push({
        id: `ap-${ap.id}->${gid}`,
        source: "endpoint",
        sourceHandle: `ap:${ap.id}`,
        target: `group:${gid}`,
        type: "default",
        style: excluded
          ? { stroke: "#fb7185", strokeDasharray: "5 5", opacity: 0.55, strokeWidth: 1.5 }
          : { stroke: AUTOPILOT_COLOR, strokeDasharray: "2 4", opacity: 0.8, strokeWidth: 1.5 },
      });
    }
  }

  // --- Policy column: one bubble per type (grouped) or one node per policy ---
  let policySpan = 0;
  // Computed once and returned, so the pop-out reads the very groups the chips
  // were drawn from rather than deriving them a second time. Empty in detail
  // view, which is what closes an open pop-out when you switch to it.
  const typeGroups = grouped ? groupByKind(visible) : [];
  if (grouped) {
    let y = 0;
    for (const { kind, label, color, count, policies: list } of typeGroups) {
      const expanded = expandedKinds.has(kind);
      // Height must mirror what PolicyTypeNode renders: a chip's single label
      // (estimated, since an uncatalogued kind's label can wrap) when compact,
      // otherwise the capped rows plus the "+N more / Show fewer" footer row
      // when the list exceeds the cap.
      const capped = list.length > TYPE_BUBBLE_CAP;
      const shownList = expanded ? list : list.slice(0, TYPE_BUBBLE_CAP);
      // A section heading (apps: Required / Available / Uninstall) is drawn at
      // the same height as a row, so it simply counts as one.
      const headings = shownList.filter((vp, i) => vp.section && vp.section.label !== shownList[i - 1]?.section?.label);
      const shownRows = shownList.length + headings.length + (capped ? 1 : 0);
      nodes.push({
        id: `type:${kind}`,
        type: "policyType",
        position: { x: policyX, y },
        data: {
          kind,
          label,
          color,
          count,
          policies: list.map((vp) => ({
            id: vp.id,
            name: vp.name,
            status: vp.status,
            settingsCount: vp.settingsCount,
            section: vp.section,
          })),
          expanded,
          onToggleExpand: () => onToggleKind(kind),
          onOpen,
          compact,
          onPopOut,
        },
      });
      y += compact
        ? estimateChipHeight(label)
        : TYPE_HEADER_HEIGHT + shownRows * TYPE_LINE_HEIGHT + TYPE_PADDING + ROW_GAP;
    }
    // Each estimate carries its own trailing gap; drop the last one.
    policySpan = Math.max(y - (compact ? TYPE_CHIP_GAP : ROW_GAP), 0);

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

  // Where the policy column ended up, for the compact viewport to aim at.
  //
  // Read after the centering pass, which has already moved it: the nodes were
  // laid out from y=0 and then shifted by `centerline - policySpan / 2`, so
  // that shift is the column's top edge. Null on a wide canvas, where fitting
  // the whole graph is the right framing and needs no rect of its own.
  const policyTier = compact
    ? {
        x: policyX,
        y: centerline - policySpan / 2,
        width: grouped ? TYPE_CHIP_WIDTH : POLICY_NODE_WIDTH,
        height: policySpan,
      }
    : null;

  return { nodes, edges, centerline, typeGroups, policyTier };
}
