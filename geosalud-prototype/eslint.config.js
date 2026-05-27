import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "prototype/vendor/**",
      "prototype/data/**",
      "coverage/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: "error",
    },
  },
  {
    files: ["prototype/modules/**", "prototype/ui/**"],
    rules: {
      "no-magic-numbers": [
        "warn",
        {
          ignore: [0, 1, -1],
        },
      ],
    },
  },
];
