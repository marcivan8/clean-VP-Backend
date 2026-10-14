'use strict';

/**
 * services/PexelsService.js
 *
 * Server-side Pexels Stock Media Provider for VIBED.
 *
 * Implements Level 1 Stock Media Search:
 *   - Video and photo search against official Pexels API
 *   - Strict server-side API key management (never sent to client)
 *   - In-memory bounded TTL cache to prevent rate-limit exhaustion (200 req/hr tier)
 *   - Selection of highest-quality progressive MP4 stream
 *   - Normalization into VIBED's native asset data model
 *   - Creator and Pexels attribution preservation
 */

const PEXELS_API_BASE = 'https://api.pexels.com';
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
            // Evict oldest entry
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
 * Helper to derive a clean human-readable name from a Pexels URL or title.
 */
function deriveVideoName(video) {
    if (!video) return 'Stock Video';
    if (video.url) {
        try {
            const urlObj = new URL(video.url);
            const pathParts = urlObj.pathname.split('/').filter(Boolean);
            const slug = pathParts[pathParts.length - 1] || '';
            const cleaned = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
            if (cleaned && cleaned.length > 2) {
                return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
            }
        } catch (_) {}
    }
    return `Stock Video ${video.id || ''}`.trim();
}

/**
 * Select the best progressive MP4 file from Pexels video_files array.
 * Prefers 1080p HD, then 720p HD, then SD, avoiding HLS (.m3u8) links.
 */
function selectBestVideoFile(videoFiles = []) {
    if (!Array.isArray(videoFiles) || videoFiles.length === 0) return null;

    // Filter to progressive MP4 files with valid links
    const mp4Files = videoFiles.filter(f => {
        if (!f?.link) return false;
        const fileType = String(f.file_type || '').toLowerCase();
        return fileType === 'video/mp4' || f.link.includes('.mp4');
    });

    const candidates = mp4Files.length > 0 ? mp4Files : videoFiles;

    // Sort by resolution / quality:
    // Ideal width is 1920 (1080p), then 1280 (720p), then higher/lower
    candidates.sort((a, b) => {
        const hA = a.height || 0;
        const hB = b.height || 0;
        // Prioritize full HD (1080) or near 1080 first
        const diffA = Math.abs(hA - 1080);
        const diffB = Math.abs(hB - 1080);
        if (diffA !== diffB) return diffA - diffB;
        // If equal, prefer higher width
        return (b.width || 0) - (a.width || 0);
    });

    return candidates[0] || null;
}

/**
 * Normalizes a raw Pexels video object into VIBED's asset schema.
 */
function normalizeVideoAsset(video) {
    const bestFile = selectBestVideoFile(video.video_files);
    const resolvedUrl = bestFile?.link || video.video_files?.[0]?.link || '';
    const resolution = bestFile?.width && bestFile?.height
        ? { w: bestFile.width, h: bestFile.height }
        : (video.width && video.height ? { w: video.width, h: video.height } : null);

    return {
        id: `pexels-video-${video.id}`,
        name: deriveVideoName(video),
        type: 'video',
        url: resolvedUrl,
        sourceUrl: resolvedUrl,
        proxyUrl: resolvedUrl,
        thumbnail: video.image || video.video_pictures?.[0]?.picture || null,
        duration: Number(video.duration) || 0,
        sourceDuration: Number(video.duration) || 0,
        resolution,
        provider: 'pexels',
        providerId: String(video.id),
        attribution: {
            provider: 'pexels',
            providerUrl: video.url || `https://www.pexels.com/video/${video.id}/`,
            photographer: video.user?.name || 'Unknown Creator',
            photographerUrl: video.user?.url || null,
        },
        availableFiles: (video.video_files || []).map(f => ({
            id: f.id,
            quality: f.quality,
            width: f.width,
            height: f.height,
            fps: f.fps,
            link: f.link,
        })),
    };
}

/**
 * Normalizes a raw Pexels photo object into VIBED's asset schema.
 */
function normalizePhotoAsset(photo) {
    const resolvedUrl = photo.src?.large2x || photo.src?.large || photo.src?.original || '';
    const thumbnail = photo.src?.medium || photo.src?.small || photo.src?.tiny || resolvedUrl;

    return {
        id: `pexels-photo-${photo.id}`,
        name: photo.alt ? photo.alt.trim() : `Stock Photo ${photo.id}`,
        type: 'image',
        url: resolvedUrl,
        sourceUrl: resolvedUrl,
        proxyUrl: resolvedUrl,
        thumbnail,
        duration: 5,
        sourceDuration: 5,
        resolution: photo.width && photo.height ? { w: photo.width, h: photo.height } : null,
        provider: 'pexels',
        providerId: String(photo.id),
        attribution: {
            provider: 'pexels',
            providerUrl: photo.url || `https://www.pexels.com/photo/${photo.id}/`,
            photographer: photo.photographer || 'Unknown Photographer',
            photographerUrl: photo.photographer_url || null,
        },
    };
}

