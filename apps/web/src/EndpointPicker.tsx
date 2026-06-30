import { useMemo, useState } from "react";
import type { GroupSummary } from "@intune-baseline/shared";

export function EndpointPicker({
  groups,
  selectedGroupIds,
  onToggleGroup,
}: {
  groups: GroupSummary[];
  selectedGroupIds: string[];
  onToggleGroup: (id: string) => void;
}) {
  const [search, setSearch] = useState("");

  const filteredGroups = useMemo(
    () => groups.filter((g) => g.displayName.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  return (
    <div className="flex flex-col gap-3 border-b border-ink-700 bg-ink-900 p-4">
      <div className="flex items-center gap-3">
        <span className="text-2xl" aria-hidden>
          💻
        </span>
        <div>
          <div className="text-sm font-semibold text-slate-100">Simulate an endpoint</div>
          <div className="text-xs text-slate-400">
            Pick the Entra security groups this device/user belongs to — see exactly what gets applied, including
            anything explicitly excluded.
          </div>
        </div>
      </div>

      <div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search groups…"
          className="mb-2 w-full max-w-sm rounded-md border border-ink-700 bg-ink-800 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
        />
        <div className="max-h-48 max-w-sm overflow-y-auto rounded-md border border-ink-700">
          {filteredGroups.map((g) => (
            <label
              key={g.id}
              className="flex cursor-pointer items-center gap-2 border-b border-ink-800 px-3 py-1.5 text-xs last:border-b-0 hover:bg-ink-800"
            >
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(g.id)}
                onChange={() => onToggleGroup(g.id)}
                className="accent-sky-400"
              />
              <span className="flex-1 text-slate-200">{g.displayName}</span>
              {g.isDynamic && (
                <span
                  className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-300"
                  title={g.membershipRule ?? "Dynamic membership"}
                >
                  dynamic
                </span>
              )}
            </label>
          ))}
          {filteredGroups.length === 0 && (
            <div className="px-3 py-3 text-center text-xs text-slate-500">No groups found.</div>
          )}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Dynamic groups are evaluated by Entra from a membership rule — verify the rule still matches this endpoint
          before trusting the simulation.
        </div>
      </div>

      <div className="text-[11px] text-slate-500">
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-400 align-middle" /> All Devices &amp; All
        Users always apply automatically (unless excluded) and are shown as separate branches below.
      </div>
    </div>
  );
}
