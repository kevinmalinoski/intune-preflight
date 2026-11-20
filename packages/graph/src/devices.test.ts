import { describe, expect, it } from "vitest";
import { readDeviceMembership, searchDevices } from "./devices.js";
import { GraphHttpError, mapWithConcurrency, type GraphClient } from "./graphClient.js";
import { readGroupNesting, readProfileRuleGroups } from "./intuneData.js";
import type { IntuneGroup } from "@intune-preflight/shared";

const DEVICE_ID = "11111111-2222-3333-4444-555555555555";

/** A client answering from two maps keyed by path prefix; anything else 404s. */
function fakeClient(
  objects: Record<string, unknown> = {},
  collections: Record<string, unknown[] | Error> = {}
): GraphClient & { paths: string[] } {
  const paths: string[] = [];
  const find = <T>(table: Record<string, T>, path: string) =>
    Object.entries(table).find(([prefix]) => path.startsWith(prefix))?.[1];
  return {
    paths,
    graphGetObject: async <T>(path: string): Promise<T> => {
      paths.push(path);
      const hit = find(objects, path);
      if (hit instanceof Error) throw hit;
      if (hit === undefined) throw new GraphHttpError("not found", 404);
      return hit as T;
    },
    graphGetCollection: async <T>(path: string): Promise<T[]> => {
      paths.push(path);
      const hit = find(collections, path);
      if (hit instanceof Error) throw hit;
      if (hit === undefined) throw new GraphHttpError("not found", 404);
      return hit as T[];
    },
    mapWithConcurrency,
    concurrency: 4,
    resetGraphStats: () => {},
    getGraphStats: () => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 }),
  };
}

describe("searchDevices", () => {
  it("filters by name prefix, escaping quotes, and sorts the results", async () => {
    const client = fakeClient({
      "/devices?": {
        value: [
          { id: "b", displayName: "KIOSK-B", operatingSystem: "Windows" },
          { id: "a", displayName: "kiosk-a", operatingSystem: "Windows", trustType: "AzureAd" },
        ],
      },
    });
    const res = await searchDevices(client, " o'kiosk ");
    expect(client.paths[0]).toContain(`startswith(displayName,'${encodeURIComponent("o''kiosk")}')`);
    expect(res).toEqual({
      devices: [
        { id: "a", displayName: "kiosk-a", operatingSystem: "Windows", trustType: "AzureAd" },
        { id: "b", displayName: "KIOSK-B", operatingSystem: "Windows" },
      ],
    });
  });

  it("does not call Graph for fewer than two characters", async () => {
    const client = fakeClient();
    expect(await searchDevices(client, "k")).toEqual({ devices: [] });
    expect(client.paths).toEqual([]);
  });

  it("names the permission when Graph refuses", async () => {
    const client = fakeClient({ "/devices?": new GraphHttpError("forbidden", 403) });
    const res = await searchDevices(client, "kiosk");
    expect(res).toMatchObject({ unavailable: { reason: "permission" } });
    expect("unavailable" in res && res.unavailable.detail).toContain("Device.Read.All");
  });
});

describe("readDeviceMembership", () => {
  it("returns the device's OS, Autopilot facts and every group it is in", async () => {
    const client = fakeClient(
      {
        [`/devices/${DEVICE_ID}?`]: {
          id: DEVICE_ID,
          displayName: "KIOSK-01",
          operatingSystem: "Windows",
          physicalIds: ["[USER-GID]:x", "[ZTDId]:abc", "[OrderID]:SALES-KIOSK"],
          enrollmentProfileName: "Kiosk profile",
        },
      },
      {
        [`/devices/${DEVICE_ID}/transitiveMemberOf`]: [
          { id: "g-autopilot", displayName: "Autopilot devices" },
          { id: "g-parent", displayName: "All kiosks" },
        ],
      }
    );
    const res = await readDeviceMembership(client, DEVICE_ID);
    expect(res).toEqual({
      membership: {
        device: { id: DEVICE_ID, displayName: "KIOSK-01", operatingSystem: "Windows" },
        platform: "windows",
        isAutopilot: true,
        groupTag: "SALES-KIOSK",
        enrollmentProfileName: "Kiosk profile",
        groups: [
          { id: "g-autopilot", displayName: "Autopilot devices" },
          { id: "g-parent", displayName: "All kiosks" },
        ],
      },
    });
  });

  it("refuses an id that is not a GUID without calling Graph", async () => {
    const client = fakeClient();
    expect(await readDeviceMembership(client, "../users")).toMatchObject({ unavailable: { reason: "error" } });
    expect(client.paths).toEqual([]);
  });
});

describe("readGroupNesting", () => {
  const group = (id: string, over: Partial<IntuneGroup> = {}): IntuneGroup => ({ id, displayName: id, ...over });

  it("records every parent a group sits in, and adds groups found only through nesting", async () => {
    const catalog = [group("parent-a"), group("parent-b"), group("child-known")];
    const client = fakeClient(
      {},
      {
        "/groups/parent-a/": [
          { id: "child-known", displayName: "child-known" },
          {
            id: "autopilot",
            displayName: "Autopilot devices",
            groupTypes: ["DynamicMembership"],
            membershipRule: '(device.devicePhysicalIds -any (_ -startsWith "[ZTDId]"))',
          },
        ],
        "/groups/parent-b/": [{ id: "autopilot", displayName: "Autopilot devices", groupTypes: ["DynamicMembership"] }],
      }
    );
    const added = await readGroupNesting(client, catalog.slice(0, 2), catalog);
    expect(catalog[2].parentGroupIds).toEqual(["parent-a"]);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      id: "autopilot",
      nestedOnly: true,
      isDynamic: true,
      parentGroupIds: ["parent-a", "parent-b"],
    });
    expect(client.paths[0]).toContain("/transitiveMembers/microsoft.graph.group");
  });

  it("loses only the nesting of a parent whose read fails", async () => {
    const catalog = [group("ok"), group("broken"), group("child")];
    const client = fakeClient(
      {},
      { "/groups/ok/": [{ id: "child", displayName: "child" }], "/groups/broken/": new GraphHttpError("x", 500) }
    );
    const added = await readGroupNesting(client, catalog.slice(0, 2), catalog);
    expect(added).toEqual([]);
    expect(catalog[2].parentGroupIds).toEqual(["ok"]);
  });
});

describe("readProfileRuleGroups", () => {
  it("keeps only dynamic groups whose rule mentions the enrollment profile name", async () => {
    const client = fakeClient(
      {},
      {
        "/groups?$filter=groupTypes/any": [
          {
            id: "a",
            displayName: "Shared",
            groupTypes: ["DynamicMembership"],
            membershipRule: '(device.enrollmentProfileName -ne "X")',
          },
          {
            id: "b",
            displayName: "Tags",
            groupTypes: ["DynamicMembership"],
            membershipRule: '(device.deviceOSType -eq "Windows")',
          },
        ],
      }
    );
    const groups = await readProfileRuleGroups(client);
    expect(groups?.map((g) => g.id)).toEqual(["a"]);
    expect(groups?.[0].isDynamic).toBe(true);
  });

  it("gives up quietly when the read fails", async () => {
    const client = fakeClient({}, { "/groups?$filter=groupTypes/any": new GraphHttpError("bad", 400) });
    expect(await readProfileRuleGroups(client)).toBeUndefined();
  });
});
