import { useMemo } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, Handle, Position } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SimulationGroup, SimulationPolicy, SimulationResult } from "@intune-baseline/shared";

const KIND_COLOR: Record<string, string> = {
  deviceConfiguration: "#38bdf8",
  settingsCatalog: "#a78bfa",
  compliancePolicy: "#f97316",
  adminTemplate: "#facc15",
};

const SOURCE_STYLE: Record<SimulationGroup["source"], { border: string; bg: string; label: string }> = {
  autopilot: { border: "#38bdf8", bg: "rgba(56,189,248,0.08)", label: "via Autopilot" },
  selected: { border: "#34d399", bg: "rgba(52,211,153,0.08)", label: "selected" },
  "all-devices": { border: "#94a3b8", bg: "rgba(148,163,184,0.06)", label: "always applies" },
  "all-users": { border: "#94a3b8", bg: "rgba(148,163,184,0.06)", label: "always applies" },
};

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
      style={{ borderColor: style.border, backgroundColor: style.bg }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <div className="flex items-center gap-1.5 font-semibold text-slate-100">
        {data.label}
        {data.isDynamic && (
          <span className="rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-300">dynamic</span>
        )}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide" style={{ color: style.border }}>
        {style.label}
      </div>
    </div>
  );
}

function PolicyNode({ data }: { data: { label: string; kind: string; settingsCount: number } }) {
  const color = KIND_COLOR[data.kind] ?? "#94a3b8";
  return (
    <div className="rounded-lg border bg-ink-800 px-3 py-2 text-xs text-slate-200 shadow-md" style={{ borderColor: color }}>
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="font-medium" style={{ color }}>
        {data.label}
      </div>
      <div className="mt-0.5 text-[10px] text-slate-400">{data.settingsCount} settings</div>
    </div>
  );
}

const nodeTypes = { device: DeviceNode, group: GroupNode, policy: PolicyNode };

function layout(simulation: SimulationResult) {
  const nodes: Node[] = [
    { id: "device", type: "device", position: { x: 0, y: 0 }, data: {} },
  ];

  const groupX = 320;
  simulation.groups.forEach((g, idx) => {
    nodes.push({
      id: `group:${g.id}`,
      type: "group",
      position: { x: groupX, y: idx * 80 },
      data: { label: g.displayName, source: g.source, isDynamic: g.isDynamic },
    });
  });

  const policyX = 680;
  simulation.policies.forEach((p, idx) => {
    nodes.push({
      id: `policy:${p.id}`,
      type: "policy",
      position: { x: policyX, y: idx * 70 },
      data: { label: p.displayName, kind: p.kind, settingsCount: undefined },
    });
  });

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
