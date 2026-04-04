/**
 * Client-side configuration
 * API_URL defaults to the backend origin; in dev the Vite proxy forwards /api → localhost:3000
 */
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export default { API_URL };
