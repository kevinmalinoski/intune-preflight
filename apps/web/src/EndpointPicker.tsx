import { useMemo, useState } from "react";
import { groupTagMatchesRule, isGroupTagRule, isAutopilotJoinedRule } from "@intune-preflight/shared";
import type { AssignmentFilter, GroupSummary, Platform } from "@intune-preflight/shared";

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
  isAutopilotDevice,
  onToggleAutopilotDevice,
  groupTag,
  onGroupTagChange,
  loading = false,
}: {
  groups: GroupSummary[];
  selectedGroupIds: string[];
  platform: Platform;
  onTogglePlatform: (platform: Platform) => void;
  onToggleGroup: (id: string) => void;
  filters: AssignmentFilter[];
  deviceFilterIds: string[];
  onToggleDeviceFilter: (id: string) => void;
  isAutopilotDevice: boolean;
  onToggleAutopilotDevice: () => void;
  groupTag: string;
  onGroupTagChange: (value: string) => void;
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  // Only show groups that actually have policies (included or excluded) for the
  // simulated OS -- a Windows-only group is noise when simulating macOS, etc. --
  // and list them alphabetically so a group is easy to find.
  const filteredGroups = useMemo(
    () =>
      groups
        .filter(
          (g) => (g.platforms ?? []).includes(platform) && g.displayName.toLowerCase().includes(search.toLowerCase())
        )
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })),
    [groups, search, platform]
  );

  const trimmedGroupTag = groupTag.trim();

  const platformFilters = useMemo(() => filters.filter((f) => f.platform === platform), [filters, platform]);

  // Autopilot is a Windows-only enrollment path -- disable the whole section off Windows.
  const autopilotDisabled = platform !== "windows";

  const selectedGroupNames = selectedGroupIds
    .map((id) => groups.find((g) => g.id === id)?.displayName ?? id)
    .join(", ");
  const platformLabel = PLATFORM_OPTIONS.find((p) => p.value === platform)?.label ?? platform;
  const deviceFilterLabels = deviceFilterIds
    .map((id) => filters.find((f) => f.id === id)?.displayName)
    .filter((label): label is string => Boolean(label));

  if (collapsed) {
    return (
      <div
        role="button"
        tabIndex={0}
        aria-expanded={false}
        onClick={() => setCollapsed(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(false);
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 border-b border-ink-700 bg-ink-900 px-4 py-2 hover:bg-ink-800/50"
      >
        <span className="text-base leading-none" aria-hidden>💻</span>
        <div className="min-w-0 flex-1 truncate text-xs text-slate-300">
          <span className="font-medium text-slate-200">{platformLabel}</span>
          {isAutopilotDevice && (
            <span className="text-amber-300"> · Autopilot{trimmedGroupTag ? ` (${trimmedGroupTag})` : ""}</span>
          )}
          {deviceFilterLabels.length > 0 && (
            <span className="text-violet-300"> · {deviceFilterLabels.join(", ")}</span>
          )}
          {selectedGroupIds.length > 0 ? (
            <span className="text-slate-400"> · {selectedGroupNames}</span>
          ) : (
            <span className="text-slate-500"> · All Devices / All Users only</span>
          )}
        </div>
        <span className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-300">Edit ▾</span>
      </div>
    );
  }

  return (
    <div className="border-b border-ink-700 bg-ink-900 px-4 py-3">
      {/* Description row — click anywhere on the bar to collapse. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={true}
        onClick={() => setCollapsed(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed(true);
          }
        }}
        className="-mx-4 -mt-3 mb-2 flex cursor-pointer items-center justify-between gap-3 rounded-b-md px-4 py-3 hover:bg-ink-800/50"
      >
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="text-sm" aria-hidden>💻</span>
          Configure the simulated endpoint — OS, Autopilot, Entra groups, and filters
        </div>
        <span className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-300">Collapse ▴</span>
      </div>

      {/* 3-column control row */}
      <div className="flex gap-4">
        {/* Col 1: Platform + Autopilot */}
        <div className="flex flex-col gap-2 w-48 shrink-0">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Platform</div>
            <div className="flex flex-col rounded-lg border border-ink-700 bg-ink-800 p-0.5">
              {PLATFORM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onTogglePlatform(opt.value)}
                  title={`Show only ${opt.label} policies`}
                  className={`rounded px-2.5 py-1 text-left text-xs font-medium transition-colors ${
                    platform === opt.value ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div
              className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
              title="Marks the simulated endpoint as Autopilot-enrolled. Any dynamic group scoped to a generic Autopilot check (e.g. 'has a ZTDid entry') is auto-included, regardless of which other groups are selected. Windows Autopilot is a Windows-only enrollment path."
            >
              Autopilot
              {autopilotDisabled && <span className="ml-1 normal-case tracking-normal text-slate-600">(Windows only)</span>}
            </div>
            <div
              className={`rounded-lg border border-ink-700 bg-ink-800 p-1.5 ${autopilotDisabled ? "opacity-50" : ""}`}
              title={autopilotDisabled ? "Autopilot only applies to Windows devices." : undefined}
            >
              <label
                className={`flex items-center gap-2 text-xs text-slate-200 ${autopilotDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={isAutopilotDevice}
                  onChange={onToggleAutopilotDevice}
                  disabled={autopilotDisabled}
                  className="shrink-0 accent-amber-400 disabled:cursor-not-allowed"
                />
                Autopilot device
              </label>
              <input
                value={groupTag}
                onChange={(e) => onGroupTagChange(e.target.value)}
                disabled={autopilotDisabled || !isAutopilotDevice}
                placeholder="Group Tag (optional)"
                title="Auto-selects every dynamic group scoped to this exact Group Tag, in real time as you type (marked with a tag badge below), and drops any selected group scoped to a different one -- a real device only carries one GroupTag value. Nothing is disabled; you can still adjust the selection manually."
                className="mt-1.5 w-full rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        </div>

        {/* Col 2: Entra security groups -- the primary, most-used control, so it gets the width */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
            title="Entra security groups this device/user belongs to. Dynamic groups show their membership rule on hover. If a selected group's rule logically implies membership in another dynamic group (e.g. a narrower OrderID prefix), that group is added automatically and shown in amber in the diagram. Entering a Group Tag above auto-selects groups scoped to it."
          >
            Entra security groups
            {selectedGroupIds.length > 0 && (
              <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                {selectedGroupIds.length} selected
              </span>
            )}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="mb-1 w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
          <div className="overflow-y-auto rounded-md border border-ink-700" style={{ maxHeight: "140px" }}>
            {filteredGroups.map((g) => {
              const isTagMatch = Boolean(trimmedGroupTag) && groupTagMatchesRule(g.membershipRule, trimmedGroupTag);
              const isAutopilotJoined = isAutopilotJoinedRule(g.membershipRule);
              const title = isGroupTagRule(g.membershipRule)
                ? `Autopilot Group Tag group — rule: ${g.membershipRule}`
                : isAutopilotJoined
                  ? `Default Autopilot-joined group — rule: ${g.membershipRule}`
                  : g.isDynamic
                    ? `Dynamic — rule: ${g.membershipRule ?? "unknown"}`
                    : undefined;
              // When "Autopilot device" is on, the base Autopilot-joined group is
              // governed by that checkbox -- lock it so it can't be unselected here.
              const locked = isAutopilotJoined && isAutopilotDevice;
              return (
                <label
                  key={g.id}
                  className={`flex items-start gap-2 border-b border-ink-800 px-2.5 py-1.5 text-xs last:border-b-0 hover:bg-ink-800 ${
                    locked ? "cursor-default" : "cursor-pointer"
                  }`}
                  title={
                    locked
                      ? `Locked on by the “Autopilot device” checkbox — uncheck it to change. Rule: ${g.membershipRule}`
                      : title
                  }
                >
                  <input
                    type="checkbox"
                    checked={selectedGroupIds.includes(g.id)}
                    disabled={locked}
                    onChange={() => onToggleGroup(g.id)}
                    className="mt-0.5 shrink-0 accent-sky-400 disabled:opacity-70"
                  />
                  <span className="min-w-0 flex-1 break-words leading-snug text-slate-200">{g.displayName}</span>
                  {isTagMatch && (
                    <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-medium text-amber-300">
                      group tag
                    </span>
                  )}
                  {isAutopilotJoined && isAutopilotDevice && (
                    <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-medium text-amber-300">
                      🔒 autopilot
                    </span>
                  )}
                  {g.isDynamic && (
                    <span className="shrink-0 rounded bg-violet-500/20 px-1 py-0.5 text-[9px] font-medium text-violet-300">
                      dynamic
                    </span>
                  )}
                </label>
              );
            })}
            {filteredGroups.length === 0 && (
              <div className="px-3 py-2 text-center text-xs text-slate-500">
                {loading ? "Loading groups from Intune…" : "No groups found."}
              </div>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-slate-600">
            All Devices &amp; All Users always apply. Dynamic group rules are checked automatically for implied memberships.
          </div>
        </div>

        {/* Col 3: Device Filters -- least-used, pushed to the far right */}
        <div className="flex flex-col gap-1 w-56 shrink-0">
          <div
            className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
            title="Which Intune Assignment Filters this device matches. A device can match multiple filters simultaneously (e.g. Kiosk Devices + Corporate Owned). Policies whose assignments include/exclude these filters are resolved accordingly."
          >
            Device Filters
          </div>
          {platformFilters.length === 0 ? (
            <div className="rounded-md border border-ink-700 px-3 py-2 text-[11px] text-slate-500">
              No filters for this platform
            </div>
          ) : (
            <div className="overflow-y-auto rounded-md border border-ink-700" style={{ maxHeight: "140px" }}>
              {platformFilters.map((f) => (
                <label
                  key={f.id}
                  className="flex cursor-pointer items-start gap-2 border-b border-ink-800 px-2.5 py-1.5 text-xs last:border-b-0 hover:bg-ink-800"
                  title={f.rule}
                >
                  <input
                    type="checkbox"
                    checked={deviceFilterIds.includes(f.id)}
                    onChange={() => onToggleDeviceFilter(f.id)}
                    className="mt-0.5 shrink-0 accent-violet-400"
                  />
                  <span className="min-w-0 flex-1 break-words leading-snug text-slate-200">{f.displayName}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
