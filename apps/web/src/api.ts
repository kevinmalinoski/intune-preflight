import type { GraphPayload, GroupBaseline, GroupSummary, SimulationResult } from "@intune-baseline/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function simulationQuery(groupIds: string[]) {
  const params = new URLSearchParams();
  if (groupIds.length) params.set("groups", groupIds.join(","));
  return params.toString();
}

export const api = {
  groups: () => getJson<GroupSummary[]>("/groups"),
  graph: () => getJson<GraphPayload>("/graph"),
  baseline: (groupId: string) => getJson<GroupBaseline>(`/groups/${groupId}/baseline`),
  exportUrl: (groupId: string, format: "json" | "csv") => `/api/groups/${groupId}/export?format=${format}`,
  simulate: (groupIds: string[]) => getJson<SimulationResult>(`/simulate?${simulationQuery(groupIds)}`),
  simulateExportUrl: (groupIds: string[], format: "json" | "csv") =>
    `/api/simulate/export?${simulationQuery(groupIds)}&format=${format}`,
};
