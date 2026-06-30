import type { AssignmentFilter, GroupSummary, Platform, SimulationResult } from "@intune-baseline/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function simulationQuery(groupIds: string[], platform?: Platform, deviceFilterId?: string) {
  const params = new URLSearchParams();
  if (groupIds.length) params.set("groups", groupIds.join(","));
  if (platform) params.set("platform", platform);
  if (deviceFilterId) params.set("deviceFilterId", deviceFilterId);
  return params.toString();
}

export const api = {
  groups: () => getJson<GroupSummary[]>("/groups"),
  filters: () => getJson<AssignmentFilter[]>("/filters"),
  simulate: (groupIds: string[], platform?: Platform, deviceFilterId?: string) =>
    getJson<SimulationResult>(`/simulate?${simulationQuery(groupIds, platform, deviceFilterId)}`),
  simulateExportUrl: (groupIds: string[], platform: Platform | undefined, deviceFilterId: string | undefined, format: "json" | "csv") =>
    `/api/simulate/export?${simulationQuery(groupIds, platform, deviceFilterId)}&format=${format}`,
};
