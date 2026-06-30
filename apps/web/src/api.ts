import type {
  AutopilotProfileSummary,
  GraphPayload,
  GroupBaseline,
  GroupSummary,
  SimulationResult,
} from "@intune-baseline/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function simulationQuery(groupIds: string[], autopilotProfileId?: string) {
  const params = new URLSearchParams();
  if (groupIds.length) params.set("groups", groupIds.join(","));
  if (autopilotProfileId) params.set("autopilotProfileId", autopilotProfileId);
  return params.toString();
}

export const api = {
  groups: () => getJson<GroupSummary[]>("/groups"),
  graph: () => getJson<GraphPayload>("/graph"),
  autopilotProfiles: () => getJson<AutopilotProfileSummary[]>("/autopilot"),
  baseline: (groupId: string) => getJson<GroupBaseline>(`/groups/${groupId}/baseline`),
  exportUrl: (groupId: string, format: "json" | "csv") => `/api/groups/${groupId}/export?format=${format}`,
  simulate: (groupIds: string[], autopilotProfileId?: string) =>
    getJson<SimulationResult>(`/simulate?${simulationQuery(groupIds, autopilotProfileId)}`),
  simulateExportUrl: (groupIds: string[], autopilotProfileId: string | undefined, format: "json" | "csv") =>
    `/api/simulate/export?${simulationQuery(groupIds, autopilotProfileId)}&format=${format}`,
};
