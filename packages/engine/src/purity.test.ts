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

/** Every `import ... from "x"` / `export ... from "x"` specifier, excluding type-only ones. */
function valueImports(source: string): string[] {
  // Strip type-only imports/exports -- they erase at compile time and can never
  // pull a runtime dependency into the bundle.
  const runtime = source
    .replace(/^\s*import\s+type\s[\s\S]*?from\s*["'][^"']+["'];?/gm, "")
    .replace(/^\s*export\s+type\s[\s\S]*?from\s*["'][^"']+["'];?/gm, "");
  return [...runtime.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [full] : [];
  });
}

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
