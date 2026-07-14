import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
    "src/app/sw.ts",
  ]),
  {
    rules: {
      // Standard fetch-on-mount effects call setState (setLoading) synchronously;
      // this new rule flags that legitimate pattern, so keep it advisory.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
