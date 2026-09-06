import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// The static public demo (VITE_STATIC_DEMO=1) runs the server's PURE engine
// (baseline / demoTenant / the pure helpers in normalize) directly in the
// browser -- no backend. Those files use NodeNext ".js" import specifiers, so
// map a relative ".js" import to its ".ts" sibling when one exists. Harmless for
// the normal build, where the demo code is tree-shaken out entirely.
function resolveTsFromJs() {
  return {
    name: "resolve-ts-from-js",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (importer && source.startsWith(".") && source.endsWith(".js")) {
        const tsPath = resolvePath(dirname(importer), source).replace(/\.js$/, ".ts");
        if (existsSync(tsPath)) return tsPath;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [resolveTsFromJs(), react()],
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("../server/src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
