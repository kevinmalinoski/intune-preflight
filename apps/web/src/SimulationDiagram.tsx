import { useMemo } from "react";
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SimulationGroup, SimulationResult } from "@intune-baseline/shared";

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

function GroupNode({ data }: { data: { label: string; source: SimulationGroup["source"]; isDynamic?: boolean } }) {
  const style = SOURCE_STYLE[data.source];
  return (
    <div
      className="rounded-xl border bg-ink-900 px-4 py-3 text-xs shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
      style={{ borderColor: style.border, width: GROUP_NODE_WIDTH }}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />
      <div className="break-words font-semibold leading-snug text-slate-100">{data.label}</div>
      <div className="mt-2 flex items-center gap-1.5">
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

const nodeTypes = { device: DeviceNode, group: GroupNode, policy: PolicyNode };

const COLUMN_GAP = 140;

function layout(simulation: SimulationResult, deviceFilterNames: string[]) {
  const groupNames = simulation.groups.filter((g) => g.source === "selected").map((g) => g.displayName);
  const nodes: Node[] = [
    { id: "device", type: "device", position: { x: 0, y: 0 }, data: { groupNames, filterNames: deviceFilterNames } },
  ];

  const groupX = GROUP_NODE_WIDTH * 0 + 220 + COLUMN_GAP / 2;
  let groupY = 0;
  for (const g of simulation.groups) {
    nodes.push({
      id: `group:${g.id}`,
      type: "group",
      position: { x: groupX, y: groupY },
      data: { label: g.displayName, source: g.source, isDynamic: g.isDynamic },
    });
    groupY += estimateRowHeight(g.displayName);
  }

  const policyX = groupX + GROUP_NODE_WIDTH + COLUMN_GAP;
  let policyY = 0;
  for (const p of [...simulation.policies, ...simulation.excludedPolicies]) {
    const excluded = simulation.excludedPolicies.includes(p);
    const excludedReason = p.excludedByFilter
      ? `Excluded — device filter "${p.excludedByFilter.filterName}"`
      : undefined;
    nodes.push({
      id: `policy:${p.id}`,
      type: "policy",
      position: { x: policyX, y: policyY },
      data: { label: p.displayName, kind: p.kind, settingsCount: undefined, excluded, excludedReason },
    });
    policyY += estimateRowHeight(p.displayName);
  }

  const edges: Edge[] = [];
  for (const g of simulation.groups) {
    edges.push({
      id: `device->${g.id}`,
      source: "device",
      target: `group:${g.id}`,
      type: "smoothstep",
      style: { stroke: SOURCE_STYLE[g.source].border, opacity: 0.45, strokeWidth: 1.5 },
    });
  }
  for (const p of simulation.policies) {
    for (const groupId of p.viaGroupIds) {
      edges.push({
        id: `${groupId}->${p.id}`,
        source: `group:${groupId}`,
        target: `policy:${p.id}`,
        type: "smoothstep",
        style: { stroke: "#475569", opacity: 0.6, strokeWidth: 1.25 },
      });
    }
  }
  for (const p of simulation.excludedPolicies) {
    // Group-exclude and filter-exclude are mutually exclusive per policy (see computeSimulation):
    // group-excluded policies carry excludedViaGroupIds, filter-excluded ones carry viaGroupIds instead.
    const sourceGroupIds = p.excludedViaGroupIds.length > 0 ? p.excludedViaGroupIds : p.viaGroupIds;
    for (const groupId of sourceGroupIds) {
      edges.push({
        id: `exclude-${groupId}->${p.id}`,
        source: `group:${groupId}`,
        target: `policy:${p.id}`,
        type: "smoothstep",
        style: { stroke: "#fb7185", strokeDasharray: "4 4", opacity: 0.6, strokeWidth: 1.25 },
      });
    }
  }

  return { nodes, edges };
}

function Legend() {
  const items: { color: string; label: string }[] = [
    { color: "#34d399", label: "Selected group" },
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
  const { nodes, edges } = useMemo(() => layout(simulation, deviceFilterNames), [simulation, deviceFilterNames]);
  const policySettingsCount = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of simulation.settings) counts[s.sourcePolicyId] = (counts[s.sourcePolicyId] ?? 0) + 1;
    return counts;
  }, [simulation.settings]);

  const enrichedNodes = nodes.map((n) =>
    n.type === "policy"
      ? { ...n, data: { ...n.data, settingsCount: policySettingsCount[n.id.replace("policy:", "")] ?? 0 } }
      : n
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={enrichedNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
        minZoom={0.2}
        defaultEdgeOptions={{ type: "smoothstep" }}
      >
        <Background color="#1e293b" gap={28} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(11,15,23,0.75)"
          className="!border !border-ink-700 !bg-ink-900"
          nodeColor={(n) => (n.type === "device" ? "#34d399" : n.type === "group" ? "#64748b" : "#475569")}
        />
      </ReactFlow>
      <Legend />
    </div>
  );
}
