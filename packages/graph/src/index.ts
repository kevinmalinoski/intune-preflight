/**
 * The Graph-reading layer: everything that turns a Microsoft Intune tenant into
 * the `TenantData` the engine simulates over.
 *
 * Like `packages/engine`, this package is portable -- no Node built-ins, no
 * `process.env`, no server modules -- but for a different reason. The engine is
 * pure because it does no I/O at all; this package *is* the I/O, and stays
 * portable by taking the two things that differ between hosts as parameters: the
 * access token (`createGraphClient({ getToken })`) and the cache the loaded
 * tenant lives in. A Fastify server passes an app-only MSAL token; a browser
 * build passes a delegated one from the signed-in user, and reads the identical
 * endpoints with the identical retry, paging and v1.0 -> beta fallback
 * behaviour. `packages/graph/src/purity.test.ts` is what keeps that true.
 */

export { TtlCache } from "./cache.js";

export {
  createGraphClient,
  type GraphClient,
  type GraphClientOptions,
  GraphHttpError,
  type GraphStats,
  isGraphStatus,
  isRetryableNetworkError,
  isRetryableStatus,
  mapWithConcurrency,
} from "./graphClient.js";

export { loadTenantData, type LoadTenantDataOptions, type TenantMode } from "./intuneData.js";
