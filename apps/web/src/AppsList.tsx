import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  AppFamily,
  AppIntent,
  AppProductFinding,
  SimulationApp,
  SimulationApps,
  SimulationResult,
} from "@intune-preflight/shared";
import {
  APP_FINDING_RULES,
  APP_FAMILIES,
  APP_FAMILY_LABEL,
  APP_LOB_ESP_LEARN_URL,
  APP_LOB_LEARN_URL,
  APPS_GRAPH_PERMISSION,
  appIntentLabel,
} from "@intune-preflight/shared";
import {
  APP_FAMILY_COLOR,
  APP_INTENT_COLOR,
  APP_SECTION_ORDER,
  countAvailableOnly,
  primaryIntent,
} from "./appsView.ts";
import { toggled } from "./collections.ts";
import { PortalLink } from "./PortalLink.tsx";

/**
 * The apps a simulated endpoint gets, and what is wrong with how they are
 * assigned.
 *
 * Deliberately not part of the merged baseline. That list is settings, keyed on
 * a setting id and compared by value, and an app has neither. So apps get their
 * own surface, and this is its body: the rail tab and the docked panel both
 * render it, so the two cannot disagree about what is installed.
 *
 * It is laid out the way the baseline is, on purpose. The baseline groups
 * settings by CSP area in an accordion with the findings badged on each header;
 * this groups apps by TYPE the same way, with Required / Available / Uninstall
 * inside each type. Same shape, same gestures, so the second tab needs no
 * second way of reading.
 *
 * Each app is ONE row, however many intents it lands under, and every alert on
 * a row is a button: clicking it narrows the list to that finding.
 */

/** Asks the list to open one type's section and bring it into view. `nonce` makes a repeat request fire again. */
export type AppsFocus = { family: AppFamily; nonce: number };

type ViewFilter = "all" | "conflicts" | "redundant" | "sameProduct" | "lob";

/** Five words or so, by design: a hint under a heading is read every time, so it has to cost nothing. */
const INTENT_HINT: Record<AppIntent, { text: string; detail: string }> = {
  required: { text: "Installs automatically", detail: "Intune installs these without the user doing anything." },
  available: {
    text: "Offered to users in Company Portal",
    detail:
      "Available assignments mostly target user groups. These are listed because a selected group or All Users delivers them; no specific user is modelled, so check the signed-in user is in that group. An app that is also Required is listed under Required.",
  },
  uninstall: {
    text: "Removed if Intune installed it",
    detail: "Intune uninstalls these where it previously installed them.",
  },
};

/** What each narrowed view is showing, in one line. The full definition is the tooltip. */
const VIEW_NOTE: Record<Exclude<ViewFilter, "all">, { text: string; rule: string; tone: string }> = {
  conflicts: {
    text: "Assigned to install and to uninstall.",
    rule: "conflict",
    tone: "bg-amber-500/[0.06] text-amber-200",
  },
  redundant: {
    text: "Works as is; one assignment is surplus.",
    rule: "redundant-available",
    tone: "bg-sky-500/[0.06] text-sky-200",
  },
  sameProduct: {
    text: "Separate apps, one product. Verify.",
    rule: "same-product",
    tone: "bg-slate-500/[0.08] text-slate-300",
  },
  lob: { text: "Microsoft recommends Win32 instead.", rule: "lob-msi", tone: "bg-amber-500/[0.06] text-amber-200" },
};

const ruleDetail = (id: string) => {
  const rule = APP_FINDING_RULES.find((r) => r.id === id);
  return rule ? `Detected when: ${rule.detectedWhen}\n\n${rule.meaning}\n\nWhat to do: ${rule.action}` : "";
};

/** One app with every intent it lands under. */
type AppRow = {
  id: string;
  displayName: string;
  portalUrl?: string;
  publisher?: string;
  appType: string;
  family: AppFamily;
  primary: AppIntent;
  intents: { intent: AppIntent; viaGroupIds: string[]; withoutEnrollment?: boolean }[];
};

