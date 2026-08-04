import { useEffect, useState } from "react";
import { containment, policyColor, type ClusterPolicy } from "./GroupHeatCluster.tsx";

// The chip-list destination opened from a group's seating chart: every policy the
// group carries, named, colored by how shared it is (unique / shared / universal).
// Click a policy to reveal exactly which groups carry it -- or that it's scoped to
// All Devices / All Users and therefore applies to every device.

function LegendDot({ c, label }: { c: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: `${c}cc`, boxShadow: `0 0 0 1px ${c}` }} />
      {label}
    </span>
  );
}

export function GroupPolicyList({
  name,
  policies,
  onClose,
}: {
  name: string;
  policies: ClusterPolicy[];
  onClose: () => void;
}) {
  const [sel, setSel] = useState<ClusterPolicy | null>(null);
  const { total, ownN, sharedN, universalN, ownPct } = containment(policies);
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const sorted = [...policies].sort(
    (a, b) =>
      Number(b.universal.length > 0) - Number(a.universal.length > 0) ||
      a.shared - b.shared ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      sel ? setSel(null) : onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sel]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-6" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-100" title={name}>
              {name}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-400">
              <span className="flex h-1.5 w-40 shrink-0 overflow-hidden rounded-full bg-ink-700">
                <span className="bg-emerald-400" style={{ width: `${pct(ownN)}%` }} />
                <span className="bg-rose-400" style={{ width: `${pct(sharedN)}%` }} />
                <span style={{ width: `${pct(universalN)}%`, backgroundColor: "#818cf8" }} />
              </span>
              <span>
                {ownPct}% its own · {ownN} unique, {sharedN} shared
                {universalN > 0 ? `, ${universalN} also on All Devices/Users ⚠` : ""} · click a policy for its groups
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-ink-800 hover:text-slate-200"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {total === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500">This group has no directly-assigned policies.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sorted.map((p) => {
                const c = policyColor(p);
                const active = sel?.id === p.id;
                const badge = p.universal.length ? `⚠ +${p.universal.length > 1 ? "All" : p.universal[0]}` : `×${p.shared}`;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSel(active ? null : p)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-shadow"
                    style={{
                      backgroundColor: `${c}22`,
                      borderColor: active ? c : `${c}66`,
                      color: c,
                      boxShadow: active ? `0 0 0 2px ${c}` : "none",
                    }}
                  >
                    <span className="max-w-[260px] truncate text-slate-200">{p.name}</span>
                    <span className="font-semibold">{badge}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected policy: exactly which groups carry it, or that it's universal */}
        {sel && (
          <div className="border-t border-ink-800 bg-ink-950/40 px-4 py-2.5">
            <div className="mb-1.5 flex items-center gap-2 text-[11px]">
              <span className="min-w-0 truncate font-medium text-slate-200" title={sel.name}>
                {sel.name}
              </span>
              <span className="shrink-0 text-slate-500">
                {sel.universal.length
                  ? `on ${sel.universal.join(" & ")} + this group`
                  : `carried by ${sel.shared} group${sel.shared === 1 ? "" : "s"}`}
              </span>
              <button onClick={() => setSel(null)} className="ml-auto shrink-0 text-slate-500 hover:text-slate-300">
                ✕
              </button>
            </div>
            {sel.universal.length ? (
              <div className="text-[11px] text-indigo-300">
                ⚠ Assigned to <span className="font-medium">both {sel.universal.join(" & ")} and this group</span> directly.
                Intune's portal blocks assigning both, so this was likely created via Graph/PowerShell — verify it's intended.
              </div>
            ) : sel.shared === 1 ? (
              <div className="text-[11px] text-emerald-300">Unique to this group.</div>
            ) : (
              <div className="flex flex-wrap gap-1">
                <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-200 ring-1 ring-sky-500/40">
                  {name} · this group
                </span>
                {sel.sharedWith.map((g) => (
                  <span key={g} className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink-800 px-4 py-2 text-[10px] text-slate-500">
          <LegendDot c="#34d399" label="unique to this group" />
          <LegendDot c="#38bdf8" label="2 groups" />
          <LegendDot c="#f59e0b" label="3–4 groups" />
          <LegendDot c="#fb7185" label="5+ groups (bleed)" />
          <LegendDot c="#818cf8" label="⚠ also on All Devices/Users" />
        </div>
      </div>
    </div>
  );
}
