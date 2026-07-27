import type {
  AssignmentFilter,
  AssignmentReport,
  GroupSummary,
  Platform,
  SimulationResult,
  UnassignedPolicy,
} from "@intune-preflight/shared";

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

export const api = {
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
