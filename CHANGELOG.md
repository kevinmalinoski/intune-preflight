# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.6.0] — 2026-10-29

The screen belongs to the data again. Status moved into the toolbar it was
describing, the picker gave its wasted column back to the groups list, and an
export can now cover what you are actually looking at.

### Added
- **Export the view, or the whole baseline.** Reading one configuration profile
  and clicking Export handed you the entire tenant's baseline. The menu now
  offers both, with the count of each, and defaults to what is on screen —
  someone who narrowed the view and then reached for Export was most likely
  asking for what they narrowed it to. The choice only appears when the two
  differ. Scope, view and search are all applied by one function the panel and
  all three builds share, so a filtered export is the same rows wherever it is
  produced, through the same serialiser as a full one.

### Changed
- **Status lives in the toolbar instead of above it.** The authentication
  banner is a lock that spins while the tenant loads, goes red if it failed,
  and opens on hover or a click for the signed-in account, the tenant, the
  Graph request count and End session — the identity still concealed until
  asked for. The compact-layout notice is one glyph, since what mattered in it
  was the switch. The tabs stop taking a row of their own on a narrow window.
  Measured on a phone: the diagram goes from 189px of an 812px window to
  633px — 23% of the screen to 78%.
- **Device filters are a dropdown, and the groups list has the width.** Filters
  were a third column that was usually empty, while the groups list — long
  names, the control people actually work in — was narrowed to pay for it. The
  closed dropdown names what is selected rather than only counting it: an
  exclude filter removes policies from the simulation outright, so a filter
  that is on while its control is shut has to stay legible.
- **The groups note moved above the list.** "All Devices & All Users always
  apply" sat under a long scrolling list, which is where it was least likely to
  be read.
- **Demo mode derives its CSP areas** through the same code a connected tenant
  runs, instead of carrying areas written into the sample data by hand.

### Fixed
- **Tapping a text field on iOS shifted the app up and left a blank strip
  behind.** Known since 2.3.0 and disclosed there as a document that could
  still scroll. It was not the document: it was Safari's own zoom. Safari
  zooms in on any form control it focuses whose font size is under 16px, and
  on blur it neither zooms back out nor undoes the scroll it did to lift the
  control above the keyboard — so the group search box, 12px like every other
  control, zoomed the page to 1.33× and scrolled it 282px, and that is where
  it stayed. Form controls now have a 16px floor on a touch pointer, and
  `<html>` and `<body>` say outright that the document does not scroll.

## [2.5.1] — 2026-10-28

The merged baseline's CSP areas say what they are. They are sorted, they carry
their real capitalisation, a mislabelled bucket of Microsoft Edge settings is
now called Microsoft Edge, and templates an admin uploaded are marked as such.

### Fixed
- **34 Microsoft Edge settings were filed under "Microsoft".** An ADMX setting
  carries its namespace before a literal `~policy~`, and that namespace can
  contain underscores — `microsoft_edge`. The area was read by splitting on `_`
  and taking the first segment, which stopped at `microsoft`: a vendor rather
  than a product, and a bucket any other `microsoft_*` namespace would have
  shared. Searching the baseline for what touches Edge would not have found it
  under E.
- **One product was scattered across five areas.** The same rule left
  OneDrive's namespace intact because it has no underscore, so `v2`,
  `v2.updates`, `v3`, `v4` and `v6` each became an area of their own — while
  thirteen Edge namespaces were being crushed into one. Vendors ship a new ADMX
  namespace per release rather than versioning in place, so the version suffix
  is now dropped and a product is one area.
- **Settings whose category Graph leaves empty are no longer dumped in a
  generic bucket.** Graph returns a null `categoryPath` on some uploaded-ADMX
  definitions — in one tenant, three of the six settings in a single Chrome
  policy, while the other three carried a full path. Those three sat under
  "Administrative Templates", saying nothing about what they configure. The
  category is resolved by id instead and reads "Google Chrome". If it cannot be
  read, the load records a warning and the old label is kept: a missing category
  is a worse name, not a missing setting.

### Changed
- **CSP areas are sorted A–Z.** They came out in the order the policies
  happened to be merged, which is an implementation detail rather than
  something a reader can use. Settings within an area keep their policy's own
  order, and the sort runs after the merge, so no finding changes.
- **Areas carry their real capitalisation.** `Applicationmanagement` reads
  "Application Management", `localusersandgroups` "Local Users And Groups",
  `sharedpc` "Shared PC", `onedrivengsc` "OneDriveNGSC". The name comes from
  the setting's own CSP path, which spells the area as Microsoft does — not
  from a list of friendlier names this project chose, which could claim an area
  is something it isn't. Where the path gives nothing clean, the old name is
  kept rather than guessed at.
- **Templates uploaded to the tenant are marked.** Third-party ADMX now reads
  "ADMX (Imported) Mozilla\\Firefox". An imported ADMX is a file somebody chose
  to add, so a setting under it that looks wrong may be fixed by re-uploading
  or removing the template — which is not true of anything Intune ships.
  Built-in templates are unprefixed.

## [2.5.0] — 2026-10-28

The diagram is readable on a phone. A policy type is a chip you tap to get its
policy names, and the view zooms to the policies instead of trying to fit the
whole graph into a screen that cannot hold it.

### Added
- **A policy type opens its policies in a pop-out, below `lg`.** Tapping a type
  on the diagram brings up its policies with their names wrapping in full —
  these run to sixty characters and the part that distinguishes one from
  another is almost always at the end, so a truncated name is not a name.
  Tapping a policy opens the merged baseline scoped to it, as before. The
  pop-out reads the layout's own data, so it and the diagram cannot disagree
  about which policies are of a type or how many settings they carry.

### Changed
- **A policy type is a chip below `lg`, not a 400px list.** The type bubble
  lists up to twelve policy names, which is right on a desktop canvas and
  unusable on a phone: the node was wider than the viewport and, for a Settings
  Catalog of thirteen, 421px tall. The chip carries what survives being small —
  colour, label, policy count, settings total — and the names moved to the
  pop-out. Unchanged at `lg` and up.
- **The narrow-window diagram aims at the policies rather than fitting the whole
  graph.** Fitting three columns totalling 1050px into a 375px canvas landed at
  27% zoom, rendering the nodes' 11px type at 3px. The view now goes to the
  policy column at up to full size, with the device and its groups off to the
  left where they have always been — the diagram still reads left to right, and
  panning left walks back along the flow. Measured on a phone-sized window:
  12.6px against 2.6px.
