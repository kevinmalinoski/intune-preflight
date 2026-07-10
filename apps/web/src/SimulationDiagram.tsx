import { useCallback, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeMouseHandler,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SimulationGroup, SimulationResult } from "@intune-preflight/shared";

const KIND_COLOR: Record<string, string> = {
  deviceConfiguration: "#38bdf8",
  settingsCatalog: "#a78bfa",
  compliancePolicy: "#f97316",
  adminTemplate: "#facc15",
  platformScript: "#34d399",
};

const KIND_LABEL: Record<string, string> = {
  deviceConfiguration: "Device Configuration",
  settingsCatalog: "Settings Catalog",
  compliancePolicy: "Compliance Policy",
  adminTemplate: "Admin Template",
  platformScript: "Platform Script",
};

const SOURCE_STYLE: Record<SimulationGroup["source"], { border: string; bg: string; label: string }> = {
  selected: { border: "#34d399", bg: "rgba(52,211,153,0.10)", label: "Selected group" },
  "all-devices": { border: "#94a3b8", bg: "rgba(148,163,184,0.07)", label: "Always applies" },
  "all-users": { border: "#94a3b8", bg: "rgba(148,163,184,0.07)", label: "Always applies" },
  implied: { border: "#fbbf24", bg: "rgba(251,191,36,0.08)", label: "Implied by rule" },
};

const GROUP_NODE_WIDTH = 250;
const POLICY_NODE_WIDTH = 230;
const CHARS_PER_LINE = 24;
const LINE_HEIGHT = 16;
const BASE_ROW_HEIGHT = 64;
const ROW_GAP = 24;

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Long group/policy names wrap to multiple lines -- estimate row height so nodes never overlap. */
function estimateRowHeight(label: string): number {
  const lines = Math.max(1, Math.ceil(label.length / CHARS_PER_LINE));
  return BASE_ROW_HEIGHT + (lines - 1) * LINE_HEIGHT + ROW_GAP;
}

