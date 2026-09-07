# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.1] — 2026-09-06

### Added
- **Autopilot "+ conditions" surfacing in the group picker.** A dynamic group whose
  rule keys on Autopilot (a bare `[ZTDId]` clause) but ANDs it with a device
  condition the flat evaluator can't check — e.g. the common
  `… and (device.deviceModel -not -startsWith "Cloud PC")` (all Autopilot devices
  except Cloud PCs) — is no longer silently missed. When the **Autopilot device**
  toggle is on, it's surfaced with an `autopilot · + conditions` badge, its rule
  shown inline, and sorted to the top for one-click opt-in (not auto-selected, to
  avoid over-matching a condition that can't be evaluated). Cleanly-scoped `[ZTDId]`
  groups still auto-select as before. Mirrors the Group Tag "+ conditions" behavior.

### Fixed
- **Diagram: exact spacing for the device + enrollment stack.** The Autopilot
  enrollment cards under the "Configured Endpoint" node are now positioned from
  their real measured heights (via a ResizeObserver), so the gaps are always even
  regardless of how the device's group list wraps — fixing an overlap that could
  appear on some selections.

## [2.0.0] — 2026-09-03

A major release centered on **legacy policy handling**, **cross-model conflict
detection**, honest **dynamic-group (Group Tag)** surfacing, and a **public,
zero-backend demo**.

### Added
- **Cross-model conflict/overlap detection ("legacy policy collisions").** The
  same underlying CSP configured through *different* policy models — a legacy
  device-config template and a Settings Catalog policy, or an OMA-URI custom
  profile — used to slip past per-model detection entirely (`0 conflicts`, even
  though the device gets both). Settings now resolve a canonical `cspNode` — exact
  for Settings Catalog + OMA-URI via their real CSP path, and via a curated,
  Microsoft-docs-grounded template→CSP crosswalk for legacy templates — and any
  CSP touched by two models is surfaced as a collision (duplicate / conflict /
  verify) with a migrate-to-Settings-Catalog nudge. Best-effort over common
  settings, and labelled as such (a count next to conflicts/overlaps plus a
  "Legacy collisions" filter).
- **"Legacy template" flag.** The deprecated device-config *template* types
  Microsoft is migrating to the Settings Catalog (Device restrictions/features,
  Endpoint protection, Extensions) are flagged in the Assignment Manifest and the
  merged baseline, nudging a Settings Catalog migration. The still-current
  templates (certificates, VPN, Wi-Fi, email, wired network) are deliberately not
  flagged.
- **Real names, value labels and documentation links for legacy Endpoint Security
  intents.** Legacy intents' settings now resolve their true Intune display names
  and enum value labels from the template `settingDefinitions` (matching the
  Settings Catalog), plus direct Microsoft Learn links — instead of `definitionId`
  fragments and raw enum codes.
- **Group Tag match transparency in the group picker.** Each dynamic group is
  classified against the entered Group Tag: a confident `[OrderID]` match (badged,
  auto-selected); a **+ conditions** match whose rule *also* hinges on a property a
  tag can't decide (shown with the membership rule to verify); or a **conditional**
  reference the flat evaluator can't confirm (surfaced, not auto-selected). Each
  group's `[OrderID]` scope is shown inline, matches fade in, and the list sorts
  selected → matches → conditional → rest.
- **Public, zero-backend demo.** A static in-browser build runs the exact same
  engine over a bundled sample tenant — no server, nothing leaves the browser —
  hosted on GitHub Pages with a landing page, so the tool can be evaluated from a
  link. The demo tenant is grounded on the community Open Intune Baseline.
- **Small-screen notice** so phone visitors get a "built for a bigger screen"
  message instead of a broken dense layout.

### Changed
- **Only genuine security/baseline intents are labelled "(Legacy)".** Modern and
  migrated policies (which live in the Settings Catalog) can no longer be
  mislabelled as legacy Endpoint Security.
- **Legacy template default noise removed.** Fixed-schema template profiles
  (device restrictions/general, endpoint protection, compliance) serialize their
  *entire* schema; the unset defaults — `false` toggles and the `notConfigured` /
  `userDefined` / `deviceDefault` / `unavailable` sentinels — are now dropped for
  those types, so a profile contributes only what it actually configures (a Device
  Restrictions profile that blocks 9 things reports 9, not ~200). Types where a
  `false` is genuinely meaningful (e.g. an Update ring's `allowWindows11Upgrade`)
  are left untouched.
- **Group selector polish** — a cohesive tag-scope pill, muted structural chips,
  matched-row accent, and roomier list.
- **Autopilot enrollment stacks under the endpoint.** The V1/V2 enrollment cards
  now sit directly beneath the "Configured Endpoint" node as one device unit
  (device on top, its profiles below) instead of occupying a separate column
  between the device and the groups — the endpoint *is* what enrolls, so it reads
  as one thing that branches out to its groups. Every group hangs directly off the
  device, with each profile drawing its own line to the specific device group it
  targets.

### Fixed
- **Cross-model false positives on real tenants.** A complex/collection Settings
  Catalog setting expands into many sub-settings that all normalize to one CSP
  node within a single policy; the detector now requires two different policy
  *models* (not merely two setting ids), so intra-policy settings never fire.
- **Docker/type-check:** added the missing Vite client types so the web workspace
  type-checks cleanly with the static-demo build.

## [1.2.1] — 2026-08-04

### Fixed
- **Selecting an Autopilot-joined group in the Manifest now carries it into the
  simulation.** The simulator's "Autopilot device" effect stripped any
  Autopilot-joined dynamic group (a bare `[ZTDId]` rule, e.g. "Device - Windows -
  Autopilot") whenever Autopilot mode was off — which it is by default on a
  Manifest handoff — so the group was silently dropped from the simulated device.
  The effect now only *adds* Autopilot groups when the toggle is on; it never
  removes a group the user selected deliberately (removal on toggle-off is handled
  separately).

## [1.2.0] — 2026-08-04

### Added
- **Per-group "seating charts."** As you check groups in the Assignment Manifest,
  a strip above the selection bar shows each group's policies as a bubble cluster
  — cool = a policy unique to this group, hot = one shared across many groups —
  with a containment bar ("68% its own"). Click a chart to open the full named
  policy list — heat-colored chips, unique policies first, each naming the other
  groups that carry it. A preflight read on whether a group is siloed or
  overcrowded with borrowed policies, computed entirely from the data already loaded.
  A policy that is on **both All Devices/Users *and* a direct group** — an
  assignment Intune's portal disallows (it's either/or), so an anomaly that can
  only come from Graph/PowerShell — is flagged distinctly (indigo ⚠) instead of
  being counted as the group's own. Pairs with the bridge: eyeball the groups,
  then simulate them.
- **Manifest → Simulator bridge.** Check real Entra groups in the Assignment
  Manifest and hit **"Simulate a device in these groups"** to jump straight into
  the Endpoint Preflight simulator, seeded with exactly those groups — plus any
  device filters you were simulating in the Manifest — on the Manifest's current
  OS, as a fresh, ground-up merged baseline. A selection bar
  rises from the bottom when groups are checked; All Devices / All Users are
  shown as always-applies and included automatically rather than selected. Ties
  the tenant-wide "who carries what" view to the per-device "what does it get"
  view without merging the two screens.

### Fixed
- **`Assignments@odata.context` no longer appears as a setting.** Fetching
  policies with `$expand=assignments` makes Graph attach an OData annotation
  (`assignments@odata.context`, a URL) that the schema-agnostic flattener emitted
  as a bogus setting — most visible on compliance policies, which have few real
  settings. Any `@odata` annotation key is now skipped.

## [1.1.0] — 2026-08-03

### Added
- **Legacy Endpoint Security & Security Baselines** (the older
  `deviceManagement/intents` model) are now read into the baseline — legacy
  **BitLocker / Disk Encryption**, **Defender Antivirus**, **Firewall**, **Attack
  Surface Reduction**, Account Protection, and EDR intents. Each intent's
  template supplies its category (BitLocker, Firewall, …) and platform; its
  settings are normalized like any other policy, so they merge into the endpoint
  baseline, appear in the Assignment Manifest, and — being Windows — join
  conflict/overlap detection (two legacy BitLocker intents disagreeing on the
  cipher is now flagged). Shown under a new **Endpoint Security (Legacy)** policy
  type — in the diagram, the Policy Types legend, and the Assignment Manifest —
  with a **Legacy policies** filter in the merged-baseline view to isolate what
  the legacy intents contribute. Modern Endpoint Security policies already came
  through the Settings Catalog; this closes the gap for tenants still on the
  legacy intents. The demo tenant gains legacy BitLocker (org-wide + a corp
  override that conflicts), Defender Antivirus, and an unassigned Firewall intent.

### Fixed
- **Docker image no longer 502s on startup.** The shared package's entry point
  pointed at its TypeScript source (`./src/index.ts`), which dev tooling resolves
  but the compiled server in the slim runtime image cannot — the shared module
  failed to load at boot, the server never started, and every request returned
  502. The package now resolves to its built output (`./dist` via `main`/`types`/
  `exports`); `npm run dev` and `lint` build the shared package first so nothing
  regresses. No Dockerfile change was needed — both images already built and
  copied `packages/shared/dist`.

## [1.0.0] — 2026-07-20

First stable release. Everything below is relative to the 0.5 beta.

### Added
- **Richer demo tenant.** The bundled sample now includes an Open Intune
  Baseline–style Windows set (openintunebaseline.com naming: Defender Antivirus,
  ASR, BitLocker, a ~35-setting Security Baseline, Firewall, Windows Hello, LAPS,
  compliance policies, browser admin templates, an update ring) so Demo mode reads
  like a real hardened tenant — ~25 policies, ~120 merged settings, two genuine
  conflicts (Defender submit-samples and feature-update deferral) and several
  overlaps, plus a fuller Policy Waitlist. The macOS set draws on the macOS Open
  Intune Baseline (FileVault, Firewall & Gatekeeper, Software Update, compliance),
  with a second iOS and Android policy so every platform tab has substance. No
  configuration is copied verbatim.
- **Interactive assignment-filter simulation (Assignment Manifest)** — click an
  ⛃ assignment-filter chip (or the "Simulate device filters" toggles) to treat the
  simulated device as matching that filter. Every group recomputes live and
  cross-group: policies the filter drops move to a struck-through "Filtered" line
  showing why, and the applied counts update. Default (no filter matched) is the
  original broad view.
- **Sortable Assignment Manifest** — the per-group rollup is now plain sortable
  Direct / Inherited / Incl-Excl columns (default: most-directly-assigned first),
  replacing an abstract stacked bar whose inherited half was ~constant noise.
- **Autopilot enrollment layer** — Autopilot **V1** deployment profiles and **V2**
  device-preparation policies now appear as an intermediate stage between the
  configured endpoint and its Entra groups. Targeting is device-group based (V2 keys
  on its configured just-in-time device group, not the user assignment), exclusions
  are evaluated, and **dual targeting** (a V1 and V2 profile sharing one device group)
  is detected and shown. Cards are collapsed by default and expand to reveal the
  high-level deployment settings.
- **Merged baseline data grid** — resizable columns, an Intune-style column picker
  (show/hide), a readable **CSP path** column with a **Microsoft Learn** documentation
  link per setting, copy-to-clipboard, and chunked rendering for large tenants.
- **Human-readable Settings Catalog names and values** — setting names, and choice
  option values, are resolved from `settingDefinitions` ("Enabled" instead of a raw
  option id) rather than shown as concatenated definition ids.
- **Demo mode** — the app starts against a bundled synthetic sample tenant when no
  `.env` is present (no app registration needed), with a **Demo / Connected** header
  toggle that flips the data source at runtime.
- **Assignment Manifest** — a tenant-wide, per-OS view of which policies target which
  groups, with an in-app overlap summary (groups ranked by policy count), inherited
  All Devices / All Users and implied-membership rows (honoring "exclude wins"), and a
  CSV export.
- **Policy Waitlist** — pull otherwise-unassigned policies into a simulation to
  preview "what if I assigned this?", shown as a distinct "No assignment" bucket.
- Diagram: click a group to hide it and the policies it brings in; the layout reflows.
- Group-by-type is the default diagram layout, with a **Detail view** toggle for the
  per-policy view.
- Starter unit-test suite (Vitest) covering assignment resolution, the assignment
  report, dynamic-rule implication, Autopilot targeting, and Graph platform
  classification.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, PR/issue templates, and this
  changelog.

### Changed
- **Diagram edge routing** — when Autopilot cards are present the endpoint connects
  only to the profile cards, and every Entra group (including the always-apply All
  Devices / All Users) hangs off the enrollment column: endpoint → profile → group →
  policies, with no duplicate lines crossing the Autopilot column.
- **Faster large-tenant loads** — per-policy Graph detail calls run with bounded
  concurrency and honor 429/503 `Retry-After`, cutting first-load time on 150+ policy
  tenants substantially.
- Consolidated the top bar (brand · view tabs · refresh) and removed redundant titles.
- Debounced the simulation request to remove lag when switching OS or editing groups.

### Changed
- **Autopilot-joined group detection now handles `or`, with operator precedence.**
  The "Autopilot device" toggle previously matched only a rule that was *nothing
  but* the bare `[ZTDId]` clause. In real tenants that clause is commonly a
  top-level `or` branch — often after a chain of `and` conditions. Since Entra
  binds `and` tighter than `or`, `A and B or ZTDId` means `(A and B) or ZTDId`,
  so an Autopilot device is a member via the ZTDId branch regardless of the `and`
  chain; those groups are now selected. The rule is split on top-level `or` only
  (never inside parentheses or quoted values), and a branch whose ZTDId clause is
  itself gated by `and` stays unselected — it would require a condition the
  evaluator can't check. Also accepts the paren-less and `-contains` clause
  shapes; a `[ZTDId]` pinned to a specific device still doesn't qualify.
- **~Half the Graph calls on load.** Policy assignments are now fetched inline with
  each collection via `$expand=assignments` instead of a per-policy round-trip,
  cutting a 141-policy tenant from ~368 to ~188 calls (a healthy load ~9s). Fewer
  calls also means less exposure to Graph's transient server errors. The load
  summary now logs call/retry/throttle telemetry so a slow load is diagnosable.

### Security
- **CSV exports are now formula-injection safe.** Cells beginning with `= + - @`
  (or a tab/CR) — which Excel/Sheets interpret as formulas — are prefixed with a
  single quote so a maliciously-named Intune policy or group can't execute when an
  admin opens an exported report. RFC-4180 quoting is unchanged.
- **Dependencies updated to clear all known advisories** (`npm audit`: 0
  vulnerabilities). Fixed transitive Fastify deps (`fast-uri`, `find-my-way`) and
  bumped `@azure/msal-node` to 5.x to drop a vulnerable `uuid`; the
  client-credentials auth flow was re-validated against a live tenant.

### Fixed
- **Unrelated groups no longer show as "implied by rule".** Implied-group
  detection reported an implication whenever the two rules shared *any single*
  clause, so two complex real-world rules that both happened to be scoped to
  `deviceOwnership -eq "Company"` implied each other — a Windows group surfaced a
  macOS group as implied, in both directions. Implication is now restricted to
  rules built solely from `devicePhysicalIds` clauses (where a Group Tag prefix
  relationship is genuinely provable); any rule mixing in another property claims
  no implication. Also requires *every* branch of an `or`-chain to imply, not just
  one — previously a group whose other branch didn't qualify was still reported.
- **Include vs exclude assignment filters now read correctly.** A policy dropped by
  an *include* filter (the device doesn't match the filter it's scoped to) was
  described with the same "excluded via device filter" wording as an *exclude*
  filter (the device matches) — the opposite reason. Every surface (merged
  baseline, diagram, manifest) now states the direction-correct reason and, for
  include filters, hints that selecting the filter under Device Filters simulates a
  match. The demo tenant gained an All Devices + include-filter policy to showcase
  it.
- **Reliable large-tenant loading — no more silently dropped policies.** The Graph
  client now retries gateway timeouts (502/503/504) and dropped connections in
  addition to throttling (429), with a per-request timeout so a wedged connection
  can't stall the whole load for minutes. Previously an unretried gateway timeout
  threw, and the failed policy (or whole category) was skipped silently. If a load
  still can't complete an item after retries, it's surfaced — a banner in the app
  and a summary in the server log — so a partial baseline is never silent.
- **macOS compliance no longer "hallucinates" settings.** A compliance policy's
  Graph resource is a fixed schema that serializes every field with its default,
  and the untouched defaults (`false` booleans, `deviceDefault` / `unavailable`
  enums) were leaking in as configured settings — and, across an OIB-style
  one-concern-per-policy layout, inventing conflicts. Compliance policies now
  contribute only the rules they actually enforce.
- **Conflict and overlap detection is now Windows-only** (previously just
  overlaps). Value-level comparison isn't trustworthy on other platforms yet, so
  both flags are suppressed off Windows; the merged baseline is still shown
  everywhere. See ROADMAP.md.
- Assignment Manifest now counts **applied** policies (direct + inherited) for its bar
  level, instead of conflating distinct direct targets with inherited includes.

## [0.5.0-beta] — 2026

Initial public beta.

### Added
- Endpoint simulator: pick an OS, Entra groups, Autopilot / Group Tag, and Assignment
  Filters, and see the merged CSP baseline with conflicts and overlaps.
- Group → policy → setting diagram (React Flow) with a drill-down merged-baseline panel
  and JSON/CSV export.
- Read-only Microsoft Graph client (app-only auth) with in-memory TTL caching, covering
  configuration profiles, compliance, Settings Catalog, Administrative Templates,
  platform scripts, Windows update profiles, Autopilot profiles, and Assignment Filters.
- Docker Compose and `npm run dev` setup; MIT licensed.

[Unreleased]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v0.5.0-beta...v1.0.0
[0.5.0-beta]: https://github.com/kevinmalinoski/intune-preflight/releases/tag/v0.5.0-beta
