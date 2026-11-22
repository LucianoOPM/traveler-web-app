// @ts-check
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintPluginAstro from "eslint-plugin-astro";
import jsxA11yX from "eslint-plugin-jsx-a11y-x";
import globals from "globals";
import tseslint from "typescript-eslint";

// Reglas no type-aware. No desactivar reglas globalmente: las excepciones son puntuales,
// con `// eslint-disable-next-line <regla> -- <motivo>`.
export default defineConfig([
  globalIgnores(["dist/", ".astro/", "node_modules/"]),
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  // Plantillas y frontmatter de `.astro`, con accesibilidad en nivel recommended.
  eslintPluginAstro.configs.recommended,
  eslintPluginAstro.configs["jsx-a11y-recommended"],
  // Accesibilidad en componentes React.
  {
    files: ["**/*.tsx"],
    extends: [jsxA11yX.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.mjs", "scripts/**/*.ts", "tests/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
]);
