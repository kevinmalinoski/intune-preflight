# Setup

Everything needed to point Intune Preflight at your own tenant. If you only want to look
around, you need none of it — the [sample tenant](https://kevinmalinoski.github.io/intune-preflight/demo/)
needs no sign-in and no app registration.

**There are two setups here, and you only need one.**

| | What it costs you | Read this |
|---|---|---|
| **Browser** | one app registration, about 3 minutes. Nothing installed. | [Browser mode](#browser-mode--sign-in-as-yourself-no-backend), or the [walkthrough with a copy-paste script](https://kevinmalinoski.github.io/intune-preflight/connect/) |
| **Self-hosted** | an app registration with a client secret, plus Docker or Node on a host you run | [Requirements](#requirements) onward |

Browser mode is the faster path and reads your tenant as *you* — scope tags and all.
Self-hosting uses application credentials and is the only way to see a tenant unfiltered.
Both run the same engine.

- [Browser mode — sign in as yourself, no backend](#browser-mode--sign-in-as-yourself-no-backend)
- [Requirements](#requirements)
- [Who can install this — required Entra roles](#who-can-install-this--required-entra-roles)
- [1. Create an Entra app registration](#1-create-an-entra-app-registration)
- [2. Configure](#2-configure)
- [3. Run](#3-run)
- [Project layout](#project-layout)
- [API reference](#api-reference)
- [Troubleshooting](#troubleshooting)

## Requirements

These are the **self-hosted** requirements. Browser mode needs none of them — no Node, no
Docker, no host.

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

## Browser mode — sign in as yourself, no backend

There is a third way to run this: a static build that an Intune admin opens in a browser tab, signs
into with **their own** admin account, and which reads the tenant straight from Microsoft Graph. No
server, no Docker, nothing installed, and **no client secret anywhere** — a single-page app is a
*public* client, so PKCE replaces the secret. The session lives in the tab and goes when it closes.

This needs its own app registration, because the permissions are **delegated** (acting as the
signed-in user) rather than application-wide, and because a SPA redirect URI is a different kind
of registration.

### Quickest path — one script, about three minutes

Open [Azure Cloud Shell](https://shell.azure.com) and choose **PowerShell**. It already has the
Graph module and is already signed in as you, so there is nothing to install. Set `$redirectUri`
to the URL the build will be served from, then paste the whole block:

```powershell
Connect-MgGraph -Scopes "Application.ReadWrite.All"

$displayName = "Intune Preflight (browser)"
$redirectUri = "https://you.github.io/intune-preflight/app/"   # <- the exact URL, trailing slash and all

$wanted = @(
  "DeviceManagementConfiguration.Read.All",
  "Group.Read.All",
  "DeviceManagementServiceConfig.Read.All",
  "DeviceManagementScripts.Read.All"
)

$existing = Get-MgApplication -Filter "displayName eq '$displayName'" -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Already exists." -ForegroundColor Yellow
  Write-Host "TENANT_ID = $((Get-MgContext).TenantId)"
  Write-Host "CLIENT_ID = $($existing.AppId)"
} else {
  # Resolve the delegated scope IDs by name off the Graph service principal, rather
  # than hardcoding GUIDs that could be wrong or go stale.
  $graphSp = Get-MgServicePrincipal -Filter "appId eq '00000003-0000-0000-c000-000000000000'"
  $ids = $graphSp.Oauth2PermissionScopes | Where-Object { $wanted -contains $_.Value }

  $app = New-MgApplication -DisplayName $displayName `
    -SignInAudience "AzureADMyOrg" `
    -Spa @{ RedirectUris = @($redirectUri) } `
    -RequiredResourceAccess @(@{
        ResourceAppId  = $graphSp.AppId
        ResourceAccess = @($ids | ForEach-Object { @{ Id = $_.Id; Type = "Scope" } })
      })

  New-MgServicePrincipal -AppId $app.AppId | Out-Null
  Start-Sleep -Seconds 5   # let the service principal replicate

  $tenant  = (Get-MgContext).TenantId
  $encoded = [System.Uri]::EscapeDataString($redirectUri)

  Write-Host ""
  Write-Host "TENANT_ID = $tenant"
  Write-Host "CLIENT_ID = $($app.AppId)"
  Write-Host ""
  Write-Host "Now open this to grant consent:" -ForegroundColor Cyan
  Write-Host "https://login.microsoftonline.com/$tenant/adminconsent?client_id=$($app.AppId)&redirect_uri=$encoded"
}
```

Open the consent URL it prints, review the four permissions, and accept. The script deliberately
does **not** grant consent for you: consenting is the one step where an admin should see exactly
what they are approving, and granting it programmatically skips that screen.

After consent the browser lands back on your redirect URI with `?admin_consent=True`. If the app
is not deployed there yet you will get a connection error — that is fine, consent has already been
recorded by then.

Paste the two IDs into the app's first-run screen, or carry them in the URL as
`?tenant=…&client=…` to skip it.

**Setup is once per tenant, not once per admin.** One person creates the registration and consents
on behalf of the organisation; everyone else just needs the client ID.

### Or by hand, in the portal

1. **New registration** → under **Redirect URI**, choose **Single-page application (SPA)** and enter
   the URL the build will be served from, *exactly*. For a GitHub Pages deploy at
   `https://you.github.io/intune-preflight/app/` that is that whole string including the trailing
   slash — Entra compares it character for character, and a missing slash fails the sign-in with
   `AADSTS50011`.
2. Under **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, add the
   same four read-only scopes the server build uses:

   | Permission | Needed for |
   |---|---|
   | `DeviceManagementConfiguration.Read.All` | Configuration profiles, Compliance, Settings Catalog, Administrative Templates, Assignment Filters |
   | `Group.Read.All` | Resolving group names and reading dynamic membership rules |
   | `DeviceManagementServiceConfig.Read.All` | Windows Autopilot deployment profiles |
   | `DeviceManagementScripts.Read.All` | Platform Scripts (Windows PowerShell + macOS shell) |

3. Click **Grant admin consent** — all four require it even as delegated permissions.
4. **No client secret.** Don't create one; a public client cannot keep it, and this build has
   nowhere to put it.

To try it locally first, register `http://localhost:5173/` as a second SPA redirect URI and run:

```bash
npm run dev:live          # web :5173, no server needed
```

Then build it, pointing `--base` at the path it will be served from:

```bash
PREFLIGHT_LIVE_BASE=/intune-preflight/app/ npm run build:live   # -> apps/web/dist-live/
```

Serve `apps/web/dist-live/` as static files. On first visit the app asks for the **Directory (tenant)
ID** and **Application (client) ID** and remembers them in the browser. Neither is a secret, so they
can also be passed in the URL:

```
https://you.github.io/intune-preflight/app/?tenant=<tenant-id>&client=<client-id>
```

which self-configures the page — one bookmark per tenant, which is the point if you manage several.

If the deployed URL isn't `origin` + the `--base` path (a reverse proxy, say), set
`VITE_REDIRECT_URI` at build time to the exact string registered in Entra; otherwise it is derived
and you don't need it.

**What's different in browser mode:** permissions are delegated, so what the app can read is bounded
by what the signed-in admin can read — unlike the app-only server build, an admin scoped by RBAC
scope tags will see their slice rather than the whole tenant. Surfacing that boundary in the UI is
a planned follow-up; until then, read a browser-mode baseline as "what this admin can see".

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
apps/server/      Fastify API — app-only Graph auth, routes, config (the server shell)
apps/web/         React + Vite UI — endpoint simulator (React Flow) + drill-down panel
packages/graph/   The Graph reader — fetches a tenant into a TenantData, runs in Node AND the browser
packages/engine/  The simulation engine — pure, I/O-free, runs in Node AND the browser
packages/shared/  TypeScript types + rule helpers shared by everything
docs/             Documentation and screenshots
```

The **engine** is deliberately its own package. It takes a `TenantData` (the whole
tenant's configuration, already normalized) and computes baselines, conflicts and
reports from it — never fetching anything itself. That's what lets the identical
code run behind the API *and* entirely in the browser for the public demo. It
declares no server dependencies, and a test (`packages/engine/src/purity.test.ts`)
plus an ESLint rule fail the build if one creeps in.

The **Graph reader** is its own package for a related reason. It is the I/O, but it
does that I/O with `fetch` alone and takes its access token as an injected callback,
so the same fetching, retry and v1.0 → beta fallback code can run behind this server
with an app-only token or in a browser with a delegated one. `packages/graph` is
guarded the same way, by `packages/graph/src/purity.test.ts` and an ESLint rule.

The server authenticates to Microsoft Graph using the app registration (client-credentials flow — no per-user sign-in), pulls every policy along with its assignments (included and excluded), the assignment filters, the Autopilot profiles, and the referenced security groups with their dynamic membership rules, then computes a merged baseline for whatever combination of groups / platform / filters you select. Results are cached in memory — there is intentionally **no database**.

## API reference

| Endpoint | Description |
|---|---|
| `GET /api/health` | Liveness check, current mode, and any warnings from the last load |
| `GET /api/groups` | Security groups referenced by assignments, with policy/setting counts and membership rules |
| `GET /api/filters` | Intune Assignment Filters available in the tenant |
| `GET /api/unassigned?platform=windows` | Policies with no assignment (the Policy Waitlist) |
| `GET /api/simulate?groups=id1,id2&platform=windows&deviceFilterIds=id1,id2&unassigned=id3` | Simulated endpoint baseline |
| `GET /api/simulate/export?…&format=json\|csv\|xlsx` | Download the simulated baseline |
| `GET /api/reports/assignments?platform=windows` | Assignment Manifest data |
| `GET /api/reports/assignments/export?platform=windows&format=csv\|xlsx` | Download the manifest as CSV or as an Excel workbook |
| `POST /api/mode` | Switch between `demo` and `connected` |
| `POST /api/refresh` | Clear the cache, re-fetch from Graph, and report any load warnings |

> Autopilot "device" and Group Tag selection are resolved in the web UI (they drive which group ids get sent in `groups`), so the API surface stays a simple "given these groups, compute the baseline."

### Reading a conflicted setting from the API

`settings` in a simulation response carries **one row per setting**. When two
applied policies disagree on a value, that row is whichever policy the tenant
load reached first — **not** a computed winner; the tool deliberately doesn't
claim to know which value wins on the device. Such a row is marked
`"conflicted": true`, and the full disagreement is in `conflicts` under the same
`settingId`:

```jsonc
// GET /api/simulate?groups=…&platform=windows
{
  "settings": [
    { "settingId": "defender_cloudblocklevel", "value": "High", "conflicted": true, … }
  ],
  "conflicts": [
    {
      "settingId": "defender_cloudblocklevel",
      "values": [
        { "value": "High", "sourcePolicyName": "OIB — Defender Antivirus" },
        { "value": "Zero tolerance blocking level", "sourcePolicyName": "CORP — AV override" }
      ]
    }
  ]
}
```

So: **if `conflicted` is set, read `conflicts` rather than `value`.** The CSV
export needs no such care — it already writes one row per conflicting value with
a `Conflict` column. Conflict detection is Windows-only (see
[ROADMAP.md](../ROADMAP.md)), and `conflicted` follows the same gate, so the flag
never points at an intentionally empty `conflicts` list.

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
