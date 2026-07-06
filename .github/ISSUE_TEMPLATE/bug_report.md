---
name: Bug report
about: Something didn't work or the result looked wrong
title: ""
labels: bug
assignees: ""
---

**What happened**
A clear description of the problem, and what you expected instead.

**Steps to reproduce**
1. …
2. …

**Server logs**
The server output around the failure — this is usually the key to diagnosing it.
`docker compose logs server`, or the `npm run dev` terminal.

> ⚠️ Redact `TENANT_ID` / `CLIENT_ID` / `CLIENT_SECRET` and any tenant/device identifiers before pasting.

```
(paste logs here)
```

**How you're running it**
- [ ] Docker (`docker compose up`)
- [ ] npm (`npm run dev`)
- OS: (Windows / macOS / Linux)

**Tenant context (optional, redacted)**
Anything relevant about the policy/group/assignment involved — e.g. "two Windows Update rings on the same group", "a macOS custom profile", "a dynamic group with a combined rule". Screenshots welcome (redact real names).

**Anything else**