- **The merged-baseline rail is desktop-only.** Below `lg` it was a collapsed
  bar that opened a half-screen accordion of the baseline by CSP area, over the
  diagram — a fourth list on a phone, arriving from the bottom of the screen
  rather than from anything tapped, and grouped by an axis the diagram does not
  use. Reaching the baseline is now one path: a type, then a policy, then its
  settings, with a button on the canvas for the whole thing. The rail is
  untouched at `lg` and up.
- **The `.xlsx` export is described by what it is for.** The hint read "iPad
  included", which was the story of how the limitation was found rather than
  what it means when choosing a format; mobile Excel has the same constraint on
  any device.

### Fixed
- **Platform Scripts counted their own payload as settings.** A script's
  settings are `scriptContent`, `runAsAccount`, `enforceSignatureCheck` and the
  rest, read off the policy itself — the engine namespaces them per policy
  precisely so they never merge with anything, because scripts do not conflict
  the way a shared CSP setting does. Reporting "1 policy, 4 settings" counted a
  script's run options as though the device resolved them, reading as four
  times more policy than is there. A type of scripts now reports how many
  scripts, and each one reports "script config". The merged baseline's own
  total is unchanged.
- **The diagram stayed zoomed out after a panel was collapsed.** Collapsing the
  endpoint picker or the Policy Waitlist hands the diagram a few hundred more
  pixels, and it kept the zoom it was given while it was short — sitting small
  with empty space beneath it. It now re-aims whenever the canvas changes size.

## [2.4.0] — 2026-10-28

Exports can now be an Excel workbook, which is what finally opens on an iPad —
and the formats moved behind one menu rather than a button each.

### Added
- **Excel (`.xlsx`) export, alongside CSV and JSON.** Excel for iPadOS refuses
  the CSV exports as corrupted however correct the file is — mobile Excel has no
  Text Import wizard, so it declines a format whose delimiter, encoding and
  column types have to be inferred, and Microsoft's own compatibility table
  lists `.csv` on iOS as read-only at best. An `.xlsx` declares all three in a
  schema. Because the cells carry their type, values like `=SUM(A1)` and
  `2026-10-28` arrive as the text they are, without the quote prefix a CSV needs
  to stay safe from formula injection. Written in the engine with no new
  dependency, so the self-hosted, demo and live builds all produce the same
  bytes.

### Changed
- **One "Export ▾" menu in place of a button per format.** The merged baseline
  offers Excel, CSV and JSON; the Assignment Manifest offers Excel and CSV.
  Three buttons crowded a toolbar that already wraps at phone width.

## [2.3.3] — 2026-10-28

Exports download the same way everywhere, including on iPhone and iPad, where
they now land in Files › Downloads.

### Changed
- **Exports no longer use the iOS share sheet.** A Blob on a download link turns
  out to work on iOS and iPadOS perfectly well — Safari shows its own download
  prompt and the file goes to **Files › Downloads** — which makes the share
  sheet unnecessary, and worse than the thing it replaced: it asked where to put
  the file, so there was no predictable place to look for it afterwards. The
  original fault in 2.3.0 was specific to `data:` URLs, which Safari refuses to
  save; moving to a Blob was the whole fix, and routing iOS through
  `navigator.share` was a second change on top of a solved problem. That branch
  then leaked onto Windows, where sharing files is also supported, which is what
  2.3.2 had to patch. There is now one code path for every build and every
  platform, and no platform detection left to get wrong.

### Note
- Excel for iPadOS still refuses to open the CSV exports. The file is correct —
  it carries a UTF-8 BOM and CRLF endings, and opens in Excel on both macOS and
  Windows — so this is a limitation of Excel on that platform rather than a
  problem with the export. A native `.xlsx` export is the fix and is not in this
  release.

## [2.3.2] — 2026-10-28

A one-fix release. Exports download again on Windows.

### Fixed
- **On Windows, the CSV export opened the share dialog instead of downloading**,
  while the JSON export beside it downloaded normally. The code asked
  `navigator.canShare({ files })` — whether sharing a file is *possible* — and
  treated the answer as meaning the device could not download. Those coincide on
  iOS and diverge everywhere else: Windows has a native share sheet and Chrome
  and Edge expose it, so a desktop user clicking **Download CSV** got a share
  dialog. The split between the two formats is what made the cause legible —
  Chrome permits only certain file types to be shared, `text/csv` is on that
  list and `application/json` is not, so one export shared and the other
  downloaded on the same machine. The share sheet is now used on iOS and iPadOS
  only, which is the condition it was always meant to detect; everywhere else,
  including Windows machines with a touchscreen, gets an ordinary download.
  Introduced in 2.3.0.

## [2.3.1] — 2026-10-28

Follow-up to the same day's 2.3.0. Exports can be opened in Excel again, the
Policy Waitlist works at phone width, and the browser build no longer prints
who is signed in.

### Fixed
- **CSV exports could not be opened in Excel**, which reported them as
  corrupted while Quick Look displayed the same file perfectly. Nothing was
  wrong with the content — it was valid CSV and invalid Excel input. Two things
  were missing around it: a UTF-8 BOM, without which Excel guesses the encoding
  and the iPadOS version declines the file rather than guessing wrong visibly;
  and CRLF between records, which is what RFC 4180 specifies and which desktop
  Excel forgives but mobile Excel does not. Both now live in the engine, so the
  self-hosted, demo and browser builds cannot emit different bytes for the same
  export.
- **The Policy Waitlist was still built for a mouse.** Its expanded list was
  capped at 160px — about four rows on a phone — with tap targets under 30px,
  on a list whose entire purpose is ticking things. The cap is now 45vh below
  the breakpoint, the rows match the endpoint picker's, and the toolbar wraps so
  the search field gets its own row. Its summary line also says *which*
  policies are on the waitlist once any are, rather than only how many; the bar
  is collapsed by default, so that line is the only place the selection shows.

### Changed
- **The browser build no longer prints who is signed in.** The session bar used
  to read "Signed in as «name» («upn») · tenant «guid»", and it sits at the top
  of the window — so it appeared in every screenshot, demo and screen-share of
  that build. It now reads **Authenticated to tenant** behind a lock that opens
  to reveal the account and tenant id. Neither was ever a secret and both are
  one click away; what changes is that publishing them is a decision rather than
  the default. Ending the session, the read-only note and the Graph progress
  counter are unchanged.