class PexelsService {
    constructor(apiKey = process.env.PEXELS_API_KEY) {
        this.apiKey = apiKey || null;
    }

    /**
     * Checks if Pexels API key is present.
     */
    isConfigured() {
        const key = this.apiKey || process.env.PEXELS_API_KEY;
        return Boolean(key && key.trim().length > 0);
    }

    /**
     * Core fetch wrapper with timeout, authentication, and error parsing.
     */
    async _request(endpoint, params = {}) {
        const apiKey = this.apiKey || process.env.PEXELS_API_KEY;
        if (!apiKey) {
            const err = new Error('Pexels API key is not configured.');
            err.code = 'NOT_CONFIGURED';
            err.status = 503;
            throw err;
        }

        const url = new URL(endpoint, PEXELS_API_BASE);
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') {
                url.searchParams.set(k, String(v));
            }
        });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    Authorization: apiKey,
                    Accept: 'application/json',
                    'User-Agent': 'VIBED-Video-Editor/2.0',
                },
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (response.status === 429) {
                const err = new Error('Pexels API rate limit exceeded. Please wait a moment.');
                err.code = 'RATE_LIMIT';
                err.status = 429;
                throw err;
            }

            if (!response.ok) {
                const text = await response.text();
                const err = new Error(`Pexels API error (${response.status}): ${text || response.statusText}`);
                err.status = response.status;
                throw err;
            }

            return await response.json();
        } catch (err) {
            clearTimeout(timeout);
            if (err.name === 'AbortError') {
                const timeoutErr = new Error('Pexels API request timed out after 10s.');
                timeoutErr.status = 504;
                throw timeoutErr;
            }
            throw err;
        }
    }

    /**
     * Search stock videos on Pexels.
     *
     * @param {string} query Search terms (e.g., "Paris at night")
     * @param {object} [options]
     * @param {number} [options.page=1]
     * @param {number} [options.perPage=15]
     * @param {string} [options.orientation] 'landscape' | 'portrait' | 'square'
     * @param {string} [options.size] 'large' | 'medium' | 'small'
     * @returns {Promise<{ results: Array, totalResults: number, page: number, perPage: number }>}
     */
    async searchVideos(query, options = {}) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            return { results: [], totalResults: 0, page: 1, perPage: 15 };
        }

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const perPage = Math.min(30, Math.max(1, parseInt(options.perPage, 10) || 15));
        const orientation = options.orientation || null;
        const size = options.size || null;

        const cacheKey = `videos:${cleanQuery.toLowerCase()}:${page}:${perPage}:${orientation || ''}:${size || ''}`;
        const cached = searchCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const data = await this._request('/videos/search', {
            query: cleanQuery,
            page,
            per_page: perPage,
            orientation,
            size,
        });

        const rawVideos = Array.isArray(data.videos) ? data.videos : [];
        const results = rawVideos
            .map(normalizeVideoAsset)
            .filter(asset => Boolean(asset.url));

        const responsePayload = {
            results,
            totalResults: data.total_results || results.length,
            page: data.page || page,
            perPage: data.per_page || perPage,
            nextPage: data.next_page || null,
            prevPage: data.prev_page || null,
            provider: 'pexels',
        };

        searchCache.set(cacheKey, responsePayload);
        return responsePayload;
    }

    /**
     * Search stock photos on Pexels.
     */
    async searchPhotos(query, options = {}) {
        const cleanQuery = String(query || '').trim();
        if (!cleanQuery) {
            return { results: [], totalResults: 0, page: 1, perPage: 15 };
        }

        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const perPage = Math.min(30, Math.max(1, parseInt(options.perPage, 10) || 15));
        const orientation = options.orientation || null;

        const cacheKey = `photos:${cleanQuery.toLowerCase()}:${page}:${perPage}:${orientation || ''}`;
        const cached = searchCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const data = await this._request('/v1/search', {
            query: cleanQuery,
            page,
            per_page: perPage,
            orientation,
        });

        const rawPhotos = Array.isArray(data.photos) ? data.photos : [];
        const results = rawPhotos
            .map(normalizePhotoAsset)
            .filter(asset => Boolean(asset.url));

        const responsePayload = {
            results,
            totalResults: data.total_results || results.length,
            page: data.page || page,
            perPage: data.per_page || perPage,
            nextPage: data.next_page || null,
            provider: 'pexels',
        };

        searchCache.set(cacheKey, responsePayload);
        return responsePayload;
    }

    /**
     * Clear the search cache (for testing).
     */
    clearCache() {
        searchCache.clear();
    }
}

// Singleton instance
const pexelsService = new PexelsService();

module.exports = {
    PexelsService,
    pexelsService,
    normalizeVideoAsset,
    normalizePhotoAsset,
    selectBestVideoFile,
    deriveVideoName,
};
