import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  classifyAutopilotMatch,
  classifyGroupTagMatch,
  groupTagScope,
  isGroupTagRule,
  isAutopilotJoinedRule,
  judgeMembershipRule,
  unmodelledRuleProperties,
  type RuleVerdict,
} from "@intune-preflight/shared";
import type { AssignmentFilter, GroupSummary, Platform, ProfileNameWarning } from "@intune-preflight/shared";
import { PortalLink } from "./PortalLink.tsx";

// `short` is what fits four-across in the sidebar; "iOS / iPadOS" does not.
const PLATFORM_OPTIONS: { value: Platform; label: string; short: string }[] = [
  { value: "windows", label: "Windows", short: "Windows" },
  { value: "macos", label: "macOS", short: "macOS" },
  { value: "ios", label: "iOS / iPadOS", short: "iOS" },
  { value: "android", label: "Android", short: "Android" },
];

/**
 * The simulated endpoint in one line: OS, Autopilot, filters, groups.
 *
 * It is the way back into the sidebar wherever the sidebar is not on screen --
 * the trigger for the slide-over below `lg` -- and it names what is selected
 * rather than counting it, because a filter or a group that is on while its
 * control is shut still changes every answer on the page.
 */
export function EndpointSummary({
  groups,
  selectedGroupIds,
  platform,
  filters,
  deviceFilterIds,
  isAutopilotDevice,
  groupTag,
  onOpen,
}: {
  groups: GroupSummary[];
  selectedGroupIds: string[];
  platform: Platform;
  filters: AssignmentFilter[];
  deviceFilterIds: string[];
  isAutopilotDevice: boolean;
  groupTag: string;
  onOpen: () => void;
}) {
  const selectedGroupNames = selectedGroupIds
    .map((id) => groups.find((g) => g.id === id)?.displayName ?? id)
    .join(", ");
  const platformLabel = PLATFORM_OPTIONS.find((p) => p.value === platform)?.label ?? platform;
  const deviceFilterLabels = deviceFilterIds
    .map((id) => filters.find((f) => f.id === id)?.displayName)
    .filter((label): label is string => Boolean(label));
  const trimmedGroupTag = groupTag.trim();
  return (
    <button
      onClick={onOpen}
      className="flex w-full items-center gap-2.5 border-b border-ink-700 bg-ink-900 px-4 py-2 text-left hover:bg-ink-800/50"
    >
      <span className="text-base leading-none" aria-hidden>
        💻
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
        <span className="font-medium text-slate-200">{platformLabel}</span>
        {isAutopilotDevice && (
          <span className="text-amber-300"> · Autopilot{trimmedGroupTag ? ` (${trimmedGroupTag})` : ""}</span>
        )}
        {deviceFilterLabels.length > 0 && <span className="text-violet-300"> · {deviceFilterLabels.join(", ")}</span>}
        {selectedGroupIds.length > 0 ? (
          <span className="text-slate-400"> · {selectedGroupNames}</span>
        ) : (
          <span className="text-slate-500"> · All Devices / All Users only</span>
        )}
      </span>
      <span className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-300">Edit</span>
    </button>
  );
}

