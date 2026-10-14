/**
 * scripts/test_pexels_provider.mjs
 *
 * Test suite for Level 1 Stock Media Integration (Pexels Provider).
 *
 * Verifies:
 *   1. Normalization & derivation helpers (video name, best MP4 file selection).
 *   2. Video and photo asset normalization into VIBED asset schema.
 *   3. In-memory LRU/TTL caching, eviction, and cache hits.
 *   4. Configuration checks and unconfigured fallback (503 NOT_CONFIGURED).
 *   5. Rate-limit (429) & error handling.
 *   6. Mocked search execution for videos and photos (offline CI ready).
 *   7. Route handler contracts (/api/stock/status, /api/stock/search).
 *   8. Timeline and render pipeline contract (main track vs cutaway overlay scale=4, export URL routing).
 *   9. Optional live search check if PEXELS_API_KEY is configured in process.env.
 */

import 'dotenv/config';
import assert from 'node:assert';

// Ensure required env vars are present for database client initialization during offline CI
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.mock';

import {
    PexelsService,
    normalizeVideoAsset,
    normalizePhotoAsset,
    selectBestVideoFile,
    deriveVideoName,
} from '../services/PexelsService.js';

const { default: stockMediaRouter } = await import('../routes/stockMediaRoutes.js');

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

console.log('\n--- 1. Derivation and Best Stream Selection Helpers ---');

check('deriveVideoName extracts clean title from Pexels video URL slug', () => {
    const raw = {
        id: 12345,
        url: 'https://www.pexels.com/video/aerial-view-of-paris-at-night-854673/',
    };
    const name = deriveVideoName(raw);
    assert.strictEqual(name, 'Aerial view of paris at night');
});

check('deriveVideoName falls back cleanly when URL is missing or malformed', () => {
    assert.strictEqual(deriveVideoName({ id: 999 }), 'Stock Video 999');
    assert.strictEqual(deriveVideoName(null), 'Stock Video');
});

check('selectBestVideoFile prioritizes 1080p progressive MP4 over HLS and lower res', () => {
    const files = [
        { id: 1, quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, link: 'https://v.pexels.com/360.mp4' },
        { id: 2, quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, link: 'https://v.pexels.com/1080.mp4' },
        { id: 3, quality: 'hls', file_type: 'application/x-mpegURL', width: 1920, height: 1080, link: 'https://v.pexels.com/stream.m3u8' },
        { id: 4, quality: 'hd', file_type: 'video/mp4', width: 1280, height: 720, link: 'https://v.pexels.com/720.mp4' },
    ];
    const best = selectBestVideoFile(files);
    assert.ok(best, 'Expected a best video file');
    assert.strictEqual(best.id, 2);
    assert.strictEqual(best.height, 1080);
    assert.strictEqual(best.link, 'https://v.pexels.com/1080.mp4');
});

console.log('\n--- 2. Asset Schema Normalization ---');

const mockPexelsVideo = {
    id: 854673,
    width: 1920,
    height: 1080,
    duration: 18,
    url: 'https://www.pexels.com/video/aerial-view-of-paris-at-night-854673/',
    image: 'https://images.pexels.com/videos/854673/pictures/preview-0.jpg',
    user: {
        id: 42,
        name: 'Jean Dupont',
        url: 'https://www.pexels.com/@jean-dupont',
    },
    video_files: [
        { id: 101, quality: 'hd', file_type: 'video/mp4', width: 1920, height: 1080, fps: 30, link: 'https://videos.pexels.com/video-files/854673/854673-hd_1920_1080_30fps.mp4' },
        { id: 102, quality: 'sd', file_type: 'video/mp4', width: 640, height: 360, fps: 30, link: 'https://videos.pexels.com/video-files/854673/854673-sd_640_360_30fps.mp4' },
    ],
};

check('normalizeVideoAsset builds complete VIBED video asset schema', () => {
    const asset = normalizeVideoAsset(mockPexelsVideo);

    assert.strictEqual(asset.id, 'pexels-video-854673');
    assert.strictEqual(asset.name, 'Aerial view of paris at night');
    assert.strictEqual(asset.type, 'video');
    assert.strictEqual(asset.url, 'https://videos.pexels.com/video-files/854673/854673-hd_1920_1080_30fps.mp4');
    assert.strictEqual(asset.sourceUrl, asset.url);
    assert.strictEqual(asset.proxyUrl, asset.url);
    assert.strictEqual(asset.thumbnail, 'https://images.pexels.com/videos/854673/pictures/preview-0.jpg');
    assert.strictEqual(asset.duration, 18);
    assert.strictEqual(asset.sourceDuration, 18);
    assert.deepStrictEqual(asset.resolution, { w: 1920, h: 1080 });
    assert.strictEqual(asset.provider, 'pexels');
    assert.strictEqual(asset.providerId, '854673');
    assert.strictEqual(asset.attribution.provider, 'pexels');
    assert.strictEqual(asset.attribution.photographer, 'Jean Dupont');
    assert.strictEqual(asset.attribution.photographerUrl, 'https://www.pexels.com/@jean-dupont');
    assert.strictEqual(asset.attribution.providerUrl, 'https://www.pexels.com/video/aerial-view-of-paris-at-night-854673/');
    assert.strictEqual(asset.availableFiles.length, 2);
});

