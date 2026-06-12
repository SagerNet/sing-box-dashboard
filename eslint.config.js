import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/gen"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // tsc (noUnusedLocals/noUnusedParameters) already enforces this.
      "@typescript-eslint/no-unused-vars": "off",
      // React Compiler readiness rules. This codebase deliberately mirrors
      // callbacks into refs during render (TerminalView, app/hooks.ts) so
      // live SSH sessions survive re-renders, and latches state in effects
      // (connection-lost takeover, optimistic pending values); both patterns
      // are intentional and documented at their use sites.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { console: "readonly", URL: "readonly", process: "readonly" },
    },
  },
);
