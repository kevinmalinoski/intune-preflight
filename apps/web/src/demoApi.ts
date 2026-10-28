// In-browser implementation of the API surface for the static public demo. It
// runs the EXACT same pure engine the backend uses (computeSimulation,
// buildAssignmentReport, ...) over the bundled sample tenant -- no server, no
// network, nothing leaves the browser. Only bundled when VITE_STATIC_DEMO=1;
// tree-shaken out of the normal (server-backed) build.
import type { Platform } from "@intune-preflight/shared";
import {
  assignmentReportToCsv,
  buildAssignmentReport,
  computeSimulation,
  demoTenantData,
  listAssignmentFilters,
  listGroupSummaries,
  listUnassignedPolicies,
  simulationToCsv,
} from "@intune-preflight/engine";
import type { SimulationInputs } from "./api.ts";
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

export const demoApi = {
  health: () => ok({ status: "ok", demo: true, hasCredentials: false, loadWarnings: [] as string[] }),
  setMode: () => ok({ demo: true, hasCredentials: false, loadWarnings: [] as string[] }),
  groups: () => ok(listGroupSummaries(data())),
  filters: () => ok(listAssignmentFilters(data())),
  unassignedPolicies: () => ok(listUnassignedPolicies(data())),
  assignmentReport: (platform?: Platform) => ok(buildAssignmentReport(data(), platform)),
  assignmentReportExport: (platform?: Platform) =>
    textFile("text/csv", assignmentReportToCsv(buildAssignmentReport(data(), platform))),
  refresh: () => ok({ warnings: [] as string[] }),
  simulate: (inputs: SimulationInputs) => ok(computeSimulation(data(), toInputs(inputs))),
  simulateExport: (inputs: SimulationInputs, format: "json" | "csv") => {
    const sim = computeSimulation(data(), toInputs(inputs));
    return format === "csv"
      ? textFile("text/csv", simulationToCsv(sim))
      : textFile("application/json", JSON.stringify(sim, null, 2));
  },
};
