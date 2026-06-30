import Fastify from "fastify";
import cors from "@fastify/cors";
import type { Platform } from "@intune-baseline/shared";
import { config } from "./config.js";
import { loadTenantData, clearTenantDataCache } from "./intuneData.js";
import { computeSimulation, listGroupSummaries, simulationToCsv } from "./baseline.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const VALID_PLATFORMS: Platform[] = ["windows", "macos", "ios", "android", "other"];

app.get("/api/health", async () => ({ status: "ok" }));

app.get("/api/groups", async (_req, reply) => {
  try {
    const data = await loadTenantData();
    return listGroupSummaries(data);
  } catch (err) {
    app.log.error(err);
    return reply.status(502).send({ error: (err as Error).message });
  }
});

function parseSimulationQuery(query: { groups?: string; platform?: string }) {
  const selectedGroupIds = (query.groups ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  const platform = VALID_PLATFORMS.includes(query.platform as Platform) ? (query.platform as Platform) : undefined;
  return { selectedGroupIds, platform };
}

app.get<{ Querystring: { groups?: string; platform?: string } }>("/api/simulate", async (req, reply) => {
  try {
    const data = await loadTenantData();
    return computeSimulation(data, parseSimulationQuery(req.query));
  } catch (err) {
    app.log.error(err);
    return reply.status(502).send({ error: (err as Error).message });
  }
});

app.get<{ Querystring: { groups?: string; platform?: string; format?: string } }>(
  "/api/simulate/export",
  async (req, reply) => {
    try {
      const data = await loadTenantData();
      const simulation = computeSimulation(data, parseSimulationQuery(req.query));

      if (req.query.format === "csv") {
        reply.header("Content-Type", "text/csv");
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
  }
);

app.post("/api/refresh", async () => {
  clearTenantDataCache();
  return { status: "cache cleared" };
});

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
