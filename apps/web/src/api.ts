import type {
  AssignmentFilter,
  AssignmentReport,
  GroupSummary,
  Platform,
  SimulationResult,
  UnassignedPolicy,
} from "@intune-preflight/shared";
import { demoApi } from "./demoApi.ts";

/**
 * When true, the app is the self-contained public demo: it runs the pure engine
 * over bundled sample data entirely in the browser, with no backend. Set at
 * build/dev time via VITE_STATIC_DEMO=1. Statically false in the normal build,
 * so the demo implementation (and the engine it pulls in) is tree-shaken away.
 */
export const STATIC_DEMO = import.meta.env.VITE_STATIC_DEMO === "1";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`/api${path}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

interface SimulationInputs {
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
  assignmentReportCsvUrl: (platform?: Platform) =>
    `/api/reports/assignments/export?format=csv${platform ? `&platform=${platform}` : ""}`,
  refresh: async (): Promise<{ warnings: string[] }> => {
    const res = await fetch("/api/refresh", { method: "POST" });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
    const body = await res.json().catch(() => ({}));
    return { warnings: body.warnings ?? [] };
  },
  simulate: (inputs: SimulationInputs, signal?: AbortSignal) =>
    getJson<SimulationResult>(`/simulate?${simulationQuery(inputs)}`, signal),
  simulateExportUrl: (inputs: SimulationInputs, format: "json" | "csv") =>
    `/api/simulate/export?${simulationQuery(inputs)}&format=${format}`,
};

/**
 * The active API. In the static public demo it's the in-browser implementation;
 * otherwise the server-backed one. The ternary folds to a constant in each build,
 * so only the chosen implementation ships.
 */
export const api = STATIC_DEMO ? (demoApi as typeof serverApi) : serverApi;
