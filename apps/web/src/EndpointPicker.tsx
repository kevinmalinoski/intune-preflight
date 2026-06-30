import { useMemo, useState } from "react";
import type { AssignmentFilter, GroupSummary, Platform } from "@intune-baseline/shared";

const PLATFORM_OPTIONS: { value: Platform; label: string }[] = [
  { value: "windows", label: "Windows" },
  { value: "macos", label: "macOS" },
  { value: "ios", label: "iOS / iPadOS" },
  { value: "android", label: "Android" },
];

export function EndpointPicker({
  groups,
  selectedGroupIds,
  platform,
  onTogglePlatform,
  onToggleGroup,
  filters,
  deviceFilterIds,
  onToggleDeviceFilter,
}: {
  groups: GroupSummary[];
  selectedGroupIds: string[];
  platform: Platform;
  onTogglePlatform: (platform: Platform) => void;
  onToggleGroup: (id: string) => void;
  filters: AssignmentFilter[];
  deviceFilterIds: string[];
  onToggleDeviceFilter: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const filteredGroups = useMemo(
    () => groups.filter((g) => g.displayName.toLowerCase().includes(search.toLowerCase())),
    [groups, search]
  );

  const platformFilters = useMemo(() => filters.filter((f) => f.platform === platform), [filters, platform]);

  const selectedGroupNames = selectedGroupIds
    .map((id) => groups.find((g) => g.id === id)?.displayName ?? id)
    .join(", ");
  const platformLabel = PLATFORM_OPTIONS.find((p) => p.value === platform)?.label ?? platform;
  const deviceFilterLabels = deviceFilterIds
    .map((id) => filters.find((f) => f.id === id)?.displayName)
    .filter((label): label is string => Boolean(label));

  if (collapsed) {
    return (
      <div className="flex items-center gap-3 border-b border-ink-700 bg-ink-900 px-4 py-2">
        <span className="text-lg" aria-hidden>
          💻
        </span>
        <div className="min-w-0 flex-1 truncate text-xs text-slate-300">
          <span className="font-medium text-slate-100">{platformLabel}</span>
          {deviceFilterLabels.length > 0 && (
            <span className="text-violet-300"> · matches "{deviceFilterLabels.join('", "')}"</span>
          )}
          {selectedGroupIds.length > 0 ? (
            <span className="text-slate-400"> · {selectedGroupNames}</span>
          ) : (
            <span className="text-slate-500"> · no groups selected (All Devices/Users only)</span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-ink-800"
        >
          Edit ▾
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-ink-700 bg-ink-900 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            💻
          </span>
          <div>
            <div className="text-sm font-semibold text-slate-100">Simulate an endpoint</div>
            <div className="text-xs text-slate-400">
              Pick the OS, Entra security groups, and (optionally) the device filter this endpoint matches — see
              exactly what gets applied, including anything explicitly excluded.
            </div>
          </div>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-ink-800"
        >
          Collapse ▴
        </button>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Platform</label>
        <div className="inline-flex rounded-lg border border-ink-700 bg-ink-800 p-1">
          {PLATFORM_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onTogglePlatform(opt.value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                platform === opt.value ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          Only policies targeting this platform are shown — compliance policies in particular are always
          platform-specific in Intune, even when their names don't say so.
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Device filters
        </label>
        {platformFilters.length === 0 ? (
          <div className="max-w-sm rounded-md border border-ink-700 px-3 py-2 text-xs text-slate-500">
            No Assignment Filters defined for this platform.
          </div>
        ) : (
          <div className="max-h-32 max-w-sm overflow-y-auto rounded-md border border-ink-700">
            {platformFilters.map((f) => (
              <label
                key={f.id}
                className="flex cursor-pointer items-start gap-2 border-b border-ink-800 px-3 py-1.5 text-xs last:border-b-0 hover:bg-ink-800"
              >
                <input
                  type="checkbox"
                  checked={deviceFilterIds.includes(f.id)}
                  onChange={() => onToggleDeviceFilter(f.id)}
                  className="mt-0.5 shrink-0 accent-violet-400"
                />
                <span className="min-w-0 flex-1 break-words leading-snug text-slate-200" title={f.rule}>
                  {f.displayName}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="mt-1 text-[11px] text-slate-500">
          Which Intune Assignment Filter(s), if any, this device matches — e.g. a device can be both "Kiosk Devices"
          and "Corporate Owned" at once. Policies whose assignment includes or excludes a filter are resolved against
          this, on top of group membership. Default is no filters matched.
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
          Entra security groups
        </label>
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
              className="flex cursor-pointer items-start gap-2 border-b border-ink-800 px-3 py-1.5 text-xs last:border-b-0 hover:bg-ink-800"
            >
              <input
                type="checkbox"
                checked={selectedGroupIds.includes(g.id)}
                onChange={() => onToggleGroup(g.id)}
                className="mt-0.5 shrink-0 accent-sky-400"
              />
              <span className="min-w-0 flex-1 break-words leading-snug text-slate-200" title={g.displayName}>
                {g.displayName}
              </span>
              {g.isDynamic && (
                <span
                  className="shrink-0 rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-medium text-violet-300"
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
