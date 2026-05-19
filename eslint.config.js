// SPDX-License-Identifier: Apache-2.0
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "dist-test/", "public/", "node_modules/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // We expose typed JSON-Schema results via TypeBox's Static<>; some
      // wrappers around node:sqlite use `any` deliberately. Tighten later.
      "@typescript-eslint/no-explicit-any": "off",
      // node:sqlite's prepare/run/all are dynamic — argument types are
      // intentionally loose. Don't fight it here.
      "@typescript-eslint/no-unsafe-function-type": "off",
      // CI invokes with --if-present; we want a non-zero exit only on
      // *real* problems, not stylistic ones.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["src/webapp/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        URL: "readonly",
        console: "readonly",
        Uint8Array: "readonly",
      },
    },
  },
  {
    files: ["src/test/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
  },
);
