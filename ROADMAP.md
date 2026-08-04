# Roadmap

Intune Preflight is at **v1.0**. The core is complete: endpoint simulation,
assignment resolution (include/exclude, filters, inherited All Devices / All
Users), the Autopilot V1/V2 enrollment layer, and the Windows merged CSP baseline
with human-readable Settings Catalog names and values.

This page tracks the **honest edges that remain** in v1.0 and the **v2** work
planned to close them (targeted ~Q4 2026). None of the known limitations block
v1.0's core use — they're documented so you know exactly where to double-check
against Entra and the Intune admin center.

## Known limitations (v1.0)

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

### Conflict & overlap detection is Windows-only
Value-level conflict and overlap detection is trustworthy for Windows. Other
platforms don't map cleanly onto it yet: macOS `.mobileconfig` profiles share
metadata that reads as false overlaps, and platform-specific frameworks — e.g.
the common pattern of splitting one concern per macOS **compliance** policy —
produce false conflicts. Both conflicts and overlaps are therefore suppressed off
Windows. The **merged baseline** (every applied setting) is still shown on all
platforms; only the conflict/overlap flags are Windows-only.

### Legacy Endpoint Security intents: names not CSP-mapped
Legacy Endpoint Security & Security Baselines in the `deviceManagement/intents`
object model (BitLocker / Disk Encryption, Defender Antivirus, Firewall, ASR, …)
are **read as of v1.1** — merged into the baseline and, being Windows, compared
for conflicts/overlaps. Two remaining edges: their setting names come from the
Graph `definitionId` (schema-agnostic, not a human CSP name), and their setting
ids don't line up with the equivalent Settings Catalog ids — so a legacy intent
and a modern Settings Catalog policy setting the *same* thing aren't yet
cross-detected as a conflict (two legacy intents are). Both are v2 items below.

### Legacy device-config default noise
Older template-based profiles serialize every property, including unset defaults.
`"notConfigured"` is filtered, but other default values can still appear as
settings.

### No specific-user modelling
Assignments to Entra *user* groups resolve normally — user groups are selectable
like any other, and the **All Users** virtual group always applies. What's absent
is any notion of a **specific user**: the tool never evaluates whether a named
user belongs to a group, so nothing is inferred from a sign-in. Autopilot V2 (a
user-driven flow) is therefore resolved by its configured just-in-time device
group rather than its user assignment.

## Planned for v2 (~Q4 2026)

- **Combined/nested dynamic-group rule evaluation** — the headline item. Replace
  the current regex-based clause extraction (`parsePhysicalIdClauses`,
  `groupTagMatchesRule`, `isAutopilotJoinedRule` in
  `packages/shared/src/index.ts`; `ruleImplies` in `apps/server/src/normalize.ts`)
  with a real membership-rule expression parser + evaluator (tokenize → AST →
  evaluate against the simulated device's attributes).
- **Legacy Endpoint Security intents: CSP mapping** — the intents themselves are
  read (v1.1); v2 maps each `definitionId` to a human CSP name and to the
  equivalent Settings Catalog setting id, so a legacy intent and a modern
  Settings Catalog policy setting the same thing are cross-detected as a conflict.
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
