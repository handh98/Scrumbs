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
      ".git/",
      "package-lock.json",
      "src/renderer/assets/",
      ".eslintcache"
    ],
  },
  // Base configuration for all JavaScript files
  {
    files: ["**/*.js", "**/*.cjs", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module", // Assuming modern JS files are modules
      globals: {
        ...globals.browser, // Browser global variables (e.g., window, document)
        ...globals.node, // Node.js global variables (e.g., process, require)
        $: "readonly", // Custom global variable $
        $$: "readonly", // Custom global variable $$
        escAttr: "readonly", // Custom global variable escAttr
        navigate: "readonly", // Custom global variable navigate
      },
    },
    rules: {
      // ESLint recommended rules (from @eslint/js)
      ...js.configs.recommended.rules,
      // Custom rules
      "no-unused-vars": "warn", // Warn about unused variables
      "no-console": "off", // Allow console.log
      "no-undef": "warn", // Warn about undefined variables
      // Prettier rule to enforce formatting, with specific options
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
  // Apply eslint-plugin-prettier's recommended configuration
  // This disables ESLint rules that conflict with Prettier and enables the "prettier/prettier" rule
  prettierRecommended,
];
