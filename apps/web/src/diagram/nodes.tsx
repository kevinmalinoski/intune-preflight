import { useCallback, useLayoutEffect, useRef } from "react";
import { Handle, Position } from "@xyflow/react";
import type { PolicyKind, SimulationAutopilotProfile, SimulationGroup } from "@intune-preflight/shared";
import type { BaselineScope } from "../SimulationBaselinePanel.tsx";
import {
  AUTOPILOT_COLOR,
  GROUP_NODE_WIDTH,
  KIND_COLOR,
  KIND_LABEL,
  POLICY_NODE_WIDTH,
  SOURCE_STYLE,
  STACK_GAP,
  STACK_WIDTH,
  STATUS_DOT,
  UNASSIGNED_EDGE,
  TYPE_BUBBLE_CAP,
  TYPE_CHIP_WIDTH,
  TYPE_NODE_WIDTH,
  kindCountLabel,
  pluralize,
  policyPayloadLabel,
  type PolicyStatus,
} from "./theme.ts";

/**
 * Every node the diagram can draw, and the `nodeTypes` map React Flow resolves
 * them through.
 *
 * These are pure presentation: given the data buildGraph put on a node, render
 * it. The one exception is EndpointStackNode, which measures itself and reports
 * its height upward -- see the comment there for why that isn't done from the
 * outside.
 */

export function DeviceCard({ groupNames, filterNames }: { groupNames: string[]; filterNames: string[] }) {
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
          <span className="text-emerald-100/90">{groupNames.length > 0 ? groupNames.join(", ") : "None selected"}</span>
        </div>
        <div>
          <span className="font-medium uppercase tracking-wide text-emerald-300/80">Device Filters:</span>{" "}
          <span className="text-emerald-100/90">{filterNames.length > 0 ? filterNames.join(", ") : "None"}</span>
        </div>
      </div>
    </div>
  );
}

export function GroupNode({
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
      <div
        className={`break-words font-semibold leading-snug text-slate-100 ${data.off ? "line-through decoration-slate-500" : ""}`}
      >
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

export function PolicyNode({
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
  const color = data.excluded ? "#fb7185" : data.unassigned ? UNASSIGNED_EDGE : (KIND_COLOR[data.kind] ?? "#94a3b8");
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
      {data.excluded && (
        <div className="mt-1 text-[10px] text-rose-300/80">{data.excludedReason ?? "Excluded for this group"}</div>
      )}
    </div>
  );
}

// A bundle bubble for the grouped-by-type view: one node per policy kind,
// listing the policies of that kind that apply to the endpoint.
export function PolicyTypeNode({
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
    /** Below `lg`: render as a chip and hand taps to `onPopOut`. */
    compact?: boolean;
    onPopOut?: (kind: string) => void;
  };
}) {
  const settings = data.policies.reduce((n, p) => n + p.settingsCount, 0);

  // A chip, below `lg`. The bubble lists up to twelve policy names at 11px in a
  // 400px node, which is right on a desktop canvas and unusable on a phone: the
  // graph fits at a scale that renders that text at under 3px, and the names
  // truncate at the end, which is where these names differ. So the chip carries
  // only what survives being small -- colour, label, two counts -- and the names
  // move to a pop-out that gets the full width of the screen (PolicyPopOut).
  //
  // Not a second component, because the two have to agree about which policies
  // are of this type and how many settings they carry; one renderer over one set
  // of node data cannot drift.
  if (data.compact) {
    return (
      <button
        onClick={() => data.onPopOut?.(data.kind)}
        title={`Show the ${data.count} ${data.label} ${data.count === 1 ? "policy" : "policies"}`}
        className="flex items-start gap-2 rounded-lg border bg-ink-900 px-2.5 py-2 text-left shadow-[0_4px_16px_rgba(0,0,0,0.35)] transition-colors hover:bg-ink-800/60"
        style={{ borderColor: data.color, width: TYPE_CHIP_WIDTH }}
      >
        <Handle type="target" position={Position.Left} className="opacity-0" />
        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: data.color }} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[11px] font-semibold leading-tight" style={{ color: data.color }}>
            {data.label}
          </span>
          <span className="mt-0.5 block text-[10px] tabular-nums text-slate-500">
            {kindCountLabel(data.kind, data.count, settings)}
          </span>
        </span>
        <span className="mt-0.5 shrink-0 text-[10px] text-slate-600" aria-hidden>
          ▸
        </span>
      </button>
    );
  }

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
              <span className="shrink-0 text-[10px] text-slate-500">
                {policyPayloadLabel(data.kind, p.settingsCount)}
              </span>
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
export type StackProfile = SimulationAutopilotProfile & { excludedNames: string[] };

/**
 * The Autopilot enrollment card: which v1 deployment profile / v2 device-
 * preparation policy this endpoint's groups target, with its high-level
 * configured settings. An exclusion match renders the card dashed-rose with a
 * "would not deploy" note -- targeting that LOOKS right but is carved out is
 * exactly the preflight catch.
 */
export function AutopilotCard({
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
export function EndpointStackNode({
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
