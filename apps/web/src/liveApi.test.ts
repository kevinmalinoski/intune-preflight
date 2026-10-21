/**
 * `api.ts` already type-checks `liveApi` against the server surface -- that
 * annotation is what has kept `demoApi` from drifting and now does the same job
 * here. These tests cover the two things it cannot: that the object really has
 * every method at runtime (a `typeof` check cannot catch a method lost to a bad
 * merge in a way the compiler notices only where it is called), and that the
 * mode/sign-in sequencing behaves.
 *
 * Everything here runs over the BUNDLED demo tenant. The connected path is the
 * same `loadTenantData` the server's own tests cover; what is new in this file
 * is the wiring around it, so that is what is exercised.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { demoApi } from "./demoApi.ts";
import { createLiveApi, type LiveApiDeps } from "./liveApi.ts";

function deps(overrides: Partial<LiveApiDeps> = {}): LiveApiDeps {
  return {
    ensureReady: vi.fn(async () => {}),
    getToken: vi.fn(async () => "token"),
    ensureSignedIn: vi.fn(async () => {}),
    isSignedIn: vi.fn(() => false),
    isConfigured: vi.fn(() => true),
    ...overrides,
  };
}

describe("liveApi shape", () => {
  it("has every method the other implementations have, and nothing extra", () => {
    // demoApi stands in for the surface here because it is a real object at
    // runtime, where serverApi's type is all that exists at test time.
    expect(Object.keys(createLiveApi(deps())).sort()).toEqual(Object.keys(demoApi).sort());
  });

  it("exposes them all as functions", () => {
    for (const [name, value] of Object.entries(createLiveApi(deps()))) {
      expect(typeof value, name).toBe("function");
    }
  });
});

describe("starting state", () => {
  it("starts in demo so an unsigned tab is still usable", () => {
    // The live build with nobody signed in is the public demo. Opening it
    // should show something, not an error.
    return expect(createLiveApi(deps()).health()).resolves.toMatchObject({
      status: "ok",
      demo: true,
      hasCredentials: true,
    });
  });

  it("reports hasCredentials from whether a tenant is configured", async () => {
    const api = createLiveApi(deps({ isConfigured: () => false }));
    await expect(api.health()).resolves.toMatchObject({ hasCredentials: false });
  });

  it("does not trust a remembered Connected mode without a surviving sign-in", async () => {
    // sessionStorage is unavailable here, so nothing is remembered -- which is
    // the same outcome as a tab whose session has gone: fall back to demo
    // rather than erroring on every read.
    const api = createLiveApi(deps({ isSignedIn: () => true }));
    await expect(api.health()).resolves.toMatchObject({ demo: true });
  });

  it("reads the bundled sample tenant in demo mode, with no token", async () => {
    const getToken = vi.fn(async () => "token");
    const api = createLiveApi(deps({ getToken }));
    expect(await api.groups()).toEqual(await demoApi.groups());
    expect(await api.filters()).toEqual(await demoApi.filters());
    expect(await api.unassignedPolicies()).toEqual(await demoApi.unassignedPolicies());
    // Nothing was fetched, so nothing needed a token.
    expect(getToken).not.toHaveBeenCalled();
  });
});

describe("setMode", () => {
  it("signs in before switching to connected", async () => {
    const ensureSignedIn = vi.fn(async () => {});
    const api = createLiveApi(deps({ ensureSignedIn }));
    await expect(api.setMode("connected")).resolves.toMatchObject({ demo: false, hasCredentials: true });
    expect(ensureSignedIn).toHaveBeenCalledTimes(1);
  });

  it("stays in demo when the sign-in fails", async () => {
    const failing = createLiveApi(
      deps({
        ensureSignedIn: async () => {
          throw new Error("consent required");
        },
      })
    );
    await expect(failing.setMode("connected")).rejects.toThrow("consent required");
    // A refused consent must not leave the tab in a mode it cannot read.
    await expect(failing.health()).resolves.toMatchObject({ demo: true });
  });

  it("never asks for a sign-in to go back to demo", async () => {
    const ensureSignedIn = vi.fn(async () => {});
    const api = createLiveApi(deps({ ensureSignedIn }));
    await api.setMode("demo");
    expect(ensureSignedIn).not.toHaveBeenCalled();
  });
});

describe("reading a connected tenant", () => {
  /**
   * Every Graph collection answers empty, which is enough to drive a whole load
   * without a tenant: what is under test is the wiring -- that the delegated
   * token reaches the Authorization header, that the tenant is loaded once, and
   * that switching source never serves one tenant's data as the other's.
   */
  function stubGraph() {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("sends the delegated token as a bearer on every request", async () => {
    const fetchMock = stubGraph();
    const getToken = vi.fn(async () => "delegated-token");
    const api = createLiveApi(deps({ getToken }));
    await api.setMode("connected");
    await api.groups();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer delegated-token");
    }
    expect(getToken).toHaveBeenCalled();
  });

  // A 500-policy tenant moves ~65MB, so the UI's three concurrent requests
  // causing three loads would not be a subtle waste. Both this module and the
  // `TtlCache` it is handed collapse concurrent callers; what is asserted is the
  // property, not which layer provides it.
  it("serves the requests the UI fires together from a single load", async () => {
    const oneRead = stubGraph();
    const a = createLiveApi(deps());
    await a.setMode("connected");
    await a.groups();
    const callsForOneRead = oneRead.mock.calls.length;
    vi.unstubAllGlobals();

    const threeReads = stubGraph();
    const b = createLiveApi(deps());
    await b.setMode("connected");
    await Promise.all([b.groups(), b.filters(), b.unassignedPolicies()]);
    expect(threeReads.mock.calls.length).toBe(callsForOneRead);
  });

  it("drops the connected tenant when switching back to demo", async () => {
    // Showing one tenant's policies while the header says the other is the
    // worst failure this tool has. The stubbed Graph answers empty, so the two
    // sources are trivially distinguishable.
    stubGraph();
    const api = createLiveApi(deps());
    await api.setMode("connected");
    expect(await api.groups()).toEqual([]);

    await api.setMode("demo");
    expect(await api.groups()).toEqual(await demoApi.groups());

    await api.setMode("connected");
    expect(await api.groups()).toEqual([]);
  });

  it("re-reads from Graph after a refresh", async () => {
    const fetchMock = stubGraph();
    const api = createLiveApi(deps());
    await api.setMode("connected");
    await api.groups();
    const afterFirst = fetchMock.mock.calls.length;
    await api.refresh();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe("refresh", () => {
  it("re-reads and reports no warnings for the sample tenant", async () => {
    const api = createLiveApi(deps());
    await api.groups();
    await expect(api.refresh()).resolves.toEqual({ warnings: [] });
  });
});

describe("export URLs", () => {
  it("are data: URLs, so a download needs no backend", async () => {
    const api = createLiveApi(deps());
    await api.assignmentReport();
    expect(api.assignmentReportCsvUrl()).toMatch(/^data:text\/csv;charset=utf-8,/);
    expect(api.simulateExportUrl({ groupIds: [] }, "csv")).toMatch(/^data:text\/csv;charset=utf-8,/);
    expect(api.simulateExportUrl({ groupIds: [] }, "json")).toMatch(/^data:application\/json;charset=utf-8,/);
  });

  it("do not throw before anything has loaded", () => {
    // They are called during render, where a throw blanks the page. The panels
    // that render them already hold loaded data, but a race must not be fatal.
    const api = createLiveApi(deps());
    expect(() => api.assignmentReportCsvUrl()).not.toThrow();
    expect(() => api.simulateExportUrl({ groupIds: [] }, "csv")).not.toThrow();
  });

  it("carry the loaded tenant once there is one", async () => {
    const api = createLiveApi(deps());
    const groups = await api.groups();
    expect(groups.length).toBeGreaterThan(0);
    const csv = decodeURIComponent(api.assignmentReportCsvUrl().replace(/^data:text\/csv;charset=utf-8,/, ""));
    expect(csv.length).toBeGreaterThan(0);
    // Sanity: it is the sample tenant's report, not an empty one.
    expect(csv.split("\n").length).toBeGreaterThan(1);
  });
});
