import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "test/fixtures/generated/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Root-level config files aren't in tsconfig.json's `include`.
          allowDefaultProject: ["*.config.ts", "*.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The rule that matters most here: an un-awaited async renderFrame() in
      // the rAF loop is what let overlapping renders stomp shared GL state.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // WebGL/WebCodecs code legitimately reaches for `any` at the platform
      // boundary; warn so it stays visible without blocking CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Solid's `ref={el}` assigns through a compiler transform the rule can't
      // see, so every element ref reads as never-assigned.
      "no-unassigned-vars": "off",
    },
  },
  {
    // Config files and test helpers run in Node, not the browser.
    files: ["*.config.ts", "*.config.js", "test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      // `expect(obj.method)` on a vi.fn() is the normal assertion shape.
      "@typescript-eslint/unbound-method": "off",
    },
  },
);
