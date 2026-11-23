import { useEffect, useRef, useState } from "react";
import {
  DEVICE_ACTIVE_DAYS,
  type DeviceLookupUnavailable,
  type DeviceMembership,
  type DeviceSearchResult,
  type Platform,
} from "@intune-preflight/shared";
import { api } from "./api.ts";
import { PLATFORM_OPTIONS } from "./platforms.ts";

/** What the simulator was last started from, for the note under the search. */
export interface LoadedDevice {
  name: string;
  /**
   * Set when the device's OS maps to none of the four platforms (Linux, or
   * blank): the simulator kept `keptPlatform`, and the note must say so rather
   * than present that platform as the device's.
   */
  unrecognisedOs?: string;
  keptPlatform?: Platform;
  /** Groups the device is in that carry something this tenant assigns for its OS. */
  matched: number;
  /** Every group the device is in. */
  total: number;
  /** Every group the device is in, as read: what the picker checks itself against. */
  groupIds: string[];
  /** The device's groups that nothing in this tenant is assigned to. */
  unassignedGroups: { displayName: string; membershipRule?: string }[];
  enrollmentProfileName?: string;
  /** The device Assignment Filters for its platform, as Intune evaluated them. */
  filters?: { displayName: string; matches: boolean }[];
  /** Set instead of `filters` when Intune could not evaluate them. */
  filtersUnchecked?: string;
}

/** The note's filter line: which filters Intune says the device matches. */
function filterLine(filters: { displayName: string; matches: boolean }[]): string | null {
  if (filters.length === 0) return null;
  const matched = filters.filter((f) => f.matches).map((f) => `“${f.displayName}”`);
  if (matched.length === 0) {
    return filters.length === 1
      ? `Doesn’t match the one Assignment Filter for its platform.`
      : `Matches none of the ${filters.length} Assignment Filters for its platform.`;
  }
  return `Matches ${matched.length === 1 ? "filter" : "filters"} ${matched.join(", ")}, per Intune; ticked.`;
}

/**
 * "Load a real device": search Entra devices by name and start the simulated
 * endpoint from one -- its OS, Autopilot registration, Group Tag and the groups
 * it is actually in, nesting included.
 *
 * It answers the question the hand-built endpoint cannot: which groups a real
 * machine is in that nobody expected. Everything it sets stays editable
 * afterwards, so it is a starting point, not a lock.
 */
/** Says how many name matches the search left out, and why. */
function hiddenNote(n: number): string {
  return `${n} more ${n === 1 ? "is" : "are"} hidden: not managed by Intune, disabled, or not signed in for ${DEVICE_ACTIVE_DAYS} days.`;
}

export function DeviceLookup({
  loaded,
  onLoad,
  onClear,
}: {
  loaded: LoadedDevice | null;
  onLoad: (membership: DeviceMembership) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DeviceSearchResult[]>([]);
  const [hidden, setHidden] = useState(0);
  const [searching, setSearching] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<DeviceLookupUnavailable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced: a search per keystroke would be a Graph call per keystroke.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults([]);
      setHidden(0);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchDevices(text, controller.signal)
        .then((res) => {
          if ("unavailable" in res) {
            setUnavailable(res.unavailable);
            setResults([]);
            setHidden(0);
          } else {
            setUnavailable(null);
            setResults(res.devices);
            setHidden(res.hidden ?? 0);
          }
          setError(null);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => !controller.signal.aborted && setSearching(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Close the result list on a click elsewhere or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = async (device: DeviceSearchResult) => {
    setLoadingId(device.id);
    setError(null);
    try {
      const res = await api.deviceMembership(device.id);
      if ("unavailable" in res) {
        setUnavailable(res.unavailable);
        return;
      }
      onLoad(res.membership);
      setOpen(false);
      setQuery("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={boxRef}>
      <div
        className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500"
        title="Search your tenant's active Intune-managed devices by name and start from one: its OS, Autopilot registration, Group Tag and every group it is actually in, including through nested groups. Everything stays editable afterwards."
      >
        Start from a real device{" "}
        <span className="font-normal normal-case tracking-normal text-slate-500">(optional)</span>
      </div>
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Device name…"
          aria-label="Search devices by name"
          className="w-full rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
        />
        {showList && (
          <div className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-ink-700 bg-ink-900 shadow-2xl">
            {unavailable ? (
              <div className="px-2.5 py-2 text-[11px] leading-relaxed text-amber-300">{unavailable.detail}</div>
            ) : error ? (
              <div className="px-2.5 py-2 text-[11px] text-red-400">{error}</div>
            ) : searching && results.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-slate-500">Searching…</div>
            ) : results.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] leading-relaxed text-slate-500">
                {hidden > 0
                  ? `No active Intune-managed device name starts with that. ${hiddenNote(hidden)}`
                  : "No device name starts with that."}
              </div>
            ) : (
              <>
                {results.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => choose(d)}
                    disabled={loadingId !== null}
                    className="flex w-full items-baseline gap-2 border-b border-ink-800 px-2.5 py-2 text-left text-xs last:border-b-0 hover:bg-ink-800 disabled:cursor-wait"
                  >
                    <span className="min-w-0 flex-1 break-words text-slate-200">{d.displayName}</span>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {loadingId === d.id
                        ? "Reading groups…"
                        : [d.operatingSystem, d.trustType].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                ))}
                {hidden > 0 && (
                  <div className="px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-500">{hiddenNote(hidden)}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {loaded && (
        <div className="mt-1.5 flex items-start gap-2 rounded-md border border-sky-400/30 bg-sky-500/[0.07] px-2 py-1.5 text-[11px] leading-snug text-slate-300">
          <span className="min-w-0 flex-1">
            Started from <span className="font-medium text-slate-100">{loaded.name}</span>: in {loaded.total} group
            {loaded.total === 1 ? "" : "s"}, {loaded.matched} of which this tenant assigns to.
            {loaded.unrecognisedOs !== undefined && (
              <span className="block text-amber-300">
                {loaded.unrecognisedOs
                  ? `Its OS, “${loaded.unrecognisedOs}”, is not one Preflight simulates.`
                  : "Entra reports no OS for it."}{" "}
                The platform was left at{" "}
                {PLATFORM_OPTIONS.find((p) => p.value === loaded.keptPlatform)?.label ?? loaded.keptPlatform}; check it
                before trusting the result.
              </span>
            )}
            {loaded.enrollmentProfileName && (
              <span className="block text-slate-500">Enrollment profile: “{loaded.enrollmentProfileName}”</span>
            )}
            {loaded.filters && filterLine(loaded.filters) && (
              <span className="block text-slate-500">{filterLine(loaded.filters)}</span>
            )}
            {loaded.filtersUnchecked && <span className="block text-amber-300">{loaded.filtersUnchecked}</span>}
            {loaded.unassignedGroups.length > 0 && (
              <details className="mt-0.5 text-slate-500">
                <summary className="cursor-pointer hover:text-slate-300">
                  {loaded.unassignedGroups.length} with nothing assigned
                </summary>
                <ul className="mt-0.5 list-disc pl-4">
                  {loaded.unassignedGroups.map((g) => (
                    <li key={g.displayName} className="break-words">
                      {g.displayName}
                      {g.membershipRule && (
                        <span className="block font-mono text-[10px] leading-relaxed text-slate-600">
                          {g.membershipRule}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </span>
          <button
            type="button"
            onClick={onClear}
            aria-label="Dismiss"
            title="Dismiss. The endpoint stays as it is, but groups are no longer checked against this device."
            className="shrink-0 text-slate-500 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
