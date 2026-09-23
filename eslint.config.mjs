import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Until v2.0.3 `npm run lint` was only `tsc --noEmit`, so nothing ever checked
 * the rules TypeScript doesn't: exhaustive effect dependencies above all. Two
 * `// eslint-disable-next-line react-hooks/exhaustive-deps` comments were sitting
 * in the app suppressing a rule that wasn't installed to begin with -- and the
 * bug that rule exists to catch is exactly the one that cost the simulator two
 * fixes (see endpointDevice.ts).
 */
export default tseslint.config(
  { ignores: ["**/dist/**", "**/dist-demo/**", "**/node_modules/**", "**/*.tsbuildinfo"] },

  // Every TypeScript file.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // The codebase marks deliberate unused bindings with a leading underscore
      // (and uses rest-destructuring to drop a field).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },

  // The web app: browser globals plus the React rules.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // An ERROR, not the plugin's default warning: a stale dependency array is
      // the exact failure mode that cost the simulator two bug fixes, so it
      // should fail the build rather than scroll past in the output.
      "react-hooks/exhaustive-deps": "error",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // The engine must stay free of server-only imports so it can run in the
  // browser for the public demo. packages/engine/src/purity.test.ts asserts the
  // same thing at test time; this is the version you see while you type.
  {
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "path", "os", "crypto", "http", "https", "dns", "child_process"],
              message:
                "The engine must stay I/O-free -- it runs in the browser for the public demo. Keep Node APIs in apps/server.",
            },
            {
              group: ["@azure/*", "dotenv", "fastify", "@fastify/*"],
              message: "Server-only dependency. The engine takes a TenantData; it never fetches one.",
            },
          ],
        },
      ],
    },
  },

  // Tests are allowed the Node APIs they need to inspect the source tree.
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "no-restricted-imports": "off" },
  }
);
