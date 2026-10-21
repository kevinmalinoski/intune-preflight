import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./graphClient.js";
import { fetchEndpointSecurityIntents } from "./intuneData.js";

// Simulate a legacy Endpoint Security intent end-to-end without a real tenant:
// stand in for the single Graph seam (graphGetCollection) with a recorded-shape
// response for a BitLocker intent -- its template, categories, settingDefinitions,
// settings and assignments -- and assert the fetcher produces a merged policy
// with REAL Intune setting names (from settingDefinitions), falling back to the
// definitionId heuristic only where a definition is missing.
//
// This is the deterministic stand-in for "create a legacy policy to test": it
// exercises fetchEndpointSecurityIntents' real wiring against the documented
// Graph shapes, so the name resolution can't silently regress. The fetcher takes
// its client as a parameter, so the seam is now an argument rather than a module
// mock.

const TEMPLATE_ID = "tmpl-bitlocker";
const INTENT_ID = "intent-1";
const CAT_ID = "cat-disk-encryption";

// A real display name the definitionId heuristic could never produce -- proves
// the settingDefinitions map won, not the last-segment fallback.
const REAL_NAME = "Require BitLocker for OS and fixed data drives";

const routeCollection = (path: string): unknown[] => {
  if (path.endsWith("/settingDefinitions")) {
    return [
      { id: "bitlocker_requireDeviceEncryption", displayName: REAL_NAME },
      {
        id: "bitlocker_encryptionMethod",
        displayName: "Configure encryption method for Operating System drives",
        documentationUrl: "https://go.microsoft.com/fwlink/?linkid=872526",
        constraints: [
          {
            "@odata.type": "#microsoft.graph.deviceManagementEnumConstraint",
            values: [
              { value: null, displayName: "Not configured" },
              { value: "xtsAes256", displayName: "AES 256bit XTS" },
            ],
          },
        ],
      },
      // note: "bitlocker_orphanSetting" is deliberately absent -> heuristic fallback
    ];
  }
  if (path.includes(`/intents/${INTENT_ID}/categories`)) return [{ id: CAT_ID }];
  if (path.endsWith(`/intents/${INTENT_ID}/settings`)) {
    return [
      { definitionId: "bitlocker_requireDeviceEncryption", value: true },
      { definitionId: "bitlocker_encryptionMethod", valueJson: '"xtsAes256"' },
      { definitionId: "bitlocker_orphanSetting", value: "enabled" },
    ];
  }
  if (path.endsWith(`/intents/${INTENT_ID}/assignments`)) {
    return [{ target: { "@odata.type": "#microsoft.graph.groupAssignmentTarget", groupId: "grp-corp" } }];
  }
  if (path.startsWith("/deviceManagement/templates")) {
    return [
      {
        "@odata.type": "#microsoft.graph.securityBaselineTemplate",
        id: TEMPLATE_ID,
        displayName: "BitLocker",
        platformType: "windows10AndLater",
        templateType: "securityTemplate",
      },
    ];
  }
  if (path === "/deviceManagement/intents") {
    return [{ id: INTENT_ID, displayName: "Corp - BitLocker (Legacy)", templateId: TEMPLATE_ID }];
  }
  return [];
};

/**
 * A Graph client that serves the recorded shapes above and nothing else. The
 * real retry/paging client is covered by graphFetch.test.ts; what matters here
 * is the response shapes, so this answers collection reads directly.
 */
const fakeClient = () => ({
  graphGetCollection: async <T>(path: string): Promise<T[]> => routeCollection(path) as T[],
  graphGetObject: async <T>(): Promise<T> => {
    throw new Error("fetchEndpointSecurityIntents makes no single-object calls");
  },
  mapWithConcurrency,
  concurrency: 8,
  resetGraphStats: () => {},
  getGraphStats: () => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 }),
});

/** The fetcher's context: the client above, plus a warning sink to inspect. */
const fakeContext = () => {
  const warnings: string[] = [];
  return { ctx: { client: fakeClient(), recordWarning: (msg: string) => warnings.push(msg) }, warnings };
};

describe("fetchEndpointSecurityIntents (simulated legacy intent)", () => {
  it("resolves real Intune setting names from the template settingDefinitions", async () => {
    const { ctx, warnings } = fakeContext();
    const [policy] = await fetchEndpointSecurityIntents(ctx);
    // Nothing was dropped -- every assertion below is about a policy that loaded.
    expect(warnings).toEqual([]);

    expect(policy.kind).toBe("endpointSecurity");
    expect(policy.platform).toBe("windows");
    expect(policy.displayName).toBe("Corp - BitLocker (Legacy)");
    // Template displayName becomes the CSP area.
    expect(policy.settings.every((s) => s.cspArea === "BitLocker")).toBe(true);
    // Assignment resolves through the shared resolver.
    expect(policy.assignedGroupIds).toContain("grp-corp");

    const byId = new Map(policy.settings.map((s) => [s.settingId, s]));
    // Real name from settingDefinitions (not the "Require Device Encryption" heuristic).
    expect(byId.get("endpointSecurity:bitlocker_requireDeviceEncryption")?.displayName).toBe(REAL_NAME);
    expect(byId.get("endpointSecurity:bitlocker_encryptionMethod")?.displayName).toBe(
      "Configure encryption method for Operating System drives"
    );
    // Enum code resolves to its human label from the definition's constraints.
    expect(byId.get("endpointSecurity:bitlocker_encryptionMethod")?.value).toBe("AES 256bit XTS");
  });

  it("falls back to the definitionId heuristic when a setting has no definition", async () => {
    const { ctx } = fakeContext();
    const [policy] = await fetchEndpointSecurityIntents(ctx);
    const orphan = policy.settings.find((s) => s.settingId === "endpointSecurity:bitlocker_orphanSetting");
    // No settingDefinition for it -> humanized last segment.
    expect(orphan?.displayName).toBe("Orphan Setting");
  });
});
