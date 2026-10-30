// In-browser implementation of the API surface for the static public demo. It
// runs the EXACT same pure engine the backend uses (computeSimulation,
// buildAssignmentReport, ...) over the bundled sample tenant -- no server, no
// network, nothing leaves the browser. Only bundled when VITE_STATIC_DEMO=1;
// tree-shaken out of the normal (server-backed) build.
import type { Platform } from "@intune-preflight/shared";
import {
  assignmentReportToCsv,
  assignmentReportToXlsx,
  buildAssignmentReport,
  computeSimulation,
  demoTenantData,
  listAssignmentFilters,
  listGroupSummaries,
  listUnassignedPolicies,
  narrowSimulation,
  simulationToCsv,
  simulationToXlsx,
  XLSX_MIME,
  type BaselineCriteria,
} from "@intune-preflight/engine";
import type { BaselineExportFormat, ManifestExportFormat, SimulationInputs } from "./api.ts";
import type { Download } from "./download.ts";

const data = () => demoTenantData();
const ok = <T>(v: T) => Promise.resolve(v);

const toInputs = (i: SimulationInputs) => ({
  selectedGroupIds: i.groupIds ?? [],
  platform: i.platform,
  deviceFilterIds: i.deviceFilterIds ?? [],
  unassignedPolicyIds: i.unassignedPolicyIds ?? [],
});

// There is no backend to set a Content-Disposition, so hand the bytes straight
// to `saveDownload` and let it write the file client-side. This used to be a
// `data:` URL on the download anchor, which Safari refuses outright -- see
// download.ts for what that looked like on iPadOS.
const textFile = (mime: string, text: string): Download => ({ kind: "text", text, mime });
/** The xlsx export is a ZIP, so it goes to the Blob as bytes rather than text. */
const xlsxFile = (bytes: Uint8Array): Download => ({ kind: "bytes", bytes, mime: XLSX_MIME });

export const demoApi = {
  health: () => ok({ status: "ok", demo: true, hasCredentials: false, loadWarnings: [] as string[] }),
  setMode: () => ok({ demo: true, hasCredentials: false, loadWarnings: [] as string[] }),
  groups: () => ok(listGroupSummaries(data())),
  filters: () => ok(listAssignmentFilters(data())),
  unassignedPolicies: () => ok(listUnassignedPolicies(data())),
  assignmentReport: (platform?: Platform) => ok(buildAssignmentReport(data(), platform)),
  assignmentReportExport: (platform?: Platform, format: ManifestExportFormat = "csv") => {
    const report = buildAssignmentReport(data(), platform);
    return format === "xlsx"
      ? xlsxFile(assignmentReportToXlsx(report))
      : textFile("text/csv", assignmentReportToCsv(report));
  },
  refresh: () => ok({ warnings: [] as string[] }),
  simulate: (inputs: SimulationInputs) => ok(computeSimulation(data(), toInputs(inputs))),
  simulateExport: (inputs: SimulationInputs, format: BaselineExportFormat, criteria?: BaselineCriteria) => {
    // Narrowed in the tab, because the tab already holds the simulation. The
    // server build sends the criteria over the wire instead; both end up in
    // narrowSimulation, so a filtered export is the same rows wherever it is
    // produced.
    const sim = narrowSimulation(computeSimulation(data(), toInputs(inputs)), criteria);
    if (format === "xlsx") return xlsxFile(simulationToXlsx(sim));
    return format === "csv"
      ? textFile("text/csv", simulationToCsv(sim))
      : textFile("application/json", JSON.stringify(sim, null, 2));
  },
};
