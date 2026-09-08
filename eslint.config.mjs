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
    // Base44 backend functions run on Deno and are deployed separately from Next.js.
    "base44/**",
    // Downloaded raw site mirrors / research material (not app source):
    "reference/**",
    "www.shopify.com/**",
    "cdn.shopify.com/**",
    "apps.shopify.com/**",
    // Vendored Three.js Draco/Basis runtime decoders:
    "public/assets/3d/decoders/**",
    // Playwright output. Trace artifacts embed minified third-party bundles,
    // so leaving this unignored makes `npm run lint` pass or fail depending on
    // whether the last test run happened to leave artifacts on disk.
    "test-results/**",
    "playwright-report/**",
  ]),
]);

export default eslintConfig;
