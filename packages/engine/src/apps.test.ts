import { describe, expect, it } from "vitest";
import type { AppAssignment, IntuneApp } from "@intune-preflight/shared";
import {
  appFamilyFromOdataType,
  appPlatformFromOdataType,
  appProductKey,
  appTypeLabel,
  isLobMsiType,
  normalizeAppAssignments,
  normalizeAppDetection,
} from "./apps.js";
import {
  computeSimulation,
  listGroupSummaries,
  simulationAppsToCsv,
  simulationAppsToXlsx,
  simulationToXlsx,
} from "./baseline.js";
import { narrowSimulation } from "./narrow.js";
import { VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";
import type { TenantData } from "./tenantData.js";

const assign = (
  intent: AppAssignment["intent"],
  groupId: string,
  over: Partial<AppAssignment> = {}
): AppAssignment => ({
  intent,
  groupId,
  exclude: false,
  ...over,
});

const app = (id: string, assignments: AppAssignment[], over: Partial<IntuneApp> = {}): IntuneApp => ({
  id,
  displayName: id,
  appType: "Windows app (Win32)",
  family: "win32",
  platform: "windows",
  assignments,
  ...over,
});

const tenant = (over: Partial<TenantData> = {}): TenantData => ({
  policies: [],
  groups: [{ id: "g1", displayName: "g1" }],
  autopilotProfiles: [],
  assignmentFilters: [],
  ...over,
});

const simulate = (data: TenantData, deviceFilterIds: string[] = [], selectedGroupIds = ["g1"]) =>
  computeSimulation(data, { selectedGroupIds, platform: "windows", deviceFilterIds }).apps;

describe("app classification", () => {
  it("places app types the policy classifier would get wrong", () => {
    const platform = (t: string) => appPlatformFromOdataType(`#microsoft.graph.${t}`);
    expect(platform("win32LobApp")).toBe("windows");
    expect(platform("winGetApp")).toBe("windows");
    expect(platform("officeSuiteApp")).toBe("windows");
    expect(platform("macOSOfficeSuiteApp")).toBe("macos");
    expect(platform("macOsVppApp")).toBe("macos");
    expect(platform("iosVppApp")).toBe("ios");
    expect(platform("managedIOSStoreApp")).toBe("ios");
    expect(platform("androidManagedStoreApp")).toBe("android");
    // A web link is offered on every platform; an unknown type is not guessed into one.
    expect(platform("webApp")).toBe("all");
    expect(platform("somethingNewApp")).toBe("other");
    expect(appPlatformFromOdataType(undefined)).toBe("other");
  });

  it("sorts app types into the families an admin thinks in", () => {
    const family = (t: string) => appFamilyFromOdataType(`#microsoft.graph.${t}`);
    expect(family("win32LobApp")).toBe("win32");
    // Enterprise App Catalog: Win32 underneath, but its own family.
    expect(family("win32CatalogApp")).toBe("catalog");
    expect(family("windowsAutoUpdateCatalogApp")).toBe("catalog");
    expect(family("winGetApp")).toBe("store");
    expect(family("microsoftStoreForBusinessApp")).toBe("store");
    expect(family("windowsMobileMSI")).toBe("lob");
    expect(family("windowsUniversalAppX")).toBe("lob");
    expect(family("macOSLobApp")).toBe("lob");
    expect(family("managedIOSLobApp")).toBe("lob");
    // Intune's own app types for Microsoft's own apps: one family.
    expect(family("officeSuiteApp")).toBe("builtin");
    expect(family("windowsMicrosoftEdgeApp")).toBe("builtin");
    expect(family("macOSMicrosoftEdgeApp")).toBe("builtin");
    expect(family("macOSMicrosoftDefenderApp")).toBe("builtin");
    expect(family("iosVppApp")).toBe("vpp");
    expect(family("macOSPkgApp")).toBe("package");
    expect(family("webApp")).toBe("web");
    expect(family("iosiPadOSWebClip")).toBe("web");
    expect(family("androidManagedStoreApp")).toBe("store");
    expect(family("somethingNewApp")).toBe("other");
    // Only the .msi upload carries the convert-to-Win32 advice.
    expect(isLobMsiType("#microsoft.graph.windowsMobileMSI")).toBe(true);
    expect(isLobMsiType("#microsoft.graph.windowsUniversalAppX")).toBe(false);
    expect(isLobMsiType("#microsoft.graph.win32LobApp")).toBe(false);
  });

  it("names known types and opens up the camelCase of unknown ones", () => {
    expect(appTypeLabel("#microsoft.graph.win32LobApp")).toBe("Windows app (Win32)");
    expect(appTypeLabel("#microsoft.graph.somethingNewApp")).toBe("Something New App");
    expect(appTypeLabel(undefined)).toBe("App");
  });
});

describe("normalizeAppDetection", () => {
  const rule = (type: string, fields: Record<string, unknown>) => ({
    "@odata.type": `#microsoft.graph.${type}`,
    ...fields,
  });
  const win32 = (detectionRules: unknown[]) => ({ "@odata.type": "#microsoft.graph.win32LobApp", detectionRules });

  it("reads file, registry and MSI product code rules into one line each", () => {
    expect(
      normalizeAppDetection(
        win32([
          rule("win32LobAppFileSystemDetection", {
            path: "C:\\Program Files\\Notepad++\\",
            fileOrFolderName: "notepad++.exe",
            detectionType: "version",
            operator: "greaterThanOrEqual",
            detectionValue: "8.9.1",
          }),
          rule("win32LobAppFileSystemDetection", {
            path: "C:\\Temp",
            fileOrFolderName: "old.txt",
            detectionType: "doesNotExist",
            check32BitOn64System: true,
          }),
          rule("win32LobAppRegistryDetection", {
            keyPath: "HKEY_LOCAL_MACHINE\\SOFTWARE\\HP",
            detectionType: "exists",
          }),
          rule("win32LobAppRegistryDetection", {
            keyPath: "HKEY_LOCAL_MACHINE\\SOFTWARE\\App",
            valueName: "DisplayVersion",
            detectionType: "string",
            operator: "equal",
            detectionValue: "5.2",
          }),
          rule("win32LobAppProductCodeDetection", {
            productCode: "{B7EAA4DF-2870-4386-910D-6465715A00BE}",
            productVersionOperator: "notConfigured",
          }),
          rule("win32LobAppProductCodeDetection", {
            productCode: "{11111111-2222-3333-4444-555555555555}",
            productVersionOperator: "greaterThanOrEqual",
            productVersion: "2.0",
          }),
        ])
      )
    ).toEqual([
      { method: "file", summary: "File C:\\Program Files\\Notepad++\\notepad++.exe version ≥ 8.9.1" },
      { method: "file", summary: "File C:\\Temp\\old.txt does not exist (32-bit view)" },
      { method: "registry", summary: "Registry HKEY_LOCAL_MACHINE\\SOFTWARE\\HP exists" },
      { method: "registry", summary: "Registry HKEY_LOCAL_MACHINE\\SOFTWARE\\App “DisplayVersion” = 5.2" },
      { method: "msi", summary: "MSI product code {B7EAA4DF-2870-4386-910D-6465715A00BE}" },
      { method: "msi", summary: "MSI product code {11111111-2222-3333-4444-555555555555}, version ≥ 2.0" },
    ]);
  });

  it("names a custom script without carrying any of it", () => {
    const detection = normalizeAppDetection(
      win32([rule("win32LobAppPowerShellScriptDetection", { scriptContent: "U0VDUkVUX1NDUklQVA==" })])
    );
    expect(detection).toEqual([{ method: "script", summary: "Custom detection script (not exported)" }]);
    expect(JSON.stringify(detection)).not.toContain("U0VDUkVU");
  });

  it("reads the newer `rules` shape when `detectionRules` is absent, ignoring requirement rules", () => {
    expect(
      normalizeAppDetection({
        "@odata.type": "#microsoft.graph.win32LobApp",
        rules: [
          rule("win32LobAppFileSystemRule", {
            ruleType: "requirement",
            path: "C:\\Req",
            fileOrFolderName: "x",
            operationType: "exists",
          }),
          rule("win32LobAppRegistryRule", {
            ruleType: "detection",
            keyPath: "HKLM\\SOFTWARE\\App",
            valueName: "Version",
            operationType: "version",
            operator: "greaterThan",
            comparisonValue: "1.0",
          }),
        ],
      })
    ).toEqual([{ method: "registry", summary: "Registry HKLM\\SOFTWARE\\App “Version” version > 1.0" }]);
  });

  it("falls back to what identifies a line-of-business .msi or a Store app", () => {
    expect(
      normalizeAppDetection({
        "@odata.type": "#microsoft.graph.windowsMobileMSI",
        productCode: "{AAAA}",
        productVersion: "3.1",
      })
    ).toEqual([{ method: "msi", summary: "MSI product code {AAAA}, version 3.1" }]);
    expect(
      normalizeAppDetection({ "@odata.type": "#microsoft.graph.winGetApp", packageIdentifier: "XPDP273C0XHQH2" })
    ).toEqual([{ method: "store", summary: "Store package XPDP273C0XHQH2" }]);
    // Built-in apps have no configurable detection.
    expect(normalizeAppDetection({ "@odata.type": "#microsoft.graph.officeSuiteApp" })).toEqual([]);
  });
});

describe("normalizeAppAssignments", () => {
  const target = (type: string, groupId?: string) => ({ "@odata.type": `#microsoft.graph.${type}`, groupId });

  it("maps intents, virtual targets, exclusions and filters", () => {
    const { assignments, dropped } = normalizeAppAssignments([
      { intent: "required", target: target("groupAssignmentTarget", "g1") },
      { intent: "availableWithoutEnrollment", target: target("allLicensedUsersAssignmentTarget") },
      { intent: "uninstall", target: target("allDevicesAssignmentTarget") },
      { intent: "required", target: target("exclusionGroupAssignmentTarget", "g2") },
      {
        intent: "available",
        target: {
          ...target("groupAssignmentTarget", "g3"),
          deviceAndAppManagementAssignmentFilterId: "f1",
          deviceAndAppManagementAssignmentFilterType: "include",
        },
      },
    ]);
    expect(dropped).toBe(0);
    expect(assignments).toEqual([
      { intent: "required", groupId: "g1", exclude: false },
      { intent: "available", withoutEnrollment: true, groupId: VIRTUAL_GROUP_ALL_USERS.id, exclude: false },
      { intent: "uninstall", groupId: VIRTUAL_GROUP_ALL_DEVICES.id, exclude: false },
      { intent: "required", groupId: "g2", exclude: true },
      { intent: "available", groupId: "g3", exclude: false, filter: { filterId: "f1", filterType: "include" } },
    ]);
  });

  it("drops, and counts, an assignment it can't read rather than guessing", () => {
    const { assignments, dropped } = normalizeAppAssignments([
      { intent: "somethingNew", target: target("groupAssignmentTarget", "g1") },
      { intent: "required", target: target("groupAssignmentTarget") },
    ]);
    expect(assignments).toEqual([]);
    expect(dropped).toBe(2);
  });
});

describe("apps in a simulation", () => {
  it("has no apps view at all when the source carries no app data", () => {
    expect(simulate(tenant())).toBeUndefined();
  });

  it("reports unavailable, with the reason, when the tenant's apps could not be read", () => {
    const unavailable = { reason: "permission" as const, detail: "grant it" };
    expect(simulate(tenant({ appsUnavailable: unavailable }))).toEqual({
      unavailable,
      apps: [],
      excluded: [],
      conflicts: [],
      redundant: [],
      sameProduct: [],
      lobMsi: [],
      lobMixedWithWin32: false,
    });
  });

  it("lists apps by intent then name, with the groups that deliver them", () => {
    const sim = simulate(
      tenant({
        apps: [
          app("Zoom", [assign("available", VIRTUAL_GROUP_ALL_USERS.id)]),
          app("Old VPN", [assign("uninstall", "g1")]),
          app("Edge", [assign("required", VIRTUAL_GROUP_ALL_DEVICES.id), assign("required", "g1")]),
          app("7-Zip", [assign("required", "g1")]),
          app("Elsewhere", [assign("required", "g-other")]),
        ],
      })
    );
    expect(sim?.apps.map((a) => `${a.intent}:${a.displayName}`)).toEqual([
      "required:7-Zip",
      "required:Edge",
      "available:Zoom",
      "uninstall:Old VPN",
    ]);
    expect(sim?.apps.find((a) => a.displayName === "Edge")?.viaGroupIds).toEqual([VIRTUAL_GROUP_ALL_DEVICES.id, "g1"]);
    expect(sim?.conflicts).toEqual([]);
  });

  it("scopes to the simulated platform, keeps web links, and leaves unplaced types out", () => {
    const sim = simulate(
      tenant({
        apps: [
          app("Win", [assign("required", "g1")]),
          app("Mac", [assign("required", "g1")], { platform: "macos" }),
          app("Link", [assign("required", "g1")], { platform: "all" }),
          app("Mystery", [assign("required", "g1")], { platform: "other" }),
        ],
      })
    );
    expect(sim?.apps.map((a) => a.displayName)).toEqual(["Link", "Win"]);
  });

  it("an exclusion carves the app out of its own intent only", () => {
    const sim = simulate(
      tenant({
        groups: [
          { id: "g1", displayName: "g1" },
          { id: "g2", displayName: "g2" },
        ],
        apps: [
          app("Office", [
            assign("required", "g1"),
            assign("required", "g2", { exclude: true }),
            assign("available", "g1"),
          ]),
        ],
      }),
      [],
      ["g1", "g2"]
    );
    expect(sim?.apps.map((a) => a.intent)).toEqual(["available"]);
    expect(sim?.excluded).toHaveLength(1);
    expect(sim?.excluded[0]).toMatchObject({ intent: "required", viaGroupIds: ["g1"], excludedViaGroupIds: ["g2"] });
    // Only one intent actually lands, so there is nothing to flag.
    expect(sim?.conflicts).toEqual([]);
    expect(sim?.redundant).toEqual([]);
  });

  it("an include filter drops the app until the device matches it, and names the filter", () => {
    const data = tenant({
      assignmentFilters: [{ id: "f1", displayName: "Kiosks", platform: "windows", rule: "" }],
      apps: [app("Kiosk Browser", [assign("required", "g1", { filter: { filterId: "f1", filterType: "include" } })])],
    });
    const without = simulate(data);
    expect(without?.apps).toEqual([]);
    expect(without?.excluded[0]?.excludedByFilter).toEqual({
      filterId: "f1",
      filterName: "Kiosks",
      filterType: "include",
    });
    expect(simulate(data, ["f1"])?.apps.map((a) => a.displayName)).toEqual(["Kiosk Browser"]);
  });

  it("lands the app when any one delivering assignment passes its filter", () => {
    const sim = simulate(
      tenant({
        apps: [
          app("Teams", [
            assign("required", "g1", { filter: { filterId: "f1", filterType: "include" } }),
            assign("required", VIRTUAL_GROUP_ALL_DEVICES.id),
          ]),
        ],
      })
    );
    expect(sim?.apps[0]?.viaGroupIds).toEqual([VIRTUAL_GROUP_ALL_DEVICES.id]);
    expect(sim?.excluded).toEqual([]);
  });

  it("reports an app assigned to install and to uninstall as a conflict, and names no winner", () => {
    const sim = simulate(
      tenant({
        apps: [app("Legacy CRM", [assign("required", "g1"), assign("uninstall", VIRTUAL_GROUP_ALL_DEVICES.id)])],
      })
    );
    // Both intents stay listed, with equal standing.
    expect(sim?.apps.map((a) => a.intent)).toEqual(["required", "uninstall"]);
    expect(sim?.conflicts).toEqual([
      {
        appId: "Legacy CRM",
        displayName: "Legacy CRM",
        intents: [
          { intent: "required", viaGroupIds: ["g1"] },
          { intent: "uninstall", viaGroupIds: [VIRTUAL_GROUP_ALL_DEVICES.id] },
        ],
      },
    ]);
    expect(sim?.redundant).toEqual([]);
  });

  it("an exclusion that keeps install and uninstall apart leaves no conflict", () => {
    const sim = simulate(
      tenant({
        groups: [
          { id: "g1", displayName: "g1" },
          { id: "g2", displayName: "g2" },
        ],
        apps: [
          app("Legacy CRM", [
            assign("required", "g1"),
            assign("uninstall", "g2"),
            assign("required", "g2", { exclude: true }),
          ]),
        ],
      }),
      [],
      ["g1", "g2"]
    );
    expect(sim?.apps.map((a) => a.intent)).toEqual(["uninstall"]);
    expect(sim?.conflicts).toEqual([]);
  });

  it("reports Required with Available as redundant, not as a conflict", () => {
    const sim = simulate(
      tenant({
        apps: [app("Notepad++", [assign("required", "g1"), assign("available", VIRTUAL_GROUP_ALL_USERS.id)])],
      })
    );
    expect(sim?.conflicts).toEqual([]);
    expect(sim?.redundant).toEqual([
      {
        appId: "Notepad++",
        displayName: "Notepad++",
        kind: "required-and-available",
        intents: [
          { intent: "required", viaGroupIds: ["g1"] },
          { intent: "available", viaGroupIds: [VIRTUAL_GROUP_ALL_USERS.id] },
        ],
      },
    ]);
  });

  it("reports one intent arriving through several groups as redundant", () => {
    const sim = simulate(
      tenant({ apps: [app("Edge", [assign("required", "g1"), assign("required", VIRTUAL_GROUP_ALL_DEVICES.id)])] })
    );
    expect(sim?.redundant).toEqual([
      {
        appId: "Edge",
        displayName: "Edge",
        kind: "multiple-groups",
        intent: "required",
        intents: [{ intent: "required", viaGroupIds: ["g1", VIRTUAL_GROUP_ALL_DEVICES.id] }],
      },
    ]);
  });

  it("recommends converting a line-of-business .msi, and says when it lands beside Win32 apps", () => {
    const lob = (id: string, assignments: AppAssignment[]) =>
      app(id, assignments, { family: "lob", lobMsi: true, appType: "Windows line-of-business app (MSI)" });

    const alone = simulate(tenant({ apps: [lob("Old ERP", [assign("required", "g1")])] }));
    expect(alone?.lobMsi).toEqual([{ appId: "Old ERP", displayName: "Old ERP", intents: ["required"] }]);
    expect(alone?.lobMixedWithWin32).toBe(false);
    expect(alone?.apps[0]).toMatchObject({ family: "lob", lobMsi: true });

    const mixed = simulate(
      tenant({ apps: [lob("Old ERP", [assign("required", "g1")]), app("Edge", [assign("required", "g1")])] })
    );
    expect(mixed?.lobMixedWithWin32).toBe(true);

    // Removing things puts nothing through the installer at enrollment: an LOB
    // .msi set only to uninstall is not advice to repackage it, and a Win32 app
    // set only to uninstall is not something for an LOB install to collide with.
    const removing = simulate(
      tenant({ apps: [lob("Old ERP", [assign("uninstall", "g1")]), app("Edge", [assign("required", "g1")])] })
    );
    expect(removing?.lobMsi).toEqual([]);
    const win32Removed = simulate(
      tenant({ apps: [lob("Old ERP", [assign("required", "g1")]), app("Edge", [assign("uninstall", "g1")])] })
    );
    expect(win32Removed?.lobMsi).toHaveLength(1);
    expect(win32Removed?.lobMixedWithWin32).toBe(false);
  });

  it("reduces an app name to its product, keeping numbers that are part of the name", () => {
    expect(appProductKey("7-Zip (x64) - Auto-Update")).toBe("7 zip");
    expect(appProductKey("7-Zip - 26.04")).toBe("7 zip");
    expect(appProductKey("7-Zip (ZStandard Uninstaller)")).toBe("7 zip");
    expect(appProductKey("Adobe Acrobat Reader DC (Win32)")).toBe("adobe acrobat reader dc");
    expect(appProductKey("Notepad++ (x64) (msi)")).toBe("notepad plus plus");
    expect(appProductKey("Microsoft 365 Apps for Windows 10 and later")).toBe(
      "microsoft 365 apps for windows 10 and later"
    );
    expect(appProductKey("HP Wolf Security - [Uninstaller Only]")).toBe("hp wolf security");
    expect(appProductKey("(x64)")).toBe("");
  });

  it("finds separate app objects that look like one product, and says when they pull opposite ways", () => {
    const named = (id: string, displayName: string, assignments: AppAssignment[]) =>
      app(id, assignments, { displayName });
    const sim = simulate(
      tenant({
        apps: [
          named("z1", "7-Zip (x64) - Auto-Update", [assign("required", "g1")]),
          named("z2", "7-Zip - 26.04", [assign("uninstall", "g1")]),
          named("a1", "Adobe Acrobat Reader DC", [assign("required", "g1")]),
          named("a2", "Adobe Acrobat Reader DC (Win32)", [assign("available", "g1")]),
          named("e1", "Microsoft Edge", [assign("required", "g1")]),
          // Same product, but it never reaches this endpoint.
          named("e2", "Microsoft Edge (x64)", [assign("required", "g-other")]),
        ],
      })
    );
    // Opposing first. Different app objects, so Intune itself reports nothing.
    expect(sim?.sameProduct).toEqual([
      {
        product: "7 zip",
        opposing: true,
        apps: [
          { appId: "z2", displayName: "7-Zip - 26.04", appType: "Windows app (Win32)", intents: ["uninstall"] },
          {
            appId: "z1",
            displayName: "7-Zip (x64) - Auto-Update",
            appType: "Windows app (Win32)",
            intents: ["required"],
          },
        ],
      },
      {
        product: "adobe acrobat reader dc",
        opposing: false,
        apps: [
          {
            appId: "a1",
            displayName: "Adobe Acrobat Reader DC",
            appType: "Windows app (Win32)",
            intents: ["required"],
          },
          {
            appId: "a2",
            displayName: "Adobe Acrobat Reader DC (Win32)",
            appType: "Windows app (Win32)",
            intents: ["available"],
          },
        ],
      },
    ]);
    // They are not ONE app under two intents, so neither of those findings fires.
    expect(sim?.conflicts).toEqual([]);
    expect(sim?.redundant).toEqual([]);
  });

  it("flags 'without enrollment' only when every delivering assignment is one", () => {
    const sim = simulate(
      tenant({
        apps: [
          app("Portal Only", [assign("available", "g1", { withoutEnrollment: true })]),
          app("Mixed", [
            assign("available", "g1", { withoutEnrollment: true }),
            assign("available", VIRTUAL_GROUP_ALL_USERS.id),
          ]),
        ],
      })
    );
    expect(sim?.apps.find((a) => a.displayName === "Portal Only")?.withoutEnrollment).toBe(true);
    expect(sim?.apps.find((a) => a.displayName === "Mixed")?.withoutEnrollment).toBeUndefined();
  });

  it("leaves the merged baseline untouched", () => {
    const sim = computeSimulation(tenant({ apps: [app("Edge", [assign("required", "g1")])] }), {
      selectedGroupIds: ["g1"],
      platform: "windows",
    });
    expect(sim.settings).toEqual([]);
    expect(sim.policies).toEqual([]);
  });
});

describe("group summaries with apps", () => {
  it("counts an app-only group toward its apps' platforms so the picker offers it", () => {
    const data = tenant({
      groups: [{ id: "g1", displayName: "g1" }, { ...VIRTUAL_GROUP_ALL_USERS }],
      apps: [
        app("Mac Tool", [assign("required", "g1")], { platform: "macos" }),
        app("Link", [assign("available", VIRTUAL_GROUP_ALL_USERS.id)], { platform: "all" }),
      ],
    });
    const summaries = listGroupSummaries(data);
    expect(summaries.find((g) => g.id === "g1")?.platforms).toEqual(["macos"]);
    // A virtual group referenced only by an app is still listed.
    expect(summaries.find((g) => g.id === VIRTUAL_GROUP_ALL_USERS.id)?.platforms).toEqual([
      "windows",
      "macos",
      "ios",
      "android",
    ]);
  });
});

describe("exporting apps", () => {
  const data = tenant({
    assignmentFilters: [{ id: "f1", displayName: "Kiosks", platform: "windows", rule: "" }],
    apps: [
      app("Edge", [assign("required", "g1")], {
        publisher: "Microsoft",
        detection: [
          { method: "file", summary: "File C:\\Edge\\msedge.exe exists" },
          { method: "registry", summary: "Registry HKLM\\Edge “Version” version ≥ 120" },
        ],
      }),
      app("CRM, Legacy", [assign("required", "g1"), assign("uninstall", VIRTUAL_GROUP_ALL_DEVICES.id)]),
      app("Kiosk Browser", [assign("available", "g1", { filter: { filterId: "f1", filterType: "include" } })]),
    ],
  });
  const sim = computeSimulation(data, { selectedGroupIds: ["g1"], platform: "windows" });

  it("writes one CSV row per app and intent, landed first, with the reason a carved-out one doesn't apply", () => {
    // Every cell is quoted and the file opens with a BOM -- see toCsv. Parsed
    // back to cells here so the assertion is about content, not quoting.
    const table = (simulationAppsToCsv(sim) ?? "")
      .replace("\ufeff", "")
      .split("\r\n")
      .map((line) => line.slice(1, -1).split('","'));
    const [header, ...rows] = table;
    expect(header).toEqual([
      "App",
      "Publisher",
      "App Type",
      "Family",
      "Intent",
      "Applies",
      "Delivered Via",
      "Not Applied Because",
      "Also Assigned As",
      "Intent Conflict",
      "Redundant",
      "Same Product As",
      "Recommendation",
      "Detection Method",
      "Detection Rule",
      "Without Enrollment",
    ]);
    const W = "Windows app (Win32)";
    expect(rows).toEqual([
      ["CRM, Legacy", "", W, "Win32", "Required", "yes", "g1", "", "Uninstall", "yes", "", "", "", "", "", "no"],
      [
        "Edge",
        "Microsoft",
        W,
        "Win32",
        "Required",
        "yes",
        "g1",
        "",
        "",
        "no",
        "",
        "",
        "",
        "File + Registry",
        "File C:\\Edge\\msedge.exe exists AND Registry HKLM\\Edge “Version” version ≥ 120",
        "no",
      ],
      [
        "CRM, Legacy",
        "",
        W,
        "Win32",
        "Uninstall",
        "yes",
        "All Devices",
        "",
        "Required",
        "yes",
        "",
        "",
        "",
        "",
        "",
        "no",
      ],
      [
        "Kiosk Browser",
        "",
        W,
        "Win32",
        "Available",
        "no",
        "g1",
        "Assignment filter “Kiosks” (include)",
        "",
        "no",
        "",
        "",
        "",
        "",
        "",
        "no",
      ],
    ]);
  });

  it("has nothing to export without app data, rather than an empty table", () => {
    const none = computeSimulation(tenant(), { selectedGroupIds: ["g1"], platform: "windows" });
    expect(simulationAppsToCsv(none)).toBeNull();
    const refused = computeSimulation(tenant({ appsUnavailable: { reason: "permission", detail: "x" } }), {
      selectedGroupIds: ["g1"],
      platform: "windows",
    });
    expect(simulationAppsToCsv(refused)).toBeNull();
  });

  // Stored (uncompressed) ZIP, so part names are readable straight off the bytes.
  const partNames = (bytes: Uint8Array) => {
    const text = new TextDecoder("latin1").decode(bytes);
    return [...new Set([...text.matchAll(/xl\/worksheets\/sheet\d+\.xml/g)].map((m) => m[0]))];
  };

  it("adds an Apps sheet to the workbook only when the simulation has apps", () => {
    const bytes = simulationToXlsx(sim);
    expect(partNames(bytes)).toEqual([
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<sheet name="Endpoint baseline" sheetId="1" r:id="rId1"/>');
    expect(text).toContain('<sheet name="Apps" sheetId="2" r:id="rId2"/>');
    expect(text).toContain("Kiosk Browser");
    // The definitions travel with the flags they explain.
    expect(text).toContain('<sheet name="Finding definitions" sheetId="3" r:id="rId3"/>');
    expect(text).toContain("Install + uninstall conflict");
    expect(text).toContain("windowsMobileMSI");

    const none = computeSimulation(tenant(), { selectedGroupIds: ["g1"], platform: "windows" });
    expect(partNames(simulationToXlsx(none))).toEqual(["xl/worksheets/sheet1.xml"]);
  });

  it("offers the apps as a workbook of their own, with the detection logic", () => {
    const bytes = simulationAppsToXlsx(sim);
    expect(bytes).not.toBeNull();
    const text = new TextDecoder().decode(bytes ?? new Uint8Array());
    expect(text).toContain('<sheet name="Apps" sheetId="1" r:id="rId1"/>');
    expect(text).toContain('<sheet name="Finding definitions" sheetId="2" r:id="rId2"/>');
    const none = computeSimulation(tenant(), { selectedGroupIds: ["g1"], platform: "windows" });
    expect(simulationAppsToXlsx(none)).toBeNull();
  });

  it("leaves apps out of a narrowed export, which is a question about settings", () => {
    expect(narrowSimulation(sim, { view: "conflicts" }).apps).toBeUndefined();
    expect(narrowSimulation(sim, {}).apps).toBeDefined();
  });
});
