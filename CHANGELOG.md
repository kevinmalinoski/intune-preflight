# Changelog

## v0.6.0 — Human-Readable Settings Catalog (2026-07-08)

### What changed

Settings Catalog settings and their choice values now display human-readable
English labels instead of the raw lowercase-concatenated `settingDefinitionId`
strings.

**Before:**
| Setting | Value |
|---------|-------|
| `device_vendor_msft_policy_config_update_configuredeadlineforqualityupdates` | `3` |
| `device_vendor_msft_policy_config_connectivity_allowvpnovermeterednetworks` | `1` |

**After:**
| Setting | Value |
|---------|-------|
| Configure Deadline for Quality Updates | Allow (3 weeks) |
| Allow VPN over Metered Networks | Enabled |

### How it works

On startup (and on every cache refresh), the server fetches Settings Catalog
definition metadata from the Microsoft Graph beta endpoint:

```
GET /beta/deviceManagement/configurationSettings
```

Each definition object provides:
- `displayName` — the human-readable setting name
- `options[].itemId` / `options[].displayName` — choice value ID → label mapping

These definitions are cached alongside policies (same TTL, default 300 s) and
threaded through the normalization pipeline. If a definition cannot be found for
a setting — or if the definitions fetch fails entirely — the previous
heuristic-parsed names are used as a graceful fallback. Nothing breaks; you just
get the old-style labels instead.

### Files changed

| File | Change |
|------|--------|
| `packages/shared/src/index.ts` | Added `OptionDefinition` and `SettingCatalogDefinition` TypeScript interfaces |
| `apps/server/src/intuneData.ts` | Added `fetchSettingsCatalogDefinitions()`, added `settingsCatalogDefinitions` to `TenantData`, updated `loadTenantData()` to fetch definitions before normalizing policies |
| `apps/server/src/normalize.ts` | Updated `flattenSettingsCatalogEntries()` to accept definitions, added `catalogOptionLabelMap()` helper, resolution prefers definition labels with heuristic fallback |

### No new permissions required

The endpoint is covered by the existing `DeviceManagementConfiguration.Read.All`
permission. No app registration changes needed.

### Commits

- `7e98580` Add SettingCatalogDefinition and OptionDefinition types
- `cf35a32` Add fetchSettingsCatalogDefinitions with caching and Graph beta fallback
- `4d78c17` Use Settings Catalog definitions for human-readable labels
- `35d26af` Phase 4-5: Wire definitions through full pipeline for human-readable labels

---

## v0.5.0 — Initial beta

First public release. See README.md for full feature list.
