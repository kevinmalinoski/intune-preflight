# Contributing to Intune Preflight

Thanks for your interest! This is a **0.5 beta** — feedback, bug reports, and PRs are all welcome. See [ROADMAP.md](ROADMAP.md) for where things are headed.

## Reporting bugs

Open an issue using the bug report template. The single most useful thing you can include is the **server log** for the failure:

```bash
docker compose logs server      # Docker
# or the terminal output from `npm run dev`
```

⚠️ **Never paste secrets.** Redact `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` and any tenant identifiers.

## Dev setup

Requires Node.js 20+.

```bash
npm install
cp .env.example .env      # fill in your app registration values
npm run dev               # server :4000, web :5173
```

Before opening a PR, make sure it builds, typechecks, and tests pass:

```bash
npm run build
npm run lint
npm test
```

The core resolution logic (assignment include/exclude, the assignment report, dynamic-rule
implication, platform classification) is pure and unit-tested with [Vitest](https://vitest.dev).
If you touch that logic, please add or update a test — `npm run test:watch` while you work.

## Project layout

```
apps/server/      Fastify API — Graph auth, data fetch, simulation engine
apps/web/         React + Vite UI — endpoint simulator + drill-down panel
packages/shared/  TypeScript types + rule helpers shared by both apps
```

## Guidelines

- Keep the tool **read-only** — it must never write to a tenant. All Graph permissions stay `*.Read.All`.
- Match the surrounding code style; keep comments focused on the *why*.
- Note any new Graph permission requirement in the README.
- If you're changing rule-parsing or conflict/overlap logic, please describe how you tested it (a small reproduction against real rule shapes goes a long way).

## Code of conduct

Be kind and constructive. This is a community tool built to help fellow admins.
