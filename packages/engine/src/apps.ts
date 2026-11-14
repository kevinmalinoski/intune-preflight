import type {
  AppAssignment,
  AppDetection,
  AppFamily,
  AppIntent,
  AppIntentConflict,
  AppIntentVia,
  AppLobMsiFinding,
  AppPlatform,
  AppProductFinding,
  AppRedundancy,
  IntuneApp,
  Platform,
  SimulationApp,
  SimulationApps,
} from "@intune-preflight/shared";
import { APP_INTENTS } from "@intune-preflight/shared";
import { passesAssignmentFilter } from "./assignmentFilter.js";
import { parseAssignmentTarget, VIRTUAL_GROUP_ALL_DEVICES, VIRTUAL_GROUP_ALL_USERS } from "./normalize.js";
import type { TenantData } from "./tenantData.js";

/**
 * Apps: which of the tenant's assigned apps reach a simulated endpoint, and
 * under which intent (Required / Available / Uninstall).
 *
 * Kept apart from baseline.ts on purpose. The baseline is a merge of SETTINGS
 * keyed on a setting id and compared by value; an app has neither, so folding
 * apps into it would mean inventing both. What the two do share is assignment
 * resolution -- include/exclude groups and Assignment Filters -- and that is the
 * only thing borrowed here.
 */

