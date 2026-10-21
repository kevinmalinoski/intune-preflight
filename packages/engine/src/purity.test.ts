import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The engine must stay I/O-free. That isn't a style preference: the public demo
 * (`apps/web` built with VITE_STATIC_DEMO=1) runs this exact code in the
 * browser, so a single value import of a Node built-in or a server-only
 * dependency breaks the demo build.
 *
 * Before this package existed, the engine lived in `apps/server` next to the
 * Graph client and `process.env`, and the only thing keeping it pure was every
 * reference to the I/O layer happening to be an erased `import type`. This test
 * is what replaced that luck -- it fails here, with a filename, instead of
 * surfacing as a mysterious bundling error in a later demo deploy.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/** Packages and built-ins that would tie the engine to a server runtime. */
const FORBIDDEN = [
  /^node:/,
  /^(fs|path|url|os|crypto|http|https|net|dns|child_process|worker_threads|process)$/,
  /^@azure\//,
  /^dotenv$/,
  /^fastify$/,
  /^@fastify\//,
];

/**
 * An `import`/`export ... from "x"` statement, captured as (keyword, clause,
 * specifier). The clause is bounded by `[^;]*?` so a match cannot escape its own
 * statement: the previous version stripped type-only statements with
 * `[\s\S]*?`, which assumed every `import type` / `export type` carries a
 * `from`. A local alias like `export type Platform = "windows" | ...;` does not,
 * so the lazy scan ran on to the next unrelated `from "..."` and deleted
 * everything in between -- silently blinding the scan over the rest of the file.
 * It cost `baseline.ts` 481 unscanned characters, and the same bug let an
 * injected `node:fs` import pass unnoticed in the sibling graph package.
 */
const FROM_STATEMENT = /(?:^|\n)[ \t]*(import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;

/** A side-effect import -- `import "x";` -- which has no `from` clause but still loads x. */
const BARE_IMPORT = /(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g;

/** Every value (non-type-only) import/export specifier in a source file. */
function valueImports(source: string): string[] {
  const specifiers: string[] = [];
  for (const [, , clause, specifier] of source.matchAll(FROM_STATEMENT)) {
    // `import type {...}` / `export type {...}` erase at compile time. An inline
    // `{ type X }` specifier does not make the statement type-only -- the module
    // is still loaded at runtime.
    if (/^\s*type\s/.test(clause)) continue;
    specifiers.push(specifier);
  }
  for (const [, specifier] of source.matchAll(BARE_IMPORT)) specifiers.push(specifier);
  return specifiers;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

/**
 * The extractor gets its own tests because this guard previously failed OPEN --
 * the worst outcome for a test whose entire job is catching a regression, since
 * it reports green forever while the thing it guards quietly rots. These pin
 * what `valueImports` must and must not see.
 */
describe("valueImports", () => {
  it("finds a value import that sits BELOW a local type alias", () => {
    // The exact regression: the alias has no `from` clause of its own, so an
    // unbounded scan matched the import's `from` and swallowed everything between.
    const source = [
      'import type { Platform } from "@intune-preflight/shared";',
      "",
      'export type CspNode = "windows" | "macos";',
      "",
      'import { readFileSync } from "node:fs";',
    ].join("\n");
    expect(valueImports(source)).toEqual(["node:fs"]);
  });

  it("does not let an exported declaration swallow a later import", () => {
    const source = [
      "export function normalizeCspNode(raw: string): string {",
      "  return raw.toLowerCase();",
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
    ].join("\n");
    expect(valueImports(source)).toEqual([]);
  });

  it("reports a value import that merely carries an inline type specifier", () => {
    // `{ type Platform, flattenToCspSettings }` still loads the module at runtime.
    const source = 'import { type Platform, flattenToCspSettings } from "./normalize.js";';
    expect(valueImports(source)).toEqual(["./normalize.js"]);
  });

  it("reports a side-effect import, which has no from clause at all", () => {
    // The previous regex required a `from`, so this form was invisible to it.
    expect(valueImports('import "node:crypto";')).toEqual(["node:crypto"]);
  });

  it("reads no specifier out of a bare type alias", () => {
    expect(valueImports('export type CspNode = "windows" | "macos";')).toEqual([]);
  });
});

describe("engine purity", () => {
  const files = tsFiles(SRC);

  it("finds the engine sources to check", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))("%s imports nothing server-only", (_label, file) => {
    const offenders = valueImports(readFileSync(file, "utf8")).filter((spec) =>
      FORBIDDEN.some((pattern) => pattern.test(spec))
    );
    expect(offenders).toEqual([]);
  });

  it("declares no server-only dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(["@intune-preflight/shared"]);
  });
});
