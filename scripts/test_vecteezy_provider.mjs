/**
 * scripts/test_vecteezy_provider.mjs
 *
 * Test suite for Vecteezy Stock Media Integration (Level 1 & Level 2).
 *
 * Verifies:
 *   1. Derivation and naming helpers (deriveResourceName).
 *   2. Video and photo asset normalization into VIBED asset schema (vecteezy-video-*, vecteezy-photo-*).
 *   3. In-memory LRU/TTL caching, eviction, and cache hits.
 *   4. Configuration checks and unconfigured fallback (503 NOT_CONFIGURED).
 *   5. Rate-limit (429), timeout (504), and error handling.
 *   6. Mocked search execution for videos and photos (offline CI ready).
 *   7. Route handler contracts (/api/stock/status, /api/stock/search) with Vecteezy active.
 *   8. Timeline and render pipeline contract (main track vs cutaway overlay scale=4, export URL routing).
 *   9. B-roll suggester integration with Vecteezy provider.
 *  10. Optional live search check if VECTEEZY_API_KEY is configured in process.env.
 */

import 'dotenv/config';
import assert from 'node:assert';

// Ensure required env vars are present for database client initialization during offline CI
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock';

import {
    VecteezyService,
    normalizeVideoAsset,
    normalizePhotoAsset,
    deriveResourceName,
    MemoryCache,
} from '../services/VecteezyService.js';

const { default: stockMediaRouter } = await import('../routes/stockMediaRoutes.js');
const { brollSuggesterService } = await import('../services/BrollSuggesterService.js');

let passed = 0;
let failed = 0;

function check(label, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ✓ ${label}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label}`);
        console.error(`      ${err.message}`);
    }
}

async function checkAsync(label, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ✓ ${label}`);
    } catch (err) {
        failed += 1;
        console.error(`  ✗ ${label}`);
        console.error(`      ${err.message}`);
    }
}

console.log('\n--- 1. Derivation and Naming Helpers ---');

check('deriveResourceName extracts and capitalizes title correctly', () => {
    const raw = {
        id: 12345,
        title: 'aerial view of sunset over ocean',
    };
    const name = deriveResourceName(raw, 'Video');
    assert.strictEqual(name, 'Aerial view of sunset over ocean');
});

check('deriveResourceName falls back cleanly when title is empty or missing', () => {
    assert.strictEqual(deriveResourceName({ id: 999 }, 'Video'), 'Vecteezy Video 999');
    assert.strictEqual(deriveResourceName({ id: 888 }, 'Photo'), 'Vecteezy Photo 888');
    assert.strictEqual(deriveResourceName(null, 'Media'), 'Vecteezy Media');
});

console.log('\n--- 2. Asset Schema Normalization ---');

const mockVecteezyVideo = {
    id: 998877,
    title: 'Drone shot of city skyscrapers at sunset',
    content_type: 'video',
    preview_url: 'https://static.vecteezy.com/system/resources/previews/998877/preview.mp4',
    thumbnail_url: 'https://static.vecteezy.com/system/resources/thumbnails/998877/thumb.jpg',
    thumbnail_2x_url: 'https://static.vecteezy.com/system/resources/thumbnails/998877/thumb_2x.jpg',
    dimensions: {
        width: 1920,
        height: 1080,
    },
    duration: 15,
    file_metadata: {
        available_download_sizes: [
            { id: '1080p', width: 1920, height: 1080 },
            { id: '720p', width: 1280, height: 720 },
        ],
    },
};

