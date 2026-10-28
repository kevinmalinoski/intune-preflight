import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SimulationResult } from "@intune-preflight/shared";
import type { BaselineScope } from "./SimulationBaselinePanel.tsx";
import { toggled } from "./collections.ts";
import { isCompact, subscribeLayout } from "./viewport.ts";
import { buildGraph } from "./diagram/buildGraph.ts";
import { EndpointStackNode, GroupNode, PolicyNode, PolicyTypeNode } from "./diagram/nodes.tsx";
import { AUTOPILOT_COLOR, KIND_COLOR, KIND_LABEL, KIND_ORDER, STATUS_DOT } from "./diagram/theme.ts";

// Which component React Flow uses for each node `type` buildGraph emits.
const nodeTypes = {
  endpoint: EndpointStackNode,
  entraGroup: GroupNode,
  policy: PolicyNode,
  policyType: PolicyTypeNode,
};

// The diagram view: React Flow plus the state that decides WHAT is drawn --
// which groups are hidden, grouped-vs-detail, which bubbles are expanded. The
// drawing itself lives next door: diagram/theme.ts (the visual + layout
// vocabulary), diagram/nodes.tsx (the node components) and
// diagram/buildGraph.ts (the layout engine that turns a simulation into nodes
// and edges).

function Legend({ compact }: { compact: boolean }) {
  // A key for the policy colors only. Group nodes label themselves (Selected /
  // Always applies / Implied / Hidden badges), so they don't belong here.
  // Derived from the same theme the nodes render with, in the same order the
  // policy-type bubbles are laid out -- so a colour can't drift between a node
  // and its key, which it could while these nine hex codes were written out
  // here by hand.
  const items: { color: string; label: string }[] = [
    { color: AUTOPILOT_COLOR, label: "Autopilot enrollment" },
    ...KIND_ORDER.map((kind) => ({ color: KIND_COLOR[kind], label: KIND_LABEL[kind] })),
    { color: STATUS_DOT.excluded, label: "Excluded" },
    { color: STATUS_DOT.unassigned, label: "Unassigned (Waitlist)" },
  ];
  const [open, setOpen] = useState(false);

  const chips = (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
          {item.label}
        </div>
      ))}
    </div>
  );

  // Nine chips pinned open cover a third of a phone's canvas, and the canvas is
  // the whole point. Below `lg` they go behind a button instead.
  if (compact) {
    return (
      <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-5rem)] flex-col items-start gap-2">
        {open && (
          <div className="rounded-lg border border-ink-700 bg-ink-900/95 px-3 py-2 shadow-2xl backdrop-blur">
            <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-slate-500">Policy types</div>
            {chips}
          </div>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="What the colours mean"
          className="rounded-md border border-ink-700 bg-ink-900/90 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur hover:bg-ink-800"
        >
          ⌕ Key
        </button>
      </div>
    );
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs rounded-lg border border-ink-700 bg-ink-900/90 px-3 py-2 backdrop-blur">
      <div className="mb-1 text-[9px] font-medium uppercase tracking-wide text-slate-500">Policy types</div>
      {chips}
    </div>
  );
}

export function SimulationDiagram({
  simulation,
  deviceFilterNames = [],
  onOpenBaseline,
  focus = false,
}: {
  simulation: SimulationResult;
  deviceFilterNames?: string[];
  onOpenBaseline?: (scope: BaselineScope) => void;
  /** Focus mode: the diagram has the whole window and the pickers are gone. */
  focus?: boolean;
}) {
  const compact = useSyncExternalStore(subscribeLayout, isCompact, () => false);
  // Dragging nodes and panning the canvas are the same gesture on a touch
  // screen, and panning is the one you actually want -- a tap still hides a
  // group, which is the only thing a node needs to be good for here.
  const nodesDraggable = !compact && !focus;
  // A portrait canvas needs more slack than the wide one these numbers were
  // tuned on, or the graph lands with its edges against the bezel.
  const fitPadding = compact ? 0.25 : 0.15;
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
  const toggleKind = useCallback((kind: string) => setExpandedKinds(toggled(kind)), []);

  // Autopilot cards whose deployment details are expanded (collapsed by default).
  const [expandedAps, setExpandedAps] = useState<Set<string>>(new Set());
  const toggleAp = useCallback((id: string) => setExpandedAps(toggled(id)), []);

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
      second = requestAnimationFrame(() => void rf.fitView({ padding: fitPadding, duration: 260 }));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [rf, nodeSignature, fitPadding]);

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    if (node.type !== "entraGroup") return;
    const gid = node.id.replace("group:", "");
    setHiddenGroupIds(toggled(gid));
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
        fitViewOptions={{ padding: fitPadding }}
        proOptions={{ hideAttribution: true }}
        selectNodesOnDrag={false}
        nodesDraggable={nodesDraggable}
        minZoom={0.2}
        defaultEdgeOptions={{ type: "default" }}
      >
        <Background color="#1e293b" gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
      </ReactFlow>
      <Legend compact={compact} />
      <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-2">
        <button
          onClick={() => setGrouped((g) => !g)}
          title={
            grouped ? "Zoom in: show every policy as its own node" : "Back to the summary: one bubble per policy type"
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
          // Desktop only: it costs canvas a phone hasn't got, and "click" is
          // the wrong verb on the device that can least afford the advice.
          <div className="pointer-events-none hidden rounded-md border border-ink-700/60 bg-ink-900/70 px-2.5 py-1 text-[10px] text-slate-500 backdrop-blur lg:block">
            Tip: click a group to hide its policies
          </div>
        )}
      </div>
    </div>
  );
}
