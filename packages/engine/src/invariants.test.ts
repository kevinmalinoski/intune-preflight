import { describe, expect, it } from "vitest";
import type { Platform } from "@intune-preflight/shared";
import { computeSimulation, simulationToCsv } from "./baseline.js";
import { demoTenantData } from "./demo/demoTenant.js";

/**
 * Properties that must hold for EVERY endpoint, rather than examples of
 * particular ones.
 *
 * The rest of the suite checks specific behaviours ("an exclude beats an
 * include"). These check the shape of the answer itself -- one row per setting,
 * a flag that always has something to point at, a policy never both applied and
 * excluded -- across a few hundred randomly-generated endpoints. That is the
 * kind of thing that survives a refactor of the internals, and it is how a
 * combination nobody thought to write a test for gets covered.
 *
 * The generator is seeded, so a failure here is reproducible rather than a
 * flake: the same 400 endpoints are checked every run.
 */

const data = demoTenantData();
const PLATFORMS: Platform[] = ["windows", "macos", "ios", "android", "other"];

/** Number of comma separators outside quotes, +1 -- i.e. the column count. */
const columnCount = (line: string) => (line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) ?? []).length + 1;

describe("simulation invariants", () => {
  const groupIds = data.groups.map((g) => g.id);
  const filterIds = data.assignmentFilters.map((f) => f.id);

  // A tiny LCG rather than Math.random, so every run checks the same endpoints.
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const sample = <T>(xs: T[]) => xs.filter(() => rnd() < 0.5);

  it("holds across 400 randomly generated endpoints", () => {
    for (let i = 0; i < 400; i++) {
      const platform = PLATFORMS[Math.floor(rnd() * PLATFORMS.length)];
      const sim = computeSimulation(data, {
        selectedGroupIds: sample(groupIds),
        platform,
        deviceFilterIds: sample(filterIds),
      });

      // The merged baseline is one row per setting -- that is what makes a
      // conflicted row's single `value` an arbitrary pick and not a winner.
      const settingIds = new Set(sim.settings.map((s) => s.settingId));
      expect(sim.settings.length).toBe(settingIds.size);

      // `conflicted` and `layered` are each set on exactly the settings that
      // have a matching finding entry, so a flag always has something to point
      // the reader at -- and the two flags never both appear on one setting.
      const conflictIds = new Set(sim.conflicts.map((c) => c.settingId));
      const layeredIds = new Set(sim.layered.map((l) => l.settingId));
      for (const s of sim.settings) {
        expect(Boolean(s.conflicted)).toBe(conflictIds.has(s.settingId));
        expect(Boolean(s.layered)).toBe(layeredIds.has(s.settingId));
        expect(Boolean(s.conflicted) && Boolean(s.layered)).toBe(false);
      }

      // Every finding describes a setting that is actually in the baseline.
      for (const c of sim.conflicts) expect(settingIds.has(c.settingId)).toBe(true);
      for (const l of sim.layered) expect(settingIds.has(l.settingId)).toBe(true);
      for (const o of sim.overlaps) expect(settingIds.has(o.settingId)).toBe(true);

      // The three buckets partition the settings that more than one policy
      // touches: a refused disagreement, a disagreement resolved by a rule, and
      // a redundancy are mutually exclusive by definition.
      for (const id of layeredIds) expect(conflictIds.has(id)).toBe(false);
      for (const o of sim.overlaps) {
        expect(conflictIds.has(o.settingId)).toBe(false);
        expect(layeredIds.has(o.settingId)).toBe(false);
      }
      for (const c of sim.conflicts) expect(new Set(c.values.map((v) => v.value)).size).toBeGreaterThan(1);
      // A layered finding is a real disagreement too -- policies that agree are
      // an overlap, whatever their type's resolution rule.
      for (const l of sim.layered) expect(new Set(l.values.map((v) => v.value)).size).toBeGreaterThan(1);
      for (const o of sim.overlaps) expect(o.sourcePolicies.length).toBeGreaterThan(1);

      // A layered finding never promotes one value: the merged row's `value` is
      // still just the first contributing policy reached, exactly as for a
      // conflict. This is the property that would catch the engine quietly
      // starting to apply a resolution rule it only claims to report.
      for (const l of sim.layered) {
        const row = sim.settings.find((s) => s.settingId === l.settingId);
        expect(l.values.some((v) => v.value === row?.value && v.sourcePolicyId === row?.sourcePolicyId)).toBe(true);
      }

      // Exclude wins: nothing is reported as both applied and excluded.
      const applied = new Set(sim.policies.map((p) => p.id));
      for (const ex of sim.excludedPolicies) expect(applied.has(ex.id)).toBe(false);

      // Conflict/layered/overlap/cross-model detection is Windows-only by design.
      if (platform !== "windows") {
        expect(sim.conflicts).toEqual([]);
        expect(sim.layered).toEqual([]);
        expect(sim.overlaps).toEqual([]);
        expect(sim.crossModel).toEqual([]);
        expect(sim.settings.some((s) => s.conflicted)).toBe(false);
        expect(sim.settings.some((s) => s.layered)).toBe(false);
      }

      // The CSV stays rectangular whatever the data -- a ragged row would
      // silently shift columns in Excel.
      const lines = simulationToCsv(sim).split("\n").filter(Boolean);
      const header = columnCount(lines[0]);
      for (const l of lines) expect(columnCount(l)).toBe(header);
    }
  });

  it("is deterministic -- the same endpoint always computes the same answer", () => {
    const opts = { selectedGroupIds: groupIds, platform: "windows" as const };
    expect(JSON.stringify(computeSimulation(data, opts))).toBe(
      JSON.stringify(computeSimulation(demoTenantData(), opts))
    );
  });

  it("adding a group never takes a policy away (when that group excludes nothing)", () => {
    // Assignment resolution should only ever be additive, except where an
    // explicit exclude intervenes -- so this is the property that would catch a
    // selection bug silently dropping policies.
    const excludeTargets = new Set(data.policies.flatMap((p) => p.excludedGroupIds));
    const base = computeSimulation(data, { selectedGroupIds: [], platform: "windows" });
    const baseIds = new Set(base.policies.map((p) => p.id));

    for (const gid of groupIds.filter((id) => !excludeTargets.has(id))) {
      const after = computeSimulation(data, { selectedGroupIds: [gid], platform: "windows" });
      const afterIds = new Set(after.policies.map((p) => p.id));
      for (const id of baseIds) expect(afterIds.has(id)).toBe(true);
    }
  });

  it("an unknown group id is ignored rather than throwing or inventing policies", () => {
    const withGarbage = computeSimulation(data, { selectedGroupIds: ["not-a-real-group"], platform: "windows" });
    const baseline = computeSimulation(data, { selectedGroupIds: [], platform: "windows" });
    expect(withGarbage.policies.length).toBe(baseline.policies.length);
  });

  it("the sample tenant references no group or filter that does not exist", () => {
    // Guards the demo data itself -- it backs the public demo, so a dangling id
    // would be a broken front door.
    const groups = new Set([...groupIds, "virtual-all-devices", "virtual-all-users"]);
    const filters = new Set(filterIds);
    for (const p of data.policies) {
      for (const id of [...p.assignedGroupIds, ...p.excludedGroupIds]) expect(groups.has(id)).toBe(true);
      for (const f of p.assignmentFilters) {
        expect(filters.has(f.filterId)).toBe(true);
        // A filter only means something on a group the policy actually targets.
        expect([...p.assignedGroupIds, ...p.excludedGroupIds]).toContain(f.groupId);
      }
    }
    for (const ap of data.autopilotProfiles) {
      for (const id of [...ap.assignedGroupIds, ...ap.excludedGroupIds]) expect(groups.has(id)).toBe(true);
      if (ap.deviceGroupId) expect(groups.has(ap.deviceGroupId)).toBe(true);
    }
  });
});
