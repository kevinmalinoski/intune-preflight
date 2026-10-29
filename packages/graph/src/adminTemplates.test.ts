import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "./graphClient.js";
import { fetchAdminTemplates } from "./intuneData.js";

/**
 * Administrative Template areas, against the shapes a real tenant returns.
 *
 * Two things are being pinned. Graph leaves `categoryPath` null on some
 * `admxIngested` definitions -- in the tenant this was written from, three of
 * the six settings in one Chrome policy -- and those used to land in a generic
 * "Administrative Templates" bucket that said nothing about what they
 * configure. And an uploaded third-party ADMX is worth marking as such, which
 * `policyType` already distinguishes.
 *
 * The ids and the null/non-null split below are copied from that tenant, not
 * invented, so a regression here is a regression against something real.
 */

const POLICY_ID = "chrome-update-policy";
const CHROME_CAT = "527b38cf-7a8b-4b9f-bf6b-c7368b912f18";
const GOOGLE_UPDATE_PATH = "\\Google\\Google Update\\Applications\\Google Chrome";

const definitionValues = [
  // Graph gave no categoryPath for these -- only a category id.
  {
    id: "dv-1",
    enabled: true,
    definition: {
      id: "def-relaunch-notify",
      displayName: "Notify a user that a browser relaunch or device restart is recommended or required",
      categoryPath: null,
      groupPolicyCategoryId: CHROME_CAT,
      policyType: "admxIngested",
    },
  },
  // ...and a full path for this one, in the very same policy.
  {
    id: "dv-2",
    enabled: true,
    definition: {
      id: "def-target-channel",
      displayName: "Target Channel override",
      categoryPath: GOOGLE_UPDATE_PATH,
      groupPolicyCategoryId: "some-other-category",
      policyType: "admxIngested",
    },
  },
  // A built-in template: same shape, different policyType.
  {
    id: "dv-3",
    enabled: false,
    definition: {
      id: "def-builtin",
      displayName: "Built-in setting",
      categoryPath: "\\System\\Logon",
      groupPolicyCategoryId: "builtin-cat",
      policyType: "admxBacked",
    },
  },
];

const routeCollection = (path: string): unknown[] => {
  if (path.startsWith("/deviceManagement/groupPolicyConfigurations?")) {
    return [{ id: POLICY_ID, displayName: "WINDOWS - DEVICE - Browser - Chrome - Update Policy", assignments: [] }];
  }
  if (path.includes("/definitionValues")) return definitionValues;
  if (path.startsWith("/deviceManagement/groupPolicyCategories")) {
    return [{ id: CHROME_CAT, displayName: "Google Chrome" }];
  }
  return [];
};

const fakeContext = (route = routeCollection) => {
  const paths: string[] = [];
  const warnings: string[] = [];
  const ctx = {
    client: {
      graphGetCollection: async <T>(path: string): Promise<T[]> => {
        paths.push(path);
        return route(path) as T[];
      },
      graphGetObject: async <T>(): Promise<T> => {
        throw new Error("fetchAdminTemplates makes no single-object calls");
      },
      mapWithConcurrency,
      concurrency: 8,
      resetGraphStats: () => {},
      getGraphStats: () => ({ requests: 0, retries: 0, throttled: 0, serverErrors: 0, timeouts: 0 }),
    },
    recordWarning: (msg: string) => warnings.push(msg),
  };
  return { ctx, paths, warnings };
};

const areasOf = async (route?: (p: string) => unknown[]) => {
  const { ctx, paths, warnings } = fakeContext(route);
  const [policy] = await fetchAdminTemplates(ctx);
  return { areas: policy.settings.map((s) => s.cspArea), paths, warnings };
};

describe("fetchAdminTemplates (ADMX category and provenance)", () => {
  it("recovers a category Graph left null, by its id", async () => {
    const { areas } = await areasOf();
    expect(areas[0]).toBe("ADMX (Imported) Google Chrome");
  });

  it("keeps the full category path when Graph gives one", async () => {
    const { areas } = await areasOf();
    expect(areas[1]).toBe("ADMX (Imported) Google\\Google Update\\Applications\\Google Chrome");
  });

  it("marks only uploaded ADMX, leaving built-in templates unprefixed", async () => {
    const { areas } = await areasOf();
    expect(areas[2]).toBe("System\\Logon");
  });

  it("reads the category collection once, and only when a null turns up", async () => {
    const { paths } = await areasOf();
    expect(paths.filter((p) => p.startsWith("/deviceManagement/groupPolicyCategories"))).toHaveLength(1);

    // Every definition has a path -> the index is never fetched.
    const allPathed = (path: string): unknown[] =>
      path.includes("/definitionValues") ? [definitionValues[1]] : routeCollection(path);
    const { paths: lean } = await areasOf(allPathed);
    expect(lean.some((p) => p.startsWith("/deviceManagement/groupPolicyCategories"))).toBe(false);
  });

  it("falls back to the generic label, unprefixed, when the category cannot be read", async () => {
    const failing = (path: string): unknown[] => {
      if (path.startsWith("/deviceManagement/groupPolicyCategories")) throw new Error("403 Forbidden");
      return routeCollection(path);
    };
    const { areas, warnings } = await areasOf(failing);
    // The setting is still in the baseline -- a worse name, not a dropped row.
    expect(areas[0]).toBe("Administrative Templates");
    expect(warnings.join(" ")).toMatch(/Administrative Template categories/);
  });
});
