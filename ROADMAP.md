# Roadmap

Intune Preflight is shipping as a **0.5 beta**. This is what's known-limited today
and what's planned for **v1**. Nothing here blocks the beta's core use — endpoint
simulation, assignment resolution, and the Windows merged baseline — but these are
the honest edges.

## Known limitations (0.5 beta)

### Dynamic-group rule evaluation is flat / best-effort
The **Autopilot** and **Group Tag** auto-selection (and the "implied group"
detection) parse only *flat* membership-rule clauses:

- single-level `or` / `and` of `device.devicePhysicalIds` clauses,
- targeting the `[OrderID]` (Group Tag) and `[ZTDId]` (Autopilot) tags,
- with `-eq` / `-startsWith` operators.

They do **not** fully evaluate **combined / nested dynamic-group rules** — e.g.
rules that nest parentheses, mix device properties
(`(device.devicePhysicalIds -any (_ -startsWith "[OrderID]:X")) and (device.deviceOSType -eq "Windows")`),
or use other operators (`-contains`, `-match`, `-in`, `-notIn`). Such a group may
be missed or over-matched by the auto-selection. Implied/auto-selected groups are
always surfaced in the UI so they can be eyeballed against Entra.

**v1 plan:** a proper membership-rule expression parser + evaluator (tokenize →
AST → evaluate against the simulated device's attributes), replacing the current
regex-based clause extraction in `packages/shared/src/index.ts`
(`parsePhysicalIdClauses`, `groupTagMatchesRule`, `isDefaultAutopilotJoinedRule`)
and `apps/server/src/normalize.ts` (`ruleImplies`).

### Overlap detection is Windows-only
Conflict/overlap is trustworthy for Windows. Other platforms surface false
overlaps from shared profile metadata (e.g. macOS `.mobileconfig`), so overlaps
are suppressed off Windows. Conflicts (genuine value disagreements) still apply
everywhere. **v1 plan:** per-platform handling so macOS/iOS/Android overlaps are
accurate.

### Settings-catalog names & choice values are raw
Settings Catalog setting names and choice option ids come from the
`settingDefinitionId` (lowercase-concatenated). Accurate and unique, but not fully
human-labeled. **v1 plan:** resolve names/labels from the settings-catalog
definition metadata.

### Legacy device-config default noise
Older template-based profiles serialize every property, including unset defaults.
`"notConfigured"` is filtered, but other default values can still appear.
**v1 plan:** broader default-value suppression.

## Planned for v1

- **Combined/nested dynamic-group rule evaluation** (see above) — the headline item.
- **Delegated (user sign-in) auth** as an alternative to app-only, so an Intune
  Administrator can run it without a Global Admin granting app-permission consent.
- **Cross-platform overlap** accuracy (macOS/iOS/Android).
- **Effective-value resolution** — show which value "wins" for a conflicted setting.
- **Human-readable Settings Catalog** names/values via definition metadata.
- **Demo mode / sample data** so the tool can be evaluated without a tenant.
