import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests target the pure, I/O-free core: assignment resolution, the
// assignment report, dynamic-rule implication, and the Graph normalizers.
// Alias the workspace packages to their SOURCE so tests don't depend on a prior
// build (and so a failure points at a .ts line, not into dist/).
export default defineConfig({
  resolve: {
    alias: {
      "@intune-preflight/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
      "@intune-preflight/engine": fileURLToPath(new URL("./packages/engine/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    environment: "node",
  },
});
