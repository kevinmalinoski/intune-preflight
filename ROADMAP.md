# Roadmap

Intune Preflight is at **v3.2**. v2 finished the settings side: endpoint
simulation, assignment resolution (include/exclude, filters, inherited All
Devices / All Users), the Autopilot V1/V2 enrollment layer, the Windows merged
CSP baseline with human-readable names and values, conflict / overlap /
cross-model detection, the Assignment Manifest, and a backend-free browser
build. v3 adds the other half of what lands on a device — its **apps** — and
rearranges the simulator around the way it is used.

This page tracks the **honest edges that remain** and the work planned to close
them. None of the known limitations block the core use — they're documented so you
know exactly where to double-check against Entra and the Intune admin center. See
[CHANGELOG.md](CHANGELOG.md) for what shipped when.

**Where v3 stands.** The first v3 bet has landed: [apps for the
endpoint](#shipped-since-v10), followed in v3.1 by links from a policy, app or
group into the admin center. What remains is split the same way as before —
**maintenance**, which makes what already ships more accurate without adding a
capability, and the **bigger bets**, each of which would change what the tool
is and carries real design risk.

## Known limitations

### Dynamic-group rules are judged, not fully evaluated
Each dynamic group's rule is judged three ways for the simulated endpoint:
**member**, **not a member**, or **can't tell** (`judgeMembershipRule` in
`packages/shared`). Only what the simulator models is evaluated:

- `device.devicePhysicalIds` clauses for Autopilot registration (`[ZTDId]`) and
  the Group Tag (`[OrderID]`), with `-eq`, `-startsWith` and `-contains`;
- `device.deviceOSType`, and only for Windows, where Entra's value is
  documented as `"Windows"`.

Everything else (enrollment profile name, OS version, model, ownership,
category, extension attributes, `memberOf`, any `user.` property) is **can't
tell**. `and`, `or` and `-not` combine those Kleene-style, so a rule is called
member or not only when its known parts settle it regardless of the rest. A
group the tool can't judge is never selected on a guess: it is marked **may
include**, sorted up for review, and counted above the list. A Group Tag match
ANDed with something else (**+ conditions**) is no longer auto-selected.

The way past the edge is **Start from a real device**: it reads the groups a
real device is in from Entra, nesting included, and those memberships replace
the judgement. What remains is the case with no real device to point at: a
rule that hinges on a property the simulator doesn't model can only be read,
not answered. Modelling more properties (enrollment profile, OS version) as
endpoint inputs would narrow it; see What's next.

**Nested groups** are read during the load: selecting a group selects every
assigned group it sits inside, which the admin can untick.

### Conflict & overlap detection is Windows-only
Value-level conflict and overlap detection is trustworthy for Windows. Other
platforms don't map cleanly onto it yet: macOS `.mobileconfig` profiles share
metadata that reads as false overlaps, and platform-specific frameworks — e.g.
the common pattern of splitting one concern per macOS **compliance** policy —
produce false conflicts. Both conflicts and overlaps are therefore suppressed off
Windows. The **merged baseline** (every applied setting) is still shown on all
platforms; only the conflict/overlap flags are Windows-only.

### Cross-model detection is best-effort (common settings only)
Same-model conflict/overlap detection keys each setting on a model-specific id, so
a **legacy template** and a **Settings Catalog** policy configuring the *same*
underlying CSP used to slip past it entirely (`0 conflicts`, even though the
device gets both). That's now covered by a **cross-MODEL** pass: settings resolve
a canonical `cspNode` — free for Settings Catalog and OMA-URI (they carry a real
CSP path), and via a curated template→CSP crosswalk for legacy device-config
templates — and any CSP configured through two different models is surfaced as a
cross-model finding (duplicate / conflict / verify), with the migrate-to-Settings-
Catalog nudge.

