import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type ReactFlowInstance,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { PolicyKind, SimulationAutopilotProfile, SimulationGroup, SimulationResult } from "@intune-preflight/shared";
import { filterExclusionReason } from "@intune-preflight/shared";
import type { BaselineScope } from "./SimulationBaselinePanel.tsx";

const KIND_COLOR: Record<string, string> = {
  deviceConfiguration: "#38bdf8",
  settingsCatalog: "#a78bfa",
  compliancePolicy: "#f97316",
  adminTemplate: "#facc15",
  platformScript: "#34d399",
  endpointSecurity: "#f43f5e",
};

const KIND_LABEL: Record<string, string> = {
  deviceConfiguration: "Device Configuration",
  settingsCatalog: "Settings Catalog",
  compliancePolicy: "Compliance Policy",
  adminTemplate: "Admin Template",
  platformScript: "Platform Script",
  endpointSecurity: "Endpoint Security (Legacy)",
};

const SOURCE_STYLE: Record<SimulationGroup["source"], { border: string; bg: string; label: string }> = {
  selected: { border: "#34d399", bg: "rgba(52,211,153,0.10)", label: "Selected group" },
  "all-devices": { border: "#94a3b8", bg: "rgba(148,163,184,0.07)", label: "Always applies" },
  "all-users": { border: "#94a3b8", bg: "rgba(148,163,184,0.07)", label: "Always applies" },
  implied: { border: "#fbbf24", bg: "rgba(251,191,36,0.08)", label: "Implied by rule" },
  unassigned: { border: "#fb923c", bg: "rgba(251,146,60,0.08)", label: "No assignment" },
};

const UNASSIGNED_EDGE = "#fb923c";
const AUTOPILOT_COLOR = "#818cf8";

// The device and its Autopilot enrollment cards are ONE React Flow node -- the
// device is what enrolls, so they read (and move) as a single "configured
// endpoint" unit. Keeping them in one node means the BROWSER stacks the cards:
// there is no per-card geometry to estimate, no post-render re-measure pass, and
// the gaps are exactly STACK_GAP no matter how names wrap or which cards are
// expanded. Each card carries its own source handle, so an Autopilot profile
// still draws its own line to the groups it targets.
const STACK_WIDTH = 320;
// Even vertical rhythm inside the stack: device -> first profile and
// profile -> profile use the same gap so the unit reads as one deliberate group.
const STACK_GAP = 16;

const GROUP_NODE_WIDTH = 250;
const POLICY_NODE_WIDTH = 230;
const TYPE_NODE_WIDTH = 400;
const CHARS_PER_LINE = 24;
const LINE_HEIGHT = 16;
const BASE_ROW_HEIGHT = 64;
const ROW_GAP = 24;

// Type-bubble geometry (grouped view).
const TYPE_HEADER_HEIGHT = 40;
const TYPE_LINE_HEIGHT = 29;
const TYPE_PADDING = 14;

// Order the type bubbles top-to-bottom: compliance first, then configuration
// surfaces (device config, settings catalog, admin templates), then scripts.
const KIND_ORDER = ["compliancePolicy", "deviceConfiguration", "settingsCatalog", "endpointSecurity", "adminTemplate", "platformScript"];

// A type bubble lists at most this many policies before collapsing the rest
// behind a "+N more" row -- a 90-policy Settings Catalog bubble in a large
// tenant would otherwise dwarf the whole diagram.
const TYPE_BUBBLE_CAP = 12;

type PolicyStatus = "included" | "excluded" | "unassigned";
const STATUS_DOT: Record<PolicyStatus, string> = {
  included: "#64748b",
  excluded: "#fb7185",
  unassigned: "#fb923c",
};

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Long group/policy names wrap to multiple lines -- estimate row height so nodes never overlap. */
function estimateRowHeight(label: string): number {
  const lines = Math.max(1, Math.ceil(label.length / CHARS_PER_LINE));
  return BASE_ROW_HEIGHT + (lines - 1) * LINE_HEIGHT + ROW_GAP;
}

