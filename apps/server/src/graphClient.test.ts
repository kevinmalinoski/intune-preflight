import { describe, expect, it } from "vitest";
import { isRetryableNetworkError, isRetryableStatus, mapWithConcurrency } from "./graphClient.js";

// These guard the reliability fix: gateway timeouts and dropped connections must
// be retried (they were silently dropping policies), while permanent 4xx must not
// be (so the beta-fallback and per-item skip paths still react immediately).
describe("isRetryableStatus", () => {
  it("retries throttling and server/gateway failures", () => {
    for (const s of [429, 500, 502, 503, 504]) expect(isRetryableStatus(s)).toBe(true);
  });

  it("does NOT retry permanent client errors", () => {
    for (const s of [200, 400, 401, 403, 404]) expect(isRetryableStatus(s)).toBe(false);
  });
});

describe("isRetryableNetworkError", () => {
  it("retries dropped/timed-out connections and our own abort", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isRetryableNetworkError(abort)).toBe(true);
    for (const msg of ["fetch failed", "terminated", "ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "getaddrinfo ENOTFOUND graph"]) {
      expect(isRetryableNetworkError(new Error(msg))).toBe(true);
    }
  });

  it("does not retry an ordinary programming error", () => {
    expect(isRetryableNetworkError(new TypeError("x is not a function"))).toBe(false);
  });
});

describe("mapWithConcurrency", () => {
  it("returns a result for every item, in order, regardless of finish timing", async () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const out = await mapWithConcurrency(items, 8, async (n) => {
      await new Promise((r) => setTimeout(r, (25 - n) % 5));
      return n * 2;
    });
    expect(out).toEqual(items.map((n) => n * 2));
  });
});
