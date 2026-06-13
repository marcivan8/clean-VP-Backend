import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Only upload source maps when SENTRY_AUTH_TOKEN is set (production CI builds).
  // In local dev and staging without the token the plugin is simply omitted.
  const sentryPlugin = (env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT)
    ? sentryVitePlugin({
        org:        env.SENTRY_ORG,
        project:    env.SENTRY_PROJECT,
        authToken:  env.SENTRY_AUTH_TOKEN,
        // Only upload source maps; don't delete the local .map files afterward
        // so other tools (e.g. Railway error pages) can still use them.
        sourcemaps: { filesToDeleteAfterUpload: [] },
        telemetry:  false,
      })
    : null

  return {
    plugins: [react(), sentryPlugin].filter(Boolean),

    build: {
      // Emit source maps so Sentry can show original TypeScript/JSX lines in errors.
      // 'hidden' means maps are generated but NOT referenced in the bundle (no
      // `//# sourceMappingURL=` comment), so end users never download them.
      sourcemap: 'hidden',
    },

    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
