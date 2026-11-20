import { useEffect, useRef, useState } from "react";
import type { DeviceLookupUnavailable, DeviceMembership, DeviceSearchResult } from "@intune-preflight/shared";
import { api } from "./api.ts";

/** What the simulator was last started from, for the note under the search. */
export interface LoadedDevice {
  name: string;
  /** Groups the device is in that carry something this tenant assigns. */
  matched: number;
  /** Every group the device is in. */
  total: number;
  /** Every group the device is in, as read: what the picker checks itself against. */
  groupIds: string[];
  /** The device's groups that nothing in this tenant is assigned to. */
  unassignedGroups: { displayName: string; membershipRule?: string }[];
  enrollmentProfileName?: string;
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
          } else {
            setUnavailable(null);
            setResults(res.devices);
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
        title="Search your tenant's devices by name and start from one: its OS, Autopilot registration, Group Tag and every group it is actually in, including through nested groups. Everything stays editable afterwards."
      >
        Start from a real device
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
              <div className="px-2.5 py-2 text-[11px] text-slate-500">No device name starts with that.</div>
            ) : (
              results.map((d) => (
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
              ))
            )}
          </div>
        )}
      </div>
      {loaded && (
        <div className="mt-1.5 flex items-start gap-2 rounded-md border border-sky-400/30 bg-sky-500/[0.07] px-2 py-1.5 text-[11px] leading-snug text-slate-300">
          <span className="min-w-0 flex-1">
            Started from <span className="font-medium text-slate-100">{loaded.name}</span>: in {loaded.total} group
            {loaded.total === 1 ? "" : "s"}, {loaded.matched} of which this tenant assigns to.
            {loaded.enrollmentProfileName && (
              <span className="block text-slate-500">Enrollment profile: “{loaded.enrollmentProfileName}”</span>
            )}
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