## [2.3.0] — 2026-10-28

Intune Preflight now works on a phone, and the merged baseline sits beside the
diagram rather than on top of it. Two fixes to how disagreements between
policies are reported, one of which was telling admins a device was stuck when
it wasn't.

### Added
- **The app works on a small screen.** Opening the site on a phone previously
  gave you a full-screen "Built for a bigger screen" wall and nothing else — and
  underneath it the picker's three fixed-width columns overlapped each other at
  375px and the canvas was left about 180px. There is one breakpoint, 1023px,
  deliberately Tailwind's `lg` minus one so a component's classes and the
  JavaScript that branches on width cannot drift apart. The wall is now a thin
  banner with a **Use desktop layout** escape that lays the full console out at
  1280px so an iPad can pan and pinch-zoom the diagram.
- **The merged baseline is on screen with the diagram.** A 24rem rail at `lg`
  and up, a collapsible sheet below it. The baseline is the answer this tool
  exists to produce and reading it used to mean covering the thing that produced
  it — open the drawer, read it, close it, change a group, open it again. Tick a
  group now and the graph and the conflict count move together. The full panel
  is still one click away for the five-column grid, the exports and the column
  picker.
- **Focus mode**, on the ⛶ button: every picker and the app header hidden, the
  diagram given the whole window. It keeps exactly one control, the Group Tag,
  because it is the only one whose effect *is* the diagram — type a tag and the
  groups scoped to it are re-selected while you watch.
- **Both data tables have a card renderer below `lg`.** The merged baseline
  becomes an accordion of CSP areas carrying the counts and the
  conflict/overlap/legacy badges on the headers; the assignment manifest becomes
  one card per group with Direct/Inherited/Incl-Excl as a three-up strip, and
  sorting moves to a dropdown since there are no column headers left to click.
  Both read the same rows as the desktop renderers, so the two presentations
  cannot disagree about what is on screen.

### Fixed
- **Exports never saved on iPadOS.** The prompt appeared, you accepted it, and
  no file arrived. The browser-only builds have no backend to set a
  `Content-Disposition`, so both built the file as a `data:` URL on an anchor —
  and Safari does not honour `download` on a `data:` URL, so the click stopped
  being a download and became a navigation to a `data:` URL, which Safari blocks
  outright. Exports are now written from a Blob, and offered to the share sheet
  where the browser supports sharing files, because "Save to Files" is the path
  that actually lands a file on iPadOS. The self-hosted build was never
  affected.
- **A conflict card named a winner it could not know.** The compact card ranked
  its values WINS/ALSO, the first in emerald as "the one that applies". It was
  reading the order of the contributing policies, which is tenant load order and
  not an ordering at all — the merge has always documented that it "deliberately
  doesn't claim to know which value wins on the device". Every value now renders
  identically, with no ranking.

### Changed
- **A disagreement that Microsoft documents a resolution rule for is now
  reported as *layered*, not as a conflict.** A conflict in this tool means what
  Intune means by it: the device applies *neither* value until an admin resolves
  it. That label was being given to every disagreement whatever the policy type,
  and for several types it is a false alarm in the dangerous direction. Three
  Windows Feature Update profiles naming different versions were reported as a
  conflict, when Windows Update evaluates every applicable policy and offers the
  latest applicable version — nothing is stuck. The same applies to compliance
  policies (most restrictive applies), driver update profiles (approved wins)
  and quality update profiles (no rule documented at all). Update rings are
  deliberately unchanged: they genuinely *are* a conflict, with neither value set
  until it is resolved. A layered finding **states** the rule and never applies
  it — no winner is named, in the UI or in the JSON and API output.

## [2.2.1] — 2026-10-21

Follow-up to the same day's 2.2.0. The picker now lets you read any dynamic
group's membership rule, the site deploys its two app builds together so they
cannot drift apart, and the docs stop describing the tool as self-hosted.

### Added
- **Any dynamic group's membership rule can be read**, through a collapsed
  disclosure under the group name. It was previously shown only when the rule
  could not be fully decided, and every one of those triggers needs a Group Tag
  typed in or the Autopilot box ticked — so an untouched picker showed no rules
  at all. The demo looked more informative than a connected tenant only because
  its sample data contains more undecidable rules. Rules we cannot decide still
  open themselves, because there the rule is a warning rather than a detail.

### Fixed
- **A long membership rule was truncated at the panel edge**, which hid the
  `and` clauses on exactly the rules worth reading. It wraps now.
- **Two stale documentation anchors**, one of which predated this release.

### Changed
- **`/demo` and `/app` now deploy from the same tag, in one commit.** `/demo`
  has redeployed itself since v2.0.3; `/app` shipped by hand in 2.2.0 with no
  workflow, so the next tag would have refreshed one and left the other behind —
  two URLs on one site, the same application, quietly on different code. The
  workflow also refuses to publish a browser build compiled for the wrong base
  path, which would otherwise break every visitor's sign-in with `AADSTS50011`
  while looking perfectly healthy in CI.
- **The README and setup guide lead with what the browser build removes**, rather
  than opening on a choice between two ways to run it. Self-hosting is framed as
  the deliberate option it is: the only mode that sees a tenant unfiltered, and
  the answer when Conditional Access won't issue a token to a single-page app.

## [2.2.0] — 2026-10-21

Intune Preflight can now run **entirely in a browser tab**. An admin opens a URL,
signs in with their own account, and the page reads their tenant straight from
Microsoft Graph — no server, nothing installed, and **no client secret anywhere**,
because a single-page app is a public client and PKCE replaces the secret. The
tenant data lives in the tab and goes when it closes.

**Self-hosting is unchanged and stays fully supported.** The Fastify server, the
`.env` contract, the Docker images and app-only authentication are byte-identical
to v2.1. They remain the only way to get the complete, *unfiltered* view of a
tenant, because a delegated token is scoped to the signed-in admin's Intune RBAC —
which is narrower for a scoped admin. Browser mode is the easy way in; self-hosted
is the thorough one.

Nothing in the engine changed. This is a third way to *load* a tenant, not a new
way to reason about one — which is why it is 2.2 and not 3.0. The v3 bets on the
roadmap (combined dynamic-group rule evaluation, richer user modelling) are
untouched.

