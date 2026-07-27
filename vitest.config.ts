import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests target the pure, I/O-free core: assignment resolution, the
// assignment report, dynamic-rule implication, and the Graph normalizers.
// Alias the shared package to its source so tests don't depend on a prior build.
export default defineConfig({
  resolve: {
    alias: {
      "@intune-preflight/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    environment: "node",
  },
});
