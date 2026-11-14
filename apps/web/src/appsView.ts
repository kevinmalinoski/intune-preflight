import type { AppFamily, AppIntent, SimulationApp, SimulationApps } from "@intune-preflight/shared";

/**
 * How many distinct apps land. An app under two intents is still one app, and
 * this is the number every count of "apps" in the UI means -- the rail tab, the
 * panel header and the list all read it from here so they cannot differ.
 */
export function countApps(apps: SimulationApps): number {
  return new Set(apps.apps.map((a) => a.id)).size;
}

/**
 * One colour per app family, for the type tag on a row and its segment in the
 * type mix. Kept clear of the three intent colours (teal, lime, pink) and of
 * the finding colours, except on purpose: line-of-business is amber because
 * amber already means "look at this" everywhere else in the app.
 */
export const APP_FAMILY_COLOR: Record<AppFamily, string> = {
  win32: "#60a5fa",
  catalog: "#22d3ee",
  store: "#c084fc",
  lob: "#f59e0b",
  builtin: "#fb923c",
  vpp: "#e879f9",
  package: "#a8a29e",
  web: "#94a3b8",
  other: "#64748b",
};

/** The three intents, wherever one is named or sectioned: the list, the diagram and the same-product view. */
export const APP_INTENT_COLOR: Record<AppIntent, string> = {
  required: "#2dd4bf",
  available: "#a3e635",
  uninstall: "#f472b6",
};

/**
 * The order intents are sectioned in, and so which one an app with several is
 * listed under. Required first, because that is what the device ends up with;
 * then Uninstall, which acts without anyone asking; Available last, since it
 * only offers -- and is hidden until asked for (see below).
 */
export const APP_SECTION_ORDER: readonly AppIntent[] = ["required", "uninstall", "available"];

/** The one intent an app object is listed under, however many it lands under. */
export function primaryIntent(intents: readonly AppIntent[]): AppIntent {
  return APP_SECTION_ORDER.find((i) => intents.includes(i)) ?? "available";
}

/**
 * How many app objects reach the endpoint ONLY as Available.
 *
 * Those are what "hide Available" hides. An offer in Company Portal changes
 * nothing on the device until a user takes it up, so by default the list and
 * the diagram spend their space on what will be installed and what will be
 * removed. An app that is Required as well is not one of these: it is listed
 * under Required either way.
 */
export function countAvailableOnly(apps: SimulationApps): number {
  const intentsById = new Map<string, AppIntent[]>();
  for (const a of apps.apps) intentsById.set(a.id, [...(intentsById.get(a.id) ?? []), a.intent]);
  return [...intentsById.values()].filter((intents) => primaryIntent(intents) === "available").length;
}

/**
 * One entry per app OBJECT, for a presentation that lists each app once.
 *
 * An app that lands is listed under its primary intent with every group that
 * delivers it. An app that only ever gets carved out is listed once too, under
 * the intent it was assigned for. Two different objects for one product -- a
 * Store app and a Win32 package of the same title -- stay two entries: they are
 * different payloads, and seeing both is the point.
 */
export function appObjects(
  apps: SimulationApps
): { app: SimulationApp; intent: AppIntent; excluded: boolean; viaGroupIds: string[] }[] {
  const landed = new Map<string, SimulationApp[]>();
  for (const a of apps.apps) landed.set(a.id, [...(landed.get(a.id) ?? []), a]);
  const out: { app: SimulationApp; intent: AppIntent; excluded: boolean; viaGroupIds: string[] }[] = [];
  for (const entries of landed.values()) {
    const intent = primaryIntent(entries.map((e) => e.intent));
    const app = entries.find((e) => e.intent === intent) ?? entries[0];
    out.push({ app, intent, excluded: false, viaGroupIds: [...new Set(entries.flatMap((e) => e.viaGroupIds))] });
  }
  const carved = new Map<string, SimulationApp[]>();
  for (const a of apps.excluded) if (!landed.has(a.id)) carved.set(a.id, [...(carved.get(a.id) ?? []), a]);
  for (const entries of carved.values()) {
    const intent = primaryIntent(entries.map((e) => e.intent));
    const app = entries.find((e) => e.intent === intent) ?? entries[0];
    const groups = app.excludedViaGroupIds.length > 0 ? app.excludedViaGroupIds : app.viaGroupIds;
    out.push({ app, intent, excluded: true, viaGroupIds: groups });
  }
  return out.sort((x, y) => APP_SECTION_ORDER.indexOf(x.intent) - APP_SECTION_ORDER.indexOf(y.intent));
}