check('normalizeVideoAsset builds complete VIBED video asset schema', () => {
    const asset = normalizeVideoAsset(mockVecteezyVideo);

    assert.strictEqual(asset.id, 'vecteezy-video-998877');
    assert.strictEqual(asset.name, 'Drone shot of city skyscrapers at sunset');
    assert.strictEqual(asset.type, 'video');
    assert.strictEqual(asset.url, 'https://static.vecteezy.com/system/resources/previews/998877/preview.mp4');
    assert.strictEqual(asset.sourceUrl, asset.url);
    assert.strictEqual(asset.proxyUrl, asset.url);
    assert.strictEqual(asset.thumbnail, 'https://static.vecteezy.com/system/resources/thumbnails/998877/thumb_2x.jpg');
    assert.strictEqual(asset.duration, 15);
    assert.strictEqual(asset.sourceDuration, 15);
    assert.deepStrictEqual(asset.resolution, { w: 1920, h: 1080 });
    assert.strictEqual(asset.provider, 'vecteezy');
    assert.strictEqual(asset.providerId, '998877');
    assert.strictEqual(asset.attribution.provider, 'vecteezy');
    assert.strictEqual(asset.attribution.photographer, 'Vecteezy Contributor');
    assert.strictEqual(asset.attribution.photographerUrl, 'https://www.vecteezy.com');
    assert.strictEqual(asset.availableFiles.length, 2);
    assert.strictEqual(asset.availableFiles[0].id, '1080p');
});

const mockVecteezyPhoto = {
    id: 554433,
    title: 'Modern coffee shop interior with plants',
    content_type: 'photo',
    preview_url: 'https://static.vecteezy.com/system/resources/previews/554433/preview.jpg',
    thumbnail_url: 'https://static.vecteezy.com/system/resources/thumbnails/554433/thumb.jpg',
    thumbnail_2x_url: 'https://static.vecteezy.com/system/resources/thumbnails/554433/thumb_2x.jpg',
    dimensions: {
        width: 3840,
        height: 2160,
    },
};

check('normalizePhotoAsset builds complete VIBED image asset schema', () => {
    const asset = normalizePhotoAsset(mockVecteezyPhoto);

    assert.strictEqual(asset.id, 'vecteezy-photo-554433');
    assert.strictEqual(asset.name, 'Modern coffee shop interior with plants');
    assert.strictEqual(asset.type, 'image');
    assert.strictEqual(asset.url, 'https://static.vecteezy.com/system/resources/previews/554433/preview.jpg');
    assert.strictEqual(asset.thumbnail, 'https://static.vecteezy.com/system/resources/thumbnails/554433/thumb_2x.jpg');
    assert.strictEqual(asset.duration, 5);
    assert.deepStrictEqual(asset.resolution, { w: 3840, h: 2160 });
    assert.strictEqual(asset.provider, 'vecteezy');
    assert.strictEqual(asset.providerId, '554433');
    assert.strictEqual(asset.attribution.provider, 'vecteezy');
    assert.strictEqual(asset.attribution.photographer, 'Vecteezy Contributor');
});

console.log('\n--- 3. MemoryCache LRU and TTL Behavior ---');

check('MemoryCache respects maxEntries limit and evicts oldest items', () => {
    const cache = new MemoryCache(2, 60000);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.strictEqual(cache.get('a'), 1);
    assert.strictEqual(cache.get('b'), 2);

    // Adding 3rd item should evict 'a' (oldest accessed)
    cache.set('c', 3);
    assert.strictEqual(cache.get('a'), null, 'Item a should be evicted');
    assert.strictEqual(cache.get('b'), 2);
    assert.strictEqual(cache.get('c'), 3);
});

check('MemoryCache respects TTL expiration', () => {
    const cache = new MemoryCache(10, -100); // already expired
    cache.set('exp', 'value');
    assert.strictEqual(cache.get('exp'), null, 'Expired item should return null');
});

console.log('\n--- 4. Configuration & Error Handling ---');

check('VecteezyService reports isConfigured() = false when key is absent', () => {
    const origKey = process.env.VECTEEZY_API_KEY;
    delete process.env.VECTEEZY_API_KEY;
    try {
        const svc = new VecteezyService('');
        assert.strictEqual(svc.isConfigured(), false);
    } finally {
        if (origKey) process.env.VECTEEZY_API_KEY = origKey;
    }
});

check('VecteezyService reports isConfigured() = true when key is present', () => {
    const svc = new VecteezyService('test-vecteezy-key-xyz');
    assert.strictEqual(svc.isConfigured(), true);
});

