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

const data = () => demoTenantData();
const ok = <T>(v: T) => Promise.resolve(v);

const toInputs = (i: SimulationInputs) => ({
  selectedGroupIds: i.groupIds ?? [],
  platform: i.platform,
  deviceFilterIds: i.deviceFilterIds ?? [],
  unassignedPolicyIds: i.unassignedPolicyIds ?? [],
});

// A data: URL so the download anchors (which carry a `download` attribute) save a
// real file client-side, no backend Content-Disposition needed.
const fileUrl = (mime: string, text: string) => `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;

export const demoApi = {
  health: () => ok({ status: "ok", demo: true, hasCredentials: false, loadWarnings: [] as string[] }),
  setMode: () => ok({ demo: true, hasCredentials: false, loadWarnings: [] as string[] }),
  groups: () => ok(listGroupSummaries(data())),
  filters: () => ok(listAssignmentFilters(data())),
  unassignedPolicies: () => ok(listUnassignedPolicies(data())),
  assignmentReport: (platform?: Platform) => ok(buildAssignmentReport(data(), platform)),
  assignmentReportCsvUrl: (platform?: Platform) =>
    fileUrl("text/csv", assignmentReportToCsv(buildAssignmentReport(data(), platform))),
  refresh: () => ok({ warnings: [] as string[] }),
  simulate: (inputs: SimulationInputs) => ok(computeSimulation(data(), toInputs(inputs))),
  simulateExportUrl: (inputs: SimulationInputs, format: "json" | "csv") => {
    const sim = computeSimulation(data(), toInputs(inputs));
    return format === "csv"
      ? fileUrl("text/csv", simulationToCsv(sim))
      : fileUrl("application/json", JSON.stringify(sim, null, 2));
  },
};
