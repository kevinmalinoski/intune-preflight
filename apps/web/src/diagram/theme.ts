import type { SimulationGroup } from "@intune-preflight/shared";

/**
 * The diagram's shared vocabulary: what each policy type looks like, and the
 * fixed dimensions the layout is computed from.
 *
 * Kept apart from the components and from buildGraph because all three read the
 * same numbers -- a node renders at a width the layout has to reserve, and the
 * legend has to use the same colours the nodes do. When these lived inline,
 * "change the group column width" meant finding every place that assumed it.
 */

export const KIND_COLOR: Record<string, string> = {
  deviceConfiguration: "#38bdf8",
  settingsCatalog: "#a78bfa",
  compliancePolicy: "#f97316",
  adminTemplate: "#facc15",
  platformScript: "#34d399",
  endpointSecurity: "#f43f5e",
};

export const KIND_LABEL: Record<string, string> = {
  deviceConfiguration: "Device Configuration",
  settingsCatalog: "Settings Catalog",
  compliancePolicy: "Compliance Policy",
  adminTemplate: "Admin Template",
  platformScript: "Platform Script",
  endpointSecurity: "Endpoint Security (Legacy)",
};

export const SOURCE_STYLE: Record<SimulationGroup["source"], { border: string; bg: string; label: string }> = {
  selected: { border: "#34d399", bg: "rgba(52,211,153,0.10)", label: "Selected group" },
  "all-devices": { border: "#94a3b8", bg: "rgba(148,163,184,0.07)", label: "Always applies" },
  "all-users": { border: "#94a3b8", bg: "rgba(148,163,184,0.07)", label: "Always applies" },
  implied: { border: "#fbbf24", bg: "rgba(251,191,36,0.08)", label: "Implied by rule" },
  unassigned: { border: "#fb923c", bg: "rgba(251,146,60,0.08)", label: "No assignment" },
};

export const UNASSIGNED_EDGE = "#fb923c";
export const AUTOPILOT_COLOR = "#818cf8";

// The device and its Autopilot enrollment cards are ONE React Flow node -- the
// device is what enrolls, so they read (and move) as a single "configured
// endpoint" unit. Keeping them in one node means the BROWSER stacks the cards:
// there is no per-card geometry to estimate, no post-render re-measure pass, and
// the gaps are exactly STACK_GAP no matter how names wrap or which cards are
// expanded. Each card carries its own source handle, so an Autopilot profile
// still draws its own line to the groups it targets.
export const STACK_WIDTH = 320;
// Even vertical rhythm inside the stack: device -> first profile and
// profile -> profile use the same gap so the unit reads as one deliberate group.
export const STACK_GAP = 16;

export const GROUP_NODE_WIDTH = 250;
export const POLICY_NODE_WIDTH = 230;
export const TYPE_NODE_WIDTH = 400;
export const CHARS_PER_LINE = 24;
export const LINE_HEIGHT = 16;
export const BASE_ROW_HEIGHT = 64;
export const ROW_GAP = 24;

// Type-bubble geometry (grouped view).
export const TYPE_HEADER_HEIGHT = 40;
export const TYPE_LINE_HEIGHT = 29;
export const TYPE_PADDING = 14;

// Order the type bubbles top-to-bottom: compliance first, then configuration
// surfaces (device config, settings catalog, admin templates), then scripts.
export const KIND_ORDER = [
  "compliancePolicy",
  "deviceConfiguration",
  "settingsCatalog",
  "endpointSecurity",
  "adminTemplate",
  "platformScript",
];

// A type bubble lists at most this many policies before collapsing the rest
// behind a "+N more" row -- a 90-policy Settings Catalog bubble in a large
// tenant would otherwise dwarf the whole diagram.
export const TYPE_BUBBLE_CAP = 12;

export type PolicyStatus = "included" | "excluded" | "unassigned";
export const STATUS_DOT: Record<PolicyStatus, string> = {
  included: "#64748b",
  excluded: "#fb7185",
  unassigned: "#fb923c",
};

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Long group/policy names wrap to multiple lines -- estimate row height so nodes never overlap. */
export function estimateRowHeight(label: string): number {
  const lines = Math.max(1, Math.ceil(label.length / CHARS_PER_LINE));
  return BASE_ROW_HEIGHT + (lines - 1) * LINE_HEIGHT + ROW_GAP;
}

/** The device card itself -- the top of the "configured endpoint" stack. */
