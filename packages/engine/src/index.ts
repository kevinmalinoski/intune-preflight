/**
 * The Intune Preflight engine: the pure, I/O-free core that turns a whole
 * tenant's configuration (`TenantData`) into a simulated endpoint's baseline,
 * assignment report and exports.
 *
 * Nothing in this package touches the network, the filesystem, `process.env`,
 * or any Node built-in. That's not incidental -- it's what lets the SAME code
 * run behind the Fastify API (`apps/server`) and, for the public demo, entirely
 * in the browser over the bundled sample tenant (`apps/web`, VITE_STATIC_DEMO).
 * Keep it that way: a value import from a server-only module here would break
 * the demo build.
 */

export type { TenantData } from "./tenantData.js";

// Assignment resolution, merged baseline, conflict/overlap/cross-model
// detection, the assignment report, and the CSV exports.
export {
  assignmentReportToCsv,
  buildAssignmentReport,
  computeSimulation,
  listAssignmentFilters,
  listGroupSummaries,
  listUnassignedPolicies,
  simulationToCsv,
} from "./baseline.js";

// Graph -> CSP-setting normalizers, platform classification, assignment-target
// parsing, and the flat dynamic-membership-rule helpers.
export {
  flattenIntentSettings,
  flattenScriptToCspSettings,
  flattenSettingsCatalogEntries,
  flattenToCspSettings,
  indexIntentSettingDefinitions,
  isLegacyTemplateType,
  isSecurityIntentTemplate,
  mapWellKnownGroupId,
  parseAssignmentTarget,
  platformFromAssignmentFilter,
  platformFromIntentTemplate,
  platformFromOdataType,
  platformFromSettingsCatalog,
  ruleImplies,
  VIRTUAL_GROUP_ALL_DEVICES,
  VIRTUAL_GROUP_ALL_USERS,
} from "./normalize.js";
export type { IntentSettingDef } from "./normalize.js";

// The canonical CSP crosswalk behind cross-model collision detection.
export { crosswalkTemplateSetting, normalizeCspNode } from "./crosswalk.js";

// The bundled synthetic sample tenant that backs Demo mode and the public demo.
export { demoTenantData } from "./demo/demoTenant.js";
