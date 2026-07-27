# Security Policy

Intune Preflight is a **self-hosted, read-only** tool. It authenticates to Microsoft Graph with **application (app-only)** credentials you supply, and it never writes to your tenant. Even so, it handles a tenant-wide read credential, so security reports are taken seriously.

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

- **Credentials stay server-side.** `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` live in `.env`, are read only by the server, and are **never** sent to the browser. `.env*` is git-ignored — never commit it.
- **Read-only.** The app requests only `*.Read.All` Graph scopes and performs no writes. See the permissions table in the [README](README.md).
- **No data leaves your infrastructure.** Tenant data is fetched on demand, cached in memory, and served only to your own browser. There is no telemetry and no external calls beyond Microsoft Graph and Entra login.
- **You run it.** Deploy it somewhere only trusted admins can reach (it is an unauthenticated local/self-hosted app that deliberately exposes the whole tenant's configuration). Do not expose it to the public internet.

## In scope for reports

Credential handling/leakage, secrets reaching the client, SSRF, injection, dependency vulnerabilities with a practical exploit path, and anything that would let untrusted input exfiltrate tenant data.
