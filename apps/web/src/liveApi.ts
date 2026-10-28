/**
 * The third implementation of the API surface: the whole app in a browser tab,
 * reading the signed-in admin's own tenant from Microsoft Graph with no backend
 * at all.
 *
 * It is `demoApi` and `serverApi` joined at the seam `packages/graph` was
 * extracted to create -- the same fetching, paging, retry and v1.0 -> beta
 * fallback the server does (`createGraphClient({ getToken })`), feeding the same
 * pure engine the public demo runs (`computeSimulation`, `buildAssignmentReport`,
 * ...). Nothing here reimplements either side; the only new thing is that the
 * token is delegated and the tenant lives in the tab instead of in a server
 * process.
 *
 * Auth arrives as injected callbacks rather than an import of `./auth.ts`, for
 * the same reason `packages/graph` takes a `getToken`: it keeps the MSAL runtime
 * out of this module, so the shape conformance that `api.ts` type-checks can
 * also be exercised by a test that has no browser.
 */

import type { Platform } from "@intune-preflight/shared";
import {
  assignmentReportToCsv,
  buildAssignmentReport,
  computeSimulation,
  listAssignmentFilters,
  listGroupSummaries,
  listUnassignedPolicies,
  simulationToCsv,
  type TenantData,
} from "@intune-preflight/engine";
import { createGraphClient, loadTenantData, type TenantMode, TtlCache } from "@intune-preflight/graph";
import type { ServerStatus, SimulationInputs } from "./api.ts";
import type { Download } from "./download.ts";
import { setLoadProgress } from "./loadProgress.ts";
import { readSession, removeSession, writeSession } from "./storage.ts";

/**
 * Graph detail calls in flight at once. Lower than the server's eight: a browser
 * shares its connection pool with the page's own requests, and an admin watching
 * a progress counter would rather the UI stayed responsive than shave two
 * seconds off a twelve-second load.
 */
const BROWSER_CONCURRENCY = 6;

/**
 * The cache TTL. `packages/graph` leaves the lifetime to the caller because a
 * server's is its configured TTL while a browser session's is the TAB -- so this
 * is set past any plausible sitting, and the tenant is dropped by `refresh()`, a
 * mode switch, ending the session, or closing the tab. Re-reading 15MB on a
 * timer nobody asked for would be the wrong default here.
 */
const TAB_LIFETIME_SECONDS = 24 * 60 * 60;

/**
 * Which mode the tab was in, so a sign-in redirect comes back to Connected
 * instead of dropping the admin into Demo after they just signed in. Session-
 * scoped like the token itself.
 */
const MODE_KEY = "preflight.live.mode";

/** How often the progress counter is republished during a load. */
const PROGRESS_TICK_MS = 400;

export interface LiveApiDeps {
  /**
   * Brings auth to a usable state: builds MSAL and consumes a sign-in redirect
   * if this load is the tail of one. Idempotent, and a no-op when no tenant is
   * configured -- an unconfigured live build is still a working demo.
   *
   * Every entry point below awaits it, which is what lets `api.ts` do the
   * wiring and `App.tsx` stay unaware that the live build has an extra step.
   */
  ensureReady: () => Promise<void>;
  /** A delegated Graph token for the signed-in admin; called before every attempt. */
  getToken: () => Promise<string>;
  /** Signs in if nobody is. May navigate the page away, in which case it never resolves. */
  ensureSignedIn: () => Promise<void>;
  /** Whether an admin is signed in to this tab right now. Only valid after `ensureReady`. */
  isSignedIn: () => boolean;
  /** Whether a tenant ID and client ID are configured -- the live build's `hasCredentials`. */
  isConfigured: () => boolean;
}

// Stands in for a tenant that has not loaded yet, so the synchronous export-URL
// helpers below can stay synchronous. See the comment on them.
const EMPTY_TENANT: TenantData = { policies: [], groups: [], autopilotProfiles: [], assignmentFilters: [] };

const toInputs = (i: SimulationInputs) => ({
  selectedGroupIds: i.groupIds ?? [],
  platform: i.platform,
  deviceFilterIds: i.deviceFilterIds ?? [],
  unassignedPolicyIds: i.unassignedPolicyIds ?? [],
});

// Same as demoApi: no backend, so the bytes go to `saveDownload` rather than
// onto an anchor as a `data:` URL, which Safari will not save.
const textFile = (mime: string, text: string): Download => ({ kind: "text", text, mime });

