/**
 * The shared "policy heat" vocabulary behind the per-group seating charts: how
 * widely a policy is shared across the tenant, and the colour that encodes it.
 *
 * Kept apart from the component that draws it because three different views
 * speak it -- the heat cluster, its chip-list drill-down, and the Assignment
 * Manifest that builds the input.
 */

export type ClusterPolicy = {
  id: string;
  name: string;
  shared: number; // # real groups directly carrying it (virtual scopes excluded)
  sharedWith: string[]; // other real groups that carry it
  universal: string[]; // "All Devices" / "All Users" scopes it's on, if any
};

/** Indigo -- "applies to everyone", not a per-group choice. */
export const UNIVERSAL_COLOR = "#818cf8";

/** Heat by sharedness. Thresholds kept in step with the diagram/legend palette. */
export function policyHeat(shared: number): string {
  return shared <= 1 ? "#34d399" : shared === 2 ? "#38bdf8" : shared <= 4 ? "#f59e0b" : "#fb7185";
}

/** A universal (All Devices/Users) policy is called out regardless of its real-group count. */
export function policyColor(p: ClusterPolicy): string {
  return p.universal.length ? UNIVERSAL_COLOR : policyHeat(p.shared);
}

/** How much of a group's policy set is its own vs shared vs universal. */
export function containment(pols: ClusterPolicy[]) {
  const universalN = pols.filter((p) => p.universal.length > 0).length;
  const ownN = pols.filter((p) => p.universal.length === 0 && p.shared === 1).length;
  const sharedN = pols.length - universalN - ownN;
  const total = pols.length || 1;
  return { total: pols.length, ownN, sharedN, universalN, ownPct: Math.round((ownN / total) * 100) };
}
