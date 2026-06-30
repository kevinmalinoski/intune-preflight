# Intune Policy Baseline

**Intune Policy Sets, without Policy Sets.**

Intune makes you click into every Configuration Profile, Compliance Policy, Settings Catalog policy, and Administrative Template one at a time to see what's actually applied to a device group. This tool connects to your tenant, reads every policy and its assignments, and computes — automatically — the full merged CSP-level baseline for each device group. No manual Policy Set authoring required.

- 🗺️ **Interactive graph view** — device groups, assigned policies, and Windows 11 Autopilot deployment profiles laid out as a connected flow diagram
- 🔍 **Drill-down baseline** — click a group to see every CSP setting from every assigned policy, merged into one table, with conflicting settings flagged
- 📤 **Export** — JSON or CSV export of any group's full baseline
- 🪶 **Lightweight** — no database, no build pipeline beyond Vite/TypeScript, runs as two small Node processes (or two containers)

## How it works

```
Microsoft Graph  --->  apps/server (Fastify)  --->  apps/web (React + React Flow)
 (app-only auth)        in-memory cache              graph view + drill-down
                         baseline engine
```

The server authenticates to Microsoft Graph using an Azure AD **app registration** (client-credentials flow — no per-user sign-in needed), pulls every device configuration, compliance policy, Settings Catalog policy, and administrative template along with their group assignments, and computes a merged baseline per device group. Results are cached in memory for `CACHE_TTL_SECONDS` (default 5 minutes) — there is intentionally no database, to keep the app easy to run and reason about. `POST /api/refresh` clears the cache on demand.

## 1. Create an Azure AD app registration

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **Identity → Applications → App registrations → New registration**.
2. Name it something like `intune-policy-baseline`, leave redirect URI blank, click **Register**.
3. Under **API permissions → Add a permission → Microsoft Graph → Application permissions**, add:
   - `DeviceManagementConfiguration.Read.All`
   - `DeviceManagementManagedDevices.Read.All`
   - `Group.Read.All`
   - `Device.Read.All`
4. Click **Grant admin consent** for your tenant.
5. Under **Certificates & secrets → New client secret**, create a secret and copy its value immediately (it's only shown once).
6. Note your **Application (client) ID**, **Directory (tenant) ID**, and the **client secret** value.

Full reference: [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference).

## 2. Configure

```bash
cp .env.example .env
```

Fill in `TENANT_ID`, `CLIENT_ID`, and `CLIENT_SECRET` from step 1.

## 3. Run

### Option A: npm (requires Node.js 20+)

```bash
npm install
npm run dev
```

- Server: http://localhost:4000
- Web UI: http://localhost:5173

### Option B: Docker

```bash
docker compose up --build
```

- Web UI: http://localhost:8080

## Project layout

```
apps/server/    Fastify API — Graph auth, data fetch, baseline engine
apps/web/       React + Vite UI — graph view (React Flow) + drill-down panel
packages/shared/  TypeScript types shared by both apps
```

## API

| Endpoint | Description |
|---|---|
| `GET /api/groups` | Device groups with policy/setting/conflict counts |
| `GET /api/graph` | Nodes/edges for the visualizer |
| `GET /api/groups/:id/baseline` | Full merged CSP baseline + conflicts for a group |
| `GET /api/groups/:id/export?format=json\|csv` | Download the baseline |
| `POST /api/refresh` | Clear the in-memory cache and re-fetch from Graph |

## Notes & limitations

- **Read-only.** This tool never writes to your tenant — application permissions used are all `*.Read.All`.
- **In-memory cache, no database.** Data is re-fetched from Graph on first request after each cache expiry or server restart. If you need persistence across restarts or multiple instances, swap `apps/server/src/cache.ts` for Redis or SQLite.
- **Settings flattening is schema-agnostic.** Device Configuration and Compliance Policy settings are derived directly from each Graph resource's own properties rather than a hand-maintained CSP schema per profile type — this keeps the tool maintainable as Intune adds new policy types, at the cost of raw Graph field names showing up as setting names in some cases.
- Tested against a sandbox Microsoft 365 tenant. Always verify against the Intune admin center before relying on the computed baseline for compliance decisions.

## License

MIT — see [LICENSE](LICENSE).
