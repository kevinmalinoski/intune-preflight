// Canonical CSP identity + the legacy-template -> CSP crosswalk that powers
// CROSS-MODEL conflict/overlap detection: recognizing the SAME underlying CSP
// configured through different policy models (Settings Catalog, legacy
// device-config template, OMA-URI custom), which per-model settingId keying
// can't see.
//
// - Settings Catalog and OMA-URI settings already carry a real CSP path, so they
//   normalize to a shared `cspNode` for free (exact, no mapping needed).
// - Legacy templates expose only a Graph property with no path, so they need a
//   curated property -> { cspNode, value map } table. Microsoft publishes no
//   complete crosswalk, so this is deliberately a SMALL, hand-verified,
//   grounded set of the most common settings -- it checks common overlaps, never
//   claims completeness. Every entry's CSP is verified against Microsoft docs.

/**
 * Normalize a real CSP path / OMA-URI to a stable, model-agnostic node id, e.g.
 *   ./Device/Vendor/MSFT/Policy/Config/Accounts/AllowMicrosoftAccountConnection
 *   -> "accounts/allowmicrosoftaccountconnection"
 *   ./Device/Vendor/MSFT/BitLocker/RequireDeviceEncryption
 *   -> "bitlocker/requiredeviceencryption"
 * so a Settings Catalog setting and an OMA-URI custom setting targeting the same
 * CSP share one key. Returns undefined for anything that isn't a slash CSP path.
 */
export function normalizeCspNode(pathOrUri: string | undefined): string | undefined {
  if (!pathOrUri) return undefined;
  let p = pathOrUri.trim();
  if (!p.includes("/")) return undefined;
  p = p.replace(/^\.?\//, ""); // leading ./ or /
  p = p.replace(/^(device|user)\//i, ""); // scope
  p = p.replace(/^vendor\/msft\//i, ""); // vendor
  p = p.replace(/^policy\/config\//i, ""); // Policy CSP prefix
  p = p.replace(/\/+$/, "").toLowerCase();
  return p || undefined;
}

export interface CrosswalkEntry {
  /** Canonical CSP node this template property maps to. */
  cspNode: string;
  /** Human name for the merged cross-model row. */
  displayName: string;
  /**
   * Map the template's raw Graph value into the canonical CSP value space, so it
   * can be compared with a Settings Catalog value (which is already the CSP
   * option label). Return undefined when the value can't be mapped -> the finding
   * is reported as "unknown" (verify manually) rather than mis-classified.
   */
  mapValue: (raw: string) => string | undefined;
}

// Common value maps.
const boolBlock = (raw: string): string | undefined =>
  raw === "true" ? "Block" : raw === "false" ? "Allow" : undefined;
const passthrough = (raw: string): string => raw;

/**
 * Curated `windows10GeneralConfiguration` (Device restrictions) property -> CSP
 * crosswalk. Small and grounded on purpose; extend as needed. Each cspNode is
 * verified against the Microsoft Policy CSP reference.
 */
const WINDOWS10_GENERAL_CROSSWALK: Record<string, CrosswalkEntry> = {
  // Accounts area (Policy CSP: Accounts).
  microsoftAccountBlocked: {
    cspNode: "accounts/allowmicrosoftaccountconnection",
    displayName: "Accounts/AllowMicrosoftAccountConnection",
    mapValue: boolBlock,
  },
  accountsBlockAddingNonMicrosoftAccountEmail: {
    cspNode: "accounts/allowaddingnonmicrosoftaccountsmanually",
    displayName: "Accounts/AllowAddingNonMicrosoftAccountsManually",
    mapValue: boolBlock,
  },
};

/** Per-@odata.type template crosswalks. */
const CROSSWALKS: Record<string, Record<string, CrosswalkEntry>> = {
  windows10generalconfiguration: WINDOWS10_GENERAL_CROSSWALK,
};

/**
 * Resolve a legacy-template setting to its canonical CSP node + mapped value, if
 * the property is in the crosswalk for that template type. `rawValue` is the
 * already-stringified Graph value ("true"/"false"/"8"/...).
 */
export function crosswalkTemplateSetting(
  odataType: string | undefined,
  property: string,
  rawValue: string
): { cspNode: string; displayName: string; cspNodeValue?: string } | undefined {
  const typeKey = (odataType ?? "").replace(/^#?microsoft\.graph\./i, "").toLowerCase();
  const entry = CROSSWALKS[typeKey]?.[property];
  if (!entry) return undefined;
  return { cspNode: entry.cspNode, displayName: entry.displayName, cspNodeValue: entry.mapValue(rawValue) };
}

// Re-export for tests / callers that want the raw pieces.
export { passthrough };
