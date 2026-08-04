import { useMemo, useState, type KeyboardEvent } from "react";
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
 * A standalone, independently-collapsible bar for "preflighting" unassigned
 * policies: policies that exist in the tenant but are deployed to no group, so
 * they never surface through normal group selection. Adding one injects it into
 * the simulation ("what would this do if I assigned it to this endpoint?").
 * Kept separate from the endpoint picker so collapsing the picker doesn't hide
 * it, and vice versa.
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
  const selectedCount = selectedIds.filter((id) => forPlatform.some((p) => p.id === id)).length;
  const none = forPlatform.length === 0;

  // Bulk controls operate on the currently-visible (search-filtered) rows:
  // "Select all" adds them; "Clear" unchecks every selected policy for this OS.
  const visibleIds = filtered.map((p) => p.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));

  return (
    <div className="border-b border-ink-700 bg-ink-900 px-4 py-2">
      {/* The whole header bar toggles the panel -- a big, forgiving click target. */}
      <div
        className={`-mx-4 -mt-2 flex items-center gap-2 px-4 py-2 ${none ? "" : "cursor-pointer hover:bg-ink-800/50 rounded-b-md"} ${open ? "mb-2" : "-mb-2"}`}
        title="Policies with no group assignment (deployed nowhere in Intune). Add them to simulate what they would do if assigned to this endpoint."
        {...(none
          ? {}
          : {
              role: "button" as const,
              tabIndex: 0,
              "aria-expanded": open,
              onClick: () => setOpen((o) => !o),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen((o) => !o);
                }
              },
            })}
      >
        <span className="text-base" aria-hidden>🎫</span>
        <span className="text-sm font-semibold text-orange-300">Policy Waitlist</span>
        {none ? (
          <span className="text-xs text-slate-600">— no unassigned policies for this OS</span>
        ) : (
          <>
            <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[11px] text-orange-300">{forPlatform.length}</span>
            {selectedCount > 0 && (
              <span className="rounded bg-orange-500/25 px-1.5 py-0.5 text-[11px] text-orange-200">{selectedCount} added</span>
            )}
            <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
              — unassigned policies waiting to board; add one to simulate “what if I assigned this?”
            </span>
          </>
        )}
        {!none && (
          <span className="ml-auto shrink-0 rounded-md border border-ink-700 px-2.5 py-1 text-xs text-slate-300">
            {open ? "Collapse ▴" : "Edit ▾"}
          </span>
        )}
      </div>

      {open && !none && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search unassigned policies…"
              className="w-full max-w-md rounded-md border border-ink-700 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:border-orange-400 focus:outline-none"
            />
            <button
              onClick={() => onSelectMany(visibleIds)}
              disabled={allVisibleSelected}
              className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-ink-800 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              title={search ? "Add every policy matching the search" : "Add every unassigned policy for this OS"}
            >
              Select all{search && filtered.length !== forPlatform.length ? ` (${filtered.length})` : ""}
            </button>
            <button
              onClick={() => onDeselectMany(forPlatform.map((p) => p.id))}
              disabled={selectedCount === 0}
              className="shrink-0 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-ink-800 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              title="Uncheck every added policy for this OS"
            >
              Clear
            </button>
          </div>
          <div
            className="grid grid-cols-1 gap-x-4 overflow-y-auto rounded-md border border-ink-700 sm:grid-cols-2 lg:grid-cols-3"
            style={{ maxHeight: "160px" }}
          >
            {filtered.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-start gap-2 border-b border-ink-800 px-2.5 py-1.5 text-xs hover:bg-ink-800"
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