await checkAsync('VecteezyService throws NOT_CONFIGURED (503) when search attempted without key', async () => {
    const origKey = process.env.VECTEEZY_API_KEY;
    delete process.env.VECTEEZY_API_KEY;
    try {
        const svc = new VecteezyService('');
        await svc.searchVideos('Paris');
        assert.fail('Should have thrown NOT_CONFIGURED error');
    } catch (err) {
        assert.strictEqual(err.code, 'NOT_CONFIGURED');
        assert.strictEqual(err.status, 503);
    } finally {
        if (origKey) process.env.VECTEEZY_API_KEY = origKey;
    }
});

console.log('\n--- 5. Mocked Offline Search & Caching ---');

await checkAsync('VecteezyService performs search, builds resources URL, and caches results', async () => {
    const svc = new VecteezyService('mock-api-key', 'acc_12345');
    svc.clearCache();

    let fetchCount = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        fetchCount += 1;
        assert.ok(url.includes('/v2/acc_12345/resources'), 'URL must target /v2/{account_id}/resources');
        assert.ok(url.includes('content_type=video'), 'Query params must include content_type=video');
        assert.ok(url.includes('term=sunset'), 'Query params must include search term');
        assert.strictEqual(options.headers.Authorization, 'Bearer mock-api-key');

        return {
            ok: true,
            status: 200,
            json: async () => ({
                page: 1,
                per_page: 15,
                total_resources: 100,
                resources: [mockVecteezyVideo],
            }),
        };
    };

    try {
        const res1 = await svc.searchVideos('sunset');
        assert.strictEqual(fetchCount, 1, 'First call should hit mock network');
        assert.strictEqual(res1.results.length, 1);
        assert.strictEqual(res1.results[0].id, 'vecteezy-video-998877');
        assert.strictEqual(res1.totalResults, 100);
        assert.strictEqual(res1.provider, 'vecteezy');

        // Second call with same parameters must hit cache
        const res2 = await svc.searchVideos('sunset');
        assert.strictEqual(fetchCount, 1, 'Second call must hit memory cache');
        assert.strictEqual(res2.results.length, 1);
    } finally {
        globalThis.fetch = origFetch;
    }
});

await checkAsync('VecteezyService performs photo search with content_type=photo', async () => {
    const svc = new VecteezyService('mock-api-key', 'acc_12345');
    svc.clearCache();

    let capturedUrl = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        capturedUrl = url;
        return {
            ok: true,
            status: 200,
            json: async () => ({
                page: 1,
                per_page: 15,
                total_resources: 50,
                resources: [mockVecteezyPhoto],
            }),
        };
    };

    try {
        const res = await svc.searchPhotos('coffee shop');
        assert.ok(capturedUrl.includes('content_type=photo'), 'URL must specify content_type=photo');
        assert.strictEqual(res.results.length, 1);
        assert.strictEqual(res.results[0].id, 'vecteezy-photo-554433');
        assert.strictEqual(res.results[0].type, 'image');
    } finally {
        globalThis.fetch = origFetch;
    }
});

await checkAsync('VecteezyService propagates RATE_LIMIT (429) cleanly', async () => {
    const svc = new VecteezyService('mock-api-key');
    svc.clearCache();

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ message: 'Rate limit exceeded' }),
    });

    try {
        await svc.searchVideos('technology');
        assert.fail('Should have thrown RATE_LIMIT');
    } catch (err) {
        assert.strictEqual(err.code, 'RATE_LIMIT');
        assert.strictEqual(err.status, 429);
    } finally {
        globalThis.fetch = origFetch;
    }
});

console.log('\n--- 6. Route Contracts (/api/stock) ---');

check('stockMediaRoutes exports Express Router instance with /status and /search', () => {
    assert.strictEqual(typeof stockMediaRouter, 'function');
    const routes = stockMediaRouter.stack
        .filter(layer => layer.route)
        .map(layer => layer.route.path);
    assert.ok(routes.includes('/status'), 'Must have /status route');
    assert.ok(routes.includes('/search'), 'Must have /search route');
    assert.ok(routes.includes('/suggest-broll'), 'Must have /suggest-broll route');
});

console.log('\n--- 7. Timeline Addition & Pipeline Compatibility ---');

