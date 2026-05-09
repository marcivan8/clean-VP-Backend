/**
 * Client-side configuration
 *
 * In PRODUCTION: The React app is served by the same Express server on Railway.
 * All /api/* requests must use the same origin — so API_URL must be '' (empty string).
 * Never fall back to localhost in a production build, or requests will hit the user's
 * local machine and fail with ERR_CONNECTION_REFUSED.
 *
 * In DEVELOPMENT: Vite's proxy (vite.config.js) forwards /api → localhost:3000,
 * so '' (empty) also works here. We only use an explicit URL if the dev is running
 * against a remote backend.
 */
export const API_URL = import.meta.env.VITE_API_URL ?? '';

export default { API_URL };