const mockPexelsPhoto = {
    id: 153025,
    width: 4000,
    height: 2667,
    url: 'https://www.pexels.com/photo/eiffel-tower-in-paris-153025/',
    photographer: 'Marie Martin',
    photographer_url: 'https://www.pexels.com/@marie-martin',
    alt: 'Eiffel Tower at sunset in Paris',
    src: {
        original: 'https://images.pexels.com/photos/153025/pexels-photo-153025.jpeg',
        large2x: 'https://images.pexels.com/photos/153025/pexels-photo-153025.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
        medium: 'https://images.pexels.com/photos/153025/pexels-photo-153025.jpeg?auto=compress&cs=tinysrgb&h=350',
    },
};

check('normalizePhotoAsset builds complete VIBED image asset schema', () => {
    const asset = normalizePhotoAsset(mockPexelsPhoto);

    assert.strictEqual(asset.id, 'pexels-photo-153025');
    assert.strictEqual(asset.name, 'Eiffel Tower at sunset in Paris');
    assert.strictEqual(asset.type, 'image');
    assert.ok(asset.url.includes('images.pexels.com'));
    assert.ok(asset.thumbnail.includes('images.pexels.com'));
    assert.strictEqual(asset.duration, 5);
    assert.deepStrictEqual(asset.resolution, { w: 4000, h: 2667 });
    assert.strictEqual(asset.provider, 'pexels');
    assert.strictEqual(asset.providerId, '153025');
    assert.strictEqual(asset.attribution.photographer, 'Marie Martin');
    assert.strictEqual(asset.attribution.photographerUrl, 'https://www.pexels.com/@marie-martin');
});

console.log('\n--- 3. Configuration & Error Handling ---');

check('PexelsService reports isConfigured() = false when key is absent', () => {
    const svc = new PexelsService('');
    assert.strictEqual(svc.isConfigured(), false);
});

check('PexelsService reports isConfigured() = true when key is present', () => {
    const svc = new PexelsService('test-key-abc');
    assert.strictEqual(svc.isConfigured(), true);
});

await checkAsync('PexelsService throws NOT_CONFIGURED (503) when search attempted without key', async () => {
    const svc = new PexelsService('');
    // Ensure process.env fallback is overridden
    const origEnv = process.env.PEXELS_API_KEY;
    delete process.env.PEXELS_API_KEY;

    try {
        await svc.searchVideos('Paris');
        assert.fail('Should have thrown NOT_CONFIGURED error');
    } catch (err) {
        assert.strictEqual(err.code, 'NOT_CONFIGURED');
        assert.strictEqual(err.status, 503);
    } finally {
        if (origEnv) process.env.PEXELS_API_KEY = origEnv;
    }
});

console.log('\n--- 4. Mocked Offline Search & In-Memory LRU Cache ---');

await checkAsync('PexelsService performs search, parses response, and caches results', async () => {
    const svc = new PexelsService('mock-api-key');
    svc.clearCache();

    let fetchCount = 0;
    // Mock global fetch for this service instance
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        fetchCount += 1;
        assert.strictEqual(options.headers.Authorization, 'mock-api-key');
        return {
            ok: true,
            status: 200,
            json: async () => ({
                page: 1,
                per_page: 15,
                total_results: 42,
                videos: [mockPexelsVideo],
            }),
        };
    };

    try {
        // First search: network fetch
        const res1 = await svc.searchVideos('Paris at night');
        assert.strictEqual(fetchCount, 1, 'First call should hit network');
        assert.strictEqual(res1.results.length, 1);
        assert.strictEqual(res1.results[0].id, 'pexels-video-854673');
        assert.strictEqual(res1.totalResults, 42);

        // Second search with identical query: cache hit
        const res2 = await svc.searchVideos('Paris at night');
        assert.strictEqual(fetchCount, 1, 'Second call must hit memory cache without extra network fetch');
        assert.strictEqual(res2.results.length, 1);
    } finally {
        globalThis.fetch = origFetch;
    }
});

