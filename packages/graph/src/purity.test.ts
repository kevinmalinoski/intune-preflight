import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * This package must stay browser-portable. It is the Graph *I/O* layer, so --
 * unlike `packages/engine` -- it is not pure; what it must not do is depend on a
 * server runtime. `graphFetch` uses only `fetch` and `AbortController`, both
 * native in Node 20+ and in the browser, and the two things that genuinely
 * differ between hosts come in as parameters: the access token and the cache.
 *
 * That is what lets the whole app eventually run in a browser tab against a
 * delegated (user sign-in) token with no backend at all. A single value import
 * of a Node built-in, a read of `process.env`, or a reach back into
 * `apps/server` would quietly take that away -- and it would surface as a
 * mysterious bundling error in a later browser build rather than here, with a
 * filename. Modelled on `packages/engine/src/purity.test.ts`, which guards the
 * engine's equivalent boundary.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/** Packages and built-ins that would tie this package to a server runtime. */
const FORBIDDEN = [
  /^node:/,
  /^(fs|path|url|os|crypto|http|https|net|dns|child_process|worker_threads|process)$/,
  /^@azure\//,
  /^dotenv$/,
  /^fastify$/,
  /^@fastify\//,
  // The server owns config, mode and the MSAL confidential client; this package
  // takes what it needs from them as arguments. Reaching back into apps/server
  // (or up out of the package) would reintroduce exactly the coupling the
  // extraction removed.
  /(^|\/)apps\/server(\/|$)/,
  /^\.\.\/\.\./,
];

/**
 * An `import`/`export` statement with a `from` clause, as [, keyword, clause,
 * specifier]. The clause is bounded by `[^;]` -- it may span lines, because a
 * multi-line import body contains no semicolon, but it can never run past the
 * end of its own statement.
 *
 * That bound is the whole point. The obvious `[\s\S]*?` instead lets a statement
 * with no `from` clause of its own -- a local `export type X = "a" | "b";` --
 * scan forward and match the NEXT statement's `from`, so stripping it removed a
 * real import further down the file. A `node:fs` import below the `TenantMode`
 * alias in intuneData.ts passed this test before the bound was added.
 */
const FROM_STATEMENT = /(?:^|\n)[ \t]*(import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;

/** A side-effect import -- `import "x";` -- which has no `from` clause but still loads x. */
const BARE_IMPORT = /(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g;

/**
 * Every value-import specifier in a source file. Type-only statements are
 * skipped: they erase at compile time and can never pull a runtime dependency
 * into the bundle.
 *
 * Statements are matched where they stand rather than stripped out first --
 * rewriting the source to remove type imports is what let one bad match delete
 * code it had nothing to do with. For the same reason comments are NOT stripped,
 * so an example import written in a doc comment fails this test loudly instead of
 * teaching the scan to skip things.
 */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const [, , clause, specifier] of source.matchAll(FROM_STATEMENT)) {
    // `import type {...}` / `export type {...}`. An inline `{ type X }` specifier
    // does not make the statement type-only -- the module is still loaded.
    if (/^\s*type\s/.test(clause)) continue;
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(BARE_IMPORT)) specifiers.push(specifier);
  return specifiers;
}

/**
 * Source with its comments removed. The `process.env` scan below is a text
 * match, so without this a doc comment *explaining* that this package reads no
 * `process.env` would fail the test it describes. (The `[^:]` guard keeps a
 * `https://` inside a string literal from reading as a line comment.)
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

/**
 * The extractor gets its own tests because this guard once failed OPEN: a real
 * `import { readFileSync } from "node:fs"` sat in intuneData.ts and all ten
 * tests passed, because the statement was deleted before it could be scanned. A
 * check that silently stops checking is worse than no check, so the cases below
 * pin what `valueImports` must and must not see.
 */
describe("valueImports", () => {
  it("finds a value import that sits BELOW a local type alias", () => {
    // The exact regression: the alias has no `from` clause of its own, so an
    // unbounded scan matched the import's `from` and swallowed both.
    const source = [
      'import type { TtlCache } from "./cache.js";',
      "",
      'export type TenantMode = "demo" | "connected";',
      "",
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    expect(valueImports(source)).toEqual(["node:fs"]);
  });

  it("does not let an exported declaration swallow a later import", () => {
    const source = [
      "export function skipReason(err: Error): string {",
      "  return err.message;",
      "}",
      "",
      'import { join } from "node:path";',
    ].join("\n");
    expect(valueImports(source)).toEqual(["node:path"]);
  });

  it("ignores type-only imports and re-exports, on one line or many", () => {
    const source = [
      'import type { Platform } from "@intune-preflight/shared";',
      'export type { TenantData } from "./tenantData.js";',
      "import type {",
      "  AssignmentFilter,",
      "  IntunePolicy,",
      '} from "node:fs";',
      "",
      'export type { GraphStats } from "./graphClient.js";',
    ].join("\n");
    expect(valueImports(source)).toEqual([]);
  });

  it("reports a value import that merely carries an inline type specifier", () => {
    // `{ type GraphClient, isGraphStatus }` still loads the module at runtime.
    const source = 'import { type GraphClient, isGraphStatus } from "./graphClient.js";';
    expect(valueImports(source)).toEqual(["./graphClient.js"]);
  });

  it("reports a side-effect import, which has no from clause at all", () => {
    expect(valueImports('import "node:crypto";')).toEqual(["node:crypto"]);
  });

  it("finds every specifier in a realistic header, in order", () => {
    const source = [
      'import type { IntunePolicy } from "@intune-preflight/shared";',
      'import { type GraphClient, mapWithConcurrency } from "./graphClient.js";',
      "import {",
      "  demoTenantData,",
      "  flattenToCspSettings,",
      '} from "@intune-preflight/engine";',
      'export type TenantMode = "demo" | "connected";',
    ].join("\n");
    expect(valueImports(source)).toEqual(["./graphClient.js", "@intune-preflight/engine"]);
  });

  it("reads no specifier out of a bare type alias", () => {
    expect(valueImports('export type TenantMode = "demo" | "connected";')).toEqual([]);
  });
});

describe("graph package portability", () => {
  const files = tsFiles(SRC);

  it("finds the sources to check", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s imports nothing server-only", (_label, file) => {
    const offenders = valueImports(readFileSync(file, "utf8")).filter((spec) =>
      FORBIDDEN.some((pattern) => pattern.test(spec))
    );
    expect(offenders).toEqual([]);
  });

  /**
   * `process.env` is the other way server-only configuration used to creep in:
   * the Graph client read `config` (and so `TENANT_ID` / `CLIENT_SECRET`)
   * directly, which is precisely what the injected `getToken` replaced. There is
   * no `process` in a browser, so a read would be a runtime TypeError there.
   */
  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s reads no process.env", (_label, file) => {
    expect(code(readFileSync(file, "utf8"))).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });

  it("declares no server-only dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@intune-preflight/engine", "@intune-preflight/shared"]);
  });
});
