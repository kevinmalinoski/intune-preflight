import { useMemo, useState } from "react";
import type { Platform, UnassignedPolicy } from "@intune-preflight/shared";

const KIND_SHORT: Record<string, string> = {
  deviceConfiguration: "Device Config",
  settingsCatalog: "Settings Catalog",
  compliancePolicy: "Compliance",
  adminTemplate: "Admin Template",
  platformScript: "Script",
  endpointSecurity: "Endpoint Security (legacy)",
};

/**
 * The Policy Waitlist: policies that exist in the tenant but are assigned to no
 * group, so they never surface through group selection. Ticking one injects it
 * into the simulation -- "what would this do if I assigned it here?".
 *
 * It is the last section of the Endpoint sidebar, because that is what it is:
 * one more input to the endpoint, like a group. It used to be a full-width bar
 * of its own between the inputs and the diagram, where it read as a separate
 * tool and cost the canvas height every time it was opened.
 */
export function PolicyPreflight({
  policies,
  selectedIds,
  onToggle,
  onSelectMany,
  onDeselectMany,
  platform,
}: {
  policies: UnassignedPolicy[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onDeselectMany: (ids: string[]) => void;
  platform: Platform;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const forPlatform = useMemo(() => policies.filter((p) => p.platform === platform), [policies, platform]);
  const filtered = useMemo(
    () =>
      forPlatform
        .filter((p) => p.displayName.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })),
    [forPlatform, search]
  );
  const selectedForPlatform = forPlatform.filter((p) => selectedIds.includes(p.id));
  const selectedCount = selectedForPlatform.length;
  const selectedNames = selectedForPlatform.map((p) => p.displayName).join(", ");
  const none = forPlatform.length === 0;

  // Bulk controls operate on the currently-visible (search-filtered) rows:
  // "Select all" adds them; "Clear" unchecks every selected policy for this OS.
  const visibleIds = filtered.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  return (
    <div className="shrink-0 border-t border-ink-700">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={none}
        aria-expanded={open && !none}
        title="Policies with no group assignment (deployed nowhere in Intune). Add them to simulate what they would do if assigned to this endpoint."
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left enabled:hover:bg-ink-800/50 disabled:cursor-default"
      >
        <span
          className={`shrink-0 text-[10px] text-slate-600 transition-transform ${open && !none ? "rotate-90" : ""}`}
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-orange-300">Policy Waitlist</span>
          <span className="block truncate text-[10px] text-slate-500">
            {none
              ? "No unassigned policies for this OS"
              : selectedCount > 0
                ? selectedNames
                : "What if I assigned these?"}
          </span>
        </span>
        {!none && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] tabular-nums ${
              selectedCount > 0 ? "bg-orange-500/25 text-orange-200" : "bg-orange-500/15 text-orange-300"
            }`}
          >
            {selectedCount > 0 ? `${selectedCount} of ${forPlatform.length}` : forPlatform.length}
          </span>
        )}
      </button>

      {open && !none && (
        <div className="px-3 pb-3">
          <div className="mb-1 flex items-center gap-1.5">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search unassigned…"
              className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-800 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-orange-400 focus:outline-none"
            />
            <button
              onClick={() => onSelectMany(visibleIds)}
              disabled={allVisibleSelected}
              className="shrink-0 rounded-md border border-ink-700 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-ink-800 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              title={search ? "Add every policy matching the search" : "Add every unassigned policy for this OS"}
            >
              All{search && filtered.length !== forPlatform.length ? ` (${filtered.length})` : ""}
            </button>
            <button
              onClick={() => onDeselectMany(forPlatform.map((p) => p.id))}
              disabled={selectedCount === 0}
              className="shrink-0 rounded-md border border-ink-700 px-2 py-1.5 text-[11px] text-slate-300 hover:bg-ink-800 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              title="Uncheck every added policy for this OS"
            >
              Clear
            </button>
          </div>
          <div className="max-h-[38vh] overflow-y-auto rounded-md border border-ink-700 lg:max-h-56">
            {filtered.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2 border-b border-ink-800 px-2.5 py-3 text-xs hover:bg-ink-800 lg:py-1.5"
                title={`${p.displayName} — ${KIND_SHORT[p.kind] ?? p.kind}, ${p.settingsCount} setting${p.settingsCount === 1 ? "" : "s"} (no group assignment)`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(p.id)}
                  onChange={() => onToggle(p.id)}
                  className="mt-0.5 shrink-0 accent-orange-400"
                />
                <span className="min-w-0 flex-1">
                  <span className="block break-words leading-snug text-slate-200">{p.displayName}</span>
                  <span className="text-[10px] text-slate-500">
                    {KIND_SHORT[p.kind] ?? p.kind} · {p.settingsCount} setting{p.settingsCount === 1 ? "" : "s"}
                  </span>
                </span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-center text-xs text-slate-500">No matching unassigned policies.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