### Added
- **Browser (delegated-auth) data source.** A `build:live` bundle that signs in
  with MSAL, reads the tenant client-side through the same engine the server and
  the public demo use, and holds nothing on disk. Tenant and client ID persist in
  `localStorage` (neither is a secret); the token lives in `sessionStorage`, so
  closing the tab ends the session. A `?tenant=…&client=…` link self-configures
  the page, which suits consultants who carry one bookmark per client tenant.
- **`packages/graph`** — the Graph-reading layer, extracted from `apps/server` so
  it can run in either host. Its only injected dependency is
  `getToken: () => Promise<string>`: the server supplies an app-only MSAL-node
  token, the browser a delegated one. A `purity.test.ts` keeps it free of
  `node:*`, `process.env` and any reach back into `apps/server`.
- **First-run setup panel** in the browser build, with the exact redirect URI the
  build will send — the value Entra compares character for character.

### Fixed
- **Both purity tests could fail open**, which is the worst way for a guard to
  fail: it reports green forever while the boundary it protects rots. Type-only
  statements were stripped with an unbounded `[\s\S]*?`, which assumes every
  `import type` / `export type` carries a `from` clause. A local alias such as
  `export type TenantMode = "demo" | "connected";` does not, so the scan ran on to
  the next unrelated `from "…"` and deleted everything between — blinding the
  import check over the rest of the file. In `packages/engine` it had been quietly
  skipping 481 characters of `baseline.ts`. Statements are now bounded to
  themselves, side-effect imports (`import "x";`) are caught for the first time,
  and both extractors have tests of their own.
- **The header's Demo button did nothing in an unconfigured browser build.** The
  setup panel owned the dismissal flag, and `switchMode` returned early because an
  unconfigured build already reports `demo === true` — so of two controls offering
  the sample tenant, only the panel's own link worked.

### Changed
- The test suite went from 178 to 245.

## [2.1.0] — 2026-09-23

v2.1 is the release that makes v2 something you can leave alone. No new
capabilities — v2's feature set is complete and meant to stay that way (the
roadmap now separates remaining **v2 maintenance** from the **v3 bets**). What's
here is the structural, correctness and reliability work behind that promise,
plus the bugs a deliberate quality pass turned up: a browser setting that could
blank the page, a Graph response that could hang a tenant load, a filter that
under-reported, and a request size that a large tenant could genuinely hit.

The test suite went from 114 to 178, and now covers the three things that had
none: the whole documented API surface, the Graph retry loop, and the simulator's
state rules.

### Fixed
- **The "Legacy policies" baseline filter missed settings a legacy policy only
  co-configures.** The merged baseline carries one row per setting, and the view
  keyed off that row's single `sourceKind` — whichever contributing policy the
  merge happened to reach first. So a setting configured by *both* a Settings
  Catalog policy and a legacy Endpoint Security intent appeared under "Legacy
  policies only" only if the legacy one sorted first, and the count in the
  dropdown was wrong the same way. Both the filter and the count now key on
  **every** contributing policy — exactly the settings a migration needs to look
  at — and are derived from the same data, so they can no longer disagree.
