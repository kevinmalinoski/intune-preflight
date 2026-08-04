import { useId, type KeyboardEvent } from "react";

// A group's policies as a small "seating chart": each bubble is a policy, colored
// by how many groups carry it -- cool = this group's own, hot = shared widely,
// and a distinct colour for policies scoped to All Devices / All Users (universal,
// applies to every device). Clicking opens the full named chip list (onOpen).
// Reads only what the Assignment Manifest already loaded (no new call).

export type ClusterPolicy = {
  id: string;
  name: string;
  shared: number; // # real groups directly carrying it (virtual scopes excluded)
  sharedWith: string[]; // other real groups that carry it
  universal: string[]; // "All Devices" / "All Users" scopes it's on, if any
};

const UNIVERSAL_COLOR = "#818cf8"; // indigo -- "applies to everyone", not a per-group choice

// Heat by sharedness. Thresholds kept in step with the diagram/legend palette.
export function policyHeat(shared: number): string {
  return shared <= 1 ? "#34d399" : shared === 2 ? "#38bdf8" : shared <= 4 ? "#f59e0b" : "#fb7185";
}
// A universal (All Devices/Users) policy is called out regardless of its real-group count.
export function policyColor(p: ClusterPolicy): string {
  return p.universal.length ? UNIVERSAL_COLOR : policyHeat(p.shared);
}

export function containment(pols: ClusterPolicy[]) {
  const universalN = pols.filter((p) => p.universal.length > 0).length;
  const ownN = pols.filter((p) => p.universal.length === 0 && p.shared === 1).length;
  const sharedN = pols.length - universalN - ownN;
  const total = pols.length || 1;
  return { total: pols.length, ownN, sharedN, universalN, ownPct: Math.round((ownN / total) * 100) };
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(ar, br)},${c(ag, bg)},${c(ab, bb)})`;
}

export function GroupHeatCluster({ name, policies, onOpen }: { name: string; policies: ClusterPolicy[]; onOpen?: () => void }) {
  const gid = useId();
  const { total, ownN, sharedN, universalN, ownPct } = containment(policies);

  const W = 178, H = 92, cx = W / 2, cy = 50, R = 38;
  const spacing = R / Math.sqrt(Math.max(total, 1));
  const rb = Math.max(3.5, Math.min(spacing * 0.52, 12));
  // Unique policies toward the centre so a "contained" group reads as a solid core.
  const sorted = [...policies].sort((a, b) => a.shared - b.shared);
  const bubbles = sorted.map((p, i) => {
    const ang = i * 2.39996323; // golden angle -> organic phyllotaxis packing
    const rad = spacing * Math.sqrt(i);
    return { ...p, x: cx + rad * Math.cos(ang), y: cy + rad * Math.sin(ang) };
  });
  const glow = mix("#34d399", "#fb7185", total ? 1 - ownPct / 100 : 0);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(); }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
      title="Click to list this group's policies"
      className="w-[178px] shrink-0 cursor-pointer rounded-lg border border-ink-700 bg-ink-900/80 p-2 transition-colors hover:border-sky-500/60 focus:border-sky-500/60 focus:outline-none"
    >
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-200" title={name}>
          {name}
        </div>
        <span className="shrink-0 text-[10px] text-slate-500" aria-hidden>↗</span>
      </div>
      <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-ink-700" title={`${ownN} own · ${sharedN} shared · ${universalN} All Devices/Users`}>
        <div className="bg-emerald-400" style={{ width: `${pct(ownN)}%` }} />
        <div className="bg-rose-400" style={{ width: `${pct(sharedN)}%` }} />
        <div style={{ width: `${pct(universalN)}%`, backgroundColor: UNIVERSAL_COLOR }} />
      </div>
      <div className="mt-0.5 text-[9px] text-slate-500">
        {ownPct}% its own · {total} polic{total === 1 ? "y" : "ies"}
        {universalN > 0 ? ` · ${universalN} ⚠ dual-scope` : ""}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={`${name}: ${ownPct}% own, ${total} policies`}>
        <defs>
          <radialGradient id={gid}>
            <stop offset="0%" stopColor={glow} stopOpacity="0.28" />
            <stop offset="100%" stopColor={glow} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={cx} cy={cy} rx={R + 20} ry={R + 14} fill={`url(#${gid})`} />
        {bubbles.map((b) => {
          const c = policyColor(b);
          const tip = b.universal.length
            ? `${b.name} — also on ${b.universal.join(" & ")} + this group (unusual; Intune normally blocks this)`
            : b.shared === 1
              ? `${b.name} — unique to this group`
              : `${b.name} — shared by ${b.shared} groups: ${b.sharedWith.join(", ")}`;
          return (
            <g key={b.id}>
              <circle cx={b.x} cy={b.y} r={rb} fill={c} fillOpacity={0.8} stroke={c} strokeWidth={1.1}>
                <title>{tip}</title>
              </circle>
              <circle cx={b.x} cy={b.y} r={rb * 0.4} fill="#ffffff" fillOpacity={0.32} pointerEvents="none" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
