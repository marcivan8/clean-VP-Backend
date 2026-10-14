/**
 * client/src/services/stockMediaApi.js
 *
 * Client API wrapper for Pexels Stock Media search (Level 1).
 * Uses authFetch for authenticated backend requests.
 */

import { authFetch } from '../utils/authFetch.js';

export const stockMediaApi = {
    /**
     * Check if the stock media provider is configured on the backend.
     */
    async getStatus() {
        try {
            const res = await authFetch('/api/stock/status');
            if (!res.ok) return { configured: false, provider: 'pexels' };
            return await res.json();
        } catch (_) {
            return { configured: false, provider: 'pexels' };
        }
    },

    /**
     * Search stock media (videos or photos).
     *
     * @param {object} params
     * @param {string} params.query
     * @param {'video'|'photo'} [params.type='video']
     * @param {number} [params.page=1]
     * @param {number} [params.perPage=15]
     * @param {'landscape'|'portrait'|'square'} [params.orientation]
     * @returns {Promise<{ results: Array, totalResults: number, page: number, perPage: number, provider: string }>}
     */
    async search({ query, type = 'video', page = 1, perPage = 15, orientation }) {
        const params = new URLSearchParams({
            query: String(query || '').trim(),
            type,
            page: String(page),
            perPage: String(perPage),
        });
        if (orientation) params.set('orientation', orientation);

        const res = await authFetch(`/api/stock/search?${params.toString()}`);
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const err = new Error(errorData.error || `Stock search failed (${res.status})`);
            err.status = res.status;
            err.code = errorData.code;
            throw err;
        }

        return await res.json();
    },

    /**
     * Generate context-aware stock B-roll suggestions from transcript words (Level 2).
     *
     * @param {object} params
     * @param {Array} params.words
     * @param {Array} [params.chapters]
     * @param {number} [params.maxSuggestions=4]
     * @returns {Promise<{ suggestions: Array, totalFound: number, provider: string }>}
     */
    async suggestBroll({ words = [], chapters = [], maxSuggestions = 4 } = {}) {
        const res = await authFetch('/api/stock/suggest-broll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ words, chapters, maxSuggestions }),
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const err = new Error(errorData.error || `B-roll suggestion failed (${res.status})`);
            err.status = res.status;
            err.code = errorData.code;
            throw err;
        }

        return await res.json();
    },
};

export default stockMediaApi;
