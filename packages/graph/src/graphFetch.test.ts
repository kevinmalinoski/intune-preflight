import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphClient, isGraphStatus } from "./graphClient.js";

// graphFetch is the riskiest code in the repo -- it is what runs against a real
// tenant under throttling -- and until now only its predicate helpers were
// tested. These drive the retry loop itself through the public collection API,
// with fetch and the token call stubbed.
//
// The token is the one thing this layer deliberately does NOT own -- the server
// injects an app-only MSAL token, a browser a delegated one -- so stubbing it is
// the whole of the auth setup, with no MSAL or config to mock.
const { getGraphStats, graphGetCollection, resetGraphStats } = createGraphClient({
  getToken: async () => "fake-token",
});

/** A Response-like object good enough for the code paths under test. */
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
  json: async () => body,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetGraphStats();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Make backoff instant so the retry tests don't actually wait ~30s.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => {
    // Only fast-forward the backoff sleeps; the abort timer must NOT fire.
    if (fn.toString().includes("abort")) return 0 as unknown as NodeJS.Timeout;
    fn();
    return 0 as unknown as NodeJS.Timeout;
  }) as typeof setTimeout);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("graphFetch retry loop", () => {
  it("retries a 503 and succeeds, counting the retry and the server error", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(503, "unavailable"))
      .mockResolvedValueOnce(reply(200, { value: [{ id: "a" }] }));

    const items = await graphGetCollection<{ id: string }>("/thing");
    expect(items).toEqual([{ id: "a" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const stats = getGraphStats();
    expect(stats.requests).toBe(2);
    expect(stats.retries).toBe(1);
    expect(stats.serverErrors).toBe(1);
  });

  it("does NOT retry a 403 -- a missing permission must surface immediately", async () => {
    fetchMock.mockResolvedValue(reply(403, "Forbidden"));
    await expect(graphGetCollection("/thing")).rejects.toThrow(/403/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getGraphStats().retries).toBe(0);
  });

  it("gives up after MAX_ATTEMPTS and still counts the final failure", async () => {
    fetchMock.mockResolvedValue(reply(429, "throttled"));
    await expect(graphGetCollection("/thing")).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const stats = getGraphStats();
    expect(stats.requests).toBe(5);
    // Every attempt's 429 is counted, including the last one that threw.
    expect(stats.throttled).toBe(5);
    // Four of the five led to another attempt.
    expect(stats.retries).toBe(4);
  });

  it("honors Retry-After over its own backoff", async () => {
    const sleeps: number[] = [];
    (setTimeout as unknown as ReturnType<typeof vi.fn>).mockImplementation(((fn: () => void, ms?: number) => {
      if (fn.toString().includes("abort")) return 0;
      sleeps.push(ms ?? 0);
      fn();
      return 0;
    }) as never);

    fetchMock
      .mockResolvedValueOnce(reply(429, "slow down", { "retry-after": "7" }))
      .mockResolvedValueOnce(reply(200, { value: [] }));

    await graphGetCollection("/thing");
    expect(sleeps).toContain(7000);
  });

  it("retries a dropped connection", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(reply(200, { value: [{ id: "b" }] }));
    await expect(graphGetCollection<{ id: string }>("/thing")).resolves.toEqual([{ id: "b" }]);
    expect(getGraphStats().retries).toBe(1);
  });

  it("retries when the response BODY fails mid-stream, not just the headers", async () => {
    // fetch() resolves on headers; a stalled or truncated body throws from
    // .json(). That read now happens inside the timeout/retry scope.
    fetchMock
      .mockResolvedValueOnce({
        ...reply(200, {}),
        json: async () => {
          throw new Error("terminated");
        },
      })
      .mockResolvedValueOnce(reply(200, { value: [{ id: "c" }] }));

    await expect(graphGetCollection<{ id: string }>("/thing")).resolves.toEqual([{ id: "c" }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getGraphStats().retries).toBe(1);
  });

  it("follows @odata.nextLink across pages", async () => {
    fetchMock
      .mockResolvedValueOnce(reply(200, { value: [{ id: "p1" }], "@odata.nextLink": "https://graph/next" }))
      .mockResolvedValueOnce(reply(200, { value: [{ id: "p2" }] }));

    await expect(graphGetCollection<{ id: string }>("/thing")).resolves.toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(fetchMock.mock.calls[1][0]).toBe("https://graph/next");
  });

  it("treats 204 as an empty result rather than a parse error", async () => {
    fetchMock.mockResolvedValueOnce({
      ...reply(204, null),
      json: async () => {
        throw new Error("no body to parse");
      },
    });
    await expect(graphGetCollection("/thing")).resolves.toEqual([]);
  });
});

describe("GraphHttpError", () => {
  it("carries the status so callers can branch on it instead of the message", async () => {
    fetchMock.mockResolvedValue(reply(400, "Resource not found for the segment"));
    const err = await graphGetCollection("/thing").catch((e) => e);

    // The beta fallback in intuneData keys on exactly this.
    expect(isGraphStatus(err, 400, 404)).toBe(true);
    expect(isGraphStatus(err, 403)).toBe(false);
  });

  it("does not mistake a network failure for an HTTP status", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));
    const err = await graphGetCollection("/thing").catch((e) => e);
    // No response ever arrived, so no status -- the beta fallback must not fire
    // and retry the whole thing on an endpoint that is equally unreachable.
    expect(isGraphStatus(err, 400, 404)).toBe(false);
  });
});
