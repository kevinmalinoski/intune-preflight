import type { AssignmentFilter, AutopilotProfile, IntuneGroup, IntunePolicy } from "@intune-preflight/shared";

/**
 * Everything the engine needs to compute a baseline: the whole tenant's
 * configuration, already normalized out of Graph's many shapes.
 *
 * This is the engine's INPUT contract, which is why it lives here rather than
 * in the layer that fetches it. Producing one is `apps/server`'s job (from
 * Microsoft Graph) or the bundled demo tenant's (from static sample data) --
 * and because the engine only ever reads a TenantData, it stays pure and runs
 * unchanged in Node and in the browser.
 */
export interface TenantData {
  policies: IntunePolicy[];
  groups: IntuneGroup[];
  autopilotProfiles: AutopilotProfile[];
  assignmentFilters: AssignmentFilter[];
  /** Non-empty when the load was incomplete (a category or item failed after retries). */
  warnings?: string[];
}
