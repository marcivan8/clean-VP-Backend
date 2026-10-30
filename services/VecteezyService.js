'use strict';

/**
 * services/VecteezyService.js
 *
 * Server-side Vecteezy Stock Media Provider for VIBED.
 *
 * Implements Stock Media Search via official Vecteezy v2 API:
 *   - Video and photo search against https://api.vecteezy.com/v2/{account_id}/resources
 *   - Strict server-side API key and account management (never exposed to client)
 *   - In-memory bounded TTL cache to prevent rate-limit exhaustion
 *   - Normalization into VIBED's native asset data model
 *   - Preserves Vecteezy creator attribution
 */

const VECTEEZY_API_BASE = 'https://api.vecteezy.com';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_CACHE_ENTRIES = 120;

// Simple in-memory bounded LRU/TTL cache
class MemoryCache {
    constructor(maxEntries = MAX_CACHE_ENTRIES, ttlMs = CACHE_TTL_MS) {
        this.maxEntries = maxEntries;
        this.ttlMs = ttlMs;
        this.store = new Map();
    }

    get(key) {
        const item = this.store.get(key);
        if (!item) return null;
        if (Date.now() > item.expiresAt) {
            this.store.delete(key);
            return null;
        }
        // Refresh position in Map for LRU
        this.store.delete(key);
        this.store.set(key, item);
        return item.value;
    }

    set(key, value) {
        if (this.store.has(key)) {
            this.store.delete(key);
        } else if (this.store.size >= this.maxEntries) {
            const oldestKey = this.store.keys().next().value;
            this.store.delete(oldestKey);
        }
        this.store.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }

    clear() {
        this.store.clear();
    }
}

const searchCache = new MemoryCache();

/**
 * Derives a clean human-readable name from a Vecteezy resource.
 */