function buildAppRows(apps: SimulationApps): AppRow[] {
  const byId = new Map<string, AppRow>();
  for (const a of apps.apps) {
    const row = byId.get(a.id) ?? {
      id: a.id,
      displayName: a.displayName,
      portalUrl: a.portalUrl,
      publisher: a.publisher,
      appType: a.appType,
      family: a.family,
      primary: a.intent,
      intents: [],
    };
    row.intents.push({ intent: a.intent, viaGroupIds: a.viaGroupIds, withoutEnrollment: a.withoutEnrollment });
    byId.set(a.id, row);
  }
  for (const row of byId.values()) {
    row.primary = primaryIntent(row.intents.map((x) => x.intent));
  }
  return [...byId.values()];
}

function exclusionReason(app: SimulationApp, groupName: (id: string) => string): string {
  if (app.excludedByFilter) {
    const { filterName, filterType } = app.excludedByFilter;
    return filterType === "include"
      ? `Only targets devices matching the “${filterName}” filter — this device doesn’t match`
      : `This device matches the “${filterName}” filter, which this assignment excludes`;
  }
  return `Excluded for ${app.excludedViaGroupIds.map(groupName).join(", ")}`;
}

const BADGE = "rounded px-1.5 py-0.5 text-[9px] font-medium";
const PILL = "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold leading-none";

/** An alert that is also the way to see everything like it. */
function AlertButton({
  className,
  title,
  active,
  onClick,
  children,
}: {
  className: string;
  title: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={`${title}\n\n${active ? "Click to show every app again." : "Click to show only these."}`}
      className={`${BADGE} ${className} cursor-pointer underline decoration-dotted underline-offset-2 transition-colors hover:brightness-125 ${
        active ? "ring-1 ring-current" : ""
      }`}
    >
      {children}
    </button>
  );
}

