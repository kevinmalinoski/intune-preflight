/**
 * Whether a single group assignment's filter allows it to apply, given which
 * filter(s) (if any) are selected as representing the simulated device. A
 * device can match more than one Assignment Filter at once (e.g. "Kiosk
 * Devices" AND "Corporate Owned"), so this checks set membership rather than
 * equality. A missing entry means the assignment has no filter, so it always
 * passes.
 *
 * Its own module because policies (baseline.ts) and apps (apps.ts) both resolve
 * assignments through it, and one of those importing the other would be a cycle.
 */
export function passesAssignmentFilter(
  filterRef: { filterId: string; filterType: "include" | "exclude" } | undefined,
  selectedFilterIds: string[]
): boolean {
  if (!filterRef) return true;
  if (filterRef.filterType === "exclude") return !selectedFilterIds.includes(filterRef.filterId);
  return selectedFilterIds.includes(filterRef.filterId);
}
