# Roadmap

Intune Preflight is at **v2.0**. The core is complete: endpoint simulation,
assignment resolution (include/exclude, filters, inherited All Devices / All
Users), the Autopilot V1/V2 enrollment layer, the Windows merged CSP baseline
with human-readable Settings Catalog **and legacy Endpoint Security** names and
values, **cross-model "legacy policy collision" detection**, the **"Legacy
template" migration flag**, honest **Group Tag** surfacing in the picker, a
tightly integrated Assignment Manifest (send groups to the simulator, per-group
"seating charts"), and a **public, zero-backend demo**.

This page tracks the **honest edges that remain** and the work planned to close
them. None of the known limitations block the core use — they're documented so you
know exactly where to double-check against Entra and the Intune admin center. See
[CHANGELOG.md](CHANGELOG.md) for what shipped when.

## Known limitations

### Dynamic-group rule evaluation is flat / best-effort
The **Autopilot** and **Group Tag** auto-selection (and the "implied group"
detection) parse only *flat* membership-rule clauses:

- single-level `or` / `and` of `device.devicePhysicalIds` clauses,
- targeting the `[OrderID]` (Group Tag) and `[ZTDId]` (Autopilot) tags,
- with `-eq` / `-startsWith` operators.

They do **not** fully evaluate **combined / nested dynamic-group rules** — e.g.
rules that nest parentheses, mix device properties
(`(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:X")) and (device.deviceOSType -eq "Windows")`),
or use other operators (`-match`, `-in`, `-notIn`). Such a group may
be missed by the auto-selection. Implied/auto-selected groups are
always surfaced in the UI so they can be eyeballed against Entra.

Two deliberate exceptions where the structure *is* understood: a bare `[ZTDId]`
clause standing as a top-level `or` branch selects the group (Entra binds `and`
tighter than `or`, so that branch guarantees membership on its own), and
**implied-group detection is restricted to rules built solely from
`devicePhysicalIds` clauses** — the moment either rule mixes in another property,
no implication is claimed rather than guessing from a shared condition.

**Surfaced, not guessed (shipped).** Rather than fake a full evaluator, the group
picker now classifies each dynamic group against the entered Group Tag: a
confident `[OrderID]` match is badged **group tag** and auto-selected; a match
whose rule *also* hinges on a property a tag can't decide (deviceOSType,
deviceCategory, …) is badged **+ conditions** with the membership rule shown to
verify; and a tag that's referenced but can't be confirmed by the flat evaluator
is badged **conditional** (surfaced, not auto-selected). The list sorts
selected → matches → conditional → rest. So the honest edge is *visible* per group
now, and a real rule engine (below) becomes an accuracy upgrade, not a correctness
prerequisite.

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
crosswalk coverage is the v2 item below; migrating legacy templates to the
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

### No specific-user modelling
Assignments to Entra *user* groups resolve normally — user groups are selectable
like any other, and the **All Users** virtual group always applies. What's absent
is any notion of a **specific user**: the tool never evaluates whether a named
user belongs to a group, so nothing is inferred from a sign-in. Autopilot V2 (a
user-driven flow) is therefore resolved by its configured just-in-time device
group rather than its user assignment.

## Next (post-2.0)

- **Combined/nested dynamic-group rule evaluation** — the headline item. Replace
  the current regex-based clause extraction (`parsePhysicalIdClauses`,
  `groupTagMatchesRule`, `isAutopilotJoinedRule` in
  `packages/shared/src/index.ts`; `ruleImplies` in `apps/server/src/normalize.ts`)
  with a real membership-rule expression parser + evaluator (tokenize → AST →
  evaluate against the simulated device's attributes).
- **Expand cross-model crosswalk coverage** — cross-model detection shipped
  (best-effort): Settings Catalog ↔ OMA-URI by canonical CSP path, plus a curated
  template→CSP crosswalk. v2 grows the crosswalk (more template properties, from
  Microsoft's migration-mapping docs) and adds legacy Endpoint Security intents
  (which carry no CSP path today), toward broader coverage. (Legacy intent
  names/values, the "Legacy template" flag, and the initial cross-model pass all
  already shipped.)
- **Cross-platform conflict & overlap accuracy** — per-platform handling so
  macOS/iOS/Android conflicts and overlaps are accurate rather than suppressed
  (including framework-aware compliance handling, e.g. one-concern-per-policy).
- **Effective-value resolution** — show which value "wins" for a conflicted setting.
- **Richer user / user-group modelling** — today, assignments to Entra *user*
  groups resolve normally (user groups are selectable, and All Users always
  applies), but there is no notion of a **specific user**: the tool never
  evaluates whether a named user belongs to a group. Modelling a signed-in user
  would let user-driven flows — Autopilot V2 in particular, which currently
  resolves by its configured device group — be simulated from the user side, and
  would enable user-scoped vs device-scoped setting context.
- **Optional delegated (user sign-in) auth** — a device-code sign-in flow as an
  *alternative* to the long-lived client secret. Deliberate tradeoff: a delegated
  token is scoped to the signed-in admin's RBAC (scope tags / admin units), so it
  shows only *that admin's slice* — which narrows the tool's "full, unfiltered
  preflight" value. App-only stays the default and recommended mode.

### Under consideration

- **Tenant-wide policy ↔ group map** — a connective "nebula" of which policies
  bridge which groups across the whole tenant. The per-group seating chart (v1.2)
  is its single-group view; this is the zoomed-out whole-tenant version.
- **Group-collision analysis** — surfacing the group *pairs* whose union produces
  conflicting settings (a device in both A and B). Parked deliberately: it leans on
  co-membership reasoning the tool avoids, and Intune already flags device-level
  conflicts — revisit only if the descriptive views prove it's wanted.

## Shipped since v1.0

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
  edges under Known limitations, and the CSP-mapping item in v2).
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
