import { describe, expect, it } from "vitest";
import { GraphHttpError, mapWithConcurrency } from "./graphClient.js";
import { fetchApps } from "./intuneData.js";

// fetchApps against recorded-shape mobileApps responses. The point of most of
// these is what a FAILED read turns into: apps sit outside the baseline, so a
// tenant without the apps permission must come back "unavailable" and must not
// raise the "baseline is INCOMPLETE" warning every other fetcher raises.

const RAW_APPS = [
  {
    "@odata.type": "#microsoft.graph.win32LobApp",
    id: "app-1",
    displayName: "7-Zip",
    publisher: "Igor Pavlov",
    assignments: [
      { intent: "required", target: { "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget" } },
      { intent: "available", target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } },
    ],
  },
  // isAssigned can be true of an app whose only assignments this tool can't read.
  {
    "@odata.type": "#microsoft.graph.webApp",
    id: "app-2",
    displayName: "Intranet",
    assignments: [
      { intent: "somethingNew", target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } },
    ],
  },
  { "@odata.type": "#microsoft.graph.iosStoreApp", id: "app-3", displayName: "Unassigned", assignments: [] },
];

const context = (graphGetCollection: (path: string) => Promise<unknown[]>) => {
  const warnings: string[] = [];
  const paths: string[] = [];
  const client = {
    graphGetCollection: async <T>(path: string): Promise<T[]> => {
      paths.push(path);
      return (await graphGetCollection(path)) as T[];
    },
    graphGetObject: async <T>(): Promise<T> => {
      throw new Error("fetchApps makes no single-object calls");
    },
    mapWithConcurrency,
    concurrency: 8,
    resetGraphStats: () => {},
    getGraphStats: () => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 }),
  };
  return { ctx: { client, recordWarning: (msg: string) => warnings.push(msg) }, warnings, paths };
};

describe("fetchApps", () => {
  it("reads assigned apps with their assignments, type and platform", async () => {
    const { ctx, warnings, paths } = context(async () => RAW_APPS);
    const result = await fetchApps(ctx);

    expect(paths).toEqual(["/deviceAppManagement/mobileApps?$expand=assignments&$filter=isAssigned eq true"]);
    expect("apps" in result && result.apps).toEqual([
      {
        id: "app-1",
        displayName: "7-Zip",
        publisher: "Igor Pavlov",
        appType: "Windows app (Win32)",
        family: "win32",
        platform: "windows",
        assignments: [
          { intent: "required", groupId: "virtual-all-devices", exclude: false },
          { intent: "available", groupId: "g1", exclude: false },
        ],
      },
    ]);
    // The unreadable assignment is surfaced: the Apps view IS on screen and is short one.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Intranet");
  });

  it("falls back to the unfiltered collection when Graph rejects the filter", async () => {
    const { ctx, paths } = context(async (path) => {
      if (path.includes("$filter")) throw new GraphHttpError("bad request", 400);
      return RAW_APPS;
    });
    const result = await fetchApps(ctx);
    expect(paths).toHaveLength(2);
    expect("apps" in result && result.apps.map((a) => a.id)).toEqual(["app-1"]);
  });

  it("reports a missing permission as unavailable, without a load warning", async () => {
    const { ctx, warnings, paths } = context(async () => {
      throw new GraphHttpError("Forbidden", 403);
    });
    const result = await fetchApps(ctx);
    expect(result).toEqual({
      unavailable: {
        reason: "permission",
        detail: expect.stringContaining("DeviceManagementApps.Read.All"),
      },
    });
    // No retry on the unfiltered path for a 403, and no "baseline incomplete" alarm.
    expect(paths).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("reports any other failure as an error, still without a load warning", async () => {
    const { ctx, warnings } = context(async () => {
      throw new Error("fetch failed");
    });
    const result = await fetchApps(ctx);
    expect("unavailable" in result && result.unavailable.reason).toBe("error");
    expect("unavailable" in result && result.unavailable.detail).toContain("network error");
    expect(warnings).toEqual([]);
  });
});
