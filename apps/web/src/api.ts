import type { GraphPayload, GroupBaseline, GroupSummary } from "@intune-baseline/shared";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  groups: () => getJson<GroupSummary[]>("/groups"),
  graph: () => getJson<GraphPayload>("/graph"),
  baseline: (groupId: string) => getJson<GroupBaseline>(`/groups/${groupId}/baseline`),
  exportUrl: (groupId: string, format: "json" | "csv") => `/api/groups/${groupId}/export?format=${format}`,
};
