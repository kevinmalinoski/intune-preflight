import { describe, expect, it } from "vitest";
import { computeSimulation } from "./baseline.js";
import { demoTenantData } from "./demo/demoTenant.js";
import { isWholeBaseline, narrowSimulation } from "./narrow.js";

/**
 * These pin the property the filtered export rests on: narrowing the
 * simulation selects the same settings the panel's own row filtering selects.
 * If the two drift, an export taken while reading one profile quietly contains
 * something else.
 */
const data = demoTenantData();
const sim = computeSimulation(data, { selectedGroupIds: data.groups.map((g) => g.id), platform: "windows" });
const ids = (s: { settings: { settingId: string }[] }) => s.settings.map((x) => x.settingId).sort();

describe("narrowSimulation", () => {
  it("returns the same object when nothing is narrowed", () => {
    expect(narrowSimulation(sim, {})).toBe(sim);
    expect(narrowSimulation(sim, { view: "all", query: "   " })).toBe(sim);
    expect(isWholeBaseline({ view: "all", query: "" })).toBe(true);
    expect(isWholeBaseline({ query: "bitlocker" })).toBe(false);
  });

  it("scopes to a policy type", () => {
    const narrowed = narrowSimulation(sim, { scopeKind: "compliancePolicy" });
    expect(narrowed.settings.length).toBeGreaterThan(0);
    expect(narrowed.settings.every((s) => s.sourceKind === "compliancePolicy")).toBe(true);
    expect(narrowed.settings.length).toBeLessThan(sim.settings.length);
  });

  it("scopes to a policy, keeping findings it takes part in but did not win", () => {
    const conflict = sim.conflicts[0];
    expect(conflict).toBeTruthy();
    // The policy whose value did NOT land in the merged row.
    const row = sim.settings.find((s) => s.settingId === conflict.settingId)!;
    const loser = conflict.values.find((v) => v.sourcePolicyId !== row.sourcePolicyId);
    expect(loser).toBeTruthy();
    const narrowed = narrowSimulation(sim, { scopePolicyId: loser!.sourcePolicyId });
    expect(narrowed.settings.some((s) => s.settingId === conflict.settingId)).toBe(true);
  });

  it("filters to each view", () => {
    expect(ids(narrowSimulation(sim, { view: "conflicts" }))).toEqual(sim.conflicts.map((c) => c.settingId).sort());
    expect(ids(narrowSimulation(sim, { view: "overlaps" }))).toEqual(sim.overlaps.map((o) => o.settingId).sort());
    const legacy = narrowSimulation(sim, { view: "legacy" });
    expect(legacy.settings.length).toBeGreaterThan(0);
    expect(legacy.settings.length).toBeLessThan(sim.settings.length);
  });

  it("searches the text a reader can actually see", () => {
    const target = sim.settings[0];
    const narrowed = narrowSimulation(sim, { query: target.displayName.slice(0, 12) });
    expect(narrowed.settings.some((s) => s.settingId === target.settingId)).toBe(true);
    expect(narrowSimulation(sim, { query: "zzz-no-such-setting" }).settings).toEqual([]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    const area = sim.settings[0].cspArea;
    const a = ids(narrowSimulation(sim, { query: area.toUpperCase() }));
    const b = ids(narrowSimulation(sim, { query: `  ${area.toLowerCase()}  ` }));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("drops findings whose setting was filtered away", () => {
    const narrowed = narrowSimulation(sim, { view: "overlaps" });
    const kept = new Set(narrowed.settings.map((s) => s.settingId));
    // Nothing is left pointing at a setting that is no longer in the baseline.
    for (const c of narrowed.conflicts) expect(kept.has(c.settingId)).toBe(true);
    for (const l of narrowed.layered) expect(kept.has(l.settingId)).toBe(true);
    for (const o of narrowed.overlaps) expect(kept.has(o.settingId)).toBe(true);
  });

  it("stacks, so a scope and a search narrow together", () => {
    const scope = { scopeKind: "settingsCatalog" as const };
    const scoped = narrowSimulation(sim, scope);
    const needle = scoped.settings[0].displayName.slice(0, 10);
    const both = narrowSimulation(sim, { ...scope, query: needle });
    expect(both.settings.length).toBeGreaterThan(0);
    expect(both.settings.length).toBeLessThanOrEqual(scoped.settings.length);
    expect(both.settings.every((s) => s.sourceKind === "settingsCatalog")).toBe(true);
    // Applying them one at a time gives the same answer as both at once.
    expect(ids(narrowSimulation(scoped, { query: needle }))).toEqual(ids(both));
  });
});
