// @ts-nocheck -- imports the server's pure engine via the Vite "@engine" alias,
// which the web tsconfig doesn't know about. Type safety is preserved at the call
// site: api.ts casts this to `typeof serverApi`.
//
// In-browser implementation of the API surface for the static public demo. It
// runs the EXACT same pure engine the backend uses (computeSimulation,
// buildAssignmentReport, ...) over the bundled sample tenant -- no server, no
// network, nothing leaves the browser. Only bundled when VITE_STATIC_DEMO=1;
// tree-shaken out of the normal (server-backed) build.
import {
  assignmentReportToCsv,
  buildAssignmentReport,
  computeSimulation,
  listAssignmentFilters,
  listGroupSummaries,
  listUnassignedPolicies,
  simulationToCsv,
} from "@engine/baseline";
import { demoTenantData } from "@engine/demo/demoTenant";

const data = () => demoTenantData();
const ok = (v) => Promise.resolve(v);

const toInputs = (i) => ({
  selectedGroupIds: i.groupIds ?? [],
  platform: i.platform,
  deviceFilterIds: i.deviceFilterIds ?? [],
  unassignedPolicyIds: i.unassignedPolicyIds ?? [],
});

// A data: URL so the download anchors (which carry a `download` attribute) save a
// real file client-side, no backend Content-Disposition needed.
const fileUrl = (mime, text) => `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;

export const demoApi = {
  health: () => ok({ status: "ok", demo: true, hasCredentials: false, loadWarnings: [] }),
  setMode: () => ok({ demo: true, hasCredentials: false }),
  groups: () => ok(listGroupSummaries(data())),
  filters: () => ok(listAssignmentFilters(data())),
  unassignedPolicies: () => ok(listUnassignedPolicies(data())),
  assignmentReport: (platform) => ok(buildAssignmentReport(data(), platform)),
  assignmentReportCsvUrl: (platform) =>
    fileUrl("text/csv", assignmentReportToCsv(buildAssignmentReport(data(), platform))),
  refresh: () => ok({ warnings: [] }),
  simulate: (inputs) => ok(computeSimulation(data(), toInputs(inputs))),
  simulateExportUrl: (inputs, format) => {
    const sim = computeSimulation(data(), toInputs(inputs));
    return format === "csv"
      ? fileUrl("text/csv", simulationToCsv(sim))
      : fileUrl("application/json", JSON.stringify(sim, null, 2));
  },
};
