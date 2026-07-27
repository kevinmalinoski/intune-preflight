// Helpers for presenting CSP references (paths / setting ids) and deriving
// their Microsoft Learn documentation URLs.
//
// Windows CSP reference docs live at stable, pattern-derivable slugs under
// learn.microsoft.com/windows/client-management/mdm/ (verified live):
//   - Policy CSP areas:  policy-csp-<area>            e.g. policy-csp-defender
//     with per-setting anchors: #<setting-lowercased>  e.g. #allowrealtimemonitoring
//   - ADMX-backed areas: policy-csp-admx-<name>       (underscores -> hyphens)
//   - Other CSPs:        <csp>-csp                    e.g. bitlocker-csp
// Anchors that don't exist degrade gracefully (the page opens at the top), so
// a best-effort anchor is strictly better than none.

const MDM_BASE = "https://learn.microsoft.com/windows/client-management/mdm/";

// CSPs that exist as OMA-URI paths but have no page in the MDM CSP reference
// (verified 404). EPM (PolicyPrivilegeManagement) is documented under Intune's
// Endpoint Privilege Management docs instead, with no stable per-setting page.
const UNDOCUMENTED_CSPS = new Set(["policyprivilegemanagement"]);

// Standalone CSPs deprecated wholesale whose settings live on under a Policy
// CSP area of the same name (the deprecated page itself says "use Policy CSP").
// Linking to the modern area page keeps the docs actionable instead of landing
// admins on a "this CSP is deprecated" banner. Node names match across the two
// (verified: policy-csp-devicelock carries mindevicepasswordlength etc.).
const LEGACY_CSP_TO_POLICY_AREA: Record<string, string> = {
  devicelock: "devicelock",
};

/**
 * Split a CSP reference into a boilerplate `prefix` (dimmed in the UI) and the
 * meaningful `tail`. For MSFT CSP paths the prefix is `./Device/Vendor/MSFT/`
 * (plus `Policy/Config/` for Policy CSP) -- pure noise; the tail carries all
 * the information. Namespaced legacy ids split at their last colon; anything
 * else is all tail.
 */
export function splitCspRef(ref: string): { prefix: string; tail: string } {
  if (ref.includes("/")) {
    const parts = ref.split("/");
    const msftIdx = parts.findIndex((p) => p.toLowerCase() === "msft");
    if (msftIdx !== -1 && msftIdx < parts.length - 1) {
      let tailStart = msftIdx + 1;
      if (
        parts[tailStart]?.toLowerCase() === "policy" &&
        ["config", "result"].includes(parts[tailStart + 1]?.toLowerCase() ?? "")
      ) {
        tailStart += 2;
      }
      if (tailStart < parts.length) {
        return { prefix: parts.slice(0, tailStart).join("/") + "/", tail: parts.slice(tailStart).join("/") };
      }
    }
    // Non-MSFT path (e.g. a custom OMA-URI to another vendor): dim all but the leaf.
    const leaf = parts[parts.length - 1];
    const head = parts.slice(0, -1).join("/");
    return { prefix: head ? head + "/" : "", tail: leaf };
  }

  const colon = ref.lastIndexOf(":");
  if (colon > 0 && colon < ref.length - 1) {
    return { prefix: ref.slice(0, colon + 1), tail: ref.slice(colon + 1) };
  }
  return { prefix: "", tail: ref };
}

/**
 * Derive the Microsoft Learn reference URL for an MSFT CSP path, or undefined
 * when the reference isn't a Windows CSP path we can map (Apple/Android
 * settings, legacy type:key ids, non-Microsoft OMA-URIs).
 */
export function msLearnCspUrl(ref: string | undefined): string | undefined {
  if (!ref || !ref.includes("/")) return undefined;
  const parts = ref.replace(/^\.\//, "").split("/").filter(Boolean);

  let i = 0;
  if (/^(device|user)$/i.test(parts[i] ?? "")) i++;
  if (!/^vendor$/i.test(parts[i] ?? "") || !/^msft$/i.test(parts[i + 1] ?? "")) return undefined;
  const csp = parts[i + 2];
  if (!csp) return undefined;
  const nodes = parts.slice(i + 3);

  // Third-party ADMX ingestion (Chrome, Edge, OneDrive, Office, ...) shows up
  // as tilde-separated category paths ("chromeintunev141~Policy~googlechrome").
  // Those are tenant-ingested templates with NO Microsoft Learn CSP reference
  // pages (verified 404) -- only first-party areas are documented there.
  if (nodes.some((n) => n.includes("~"))) return undefined;

  if (csp.toLowerCase() === "policy") {
    // ./Device/Vendor/MSFT/Policy/Config/<Area>/<Setting>
    const areaIdx = ["config", "result"].includes(nodes[0]?.toLowerCase() ?? "") ? 1 : 0;
    const area = nodes[areaIdx];
    if (!area) return `${MDM_BASE}policy-configuration-service-provider`;
    const setting = nodes[areaIdx + 1];
    const slug = `policy-csp-${area.toLowerCase().replace(/_/g, "-")}`;
    return setting ? `${MDM_BASE}${slug}#${setting.toLowerCase()}` : `${MDM_BASE}${slug}`;
  }

  if (UNDOCUMENTED_CSPS.has(csp.toLowerCase())) return undefined;
  const anchor = nodes.length ? `#${nodes[nodes.length - 1].toLowerCase()}` : "";
  const policyArea = LEGACY_CSP_TO_POLICY_AREA[csp.toLowerCase()];
  if (policyArea) return `${MDM_BASE}policy-csp-${policyArea}${anchor}`;
  return `${MDM_BASE}${csp.toLowerCase()}-csp${anchor}`;
}
