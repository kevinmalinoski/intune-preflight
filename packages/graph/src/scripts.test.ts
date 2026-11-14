import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./graphClient.js";
import { fetchPlatformScripts } from "./intuneData.js";

const LIST = [
  {
    id: "s1",
    displayName: "Disable startup delay",
    fileName: "DisableAppStartupDelay.ps1",
    runAsAccount: "system",
    // What Graph really returns from the list call, whatever the script holds.
    scriptContent: null,
    assignments: [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "g1" } }],
  },
];

const context = (getObject: (path: string) => Promise<unknown>) => {
  const objectPaths: string[] = [];
  const client = {
    graphGetCollection: async <T>(path: string): Promise<T[]> =>
      (path.startsWith("/deviceManagement/deviceManagementScripts") ? LIST : []) as T[],
    graphGetObject: async <T>(path: string): Promise<T> => {
      objectPaths.push(path);
      return (await getObject(path)) as T;
    },
    mapWithConcurrency,
    concurrency: 8,
    resetGraphStats: () => {},
    getGraphStats: () => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 }),
  };
  return { ctx: { client, recordWarning: () => {} }, objectPaths };
};

const contentOf = (policies: Awaited<ReturnType<typeof fetchPlatformScripts>>) =>
  policies[0]?.settings.find((s) => s.displayName === "Script content")?.value;

describe("fetchPlatformScripts", () => {
  it("reads each script by id, because the list call leaves the content out", async () => {
    const { ctx, objectPaths } = context(async () => ({ scriptContent: btoa("Set-ItemProperty -Path HKCU:\\x") }));
    const policies = await fetchPlatformScripts(ctx);

    expect(objectPaths).toEqual(["/deviceManagement/deviceManagementScripts/s1"]);
    expect(contentOf(policies)).toBe("Set-ItemProperty -Path HKCU:\\x");
    expect(policies[0].assignedGroupIds).toEqual(["g1"]);
  });

  it("keeps the script when its content cannot be read", async () => {
    const { ctx } = context(async () => {
      throw new Error("503");
    });
    const policies = await fetchPlatformScripts(ctx);

    expect(policies).toHaveLength(1);
    expect(contentOf(policies)).toBeUndefined();
    expect(policies[0].settings.some((s) => s.displayName === "File Name")).toBe(true);
  });
});
