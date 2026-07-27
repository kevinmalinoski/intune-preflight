# Setup

Everything needed to point Intune Preflight at your own tenant. If you just want to try it, you don't need any of this — see **[demo mode](../README.md#try-it-in-30-seconds-demo-mode)**.

- [Requirements](#requirements)
- [Who can install this — required Entra roles](#who-can-install-this--required-entra-roles)
- [1. Create an Entra app registration](#1-create-an-entra-app-registration)
- [2. Configure](#2-configure)
- [3. Run](#3-run)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Node.js 20+** (for the npm path), or **Docker** (recommended for a real deployment)
- An **Entra app registration** with the read-only Graph permissions below
- A Microsoft 365 tenant with Intune

## Who can install this — required Entra roles

The app uses **application (app-only) permissions**, which require **admin consent**. Granting that consent is a privileged action:

- **Reading the data** afterwards only needs the read-only Graph scopes below — well within what an **Intune Administrator** can see.
- **Creating the app registration and granting admin consent** needs a higher role: **Global Administrator**, or **Privileged Role Administrator** / **Cloud Application Administrator** / **Application Administrator**.

So if you are *only* an Intune Administrator, you'll need a Global Admin (or one of the roles above) to create the app registration and click **Grant admin consent** once. After that, day-to-day use needs no elevated role.

## 1. Create an Entra app registration

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **Identity → Applications → App registrations → New registration**.
2. Name it something like `intune-preflight`, leave the redirect URI blank, click **Register**.
3. Under **API permissions → Add a permission → Microsoft Graph → Application permissions**, add:

   | Permission | Needed for | Required? |
   |---|---|---|
   | `DeviceManagementConfiguration.Read.All` | Configuration profiles, Compliance, Settings Catalog, Administrative Templates, Assignment Filters | **Required** |
   | `Group.Read.All` | Resolving group names and reading dynamic membership rules | **Required** |
   | `DeviceManagementServiceConfig.Read.All` | Windows Autopilot deployment profiles | Optional — skipped gracefully if omitted |
   | `DeviceManagementScripts.Read.All` | Platform Scripts (Windows PowerShell + macOS shell) | Optional — skipped gracefully if omitted |

4. Click **Grant admin consent** for your tenant (needs one of the roles noted above).
5. Under **Certificates & secrets → New client secret**, create a secret and copy its value immediately (it's only shown once).
6. Note your **Application (client) ID**, **Directory (tenant) ID**, and the **client secret** value.

Full reference: [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference).

> **Every permission is read-only.** The tool never writes to your tenant. See the [security notes](../README.md#security) before hosting it anywhere but your own machine.

## 2. Configure

Copy the example env file to `.env`:

```bash
# macOS / Linux
cp .env.example .env
```
```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```
```bat
:: Windows (Command Prompt)
copy .env.example .env
```

Fill in `TENANT_ID`, `CLIENT_ID`, and `CLIENT_SECRET` from step 1.

| Variable | Default | Purpose |
|---|---|---|
| `TENANT_ID` | — | Directory (tenant) ID |
| `CLIENT_ID` | — | Application (client) ID |
| `CLIENT_SECRET` | — | Client secret value |
| `PORT` | `4000` | API port |
| `CACHE_TTL_SECONDS` | `300` | How long tenant data is cached before a re-fetch |
| `CORS_ORIGIN` | `http://localhost:5173` | Override if serving the web UI from another host |

> On Windows, save `.env` with **LF** line endings and bare `KEY=value` (no quotes) so Docker reads the values cleanly.

With no `.env` present the app still starts — in **Demo** mode against bundled sample data.

## 3. Run

### Option A: Docker (recommended — closest to a real deployment)

```bash
docker compose up --build
```

- Web UI: http://localhost:8080

This builds and runs both the compiled API and the static web app — the same packaging anyone cloning the repo gets.

### Option B: npm (for local development, requires Node.js 20+)

```bash
npm install
npm run dev
```

- Web UI: http://localhost:5173 (dev server, with hot reload)
- API: http://localhost:4000 (the UI proxies `/api` calls here automatically)

`npm run dev` runs both processes together and reloads on every file change. To test the production build locally instead:

```bash
npm run build
npm start -w apps/server      # API
npm run preview -w apps/web   # static web build
```

### Verify

```bash
npm test        # unit tests
npm run lint    # typecheck
```

## Project layout

```
apps/server/      Fastify API — Graph auth, data fetch, simulation engine
apps/web/         React + Vite UI — endpoint simulator (React Flow) + drill-down panel
packages/shared/  TypeScript types + rule helpers shared by both apps
docs/             Documentation and screenshots
```

The server authenticates to Microsoft Graph using the app registration (client-credentials flow — no per-user sign-in), pulls every policy along with its assignments (included and excluded), the assignment filters, the Autopilot profiles, and the referenced security groups with their dynamic membership rules, then computes a merged baseline for whatever combination of groups / platform / filters you select. Results are cached in memory — there is intentionally **no database**.

## API reference

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness check, current mode, and any warnings from the last load |
| `GET /api/groups` | Security groups referenced by assignments, with policy/setting counts and membership rules |
| `GET /api/filters` | Intune Assignment Filters available in the tenant |
| `GET /api/unassigned?platform=windows` | Policies with no assignment (the Policy Waitlist) |
| `GET /api/simulate?groups=id1,id2&platform=windows&deviceFilterIds=id1,id2&unassigned=id3` | Simulated endpoint baseline |
| `GET /api/simulate/export?…&format=json\|csv` | Download the simulated baseline |
| `GET /api/reports/assignments?platform=windows` | Assignment Manifest data |
| `GET /api/reports/assignments/export?platform=windows&format=csv` | Download the manifest as CSV |
| `POST /api/mode` | Switch between `demo` and `connected` |
| `POST /api/refresh` | Clear the cache, re-fetch from Graph, and report any load warnings |

> Autopilot "device" and Group Tag selection are resolved in the web UI (they drive which group ids get sent in `groups`), so the API surface stays a simple "given these groups, compute the baseline."

## Troubleshooting

- **"Network error / network request failed" in the browser, and the groups never load.** The web app reached the server, but the server couldn't reach Microsoft. Check the server logs (`docker compose logs server`) for the real cause:
  - **`ClientAuthError: network_error` / `ENETUNREACH`** — the container has an IPv6 address but no working IPv6 route (common on Docker Desktop / WSL2), so the token call to `login.microsoftonline.com` fails. This repo already disables IPv6 in the container (`sysctls` in `docker-compose.yml`) and prefers IPv4 in the server, which fixes it. If you removed those, put them back.
  - **`ENOTFOUND` / DNS errors** — the container can't resolve names. Restart Docker Desktop, or run `wsl --shutdown` (Windows) and start it again.
- **A `403` in the logs after pointing at a new tenant** — the app registration's permissions were added but **admin consent wasn't granted** (or hasn't propagated yet, which can take several minutes). Confirm each permission shows **"Granted for &lt;tenant&gt;."**
- **An "Incomplete load" banner appears.** Something failed to import even after retries, so the baseline is missing data — the banner names what dropped and the server log has a summary. Usually a transient Graph error: click **Refresh from Intune**. If it persists, check the named policy in the admin center.
- **The first load is slow.** A cold load reads every policy and assignment in the tenant. It's cached afterwards (`CACHE_TTL_SECONDS`), so only the first request pays for it. The server logs a summary line with call counts and any throttling.
- **Docker CLI says `failed to connect to Docker API at npipe://…`** — Docker Desktop isn't running or hasn't finished starting. Launch it, wait for **"Engine running,"** and confirm with `docker version` (you want a **Server:** section).
- **Can't reach it from another device** (e.g. a tablet) even though `localhost` works — allow Docker through the **Private** profile in Windows Defender Firewall, and browse to `http://<host-ip>:8080`.
- **Changed `.env` but nothing changed** — recreate the container so it picks up the new values: `docker compose down` then `docker compose up --build`. On Windows, make sure `.env` uses **LF** line endings and bare `KEY=value` (no quotes).
