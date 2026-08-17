import { authFetch } from '../utils/authFetch.js';
export async function good() {
    const res = await authFetch('/api/ai/generate-plan', { method: 'POST' });
    return res.json();
}
