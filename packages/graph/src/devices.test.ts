import { describe, expect, it } from "vitest";
import { isActiveIntuneDevice, readDeviceMembership, searchDevices } from "./devices.js";
import { GraphHttpError, mapWithConcurrency, type GraphClient } from "./graphClient.js";
import { readGroupNesting, readProfileRuleGroups } from "./intuneData.js";
import type { IntuneGroup } from "@intune-preflight/shared";

const DEVICE_ID = "11111111-2222-3333-4444-555555555555";

/** A client answering from two maps keyed by path prefix; anything else 404s. */
function fakeClient(
  objects: Record<string, unknown> = {},
  collections: Record<string, unknown[] | Error> = {},
  post: (path: string, body: unknown) => unknown = () => {
    throw new GraphHttpError("not found", 404);
  }
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
    graphPostAction: async <T>(path: string, body: unknown): Promise<T> => {
      paths.push(`POST ${path}`);
      return post(path, body) as T;
    },
    mapWithConcurrency,
    concurrency: 4,
    resetGraphStats: () => {},
    getGraphStats: () => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 }),
  };
}

const INTUNE = "0000000a-0000-0000-c000-000000000000";
const MANAGED = { accountEnabled: true, isManaged: true, mdmAppId: INTUNE };
const NOW = Date.parse("2026-11-23T12:00:00Z");

describe("isActiveIntuneDevice", () => {
  it("keeps an enabled, Intune-managed device that signed in recently", () => {
    expect(isActiveIntuneDevice({ ...MANAGED, approximateLastSignInDateTime: "2026-11-20T00:00:00Z" }, NOW)).toBe(true);
  });

  it("keeps a managed device Entra has no sign-in time for", () => {
    expect(isActiveIntuneDevice(MANAGED, NOW)).toBe(true);
  });

  it("drops registered-only, disabled, other-MDM and stale devices", () => {
    expect(isActiveIntuneDevice({ ...MANAGED, isManaged: false }, NOW)).toBe(false);
    expect(isActiveIntuneDevice({ accountEnabled: true }, NOW)).toBe(false);
    expect(isActiveIntuneDevice({ ...MANAGED, accountEnabled: false }, NOW)).toBe(false);
    expect(isActiveIntuneDevice({ ...MANAGED, mdmAppId: "54b943f8-d761-4f8d-951e-9cea1846db5a" }, NOW)).toBe(false);
    expect(isActiveIntuneDevice({ ...MANAGED, approximateLastSignInDateTime: "2026-07-01T00:00:00Z" }, NOW)).toBe(
      false
    );
  });

  it("accepts the Intune app id in any case", () => {
    expect(isActiveIntuneDevice({ ...MANAGED, mdmAppId: INTUNE.toUpperCase() }, NOW)).toBe(true);
  });
});

describe("searchDevices", () => {
  it("returns only active Intune-managed devices and counts the rest", async () => {
    const client = fakeClient({
      "/devices?": {
        value: [
          { id: "m", displayName: "KIOSK-M", operatingSystem: "Windows", ...MANAGED },
          { id: "r", displayName: "KIOSK-R", operatingSystem: "Windows", accountEnabled: true, isManaged: false },
          { id: "d", displayName: "KIOSK-D", operatingSystem: "Windows", ...MANAGED, accountEnabled: false },
        ],
      },
    });
    const res = await searchDevices(client, "kiosk");
    expect(client.paths[0]).toContain("isManaged");
    expect(res).toEqual({ devices: [{ id: "m", displayName: "KIOSK-M", operatingSystem: "Windows" }], hidden: 2 });
  });

  it("filters by name prefix, escaping quotes, and sorts the results", async () => {
    const client = fakeClient({
      "/devices?": {
        value: [
          { id: "b", displayName: "KIOSK-B", operatingSystem: "Windows", ...MANAGED },
          { id: "a", displayName: "kiosk-a", operatingSystem: "Windows", trustType: "AzureAd", ...MANAGED },
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
        "/deviceManagement/assignmentFilters": [],
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
        filters: [],
      },
    });
  });

  describe("Assignment Filters", () => {
    const device = { id: DEVICE_ID, displayName: "KIOSK-01", operatingSystem: "Windows", physicalIds: [] };
    const filters = [
      { id: "f-kiosk", displayName: "Kiosk", platform: "windows10AndLater", rule: "kiosk-rule" },
      { id: "f-other", displayName: "Other", platform: "windows10AndLater", rule: "other-rule" },
      { id: "f-ios", displayName: "iPhones", platform: "iOS", rule: "ios-rule" },
      {
        id: "f-mam",
        displayName: "MAM",
        platform: "windowsMobileApplicationManagement",
        rule: "app-rule",
        assignmentFilterManagementType: "apps",
      },
    ];
    const report = (names: string[]) => ({
      Columns: [{ Name: "deviceId" }, { Name: "deviceName" }],
      Values: names.map((n) => ["intune-id", n]),
    });

    it("asks Intune to evaluate each device filter for the platform, by device name", async () => {
      const bodies: { data: { rule: string; platform: string; search: string } }[] = [];
      const client = fakeClient(
        { [`/devices/${DEVICE_ID}?`]: device },
        { [`/devices/${DEVICE_ID}/`]: [], "/deviceManagement/assignmentFilters": filters },
        (_path, body) => {
          const b = body as (typeof bodies)[number];
          bodies.push(b);
          // A different device whose name merely contains this one's must not count.
          return b.data.rule === "kiosk-rule" ? report(["kiosk-01"]) : report(["KIOSK-010"]);
        }
      );
      const res = await readDeviceMembership(client, DEVICE_ID);
      expect(bodies.map((b) => b.data.rule).sort()).toEqual(["kiosk-rule", "other-rule"]);
      expect(bodies[0]).toMatchObject({ data: { platform: "windows10AndLater", search: "KIOSK-01" } });
      expect("membership" in res && res.membership.filters).toEqual([
        { id: "f-kiosk", displayName: "Kiosk", matches: true },
        { id: "f-other", displayName: "Other", matches: false },
      ]);
    });

    it("still returns the groups when the filters can't be evaluated, and says why", async () => {
      const client = fakeClient(
        { [`/devices/${DEVICE_ID}?`]: device },
        { [`/devices/${DEVICE_ID}/`]: [{ id: "g", displayName: "G" }], "/deviceManagement/assignmentFilters": filters },
        () => {
          throw new GraphHttpError("forbidden", 403);
        }
      );
      const res = await readDeviceMembership(client, DEVICE_ID);
      expect("membership" in res && res.membership.groups).toHaveLength(1);
      expect("membership" in res && res.membership.filters).toBeUndefined();
      expect("membership" in res && res.membership.filtersUnchecked).toContain(
        "DeviceManagementConfiguration.Read.All"
      );
    });

    it("evaluates nothing for an OS Preflight doesn't simulate", async () => {
      const client = fakeClient(
        { [`/devices/${DEVICE_ID}?`]: { ...device, operatingSystem: "Linux" } },
        { [`/devices/${DEVICE_ID}/`]: [] }
      );
      const res = await readDeviceMembership(client, DEVICE_ID);
      expect("membership" in res && res.membership.filters).toEqual([]);
      expect(client.paths.some((p) => p.includes("assignmentFilters"))).toBe(false);
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
