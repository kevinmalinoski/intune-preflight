import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { loadTenantData, clearTenantDataCache } from "./intuneData.js";
import { baselineToCsv, buildGraphPayload, computeGroupBaseline, listGroupSummaries } from "./baseline.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

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

app.get("/api/graph", async (_req, reply) => {
  try {
    const data = await loadTenantData();
    return buildGraphPayload(data);
  } catch (err) {
    app.log.error(err);
    return reply.status(502).send({ error: (err as Error).message });
  }
});

app.get<{ Params: { id: string } }>("/api/groups/:id/baseline", async (req, reply) => {
  try {
    const data = await loadTenantData();
    const baseline = computeGroupBaseline(data, req.params.id);
    if (!baseline) return reply.status(404).send({ error: "Group not found" });
    return baseline;
  } catch (err) {
    app.log.error(err);
    return reply.status(502).send({ error: (err as Error).message });
  }
});

app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
  "/api/groups/:id/export",
  async (req, reply) => {
    try {
      const data = await loadTenantData();
      const baseline = computeGroupBaseline(data, req.params.id);
      if (!baseline) return reply.status(404).send({ error: "Group not found" });

      if (req.query.format === "csv") {
        reply.header("Content-Type", "text/csv");
        reply.header("Content-Disposition", `attachment; filename="${baseline.group.displayName}-baseline.csv"`);
        return baselineToCsv(baseline);
      }

      reply.header("Content-Type", "application/json");
      reply.header("Content-Disposition", `attachment; filename="${baseline.group.displayName}-baseline.json"`);
      return baseline;
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