export function createLiveApi(deps: LiveApiDeps) {
  const client = createGraphClient({ getToken: deps.getToken, concurrency: BROWSER_CONCURRENCY });
  const cache = new TtlCache(TAB_LIFETIME_SECONDS);

  let mode: TenantMode | null = null;
  let loaded: TenantData | null = null;
  let warnings: string[] = [];
  let inFlight: Promise<TenantData> | null = null;

  /**
   * The current mode, resolved on first use because it depends on whether a
   * sign-in redirect landed on this page load -- which is not known until
   * `ensureReady` has run. A remembered Connected is only honoured if the
   * sign-in actually survived, so a tab whose session has gone comes back in
   * Demo rather than erroring on every read.
   */
  async function ensureMode(): Promise<TenantMode> {
    if (mode) return mode;
    await deps.ensureReady();
    mode = readSession(MODE_KEY) === "connected" && deps.isSignedIn() ? "connected" : "demo";
    return mode;
  }

  /**
   * The loaded tenant, fetching it once per mode. Every read below funnels
   * through here, so the three requests the UI fires on mount share one load
   * rather than starting three.
   */
  function tenant(): Promise<TenantData> {
    if (loaded) return Promise.resolve(loaded);
    if (inFlight) return inFlight;

    inFlight = (async () => {
      const active = await ensureMode();
      // A demo load is synchronous bundled data -- no counter, no spinner.
      const ticker =
        active === "connected"
          ? setInterval(() => {
              setLoadProgress({ phase: "loading", requests: client.getGraphStats().requests });
            }, PROGRESS_TICK_MS)
          : null;
      if (active === "connected") setLoadProgress({ phase: "loading", requests: 0 });
      try {
        const data = await loadTenantData({ client, mode: active, cache });
        loaded = data;
        warnings = active === "connected" ? (data.warnings ?? []) : [];
        setLoadProgress({ phase: "ready", requests: client.getGraphStats().requests });
        return data;
      } catch (err) {
        setLoadProgress({
          phase: "failed",
          requests: client.getGraphStats().requests,
          error: (err as Error).message,
        });
        throw err;
      } finally {
        if (ticker !== null) clearInterval(ticker);
        inFlight = null;
      }
    })();

    return inFlight;
  }

  /** Forgets the loaded tenant so the next read fetches it again. */
  function drop() {
    cache.clear();
    loaded = null;
    warnings = [];
  }

  /**
   * The tenant as it stands, WITHOUT fetching. Only the two export helpers use
   * it, because they are the only synchronous members of the surface -- and
   * they have to be. `serverApi` returns from them synchronously (it just
   * builds an `/api/...` path), and on iOS `saveDownload` can only open the
   * share sheet inside the click's own task, so there is nowhere to put an
   * await. They are reached from a button in a panel that already holds a
   * loaded report, so in practice the tenant is always here; the empty fallback
   * is so a race can't throw out of a click handler.
   */
  const tenantNow = () => loaded ?? EMPTY_TENANT;

  return {
    health: async (): Promise<ServerStatus> => {
      // Await a load already in flight so the caller's warnings are the real
      // ones. App.tsx re-polls health a few seconds after mount to catch an
      // incomplete load; a browser load takes longer than that poll, and
      // without this the poll would always report "no warnings".
      const active = await ensureMode();
      if (inFlight) await inFlight.catch(() => {});
      return {
        status: "ok",
        demo: active === "demo",
        hasCredentials: deps.isConfigured(),
        loadWarnings: warnings,
      };
    },

    setMode: async (target: "demo" | "connected"): Promise<Omit<ServerStatus, "status">> => {
      await ensureMode();
      if (target === "connected") {
        // Remember the intent BEFORE signing in: `ensureSignedIn` may navigate
        // to Entra, and what we want on the way back is Connected.
        writeSession(MODE_KEY, "connected");
        setLoadProgress({ phase: "signing-in", requests: 0 });
        try {
          await deps.ensureSignedIn();
        } catch (err) {
          writeSession(MODE_KEY, "demo");
          setLoadProgress({ phase: "failed", requests: 0, error: (err as Error).message });
          throw err;
        }
      } else {
        writeSession(MODE_KEY, "demo");
        setLoadProgress({ phase: "idle", requests: 0 });
      }
      mode = target;
      drop();
      return { demo: target === "demo", hasCredentials: deps.isConfigured(), loadWarnings: [] };
    },

    groups: async () => listGroupSummaries(await tenant()),
    filters: async () => listAssignmentFilters(await tenant()),
    unassignedPolicies: async () => listUnassignedPolicies(await tenant()),
    assignmentReport: async (platform?: Platform) => buildAssignmentReport(await tenant(), platform),
    assignmentReportExport: (platform?: Platform) =>
      textFile("text/csv", assignmentReportToCsv(buildAssignmentReport(tenantNow(), platform))),

    refresh: async (): Promise<{ warnings: string[] }> => {
      drop();
      await tenant();
      return { warnings };
    },

    simulate: async (inputs: SimulationInputs) => computeSimulation(await tenant(), toInputs(inputs)),
    simulateExport: (inputs: SimulationInputs, format: "json" | "csv") => {
      const sim = computeSimulation(tenantNow(), toInputs(inputs));
      return format === "csv"
        ? textFile("text/csv", simulationToCsv(sim))
        : textFile("application/json", JSON.stringify(sim, null, 2));
    },
  };
}

/**
 * Forgets the remembered mode, so a tab whose session has been ended comes back
 * in Demo rather than trying to reuse a sign-in that is gone.
 */
export function forgetLiveMode(): void {
  removeSession(MODE_KEY);
}

/**
 * Records that this tab wants Connected, for a sign-in started outside the mode
 * toggle -- the first-run form's "Save and sign in", which redirects to Entra
 * before `setMode` would ever run.
 */
export function rememberConnectedMode(): void {
  writeSession(MODE_KEY, "connected");
}