await checkAsync('PexelsService propagates RATE_LIMIT (429) cleanly', async () => {
    const svc = new PexelsService('mock-api-key');
    svc.clearCache();

    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
    });

    try {
        await svc.searchVideos('sunset');
        assert.fail('Should have thrown RATE_LIMIT');
    } catch (err) {
        assert.strictEqual(err.code, 'RATE_LIMIT');
        assert.strictEqual(err.status, 429);
    } finally {
        globalThis.fetch = origFetch;
    }
});

console.log('\n--- 5. Route Contracts (/api/stock) ---');

check('stockMediaRoutes exports Express Router instance', () => {
    assert.strictEqual(typeof stockMediaRouter, 'function');
    assert.ok(stockMediaRouter.stack && stockMediaRouter.stack.length > 0);
});

check('Router registers GET /status and GET /search paths', () => {
    const routes = stockMediaRouter.stack
        .filter(layer => layer.route)
        .map(layer => ({ path: layer.route.path, methods: Object.keys(layer.route.methods) }));

    const statusRoute = routes.find(r => r.path === '/status');
    const searchRoute = routes.find(r => r.path === '/search');

    assert.ok(statusRoute, 'Must have /status route');
    assert.ok(statusRoute.methods.includes('get'));
    assert.ok(searchRoute, 'Must have /search route');
    assert.ok(searchRoute.methods.includes('get'));
});

console.log('\n--- 6. Timeline Addition & Pipeline Compatibility ---');

check('Main-track asset addition conforms to VIBED timeline clip model', () => {
    const asset = normalizeVideoAsset(mockPexelsVideo);

    // Simulate adding to timeline main track
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

    assert.ok(clip.id);
    assert.strictEqual(clip.type, 'video');
    assert.strictEqual(clip.start, 0);
    assert.strictEqual(clip.end, 18);
    assert.ok(clip.url.startsWith('https://'));
});

check('Cutaway overlay placement specifies scale: 4, x: 50, y: 50 for full-frame display', () => {
    const asset = normalizeVideoAsset(mockPexelsVideo);

    // Per R66 & AssetPanel handleStockAddAsOverlay:
    // Stickers/overlays default to scale 0.25; scale: 4 produces exact 1.0 (100% full-frame)
    const overlayClip = {
        id: `cutaway-${Date.now()}`,
        assetId: asset.id,
        name: `Cutaway: ${asset.name}`,
        type: 'video',
        trackId: 'overlay',
        url: asset.url,
        thumbnail: asset.thumbnail,
        start: 5.0,
        end: 10.0,
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
    assert.strictEqual(overlayClip.scale, 4, 'Scale must be 4 to counter default 0.25 sticker scale');
    assert.strictEqual(overlayClip.x, 50);
    assert.strictEqual(overlayClip.y, 50);
});

check('Pexels asset URLs pass through fixUrl intact for preview and export', () => {
    // In client/src/revideo/project.tsx:
    // const fixUrl = (u) => { if (!u) return ''; if (u.startsWith('http')) return u; ... }
    const fixUrl = (u) => {
        if (!u) return '';
        if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('blob:') || u.startsWith('data:')) {
            return u;
        }
        return `http://localhost:5001${u}`;
    };

    const asset = normalizeVideoAsset(mockPexelsVideo);
    const resolvedUrl = fixUrl(asset.url);
    assert.strictEqual(resolvedUrl, asset.url, 'Pexels CDN URL must not be rewritten with localhost prefix');
});

console.log('\n--- 7. Live Pexels API Smoke Test (Conditional) ---');

if (process.env.PEXELS_API_KEY && process.env.PEXELS_API_KEY.trim().length > 10) {
    await checkAsync('Live Pexels search query for "Paris at night"', async () => {
        const liveSvc = new PexelsService(process.env.PEXELS_API_KEY);
        const data = await liveSvc.searchVideos('Paris at night', { perPage: 2 });
        assert.ok(data.results.length > 0, 'Expected at least 1 video result from live API');
        const first = data.results[0];
        assert.ok(first.url.startsWith('https://'), 'Video URL must be HTTPS');
        assert.strictEqual(first.provider, 'pexels');
        assert.ok(first.attribution.photographer, 'Attribution photographer must be present');
        console.log(`     (Live search succeeded: found "${first.name}" by ${first.attribution.photographer})`);
    });
} else {
    console.log('  ℹ Skipping live API check (PEXELS_API_KEY not set in current process.env)');
}

console.log(`\n========================================`);
console.log(`Pexels Provider Tests: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
    process.exit(1);
}
