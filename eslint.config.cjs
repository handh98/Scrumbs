const globals = require("globals");
const js = require("@eslint/js");
const prettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = [
  {
    ignores: [
      "node_modules/",
      "dist/",
      "out/",
      "build/",
      "**/*.db*",
      "**/*.min.js",
      "**/*.html",
      "**/*.css",
      ".git/",
      "package-lock.json",
      "src/renderer/assets/",
      ".eslintcache",
    ],
  },
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        $: "readonly",
        $$: "readonly",
        escAttr: "readonly",
        navigate: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": "warn",
      "no-console": "off",
      "no-undef": "warn",
      "prettier/prettier": [
        "error",
        {
          printWidth: 80,
          tabWidth: 2,
          semi: true,
          singleQuote: false,
          trailingComma: "all",
          bracketSpacing: true,
          arrowParens: "always",
          endOfLine: "auto",
        },
      ],
    },
  },
  prettierRecommended,
];
