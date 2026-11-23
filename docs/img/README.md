# Screenshots — shot list

Save PNGs here with these **exact filenames** and they'll light up in the docs. Captions are already written in [FEATURES.md](../FEATURES.md) — you only need the images.

Shots are retaken with `scripts/capture-docs-shots.mjs`, which drives headless Edge at 2x against the **demo build** and writes these files; add a shot there rather than capturing by hand, so the next retake is one command. The one exception is `08-csp-paths.png`, still a hand capture. Roughly **1600px wide** is plenty (docs scale to page width). Delete any line in `FEATURES.md` for a shot you decide not to take, so the page has no broken image.

## Main README

| File | What to capture |
|---|---|
| `01-simulator-overview.png` | The full simulator: configured endpoint → Autopilot card → Entra groups → policy-type bubbles. Used at the top of FEATURES.md; the README's hero is `gif-01-build-an-endpoint.gif`. |

## Endpoint Preflight (simulator)

| File | What to capture |
|---|---|
| `02-entra-groups.png` | The **Simulated endpoint** sidebar with a couple of groups selected (All Devices / All Users noted as always applying). |
| `03-autopilot-group-tag.png` | **Autopilot device** toggled on with a Group Tag typed in, and the dynamic group(s) it auto-selected — ideally showing the "dynamic" badge. |
| `04-grouped-vs-detail.png` | The diagram in **Detail view**, on an endpoint with few enough policies that each node is readable. |
| `05-hide-group.png` | A group clicked to hide its policies — before/after, or the diagram with one group visibly folded away. |
| `06-policy-waitlist.png` | The Policy Waitlist expanded at the foot of the sidebar, with a couple of unassigned policies ticked and drawn in the diagram. |
| `07-merged-baseline.png` | The **View merged baseline** panel open — the settings grid with the source-policy column visible. |
| `08-csp-paths.png` | The baseline grid focused on the **CSP path** column, ideally with the Microsoft Learn link visible (and the column picker open, if it fits). |
| `09-conflicts-overlaps.png` | The baseline showing at least one genuine **conflict** and one **overlap**, expanded to show contributing policies. Windows platform. |
| `10-autopilot-v1-v2.png` | The Autopilot enrollment cards — ideally a **V1 and a V2** card together (dual targeting), with one expanded to show deployment settings. |
| `11-platform-support.png` | The platform switcher, on macOS / iOS / Android — showing the baseline still renders (with conflict/overlap flags absent). |

## Apps

| File | What to capture |
|---|---|
| `18-apps-overview.png` | The full simulator on the **Apps** tab: app-type bubbles in the diagram, the list grouped by type with findings badged. Also used in the main README. |
| `19-apps-same-product.png` | The Apps rail after clicking a **same product / opposing intents** alert — the drill-down to the overlapping app objects. |
| `20-apps-findings.png` | The Apps rail on **LOB to convert**, with the Microsoft links and the Enrollment Status Page warning. |

## Workflow GIFs (recorded by hand)

The capture script takes stills only. These four are recorded by hand, all against a real tenant;
two of them have to be, because the sample tenant has no devices and no real assignment to change. Keep each **8–15 seconds**,
**1200–1600px wide**, **under 8 MB**, at 100% browser zoom with the cursor visible, and save them
with these exact names.

| File | Tenant | What to record | Used in |
|---|---|---|---|
| `gif-01-build-an-endpoint.gif` | real (recorded 2026-11-23) | Tick **Autopilot device**, type a Group Tag (`KIOSK-MULTI`), watch the matching groups rise and tick, the diagram redraw and the baseline count change. | README hero |
| `gif-02-real-device.gif` | real (recorded 2026-11-23) | Type the start of a device name, pick it: platform switches, groups tick with **✓ in device**, the note shows the group count and enrollment profile. | README feature list, FEATURES "Start from a real device" |
| `gif-03-fix-and-verify.gif` | real (recorded 2026-11-23) | With an endpoint set up, open **Refresh from Intune → Keep my setup** after changing an assignment in Intune, and the policy leaves the diagram. Cut the waiting. | README "Into the admin center and back", FEATURES "Open in Intune" |
| `gif-04-manifest-to-simulator.gif` | real (recorded 2026-11-23) | In the Manifest, tick three groups and watch their seating charts join the bar, then **Simulate a device in these 3 groups →** and land in the simulator. | FEATURES "Send groups to the simulator" |

## Assignment Manifest

| File | What to capture |
|---|---|
| `12-manifest-overview.png` | The Manifest table sorted by **Direct** descending, showing the hotspot groups at the top. |
| `13-manifest-expanded.png` | A group row expanded — the effective policy set with "via All Devices" tags, implied flags, and excludes at the bottom. |
| `14-manifest-filter-simulation.png` | A **⛃ filter chip** toggled on, showing the struck-through **Filtered** rows and the changed counts. |
| `15-manifest-export.png` | The **Export ▾** menu open on its formats. |
| `17-manifest-seating-charts.png` | A checked group's seating chart opened into its named policy list. |

---

## ⚠️ Before you commit these

Screenshots bake in whatever is on screen. Since this repo is public:

- **Use the demo tenant where you can** — `npm run dev` with no `.env` starts in Demo mode with fully synthetic data and nothing to redact. It exercises conflicts, overlaps, exclude-wins, an include-filter case, Autopilot V1 + V2, an unassigned policy, and every app finding.
- If you shoot a **real tenant**, scrub it first: policy and group names, device-name templates, SSIDs, admin account names, certificate authority / IdP names, and anything with your org's prefix.
- Double-check no tenant IDs, user names, email addresses, or device serials are visible.
- Redact by **replacing** names with generic ones where possible — blur bars read as "censored" and look worse than clean placeholder names.