/** The device card itself -- the top of the "configured endpoint" stack. */
function DeviceCard({ groupNames, filterNames }: { groupNames: string[]; filterNames: string[] }) {
  return (
    <div className="relative flex flex-col items-center gap-2 rounded-2xl border-2 border-emerald-400 bg-ink-900 px-5 py-4 text-emerald-100 shadow-[0_8px_30px_rgba(16,185,129,0.25)]">
      {/* Groups no Autopilot profile targets hang off this handle. */}
      <Handle type="source" id="device" position={Position.Right} className="opacity-0" />
      <span className="text-3xl" aria-hidden>
        🖥️
      </span>
      <span className="text-sm font-semibold">Configured Endpoint</span>
      <div className="w-full space-y-1.5 border-t border-emerald-400/20 pt-2 text-left text-[11px]">
        <div>
          <span className="font-medium uppercase tracking-wide text-emerald-300/80">Entra Groups:</span>{" "}
          <span className="text-emerald-100/90">
            {groupNames.length > 0 ? groupNames.join(", ") : "None selected"}
          </span>
        </div>
        <div>
          <span className="font-medium uppercase tracking-wide text-emerald-300/80">Device Filters:</span>{" "}
          <span className="text-emerald-100/90">{filterNames.length > 0 ? filterNames.join(", ") : "None"}</span>
        </div>
      </div>
    </div>
  );
}

function GroupNode({
  data,
}: {
  data: {
    label: string;
    source: SimulationGroup["source"];
    isDynamic?: boolean;
    impliedByGroupNames?: string[];
    off?: boolean;
  };
}) {
  const style = SOURCE_STYLE[data.source];
  const base =
    data.source === "implied" && data.impliedByGroupNames?.length
      ? `${data.label}\n\nImplied by the dynamic membership rule of: ${data.impliedByGroupNames.join(", ")}.\nBest-effort -- verify against the actual rules in Entra.`
      : data.label;
  const tooltip = `${base}\n\nClick to ${data.off ? "show" : "hide"} this group and the policies it brings in.`;
  return (
    <div
      className="group relative cursor-pointer rounded-xl border bg-ink-900 px-4 py-3 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
      style={{
        borderColor: style.border,
        borderStyle: data.off || data.source === "unassigned" ? "dashed" : "solid",
        width: GROUP_NODE_WIDTH,
      }}
      title={tooltip}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />
      {/* Corner pill -- absolutely positioned so toggling it never changes the node's height. */}
      {data.off && (
        <span className="pointer-events-none absolute -top-2 right-3 z-10 rounded bg-slate-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-100 shadow">
          Hidden
        </span>
      )}
      <div className={`break-words font-semibold leading-snug text-slate-100 ${data.off ? "line-through decoration-slate-500" : ""}`}>
        {data.label}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
          style={{ color: style.border, backgroundColor: style.bg }}
        >
          {style.label}
        </span>
        {data.isDynamic && (
          <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-violet-300">
            Dynamic
          </span>
        )}
      </div>
      {data.source === "implied" && data.impliedByGroupNames?.length ? (
        <div className="mt-1.5 text-[10px] text-amber-300/80">via {data.impliedByGroupNames.join(", ")}</div>
      ) : null}
    </div>
  );
}

function PolicyNode({
  data,
}: {
  data: {
    label: string;
    kind: string;
    settingsCount: number;
    excluded?: boolean;
    excludedReason?: string;
    unassigned?: boolean;
    policyId?: string;
    onOpen?: (scope: BaselineScope) => void;
  };
}) {
  const color = data.excluded ? "#fb7185" : data.unassigned ? UNASSIGNED_EDGE : KIND_COLOR[data.kind] ?? "#94a3b8";
  return (
    <div
      onClick={() => data.policyId && data.onOpen?.({ policyId: data.policyId, label: data.label })}
      className="relative cursor-pointer rounded-lg border bg-ink-900 px-3 py-2.5 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)] hover:bg-ink-800/50"
      style={{
        borderColor: color,
        borderStyle: data.excluded || data.unassigned ? "dashed" : "solid",
        width: POLICY_NODE_WIDTH,
      }}
      title={
        data.unassigned
          ? `${data.label}\n\nNo group assignment — added manually to this simulation.\nClick to open its settings.`
          : `${data.label}\n\nClick to open its settings in the merged baseline.`
      }
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      {data.unassigned && (
        <span className="pointer-events-none absolute -top-2 right-3 z-10 rounded bg-orange-600 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-orange-50 shadow">
          No assignment
        </span>
      )}
      <div className="break-words font-medium leading-snug" style={{ color }}>
        {data.excluded ? "🚫 " : ""}
        {data.label}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500">
        <span className="truncate">{KIND_LABEL[data.kind] ?? data.kind}</span>
        {!data.excluded && <span className="shrink-0 text-slate-400">{pluralize(data.settingsCount, "setting")}</span>}
      </div>
      {data.excluded && <div className="mt-1 text-[10px] text-rose-300/80">{data.excludedReason ?? "Excluded for this group"}</div>}
    </div>
  );
}