function deriveResourceName(resource, fallbackType = 'Media') {
    if (!resource) return `Vecteezy ${fallbackType}`;
    if (typeof resource.title === 'string' && resource.title.trim().length > 0) {
        const cleaned = resource.title.trim();
        return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    return `Vecteezy ${fallbackType} ${resource.id || ''}`.trim();
}

/**
 * Normalizes a raw Vecteezy video resource into VIBED's asset schema.
 */
function normalizeVideoAsset(resource) {
    const resolvedUrl = resource.preview_url
        || resource.thumbnail_2x_url
        || resource.thumbnail_url
        || '';
    const thumbnail = resource.thumbnail_2x_url
        || resource.thumbnail_url
        || resource.preview_url
        || null;
    const dims = resource.dimensions
        || resource.preview_dimensions
        || resource.thumbnail_dimensions
        || null;
    const resolution = dims?.width && dims?.height
        ? { w: dims.width, h: dims.height }
        : null;

    const duration = Number(resource.duration) || 10;

    return {
        id: `vecteezy-video-${resource.id}`,
        name: deriveResourceName(resource, 'Video'),
        type: 'video',
        url: resolvedUrl,
        sourceUrl: resolvedUrl,
        proxyUrl: resolvedUrl,
        thumbnail,
        duration,
        sourceDuration: duration,
        resolution,
        provider: 'vecteezy',
        providerId: String(resource.id),
        attribution: {
            provider: 'vecteezy',
            providerUrl: resource.preview_url || 'https://www.vecteezy.com',
            photographer: 'Vecteezy Contributor',
            photographerUrl: 'https://www.vecteezy.com',
        },
        availableFiles: (resource.file_metadata?.available_download_sizes || []).map(s => ({
            id: s.id,
            quality: s.id,
            width: s.width,
            height: s.height,
            link: resolvedUrl,
        })),
    };
}

/**
 * Normalizes a raw Vecteezy photo resource into VIBED's asset schema.
 */
function normalizePhotoAsset(resource) {
    const resolvedUrl = resource.preview_url
        || resource.thumbnail_2x_url
        || resource.thumbnail_url
        || '';
    const thumbnail = resource.thumbnail_2x_url
        || resource.thumbnail_url
        || resolvedUrl;
    const dims = resource.dimensions
        || resource.preview_dimensions
        || resource.thumbnail_dimensions
        || null;
    const resolution = dims?.width && dims?.height
        ? { w: dims.width, h: dims.height }
        : null;

    return {
        id: `vecteezy-photo-${resource.id}`,
        name: deriveResourceName(resource, 'Photo'),
        type: 'image',
        url: resolvedUrl,
        sourceUrl: resolvedUrl,
        proxyUrl: resolvedUrl,
        thumbnail,
        duration: 5,
        sourceDuration: 5,
        resolution,
        provider: 'vecteezy',
        providerId: String(resource.id),
        attribution: {
            provider: 'vecteezy',
            providerUrl: resource.preview_url || 'https://www.vecteezy.com',
            photographer: 'Vecteezy Contributor',
            photographerUrl: 'https://www.vecteezy.com',
        },
    };
}


/**
 * Normalizes a raw Vecteezy vector/illustration resource into VIBED's asset
 * schema. Vectors are static (no inherent duration, like a photo), but are
 * flagged `style: 'vector'` / `isVector: true` so callers building a
 * cartoonish-style assembly (R132) can tell them apart from photographic
 * stock without inspecting the file itself.
 */
function normalizeVectorAsset(resource) {
    const resolvedUrl = resource.preview_url
        || resource.thumbnail_2x_url
        || resource.thumbnail_url
        || '';
    const thumbnail = resource.thumbnail_2x_url
        || resource.thumbnail_url
        || resolvedUrl;
    const dims = resource.dimensions
        || resource.preview_dimensions
        || resource.thumbnail_dimensions
        || null;
    const resolution = dims?.width && dims?.height
        ? { w: dims.width, h: dims.height }
        : null;

    return {
        id: `vecteezy-vector-${resource.id}`,
        name: deriveResourceName(resource, 'Vector'),
        type: 'image',
        style: 'vector',
        isVector: true,
        url: resolvedUrl,
        sourceUrl: resolvedUrl,
        proxyUrl: resolvedUrl,
        thumbnail,
        duration: 5,
        sourceDuration: 5,
        resolution,
        provider: 'vecteezy',
        providerId: String(resource.id),
        attribution: {
            provider: 'vecteezy',
            providerUrl: resource.preview_url || 'https://www.vecteezy.com',
            photographer: 'Vecteezy Contributor',
            photographerUrl: 'https://www.vecteezy.com',
        },
    };
}

class VecteezyService {
    constructor(apiKey = process.env.VECTEEZY_API_KEY, accountId = process.env.VECTEEZY_ACCOUNT_ID) {
        this.apiKey = apiKey || null;
        this.accountId = accountId || null;
        this.providerName = 'vecteezy';
    }

    /**
     * Checks if Vecteezy API credentials are configured.
     */
    isConfigured() {
        const key = this.apiKey || process.env.VECTEEZY_API_KEY;
        return Boolean(key && key.trim().length > 0);
    }

    /**
     * Resolves the account ID from instance or environment.
     */
    _getAccountId() {
        return this.accountId || process.env.VECTEEZY_ACCOUNT_ID || '1';
    }

    /**
     * Core fetch wrapper with timeout, authentication, and error parsing.
     */
    async _request(endpoint, params = {}) {
        const apiKey = this.apiKey || process.env.VECTEEZY_API_KEY;
        if (!apiKey) {
            const err = new Error('Vecteezy API key is missing. Set VECTEEZY_API_KEY environment variable.');
            err.code = 'NOT_CONFIGURED';
            err.status = 503;
            throw err;
        }

        const url = new URL(`${VECTEEZY_API_BASE}${endpoint}`);
        for (const [key, val] of Object.entries(params)) {
            if (val !== undefined && val !== null && val !== '') {
                url.searchParams.set(key, String(val));
            }
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12_000); // 12s timeout

        try {
            const res = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${apiKey.trim()}`,
                    Accept: 'application/json',
                    'User-Agent': 'Vibed-Video-Editor/1.0',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!res.ok) {
                let errorBody = {};
                try {
                    errorBody = await res.json();
                } catch (_) {}

                const message = errorBody.message || errorBody.error || `Vecteezy API request failed with status ${res.status}`;
                const err = new Error(message);
                err.status = res.status;

                if (res.status === 429) {
                    err.code = 'RATE_LIMIT';
                } else if (res.status === 401 || res.status === 403) {
                    err.code = 'AUTH_ERROR';
                } else {
                    err.code = 'API_ERROR';
                }

                throw err;
            }

            return await res.json();
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                const timeoutErr = new Error('Vecteezy API request timed out after 12s');
                timeoutErr.code = 'TIMEOUT';
                timeoutErr.status = 504;
                throw timeoutErr;
            }
            throw err;
        }
    }

    /**
     * Searches for stock videos on Vecteezy.
     */
    async searchVideos(query, options = {}) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            return { results: [], totalResults: 0, page: 1, perPage: 15, provider: 'vecteezy' };
        }

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const perPage = Math.min(50, Math.max(1, parseInt(options.perPage, 10) || 15));
        const orientation = options.orientation ? String(options.orientation).toLowerCase() : undefined;

        const cacheKey = `vecteezy:videos:${cleanQuery}:${page}:${perPage}:${orientation || 'any'}`;
        const cached = searchCache.get(cacheKey);
        if (cached) return cached;

        const accountId = this._getAccountId();
        const queryParams = {
            term: cleanQuery,
            content_type: 'video',
            page,
            per_page: perPage,
        };
        if (orientation) queryParams.orientation = orientation;

        const data = await this._request(`/v2/${accountId}/resources`, queryParams);
        const resources = Array.isArray(data.resources) ? data.resources : [];
        const results = resources.map(normalizeVideoAsset);

        const payload = {
            results,
            totalResults: Number(data.total_resources) || results.length,
            page,
            perPage,
            provider: 'vecteezy',
        };

        searchCache.set(cacheKey, payload);
        return payload;
    }

    /**
     * Searches for stock photos on Vecteezy.
     */
    async searchPhotos(query, options = {}) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            return { results: [], totalResults: 0, page: 1, perPage: 15, provider: 'vecteezy' };
        }

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const perPage = Math.min(50, Math.max(1, parseInt(options.perPage, 10) || 15));
        const orientation = options.orientation ? String(options.orientation).toLowerCase() : undefined;

        const cacheKey = `vecteezy:photos:${cleanQuery}:${page}:${perPage}:${orientation || 'any'}`;
        const cached = searchCache.get(cacheKey);
        if (cached) return cached;

        const accountId = this._getAccountId();
        const queryParams = {
            term: cleanQuery,
            content_type: 'photo',
            page,
            per_page: perPage,
        };
        if (orientation) queryParams.orientation = orientation;

        const data = await this._request(`/v2/${accountId}/resources`, queryParams);
        const resources = Array.isArray(data.resources) ? data.resources : [];
        const results = resources.map(normalizePhotoAsset);

        const payload = {
            results,
            totalResults: Number(data.total_resources) || results.length,
            page,
            perPage,
            provider: 'vecteezy',
        };

        searchCache.set(cacheKey, payload);
        return payload;
    }

    /**
     * Searches for vector illustrations/graphics on Vecteezy — the asset
     * type behind a "cartoonish" style assembly (R132): distinct from
     * searchPhotos, which returns photographic stock.
     */
    async searchVectors(query, options = {}) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            return { results: [], totalResults: 0, page: 1, perPage: 15, provider: 'vecteezy' };
        }

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const perPage = Math.min(50, Math.max(1, parseInt(options.perPage, 10) || 15));
        const orientation = options.orientation ? String(options.orientation).toLowerCase() : undefined;

        const cacheKey = `vecteezy:vectors:${cleanQuery}:${page}:${perPage}:${orientation || 'any'}`;
        const cached = searchCache.get(cacheKey);
        if (cached) return cached;

        const accountId = this._getAccountId();
        const queryParams = {
            term: cleanQuery,
            content_type: 'vector',
            page,
            per_page: perPage,
        };
        if (orientation) queryParams.orientation = orientation;

        const data = await this._request(`/v2/${accountId}/resources`, queryParams);
        const resources = Array.isArray(data.resources) ? data.resources : [];
        const results = resources.map(normalizeVectorAsset);

        const payload = {
            results,
            totalResults: Number(data.total_resources) || results.length,
            page,
            perPage,
            provider: 'vecteezy',
        };

        searchCache.set(cacheKey, payload);
        return payload;
    }

    clearCache() {
        searchCache.clear();
    }
}

const vecteezyService = new VecteezyService();

module.exports = {
    VecteezyService,
    vecteezyService,
    normalizeVideoAsset,
    normalizePhotoAsset,
    normalizeVectorAsset,
    deriveResourceName,
    MemoryCache,
};
