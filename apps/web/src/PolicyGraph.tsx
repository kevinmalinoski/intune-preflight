import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphPayload, GraphNode } from "@intune-baseline/shared";

const KIND_COLOR: Record<string, string> = {
  deviceConfiguration: "#38bdf8",
  settingsCatalog: "#a78bfa",
  compliancePolicy: "#f97316",
  adminTemplate: "#facc15",
};

function GroupNode({ data }: { data: { label: string } }) {
  return (
    <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200 shadow-lg shadow-emerald-950/40">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      {data.label}
    </div>
  );
}

function PolicyNode({ data }: { data: { label: string; kind?: string; settingsCount?: number } }) {
  const color = KIND_COLOR[data.kind ?? ""] ?? "#94a3b8";
  return (
    <div
      className="rounded-lg border bg-ink-800 px-3 py-2 text-xs text-slate-200 shadow-md"
      style={{ borderColor: color }}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <div className="font-medium" style={{ color }}>
        {data.label}
      </div>
      {data.settingsCount !== undefined && (
        <div className="mt-0.5 text-[10px] text-slate-400">{data.settingsCount} settings</div>
      )}
    </div>
  );
}

function AutopilotNode({ data }: { data: { label: string; osLabel?: string } }) {
  return (
    <div className="rounded-xl border border-sky-400/60 bg-gradient-to-br from-sky-500/20 to-indigo-500/10 px-4 py-3 text-xs text-sky-100 shadow-lg shadow-sky-950/40">
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
      <div className="flex items-center gap-2 font-semibold">
        <span>🪟</span>
        <span>{data.label}</span>
      </div>
      {data.osLabel && <div className="mt-0.5 text-[10px] text-sky-300">{data.osLabel} · Autopilot</div>}
    </div>
  );
}

const nodeTypes = { group: GroupNode, policy: PolicyNode, autopilot: AutopilotNode };

function layout(nodes: GraphNode[]): Node[] {
  const byType: Record<string, GraphNode[]> = { group: [], policy: [], autopilot: [] };
  for (const n of nodes) byType[n.type].push(n);

  const columns: Record<string, number> = { autopilot: 0, group: 420, policy: 880 };
  const result: Node[] = [];

  for (const type of Object.keys(byType)) {
    byType[type].forEach((n, idx) => {
      result.push({
        id: n.id,
        type: n.type,
        position: { x: columns[type], y: idx * 90 },
        data: { label: n.label, kind: n.kind, settingsCount: n.settingsCount, osLabel: n.osLabel },
      });
    });
  }
  return result;
}

export function PolicyGraph({
  graph,
  onSelectGroup,
}: {
  graph: GraphPayload;
  onSelectGroup: (groupId: string) => void;
}) {
  const nodes = useMemo(() => layout(graph.nodes), [graph.nodes]);
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: false,
        style: { stroke: "#334155" },
      })),
    [graph.edges]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      onNodeClick={(_evt, node) => {
        if (node.type === "group") onSelectGroup(node.id.replace("group:", ""));
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#1e293b" gap={24} />
      <Controls />
      <MiniMap pannable zoomable className="!bg-ink-900" />
    </ReactFlow>
  );
}