- **A conflicted setting no longer reads as an effective value over the API.**
  For a setting two applied policies disagree on, the single merged `value` is
  whichever policy was reached first — not a computed winner. The UI and the CSV
  export already expanded conflicts to a row per value, but a consumer of
  `GET /api/simulate` or the JSON export saw one confident-looking value. Such a
  row now carries **`conflicted: true`**, pointing at the full disagreement in
  `conflicts`; it follows the same Windows-only gate as conflict detection, so
  the flag never points at a deliberately empty list. Documented in
  [docs/SETUP.md](docs/SETUP.md#reading-a-conflicted-setting-from-the-api).
  Deciding a winner stays deliberately out of scope — see "Considered and parked"
  in [ROADMAP.md](ROADMAP.md).
- **The merged-baseline panel is keyboard-usable.** It was a panel you could only
  leave with the mouse: no **Esc**, no focus management, nothing announcing it to
  a screen reader. Esc now backs out one level (a drill-down scope first, then the
  panel — matching the group policy list), focus moves into the panel on open and
  returns to whatever opened it on close, and it's labelled as a dialog. Not
  `aria-modal`, because it's a docked side panel and the diagram beside it stays
  usable.
- **`docker compose up` no longer 502s on the first page load.** `web` waited only
  for the server *container*, not for the API to answer; the server now has a
  healthcheck and `web` waits for it.

- **A browser with site data blocked no longer blanks the page.** Safari's "Block
  all cookies", Chrome's blocked-site-data setting and some enterprise policies
  make *every* `localStorage` access throw — reads included. The merged-baseline
  panel persists its width in a render effect with an unguarded write, so opening
  it threw, and with no error boundary React unmounted the whole app. Reproduced
  on the built demo (clicking "View merged baseline" left the page empty) and
  fixed: storage access is now guarded everywhere, and an **error boundary**
  catches anything else — showing the error, a Reload button and a link to report
  it, instead of a white screen.
- **A stalled Graph response body could hang a tenant load indefinitely.** `fetch`
  resolves when the headers arrive, and the per-request timeout was being cleared
  before the body was read — so a response that stalled mid-body had no timeout
  at all, pinning one of the eight concurrent workers. The body read now happens
  inside the timeout's scope and retries like any other dropped connection. Also
  fixes the load telemetry undercounting by one: the final failing attempt of a
  throttled request wasn't counted, and `graphGetCollection` could throw a
  `TypeError` on a 204 instead of returning an empty result.
- **Searching in the Assignment Manifest relabelled a checked group with its
  GUID.** The seating charts read group names from the search-filtered list while
  the selection bar shows every checked group, so filtering one out replaced its
  chart label (and its drill-down title) with the raw group id.
- **Very large selections no longer fail with a bare HTTP 431.** Group ids travel
  in the query string, so ~430 selected groups passed Node's 16KB header limit and
  the request was rejected before it reached the app. The limit is raised to 64KB
  — verified past 1,500 groups.

### Changed
- **The simulation engine is its own package (`packages/engine`).** It was living
  in `apps/server` next to the Graph client, and the web app reached into it
  sideways through a Vite alias and a file-wide `@ts-nocheck`. The engine is pure
  by design — that's what lets the identical code run behind the API *and* fully
  in the browser for the public demo — but nothing enforced it: `TenantData`, the
  engine's own input type, was declared inside the module that fetches it, and
  purity held only because every reference happened to be an erased `import type`.
  One value import would have broken the demo build with no warning. Now the
  boundary is a package dependency the compiler checks, and the guard is explicit
  three ways: a purity test that names the offending file, an ESLint rule while you
  type, and CI building the demo so the browser path is proven end to end. The
  alias, the custom Vite resolver plugin and the `@ts-nocheck` are all gone, so the
  in-browser API implementation is type-checked against the server's surface —
  drift between them is now a build error.
- **The simulator's state is one tested reducer** (`apps/web/src/endpointDevice.ts`).
  Six `useState`s and a chain of `useEffect`s reacting to each other became a pure
  function of state + action, which separates rules that must always hold
  (Autopilot is Windows-only) from effects belonging to one action (switching OS
  clears device filters). Both bugs that cascade shipped — StrictMode's
  double-invoked mount effect wiping filters seeded by a Manifest handoff, and the
  Autopilot rule silently stripping deliberately-selected groups — are now pinned
  by regression tests, and this state is unit-testable for the first time.
- **`npm run lint` actually lints.** It was `tsc --noEmit` alone; two
  `eslint-disable` comments were sitting in the app suppressing a rule that was
  never installed. ESLint is now configured (with `react-hooks/exhaustive-deps` as
  an **error**, since a stale dependency array is precisely what cost the simulator
  those two fixes) and Prettier formats the code — docs stay hand-wrapped and out
  of the formatter's reach. CI runs `lint`, `format:check`, `build`, `test` and the
  demo build.
- **Docker images are reproducible and slimmer.** Both Dockerfiles used
  `npm install` despite a committed lockfile, and shipped the whole build-time
  `node_modules` — TypeScript, tsx and all — into the runtime image. Now `npm ci`,
  a separate `--omit=dev` dependency stage, a non-root user, and Node **20** to
  match `.nvmrc` and CI (they said 22).
- Eight copies of the same copy-mutate-return Set-toggle closure became one helper
  (`apps/web/src/collections.ts`), and the shared policy-heat scale moved out of the
  component that draws it (`apps/web/src/policyHeat.ts`).

- The Manifest's per-group seating charts index their rows once instead of
  rescanning every assignment row per checked group on every render — this view
  re-renders on each keystroke in its own search box. The group picker had the
  same shape (classifying membership rules inside a sort comparator, so O(n log n)
  re-parses per keystroke) and now ranks each group once: 4.1ms → 0.6ms at 800
  groups.
- **The beta endpoint fallback only fires on 400/404 now.** It exists for the
  v1.0 "Resource not found for the segment" response, but caught every failure —
  so a 403 for a missing permission, or an outage, was quietly attempted twice
  and reported against the wrong URL.
- **`SimulationDiagram` is four files instead of one 972-line one**:
  `diagram/theme.ts` (the visual and layout vocabulary), `diagram/nodes.tsx`
  (the node components), `diagram/buildGraph.ts` (the layout engine) and the
  view itself. No behaviour change — verified against the built demo. The legend
  now derives its colours from the theme rather than repeating nine hex codes
  that could drift from the nodes they label.

### Added
- **The public demo deploys itself.** Publishing it to `gh-pages` was a manual
  step that followed from no source push, which is exactly why the live demo could
  silently lag a release — and it's both the project's front door and where
  CONTRIBUTING asks people to reproduce bugs. A workflow now builds and publishes
  it on a release tag (or on demand), touching only the `demo/` subtree so the
  landing page and screenshots are left alone.
- A favicon and a meta description on the app shell (inline SVG, so nothing 404s
  when the app is served from a sub-path like the demo's).

- **Tests for the whole documented API surface** — all ten endpoints in
  docs/SETUP.md, driven through Fastify's `inject()` with no socket and no Graph,
  against demo mode. They had none before, which is how the 431 ceiling above
  went unnoticed. The server is now `buildServer()` plus a seventeen-line entry
  point, so the routes can be imported without opening a port.
- An **invariants test suite** for the engine: properties checked over 400
  seeded-random endpoints (one baseline row per setting, `conflicted` always
  having a conflict to point at, nothing both applied and excluded, the CSV
  staying rectangular, determinism, monotonicity) rather than more examples.
- **Tests for the Graph retry loop** — the code that runs against a real tenant
  under throttling previously had none: 503-then-success, a 403 that must not
  retry, giving up after five attempts, `Retry-After` beating the backoff, a
  dropped connection, a body failing mid-stream, `@odata.nextLink` paging, 204.

### Docs
- **ROADMAP split into [v2 maintenance](ROADMAP.md#v2-maintenance) and
  [v3 bets](ROADMAP.md#v3-bets).** The forward-looking list read as six
  commitments led by the largest of them (a real dynamic-group rule
  parser). v2 maintenance is now explicitly the whole scope of the 2.x line, the
  rule parser is explicitly deferred — the "surfaced, not guessed" Group Tag work
  is what makes it an accuracy upgrade rather than a correctness prerequisite —
  and decisions already taken (effective-value resolution, group-collision
  analysis) are recorded as parked with their reasoning.
- CONTRIBUTING and SETUP document the engine boundary, the reducer pattern for UI
  state with rules, and the four commands CI runs. Folds in the CONTRIBUTING
  refresh that had been waiting for a release — it still called the project a
  "0.5 beta" and told contributors to configure an app registration before
  running anything, when no `.env` starts in Demo mode and needs no tenant.
- Removed an orphaned screenshot (`docs/simulator.png`) that nothing referenced.

## [2.0.2] — 2026-09-09

### Fixed
- **Diagram: the Autopilot enrollment cards no longer go wrong as you change the
  endpoint.** Toggling **Autopilot device**, entering a Group Tag, or selecting and
  deselecting groups could leave the enrollment stack visibly broken. Three causes,
  all fixed:
  - **Cards vanishing.** Clicking a group on the diagram to hide it set a flag that
    was never cleared when that group left the simulation. Hide a group, uncheck
    **Autopilot device**, check it again, and the group came back *still hidden* —
    silently swallowing both enrollment cards, with only the small "Show all groups"
    chip to explain where they went.
  - **The stack hopping on every toggle.** Card heights were estimated from character
    counts (~40 chars/line for the device card, a fixed row height per setting) and
    corrected after render by reading the DOM, so every rebuild painted the stack at
    the estimate and snapped back a frame later — around 13px of visible jump per
    click at real-tenant group-name lengths.
  - **Stale exclusion text.** Hiding the group that excluded a profile left the card
    still reading "Would not deploy — excluded via \<hidden group\>".

  The device card and its profile cards are now a single node laid out by the
  browser, each card carrying its own connection point so profiles still draw their
  own lines to the groups they target. Spacing is exact by construction rather than
  estimated and patched, exclusion is re-evaluated against the groups still shown
  (so hiding a group is a consistent "what if this group weren't here" lens), and
  the view refits when the set of nodes changes so newly added groups no longer
  land off-screen.

## [2.0.1] — 2026-09-06

### Added
- **Autopilot "+ conditions" surfacing in the group picker.** A dynamic group whose
  rule keys on Autopilot (a bare `[ZTDId]` clause) but ANDs it with a device
  condition the flat evaluator can't check — e.g. the common
  `… and (device.deviceModel -not -startsWith "Cloud PC")` (all Autopilot devices
  except Cloud PCs) — is no longer silently missed. When the **Autopilot device**
  toggle is on, it's surfaced with an `autopilot · + conditions` badge, its rule
  shown inline, and sorted to the top for one-click opt-in (not auto-selected, to
  avoid over-matching a condition that can't be evaluated). Cleanly-scoped `[ZTDId]`
  groups still auto-select as before. Mirrors the Group Tag "+ conditions" behavior.

### Fixed
- **Diagram: exact spacing for the device + enrollment stack.** The Autopilot
  enrollment cards under the "Configured Endpoint" node are now positioned from
  their real measured heights (via a ResizeObserver), so the gaps are always even
  regardless of how the device's group list wraps — fixing an overlap that could
  appear on some selections.

## [2.0.0] — 2026-09-03

A major release centered on **legacy policy handling**, **cross-model conflict
detection**, honest **dynamic-group (Group Tag)** surfacing, and a **public,
zero-backend demo**.

### Added
- **Cross-model conflict/overlap detection ("legacy policy collisions").** The
  same underlying CSP configured through *different* policy models — a legacy
  device-config template and a Settings Catalog policy, or an OMA-URI custom
  profile — used to slip past per-model detection entirely (`0 conflicts`, even
  though the device gets both). Settings now resolve a canonical `cspNode` — exact
  for Settings Catalog + OMA-URI via their real CSP path, and via a curated,
  Microsoft-docs-grounded template→CSP crosswalk for legacy templates — and any
  CSP touched by two models is surfaced as a collision (duplicate / conflict /
  verify) with a migrate-to-Settings-Catalog nudge. Best-effort over common
  settings, and labelled as such (a count next to conflicts/overlaps plus a
  "Legacy collisions" filter).
- **"Legacy template" flag.** The deprecated device-config *template* types
  Microsoft is migrating to the Settings Catalog (Device restrictions/features,
  Endpoint protection, Extensions) are flagged in the Assignment Manifest and the
  merged baseline, nudging a Settings Catalog migration. The still-current
  templates (certificates, VPN, Wi-Fi, email, wired network) are deliberately not
  flagged.
- **Real names, value labels and documentation links for legacy Endpoint Security
  intents.** Legacy intents' settings now resolve their true Intune display names
  and enum value labels from the template `settingDefinitions` (matching the
  Settings Catalog), plus direct Microsoft Learn links — instead of `definitionId`
  fragments and raw enum codes.
- **Group Tag match transparency in the group picker.** Each dynamic group is
  classified against the entered Group Tag: a confident `[OrderID]` match (badged,
  auto-selected); a **+ conditions** match whose rule *also* hinges on a property a
  tag can't decide (shown with the membership rule to verify); or a **conditional**
  reference the flat evaluator can't confirm (surfaced, not auto-selected). Each
  group's `[OrderID]` scope is shown inline, matches fade in, and the list sorts
  selected → matches → conditional → rest.
- **Public, zero-backend demo.** A static in-browser build runs the exact same
  engine over a bundled sample tenant — no server, nothing leaves the browser —
  hosted on GitHub Pages with a landing page, so the tool can be evaluated from a
  link. The demo tenant is grounded on the community Open Intune Baseline.
- **Small-screen notice** so phone visitors get a "built for a bigger screen"
  message instead of a broken dense layout.

### Changed
- **Only genuine security/baseline intents are labelled "(Legacy)".** Modern and
  migrated policies (which live in the Settings Catalog) can no longer be
  mislabelled as legacy Endpoint Security.
- **Legacy template default noise removed.** Fixed-schema template profiles
  (device restrictions/general, endpoint protection, compliance) serialize their
  *entire* schema; the unset defaults — `false` toggles and the `notConfigured` /
  `userDefined` / `deviceDefault` / `unavailable` sentinels — are now dropped for
  those types, so a profile contributes only what it actually configures (a Device
  Restrictions profile that blocks 9 things reports 9, not ~200). Types where a
  `false` is genuinely meaningful (e.g. an Update ring's `allowWindows11Upgrade`)
  are left untouched.
- **Group selector polish** — a cohesive tag-scope pill, muted structural chips,
  matched-row accent, and roomier list.
- **Autopilot enrollment stacks under the endpoint.** The V1/V2 enrollment cards
  now sit directly beneath the "Configured Endpoint" node as one device unit
  (device on top, its profiles below) instead of occupying a separate column
  between the device and the groups — the endpoint *is* what enrolls, so it reads
  as one thing that branches out to its groups. Every group hangs directly off the
  device, with each profile drawing its own line to the specific device group it
  targets.

### Fixed
- **Cross-model false positives on real tenants.** A complex/collection Settings
  Catalog setting expands into many sub-settings that all normalize to one CSP
  node within a single policy; the detector now requires two different policy
  *models* (not merely two setting ids), so intra-policy settings never fire.
- **Docker/type-check:** added the missing Vite client types so the web workspace
  type-checks cleanly with the static-demo build.

## [1.2.1] — 2026-08-04

### Fixed
- **Selecting an Autopilot-joined group in the Manifest now carries it into the
  simulation.** The simulator's "Autopilot device" effect stripped any
  Autopilot-joined dynamic group (a bare `[ZTDId]` rule, e.g. "Device - Windows -
  Autopilot") whenever Autopilot mode was off — which it is by default on a
  Manifest handoff — so the group was silently dropped from the simulated device.
  The effect now only *adds* Autopilot groups when the toggle is on; it never
  removes a group the user selected deliberately (removal on toggle-off is handled
  separately).

## [1.2.0] — 2026-08-04

### Added
- **Per-group "seating charts."** As you check groups in the Assignment Manifest,
  a strip above the selection bar shows each group's policies as a bubble cluster
  — cool = a policy unique to this group, hot = one shared across many groups —
  with a containment bar ("68% its own"). Click a chart to open the full named
  policy list — heat-colored chips, unique policies first, each naming the other
  groups that carry it. A preflight read on whether a group is siloed or
  overcrowded with borrowed policies, computed entirely from the data already loaded.
  A policy that is on **both All Devices/Users *and* a direct group** — an
  assignment Intune's portal disallows (it's either/or), so an anomaly that can
  only come from Graph/PowerShell — is flagged distinctly (indigo ⚠) instead of
  being counted as the group's own. Pairs with the bridge: eyeball the groups,
  then simulate them.
- **Manifest → Simulator bridge.** Check real Entra groups in the Assignment
  Manifest and hit **"Simulate a device in these groups"** to jump straight into
  the Endpoint Preflight simulator, seeded with exactly those groups — plus any
  device filters you were simulating in the Manifest — on the Manifest's current
  OS, as a fresh, ground-up merged baseline. A selection bar
  rises from the bottom when groups are checked; All Devices / All Users are
  shown as always-applies and included automatically rather than selected. Ties
  the tenant-wide "who carries what" view to the per-device "what does it get"
  view without merging the two screens.

### Fixed
- **`Assignments@odata.context` no longer appears as a setting.** Fetching
  policies with `$expand=assignments` makes Graph attach an OData annotation
  (`assignments@odata.context`, a URL) that the schema-agnostic flattener emitted
  as a bogus setting — most visible on compliance policies, which have few real
  settings. Any `@odata` annotation key is now skipped.

## [1.1.0] — 2026-08-03

### Added
- **Legacy Endpoint Security & Security Baselines** (the older
  `deviceManagement/intents` model) are now read into the baseline — legacy
  **BitLocker / Disk Encryption**, **Defender Antivirus**, **Firewall**, **Attack
  Surface Reduction**, Account Protection, and EDR intents. Each intent's
  template supplies its category (BitLocker, Firewall, …) and platform; its
  settings are normalized like any other policy, so they merge into the endpoint
  baseline, appear in the Assignment Manifest, and — being Windows — join
  conflict/overlap detection (two legacy BitLocker intents disagreeing on the
  cipher is now flagged). Shown under a new **Endpoint Security (Legacy)** policy
  type — in the diagram, the Policy Types legend, and the Assignment Manifest —
  with a **Legacy policies** filter in the merged-baseline view to isolate what
  the legacy intents contribute. Modern Endpoint Security policies already came
  through the Settings Catalog; this closes the gap for tenants still on the
  legacy intents. The demo tenant gains legacy BitLocker (org-wide + a corp
  override that conflicts), Defender Antivirus, and an unassigned Firewall intent.

### Fixed
- **Docker image no longer 502s on startup.** The shared package's entry point
  pointed at its TypeScript source (`./src/index.ts`), which dev tooling resolves
  but the compiled server in the slim runtime image cannot — the shared module
  failed to load at boot, the server never started, and every request returned
  502. The package now resolves to its built output (`./dist` via `main`/`types`/
  `exports`); `npm run dev` and `lint` build the shared package first so nothing
  regresses. No Dockerfile change was needed — both images already built and
  copied `packages/shared/dist`.

## [1.0.0] — 2026-07-20

First stable release. Everything below is relative to the 0.5 beta.

### Added
- **Richer demo tenant.** The bundled sample now includes an Open Intune
  Baseline–style Windows set (openintunebaseline.com naming: Defender Antivirus,
  ASR, BitLocker, a ~35-setting Security Baseline, Firewall, Windows Hello, LAPS,
  compliance policies, browser admin templates, an update ring) so Demo mode reads
  like a real hardened tenant — ~25 policies, ~120 merged settings, two genuine
  conflicts (Defender submit-samples and feature-update deferral) and several
  overlaps, plus a fuller Policy Waitlist. The macOS set draws on the macOS Open
  Intune Baseline (FileVault, Firewall & Gatekeeper, Software Update, compliance),
  with a second iOS and Android policy so every platform tab has substance. No
  configuration is copied verbatim.
- **Interactive assignment-filter simulation (Assignment Manifest)** — click an
  ⛃ assignment-filter chip (or the "Simulate device filters" toggles) to treat the
  simulated device as matching that filter. Every group recomputes live and
  cross-group: policies the filter drops move to a struck-through "Filtered" line
  showing why, and the applied counts update. Default (no filter matched) is the
  original broad view.
- **Sortable Assignment Manifest** — the per-group rollup is now plain sortable
  Direct / Inherited / Incl-Excl columns (default: most-directly-assigned first),
  replacing an abstract stacked bar whose inherited half was ~constant noise.
- **Autopilot enrollment layer** — Autopilot **V1** deployment profiles and **V2**
  device-preparation policies now appear as an intermediate stage between the
  configured endpoint and its Entra groups. Targeting is device-group based (V2 keys
  on its configured just-in-time device group, not the user assignment), exclusions
  are evaluated, and **dual targeting** (a V1 and V2 profile sharing one device group)
  is detected and shown. Cards are collapsed by default and expand to reveal the
  high-level deployment settings.
- **Merged baseline data grid** — resizable columns, an Intune-style column picker
  (show/hide), a readable **CSP path** column with a **Microsoft Learn** documentation
  link per setting, copy-to-clipboard, and chunked rendering for large tenants.
- **Human-readable Settings Catalog names and values** — setting names, and choice
  option values, are resolved from `settingDefinitions` ("Enabled" instead of a raw
  option id) rather than shown as concatenated definition ids.
- **Demo mode** — the app starts against a bundled synthetic sample tenant when no
  `.env` is present (no app registration needed), with a **Demo / Connected** header
  toggle that flips the data source at runtime.
- **Assignment Manifest** — a tenant-wide, per-OS view of which policies target which
  groups, with an in-app overlap summary (groups ranked by policy count), inherited
  All Devices / All Users and implied-membership rows (honoring "exclude wins"), and a
  CSV export.
- **Policy Waitlist** — pull otherwise-unassigned policies into a simulation to
  preview "what if I assigned this?", shown as a distinct "No assignment" bucket.
- Diagram: click a group to hide it and the policies it brings in; the layout reflows.
- Group-by-type is the default diagram layout, with a **Detail view** toggle for the
  per-policy view.
- Starter unit-test suite (Vitest) covering assignment resolution, the assignment
  report, dynamic-rule implication, Autopilot targeting, and Graph platform
  classification.
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, PR/issue templates, and this
  changelog.

### Changed
- **Diagram edge routing** — when Autopilot cards are present the endpoint connects
  only to the profile cards, and every Entra group (including the always-apply All
  Devices / All Users) hangs off the enrollment column: endpoint → profile → group →
  policies, with no duplicate lines crossing the Autopilot column.
- **Faster large-tenant loads** — per-policy Graph detail calls run with bounded
  concurrency and honor 429/503 `Retry-After`, cutting first-load time on 150+ policy
  tenants substantially.
- Consolidated the top bar (brand · view tabs · refresh) and removed redundant titles.
- Debounced the simulation request to remove lag when switching OS or editing groups.

### Changed
- **Autopilot-joined group detection now handles `or`, with operator precedence.**
  The "Autopilot device" toggle previously matched only a rule that was *nothing
  but* the bare `[ZTDId]` clause. In real tenants that clause is commonly a
  top-level `or` branch — often after a chain of `and` conditions. Since Entra
  binds `and` tighter than `or`, `A and B or ZTDId` means `(A and B) or ZTDId`,
  so an Autopilot device is a member via the ZTDId branch regardless of the `and`
  chain; those groups are now selected. The rule is split on top-level `or` only
  (never inside parentheses or quoted values), and a branch whose ZTDId clause is
  itself gated by `and` stays unselected — it would require a condition the
  evaluator can't check. Also accepts the paren-less and `-contains` clause
  shapes; a `[ZTDId]` pinned to a specific device still doesn't qualify.
- **~Half the Graph calls on load.** Policy assignments are now fetched inline with
  each collection via `$expand=assignments` instead of a per-policy round-trip,
  cutting a 141-policy tenant from ~368 to ~188 calls (a healthy load ~9s). Fewer
  calls also means less exposure to Graph's transient server errors. The load
  summary now logs call/retry/throttle telemetry so a slow load is diagnosable.

### Security
- **CSV exports are now formula-injection safe.** Cells beginning with `= + - @`
  (or a tab/CR) — which Excel/Sheets interpret as formulas — are prefixed with a
  single quote so a maliciously-named Intune policy or group can't execute when an
  admin opens an exported report. RFC-4180 quoting is unchanged.
- **Dependencies updated to clear all known advisories** (`npm audit`: 0
  vulnerabilities). Fixed transitive Fastify deps (`fast-uri`, `find-my-way`) and
  bumped `@azure/msal-node` to 5.x to drop a vulnerable `uuid`; the
  client-credentials auth flow was re-validated against a live tenant.

### Fixed
- **Unrelated groups no longer show as "implied by rule".** Implied-group
  detection reported an implication whenever the two rules shared *any single*
  clause, so two complex real-world rules that both happened to be scoped to
  `deviceOwnership -eq "Company"` implied each other — a Windows group surfaced a
  macOS group as implied, in both directions. Implication is now restricted to
  rules built solely from `devicePhysicalIds` clauses (where a Group Tag prefix
  relationship is genuinely provable); any rule mixing in another property claims
  no implication. Also requires *every* branch of an `or`-chain to imply, not just
  one — previously a group whose other branch didn't qualify was still reported.
- **Include vs exclude assignment filters now read correctly.** A policy dropped by
  an *include* filter (the device doesn't match the filter it's scoped to) was
  described with the same "excluded via device filter" wording as an *exclude*
  filter (the device matches) — the opposite reason. Every surface (merged
  baseline, diagram, manifest) now states the direction-correct reason and, for
  include filters, hints that selecting the filter under Device Filters simulates a
  match. The demo tenant gained an All Devices + include-filter policy to showcase
  it.
- **Reliable large-tenant loading — no more silently dropped policies.** The Graph
  client now retries gateway timeouts (502/503/504) and dropped connections in
  addition to throttling (429), with a per-request timeout so a wedged connection
  can't stall the whole load for minutes. Previously an unretried gateway timeout
  threw, and the failed policy (or whole category) was skipped silently. If a load
  still can't complete an item after retries, it's surfaced — a banner in the app
  and a summary in the server log — so a partial baseline is never silent.
- **macOS compliance no longer "hallucinates" settings.** A compliance policy's
  Graph resource is a fixed schema that serializes every field with its default,
  and the untouched defaults (`false` booleans, `deviceDefault` / `unavailable`
  enums) were leaking in as configured settings — and, across an OIB-style
  one-concern-per-policy layout, inventing conflicts. Compliance policies now
  contribute only the rules they actually enforce.
- **Conflict and overlap detection is now Windows-only** (previously just
  overlaps). Value-level comparison isn't trustworthy on other platforms yet, so
  both flags are suppressed off Windows; the merged baseline is still shown
  everywhere. See ROADMAP.md.
- Assignment Manifest now counts **applied** policies (direct + inherited) for its bar
  level, instead of conflating distinct direct targets with inherited includes.

## [0.5.0-beta] — 2026

Initial public beta.

### Added
- Endpoint simulator: pick an OS, Entra groups, Autopilot / Group Tag, and Assignment
  Filters, and see the merged CSP baseline with conflicts and overlaps.
- Group → policy → setting diagram (React Flow) with a drill-down merged-baseline panel
  and JSON/CSV export.
- Read-only Microsoft Graph client (app-only auth) with in-memory TTL caching, covering
  configuration profiles, compliance, Settings Catalog, Administrative Templates,
  platform scripts, Windows update profiles, Autopilot profiles, and Assignment Filters.
- Docker Compose and `npm run dev` setup; MIT licensed.

[Unreleased]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kevinmalinoski/intune-preflight/compare/v0.5.0-beta...v1.0.0
[0.5.0-beta]: https://github.com/kevinmalinoski/intune-preflight/releases/tag/v0.5.0-beta
