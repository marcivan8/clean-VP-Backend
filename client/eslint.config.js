import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // client/src/agent/ has hit the same bug three separate times:
    // EditPlanner.js, IntentParser.js, and AgentOrchestrator.js each shipped a
    // raw fetch() call with no Authorization header, which worked in dev (auth
    // isn't always required locally) and returned a silent 401 in production.
    // All three carry a "FIX: was fetch(...) without auth" comment — this rule
    // is what stops a fourth. Every request from this layer must go through
    // authFetch() (client/src/utils/authFetch.js), which attaches it.
    files: ['src/agent/**/*.{js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Use authFetch() from client/src/utils/authFetch.js instead of raw fetch() — a bare fetch() has no Authorization header and will 401 in production even though it works in dev. See EditPlanner.js/IntentParser.js/AgentOrchestrator.js for the bug this already caused three times.',
        },
        {
          selector: "CallExpression[callee.object.name=/^(window|globalThis)$/][callee.property.name='fetch']",
          message: 'Use authFetch() from client/src/utils/authFetch.js instead of window.fetch()/globalThis.fetch() — same rule as calling fetch() bare.',
        },
      ],
    },
  },
])
