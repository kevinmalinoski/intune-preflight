import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SimulationGroup, SimulationResult } from "@intune-baseline/shared";

const KIND_COLOR: Record<string, string> = {
  deviceConfiguration: "#38bdf8",
  settingsCatalog: "#a78bfa",
  compliancePolicy: "#f97316",
  adminTemplate: "#facc15",
};

const SOURCE_STYLE: Record<SimulationGroup["source"], { border: string; bg: string; label: string }> = {
  selected: { border: "#34d399", bg: "rgba(52,211,153,0.08)", label: "selected" },
  "all-devices": { border: "#94a3b8", bg: "rgba(148,163,184,0.06)", label: "always applies" },
  "all-users": { border: "#94a3b8", bg: "rgba(148,163,184,0.06)", label: "always applies" },
};

const GROUP_NODE_WIDTH = 260;
const POLICY_NODE_WIDTH = 240;
const CHARS_PER_LINE = 26;
const LINE_HEIGHT = 15;
const BASE_ROW_HEIGHT = 60;
const ROW_GAP = 16;

/** Long group/policy names wrap to multiple lines -- estimate row height so nodes never overlap. */
function estimateRowHeight(label: string): number {
  const lines = Math.max(1, Math.ceil(label.length / CHARS_PER_LINE));
  return BASE_ROW_HEIGHT + (lines - 1) * LINE_HEIGHT + ROW_GAP;
}

function DeviceNode() {
  return (
    <div className="flex flex-col items-center rounded-2xl border-2 border-emerald-400 bg-emerald-500/10 px-6 py-4 text-emerald-100 shadow-xl shadow-emerald-950/50">
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <span className="text-3xl" aria-hidden>
        🖥️
      </span>
      <span className="mt-1 text-sm font-semibold">This endpoint</span>
    </div>
  );
}

function GroupNode({ data }: { data: { label: string; source: SimulationGroup["source"]; isDynamic?: boolean } }) {
  const style = SOURCE_STYLE[data.source];
  return (
    <div
      className="rounded-xl border px-4 py-2.5 text-xs shadow-lg"
      style={{ borderColor: style.border, backgroundColor: style.bg, width: GROUP_NODE_WIDTH }}
      title={data.label}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <div className="flex items-start gap-1.5 font-semibold leading-snug text-slate-100">
        <span className="break-words">{data.label}</span>
        {data.isDynamic && (
          <span className="shrink-0 rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-300">
            dynamic
          </span>
        )}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide" style={{ color: style.border }}>
        {style.label}
      </div>
    </div>
  );
}

function PolicyNode({ data }: { data: { label: string; kind: string; settingsCount: number; excluded?: boolean } }) {
  const color = data.excluded ? "#fb7185" : KIND_COLOR[data.kind] ?? "#94a3b8";
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-md"
      style={{
        borderColor: color,
        backgroundColor: data.excluded ? "rgba(251,113,133,0.08)" : "#1a2130",
        borderStyle: data.excluded ? "dashed" : "solid",
        width: POLICY_NODE_WIDTH,
      }}
      title={data.label}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="break-words font-medium leading-snug" style={{ color }}>
        {data.excluded ? "🚫 " : ""}
        {data.label}
      </div>
      <div className="mt-1 text-[10px] text-slate-400">
        {data.excluded ? "excluded for this group" : `${data.settingsCount} settings`}
      </div>
    </div>
  );
}

const nodeTypes = { device: DeviceNode, group: GroupNode, policy: PolicyNode };

function layout(simulation: SimulationResult) {
  const nodes: Node[] = [{ id: "device", type: "device", position: { x: 0, y: 0 }, data: {} }];

  const groupX = 320;
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

  const policyX = 680;
  let policyY = 0;
  for (const p of [...simulation.policies, ...simulation.excludedPolicies]) {
    const excluded = simulation.excludedPolicies.includes(p);
    nodes.push({
      id: `policy:${p.id}`,
      type: "policy",
      position: { x: policyX, y: policyY },
      data: { label: p.displayName, kind: p.kind, settingsCount: undefined, excluded },
    });
    policyY += estimateRowHeight(p.displayName);
  }

  const edges: Edge[] = [];
  for (const g of simulation.groups) {
    edges.push({
      id: `device->${g.id}`,
      source: "device",
      target: `group:${g.id}`,
      style: { stroke: SOURCE_STYLE[g.source].border, opacity: 0.6 },
    });
  }
  for (const p of simulation.policies) {
    for (const groupId of p.viaGroupIds) {
      edges.push({
        id: `${groupId}->${p.id}`,
        source: `group:${groupId}`,
        target: `policy:${p.id}`,
        style: { stroke: "#334155" },
      });
    }
  }
  for (const p of simulation.excludedPolicies) {
    for (const groupId of p.excludedViaGroupIds) {
      edges.push({
        id: `exclude-${groupId}->${p.id}`,
        source: `group:${groupId}`,
        target: `policy:${p.id}`,
        style: { stroke: "#fb7185", strokeDasharray: "4 4" },
      });
    }
  }

  return { nodes, edges };
}

export function SimulationDiagram({ simulation }: { simulation: SimulationResult }) {
  const { nodes, edges } = useMemo(() => layout(simulation), [simulation]);
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
    <ReactFlow nodes={enrichedNodes} edges={edges} nodeTypes={nodeTypes} fitView proOptions={{ hideAttribution: true }}>
      <Background color="#1e293b" gap={24} />
      <Controls />
    </ReactFlow>
  );
}
