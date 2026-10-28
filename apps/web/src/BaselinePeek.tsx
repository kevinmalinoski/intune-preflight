import { useMemo, useState, useSyncExternalStore } from "react";
import type { SimulationResult } from "@intune-preflight/shared";
import { BaselineSettingList } from "./BaselineSettingList.tsx";
import { buildRows } from "./baselineRow.ts";
import { readStored, writeStored } from "./storage.ts";
import { isCompact, subscribeLayout } from "./viewport.ts";

const OPEN_KEY = "baselinePeekOpen";

/**
 * The merged baseline beside the diagram rather than on top of it.
 *
 * The baseline is the answer this tool exists to produce, and until now reading
 * it meant covering the thing that produced it: click "View merged baseline",
 * read the drawer, close the drawer, change a group, repeat. Cause and effect
 * were never on screen at the same time.
 *
 * So the CSP-area accordion lives here permanently -- a rail at `lg` and up, a
 * collapsible bar below it -- and tick a group and you watch both the graph and
 * the conflict count move. The full panel is still one click away for the
 * things a 24rem rail cannot do: the five-column grid, the exports, the column
 * picker, a drill-down scope.
 *
 * It renders `BaselineSettingList` over `buildRows`, which is what the panel's
 * own compact renderer does, so the rail and the panel cannot show a different
 * baseline for the same simulation.
 */
export function BaselinePeek({ simulation, onOpen }: { simulation: SimulationResult; onOpen: () => void }) {
  const compact = useSyncExternalStore(subscribeLayout, isCompact, () => false);
  const [expanded, setExpanded] = useState(() => readStored(OPEN_KEY) === "1");
  // At `lg` and up the rail IS the feature, so there is nothing to collapse.
  // Below it the canvas and the pickers are already competing for a phone's
  // height, so the accordion is a tap away and the bar alone carries the counts.
  const open = !compact || expanded;

  const rows = useMemo(() => buildRows(simulation), [simulation]);

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    writeStored(OPEN_KEY, next ? "1" : "0");
  };

  const { settings, conflicts, layered, overlaps, excludedPolicies } = simulation;
  const counts = (
    <div className="mt-0.5 truncate text-[11px] text-slate-400">
      {settings.length} settings
      {" · "}
      <span className={conflicts.length ? "text-amber-400" : "text-emerald-400"}>{conflicts.length} conflicts</span>
      {/* Only when there are some: the rail is 24rem and this line already
          truncates, so a "0 layered" would cost the overlap count its place. */}
      {layered.length > 0 && <span className="text-indigo-300">{` · ${layered.length} layered`}</span>}
      {" · "}
      <span className={overlaps.length ? "text-sky-400" : "text-emerald-400"}>{overlaps.length} overlaps</span>
      {excludedPolicies.length > 0 && <span className="text-rose-400">{` · ${excludedPolicies.length} excluded`}</span>}
    </div>
  );
  const label = <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Merged baseline</span>;

  return (
    // Below `lg` only the bar is in the layout and the accordion rises OVER the
    // canvas as a sheet (`bottom-full`). Having it take flow height instead is
    // what I built first, and with the picker open as well the diagram was
    // squeezed to nothing at 375px -- three bands each claiming a fraction of
    // the same screen. A sheet cannot do that: the canvas keeps its size and
    // you dismiss the thing covering it. At `lg` the body goes back in flow as
    // the rail's scrolling body.
    <aside
      aria-label="Merged baseline"
      className="relative flex shrink-0 flex-col border-t border-ink-700 bg-ink-900 lg:h-full lg:min-h-0 lg:w-96 lg:border-l lg:border-t-0"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* A button only where it does something: below `lg` the header is the
            one affordance for opening the accordion, at `lg` the rail is
            already open and a disabled button pretending to be a heading is
            worse than a heading. */}
        {compact ? (
          <button onClick={toggle} aria-expanded={open} className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] text-slate-600 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
              {label}
            </div>
            {counts}
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            {label}
            {counts}
          </div>
        )}
        <button
          onClick={onOpen}
          title="Open the full baseline — every column, the exports and the column picker"
          className="shrink-0 rounded-md border border-emerald-400/50 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
        >
          Open ↗
        </button>
      </div>

      {open && (
        <div className="absolute inset-x-0 bottom-full z-20 max-h-[45vh] overflow-y-auto border-t border-ink-800 bg-ink-900 shadow-2xl lg:static lg:z-auto lg:max-h-none lg:min-h-0 lg:flex-1 lg:shadow-none">
          <BaselineSettingList rows={rows} />
        </div>
      )}
    </aside>
  );
}
