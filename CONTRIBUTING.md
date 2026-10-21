# Contributing to Intune Preflight

Thanks for your interest! Feedback, bug reports, and PRs are all welcome. See
[CHANGELOG.md](CHANGELOG.md) for what's shipped and [ROADMAP.md](ROADMAP.md) for where things
are headed.

## Reporting bugs

[Open an issue](https://github.com/kevinmalinoski/intune-preflight/issues/new/choose) using the
bug report template. Two things make a report easy to act on:

**Reproduce it in Demo mode if you can.** Demo mode runs the real engine over a bundled sample
tenant, so a repro there is one anyone can follow without access to your tenant — and it rules
out tenant-specific data as the cause. The [live demo](https://kevinmalinoski.github.io/intune-preflight/demo/)
works for this too; "select these groups, toggle that filter, this card is wrong" is a perfect
bug report.

**Include the server log** when the failure is in Graph fetching or auth:

```bash
docker compose logs server      # Docker
# or the terminal output from `npm run dev`
```

⚠️ **Never paste secrets.** Redact `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` and any tenant
identifiers. For security vulnerabilities, don't open an issue at all — see
[SECURITY.md](SECURITY.md).

## Dev setup

Requires Node.js 20+ (see [.nvmrc](.nvmrc)).

```bash
npm install
npm run dev               # server :4000, web :5173
```

**You don't need a tenant or an app registration to develop.** With no `.env` present the server
starts in **Demo** mode against the bundled sample tenant, which exercises every feature —
conflicts, overlaps, exclusions, Assignment Filters, dynamic Group Tag implication, unassigned
policies, and Autopilot V1 + V2. Most work can be done and tested entirely there.

To point it at a real tenant, add credentials and restart; the header's **Demo / Connected**
toggle unlocks once they're present:

```bash
cp .env.example .env      # fill in your app registration values
```

➡️ [Full setup guide — app registration, config, Docker](docs/SETUP.md)

Before opening a PR, make sure it builds, lints, formats and tests clean — the same four commands
CI runs:

```bash
npm run lint          # typecheck (tsc) + eslint
npm run format:check  # prettier, code only — docs are hand-wrapped and excluded
npm run build
npm test
```

`npm run lint:fix` and `npm run format` fix most of what those first two report.

## Tests

The engine is deliberately pure and unit-tested with [Vitest](https://vitest.dev) — assignment
resolution (include/exclude, filters, the assignment report), CSP normalization and the legacy
template → CSP crosswalk, cross-model conflict/overlap detection, dynamic-rule implication and
Group Tag / Autopilot rule evaluation, and platform classification. If you touch that logic,
please add or update a test — `npm run test:watch` while you work.

Rule parsing is where a test earns its keep most. The evaluator is **best-effort over the flat
clause shapes real tenants use**, not a full parser, so its tests double as the record of what is
and isn't claimed to work — if you extend it, the test is how that boundary moves.

Three test files exist to stop a specific regression rather than to check a feature, and are
worth reading before you touch what they guard: `packages/engine/src/purity.test.ts` (the
engine's browser-compatibility boundary), `packages/graph/src/purity.test.ts` (the same boundary
for the Graph reader) and `apps/web/src/endpointDevice.test.ts` (the simulator's state rules,
including the two bugs the old effect chain shipped).

## Project layout

```
apps/server/      Fastify API — app-only Graph auth, routes, config (the server shell)
apps/web/         React + Vite UI — endpoint simulator, assignment manifest, baseline drill-down
packages/graph/   The Graph reader — fetches a tenant into a TenantData, runs in Node AND the browser
packages/engine/  The simulation engine — pure, I/O-free, runs in Node AND the browser
packages/shared/  TypeScript types + rule helpers shared by everything
docs/             Setup guide, feature reference, screenshots
```

**The engine must stay I/O-free.** `packages/engine` takes a `TenantData` — the whole tenant's
configuration, already normalized — and computes everything from it, never fetching anything. That
is what lets the public demo (the same web app built with `VITE_STATIC_DEMO=1`) run the identical
code in the browser over the bundled sample tenant with no backend at all.

**`packages/graph` must stay browser-portable.** It *is* the I/O — it reads every
`deviceManagement` endpoint — but only over `fetch` and `AbortController`, which exist in Node and
in the browser alike. The two things that differ per host come in as parameters: the access token
(`createGraphClient({ getToken })`) and the cache the loaded tenant lives in. That is what will let
the whole app run in a tab against a delegated (user sign-in) token with no backend.

So: new analysis logic goes in `packages/engine`; new Graph reading goes in `packages/graph`; only
what genuinely needs the server — `process.env`, the MSAL confidential client, a request context —
goes in `apps/server`. A value import of a Node built-in or a server-only package from either
package fails its `purity.test.ts` and an ESLint rule, and CI also builds the demo
(`npm run build:demo`) so the browser path is proven end to end.

UI state that has *rules* — "this field resets that one", "turning this on selects those" — belongs
in a pure reducer next to its component rather than in a chain of `useEffect`s.
`apps/web/src/endpointDevice.ts` is the worked example and explains why; it's unit-tested like the
engine is.

## Guidelines

- Keep the tool **read-only** — it must never write to a tenant. All Graph permissions stay `*.Read.All`.
- Match the surrounding code style; keep comments focused on the *why*.
- Note any new Graph permission requirement in the README.
- Don't overclaim in the UI. Where analysis is heuristic — the rule evaluator, the cross-model
  crosswalk — say so in the interface rather than presenting a guess as fact.
- If you're changing rule-parsing or conflict/overlap logic, please describe how you tested it (a
  small reproduction against real rule shapes goes a long way).

## Code of conduct

Be kind and constructive. This is a community tool built to help fellow admins. See
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