/** `#microsoft.graph.win32LobApp` -> `win32lobapp`. */
function shortType(odataType: string | undefined): string {
  return (odataType ?? "").replace(/^#?microsoft\.graph\./i, "").toLowerCase();
}

/**
 * Which OS an app type installs on.
 *
 * Not `platformFromOdataType`: that classifier is tuned to policy types and
 * gets apps wrong in both directions. `officeSuiteApp` and `winGetApp` carry no
 * "windows" in their names, and the generic `webApp` is not unclassifiable but
 * genuinely cross-platform. macOS is tested before iOS because Graph spells one
 * type `macOsVppApp`, and `ios` is anchored so it can't match inside another word.
 */
export function appPlatformFromOdataType(odataType: string | undefined): AppPlatform {
  const t = shortType(odataType);
  if (!t) return "other";
  if (t.includes("android")) return "android";
  if (t.includes("macos")) return "macos";
  if (/^(managed)?ios/.test(t)) return "ios";
  if (t === "webapp") return "all";
  if (/^win(32|get|dows)/.test(t) || t === "officesuiteapp" || t === "microsoftstoreforbusinessapp") return "windows";
  return "other";
}

/**
 * The family an app type belongs to -- how it is packaged and delivered.
 *
 * Tested most-specific first: the Enterprise App Catalog types are Win32 under
 * the hood and have "win32" in one of their names, a VPP app is also a store
 * app, and a web clip is a web link whatever platform it is for.
 */
export function appFamilyFromOdataType(odataType: string | undefined): AppFamily {
  const t = shortType(odataType);
  if (!t) return "other";
  if (t.includes("catalogapp")) return "catalog";
  if (t.includes("vpp")) return "vpp";
  if (t.includes("webapp") || t.includes("webclip")) return "web";
  if (t.includes("officesuite") || t.includes("microsoftedge") || t.includes("microsoftdefender")) return "builtin";
  if (t.includes("lob") && t !== "win32lobapp") return "lob";
  if (t === "windowsmobilemsi" || t === "windowsuniversalappx" || t === "windowsappx") return "lob";
  if (t === "win32lobapp") return "win32";
  if (t === "macosdmgapp" || t === "macospkgapp") return "package";
  if (t.includes("store") || t === "wingetapp" || t === "androidforworkapp") return "store";
  return "other";
}

/** True for a Windows line-of-business .msi -- see IntuneApp.lobMsi. */
export function isLobMsiType(odataType: string | undefined): boolean {
  return shortType(odataType) === "windowsmobilemsi";
}

const OPERATOR: Record<string, string> = {
  equal: "=",
  notEqual: "≠",
  greaterThan: ">",
  greaterThanOrEqual: "≥",
  lessThan: "<",
  lessThanOrEqual: "≤",
};

/** `C:\Program Files\App` + `app.exe`, without doubling or dropping the separator. */
function joinPath(folder: unknown, name: unknown): string {
  const a = typeof folder === "string" ? folder.replace(/[\\/]+$/, "") : "";
  const b = typeof name === "string" ? name.replace(/^[\\/]+/, "") : "";
  return a && b ? `${a}\\${b}` : a || b;
}

/** "version ≥ 24.08", "exists", "does not exist" -- the test a file or registry rule applies. */
function comparison(kind: unknown, operator: unknown, value: unknown): string {
  const k = typeof kind === "string" ? kind : "";
  if (!k || k === "notConfigured" || k === "exists") return "exists";
  if (k === "doesNotExist") return "does not exist";
  const what: Record<string, string> = {
    version: "version",
    // A registry value compared as text or a number: the value's own name is
    // already in the sentence, so there is no noun to add.
    string: "",
    integer: "",
    modifiedDate: "modified date",
    createdDate: "created date",
    sizeInMB: "size (MB)",
    sizeInBytes: "size (bytes)",
    appVersion: "app version",
  };
  const op = OPERATOR[typeof operator === "string" ? operator : ""] ?? "";
  const v = value === undefined || value === null || value === "" ? "" : String(value);
  const noun = what[k] ?? k;
  return op && v ? `${noun} ${op} ${v}`.trim() : noun || "exists";
}

/**
 * How Intune decides an app is installed, from the app's Graph object.
 *
 * Win32 and Enterprise App Catalog apps carry their rules in `detectionRules`
 * (and, on beta, again in `rules` tagged `ruleType: "detection"`, under
 * slightly different property names) -- both are read. A line-of-business .msi
 * has no rules of its own: Intune detects it by the product code in the
 * package. A new-Store app is identified by its package id.
 *
 * A custom script is reported as a script and nothing else. Its content is
 * deliberately not read past: it is code, it can be long, and a copy of a
 * tenant's detection scripts has no business riding along in a spreadsheet.
 */
export function normalizeAppDetection(item: Record<string, unknown>): AppDetection[] {
  const type = shortType(item["@odata.type"] as string | undefined);
  const out: AppDetection[] = [];

  const legacy = Array.isArray(item.detectionRules) ? (item.detectionRules as Record<string, unknown>[]) : [];
  const modern = Array.isArray(item.rules)
    ? (item.rules as Record<string, unknown>[]).filter((r) => r.ruleType === "detection")
    : [];
  for (const rule of legacy.length > 0 ? legacy : modern) {
    const kind = shortType(rule["@odata.type"] as string | undefined);
    const view32 = rule.check32BitOn64System === true ? " (32-bit view)" : "";
    if (kind.includes("filesystem")) {
      const test = comparison(
        rule.detectionType ?? rule.operationType,
        rule.operator,
        rule.detectionValue ?? rule.comparisonValue
      );
      out.push({ method: "file", summary: `File ${joinPath(rule.path, rule.fileOrFolderName)} ${test}${view32}` });
    } else if (kind.includes("registry")) {
      const value = typeof rule.valueName === "string" && rule.valueName ? ` “${rule.valueName}”` : "";
      const test = comparison(
        rule.detectionType ?? rule.operationType,
        rule.operator,
        rule.detectionValue ?? rule.comparisonValue
      );
      out.push({ method: "registry", summary: `Registry ${String(rule.keyPath ?? "")}${value} ${test}${view32}` });
    } else if (kind.includes("productcode")) {
      const op = OPERATOR[typeof rule.productVersionOperator === "string" ? rule.productVersionOperator : ""];
      const version = op && rule.productVersion ? `, version ${op} ${String(rule.productVersion)}` : "";
      out.push({ method: "msi", summary: `MSI product code ${String(rule.productCode ?? "")}${version}` });
    } else if (kind.includes("script")) {
      out.push({ method: "script", summary: "Custom detection script (not exported)" });
    } else {
      out.push({ method: "other", summary: appTypeLabel(rule["@odata.type"] as string | undefined) });
    }
  }
  if (out.length > 0) return out;

  if (type === "windowsmobilemsi" && typeof item.productCode === "string" && item.productCode) {
    const version =
      typeof item.productVersion === "string" && item.productVersion ? `, version ${item.productVersion}` : "";
    return [{ method: "msi", summary: `MSI product code ${item.productCode}${version}` }];
  }
  if (type === "wingetapp" && typeof item.packageIdentifier === "string" && item.packageIdentifier) {
    return [{ method: "store", summary: `Store package ${item.packageIdentifier}` }];
  }
  return [];
}

const APP_TYPE_LABELS: Record<string, string> = {
  win32lobapp: "Windows app (Win32)",
  win32catalogapp: "Enterprise App Catalog app",
  windowsautoupdatecatalogapp: "Enterprise App Catalog app (auto-update)",
  wingetapp: "Microsoft Store app (new)",
  windowsmobilemsi: "Windows line-of-business app (MSI)",
  windowsuniversalappx: "Windows line-of-business app (AppX/MSIX)",
  windowsappx: "Windows line-of-business app (AppX)",
  officesuiteapp: "Microsoft 365 Apps (Windows)",
  windowsmicrosoftedgeapp: "Microsoft Edge (Windows)",
  microsoftstoreforbusinessapp: "Microsoft Store for Business app",
  windowsstoreapp: "Microsoft Store app (legacy)",
  windowswebapp: "Windows web link",
  macoslobapp: "macOS line-of-business app",
  macosdmgapp: "macOS app (DMG)",
  macospkgapp: "macOS app (PKG)",
  macosmicrosoftedgeapp: "Microsoft Edge (macOS)",
  macosmicrosoftdefenderapp: "Microsoft Defender (macOS)",
  macosofficesuiteapp: "Microsoft 365 Apps (macOS)",
  macosvppapp: "macOS volume-purchased app",
  macoswebclip: "macOS web clip",
  iosstoreapp: "iOS store app",
  iosvppapp: "iOS volume-purchased app",
  ioslobapp: "iOS line-of-business app",
  iosipadoswebclip: "iOS/iPadOS web clip",
  managedioslobapp: "Managed iOS line-of-business app",
  managediosstoreapp: "Managed iOS store app",
  androidstoreapp: "Android store app",
  androidlobapp: "Android line-of-business app",
  androidmanagedstoreapp: "Managed Google Play store app",
  androidmanagedstorewebapp: "Managed Google Play web link",
  androidforworkapp: "Android for Work app",
  managedandroidlobapp: "Managed Android line-of-business app",
  managedandroidstoreapp: "Managed Android store app",
  webapp: "Web link",
};

/**
 * A readable name for an app type. An unlisted type falls back to its Graph
 * name with the camelCase opened up -- recognisable, and honest about being a
 * type this tool has no better name for.
 */
export function appTypeLabel(odataType: string | undefined): string {
  const known = APP_TYPE_LABELS[shortType(odataType)];
  if (known) return known;
  const raw = (odataType ?? "").replace(/^#?microsoft\.graph\./i, "");
  if (!raw) return "App";
  const spaced = raw.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface RawAppAssignment {
  intent?: string;
  target?: {
    "@odata.type"?: string;
    groupId?: string;
    deviceAndAppManagementAssignmentFilterId?: string | null;
    deviceAndAppManagementAssignmentFilterType?: string;
  };
}

/**
 * Graph mobileAppAssignments -> AppAssignments. An assignment whose intent this
 * tool doesn't know, or whose target names no group, is dropped rather than
 * guessed at; `dropped` says how many so the caller can report it.
 */
export function normalizeAppAssignments(raw: RawAppAssignment[]): { assignments: AppAssignment[]; dropped: number } {
  const assignments: AppAssignment[] = [];
  let dropped = 0;
  for (const item of raw) {
    const rawIntent = (item.intent ?? "").toLowerCase();
    const withoutEnrollment = rawIntent === "availablewithoutenrollment";
    const intent: AppIntent | undefined = withoutEnrollment
      ? "available"
      : rawIntent === "required" || rawIntent === "available" || rawIntent === "uninstall"
        ? rawIntent
        : undefined;
    const target = parseAssignmentTarget(item);
    const groupId = target.isAllDevices
      ? VIRTUAL_GROUP_ALL_DEVICES.id
      : target.isAllUsers
        ? VIRTUAL_GROUP_ALL_USERS.id
        : target.groupId;
    if (!intent || !groupId) {
      dropped++;
      continue;
    }
    assignments.push({
      intent,
      ...(withoutEnrollment ? { withoutEnrollment: true } : {}),
      groupId,
      exclude: !!target.isExclude,
      ...(target.filterId && target.filterType
        ? { filter: { filterId: target.filterId, filterType: target.filterType } }
        : {}),
    });
  }
  return { assignments, dropped };
}

/** Every OS an app counts toward -- a web link counts toward all of them. */
export function appPlatforms(app: IntuneApp): Platform[] {
  return app.platform === "all" ? ["windows", "macos", "ios", "android"] : [app.platform];
}

/**
 * Words that describe how a product is packaged or delivered rather than which
 * product it is. Stripped before two app names are compared.
 */
const PACKAGING_WORDS = new Set([
  "x64",
  "x86",
  "arm64",
  "64bit",
  "32bit",
  "64",
  "32",
  "bit",
  "msi",
  "msix",
  "exe",
  "appx",
  "win32",
  "uwp",
  "store",
  "auto",
  "update",
  "autoupdate",
  "installer",
  "uninstaller",
  "uninstall",
  "only",
  "latest",
  "new",
  "legacy",
]);

/**
 * A name reduced to the product it names, for spotting one product added to
 * Intune as several app objects: "7-Zip (x64) - Auto-Update", "7-Zip - 26.04"
 * and "7-Zip (ZStandard Uninstaller)" all become "7 zip".
 *
 * Drops bracketed asides, dotted version numbers and packaging words, and keeps
 * everything else -- including bare numbers, which are as often part of the
 * name ("Microsoft 365 Apps", "7-Zip") as a version. Deliberately crude: it is
 * a pairing heuristic whose output is shown as "verify", so it errs toward
 * pairing and lets the admin dismiss a false match, rather than toward missing
 * a real duplicate. Returns "" when nothing is left to compare.
 */
export function appProductKey(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\bv?\d+(\.\d+)+\b/g, " ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !PACKAGING_WORDS.has(word))
    .join(" ");
}

/**
 * Different app objects that look like one product. See AppProductFinding for
 * why this exists and how far to trust it.
 */
function findSameProduct(landedApps: { app: IntuneApp; intents: AppIntent[] }[]): AppProductFinding[] {
  const byProduct = new Map<string, { app: IntuneApp; intents: AppIntent[] }[]>();
  for (const entry of landedApps) {
    const key = appProductKey(entry.app.displayName);
    if (!key) continue;
    byProduct.set(key, [...(byProduct.get(key) ?? []), entry]);
  }
  const findings: AppProductFinding[] = [];
  for (const [product, entries] of byProduct) {
    if (entries.length < 2) continue;
    const installs = (e: { intents: AppIntent[] }) => e.intents.some((i) => i !== "uninstall");
    const removes = (e: { intents: AppIntent[] }) => e.intents.includes("uninstall");
    findings.push({
      product,
      // One object removing while a DIFFERENT one installs. An object that does
      // both by itself is an intent conflict, reported there.
      opposing: entries.some((a) => removes(a) && entries.some((b) => b !== a && installs(b))),
      apps: entries.map(({ app, intents }) => ({
        appId: app.id,
        displayName: app.displayName,
        appType: app.appType,
        intents,
      })),
    });
  }
  return findings.sort((a, b) => Number(b.opposing) - Number(a.opposing) || a.product.localeCompare(b.product));
}

const byName = (a: { displayName: string }, b: { displayName: string }) =>
  a.displayName.localeCompare(b.displayName, undefined, { numeric: true, sensitivity: "base" });

/**
 * Resolves the tenant's apps against a simulated endpoint's groups.
 *
 * Each (app, intent) pair is resolved on its own, by the rules policies follow:
 * it lands when a group in the simulation is included and none is excluded, and
 * an Assignment Filter on the including assignment can still carve it out. An
 * exclusion counts only against the intent it sits under, because that is how
 * the portal and Graph both record it -- an app excluded from Required for a
 * group is not thereby excluded from Available.
 *
 * Returns undefined when the data source has no app data at all, so a caller
 * can tell "no Apps view here" from "apps were read and none apply".
 */
export function simulateApps(
  data: TenantData,
  options: { groupIds: string[]; platform?: Platform; deviceFilterIds: string[] }
): SimulationApps | undefined {
  if (data.appsUnavailable) {
    return {
      unavailable: data.appsUnavailable,
      apps: [],
      excluded: [],
      conflicts: [],
      redundant: [],
      sameProduct: [],
      lobMsi: [],
      lobMixedWithWin32: false,
    };
  }
  if (!data.apps) return undefined;

  const { groupIds, platform, deviceFilterIds } = options;
  const inSimulation = new Set(groupIds);
  const filterNameById = new Map(data.assignmentFilters.map((f) => [f.id, f.displayName]));
  const candidates = platform ? data.apps.filter((a) => appPlatforms(a).includes(platform)) : data.apps;

  const apps: SimulationApp[] = [];
  const excluded: SimulationApp[] = [];
  const conflicts: AppIntentConflict[] = [];
  const redundant: AppRedundancy[] = [];
  // Every app that lands, with the intents it lands under -- what the
  // same-product pass compares once all of them are known.
  const landedApps: { app: IntuneApp; intents: AppIntent[] }[] = [];

  for (const app of [...candidates].sort(byName)) {
    const landed: AppIntentVia[] = [];
    for (const intent of APP_INTENTS) {
      const forIntent = app.assignments.filter((a) => a.intent === intent && inSimulation.has(a.groupId));
      const includes = forIntent.filter((a) => !a.exclude);
      if (includes.length === 0) continue;
      const base = {
        id: app.id,
        displayName: app.displayName,
        publisher: app.publisher,
        appType: app.appType,
        family: app.family,
        ...(app.lobMsi ? { lobMsi: true } : {}),
        ...(app.detection?.length ? { detection: app.detection } : {}),
        platform: app.platform,
        intent,
      };
      const includeGroupIds = [...new Set(includes.map((a) => a.groupId))];

      const excludedViaGroupIds = [...new Set(forIntent.filter((a) => a.exclude).map((a) => a.groupId))];
      if (excludedViaGroupIds.length > 0) {
        excluded.push({ ...base, status: "excluded", viaGroupIds: includeGroupIds, excludedViaGroupIds });
        continue;
      }

      const passing = includes.filter((a) => passesAssignmentFilter(a.filter, deviceFilterIds));
      if (passing.length === 0) {
        const failing = includes[0].filter;
        excluded.push({
          ...base,
          status: "excluded",
          viaGroupIds: includeGroupIds,
          excludedViaGroupIds: [],
          excludedByFilter: failing
            ? {
                filterId: failing.filterId,
                filterName: filterNameById.get(failing.filterId) ?? failing.filterId,
                filterType: failing.filterType,
              }
            : undefined,
        });
        continue;
      }

      const viaGroupIds = [...new Set(passing.map((a) => a.groupId))];
      apps.push({
        ...base,
        ...(passing.every((a) => a.withoutEnrollment) ? { withoutEnrollment: true } : {}),
        status: "included",
        viaGroupIds,
        excludedViaGroupIds: [],
      });
      landed.push({ intent, viaGroupIds });
    }
    if (landed.length === 0) continue;
    landedApps.push({ app, intents: landed.map((l) => l.intent) });
    const common = { appId: app.id, displayName: app.displayName };
    const has = (intent: AppIntent) => landed.some((l) => l.intent === intent);

    // Install and uninstall of ONE app. Only intents that actually land count,
    // so an exclusion or filter that keeps the two apart is already honoured:
    // the carved-out side never reached `landed`.
    if (has("uninstall") && (has("required") || has("available"))) conflicts.push({ ...common, intents: landed });

    // Required makes Available unnecessary for delivery. Reported even inside
    // a conflict: fixing the uninstall would still leave it.
    if (has("required") && has("available")) {
      redundant.push({
        ...common,
        kind: "required-and-available",
        intents: landed.filter((l) => l.intent !== "uninstall"),
      });
    }
    // One intent through several groups.
    for (const l of landed) {
      if (l.viaGroupIds.length > 1)
        redundant.push({ ...common, kind: "multiple-groups", intent: l.intent, intents: [l] });
    }
  }

  // By intent, then name. The stable sort keeps the name order built above.
  const rank = (a: SimulationApp) => APP_INTENTS.indexOf(a.intent);
  apps.sort((a, b) => rank(a) - rank(b));
  excluded.sort((a, b) => rank(a) - rank(b));

  // Only an app that is being INSTALLED counts toward the LOB recommendation and
  // toward the mix: an Uninstall assignment puts nothing through TrustedInstaller
  // at enrollment, and there is nothing to repackage about removing something.
  const installs = (e: { intents: AppIntent[] }) => e.intents.some((i) => i !== "uninstall");
  const lobMsi: AppLobMsiFinding[] = landedApps
    .filter((e) => e.app.lobMsi && installs(e))
    .map((e) => ({ appId: e.app.id, displayName: e.app.displayName, intents: e.intents }));
  const lobMixedWithWin32 =
    lobMsi.length > 0 &&
    landedApps.some((e) => installs(e) && (e.app.family === "win32" || e.app.family === "catalog"));

  return {
    apps,
    excluded,
    conflicts,
    redundant,
    sameProduct: findSameProduct(landedApps),
    lobMsi,
    lobMixedWithWin32,
  };
}
