# Security Policy

Intune Preflight is **read-only** and never writes to your tenant. It ships in two shapes with
different security models, and the distinction matters:

- **Self-hosted** (`apps/server`) — authenticates with **application (app-only)** credentials you
  supply, and so handles a tenant-wide read credential. **It has no authentication of its own.**
- **Browser** (the static `build:live` bundle) — no server and no secret; the admin signs in
  themselves and the token is bounded by their own Intune RBAC.

Security reports are taken seriously for both. Please say which one you are reporting against.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's **[Private vulnerability reporting](https://github.com/kevinmalinoski/intune-preflight/security/advisories/new)** ("Report a vulnerability" under the repository's *Security* tab). Include:

- what the issue is and its impact,
- steps to reproduce (redact any real tenant identifiers or secrets),
- affected version / commit.

You'll get an acknowledgement as soon as possible. Once a fix is available, we'll coordinate disclosure.

## Supported versions

This is pre-1.0 software. Security fixes land on `main` and the latest release; older tagged releases are not separately patched.

## Security model & expectations

- **Read-only.** Both builds request only `*.Read.All` Graph scopes and perform no writes. See the permissions table in the [README](README.md).
- **No telemetry, either way.** There are no external calls beyond Microsoft Graph and Entra login.

### Self-hosted server

- **Credentials stay server-side.** `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` live in `.env`, are read only by the server, and are **never** sent to the browser. `.env*` is git-ignored — never commit it.
- **No data leaves your infrastructure.** Tenant data is fetched on demand, cached in memory, and served only to your own browser.
- **It is unauthenticated, and that has not changed.** Deploy it somewhere only trusted admins can reach, and **do not expose it to the public internet.** The sign-in added in 2.2 belongs to the *browser* build; it gives the server nothing. Anyone who can reach the server's port can read the whole tenant's configuration without presenting a credential.
- **App-only means unfiltered.** It deliberately sees the entire tenant, unscoped by scope tags or admin units, which makes the app registration effectively a tenant-wide read key. Grant only the listed permissions and rotate the secret periodically.

### Browser build

- **There is no secret to protect.** A single-page app is a public client; PKCE replaces the client secret. The tenant and client IDs it keeps in `localStorage` appear in every sign-in URL and are not secrets.
- **The session is the tab.** The access token lives in `sessionStorage` and goes when the tab closes; a SPA refresh token is capped at 24 hours and cannot be extended. Tenant data is held in memory only and is never written to disk.
- **It is bounded by the signed-in admin.** Permissions are delegated, so the page can read only what that admin could already read — including their Intune RBAC scope tags — and every read is attributable to them in your sign-in logs.
- **It is designed to be hosted publicly.** That is the difference from the server build. It still requires an app registration you control and an admin consent you grant.

## In scope for reports

Credential handling/leakage, secrets reaching the client, SSRF, injection, dependency vulnerabilities with a practical exploit path, and anything that would let untrusted input exfiltrate tenant data.
