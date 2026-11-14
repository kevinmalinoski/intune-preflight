import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SimulationResult } from "@intune-preflight/shared";
import type { AppsExportFormat } from "./api.ts";
import { AppsList, type AppsFocus } from "./AppsList.tsx";
import { ExportMenu } from "./ExportMenu.tsx";

/**
 * Apps beside the diagram: the rail's second tab, at `lg` and up.
 *
 * Same shell as BaselinePeek, so switching tabs changes the body and nothing
 * around it moves.
 */
/**
 * The Apps export: the same "Export ▾" menu the baseline has, for the same two
 * table formats. Only offered when there are apps to save: with the permission
 * missing there is no table, and a menu that downloads an empty file would say
 * otherwise.
 */
function ExportApps({
  simulation,
  onExport,
}: {
  simulation: SimulationResult;
  onExport?: (format: AppsExportFormat) => void;
}) {
  const [open, setOpen] = useState(false);
  const apps = simulation.apps;
  if (!onExport || !apps || apps.unavailable || apps.apps.length + apps.excluded.length === 0) return null;
  return (
    <ExportMenu<AppsExportFormat>
      open={open}
      onOpenChange={setOpen}
      onExport={(format) => onExport(format)}
      className={`shrink-0 rounded-md border px-2.5 py-1.5 text-xs ${
        open ? "border-sky-400/50 bg-sky-500/10 text-sky-300" : "border-ink-700 text-slate-300 hover:bg-ink-800"
      }`}
      options={[
        {
          format: "apps-xlsx",
          label: "Excel workbook (.xlsx)",
          hint: "Apps, plus a sheet defining how each flag is detected",
        },
        { format: "apps-csv", label: "CSV (.csv)", hint: "The apps table only, for scripts" },
      ]}
    />
  );
}

export function AppsPeek({
  simulation,
  focus,
  tabs,
  onExport,
  showAvailable,
  onShowAvailableChange,
}: {
  simulation: SimulationResult;
  focus?: AppsFocus | null;
  tabs?: ReactNode;
  onExport?: (format: AppsExportFormat) => void;
  showAvailable: boolean;
  onShowAvailableChange: (show: boolean) => void;
}) {
  return (
    <aside
      aria-label="Apps"
      className="relative flex shrink-0 flex-col border-t border-ink-700 bg-ink-900 lg:h-full lg:min-h-0 lg:w-96 lg:border-l lg:border-t-0"
    >
      {tabs}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Apps for this endpoint</span>
        </div>
        <ExportApps simulation={simulation} onExport={onExport} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-ink-800">
        <AppsList
          simulation={simulation}
          focus={focus}
          showAvailable={showAvailable}
          onShowAvailableChange={onShowAvailableChange}
        />
      </div>
    </aside>
  );
}

/**
 * Apps as a docked panel, wherever there is no rail: below `lg`, and in focus
 * mode. Docked rather than modal for the reason the baseline panel is -- the
 * diagram stays usable beside it -- so it is a `dialog` without aria-modal.
 */
export function AppsPanel({
  simulation,
  focus,
  onClose,
  onExport,
  showAvailable,
  onShowAvailableChange,
}: {
  simulation: SimulationResult;
  focus?: AppsFocus | null;
  onClose: () => void;
  onExport?: (format: AppsExportFormat) => void;
  showAvailable: boolean;
  onShowAvailableChange: (show: boolean) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Apps"
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-ink-700 bg-ink-900 shadow-2xl outline-none"
    >
      <div className="flex items-start justify-between border-b border-ink-700 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs uppercase tracking-wide text-slate-400">Apps for this endpoint</div>
        </div>
        <ExportApps simulation={simulation} onExport={onExport} />
        <button
          onClick={onClose}
          aria-label="Close apps"
          className="ml-2 shrink-0 rounded-md border border-ink-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-ink-800"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AppsList
          simulation={simulation}
          focus={focus}
          showAvailable={showAvailable}
          onShowAvailableChange={onShowAvailableChange}
        />
      </div>
    </div>
  );
}