The honest edge: it's **best-effort over common settings**. Settings Catalog ↔
OMA-URI is exact; the template crosswalk is a small, hand-verified set (grounded
in Microsoft's Policy CSP docs), not every setting. Legacy Endpoint Security
intents aren't crosswalked yet (their definitions carry no CSP path). Expanding
crosswalk coverage is a [maintenance](#maintenance) item below; migrating legacy templates to the
Settings Catalog remains the real fix, which the flag encourages.

### Legacy Endpoint Security intents: read, named, and value-labelled
Legacy Endpoint Security & Security Baselines in the `deviceManagement/intents`
object model (BitLocker / Disk Encryption, Defender Antivirus, Firewall, ASR, …)
are read, merged into the baseline, and — being Windows — compared for
conflicts/overlaps against other intents. Their **real setting names and enum
value labels** are resolved from the template `settingDefinitions` (matching the
Settings Catalog), and modern policies are never mislabeled "(Legacy)". The one
remaining edge — a legacy intent vs a modern Settings Catalog policy setting the
*same* thing — is the cross-model limitation above.

### Legacy device-config default noise — resolved
Older template profiles (device restrictions, endpoint protection, compliance)
serialize their *entire* fixed schema, defaulting untouched fields. Those unset
defaults — `false` toggles plus the `notConfigured` / `userDefined` /
`deviceDefault` / `unavailable` enum sentinels — are now dropped for those
template types, so a profile contributes only what it actually configures (a
Device Restrictions profile that blocks 9 things reports 9, not ~200). One
residual: a real enum default (e.g. `cellularData = allowed`) can't be told from a
deliberate choice without a per-property default map, so it may still show. Types
where a `false` is genuinely meaningful (e.g. Update rings' `allowWindows11Upgrade`)
are deliberately left untouched.

### Apps are listed by assignment, not by outcome
The Apps view resolves which apps a simulated endpoint's groups deliver, under
which intent, through the same include/exclude and Assignment Filter logic as
policies. Three edges, all stated in the UI:

- **Available is mostly user-targeted.** For almost every app type Intune only
  honours an *Available* assignment made to a user group (Win32 apps, and Android
  Enterprise fully managed / COPE devices, are the exceptions). An available app
  is listed when a selected group or All Users delivers it; with no specific user
  modelled (below), that means "offered if the user is in that group".
- **Install-versus-uninstall is flagged, not resolved.** Microsoft documents a
  table for intent conflicts, but its outcome turns on whether each assignment
  targets a user group or a device group — *Available* against *Uninstall* goes
  either way — and the tool cannot tell the two kinds of group apart. Every
  assignment is listed and no winner is named. *Required* with *Available* is
  reported as **redundant** rather than as a conflict: every row of the table
  resolves it to "Required and Available".
- **"Same product, several apps" is a name match.** Intune compares assignments
  within one app object and never across two, so two objects for one product can
  be assigned to install and to uninstall with nothing reported. The tool pairs
  them on a normalized name (versions, architecture and packaging words
  dropped). That will pair things that are fine — an uninstaller package with
  the app it removes — so it is shown as "verify", and it will miss the same
  product under two unrelated names.
- **Exclusions are scoped to their intent**, as the admin center and Graph record
  them. Microsoft's include/exclude documentation does not state this outright;
  verify against the admin center if a result depends on it.

Not covered: Win32 dependencies and supersedence, app protection (MAM) and app
configuration policies, and install status.

### No specific-user modelling
Assignments to Entra *user* groups resolve normally — user groups are selectable
like any other, and the **All Users** virtual group always applies. What's absent
is any notion of a **specific user**: the tool never evaluates whether a named
user belongs to a group, so nothing is inferred from a sign-in. Autopilot V2 (a
user-driven flow) is therefore resolved by its configured just-in-time device
group rather than its user assignment.

## Maintenance

Work that makes what already ships more accurate or more pleasant, without
adding a capability.

- **Expand the cross-model crosswalk** — the best-shaped maintenance item there
  is: purely additive data, each entry independently testable, no architectural
  risk. Cross-model detection shipped best-effort (Settings Catalog ↔ OMA-URI by
  canonical CSP path, plus a curated template→CSP crosswalk in
  `packages/engine/src/crosswalk.ts`); growing it from Microsoft's
  migration-mapping docs directly widens coverage. Legacy Endpoint Security
  intents remain the harder half — their definitions carry no CSP path, so they
  need a mapping of their own.
- **Cross-platform conflict & overlap accuracy** — per-platform handling so
  macOS/iOS/Android conflicts and overlaps are accurate rather than suppressed
  (including framework-aware compliance handling, e.g. the
  one-concern-per-macOS-compliance-policy pattern). Today the merged baseline is
  shown on every platform and only the flags are Windows-scoped; this narrows
  that gap without changing what the tool does.
- **Per-property template defaults** — the last of the legacy default-noise
  edge: a real enum default (`cellularData = allowed`) still can't be told from a
  deliberate choice without a per-property default map.
- **Autopilot groups by `enrollmentProfileName`** — a real-tenant targeting shape
  the flat evaluator doesn't recognise yet, alongside `[ZTDId]` / `[OrderID]`.
- **Accessibility pass on the diagram and the baseline grid** — the panel and the
  dialogs are keyboard-navigable; the React Flow canvas and the resizable data
  grid are the parts that still assume a mouse.
- **Say so when a browser-mode baseline is scoped** — browser mode reads the
  tenant as the signed-in admin, so an admin whose Intune role carries scope
  tags gets their slice of it. The docs say this; the app does not yet. Until it
  does, read a browser-mode baseline as "what this admin can see".
- **Open in Intune for the rest** — the link is shown only where the admin-center
  address is known to be right. Still without one: Waitlist policies, Manifest
  rows, Autopilot cards, and every profile type whose address has not been
  confirmed against a real tenant.

## What's next

Bigger swings. Each would change what the tool is capable of and carries real
design risk. The tool's honesty about its edges is what makes them upgrades
rather than corrections.

- **Apps, by outcome rather than by assignment** — the Apps view shipped in v3.0
  and lists what is assigned. Two things would let it say more about what
  actually happens: classifying user versus device groups, so intent conflicts
  and Available targeting can be read more precisely; and reading Win32
  supersedence and dependencies, which install or remove apps no assignment
  mentions. Today's edges are under
  [Known limitations](#apps-are-listed-by-assignment-not-by-outcome).
- **More of the device as endpoint inputs** — the three-valued rule judgement
  shipped in v3.2, along with nested groups and starting from a real device.
  What it cannot judge are rules on properties the simulated endpoint doesn't
  have: enrollment profile name, OS version, model, ownership, category.
  Adding the common ones as optional inputs would let more rules settle without
  a real device, at the cost of a longer form. Worth doing only for the
  properties real tenants' rules actually use.
- **Richer user / user-group modelling** — assignments to Entra *user* groups
  resolve normally today (user groups are selectable, and All Users always
  applies), but there is no notion of a **specific user**: the tool never
  evaluates whether a named user belongs to a group. Modelling a signed-in user
  would let user-driven flows — Autopilot V2 in particular, which currently
  resolves by its configured device group — be simulated from the user side, and
  would enable user-scoped vs device-scoped setting context.
- **Tenant-wide policy ↔ group map** — a connective "nebula" of which policies
  bridge which groups across the whole tenant. The per-group seating chart (v1.2)
  is its single-group view; this is the zoomed-out whole-tenant version.

### Considered and parked

Written down so the reasoning isn't relitigated, not as a queue.

- **Effective-value resolution** ("which value wins for a conflicted setting").
  Parked on **honesty grounds**, not effort. Intune's real resolution across
  policy models is genuinely underdefined, so a computed "winner" would be a
  guess wearing a confident face — the one thing this tool tries never to do. The
  honest version of the feature shipped instead in v2.1: a conflicted merged
  row is flagged `conflicted` and points at the full disagreement rather than
  implying its own value won (see
  [docs/SETUP.md](docs/SETUP.md#reading-a-conflicted-setting-from-the-api)).
  Revisit only if Microsoft documents the resolution order.
- **Group-collision analysis** — surfacing the group *pairs* whose union produces
  conflicting settings (a device in both A and B). It leans on co-membership
  reasoning the tool avoids, and Intune already flags device-level conflicts —
  revisit only if the descriptive views prove it's wanted.

## Shipped since v1.0

**v3.1** — **Open in Intune**: a link beside a policy, app or group opens that
exact object in the Intune or Entra admin center, and in the merged baseline the
source policy's name is the link. Windows quality update policies are read.
Browser mode can change tenant without clearing the browser's storage.

**v3.0** — **Apps for the endpoint**: the Required, Available and Uninstall apps
a simulated endpoint's groups deliver, in a tab of their own beside the
baseline, with the diagram switching to draw them and an Apps sheet in the Excel
export. Four findings (install against uninstall, redundant assignments, the
same product added as several apps, line-of-business `.msi`), each app's
detection rule in the export, and Platform Script content readable in the
baseline. The simulator became three columns: define the endpoint, watch it
resolve, read the result. Needs one more read-only permission,
`DeviceManagementApps.Read.All`.

**v2.3 – v2.6** — the app on a phone and a tablet. A compact diagram below the
desktop width, the merged baseline beside the diagram rather than over it, CSP
areas named from what Graph returns, an Excel (`.xlsx`) export alongside CSV
and JSON, and exporting the view on screen instead of always the whole baseline.

**v2.2** — **browser mode**: the tool runs entirely in a browser tab, signed in
as the admin (delegated, PKCE), with no server and no client secret. This is
the delegated sign-in this page once listed as a future bet, shipped as a
hosted mode of its own rather than as an alternative inside the server.
Self-hosting with application credentials is unchanged and is still the only
mode that sees the whole tenant regardless of the admin's scope tags.

**v2.1** — hardening, not features. The engine became its own package with its
I/O-free boundary enforced three ways; the simulator's state became one tested
reducer; a conflicted setting is now flagged rather than reading as an effective
value; and a quality pass fixed a blocked-`localStorage` crash, a Graph body read
that escaped its timeout, a mislabelled group in the Manifest and a request-size
ceiling. Real linting, an error boundary, reproducible Docker images, an
automated demo deploy, and 114 → 178 tests. See
[CHANGELOG.md](CHANGELOG.md#210--2026-09-23).

**v2.0**
- **Cross-model "legacy policy collision" detection** — the same CSP configured
  across different policy models (legacy template vs Settings Catalog vs OMA-URI)
  is surfaced via a canonical `cspNode` + curated crosswalk, with a
  migrate-to-Settings-Catalog nudge. Best-effort over common settings.
- **"Legacy template" flag** on the deprecated device-config template types, and
  **real names / value labels / doc links** for legacy Endpoint Security intents.
- **Legacy template default-noise cleanup** — a Device Restrictions profile
  reports what it configures, not its whole serialized schema.
- **Group Tag match transparency** in the picker (match / + conditions /
  conditional, inline scope, smart sorting, fade-in) — surfaced, not a reimplemented
  Entra evaluator.
- **Public, zero-backend demo** on GitHub Pages (static in-browser engine over a
  bundled Open Intune Baseline sample tenant) + landing page + small-screen notice.

**v1.2**
- **Manifest → Simulator bridge** — check groups in the Assignment Manifest and
  simulate a device in exactly those groups, carrying any device filters you were
  simulating; the two views now compose instead of standing apart.
- **Per-group policy "seating charts"** — each checked group's policies as a heat
  cluster (unique to the group vs shared vs bleed), with a named chip-list
  drill-down, click-a-policy-to-see-its-groups, and a dual-assignment
  (All Devices/Users *and* a direct group) anomaly flag.
- **"Legacy policies" merged-baseline filter**, and a baseline fix dropping the
  `Assignments@odata.context` OData annotation that leaked in as a setting.

**v1.1**
- **Legacy Endpoint Security & Security Baselines** (`deviceManagement/intents`)
  are read and merged — BitLocker / Disk Encryption, Defender Antivirus, Firewall,
  ASR — and, being Windows, compared for conflicts/overlaps (see the two remaining
  edges under Known limitations, and the crosswalk item under Maintenance).
- **Docker runtime fix** — the slim server image resolved the shared package from
  its TypeScript source and 502'd on boot; it now resolves the built output.

## Shipped in v1.0

Delivered since the 0.5 beta:

- **Autopilot enrollment layer** — Autopilot V1 deployment profiles and V2
  device-preparation policies surfaced as an intermediate stage between the
  endpoint and its Entra groups, with device-group-based targeting, exclusion
  evaluation, dual-targeting detection (V1 + V2 on the same device group), and
  collapsible high-level deployment settings.
- **Merged baseline data grid** — resizable columns, a column picker, a readable
  CSP-path column with a per-setting Microsoft Learn documentation link,
  copy-to-clipboard, and chunked rendering for large (150+ policy) tenants.
- **Human-readable Settings Catalog names and values** — resolved from
  `settingDefinitions`, including choice option labels ("Enabled" rather than a raw
  option id).
- **Assignment Manifest** — tenant-wide, per-OS policy → group view with an overlap
  summary and CSV export.
- **Demo mode** — a bundled synthetic tenant so the tool can be evaluated with no
  app registration.
- **Performance** — bounded-concurrency Graph fetching with 429/503 retry, tuned
  for large tenants.
