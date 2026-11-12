import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

const simForbidden =
  "packages/sim and packages/bot must stay pure and deterministic (CLAUDE.md, SPEC §9.3, §13.1).";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    files: ["**/*.{js,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["apps/client/public/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ["apps/client/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Tests run with noUncheckedIndexedAccess; `!` on known fixture lookups keeps them readable.
    files: ["**/test/**/*.ts", "e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["packages/sim/src/**/*.ts", "packages/bot/src/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-globals": [
        "error",
        ...[
          "Date",
          "performance",
          "process",
          "window",
          "document",
          "setTimeout",
          "setInterval",
          "crypto",
          "require",
        ].map((name) => ({ name, message: simForbidden })),
      ],
      "no-restricted-properties": [
        "error",
        ...[
          "random",
          "sin",
          "cos",
          "tan",
          "asin",
          "acos",
          "atan",
          "atan2",
          "sqrt",
          "pow",
          "exp",
          "log",
          "hypot",
          "round",
        ].map((property) => ({ object: "Math", property, message: simForbidden })),
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ForInStatement",
          message: "Iterate sorted keys instead of for...in (SPEC §9.2).",
        },
      ],
    },
  },
);
