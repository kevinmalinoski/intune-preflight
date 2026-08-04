# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v0.5.0-beta...v1.0.0
[0.5.0-beta]: https://github.com/kevinmalinoski/intune-preflight/releases/tag/v0.5.0-beta