// A bundle bubble for the grouped-by-type view: one node per policy kind,
// listing the policies of that kind that apply to the endpoint.
function PolicyTypeNode({
  data,
}: {
  data: {
    kind: string;
    label: string;
    color: string;
    count: number;
    policies: { id: string; name: string; status: PolicyStatus; settingsCount: number }[];
    expanded: boolean;
    onToggleExpand?: () => void;
    onOpen?: (scope: BaselineScope) => void;
  };
}) {
  const shown = data.expanded ? data.policies : data.policies.slice(0, TYPE_BUBBLE_CAP);
  const hiddenCount = data.policies.length - shown.length;
  return (
    <div
      className="rounded-lg border bg-ink-900 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
      style={{ borderColor: data.color, width: TYPE_NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <button
        onClick={() => data.onOpen?.({ kind: data.kind as PolicyKind, label: `${data.label} policies` })}
        title={`Open the merged baseline for all ${data.label} policies`}
        className="flex w-full items-center justify-between gap-2 border-b border-ink-800 px-3 py-2 text-left hover:bg-ink-800/50"
      >
        <span className="font-semibold" style={{ color: data.color }}>
          {data.label}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: data.color, backgroundColor: `${data.color}22` }}
        >
          {data.count}
        </span>
      </button>
      <div className="flex flex-col">
        {shown.map((p, i) => (
          <button
            key={i}
            onClick={() => data.onOpen?.({ policyId: p.id, label: p.name })}
            title={`${p.name}\n\nOpen this policy's settings in the merged baseline`}
            className="flex items-center gap-2 border-b border-ink-800/60 px-3 py-1.5 text-left transition-colors last:border-b-0 hover:bg-ink-800/60"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: p.status === "included" ? data.color : STATUS_DOT[p.status] }}
            />
            <span
              className={`min-w-0 flex-1 truncate leading-snug ${
                p.status === "excluded" ? "text-slate-500 line-through" : "text-slate-200"
              }`}
            >
              {p.name}
            </span>
            {p.status !== "excluded" && (
              <span className="shrink-0 text-[10px] text-slate-500">{pluralize(p.settingsCount, "setting")}</span>
            )}
          </button>
        ))}
        {(hiddenCount > 0 || data.expanded) && data.policies.length > TYPE_BUBBLE_CAP && (
          <button
            onClick={data.onToggleExpand}
            className="px-3 py-1.5 text-left text-[11px] font-medium text-slate-400 transition-colors hover:bg-ink-800/60 hover:text-slate-200"
          >
            {data.expanded ? "▴ Show fewer" : `▾ +${hiddenCount} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/** One Autopilot profile as it appears in the endpoint's enrollment stack. */
type StackProfile = SimulationAutopilotProfile & { excludedNames: string[] };

/**
 * The Autopilot enrollment card: which v1 deployment profile / v2 device-
 * preparation policy this endpoint's groups target, with its high-level
 * configured settings. An exclusion match renders the card dashed-rose with a
 * "would not deploy" note -- targeting that LOOKS right but is carved out is
 * exactly the preflight catch.
 */
function AutopilotCard({
  profile,
  expanded,
  onToggle,
}: {
  profile: StackProfile;
  expanded: boolean;
  onToggle: () => void;
}) {
  const excluded = profile.status === "excluded";
  const color = excluded ? "#fb7185" : AUTOPILOT_COLOR;
  return (
    // `relative` anchors the handle below to THIS card rather than to the node
    // wrapper, so each profile's line leaves from its own card.
    <div
      className="relative rounded-lg border bg-ink-900 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
      style={{ borderColor: color, borderStyle: excluded ? "dashed" : "solid" }}
    >
      <Handle type="source" id={`ap:${profile.id}`} position={Position.Right} className="opacity-0" />
      <div className="flex items-center justify-between gap-2 border-b border-ink-800 px-3 py-2">
        <span className="font-semibold" style={{ color }}>
          ✈ Autopilot enrollment
        </span>
        <span
          className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide"
          style={{ color, backgroundColor: `${color}22` }}
        >
          {profile.generation === "v1" ? "V1 · Deployment profile" : "V2 · Device preparation"}
        </span>
      </div>
      {/* Collapsed by default: name + targeted/excluded status. Click to expand. */}
      <button
        onClick={onToggle}
        title={expanded ? "Hide deployment details" : "Show deployment details"}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-ink-800/40"
      >
        <span className="shrink-0 text-slate-500">{expanded ? "▾" : "▸"}</span>
        <span className="min-w-0 flex-1 break-words font-medium leading-snug text-slate-100">
          {profile.displayName}
        </span>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase"
          style={{ color, backgroundColor: `${color}22` }}
        >
          {excluded ? "Excluded" : "Targeted"}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5 border-t border-ink-800/60 px-3 pb-2 pt-1.5">
          {profile.settings.map((s, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3 leading-snug">
              <span className="shrink-0 text-slate-500">{s.label}</span>
              <span className="min-w-0 truncate text-right text-slate-300" title={s.value}>
                {s.value}
              </span>
            </div>
          ))}
          {excluded && (
            <div className="mt-1 leading-snug text-rose-300/90">
              🚫 Would not deploy — excluded via {profile.excludedNames.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The device and every Autopilot profile it enrolls through, as ONE node: the
 * device is what enrolls (v1 via its assigned device groups, v2 via the
 * policy's just-in-time device group), so the stack reads as one thing that
 * then branches out to the groups. Because it is a single node the browser
 * lays the cards out -- gaps stay exactly STACK_GAP however names wrap or
 * whichever cards are expanded, with no geometry for us to estimate and
 * nothing to re-measure after the fact.
 */
function EndpointStackNode({
  data,
}: {
  data: {
    groupNames: string[];
    filterNames: string[];
    profiles: StackProfile[];
    expandedAps: Set<string>;
    onToggleAp: (id: string) => void;
    onHeight: (height: number) => void;
  };
}) {
  // The stack owns its height -- it depends on how far the group list wraps and
  // which profile cards are expanded, so it is measured, never estimated. The
  // node reports it upward because only the layout above knows the centerline to
  // center it on. Measuring from inside the node (rather than hunting for it in
  // the DOM from outside) keeps us on the live element: React Flow replaces the
  // node's element on some rebuilds, and an observer pinned to the old one goes
  // quietly stale, reporting a height the stack no longer has.
  const ref = useRef<HTMLDivElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const { onHeight } = data;

  // A callback ref, so the observer follows the element React actually mounted.
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      ref.current = el;
      if (!el) return;
      const report = () => onHeight(el.offsetHeight);
      report();
      observer.current = new ResizeObserver(report);
      observer.current.observe(el);
    },
    [onHeight]
  );

  // The ResizeObserver covers reflows nothing here renders (a window resize
  // rewrapping the group list); this covers the content changes themselves,
  // before the browser paints them. Reporting an unchanged height is a no-op.
  useLayoutEffect(() => {
    if (ref.current) onHeight(ref.current.offsetHeight);
  });

  return (
    <div ref={attach} className="flex flex-col" style={{ width: STACK_WIDTH, gap: STACK_GAP }}>
      <DeviceCard groupNames={data.groupNames} filterNames={data.filterNames} />
      {data.profiles.map((profile) => (
        <AutopilotCard
          key={profile.id}
          profile={profile}
          expanded={data.expandedAps.has(profile.id)}
          onToggle={() => data.onToggleAp(profile.id)}
        />
      ))}
    </div>
  );
}

// NB: the node type must not be "group" -- React Flow reserves that name for a
// built-in grouping node whose default CSS paints a translucent light-gray box
// behind the node (most visible on the plain All Devices / All Users cards).
const nodeTypes = {
  endpoint: EndpointStackNode,
  entraGroup: GroupNode,
  policy: PolicyNode,
  policyType: PolicyTypeNode,
};

const COLUMN_GAP = 140;

// Build the graph for the current visibility state. Hidden groups stay in the
// group column as dimmed toggles (so they can be clicked back on), but the
// policy column is laid out from ONLY the visible policies -- so hiding a group
// collapses the gaps its policies leave behind instead of punching holes.
function buildGraph(
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
        excludedNames: excludedViaGroupIds.map(
          (id) => simulation.groups.find((g) => g.id === id)?.displayName ?? id
        ),
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
      data: { label: g.displayName, source: g.source, isDynamic: g.isDynamic, impliedByGroupNames: g.impliedByGroupNames, off },
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
          policies: list.map((vp) => ({ id: vp.id, name: vp.name, status: vp.status, settingsCount: vp.settingsCount })),
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
      edges.push({ id: `${agg.groupId}->type:${agg.kind}`, source: `group:${agg.groupId}`, target: `type:${agg.kind}`, type: "default", style });
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
    if (n.type === "policy" || n.type === "policyType")
      n.position = { ...n.position, y: n.position.y + policyOffset };
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

function Legend() {
  // A key for the policy colors only. Group nodes label themselves (Selected /
  // Always applies / Implied / Hidden badges), so they don't belong here.
  const items: { color: string; label: string }[] = [
    { color: AUTOPILOT_COLOR, label: "Autopilot enrollment" },
    { color: "#f97316", label: "Compliance Policy" },
    { color: "#38bdf8", label: "Device Configuration" },
    { color: "#a78bfa", label: "Settings Catalog" },
    { color: "#f43f5e", label: "Endpoint Security (Legacy)" },
    { color: "#facc15", label: "Admin Template" },
    { color: "#34d399", label: "Platform Script" },
    { color: "#fb7185", label: "Excluded" },
    { color: "#fb923c", label: "Unassigned (Waitlist)" },
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded-lg border border-ink-700 bg-ink-900/90 px-3 py-2 backdrop-blur">
      <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-slate-500">Policy types</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SimulationDiagram({
  simulation,
  deviceFilterNames = [],
  onOpenBaseline,
}: {
  simulation: SimulationResult;
  deviceFilterNames?: string[];
  onOpenBaseline?: (scope: BaselineScope) => void;
}) {
  // Groups the user has toggled off on the diagram. Hiding a group hides the
  // policies that come ONLY through it (policies shared with a still-visible
  // group stay). Works on the All Devices / All Users buckets too.
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<string>>(new Set());

  // Hiding a group is a lens over THIS endpoint's groups, so a group that leaves
  // the simulation must not keep its hidden flag. Without this, re-selecting the
  // group (or re-checking "Autopilot device", which selects the Autopilot-joined
  // groups for you) brought it back still hidden -- silently swallowing the
  // Autopilot enrollment cards and policies it carries, with nothing on screen to
  // explain where they went.
  useEffect(() => {
    setHiddenGroupIds((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(simulation.groups.map((g) => g.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [simulation.groups]);

  // The grouped-by-type summary is always the default view; the per-policy
  // detail view is the opt-in zoom.
  const [grouped, setGrouped] = useState(true);

  // Per-policy setting counts come from each policy's OWN settings, not the
  // merged baseline -- so a policy whose settings all collide with another (e.g.
  // a 25H2 Feature Update profile deduped under 24H2) still shows its real count.
  const settingsCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of [...simulation.policies, ...simulation.excludedPolicies]) counts[p.id] = p.settingsCount;
    return counts;
  }, [simulation.policies, simulation.excludedPolicies]);

  // Type bubbles whose full (uncapped) policy list is shown.
  const [expandedKinds, setExpandedKinds] = useState<Set<string>>(new Set());
  const toggleKind = useCallback((kind: string) => {
    setExpandedKinds((prev) => {
      const next = new Set(prev);
      next.has(kind) ? next.delete(kind) : next.add(kind);
      return next;
    });
  }, []);

  // Autopilot cards whose deployment details are expanded (collapsed by default).
  const [expandedAps, setExpandedAps] = useState<Set<string>>(new Set());
  const toggleAp = useCallback((id: string) => {
    setExpandedAps((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // The endpoint stack's measured height, reported by the node itself. It feeds
  // straight back into the layout, so the stack is centered on the group
  // centerline by the same pass that positions everything else -- there is no
  // second, after-the-fact correction to flash through.
  const [stackHeight, setStackHeight] = useState(0);
  const onHeight = useCallback((height: number) => setStackHeight(height), []);

  const graph = useMemo(
    () =>
      buildGraph(
        simulation,
        deviceFilterNames,
        hiddenGroupIds,
        settingsCount,
        grouped,
        expandedKinds,
        toggleKind,
        expandedAps,
        toggleAp,
        stackHeight,
        onHeight,
        onOpenBaseline
      ),
    [
      simulation,
      deviceFilterNames,
      hiddenGroupIds,
      settingsCount,
      grouped,
      expandedKinds,
      toggleKind,
      expandedAps,
      toggleAp,
      stackHeight,
      onHeight,
      onOpenBaseline,
    ]
  );

  // Controlled nodes so React Flow can track drags and its own measurements.
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  // Adding a group (or an Autopilot profile, or a policy type) changes how tall
  // and wide the graph is, and the endpoint stack is centered on the group
  // column -- so without a refit the thing you just added lands off-screen and
  // everything else slides out from under you. Refit only when the SET of nodes
  // changes, never on a height-only change (expanding a profile card, a name
  // wrapping to another line), so the viewport doesn't lurch while you read.
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const nodeSignature = useMemo(() => graph.nodes.map((n) => n.id).join("|"), [graph.nodes]);
  const firstFit = useRef(true);
  useEffect(() => {
    if (!rf) return;
    // `fitView` fits the last MEASURED sizes, and React Flow measures a changed
    // node a frame after it renders -- so wait two frames or the fit is computed
    // from the previous layout. The initial fit is React Flow's own `fitView`
    // prop; skipping it here avoids fighting that with a redundant animation.
    if (firstFit.current) {
      firstFit.current = false;
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => void rf.fitView({ padding: 0.15, duration: 260 }));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [rf, nodeSignature]);

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (node.type !== "entraGroup") return;
    const gid = node.id.replace("group:", "");
    setHiddenGroupIds((prev) => {
      const next = new Set(prev);
      next.has(gid) ? next.delete(gid) : next.add(gid);
      return next;
    });
  }, []);

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onInit={setRf}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
        minZoom={0.2}
        defaultEdgeOptions={{ type: "default" }}
      >
        <Background color="#1e293b" gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <Legend />
      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <button
          onClick={() => setGrouped((g) => !g)}
          title={
            grouped
              ? "Zoom in: show every policy as its own node"
              : "Back to the summary: one bubble per policy type"
          }
          className="rounded-md border border-ink-700 bg-ink-900/90 px-2.5 py-1 text-[11px] font-medium text-slate-200 backdrop-blur hover:bg-ink-800"
        >
          {grouped ? "⧉ Detail view" : "▤ Group by type"}
        </button>
        {hiddenGroupIds.size > 0 ? (
          <button
            onClick={() => setHiddenGroupIds(new Set())}
            className="rounded-md border border-ink-700 bg-ink-900/90 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur hover:bg-ink-800"
          >
            Show all groups ({hiddenGroupIds.size} hidden)
          </button>
        ) : (
          <div className="pointer-events-none rounded-md border border-ink-700/60 bg-ink-900/70 px-2.5 py-1 text-[10px] text-slate-500 backdrop-blur">
            Tip: click a group to hide its policies
          </div>
        )}
      </div>
    </div>
  );
}