/** How an app is packaged, as a tag: "Win32", "EAM", "Store", "LOB". The precise type is on hover. */
function FamilyTag({ family, appType }: { family: AppFamily; appType?: string }) {
  const color = APP_FAMILY_COLOR[family];
  return (
    <span
      title={[appType, APP_FAMILY_LABEL[family].name].filter(Boolean).join("\n")}
      className="shrink-0 rounded border px-1 py-px font-mono text-[9px] font-semibold uppercase leading-tight tracking-wide"
      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}14` }}
    >
      {APP_FAMILY_LABEL[family].tag}
    </span>
  );
}

/**
 * The mix of app types reaching the endpoint, and the filter for it, as one bar.
 *
 * Each segment is a labelled button sized by how many apps it holds, so the bar
 * shows the proportions and narrows the list in the same control. It was two --
 * a thin proportional strip, and a row of chips under it repeating the same
 * counts -- and the strip could not be clicked while the chips did not look as
 * though they could. A segment never shrinks below its own label, which bends
 * the proportions for a type with one or two apps; being able to read and hit
 * it is worth more than the last few percent of accuracy.
 */
function TypeMix({
  rows,
  selected,
  onSelect,
}: {
  rows: AppRow[];
  selected: AppFamily | null;
  onSelect: (family: AppFamily | null) => void;
}) {
  const counts = APP_FAMILIES.map((family) => ({
    family,
    count: rows.filter((r) => r.family === family).length,
  })).filter((c) => c.count > 0);
  if (counts.length < 2) return null;
  return (
    <div role="group" aria-label="Filter by app type" className="flex gap-0.5 overflow-hidden rounded-md">
      {counts.map((c) => {
        const color = APP_FAMILY_COLOR[c.family];
        const active = selected === c.family;
        return (
          <button
            key={c.family}
            onClick={() => onSelect(active ? null : c.family)}
            aria-pressed={active}
            title={`${APP_FAMILY_LABEL[c.family].name} — ${active ? "click to show every type again" : "click to show only these"}`}
            className="flex min-w-fit items-center justify-center gap-1 px-1.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wide transition-opacity hover:brightness-125"
            style={{
              flex: `${c.count} 1 0%`,
              color: active ? "#0b1220" : color,
              backgroundColor: active ? color : `${color}2b`,
              opacity: selected && !active ? 0.45 : 1,
            }}
          >
            {APP_FAMILY_LABEL[c.family].tag}
            <span className="font-sans tabular-nums opacity-80">{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export function AppsList({
  simulation,
  focus,
  showAvailable,
  onShowAvailableChange,
}: {
  simulation: SimulationResult;
  focus?: AppsFocus | null;
  /** Whether apps that are only Available are listed. Shared with the diagram. */
  showAvailable: boolean;
  onShowAvailableChange: (show: boolean) => void;
}) {
  const apps = simulation.apps;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewFilter>("all");
  const [family, setFamily] = useState<AppFamily | null>(null);
  /** With the same-product view: the one product drilled into, or null for all of them. */
  const [productKey, setProductKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<AppFamily>>(new Set());
  const sectionRefs = useRef<Partial<Record<AppFamily, HTMLElement | null>>>({});

  const groupNameById = useMemo(
    () => new Map(simulation.groups.map((g) => [g.id, g.displayName])),
    [simulation.groups]
  );
  const groupName = (id: string) => groupNameById.get(id) ?? id;

  const rows = useMemo(() => (apps ? buildAppRows(apps) : []), [apps]);
  const conflictIds = useMemo(() => new Set((apps?.conflicts ?? []).map((c) => c.appId)), [apps]);
  const lobIds = useMemo(() => new Set((apps?.lobMsi ?? []).map((l) => l.appId)), [apps]);
  const redundantByApp = useMemo(() => {
    const map = new Map<string, NonNullable<typeof apps>["redundant"]>();
    for (const r of apps?.redundant ?? []) map.set(r.appId, [...(map.get(r.appId) ?? []), r]);
    return map;
  }, [apps]);
  const productByApp = useMemo(() => {
    const map = new Map<string, AppProductFinding>();
    for (const f of apps?.sameProduct ?? []) for (const a of f.apps) map.set(a.appId, f);
    return map;
  }, [apps]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  const showView = (next: ViewFilter, product: string | null = null) => {
    setView(next);
    setProductKey(next === "sameProduct" ? product : null);
  };
  /** An alert toggles its own view: click to narrow, click again to come back. */
  const toggleView = (target: Exclude<ViewFilter, "all">, product: string | null = null) => {
    const on = view === target && productKey === product;
    showView(on ? "all" : target, on ? null : product);
  };

  // The same for a type whose only apps have just been hidden.
  useEffect(() => {
    if (family && !showAvailable && !rows.some((r) => r.family === family && r.primary !== "available")) {
      setFamily(null);
    }
  }, [rows, family, showAvailable]);

  // A bubble in the diagram asks for a type's section. That only exists in the
  // full list, so the request also clears whatever was narrowing it.
  useEffect(() => {
    if (!focus) return;
    setView("all");
    setProductKey(null);
    setFamily(null);
    setCollapsed((prev) => {
      if (!prev.has(focus.family)) return prev;
      const next = new Set(prev);
      next.delete(focus.family);
      return next;
    });
    const frame = requestAnimationFrame(() =>
      sectionRefs.current[focus.family]?.scrollIntoView({ block: "start", behavior: "smooth" })
    );
    return () => cancelAnimationFrame(frame);
  }, [focus]);

  // A finding that no longer exists must not leave the list filtered to nothing.
  const redundantAppCount = redundantByApp.size;
  useEffect(() => {
    if (!apps) return;
    if (
      (view === "conflicts" && apps.conflicts.length === 0) ||
      (view === "redundant" && redundantAppCount === 0) ||
      (view === "sameProduct" && apps.sameProduct.length === 0) ||
      (view === "lob" && apps.lobMsi.length === 0)
    ) {
      setView("all");
      setProductKey(null);
    } else if (productKey && !apps.sameProduct.some((f) => f.product === productKey)) {
      setProductKey(null);
    }
  }, [apps, view, productKey, redundantAppCount]);

  // The same for a type the endpoint no longer gets any apps of.
  useEffect(() => {
    if (family && !rows.some((r) => r.family === family)) setFamily(null);
  }, [rows, family]);

  if (!apps) return null;

  if (apps.unavailable) {
    const permission = apps.unavailable.reason === "permission";
    return (
      <div className="p-4">
        <div className="rounded-lg border border-ink-700 bg-ink-950/60 p-4 text-xs text-slate-300">
          <div className="text-sm font-semibold text-slate-100">
            {permission ? "Apps need one more permission" : "Apps couldn’t be loaded"}
          </div>
          {permission ? (
            <>
              <p className="mt-2 leading-relaxed">
                Microsoft Graph refused the read of this tenant’s apps. Grant{" "}
                <code className="rounded bg-ink-800 px-1 py-0.5 text-[11px] text-sky-300">{APPS_GRAPH_PERMISSION}</code>{" "}
                with admin consent, then refresh the tenant data.
              </p>
              <p className="mt-2 leading-relaxed text-slate-400">
                It is read-only, like every other permission this tool uses. The merged baseline and everything else
                here is complete without it.
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 break-words leading-relaxed">{apps.unavailable.detail}</p>
              <p className="mt-2 leading-relaxed text-slate-400">
                The merged baseline is unaffected. Refresh the tenant data to try again.
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  if (rows.length + apps.excluded.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-slate-500">
        No apps reach this endpoint through the selected groups.
      </div>
    );
  }

  const needle = query.trim().toLowerCase();
  const matchesText = (name: string, type: string, publisher: string | undefined, groupIds: string[]) =>
    !needle ||
    name.toLowerCase().includes(needle) ||
    type.toLowerCase().includes(needle) ||
    (publisher ?? "").toLowerCase().includes(needle) ||
    groupIds.some((id) => groupName(id).toLowerCase().includes(needle));
  const matchesRow = (r: AppRow) =>
    matchesText(
      r.displayName,
      r.appType,
      r.publisher,
      r.intents.flatMap((i) => i.viaGroupIds)
    );
  // Available-only apps are hidden in the plain list. A finding view or a
  // search shows them regardless: someone drilling into "same product" or
  // typing a name is asking for that app, wherever it is listed.
  const availableOnly = countAvailableOnly(apps);
  const hidingAvailable = !showAvailable && view === "all" && !needle;
  const listed = hidingAvailable ? rows.filter((r) => r.primary !== "available") : rows;
  const inView = (r: AppRow) =>
    (!hidingAvailable || r.primary !== "available") &&
    (!family || r.family === family) &&
    (view === "all" ||
      (view === "conflicts" && conflictIds.has(r.id)) ||
      (view === "redundant" && redundantByApp.has(r.id)) ||
      (view === "lob" && lobIds.has(r.id)));

  const shown = rows.filter((r) => inView(r) && matchesRow(r));
  const carvedOut = apps.excluded.filter(
    (a) => (!family || a.family === family) && matchesText(a.displayName, a.appType, a.publisher, a.viaGroupIds)
  );
  const products = apps.sameProduct.filter(
    (f) =>
      (!productKey || f.product === productKey) &&
      (!family || f.apps.some((a) => rowById.get(a.appId)?.family === family)) &&
      (!needle || f.product.includes(needle) || f.apps.some((a) => a.displayName.toLowerCase().includes(needle)))
  );
  // What the matched apps have in common is the product's name: "7-Zip" from
  // "7-Zip - 25.01" and "7-Zip (x64) - Auto-Update". The key they matched on
  // ("7 zip") is not a name, and where they share too little to read as one,
  // the shortest of them stands in.
  const productName = (f: AppProductFinding) => {
    const names = f.apps.map((a) => a.displayName);
    let prefix = names[0] ?? "";
    for (const name of names) {
      let i = 0;
      while (i < prefix.length && i < name.length && prefix[i].toLowerCase() === name[i].toLowerCase()) i++;
      prefix = prefix.slice(0, i);
    }
    prefix = prefix.replace(/[\s\-–([.,:]+$/, "");
    return prefix.length >= 3 ? prefix : names.reduce((a, b) => (b.length < a.length ? b : a));
  };
  const drilled = productKey ? apps.sameProduct.find((f) => f.product === productKey) : undefined;
  const narrowed = view !== "all" || family !== null;

  const renderRow = (r: AppRow, showType: boolean) => {
    const conflicted = conflictIds.has(r.id);
    const redundant = redundantByApp.get(r.id) ?? [];
    const product = productByApp.get(r.id);
    const multi = r.intents.length > 1;
    return (
      <div
        key={r.id}
        className={`border-b border-ink-800/60 py-2 pl-6 pr-3 last:border-b-0 ${
          conflicted ? "border-l-2 border-l-amber-400/70 bg-amber-500/[0.04]" : ""
        }`}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="min-w-0 break-words font-medium text-slate-100" title={r.appType}>
            {r.displayName}
            <PortalLink url={r.portalUrl} name={r.displayName} className="ml-1 align-[-3px]" />
          </span>
          {conflicted && (
            <AlertButton
              className="bg-amber-500/20 text-amber-300"
              title={ruleDetail("conflict")}
              active={view === "conflicts"}
              onClick={() => toggleView("conflicts")}
            >
              ⚠ install + uninstall
            </AlertButton>
          )}
          {redundant.map((red) => (
            <AlertButton
              key={`${red.kind}:${red.intent ?? ""}`}
              className="bg-sky-500/20 text-sky-300"
              title={ruleDetail(red.kind === "required-and-available" ? "redundant-available" : "redundant-groups")}
              active={view === "redundant"}
              onClick={() => toggleView("redundant")}
            >
              {red.kind === "required-and-available"
                ? "Available not needed"
                : `${appIntentLabel(red.intent ?? r.primary)} via ${red.intents[0]?.viaGroupIds.length ?? 2} groups`}
            </AlertButton>
          ))}
          {lobIds.has(r.id) && (
            <AlertButton
              className="bg-amber-500/20 text-amber-300"
              title={`${ruleDetail("lob-msi")}${apps.lobMixedWithWin32 ? `\n\n${ruleDetail("lob-mixed")}` : ""}`}
              active={view === "lob"}
              onClick={() => toggleView("lob")}
            >
              ⚠ convert to Win32
            </AlertButton>
          )}
          {product && (
            <AlertButton
              className={product.opposing ? "bg-rose-500/20 text-rose-300" : "bg-slate-500/20 text-slate-300"}
              title={ruleDetail("same-product")}
              active={view === "sameProduct" && productKey === product.product}
              onClick={() => toggleView("sameProduct", product.product)}
            >
              {product.opposing ? "⚠ opposing intents" : "same product"} ×{product.apps.length}
            </AlertButton>
          )}
        </div>
        {(r.publisher || showType) && (
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            {[r.publisher, showType ? r.appType : ""].filter(Boolean).join(" · ")}
          </div>
        )}
        {r.intents.map((i) => (
          <div key={i.intent} className="mt-0.5 break-words text-[11px] text-slate-400">
            {multi && (
              <span className="mr-1 font-medium" style={{ color: APP_INTENT_COLOR[i.intent] }}>
                {appIntentLabel(i.intent)}
              </span>
            )}
            <span className="text-slate-600">via</span> {i.viaGroupIds.map(groupName).join(", ")}
            {i.withoutEnrollment && <span className="text-slate-600"> · with or without enrollment</span>}
          </div>
        ))}
      </div>
    );
  };

  const note = view === "all" ? null : VIEW_NOTE[view];

  return (
    <div className="text-xs">
      <div className="sticky top-0 z-10 space-y-1.5 border-b border-ink-800 bg-ink-900 px-3 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter apps, types or groups…"
          aria-label="Filter apps"
          className="w-full rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
        />
        {/* The findings, as the filter. This line used to be read-only
            counts in the header with a dropdown underneath offering the same
            four things; one row of buttons is both. Green at zero, like the
            baseline's conflict count -- a clean result is worth seeing. */}
        <div role="group" aria-label="Filter by finding" className="flex flex-wrap gap-1">
          {(
            [
              { id: "all", label: "All", count: rows.length, on: "bg-sky-500/20 text-sky-200 ring-sky-400/40" },
              {
                id: "conflicts",
                label: "Conflicts",
                count: apps.conflicts.length,
                on: "bg-amber-500/20 text-amber-200 ring-amber-400/40",
              },
              {
                id: "redundant",
                label: "Redundant",
                count: redundantAppCount,
                on: "bg-sky-500/20 text-sky-200 ring-sky-400/40",
              },
              {
                id: "sameProduct",
                label: "Same product",
                count: apps.sameProduct.length,
                on: "bg-rose-500/20 text-rose-200 ring-rose-400/40",
              },
              // Only when there is one: a line-of-business app is a
              // recommendation, not a check every tenant is waiting on.
              ...(apps.lobMsi.length > 0
                ? [
                    {
                      id: "lob",
                      label: "LOB to convert",
                      count: apps.lobMsi.length,
                      on: "bg-amber-500/20 text-amber-200 ring-amber-400/40",
                    },
                  ]
                : []),
            ] as { id: ViewFilter; label: string; count: number; on: string }[]
          ).map((f) => {
            const active = view === f.id;
            const clean = f.id !== "all" && f.count === 0;
            return (
              <button
                key={f.id}
                onClick={() => showView(active ? "all" : f.id)}
                disabled={clean}
                aria-pressed={active}
                title={f.id === "all" ? "Every app reaching this endpoint" : ruleDetail(VIEW_NOTE[f.id].rule)}
                className={`rounded px-1.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors ${
                  active
                    ? f.on
                    : clean
                      ? "cursor-default text-emerald-400/80 ring-ink-800"
                      : "text-slate-300 ring-ink-700 hover:bg-ink-800"
                }`}
              >
                {f.label} <span className="tabular-nums opacity-80">{f.count}</span>
              </button>
            );
          })}
        </div>
        <TypeMix rows={listed} selected={family} onSelect={setFamily} />
      </div>

      {/* One line under the filters, only where it adds something the pressed
          button does not: what the finding means, the product being drilled
          into, or the Microsoft links for a line-of-business app. */}
      {note && (
        <div className={`border-b border-ink-800 px-3 py-1.5 text-[11px] ${note.tone}`} title={ruleDetail(note.rule)}>
          {drilled ? (
            <>
              <span className="font-semibold">{productName(drilled)}</span>: {drilled.apps.length} separate apps.{" "}
              <button onClick={() => setProductKey(null)} className="underline hover:brightness-125">
                All {apps.sameProduct.length} products
              </button>
            </>
          ) : (
            <span className="font-medium">{note.text} </span>
          )}
          {view === "lob" && (
            <>
              {apps.lobMixedWithWin32 && (
                <span className="font-medium" title={ruleDetail("lob-mixed")}>
                  ⚠ Mixed with Win32: can fail Autopilot ESP.{" "}
                </span>
              )}
              <a href={APP_LOB_LEARN_URL} target="_blank" rel="noreferrer" className="underline hover:brightness-125">
                Win32 guidance ↗
              </a>
              {" · "}
              <a
                href={APP_LOB_ESP_LEARN_URL}
                target="_blank"
                rel="noreferrer"
                className="underline hover:brightness-125"
              >
                ESP ↗
              </a>
            </>
          )}
        </div>
      )}

      {view === "sameProduct" ? (
        <>
          {products.map((f) => (
            <section
              key={f.product}
              aria-label={`Apps that look like ${productName(f)}`}
              className={`border-b border-ink-800 ${f.opposing ? "bg-rose-500/[0.04]" : ""}`}
            >
              <button
                onClick={() => setProductKey(productKey === f.product ? null : f.product)}
                title={productKey === f.product ? "Show every same-product finding" : "Show only this product"}
                className={`flex w-full items-center gap-2 border-l-2 bg-ink-950/50 px-3 py-2 text-left hover:bg-ink-800/60 ${
                  f.opposing ? "border-rose-400" : "border-slate-500"
                }`}
              >
                <span className="min-w-0 flex-1 break-words font-semibold text-slate-200">{productName(f)}</span>
                <span
                  className={`${PILL} ${f.opposing ? "bg-rose-500/20 text-rose-300" : "bg-slate-500/20 text-slate-300"}`}
                >
                  {f.opposing ? "⚠ opposing intents" : "verify"}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">{f.apps.length} apps</span>
              </button>
              {f.apps.map((a) => {
                const row = rowById.get(a.appId);
                return (
                  <div key={a.appId} className="border-b border-ink-800/60 py-2 pl-6 pr-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-0 break-words font-medium text-slate-100">
                        {a.displayName}
                        <PortalLink url={row?.portalUrl} name={a.displayName} className="ml-1 align-[-3px]" />
                      </span>
                      {row && <FamilyTag family={row.family} appType={a.appType} />}
                    </div>
                    {(row?.intents ?? a.intents.map((intent) => ({ intent, viaGroupIds: [] as string[] }))).map((i) => (
                      <div key={i.intent} className="mt-0.5 break-words text-[11px] text-slate-400">
                        <span className="mr-1 font-medium" style={{ color: APP_INTENT_COLOR[i.intent] }}>
                          {appIntentLabel(i.intent)}
                        </span>
                        {i.viaGroupIds.length > 0 && (
                          <>
                            <span className="text-slate-600">via</span> {i.viaGroupIds.map(groupName).join(", ")}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </section>
          ))}
          {products.length === 0 && <div className="px-3 py-6 text-center text-slate-500">No matches.</div>}
        </>
      ) : (
        <>
          {APP_FAMILIES.map((fam) => {
            const typeRows = shown.filter((r) => r.family === fam);
            const total = listed.filter((r) => r.family === fam).length;
            if (typeRows.length === 0) return null;
            const color = APP_FAMILY_COLOR[fam];
            // Narrowed to one type, or by a finding, there is nothing to gain
            // from a collapsed header: the choice has already been made.
            const isOpen = narrowed || !!needle || !collapsed.has(fam);
            const conflicts = typeRows.filter((r) => conflictIds.has(r.id)).length;
            const redundant = typeRows.filter((r) => redundantByApp.has(r.id)).length;
            const sameProduct = typeRows.filter((r) => productByApp.has(r.id)).length;
            const lob = typeRows.filter((r) => lobIds.has(r.id)).length;
            // The precise type only where a family holds more than one of them.
            const showType = new Set(typeRows.map((r) => r.appType)).size > 1;
            return (
              <section
                key={fam}
                ref={(el) => {
                  sectionRefs.current[fam] = el;
                }}
                aria-label={`${APP_FAMILY_LABEL[fam].name} apps`}
                className="scroll-mt-32"
              >
                <button
                  onClick={() => setCollapsed(toggled(fam))}
                  aria-expanded={isOpen}
                  className={`flex w-full items-center gap-2 border-b border-l-2 border-b-ink-800 px-3 py-2.5 text-left transition-colors hover:bg-ink-800/60 ${
                    isOpen ? "bg-ink-800/40" : ""
                  }`}
                  style={{ borderLeftColor: color }}
                >
                  <span
                    className={`shrink-0 text-[10px] text-slate-600 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  >
                    ▶
                  </span>
                  <span className="min-w-0 flex-1 break-words text-xs font-semibold" style={{ color }}>
                    {APP_FAMILY_LABEL[fam].name}
                  </span>
                  {conflicts > 0 && (
                    <span className={`${PILL} bg-amber-500/20 text-amber-200`}>
                      {conflicts} conflict{conflicts === 1 ? "" : "s"}
                    </span>
                  )}
                  {lob > 0 && <span className={`${PILL} bg-amber-500/20 text-amber-200`}>{lob} to convert</span>}
                  {redundant > 0 && <span className={`${PILL} bg-sky-500/15 text-sky-300`}>{redundant} redundant</span>}
                  {sameProduct > 0 && (
                    <span className={`${PILL} bg-slate-500/20 text-slate-300`}>{sameProduct} same product</span>
                  )}
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                    {typeRows.length === total ? total : `${typeRows.length} of ${total}`}
                  </span>
                </button>
                {isOpen &&
                  APP_SECTION_ORDER.map((intent) => {
                    const intentRows = typeRows.filter((r) => r.primary === intent);
                    if (intentRows.length === 0) return null;
                    return (
                      <div key={intent}>
                        <div
                          className="flex items-baseline gap-2 border-b border-ink-800/60 bg-ink-950/50 py-1.5 pl-6 pr-3"
                          title={INTENT_HINT[intent].detail}
                        >
                          <span
                            className="text-[11px] font-semibold uppercase tracking-wide"
                            style={{ color: APP_INTENT_COLOR[intent] }}
                          >
                            {appIntentLabel(intent)}
                          </span>
                          <span className="min-w-0 truncate text-[10px] text-slate-500">
                            {INTENT_HINT[intent].text}
                          </span>
                          <span className="ml-auto shrink-0 tabular-nums text-slate-500">{intentRows.length}</span>
                        </div>
                        {intentRows.map((r) => renderRow(r, showType))}
                      </div>
                    );
                  })}
              </section>
            );
          })}
          {shown.length === 0 && <div className="px-3 py-6 text-center text-slate-500">No matches.</div>}

          {/* Available-only apps, as the last section of the list rather than
              a checkbox above it. Shut by default: an offer in Company Portal
              changes nothing on the device. Opening it lists them under their
              types above, and the diagram follows. */}
          {view === "all" && !needle && availableOnly > 0 && (
            <button
              onClick={() => onShowAvailableChange(!showAvailable)}
              aria-expanded={showAvailable}
              title={INTENT_HINT.available.detail}
              className="flex w-full items-center gap-2 border-b border-l-2 border-b-ink-800 px-3 py-2.5 text-left transition-colors hover:bg-ink-800/60"
              style={{ borderLeftColor: APP_INTENT_COLOR.available }}
            >
              <span
                className={`shrink-0 text-[10px] text-slate-600 transition-transform ${showAvailable ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-xs font-semibold" style={{ color: APP_INTENT_COLOR.available }}>
                  Available apps
                </span>
                <span className="ml-2 text-[10px] text-slate-500">
                  {showAvailable ? "Shown under each type" : "Hidden: offered, not installed"}
                </span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-slate-500">{availableOnly}</span>
            </button>
          )}

          {view === "all" && carvedOut.length > 0 && (
            <section aria-label="Apps that don’t land" className="border-b border-ink-800">
              <div className="flex items-baseline gap-2 border-l-2 border-rose-400 bg-ink-950/50 px-3 py-2">
                <span className="font-semibold text-rose-300">Doesn’t land</span>
                <span className="min-w-0 truncate text-[10px] text-slate-500">Assigned, then carved out</span>
                <span className="ml-auto tabular-nums text-slate-500">{carvedOut.length}</span>
              </div>
              {carvedOut.map((a) => (
                <div key={`${a.intent}:${a.id}`} className="border-b border-ink-800/60 py-2 pl-6 pr-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 break-words font-medium text-slate-400 line-through decoration-slate-600">
                      {a.displayName}
                    </span>
                    <PortalLink url={a.portalUrl} name={a.displayName} />
                    <FamilyTag family={a.family} appType={a.appType} />
                    <span className="text-[11px] font-medium" style={{ color: APP_INTENT_COLOR[a.intent] }}>
                      {appIntentLabel(a.intent)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    <span className="text-slate-600">via</span> {a.viaGroupIds.map(groupName).join(", ")}
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-rose-300/80">{exclusionReason(a, groupName)}</div>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
