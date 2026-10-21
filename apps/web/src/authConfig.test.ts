/**
 * The redirect URI is the one value in the live build that fails in a way you
 * cannot debug from the browser: Entra compares it to the app registration as an
 * exact string, and a mismatch ends the sign-in on Microsoft's own domain with
 * `AADSTS50011` and nothing in the console. So every way it can be built gets a
 * test, including the two forms of `BASE_URL` that would otherwise concatenate
 * into something subtly wrong.
 */

import { describe, expect, it } from "vitest";
import { buildMsalConfig, GRAPH_SCOPES, REDIRECT_HANDLING, resolveRedirectUri } from "./authConfig.ts";

describe("resolveRedirectUri", () => {
  it("derives origin + base path for a directory base", () => {
    expect(resolveRedirectUri({ origin: "https://kevinmalinoski.github.io", basePath: "/preflight-spike/app/" })).toBe(
      "https://kevinmalinoski.github.io/preflight-spike/app/"
    );
  });

  it("keeps the trailing slash at the origin root", () => {
    // `https://host` and `https://host/` are different strings to Entra, so the
    // derived form has to settle on one -- and the page at the root IS served
    // with the slash.
    expect(resolveRedirectUri({ origin: "http://localhost:5173", basePath: "/" })).toBe("http://localhost:5173/");
  });

  it("adds the trailing slash a hand-written base may be missing", () => {
    expect(resolveRedirectUri({ origin: "https://example.com", basePath: "/app" })).toBe("https://example.com/app/");
  });

  it("falls back to the root for a relative base", () => {
    // `--base=./` sets BASE_URL to `./`, which naively concatenated gives the
    // nonsense `https://example.com./`.
    expect(resolveRedirectUri({ origin: "https://example.com", basePath: "./" })).toBe("https://example.com/");
    expect(resolveRedirectUri({ origin: "https://example.com", basePath: "" })).toBe("https://example.com/");
    expect(resolveRedirectUri({ origin: "https://example.com" })).toBe("https://example.com/");
  });

  it("never doubles the slash", () => {
    expect(resolveRedirectUri({ origin: "https://example.com/", basePath: "/app/" })).toBe("https://example.com/app/");
  });

  it("uses a configured value verbatim", () => {
    // Verbatim is the point: this string is what was pasted into the app
    // registration, so normalizing it would break the one case the override
    // exists for.
    expect(
      resolveRedirectUri({
        configured: "https://preflight.example.com/inspect",
        origin: "https://example.com",
        basePath: "/app/",
      })
    ).toBe("https://preflight.example.com/inspect");
  });

  it("trims surrounding whitespace from a configured value", () => {
    expect(
      resolveRedirectUri({ configured: "  https://example.com/app/  ", origin: "https://other.test", basePath: "/" })
    ).toBe("https://example.com/app/");
  });

  it("falls through to the derived value when the override is blank", () => {
    // An unset Vite env var arrives as "" in some setups; it must not win.
    expect(resolveRedirectUri({ configured: "", origin: "https://example.com", basePath: "/app/" })).toBe(
      "https://example.com/app/"
    );
    expect(resolveRedirectUri({ configured: "   ", origin: "https://example.com", basePath: "/app/" })).toBe(
      "https://example.com/app/"
    );
  });
});

describe("buildMsalConfig", () => {
  const config = buildMsalConfig({
    tenantId: "11111111-2222-3333-4444-555555555555",
    clientId: "99999999-8888-7777-6666-555555555555",
    redirectUri: "https://example.com/app/",
  });

  it("points at the single tenant being inspected", () => {
    expect(config.auth.authority).toBe("https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555");
  });

  it("passes the client ID and redirect URI through untouched", () => {
    expect(config.auth.clientId).toBe("99999999-8888-7777-6666-555555555555");
    expect(config.auth.redirectUri).toBe("https://example.com/app/");
  });

  it("caches in sessionStorage so the session dies with the tab", () => {
    // The deliberate choice this whole build is sold on. localStorage would
    // outlive the tab and leave a usable token behind on a shared machine.
    expect(config.cache?.cacheLocation).toBe("sessionStorage");
  });
});

describe("the delegated permissions asked for", () => {
  it("are all read-only", () => {
    // CONTRIBUTING: the tool must never be able to write to a tenant.
    for (const scope of GRAPH_SCOPES) expect(scope).toMatch(/\.Read\.All$/);
  });
});

describe("REDIRECT_HANDLING", () => {
  it("does not navigate back to the URL the sign-in started from", () => {
    // The redirect URI is the app itself, so the extra navigation would only
    // buy a second page load -- and a second tenant load with it.
    expect(REDIRECT_HANDLING.navigateToLoginRequestUrl).toBe(false);
  });
});
