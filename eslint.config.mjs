import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      ".worktrees/**",
      ".factory/**",
      ".p*-proof/**",
    ],
  },
  {
    files: [
      "src/**/*.{ts,js,mjs,cjs}",
      "tests/**/*.{ts,js,mjs,cjs}",
      "*.{js,mjs,cjs}",
    ],
    rules: {
      curly: ["error", "all"],
      "one-var": ["error", "never"],
      "max-statements-per-line": ["error", { max: 1 }],
    },
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: { parser: tsParser },
  },
];
