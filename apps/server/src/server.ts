import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Platform } from "@intune-preflight/shared";
import { config } from "./config.js";
import { getMode, setMode, type TenantMode } from "./mode.js";
import { loadTenantData, clearTenantDataCache, getLastLoadWarnings } from "./tenantData.js";
import {
  assignmentReportToCsv,
  assignmentReportToXlsx,
  buildAssignmentReport,
  computeSimulation,
  listAssignmentFilters,
  listGroupSummaries,
  listUnassignedPolicies,
  simulationToCsv,
  simulationToXlsx,
  XLSX_MIME,
} from "@intune-preflight/engine";

/**
 * Builds the API with every route registered, but WITHOUT listening.
 *
 * Split out from the entry point so the routes can be exercised with Fastify's
 * `app.inject()` -- no socket, no port, no network -- which is what
 * `routes.test.ts` does. Before this split the whole documented API surface had
 * no test at all, and the only way to reach a route was to start a real server.
 */
export async function buildServer({ logger = true }: { logger?: boolean } = {}) {
  // `maxHeaderSize` is raised from Node's 16KB default because the simulation
  // endpoints take the selected group ids in the QUERY STRING, and a group id is
  // a 36-character GUID. Around 430 selected groups the request line alone passes
  // 16KB and Node rejects it with a bare 431 before Fastify ever sees it -- which
  // a large tenant can genuinely hit by sending a big Manifest selection to the
  // simulator. 64KB lifts the ceiling past 1,500 groups. (The real fix is a POST
  // body, but that is an API change; this is the honest limit made large enough
  // not to matter.)
  const app = Fastify({ logger, http: { maxHeaderSize: 64 * 1024 } });
  await app.register(cors, { origin: config.corsOrigins });

  const VALID_PLATFORMS: Platform[] = ["windows", "macos", "ios", "android", "other"];

  app.get("/api/health", async () => ({
    status: "ok",
    demo: getMode() === "demo",
    hasCredentials: config.hasCredentials,
    // Warnings from the last connected load -- non-empty means the baseline was
    // incomplete (a category or policy failed to load even after retries).
    loadWarnings: getLastLoadWarnings(),
  }));

  // Flip the active data source between the bundled demo tenant and the real
  // connected tenant. Connected is rejected when no credentials are configured.
  app.post<{ Body: { mode?: string } }>("/api/mode", async (req, reply) => {
    const mode = req.body?.mode;
    if (mode !== "demo" && mode !== "connected") {
      return reply.status(400).send({ error: "mode must be 'demo' or 'connected'" });
    }
    try {
      setMode(mode as TenantMode);
    } catch (err) {
      return reply.status(400).send({ error: (err as Error).message });
    }
    return { demo: getMode() === "demo", hasCredentials: config.hasCredentials };
  });

  app.get("/api/groups", async (_req, reply) => {
    try {
      const data = await loadTenantData();
      return listGroupSummaries(data);
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.get("/api/filters", async (_req, reply) => {
    try {
      const data = await loadTenantData();
      return listAssignmentFilters(data);
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { platform?: string } }>("/api/unassigned", async (req, reply) => {
    try {
      const data = await loadTenantData();
      const platform = VALID_PLATFORMS.includes(req.query.platform as Platform)
        ? (req.query.platform as Platform)
        : undefined;
      return listUnassignedPolicies(data, platform);
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  const parsePlatform = (raw?: string) => (VALID_PLATFORMS.includes(raw as Platform) ? (raw as Platform) : undefined);

  app.get<{ Querystring: { platform?: string } }>("/api/reports/assignments", async (req, reply) => {
    try {
      const data = await loadTenantData();
      return buildAssignmentReport(data, parsePlatform(req.query.platform));
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.get<{ Querystring: { format?: string; platform?: string } }>(
    "/api/reports/assignments/export",
    async (req, reply) => {
      try {
        const data = await loadTenantData();
        const report = buildAssignmentReport(data, parsePlatform(req.query.platform));
        if (req.query.format === "xlsx") {
          reply.header("Content-Type", XLSX_MIME);
          reply.header("Content-Disposition", `attachment; filename="policy-group-assignments.xlsx"`);
          // A Buffer, so Fastify sends the bytes as they are rather than
          // serialising them -- a Uint8Array would go out as a JSON object of
          // numbered keys, which is a corrupt download and not an error.
          return Buffer.from(assignmentReportToXlsx(report));
        }
        if (req.query.format === "csv") {
          reply.header("Content-Type", "text/csv; charset=utf-8");
          reply.header("Content-Disposition", `attachment; filename="policy-group-assignments.csv"`);
          return assignmentReportToCsv(report);
        }
        reply.header("Content-Type", "application/json");
        reply.header("Content-Disposition", `attachment; filename="policy-group-assignments.json"`);
        return report;
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ error: (err as Error).message });
      }
    }
  );

  const csvList = (raw?: string) =>
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  function parseSimulationQuery(query: {
    groups?: string;
    platform?: string;
    deviceFilterIds?: string;
    unassigned?: string;
  }) {
    const platform = VALID_PLATFORMS.includes(query.platform as Platform) ? (query.platform as Platform) : undefined;
    return {
      selectedGroupIds: csvList(query.groups),
      platform,
      deviceFilterIds: csvList(query.deviceFilterIds),
      unassignedPolicyIds: csvList(query.unassigned),
    };
  }

  app.get<{ Querystring: { groups?: string; platform?: string; deviceFilterIds?: string; unassigned?: string } }>(
    "/api/simulate",
    async (req, reply) => {
      try {
        const data = await loadTenantData();
        return computeSimulation(data, parseSimulationQuery(req.query));
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ error: (err as Error).message });
      }
    }
  );

  app.get<{
    Querystring: { groups?: string; platform?: string; deviceFilterIds?: string; unassigned?: string; format?: string };
  }>("/api/simulate/export", async (req, reply) => {
    try {
      const data = await loadTenantData();
      const simulation = computeSimulation(data, parseSimulationQuery(req.query));

      if (req.query.format === "xlsx") {
        reply.header("Content-Type", XLSX_MIME);
        reply.header("Content-Disposition", `attachment; filename="endpoint-baseline.xlsx"`);
        return Buffer.from(simulationToXlsx(simulation));
      }

      if (req.query.format === "csv") {
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="endpoint-baseline.csv"`);
        return simulationToCsv(simulation);
      }

      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="endpoint-baseline.json"`);
      return simulation;
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  app.post("/api/refresh", async (_req, reply) => {
    clearTenantDataCache();
    // Warm the cache here so the reload (and its retries) happen synchronously
    // within the refresh, and return whether it came back complete -- the client
    // shows a banner when the load dropped anything.
    try {
      const data = await loadTenantData();
      return { status: "reloaded", warnings: data.warnings ?? [] };
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ error: (err as Error).message });
    }
  });

  return app;
}
