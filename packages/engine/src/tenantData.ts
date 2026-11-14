import type {
  AppsUnavailable,
  AssignmentFilter,
  AutopilotProfile,
  IntuneApp,
  IntuneGroup,
  IntunePolicy,
} from "@intune-preflight/shared";

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
  /**
   * Assigned apps. Optional because apps sit outside the baseline: a source
   * with no app data (the demo tenant) simply has no Apps view.
   */
  apps?: IntuneApp[];
  /** Set instead of `apps` when a real tenant's apps could not be read. Not a warning -- see AppsUnavailable. */
  appsUnavailable?: AppsUnavailable;
  /** Non-empty when the load was incomplete (a category or item failed after retries). */
  warnings?: string[];
}
