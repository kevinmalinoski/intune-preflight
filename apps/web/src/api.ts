import type { AssignmentFilter, GroupSummary, Platform, SimulationResult } from "@intune-baseline/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function simulationQuery(groupIds: string[], platform?: Platform, deviceFilterIds?: string[]) {
  const params = new URLSearchParams();
  if (groupIds.length) params.set("groups", groupIds.join(","));
  if (platform) params.set("platform", platform);
  if (deviceFilterIds?.length) params.set("deviceFilterIds", deviceFilterIds.join(","));
  return params.toString();
}

export const api = {
  groups: () => getJson<GroupSummary[]>("/groups"),
  filters: () => getJson<AssignmentFilter[]>("/filters"),
  refresh: async () => {
    const res = await fetch("/api/refresh", { method: "POST" });
    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
  },
  simulate: (groupIds: string[], platform?: Platform, deviceFilterIds?: string[]) =>
    getJson<SimulationResult>(`/simulate?${simulationQuery(groupIds, platform, deviceFilterIds)}`),
  simulateExportUrl: (groupIds: string[], platform: Platform | undefined, deviceFilterIds: string[] | undefined, format: "json" | "csv") =>
    `/api/simulate/export?${simulationQuery(groupIds, platform, deviceFilterIds)}&format=${format}`,
};