/**
 * The simulated endpoint's definition, as one column: OS, Autopilot, device
 * filters, then the groups list taking whatever height is left.
 *
 * It used to be a full-width bar above the diagram, three columns across. That
 * put the inputs on top of a picture that reads left to right, and made the
 * canvas pay in height for every control that was open. As the first column of
 * the page it sits where the flow starts -- define it, see it resolve, read the
 * result -- and scrolls on its own, so nothing here can resize the diagram.
 */
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
  nestedAutoIds = [],
  deviceLookup,
  verifiedDevice = null,
  profileWarnings = [],
}: {
  /** Tenant-wide: dynamic groups naming an enrollment profile no profile has. */
  profileWarnings?: ProfileNameWarning[];
  /**
   * A real device the endpoint was started from. While set, its memberships
   * are the facts: groups are marked by whether it is in them, and nothing is
   * judged from rules.
   */
  verifiedDevice?: { name: string; groupIds: string[] } | null;
  /** Selected groups that are selected only because a group inside them is. */
  nestedAutoIds?: string[];
  /** "Start from a real device", placed at the top of the column. */
  deviceLookup?: ReactNode;
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
  /**
   * Per-group overrides for whether the membership rule is visible, keyed by
   * group id. Only groups the admin has actually clicked appear here: everything
   * else falls back to `showRule`, which opens the rules we could not decide.
   * Storing the override rather than the state is what lets an auto-opened rule
   * be closed again without the next render re-opening it.
   */
  const [ruleOverrides, setRuleOverrides] = useState<Record<string, boolean>>({});
  const toggleRule = (id: string, currentlyOpen: boolean) =>
    setRuleOverrides((prev) => ({ ...prev, [id]: !currentlyOpen }));

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

  // Each dynamic group's membership judged from its rule, three-valued -- see
  // judgeMembershipRule. Not judged while a real device is loaded: its actual
  // memberships answer the question rules only estimate.
  const verdicts = useMemo(() => {
    const out = new Map<string, RuleVerdict>();
    if (verifiedDevice) return out;
    const autopilot = platform === "windows" && (isAutopilotDevice || groupTag.trim() !== "");
    const inputs = { platform, isAutopilot: autopilot, groupTag: autopilot ? groupTag : "" };
    for (const g of groups)
      if (g.isDynamic && g.membershipRule) out.set(g.id, judgeMembershipRule(g.membershipRule, inputs));
    return out;
  }, [groups, platform, isAutopilotDevice, groupTag, verifiedDevice]);
  const deviceGroupIds = useMemo(() => new Set(verifiedDevice?.groupIds ?? []), [verifiedDevice]);

  // Float the relevant groups up: selected first, then confident matches (Group
  // Tag, Autopilot, or a rule that settles the device in), then the ones to
  // review -- conditional references and dynamic groups that may include this
  // device -- then the rest alphabetically. Re-sorts as you select, type a tag,
  // or toggle Autopilot, so what matters rises.
  const autopilotOn = isAutopilotDevice && platform === "windows";
  const sortedGroups = useMemo(() => {
    // Rank each group ONCE, then sort -- rather than classifying inside the
    // comparator, which re-parses the same membership rules O(n log n) times on
    // every render, including every keystroke in the search box above. Measured
    // on tenant-shaped data: 4.1ms vs 0.6ms at 800 groups.
    const selected = new Set(selectedGroupIds);
    const rank = new Map<string, number>(
      filteredGroups.map((g) => {
        if (selected.has(g.id)) return [g.id, 0];
        const tagState = trimmedGroupTag ? classifyGroupTagMatch(g.membershipRule, trimmedGroupTag).state : "none";
        const apState = autopilotOn ? classifyAutopilotMatch(g.membershipRule).state : "none";
        if (tagState === "match" || apState === "match" || verdicts.get(g.id) === "member") return [g.id, 1];
        if (tagState === "conditional" || apState === "conditional" || verdicts.get(g.id) === "unknown")
          return [g.id, 2];
        return [g.id, 3];
      })
    );
    return [...filteredGroups].sort(
      (a, b) =>
        (rank.get(a.id) ?? 3) - (rank.get(b.id) ?? 3) ||
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
    );
  }, [filteredGroups, selectedGroupIds, trimmedGroupTag, autopilotOn, verdicts]);

  // Dynamic groups this endpoint may be in that nothing here can settle.
  const mayInclude = sortedGroups.filter(
    (g) => !selectedGroupIds.includes(g.id) && verdicts.get(g.id) === "unknown"
  ).length;

  const platformFilters = useMemo(() => filters.filter((f) => f.platform === platform), [filters, platform]);

  // Autopilot is a Windows-only enrollment path -- disable the whole section off Windows.
  const autopilotDisabled = platform !== "windows";

  const nameById = useMemo(() => new Map(groups.map((g) => [g.id, g.displayName])), [groups]);

  // For a group selected because of nesting: the selected groups inside it
  // that put it there, named in its pill.
  const nestedVia = useMemo(() => {
    const via = new Map<string, string[]>();
    const auto = new Set(nestedAutoIds);
    for (const id of selectedGroupIds) {
      if (auto.has(id)) continue;
      for (const parent of groups.find((g) => g.id === id)?.parentGroupIds ?? []) {
        if (!auto.has(parent)) continue;
        via.set(parent, [...(via.get(parent) ?? []), nameById.get(id) ?? id]);
      }
    }
    return via;
  }, [groups, selectedGroupIds, nestedAutoIds, nameById]);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* Col 1: Platform + Autopilot */}
        <div className="flex w-full shrink-0 flex-col gap-2.5">
          {deviceLookup}
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">Platform</div>
            <div className="grid grid-cols-4 gap-0.5 rounded-lg border border-ink-700 bg-ink-800 p-0.5">
              {PLATFORM_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onTogglePlatform(opt.value)}
                  aria-pressed={platform === opt.value}
                  title={`Simulate a ${opt.label} endpoint`}
                  className={`rounded px-1 py-1.5 text-center text-[11px] font-medium transition-colors ${
                    platform === opt.value ? "bg-sky-500/20 text-sky-300" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {opt.short}
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
              {autopilotDisabled && (
                <span className="ml-1 normal-case tracking-normal text-slate-600">(Windows only)</span>
              )}
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

          {/* Device filters used to be a third column of their own, `lg:w-56`
              of mostly empty space -- a tenant with no filters for the selected
              platform spent it on the words "No filters for this platform",
              and the groups list, which is the control people actually work in,
              was narrowed to pay for it. As a dropdown here it costs one row,
              and the groups column spans what it used to take. */}
          <DeviceFilterSelect filters={platformFilters} selectedIds={deviceFilterIds} onToggle={onToggleDeviceFilter} />
        </div>

        {/* Col 2: Entra security groups -- the primary, most-used control, so it gets the width */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
          <div
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
            title="All Devices and All Users always apply, and dynamic group rules are checked for implied memberships. Entra security groups this device/user belongs to. Expand “membership rule” on a dynamic group to read the rule that decides whether a device lands in it; rules we could not fully evaluate open on their own. If a selected group's rule logically implies membership in another dynamic group (e.g. a narrower OrderID prefix), that group is added automatically and shown in amber in the diagram. Entering a Group Tag above auto-selects groups scoped to it."
          >
            <span>
              Entra security groups
              {selectedGroupIds.length > 0 && (
                <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-sky-300">
                  {selectedGroupIds.length} selected
                </span>
              )}
            </span>
            <span className="font-normal normal-case tracking-normal text-slate-600">
              All Devices &amp; All Users always apply
            </span>
          </div>
          {platform === "windows" && profileWarnings.length > 0 && <ProfileWarnings warnings={profileWarnings} />}
          {verifiedDevice ? (
            <div className="text-[10px] leading-snug text-emerald-300/80">
              Checked against {verifiedDevice.name}: ✓ marks the groups it is in.
            </div>
          ) : (
            mayInclude > 0 && (
              <div
                className="text-[10px] leading-snug text-amber-300/80"
                title="These dynamic groups' rules depend on properties this simulation does not model, such as the enrollment profile name or the device model. Expand a rule to check it, or start from a real device to use its actual memberships."
              >
                {mayInclude} dynamic group{mayInclude === 1 ? "" : "s"} may include this device. Check the rule, or
                start from a real device.
              </div>
            )
          )}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search groups…"
            className="mb-1 w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
          {/* Takes the height the sidebar has left. A floor, so that on a
              short window the list is still a list and not a two-row slot. */}
          <div className="min-h-[9rem] flex-1 overflow-y-auto rounded-md border border-ink-700">
            {sortedGroups.map((g) => {
              const tm = trimmedGroupTag
                ? classifyGroupTagMatch(g.membershipRule, trimmedGroupTag)
                : ({ state: "none", fullyEvaluated: true } as const);
              const isMatch = tm.state === "match";
              const isConditional = tm.state === "conditional";
              const tagScope = groupTagScope(g.membershipRule);
              const isAutopilotJoined = isAutopilotJoinedRule(g.membershipRule);
              // A group that keys on Autopilot ([ZTDId]) but ANDs it with a device
              // condition we can't evaluate -- surface it for opt-in (not auto-select)
              // when simulating an Autopilot device, the way Group Tag "+ conditions" is.
              const isAutopilotConditional =
                autopilotOn && classifyAutopilotMatch(g.membershipRule).state === "conditional";
              const tagActive = isMatch || isConditional;
              const highlight = tagActive || isAutopilotConditional;
              // Show the rule when we couldn't fully decide it (Group Tag conditional,
              // a tag match that also hinges on other properties, or an Autopilot
              // "+ conditions" group whose extra condition we can't check).
              const stale = g.staleProfileNames ?? [];
              const showRule =
                isConditional || (isMatch && !tm.fullyEvaluated) || isAutopilotConditional || stale.length > 0;
              const via = nestedVia.get(g.id);
              const selected = selectedGroupIds.includes(g.id);
              const verdict = verdicts.get(g.id);
              const unmodelled = unmodelledRuleProperties(g.membershipRule);
              // The tag and Autopilot pills already speak for these rows.
              const otherPillShown = tagActive || isAutopilotConditional || (isAutopilotJoined && isAutopilotDevice);
              const parentNames = (g.parentGroupIds ?? []).map((id) => nameById.get(id) ?? id);
              // Every dynamic group's rule is worth being able to read, not just the
              // ones we could not decide: the rule is what determines whether a real
              // device lands in the group at all, and an admin judging an assignment
              // needs it whether or not a Group Tag happens to be typed in. The
              // undecidable ones still open themselves, because there the rule is a
              // warning rather than a detail.
              const canShowRule = Boolean(g.membershipRule);
              const ruleOpen = ruleOverrides[g.id] ?? showRule;
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
                  className={`flex items-start gap-2 border-b border-l-2 border-ink-800 px-2 py-3 text-xs last:border-b-0 transition-colors lg:py-1.5 ${
                    highlight ? "border-l-amber-400/60 bg-amber-500/[0.06]" : "border-l-transparent"
                  } ${locked ? "cursor-default" : "cursor-pointer"} hover:bg-ink-800`}
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
                  <div className="min-w-0 flex-1">
                    {/* Wraps: at sidebar width a long name and two pills do not
                        fit on one line, and the name is the part to read. */}
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <span className="min-w-[8rem] flex-1 break-words leading-snug text-slate-200">
                        {g.displayName}
                        <PortalLink url={g.portalUrl} name={g.displayName} className="ml-1 align-[-3px]" />
                      </span>
                      {/* Tag scope pill — subsumes the "group tag" label: amber when the
                          entered tag matches, muted otherwise; always exposes the [OrderID] scope. */}
                      {tagScope && (
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none ring-1 ring-inset ${
                            tagActive
                              ? "animate-fade-in bg-amber-500/20 text-amber-200 ring-amber-400/30"
                              : "text-slate-500 ring-ink-700"
                          }`}
                          title={tagActive ? `Group Tag match — scope ${tagScope}` : `Group Tag scope ${tagScope}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="9"
                            height="9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            className="shrink-0"
                          >
                            <path d="M20.6 13.4 12 22l-8-8V4h10l6.6 6.6a2 2 0 0 1 0 2.8Z" strokeLinejoin="round" />
                            <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
                          </svg>
                          {tagScope}
                        </span>
                      )}
                      {isMatch && !tm.fullyEvaluated && (
                        <span
                          className="animate-fade-in inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-300/90 ring-1 ring-inset ring-amber-400/40"
                          title={`The Group Tag matches, but this rule also depends on ${unmodelledRuleProperties(g.membershipRule).join(", ") || "properties a Group Tag can't decide"}, so whether this device is in the group is not known. It is not selected automatically: read the rule and tick it if it applies, or start from a real device.`}
                        >
                          + conditions
                        </span>
                      )}
                      {isConditional && (
                        <span
                          className="animate-fade-in inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-300/90 ring-1 ring-inset ring-amber-400/40"
                          title="The Group Tag is referenced in this rule, but full membership can't be confirmed from the tag alone — review the rule and select manually if it applies."
                        >
                          conditional
                        </span>
                      )}
                      {isAutopilotJoined && isAutopilotDevice && (
                        <span
                          className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-300 ring-1 ring-inset ring-amber-400/20"
                          title="Auto-included by the Autopilot device checkbox."
                        >
                          🔒 autopilot
                        </span>
                      )}
                      {isAutopilotConditional && (
                        <span
                          className="animate-fade-in inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-300/90 ring-1 ring-inset ring-amber-400/40"
                          title="An Autopilot ([ZTDId]) group whose rule also depends on a device condition that can't be evaluated here (e.g. excluding Cloud PCs). Review the rule and include it if it applies to this device."
                        >
                          autopilot · + conditions
                        </span>
                      )}
                      {verifiedDevice && deviceGroupIds.has(g.id) && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-none text-emerald-300 ring-1 ring-inset ring-emerald-400/30"
                          title={`${verifiedDevice.name} is in this group, according to Entra when it was loaded.`}
                        >
                          ✓ in device
                        </span>
                      )}
                      {!otherPillShown && !selected && verdict === "member" && (
                        <span
                          className="animate-fade-in inline-flex shrink-0 items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-200 ring-1 ring-inset ring-amber-400/30"
                          title="By its rule, a device set up like this one is in this group, whatever the parts of the rule this simulation cannot check turn out to be. Tick it to include it."
                        >
                          rule matches
                        </span>
                      )}
                      {!otherPillShown && !selected && verdict === "unknown" && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full border border-dashed border-amber-400/40 px-1.5 py-0.5 text-[9px] font-medium leading-none text-amber-300/80"
                          title={
                            unmodelled.length > 0
                              ? `Whether this device is in the group depends on ${unmodelled.join(", ")}, which this simulation does not model. Read the rule to decide, or start from a real device to see its actual groups.`
                              : "This rule's form is not evaluated here, so whether this device is in the group is not known. Read the rule to decide, or start from a real device to see its actual groups."
                          }
                        >
                          may include
                        </span>
                      )}
                      {selected && verdict === "not-member" && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-medium leading-none text-rose-300 ring-1 ring-inset ring-rose-400/30"
                          title="By its rule, a device set up like this one is not in this group — for example, it requires a Group Tag or Autopilot registration this endpoint does not have. It stays selected because you ticked it."
                        >
                          rule says no
                        </span>
                      )}
                      {via && (
                        <span
                          className="animate-fade-in inline-flex shrink-0 items-center rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-none text-sky-300 ring-1 ring-inset ring-sky-400/30"
                          title={`Selected because ${via.join(", ")} ${via.length === 1 ? "is a member" : "are members"} of this group, so the device is too. Untick it to see the device without it.`}
                        >
                          nested · via {via.length === 1 ? via[0] : `${via.length} groups`}
                        </span>
                      )}
                      {parentNames.length > 0 && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-slate-500 ring-1 ring-inset ring-ink-700"
                          title={`A member of ${parentNames.join(", ")}. Selecting this group selects ${parentNames.length === 1 ? "it" : "them"} too.`}
                        >
                          in {parentNames.length} group{parentNames.length === 1 ? "" : "s"}
                        </span>
                      )}
                      {g.nestedOnly && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-slate-500 ring-1 ring-inset ring-ink-700"
                          title="Nothing is assigned to this group directly. It is listed because it sits inside a group that is, which makes it a way a device reaches that group's policies and apps."
                        >
                          nested only
                        </span>
                      )}
                      {stale.length > 0 && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-medium leading-none text-rose-300 ring-1 ring-inset ring-rose-400/30"
                          title={staleProfileTitle(stale)}
                        >
                          {stale.some((s) => s.closest) ? "profile name: spaces differ" : "profile name not found"}
                        </span>
                      )}
                      {g.isDynamic && (
                        <span
                          className="inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium leading-none text-slate-500 ring-1 ring-inset ring-ink-700"
                          title="Dynamic membership group"
                        >
                          dynamic
                        </span>
                      )}
                      {/* `type="button"` and stopping the click matter: this sits
                          inside the row's <label>, so without both, reading a rule
                          would also tick the group's checkbox. */}
                      {canShowRule && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleRule(g.id, ruleOpen);
                          }}
                          aria-expanded={ruleOpen}
                          className="inline-flex items-center gap-1 rounded text-[10px] leading-none text-slate-500 transition-colors hover:text-slate-300"
                          title={ruleOpen ? "Hide the membership rule" : "Show the membership rule"}
                        >
                          <svg
                            width="9"
                            height="9"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={`shrink-0 transition-transform ${ruleOpen ? "rotate-90" : ""}`}
                            aria-hidden="true"
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                          rule
                        </button>
                      )}
                    </div>
                    {canShowRule && ruleOpen && (
                      <div className="mt-1 break-words border-l border-ink-700 pl-2 font-mono text-[10px] leading-relaxed text-slate-500">
                        {g.membershipRule}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
            {sortedGroups.length === 0 && (
              <div className="px-3 py-2 text-center text-xs text-slate-500">
                {loading ? "Loading groups from Intune…" : "No groups found."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tenant-wide: every dynamic group whose rule names an enrollment profile no
 * Autopilot profile has, including groups nothing is assigned to yet -- the
 * ones the list below cannot show. Collapsed to one line, because it is about
 * the tenant rather than this endpoint.
 *
 * Names are printed inside visible quotes with spaces preserved, because the
 * case this most often catches -- a stray space -- is otherwise invisible.
 */
function ProfileWarnings({ warnings }: { warnings: ProfileNameWarning[] }) {
  return (
    <details className="rounded-md border border-rose-400/30 bg-rose-500/[0.06] px-2 py-1 text-[10px] leading-snug text-rose-200/90">
      <summary className="cursor-pointer">
        {warnings.length} dynamic group{warnings.length === 1 ? "" : "s"} name{warnings.length === 1 ? "s" : ""} an
        enrollment profile no Autopilot profile has
      </summary>
      <ul className="mt-1 flex flex-col gap-1.5 pb-1">
        {warnings.map((w) => (
          <li key={w.groupId} className="text-slate-300">
            <span className="font-medium text-slate-200">{w.displayName}</span>
            <PortalLink url={w.portalUrl} name={w.displayName} className="ml-1 align-[-3px]" />
            {!w.assigned && <span className="ml-1 text-slate-500">(nothing assigned)</span>}
            {w.names.map((n) => (
              <span key={n.name} className="block text-slate-400">
                <span className="whitespace-pre font-mono text-rose-200">“{n.name}”</span>
                {n.closest ? (
                  <>
                    {" "}
                    — the profile is <span className="whitespace-pre font-mono text-slate-200">“{n.closest}”</span>;
                    only spaces differ
                  </>
                ) : (
                  " — no profile has this name"
                )}
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p className="border-t border-rose-400/20 pt-1 text-slate-500">
        Usually a profile renamed after the rule was written. A device enrolled under the current name does not match
        that part of the rule, and for an exclusion (-ne / -notIn) it is not excluded. A name kept on purpose for
        devices enrolled before a rename is listed too. Apple and Android profiles are not checked.
      </p>
    </details>
  );
}

/**
 * The explanation behind a "profile name" pill. Spells out the names with
 * visible quotes, because the case it exists for -- a trailing space -- is
 * invisible otherwise.
 */
function staleProfileTitle(stale: { name: string; closest?: string }[]): string {
  const lines = stale.map((s) =>
    s.closest
      ? `The rule compares the enrollment profile name with “${s.name}”, but the profile is called “${s.closest}”. They differ only by spaces at the start or end, and Entra does not ignore those: a device enrolled by this profile does not match this part of the rule.`
      : `The rule compares the enrollment profile name with “${s.name}”, but no Windows Autopilot profile or device preparation policy is called that now. If the profile was renamed or deleted, a device enrolled under its current name does not match this part of the rule.`
  );
  return `${lines.join("\n\n")}\n\nFor an exclusion (-ne / -notIn) that means the device is not excluded. Apple and Android enrollment profiles are not checked.`;
}

/**
 * Device filters, as a dropdown rather than a column.
 *
 * The collapsed trigger NAMES what is selected rather than only counting it.
 * An assignment filter is not a view option -- an exclude filter removes
 * policies from the simulation outright -- so a filter that is on while its
 * control is shut has to stay legible, or the baseline quietly answers a
 * different question from the one on screen. The names also carry the violet
 * the picker's collapsed summary uses for filters, so the two read as the same
 * fact in two places.
 *
 * Multi-select, because a device matches as many filters as its properties
 * satisfy -- Kiosk Devices and Corporate Owned at once is ordinary. Checkboxes
 * rather than a native <select multiple>, which on a phone becomes a modal
 * list that hides the rules.
 */
function DeviceFilterSelect({
  filters,
  selectedIds,
  onToggle,
}: {
  filters: AssignmentFilter[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = filters.filter((f) => selectedIds.includes(f.id));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div>
      <div
        className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
        title="Which Intune Assignment Filters this device matches. A device can match multiple filters simultaneously (e.g. Kiosk Devices + Corporate Owned). Policies whose assignments include/exclude these filters are resolved accordingly."
      >
        Device Filters
        {selected.length > 0 && (
          <span className="ml-1.5 rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-300">{selected.length}</span>
        )}
      </div>

      {filters.length === 0 ? (
        <div className="rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-2 text-[11px] text-slate-500">
          None for this platform
        </div>
      ) : (
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            title="Choose the Assignment Filters this device matches"
            className="flex w-full items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-2 text-left text-xs transition-colors hover:bg-ink-700/60 lg:py-1.5"
          >
            <span className="min-w-0 flex-1">
              {selected.length === 0 ? (
                <span className="text-slate-500">None matched</span>
              ) : (
                <span className="block break-words leading-snug text-violet-300">
                  {selected.map((f) => f.displayName).join(", ")}
                </span>
              )}
            </span>
            <span
              className={`shrink-0 text-[10px] text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
              aria-hidden
            >
              ▾
            </span>
          </button>

          {open && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
              <div
                role="listbox"
                aria-multiselectable
                className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 shadow-2xl"
              >
                {filters.map((f) => (
                  <label
                    key={f.id}
                    className="flex cursor-pointer items-start gap-2 border-b border-ink-800 px-2.5 py-3 text-xs last:border-b-0 hover:bg-ink-800 lg:py-2"
                    title={f.rule}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(f.id)}
                      onChange={() => onToggle(f.id)}
                      className="mt-0.5 shrink-0 accent-violet-400"
                    />
                    <span className="min-w-0 flex-1 break-words leading-snug text-slate-200">{f.displayName}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