function DeviceNode({ data }: { data: { groupNames: string[]; filterNames: string[] } }) {
  return (
    <div className="flex w-64 flex-col items-center gap-2 rounded-2xl border-2 border-emerald-400 bg-ink-900 px-5 py-4 text-emerald-100 shadow-[0_8px_30px_rgba(16,185,129,0.25)]">
      <Handle type="source" position={Position.Right} className="opacity-0" />
      <span className="text-3xl" aria-hidden>
        🖥️
      </span>
      <span className="text-sm font-semibold">Configured Endpoint</span>
      <div className="w-full space-y-1.5 border-t border-emerald-400/20 pt-2 text-left text-[11px]">
        <div>
          <span className="font-medium uppercase tracking-wide text-emerald-300/80">Entra Groups:</span>{" "}
          <span className="text-emerald-100/90">
            {data.groupNames.length > 0 ? data.groupNames.join(", ") : "None selected"}
          </span>
        </div>
        <div>
          <span className="font-medium uppercase tracking-wide text-emerald-300/80">Device Filters:</span>{" "}
          <span className="text-emerald-100/90">
            {data.filterNames.length > 0 ? data.filterNames.join(", ") : "None"}
          </span>
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
      className="cursor-pointer rounded-xl border bg-ink-900 px-4 py-3 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-opacity"
      style={{ borderColor: style.border, width: GROUP_NODE_WIDTH }}
      title={tooltip}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />
      <div className={`break-words font-semibold leading-snug text-slate-100 ${data.off ? "line-through" : ""}`}>
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
        {data.off && (
          <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-slate-300">
            Hidden
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
  data: { label: string; kind: string; settingsCount: number; excluded?: boolean; excludedReason?: string };
}) {
  const color = data.excluded ? "#fb7185" : KIND_COLOR[data.kind] ?? "#94a3b8";
  return (
    <div
      className="rounded-lg border bg-ink-900 px-3 py-2.5 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
      style={{
        borderColor: color,
        borderStyle: data.excluded ? "dashed" : "solid",
        width: POLICY_NODE_WIDTH,
      }}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
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

// NB: the node type must not be "group" -- React Flow reserves that name for a
// built-in grouping node whose default CSS paints a translucent light-gray box
// behind the node (most visible on the plain All Devices / All Users cards).
const nodeTypes = { device: DeviceNode, entraGroup: GroupNode, policy: PolicyNode };

const COLUMN_GAP = 140;

// Build the graph for the current visibility state. Hidden groups stay in the
// group column as dimmed toggles (so they can be clicked back on), but the
// policy column is laid out from ONLY the visible policies -- so hiding a group
// collapses the gaps its policies leave behind instead of punching holes.
function buildGraph(
  simulation: SimulationResult,
  deviceFilterNames: string[],
  hiddenGroupIds: Set<string>,
  settingsCount: Record<string, number>
) {
  const groupNames = simulation.groups.filter((g) => g.source === "selected").map((g) => g.displayName);
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // --- Group column (all groups; hidden ones dimmed) ---
  const groupX = 220 + COLUMN_GAP / 2;
  let groupY = 0;
  for (const g of simulation.groups) {
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

  // --- Policy column (only visible policies, laid out contiguously) ---
  const policyX = groupX + GROUP_NODE_WIDTH + COLUMN_GAP;
  const visiblePolicies: { id: string; y: number; h: number; sources: string[]; excluded: boolean }[] = [];
  let policyY = 0;
  for (const p of [...simulation.policies, ...simulation.excludedPolicies]) {
    const excluded = simulation.excludedPolicies.includes(p);
    // Group-exclude and filter-exclude are mutually exclusive per policy (see computeSimulation).
    const sourceGroupIds = excluded && p.excludedViaGroupIds.length > 0 ? p.excludedViaGroupIds : p.viaGroupIds;
    const visibleSources = sourceGroupIds.filter((id) => !hiddenGroupIds.has(id));
    // A policy survives only while at least one group bringing it in is still visible.
    if (sourceGroupIds.length > 0 && visibleSources.length === 0) continue;

    const h = estimateRowHeight(p.displayName);
    const excludedReason = p.excludedByFilter ? `Excluded — device filter "${p.excludedByFilter.filterName}"` : undefined;
    nodes.push({
      id: `policy:${p.id}`,
      type: "policy",
      position: { x: policyX, y: policyY },
      data: { label: p.displayName, kind: p.kind, settingsCount: settingsCount[p.id] ?? 0, excluded, excludedReason },
    });
    visiblePolicies.push({ id: p.id, y: policyY, h, sources: visibleSources, excluded });
    policyY += h;
  }
  const policySpan = Math.max(policyY - ROW_GAP, 0);

  // The device node and group column are FROZEN in place: their positions come
  // only from the (fixed) group column, never from the policy column. The policy
  // column expands/contracts around the same fixed centerline, so hiding a group
  // moves only the policies -- the primary columns don't drift.
  const centerline = groupSpan / 2;
  const policyOffset = centerline - policySpan / 2;
  for (const n of nodes) {
    if (n.type === "policy") n.position = { ...n.position, y: n.position.y + policyOffset };
  }

  // --- Edges ---
  nodes.unshift({
    id: "device",
    type: "device",
    position: { x: 0, y: centerline - 40 },
    data: { groupNames, filterNames: deviceFilterNames },
  });
  for (const g of simulation.groups) {
    const off = hiddenGroupIds.has(g.id);
    edges.push({
      id: `device->${g.id}`,
      source: "device",
      target: `group:${g.id}`,
      type: "default",
      style: { stroke: SOURCE_STYLE[g.source].border, opacity: off ? 0.1 : 0.5, strokeWidth: 2 },
    });
  }
  for (const p of visiblePolicies) {
    for (const groupId of p.sources) {
      edges.push({
        id: `${p.excluded ? "exclude-" : ""}${groupId}->${p.id}`,
        source: `group:${groupId}`,
        target: `policy:${p.id}`,
        type: "default",
        style: p.excluded
          ? { stroke: "#fb7185", strokeDasharray: "5 5", opacity: 0.55, strokeWidth: 1.5 }
          : { stroke: "#64748b", opacity: 0.4, strokeWidth: 1.5 },
      });
    }
  }

  return { nodes, edges };
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: "#34d399", label: "Selected group" },
    { color: "#fbbf24", label: "Implied by rule" },
    { color: "#94a3b8", label: "All Devices / All Users" },
    { color: "#38bdf8", label: "Device Configuration" },
    { color: "#a78bfa", label: "Settings Catalog" },
    { color: "#f97316", label: "Compliance Policy" },
    { color: "#facc15", label: "Admin Template" },
    { color: "#34d399", label: "Platform Script" },
    { color: "#fb7185", label: "Excluded" },
  ];
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex max-w-xs flex-wrap gap-x-3 gap-y-1.5 rounded-lg border border-ink-700 bg-ink-900/90 px-3 py-2 backdrop-blur">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );
}

export function SimulationDiagram({
  simulation,
  deviceFilterNames = [],
}: {
  simulation: SimulationResult;
  deviceFilterNames?: string[];
}) {
  // Groups the user has toggled off on the diagram. Hiding a group hides the
  // policies that come ONLY through it (policies shared with a still-visible
  // group stay). Works on the All Devices / All Users buckets too.
  const [hiddenGroupIds, setHiddenGroupIds] = useState<Set<string>>(new Set());

  const settingsCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of simulation.settings) counts[s.sourcePolicyId] = (counts[s.sourcePolicyId] ?? 0) + 1;
    return counts;
  }, [simulation.settings]);

  const { nodes, edges } = useMemo(
    () => buildGraph(simulation, deviceFilterNames, hiddenGroupIds, settingsCount),
    [simulation, deviceFilterNames, hiddenGroupIds, settingsCount]
  );

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
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
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
      <div className="absolute left-3 top-3 z-10">
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