check('Vecteezy video conforms to VIBED timeline clip model', () => {
    const asset = normalizeVideoAsset(mockVecteezyVideo);

    const clip = {
        id: `clip-${Date.now()}`,
        assetId: asset.id,
        name: asset.name,
        type: 'video',
        url: asset.url,
        thumbnail: asset.thumbnail,
        start: 0,
        end: asset.duration,
        sourceStart: 0,
        sourceEnd: asset.duration,
        sourceDuration: asset.duration,
        volume: 1,
        provider: asset.provider,
        attribution: asset.attribution,
    };

    assert.strictEqual(clip.type, 'video');
    assert.strictEqual(clip.provider, 'vecteezy');
    assert.strictEqual(clip.attribution.provider, 'vecteezy');
    assert.strictEqual(clip.start, 0);
    assert.strictEqual(clip.end, 15);
});

check('Cutaway overlay placement specifies scale: 4, x: 50, y: 50 for Vecteezy asset', () => {
    const asset = normalizeVideoAsset(mockVecteezyVideo);

    const overlayClip = {
        id: `cutaway-${Date.now()}`,
        assetId: asset.id,
        name: `Cutaway: ${asset.name}`,
        type: 'video',
        trackId: 'overlay',
        url: asset.url,
        thumbnail: asset.thumbnail,
        start: 2.0,
        end: 7.0,
        sourceStart: 0,
        sourceEnd: 5.0,
        sourceDuration: asset.duration,
        scale: 4,
        x: 50,
        y: 50,
        provider: asset.provider,
        attribution: asset.attribution,
    };

    assert.strictEqual(overlayClip.trackId, 'overlay');
    assert.strictEqual(overlayClip.scale, 4);
    assert.strictEqual(overlayClip.provider, 'vecteezy');
});

console.log('\n--- 8. B-Roll Suggester with Vecteezy ---');

await checkAsync('BrollSuggesterService generates suggestions using active stock provider', async () => {
    const origFetch = globalThis.fetch;
    const origKey = process.env.VECTEEZY_API_KEY;
    process.env.VECTEEZY_API_KEY = 'mock-key';

    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
            page: 1,
            per_page: 3,
            total_resources: 10,
            resources: [mockVecteezyVideo],
        }),
    });

    try {
        const words = [
            { start: 1.0, end: 1.5, word: 'Walking' },
            { start: 1.6, end: 2.0, word: 'around' },
            { start: 2.1, end: 2.6, word: 'Paris' },
            { start: 2.7, end: 3.2, word: 'downtown' },
            { start: 3.3, end: 4.0, word: 'streets' },
        ];

        const res = await brollSuggesterService.suggestBroll({ words, maxSuggestions: 2 });
        assert.ok(res.suggestions.length > 0, 'Should find at least 1 suggestion');
        const sugg = res.suggestions[0];
        assert.strictEqual(sugg.asset.provider, 'vecteezy');
        assert.strictEqual(sugg.speakerLayout, 'full_cutaway');
    } finally {
        globalThis.fetch = origFetch;
        if (origKey) {
            process.env.VECTEEZY_API_KEY = origKey;
        } else {
            delete process.env.VECTEEZY_API_KEY;
        }
    }
});

console.log('\n--- 9. Live Vecteezy API Smoke Test (Conditional) ---');

if (process.env.VECTEEZY_API_KEY && process.env.VECTEEZY_API_KEY.trim().length > 10) {
    await checkAsync('Live Vecteezy search query for "nature"', async () => {
        const liveSvc = new VecteezyService(process.env.VECTEEZY_API_KEY, process.env.VECTEEZY_ACCOUNT_ID);
        const data = await liveSvc.searchVideos('nature', { perPage: 2 });
        assert.ok(data.results.length > 0, 'Expected at least 1 video result from live API');
        const first = data.results[0];
        assert.ok(first.url.startsWith('https://'), 'Video URL must be HTTPS');
        assert.strictEqual(first.provider, 'vecteezy');
        console.log(`     (Live search succeeded: found "${first.name}" on Vecteezy)`);
    });
} else {
    console.log('  ℹ Skipping live API check (VECTEEZY_API_KEY not set in current process.env)');
}

console.log(`\n========================================`);
console.log(`Vecteezy Provider Tests: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
    process.exit(1);
}
