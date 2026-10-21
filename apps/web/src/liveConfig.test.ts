/**
 * The tenant and client IDs reach this app from a query string -- which means
 * from whatever link someone was sent -- and the tenant ID is interpolated into
 * the authority URL. These tests are the record of what is accepted into that
 * position and what is not.
 */

import { describe, expect, it } from "vitest";
import { isValidClientId, isValidTenantId, parseLiveConfigQuery, resolveLiveConfig } from "./liveConfig.ts";

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "99999999-8888-7777-6666-555555555555";

describe("isValidTenantId", () => {
  it("accepts a GUID in either case", () => {
    expect(isValidTenantId(TENANT)).toBe(true);
    expect(isValidTenantId(TENANT.toUpperCase())).toBe(true);
  });

  it("accepts a verified domain", () => {
    expect(isValidTenantId("contoso.onmicrosoft.com")).toBe(true);
    expect(isValidTenantId("my-tenant.co.uk")).toBe(true);
  });

  it("rejects the multi-tenant aliases", () => {
    // This build is single-tenant on purpose: `common` would sign the admin in
    // to whichever tenant their account prefers, which need not be the one the
    // page says it is inspecting.
    expect(isValidTenantId("common")).toBe(false);
    expect(isValidTenantId("organizations")).toBe(false);
  });

  it("rejects a GUID with anything around it", () => {
    // The regexes are anchored for a reason: unanchored, every one of these
    // would be accepted and interpolated straight into the authority URL.
    expect(isValidTenantId(`../${TENANT}`)).toBe(false);
    expect(isValidTenantId(`${TENANT}/evil`)).toBe(false);
    expect(isValidTenantId(`${TENANT}@evil.test`)).toBe(false);
    expect(isValidTenantId(` ${TENANT}`)).toBe(false);
    expect(isValidClientId(`../${CLIENT}`)).toBe(false);
    expect(isValidClientId(`${CLIENT}/evil`)).toBe(false);
  });

  it("rejects anything that could walk out of the authority's path segment", () => {
    expect(isValidTenantId("../../evil.com")).toBe(false);
    expect(isValidTenantId("contoso.com/evil")).toBe(false);
    expect(isValidTenantId("https://evil.test")).toBe(false);
    expect(isValidTenantId("contoso.com?x=1")).toBe(false);
    expect(isValidTenantId("contoso.com#frag")).toBe(false);
    expect(isValidTenantId("user@contoso.com")).toBe(false);
    expect(isValidTenantId("conto so.com")).toBe(false);
    expect(isValidTenantId("")).toBe(false);
  });
});

describe("isValidClientId", () => {
  it("accepts only a GUID", () => {
    expect(isValidClientId(CLIENT)).toBe(true);
    expect(isValidClientId("contoso.onmicrosoft.com")).toBe(false);
    expect(isValidClientId("not-a-guid")).toBe(false);
    expect(isValidClientId("")).toBe(false);
  });
});

describe("parseLiveConfigQuery", () => {
  it("reads both parameters", () => {
    expect(parseLiveConfigQuery(`?tenant=${TENANT}&client=${CLIENT}`)).toEqual({
      tenantId: TENANT,
      clientId: CLIENT,
    });
  });

  it("reads one without the other", () => {
    // A consultant's bookmarks share one app registration, so a link may carry
    // only the tenant.
    expect(parseLiveConfigQuery(`?tenant=${TENANT}`)).toEqual({ tenantId: TENANT });
    expect(parseLiveConfigQuery(`?client=${CLIENT}`)).toEqual({ clientId: CLIENT });
  });

  it("drops an invalid value rather than carrying it", () => {
    expect(parseLiveConfigQuery(`?tenant=../evil&client=${CLIENT}`)).toEqual({ clientId: CLIENT });
    expect(parseLiveConfigQuery(`?tenant=${TENANT}&client=nope`)).toEqual({ tenantId: TENANT });
  });

  it("tolerates an empty or unrelated query string", () => {
    expect(parseLiveConfigQuery("")).toEqual({});
    expect(parseLiveConfigQuery("?tab=assignments")).toEqual({});
  });

  it("trims whitespace a copied link may have picked up", () => {
    expect(parseLiveConfigQuery(`?tenant=${encodeURIComponent(` ${TENANT} `)}`)).toEqual({ tenantId: TENANT });
  });
});

describe("resolveLiveConfig", () => {
  // No `localStorage` in the test environment, which is exactly the
  // blocked-site-data case storage.ts exists for: every access throws and is
  // swallowed, so nothing persists and the query string is all there is.
  it("returns a config when the query supplies both halves", () => {
    expect(resolveLiveConfig(`?tenant=${TENANT}&client=${CLIENT}`)).toEqual({ tenantId: TENANT, clientId: CLIENT });
  });

  it("returns null when either half is missing", () => {
    expect(resolveLiveConfig(`?tenant=${TENANT}`)).toBeNull();
    expect(resolveLiveConfig(`?client=${CLIENT}`)).toBeNull();
    expect(resolveLiveConfig("")).toBeNull();
  });

  it("returns null when a supplied value is invalid", () => {
    expect(resolveLiveConfig(`?tenant=evil.com/x&client=${CLIENT}`)).toBeNull();
  });
});
