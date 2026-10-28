import type { AssignmentReportRow, PolicyKind } from "@intune-preflight/shared";

/**
 * The vocabulary a manifest row is rendered from: the chip palettes and the
 * shapes the report hands to its two presentations.
 *
 * Apart from the components so a Fast Refresh boundary stays a component-only
 * module, and because the desktop table and the compact cards both read these
 * -- a chip that meant one thing in a table and another in a card would be a
 * bug nobody would think to look for.
 */

// Color-coded type chips, matching the diagram's kind palette, so the policy
// type reads as a uniform labeled column instead of loose grey text.
export const KIND_STYLE: Record<PolicyKind, { label: string; cls: string }> = {
  deviceConfiguration: { label: "Device Config", cls: "bg-sky-500/15 text-sky-300" },
  settingsCatalog: { label: "Settings Catalog", cls: "bg-violet-500/15 text-violet-300" },
  compliancePolicy: { label: "Compliance", cls: "bg-orange-500/15 text-orange-300" },
  adminTemplate: { label: "Admin Template", cls: "bg-yellow-500/15 text-yellow-300" },
  platformScript: { label: "Script", cls: "bg-emerald-500/15 text-emerald-300" },
  endpointSecurity: { label: "Endpoint Security (Legacy)", cls: "bg-rose-500/15 text-rose-300" },
};

export const GROUP_KIND_STYLE: Record<string, string> = {
  virtual: "bg-slate-500/20 text-slate-300",
  dynamic: "bg-violet-500/20 text-violet-300",
  assigned: "bg-sky-500/20 text-sky-300",
};

/** One entry of a group's effective policy list, as `detailFor` builds it. */
export interface PolicyDetail {
  row: AssignmentReportRow;
  inheritedFrom: string | null;
  implied: boolean;
  filteredOut?: boolean;
}

/** The group rows the manifest lists, as the report's `groupOverlaps` carries them. */
export interface GroupRow {
  groupId: string;
  groupName: string;
  groupKind: string;
  includeCount: number;
  excludeCount: number;
  platforms: string[];
}
