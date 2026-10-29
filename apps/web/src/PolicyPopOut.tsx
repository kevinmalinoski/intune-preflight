import { useEffect } from "react";
import type { PolicyKind } from "@intune-preflight/shared";
import type { BaselineScope } from "./SimulationBaselinePanel.tsx";
import type { PolicyTypeGroup, VisiblePolicy } from "./diagram/policyGroups.ts";
import { STATUS_DOT, isPayloadKind, kindCountLabel, policyPayloadLabel } from "./diagram/theme.ts";

/**
 * One policy type's policies, over the diagram, below `lg`.
 *
 * The compact diagram draws a type as a chip (see PolicyTypeNode): colour,
 * label, two counts, no names. This is where the names went. The chip is 200px
 * on a canvas that fits at well under half scale; this gets the full width of
 * the screen and 11px type at scale 1, which is the only way these names are
 * actually readable -- they run to sixty characters and the part that tells one
 * from another is almost always at the end.
 *
 * Three levels, one list on screen. The diagram carries the shape (which groups
 * feed which types, where the excludes are), this carries the names, and the
 * merged-baseline panel carries the settings -- it already renders a
 * `BaselineScope` of `{ kind }` or `{ policyId }`, so this only has to get you
 * to one of those two.
 *
 * It replaced a full-canvas list view that had all three levels of its own,
 * which put three lists on a phone -- this, its parent, and the merged baseline
 * in the bar underneath. Each was defensible alone; together they were the same
 * information at three depths with no visual anchor, and the diagram is the
 * anchor. Opened on purpose from the thing it belongs to, dismissed when read.
 *
 * The group comes from `buildGraph`'s own `typeGroups`, not from a second call
 * to the selector, so the chip and the pop-out cannot disagree about which
 * policies are of this type or how many settings they carry.
 */
export function PolicyPopOut({
  group,
  onOpenBaseline,
  onClose,
  escapeEnabled = true,
}: {
  group: PolicyTypeGroup;
  onOpenBaseline?: (scope: BaselineScope) => void;
  onClose: () => void;
  /**
   * False while the merged-baseline panel is open over this. Both listen on the
   * window, so without it one Escape closed the panel AND this underneath it --
   * two levels for one press, when the panel's own contract is to back out one
   * at a time. The sheet stays open behind the panel deliberately: closing the
   * panel should put you back in the list you opened it from.
   */
  escapeEnabled?: boolean;
}) {
  const settings = group.policies.reduce((n, p) => n + p.settingsCount, 0);

  // Same contract as the group policy list and the baseline panel: Escape backs
  // out of the thing that is open. There is one level here, so it closes.
  //
  // Capture phase, unlike those two. They are overlays that take focus, so a
  // bubbling listener on the window always hears their Escape. This sheet sits
  // over a React Flow canvas that keeps focus and handles keys of its own, and
  // it stops the event before it reaches the window -- measured: a synthetic
  // Escape dispatched on the window closed this, a real key press did not.
  // Capturing runs before any descendant can swallow it.
  useEffect(() => {
    if (!escapeEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, escapeEnabled]);

  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[55%] flex-col border-t bg-ink-900/95 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] backdrop-blur"
      style={{ borderTopColor: group.color }}
      role="dialog"
      aria-label={`${group.label} policies`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-4 py-2.5">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
        <span className="min-w-0 flex-1 break-words text-xs font-semibold" style={{ color: group.color }}>
          {group.label}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
          {kindCountLabel(group.kind, group.count, settings)}
        </span>
        <button
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="-mr-1 shrink-0 rounded px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-ink-800 hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {onOpenBaseline && (
          <button
            onClick={() => onOpenBaseline({ kind: group.kind as PolicyKind, label: `${group.label} policies` })}
            className="flex w-full items-center gap-2 border-b border-ink-800 px-4 py-2.5 text-left text-[11px] text-emerald-300 transition-colors hover:bg-ink-800/60"
          >
            {isPayloadKind(group.kind)
              ? `View all ${group.count} ${group.count === 1 ? "script" : "scripts"} in the merged baseline`
              : `View all ${settings} settings from ${group.label}`}
            <span aria-hidden>↗</span>
          </button>
        )}
        {group.policies.map((p) => (
          <PolicyRow key={p.id} policy={p} onOpen={onOpenBaseline} />
        ))}
      </div>
    </div>
  );
}

/**
 * One policy. The name wraps rather than truncating, which is the whole reason
 * this exists; everything else on the row is sized to leave it the width.
 */
function PolicyRow({ policy, onOpen }: { policy: VisiblePolicy; onOpen?: (scope: BaselineScope) => void }) {
  const dim = policy.status !== "included";
  const body = (
    <>
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_DOT[policy.status] }} />
      <span className="min-w-0 flex-1">
        <span className={`block break-words text-xs leading-snug ${dim ? "text-slate-400" : "text-slate-200"}`}>
          {policy.name}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-500">
          <span className="tabular-nums">{policyPayloadLabel(policy.kind, policy.settingsCount)}</span>
          {policy.status === "excluded" && (
            <span className="text-rose-300">{policy.excludedReason ?? "excluded for this selection"}</span>
          )}
          {policy.status === "unassigned" && <span className="text-orange-300">from the waitlist</span>}
        </span>
      </span>
    </>
  );

  // An excluded policy contributes nothing to the baseline, so there is no
  // scoped view to open -- it renders as a plain row rather than a button that
  // would lead somewhere empty.
  if (!onOpen || policy.status === "excluded") {
    return <div className="flex items-start gap-2 border-b border-ink-800 px-4 py-3">{body}</div>;
  }
  return (
    <button
      onClick={() => onOpen({ policyId: policy.id, label: policy.name })}
      title="Open this policy's settings in the merged baseline"
      className="flex w-full items-start gap-2 border-b border-ink-800 px-4 py-3 text-left transition-colors hover:bg-ink-800/60"
    >
      {body}
    </button>
  );
}
