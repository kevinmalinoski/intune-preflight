# Screenshots — shot list

Save PNGs here with these **exact filenames** and they'll light up in the docs. Captions are already written in [FEATURES.md](../FEATURES.md) — you only need the images.

Roughly **1600px wide** is plenty (docs scale to page width). Delete any line in `FEATURES.md` for a shot you decide not to take, so the page has no broken image.

## Main README

| File | What to capture |
|---|---|
| `01-simulator-overview.png` | **Hero shot.** The full simulator: configured endpoint → Autopilot card → Entra groups → policy-type bubbles. Also used at the top of FEATURES.md. |

## Endpoint Preflight (simulator)

| File | What to capture |
|---|---|
| `02-entra-groups.png` | The Entra security group picker with a couple of groups selected (show All Devices / All Users noted as always applying). |
| `03-autopilot-group-tag.png` | **Autopilot device** toggled on with a Group Tag typed in, and the dynamic group(s) it auto-selected — ideally showing the "dynamic" badge. |
| `04-grouped-vs-detail.png` | Grouped-by-type view and **Detail view** side by side (or a split/stitched image) so the difference is obvious. |
| `05-hide-group.png` | A group clicked to hide its policies — before/after, or the diagram with one group visibly folded away. |
| `06-policy-waitlist.png` | The Policy Waitlist expanded, showing unassigned policies with checkboxes and the **Select all / Clear** buttons. |
| `07-merged-baseline.png` | The **View merged baseline** panel open — the settings grid with the source-policy column visible. |
| `08-csp-paths.png` | The baseline grid focused on the **CSP path** column, ideally with the Microsoft Learn link visible (and the column picker open, if it fits). |
| `09-conflicts-overlaps.png` | The baseline showing at least one genuine **conflict** and one **overlap**, expanded to show contributing policies. Windows platform. |
| `10-autopilot-v1-v2.png` | The Autopilot enrollment cards — ideally a **V1 and a V2** card together (dual targeting), with one expanded to show deployment settings. |
| `11-platform-support.png` | The platform switcher, on macOS / iOS / Android — showing the baseline still renders (with conflict/overlap flags absent). |

## Assignment Manifest

| File | What to capture |
|---|---|
| `12-manifest-overview.png` | The Manifest table sorted by **Direct** descending, showing the hotspot groups at the top. |
| `13-manifest-expanded.png` | A group row expanded — the effective policy set with "via All Devices" tags, implied flags, and excludes at the bottom. |
| `14-manifest-filter-simulation.png` | A **⛃ filter chip** toggled on, showing the struck-through **Filtered** rows and the changed counts. |
| `15-manifest-export.png` | The **Download CSV** button, or the exported CSV opened in Excel. |

---

## ⚠️ Before you commit these

Screenshots bake in whatever is on screen. Since this repo is public:

- **Use the demo tenant where you can** — `npm run dev` with no `.env` starts in Demo mode with fully synthetic data and nothing to redact. It exercises conflicts, overlaps, exclude-wins, an include-filter case, Autopilot V1 + V2, and an unassigned policy.
- If you shoot a **real tenant**, scrub it first: policy and group names, device-name templates, SSIDs, admin account names, certificate authority / IdP names, and anything with your org's prefix.
- Double-check no tenant IDs, user names, email addresses, or device serials are visible.
- Redact by **replacing** names with generic ones where possible — blur bars read as "censored" and look worse than clean placeholder names.
