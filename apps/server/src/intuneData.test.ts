import { beforeEach, describe, expect, it, vi } from "vitest";

// Simulate a legacy Endpoint Security intent end-to-end without a real tenant:
// mock the single Graph seam (graphGetCollection) with a recorded-shape response
// for a BitLocker intent -- its template, categories, settingDefinitions,
// settings and assignments -- and assert the fetcher produces a merged policy
// with REAL Intune setting names (from settingDefinitions), falling back to the
// definitionId heuristic only where a definition is missing.
//
// This is the deterministic stand-in for "create a legacy policy to test": it
// exercises fetchEndpointSecurityIntents' real wiring against the documented
// Graph shapes, so the name resolution can't silently regress.

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

vi.mock("./graphClient.js", async (orig) => {
  const actual = await orig<typeof import("./graphClient.js")>();
  return {
    ...actual,
    graphGetCollection: vi.fn(async (path: string) => routeCollection(path)),
  };
});

// Imported after the mock is registered so it binds to the mocked graphGetCollection.
const { fetchEndpointSecurityIntents } = await import("./intuneData.js");

describe("fetchEndpointSecurityIntents (simulated legacy intent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves real Intune setting names from the template settingDefinitions", async () => {
    const [policy] = await fetchEndpointSecurityIntents();

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
    const [policy] = await fetchEndpointSecurityIntents();
    const orphan = policy.settings.find((s) => s.settingId === "endpointSecurity:bitlocker_orphanSetting");
    // No settingDefinition for it -> humanized last segment.
    expect(orphan?.displayName).toBe("Orphan Setting");
  });
});
