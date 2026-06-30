import type { GroupSummary, Platform, SimulationResult } from "@intune-baseline/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

function simulationQuery(groupIds: string[], platform?: Platform) {
  const params = new URLSearchParams();
  if (groupIds.length) params.set("groups", groupIds.join(","));
  if (platform) params.set("platform", platform);
  return params.toString();
}

export const api = {
  groups: () => getJson<GroupSummary[]>("/groups"),
  simulate: (groupIds: string[], platform?: Platform) =>
    getJson<SimulationResult>(`/simulate?${simulationQuery(groupIds, platform)}`),
  simulateExportUrl: (groupIds: string[], platform: Platform | undefined, format: "json" | "csv") =>
    `/api/simulate/export?${simulationQuery(groupIds, platform)}&format=${format}`,
};
