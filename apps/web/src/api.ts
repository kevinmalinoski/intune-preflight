import type {
  AssignmentFilter,
  AssignmentReport,
  GroupSummary,
  Platform,
  SimulationResult,
  UnassignedPolicy,
} from "@intune-preflight/shared";
import { demoApi } from "./demoApi.ts";
import type { Download } from "./download.ts";
import { createLiveApi } from "./liveApi.ts";
import { ensureReady, ensureSignedIn, getToken, isConfigured, isSignedIn } from "./liveSession.ts";

/**
 * When true, the app is the self-contained public demo: it runs the pure engine
 * over bundled sample data entirely in the browser, with no backend. Set at
 * build/dev time via VITE_STATIC_DEMO=1. Statically false in the normal build,
 * so the demo implementation (and the engine it pulls in) is tree-shaken away.
 */
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "1";

/**
 * When true, the app is the live build: the admin signs in to their own tenant
 * with MSAL in the browser and `packages/graph` reads it straight from Graph,
 * still with no backend. Set at build/dev time via VITE_MODE=live.
 *
 * "Connected" means something different in each build, which is the whole point
 * of three flags rather than one: the server build connects through a backend
 * holding a client secret, and this one connects as the signed-in user with no
 * secret anywhere.
 */
export const LIVE_MODE = import.meta.env.VITE_MODE === "live";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export interface SimulationInputs {
  groupIds: string[];
  platform?: Platform;
  deviceFilterIds?: string[];
  unassignedPolicyIds?: string[];
}

function simulationQuery({ groupIds, platform, deviceFilterIds, unassignedPolicyIds }: SimulationInputs) {
  const params = new URLSearchParams();
  if (groupIds.length) params.set("groups", groupIds.join(","));
  if (platform) params.set("platform", platform);
  if (deviceFilterIds?.length) params.set("deviceFilterIds", deviceFilterIds.join(","));
  if (unassignedPolicyIds?.length) params.set("unassigned", unassignedPolicyIds.join(","));
  return params.toString();
}

export interface ServerStatus {
  status: string;
  demo: boolean;
  hasCredentials: boolean;
  /** Warnings from the last connected load; non-empty means the baseline was incomplete. */
  loadWarnings?: string[];
}

const serverApi = {
  health: () => getJson<ServerStatus>("/health"),
  setMode: async (mode: "demo" | "connected"): Promise<Omit<ServerStatus, "status">> => {
    const res = await fetch("/api/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Failed to switch mode: ${res.status}`);
    }
    return res.json();
  },
  groups: () => getJson<GroupSummary[]>("/groups"),
  filters: () => getJson<AssignmentFilter[]>("/filters"),
  unassignedPolicies: () => getJson<UnassignedPolicy[]>("/unassigned"),
  assignmentReport: (platform?: Platform) =>
    getJson<AssignmentReport>(`/reports/assignments${platform ? `?platform=${platform}` : ""}`),
  // The backend answers these with a Content-Disposition, so the browser saves
  // the file itself and there is nothing for `saveDownload` to build.
  assignmentReportExport: (platform?: Platform): Download => ({
    kind: "url",
    url: `/api/reports/assignments/export?format=csv${platform ? `&platform=${platform}` : ""}`,
  }),
  refresh: async (): Promise<{ warnings: string[] }> => {
    const res = await fetch("/api/refresh", { method: "POST" });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    const body = await res.json().catch(() => ({}));
    return { warnings: body.warnings ?? [] };
  },
  simulate: (inputs: SimulationInputs, signal?: AbortSignal) =>
    getJson<SimulationResult>(`/simulate?${simulationQuery(inputs)}`, signal),
  simulateExport: (inputs: SimulationInputs, format: "json" | "csv"): Download => ({
    kind: "url",
    url: `/api/simulate/export?${simulationQuery(inputs)}&format=${format}`,
  }),
};

/**
 * The active API: the live (delegated-auth) implementation, the static public
 * demo's in-browser one, or the server-backed one. Both flags fold to constants
 * at build time, so each build ships only the implementation it chose -- the
 * server build carries no MSAL and no engine-over-sample-data, and the demo
 * bundle is byte-for-byte what it was before the live mode existed.
 *
 * All three are real TypeScript, so each alternative is structurally checked
 * against the server surface by this one annotation -- a drift between them is a
 * build error rather than a runtime surprise. That is what has kept `demoApi`
 * honest, and it is now what keeps `liveApi` honest too.
 */
export const api: typeof serverApi = LIVE_MODE
  ? createLiveApi({ ensureReady, getToken, ensureSignedIn, isSignedIn, isConfigured })
  : STATIC_DEMO
    ? demoApi
    : serverApi;
