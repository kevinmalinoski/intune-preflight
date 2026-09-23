import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

/**
 * The documented API surface, exercised end to end through Fastify's
 * `inject()` -- no socket, no port, no Graph. Until this file existed, none of
 * the ten endpoints in docs/SETUP.md had a test, and the only way to reach one
 * was to start a real server and curl it. That is how a 431 ceiling at ~430
 * selected groups went unnoticed.
 *
 * Runs against DEMO mode (no credentials configured), so it reads the bundled
 * sample tenant and never touches a real one.
 */

vi.mock("./config.js", () => ({
  config: {
    tenantId: "",
    clientId: "",
    clientSecret: "",
    hasCredentials: false, // -> demo mode
    port: 0,
    cacheTtlSeconds: 300,
    corsOrigins: ["http://localhost:5173"],
  },
}));

let app: FastifyInstance;

beforeAll(async () => {
  const { buildServer } = await import("./server.js");
  app = await buildServer({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const get = (url: string) => app.inject({ method: "GET", url });
const json = async (url: string) => JSON.parse((await get(url)).body);

describe("GET /api/health", () => {
  it("reports demo mode when no credentials are configured", async () => {
    const res = await get("/api/health");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "ok", demo: true, hasCredentials: false });
  });
});

describe("POST /api/mode", () => {
  it("rejects an unknown mode with 400 rather than silently ignoring it", async () => {
    const res = await app.inject({ method: "POST", url: "/api/mode", payload: { mode: "banana" } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/demo.*connected/);
  });

  it("refuses to switch to connected with no tenant configured", async () => {
    const res = await app.inject({ method: "POST", url: "/api/mode", payload: { mode: "connected" } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/TENANT_ID/);
  });

  it("accepts demo, and leaves the server in demo mode", async () => {
    const res = await app.inject({ method: "POST", url: "/api/mode", payload: { mode: "demo" } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ demo: true });
  });
});

describe("GET /api/groups and /api/filters", () => {
  it("returns every field the group picker renders from", async () => {
    const groups = await json("/api/groups");
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) {
      expect(g).toMatchObject({
        id: expect.any(String),
        displayName: expect.any(String),
        policyCount: expect.any(Number),
        settingsCount: expect.any(Number),
        conflictCount: expect.any(Number),
        platforms: expect.any(Array),
      });
    }
  });

  it("sorts groups by settings count, so the busiest are first", async () => {
    const counts = (await json("/api/groups")).map((g: { settingsCount: number }) => g.settingsCount);
    expect(counts).toEqual([...counts].sort((a: number, b: number) => b - a));
  });

  it("every group id is one the simulator can be asked about", async () => {
    // The picker drops `virtual-*` ids and sends the rest straight back as
    // ?groups= -- so whatever this returns has to round-trip.
    const ids = (await json("/api/groups"))
      .map((g: { id: string }) => g.id)
      .filter((id: string) => !id.startsWith("virtual-"));
    const res = await get(`/api/simulate?platform=windows&groups=${ids.join(",")}`);
    expect(res.statusCode).toBe(200);
  });

  it("returns assignment filters", async () => {
    const filters = await json("/api/filters");
    expect(Array.isArray(filters)).toBe(true);
    for (const f of filters) expect(f).toMatchObject({ id: expect.any(String), platform: expect.any(String) });
  });
});

describe("GET /api/unassigned", () => {
  it("returns unassigned policies, and narrows to a platform when asked", async () => {
    const all = await json("/api/unassigned");
    expect(Array.isArray(all)).toBe(true);
    const windows = await json("/api/unassigned?platform=windows");
    for (const p of windows) expect(p.platform).toBe("windows");
    expect(windows.length).toBeLessThanOrEqual(all.length);
  });

  it("ignores a bogus platform instead of erroring or returning nothing", async () => {
    const bogus = await json("/api/unassigned?platform=solaris");
    const all = await json("/api/unassigned");
    expect(bogus).toEqual(all);
  });
});

describe("GET /api/simulate", () => {
  it("computes a baseline for the selected groups", async () => {
    const groups = await json("/api/groups");
    const real = groups.filter((g: { id: string }) => !g.id.startsWith("virtual-")).map((g: { id: string }) => g.id);
    const sim = await json(`/api/simulate?platform=windows&groups=${real.join(",")}`);

    expect(sim.settings.length).toBeGreaterThan(0);
    expect(sim).toHaveProperty("conflicts");
    expect(sim).toHaveProperty("overlaps");
    expect(sim).toHaveProperty("crossModel");
    // Whatever the API says is conflicted must be cross-referenceable.
    const conflictIds = new Set(sim.conflicts.map((c: { settingId: string }) => c.settingId));
    for (const s of sim.settings) expect(Boolean(s.conflicted)).toBe(conflictIds.has(s.settingId));
  });

  it("works with no groups at all (the All Devices / All Users baseline)", async () => {
    const res = await get("/api/simulate?platform=windows");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("settings");
  });

  it("tolerates unknown group and filter ids without erroring", async () => {
    const res = await get("/api/simulate?platform=windows&groups=nope,,also-nope&deviceFilterIds=bogus");
    expect(res.statusCode).toBe(200);
  });

  it("accepts a selection far larger than Node's default header limit", async () => {
    // The 431 regression guard: group ids ride in the query string, so ~430
    // GUIDs used to exceed the 16KB default and be rejected by Node before
    // Fastify saw the request. maxHeaderSize is raised for exactly this.
    const many = Array.from({ length: 800 }, (_, i) => `aaaaaaaa-bbbb-cccc-dddd-${String(i).padStart(12, "0")}`);
    const res = await get(`/api/simulate?platform=windows&groups=${many.join(",")}`);
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /api/simulate/export", () => {
  it("serves CSV with a download filename", async () => {
    const res = await get("/api/simulate/export?platform=windows&format=csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/endpoint-baseline\.csv/);
    expect(res.body.split("\n")[0]).toContain("CSP Area");
  });

  it("defaults to JSON when no format is given", async () => {
    const res = await get("/api/simulate/export?platform=windows");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["content-disposition"]).toMatch(/endpoint-baseline\.json/);
    expect(JSON.parse(res.body)).toHaveProperty("settings");
  });
});

describe("GET /api/reports/assignments", () => {
  it("returns the manifest with its totals", async () => {
    const report = await json("/api/reports/assignments?platform=windows");
    expect(report).toHaveProperty("rows");
    expect(report).toHaveProperty("groupOverlaps");
    expect(report.totals.policies).toBeGreaterThan(0);
    for (const r of report.rows) expect(r.platform ?? "windows").toBe("windows");
  });

  it("exports CSV with a download filename", async () => {
    const res = await get("/api/reports/assignments/export?platform=windows&format=csv");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/policy-group-assignments\.csv/);
  });
});

describe("POST /api/refresh", () => {
  it("reloads and reports no warnings in demo mode", async () => {
    const res = await app.inject({ method: "POST", url: "/api/refresh" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: "reloaded", warnings: [] });
  });
});

describe("CORS", () => {
  it("allows the dev web origin and not an arbitrary one", async () => {
    const allowed = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");

    const denied = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.example" },
    });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("unknown routes", () => {
  it("404s rather than falling through to anything", async () => {
    expect((await get("/api/nope")).statusCode).toBe(404);
  });
});
