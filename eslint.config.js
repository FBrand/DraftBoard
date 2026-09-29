import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Every build output, not two of them by name. 'dist-fb', 'dist-fast',
  // 'dist-fb2' and 'dist-fb3' were all being linted: `eslint .` walked the
  // bundles and took longer than ten minutes, which is why the CI lint job
  // never came back.
  globalIgnores(['dist*', 'coverage', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // A leading underscore marks a binding kept on purpose — a positional
      // parameter a later one sits behind, a field destructured only to drop it.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  // Playwright specs and config run in Node, not the browser.
  {
    // Every playwright config by shape, not three of them by name:
    // playwright.phone.config.js was added later and never listed, so its
    // `process` reads were the one no-undef error in the repo.
    files: ['tests/**/*.js', 'playwright*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
