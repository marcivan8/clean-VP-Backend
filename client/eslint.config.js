import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'test-zustand.js']),

  // ── Node config files (vite.config.js etc.) ───────────────────────────────
  {
    files: ['vite.config.js', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // ── Client source ──────────────────────────────────────────────────────────
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        // Vite replaces process.env.NODE_ENV at build time — allow in client code.
        process: 'readonly',
        // Some legacy agent files still use CommonJS require() patterns;
        // allow rather than touching 10+ files for now.
        require: 'readonly',
      },
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ── Errors (CI-blocking) ────────────────────────────────────────────
      // Duplicate object keys silently drop the first value — always a bug.
      'no-dupe-keys': 'error',

      // ── Warnings (visible in CI output, not blocking) ───────────────────
      // Style / cleanliness issues — fix gradually.
      'no-unused-vars':              ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-undef':                    'warn',   // agent files use require() / legacy globals
      'no-empty':                    'warn',
      'no-useless-catch':            'warn',
      'no-useless-escape':           'warn',
      'no-misleading-character-class': 'warn',
      'no-case-declarations':        'warn',

      // React-specific — important but pre-existing; fix in follow-up PRs.
      'react-hooks/rules-of-hooks':        'warn',
      'react-hooks/exhaustive-deps':       'warn',
      // react-hooks v7 added stricter rules; downgrade until codebase is migrated.
      'react-hooks/purity':                'warn',   // Date.now() / Math.random() in render
      'react-hooks/set-state-in-effect':   'warn',   // setState synchronously in useEffect
      'react-hooks/immutability':          'warn',   // variable accessed before declaration

      // react-refresh lint rules fire on files that export non-component things
      // (stores, hooks, utils). These are false positives for our architecture.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
