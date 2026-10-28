import { useEffect, useMemo, useRef, useState } from "react";
import { classifyGroupTagMatch } from "@intune-preflight/shared";
import type { GroupSummary } from "@intune-preflight/shared";

/**
 * The one control that survives focus mode.
 *
 * Focus mode hides every picker so the diagram gets the whole window, and the
 * Group Tag is the exception because it is the only control whose effect is
 * visible IN the diagram: typing a tag re-selects the groups scoped to it and
 * the graph re-lays out while you watch. A device filter, by contrast, mostly
 * changes what is excluded -- which you read in the baseline, not the chart --
 * so it is not worth the screen it would cost here.
 *
 * Collapsed it is a pill showing the tag in play. Open, it carries the Autopilot
 * switch, the tag field, and a live count of what the tag just did, because in
 * focus mode there is no picker left to show you that.
 */
export function GroupTagPill({
  groups,
  isAutopilotDevice,
  onToggleAutopilotDevice,
  groupTag,
  onGroupTagChange,
  selectedGroupCount,
  settingsCount,
  conflictsCount,
}: {
  groups: GroupSummary[];
  isAutopilotDevice: boolean;
  onToggleAutopilotDevice: () => void;
  groupTag: string;
  onGroupTagChange: (value: string) => void;
  selectedGroupCount: number;
  settingsCount: number;
  conflictsCount: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = groupTag.trim();

  // The same classification the picker's list uses, so the count here and the
  // badges there can never disagree about what a tag matched.
  const { matched, conditional } = useMemo(() => {
    if (!trimmed) return { matched: 0, conditional: 0 };
    let matched = 0;
    let conditional = 0;
    for (const g of groups) {
      const { state } = classifyGroupTagMatch(g.membershipRule, trimmed);
      if (state === "match") matched++;
      else if (state === "conditional") conditional++;
    }
    return { matched, conditional };
  }, [groups, trimmed]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Click away and Escape both close it -- it floats over a canvas you pan by
  // dragging, so a panel that stayed open would be in the way.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const active = isAutopilotDevice && Boolean(trimmed);

  return (
    <div ref={ref} className="flex flex-col items-end">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Autopilot enrollment and Group Tag — the one picker that stays in focus mode, because its effect is the diagram."
        className={`flex min-h-[36px] items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur transition-colors ${
          active
            ? "border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25"
            : "border-ink-700 bg-ink-900/90 text-slate-300 hover:bg-ink-800"
        }`}
      >
        <TagIcon />
        {active ? trimmed : isAutopilotDevice ? "Autopilot" : "Group Tag"}
        <span className="text-[9px] opacity-70" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="mt-2 w-60 rounded-lg border border-ink-700 bg-ink-900/95 p-3 shadow-2xl backdrop-blur">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={isAutopilotDevice}
              onChange={onToggleAutopilotDevice}
              className="h-4 w-4 shrink-0 accent-amber-400"
            />
            Autopilot device
          </label>

          <input
            ref={inputRef}
            value={groupTag}
            onChange={(e) => onGroupTagChange(e.target.value)}
            disabled={!isAutopilotDevice}
            placeholder="Group Tag (optional)"
            className="mt-2 w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />

          {/* In focus mode the group list is gone, so the tag's effect has to be
              reported here or it happens invisibly. */}
          <div className="mt-2 space-y-0.5 text-[10px] leading-relaxed">
            {trimmed ? (
              <div className="text-amber-300">
                {matched} group{matched === 1 ? "" : "s"} matched
                {conditional > 0 && <span className="text-amber-300/70"> · {conditional} conditional</span>}
              </div>
            ) : (
              <div className="text-slate-600">No Group Tag — nothing auto-selected</div>
            )}
            <div className="text-slate-500">
              {selectedGroupCount} group{selectedGroupCount === 1 ? "" : "s"} selected · {settingsCount} setting
              {settingsCount === 1 ? "" : "s"}
              {conflictsCount > 0 && <span className="text-amber-400"> · {conflictsCount} conflicts</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M20.6 13.4 12 22l-8-8V4h10l6.6 6.6a2 2 0 0 1 0 2.8Z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
