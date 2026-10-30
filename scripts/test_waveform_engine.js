/**
 * scripts/test_waveform_engine.js
 *
 *   node scripts/test_waveform_engine.js
 *
 * Behavioural tests for client/src/services/WaveformEngine.js.
 *
 * Unlike the other regression scripts here (which are static source analysis),
 * this one EXECUTES the engine against a stubbed `fetch` and a stubbed store.
 * The bugs it guards against are all timing/coordination bugs — duplicate
 * requests, retry storms, giving up too early — and none of them are visible in
 * the source text.
 *
 * WHY THIS EXISTS
 * ---------------
 * Waveform extraction used to live in the `usePeaks` React hook, so *rendering
 * a clip* issued a network request. One asset re-segmented into 20 clips meant
 * 20 hook instances racing on mount; dedupe was keyed on `assetId|proxyUrl`, so
 * clips whose proxyUrl hydrated at slightly different moments each opened their
 * own extraction of the identical file. The engine exists to make "the editor
 * reads, it never regenerates" enforceable — these tests are what enforce it.
 *
 * No network, no browser, no credentials.
 */

'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

// ── Stub the browser + store surface the engine imports ──────────────────────
const storeState = {
    waveformsByAsset: {},
    setAssetWaveform(assetId, data) {
        if (assetId && data?.peaks?.length) this.waveformsByAsset[assetId] = data;
    },
};

// The engine does `import useTimelineStore from '../store/useTimelineStore.js'`
// and only ever calls `.getState()`. Intercepting the module keeps this test
// free of React/Zustand/localStorage.
const Module = require('module');
const origResolve = Module._resolveFilename;
const STORE_ID = path.resolve(__dirname, '../client/src/store/useTimelineStore.js');
Module._resolveFilename = function (request, ...rest) {
    if (request.includes('useTimelineStore')) return STORE_ID;
    return origResolve.call(this, request, ...rest);
};

let fetchCalls = [];
let fetchImpl = null;
global.fetch = (...args) => {
    fetchCalls.push(args[0]);
    return fetchImpl(...args);
};

const jsonRes = (body, { status = 200, headers = {} } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => body,
});

/**
 * The engine is an ES module. Load it by transpiling the import/export lines —
 * lighter than pulling in a bundler for one file, and the module has no other
 * ESM-specific semantics.
 */
function loadEngine() {
    const fs = require('fs');
    const src = fs.readFileSync(
        path.resolve(__dirname, '../client/src/services/WaveformEngine.js'), 'utf8'
    )
        .replace(/^import useTimelineStore from .*$/m, 'const useTimelineStore = { getState: () => storeState };')
        // authFetch is the real client's authenticated wrapper (it attaches the
        // Supabase JWT). Here it must resolve to the stubbed global fetch, so
        // these tests keep exercising the engine's retry/backpressure logic
        // rather than the auth layer. Added when the engine switched from bare
        // fetch to authFetch — see the anonymous-waveform-path fix.
        .replace(/^import \{ authFetch \} from .*$/m,
            'const authFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { ...(opts.headers || {}), \'Content-Type\': \'application/json\' } });')
        .replace(/^export const WaveformEngine =/m, 'const WaveformEngine =')
        .replace(/^export default WaveformEngine;$/m,
            'module.exports = WaveformEngine;\nmodule.exports.isServerResolvable = isServerResolvable;');

    const m = new Module('waveform-engine-under-test');
    m._compile(
        `const storeState = arguments[0];\n${src}`.replace(
            'const storeState = arguments[0];',
            ''
        ),
        'WaveformEngine.js'
    );
    return m.exports;
}

// Inject storeState into the module scope via global (simplest reliable path).
global.storeState = storeState;

const run = async () => {
    const WaveformEngine = loadEngine();

    console.log('\n── 1. Concurrent callers for one asset make ONE request ──');
    // This is the whole point of the refactor: 20 clips from one re-segmented
    // asset must not open 20 extractions.
    {
        fetchCalls = [];
        fetchImpl = async (url) =>
            String(url).includes('/api/waveform/extract')
                ? jsonRes({ peaksUrl: '/peaks/a.json' })
                : jsonRes({ peaks: [0.1, 0.5, 0.9], duration: 3 });

        const results = await Promise.all(
            Array.from({ length: 20 }, () =>
                WaveformEngine.getPeaks('asset-A', { proxyUrl: '/api/proxy/gcs-media/proxies/u/f/proxy.mp4' })
            )
        );

        const extractCalls = fetchCalls.filter(u => String(u).includes('/extract')).length;
        check('20 concurrent callers issued exactly 1 extract request',
            extractCalls === 1, `issued ${extractCalls}`);
        check('all 20 callers received the peaks',
            results.every(r => r?.peaks?.length === 3));
    }

    console.log('\n── 2. A second request hits cache, not the network ──');
    {
        fetchCalls = [];
        const again = await WaveformEngine.getPeaks('asset-A', { proxyUrl: '/api/proxy/gcs-media/proxies/u/x/proxy.mp4' });
        check('cached asset issued no further requests', fetchCalls.length === 0);
        check('cached value is correct', again?.peaks?.length === 3);
    }

    console.log('\n── 3. Results persist to the store (survive reload) ──');
    {
        check('peaks were written to waveformsByAsset',
            storeState.waveformsByAsset['asset-A']?.peaks?.length === 3,
            'Without this a refresh re-extracts every asset from scratch.');
    }

    console.log('\n── 4. blob:/data: URLs never reach the server ──');
    {
        fetchCalls = [];
        // deriveGcsPath() cannot resolve these to a storage object, so the route
        // answers 400 every time. Spending an attempt on one used to leave the
        // clip permanently waveform-less.
        const r = await WaveformEngine.getPeaks('asset-blob', { proxyUrl: 'blob:http://localhost/abc' });
        check('blob: URL produced no request', fetchCalls.length === 0);
        check('blob: URL resolves to null (caller shows empty state)', r === null);

        const r2 = await WaveformEngine.getPeaks('asset-none', {});
        check('missing URL produces no request and returns null',
            r2 === null && fetchCalls.length === 0);
    }

    console.log('\n── 4b. The client sends exactly the URL shapes the server can read ──');
    {
        // Same rule on both sides: a URL the engine sends must resolve on the
        // server, and a URL the server cannot read must never be sent (a 4xx is
        // never retried, so it left the clip blank for the whole session).
        const { deriveGcsPath, resolveStaticAudioPath } = require('../utils/waveformPath');
        const serverReads = (u) => !!deriveGcsPath(null, u) || !!resolveStaticAudioPath(u)
            || /^https?:\/\//i.test(u);
        const shapes = [
            '/api/proxy/gcs-media/proxies/u/f/proxy.mp4',
            '/uploads/proxies/dev-user/f/proxy.mp4',
            'raw/user/clip.mov',
            '/sfx-library/bass-drop-01.mp3',
            'https://videos.pexels.com/video-files/1/1.mp4',
            'https://storage.googleapis.com/bucket/raw/u/a.mov',
            'blob:http://localhost/abc',
            'data:audio/mp3;base64,AAAA',
            '/motion-assets/arrow.png',
            '/sfx-library/../index.js',
            '',
        ];
        for (const u of shapes) {
            check(`client and server agree on ${JSON.stringify(u)}`,
                WaveformEngine.isServerResolvable(u) === serverReads(u),
                `client=${WaveformEngine.isServerResolvable(u)} server=${serverReads(u)}`);
        }

        fetchCalls = [];
        fetchImpl = async (url) =>
            String(url).includes('/api/waveform/extract')
                ? jsonRes({ peaksUrl: '/peaks/sfx.json' })
                : jsonRes({ peaks: [0.3, 0.6], duration: 1 });
        const sfx = await WaveformEngine.getPeaks('asset-sfx', { proxyUrl: '/sfx-library/bass-drop-01.mp3' });
        check('a /sfx-library/ clip gets peaks', sfx?.peaks?.length === 2);

        fetchCalls = [];
        const other = await WaveformEngine.getPeaks('asset-rel', { proxyUrl: '/motion-assets/arrow.png' });
        check('an unknown relative URL makes no request', other === null && fetchCalls.length === 0);
    }

    console.log('\n── 5. 503 backpressure is waited out, not counted as failure ──');
    {
        fetchCalls = [];
        let n = 0;
        fetchImpl = async (url) => {
            if (String(url).includes('/extract')) {
                n++;
                // Server queue saturated on the first two tries, then succeeds.
                if (n <= 2) return jsonRes({ error: 'busy' }, { status: 503, headers: { 'Retry-After': '0' } });
                return jsonRes({ peaksUrl: '/peaks/b.json' });
            }
            return jsonRes({ peaks: [0.4], duration: 1 });
        };

        const r = await WaveformEngine.getPeaks('asset-busy', { proxyUrl: '/api/proxy/gcs-media/proxies/u/y/proxy.mp4' });
        check('succeeded after two 503s', r?.peaks?.length === 1,
            '503 means "come back", not "broken" — it must not consume an attempt.');
        check('it actually retried past the default attempt cap', n === 3);
    }

    console.log('\n── 6. A 4xx is permanent — no pointless retries ──');
    {
        fetchCalls = [];
        fetchImpl = async () => jsonRes({ error: 'gcsPath required' }, { status: 400 });

        const r = await WaveformEngine.getPeaks('asset-400', { proxyUrl: '/api/proxy/gcs-media/proxies/u/z/proxy.mp4' });
        const extractCalls = fetchCalls.filter(u => String(u).includes('/extract')).length;
        check('400 returned null', r === null);
        check('400 was not retried', extractCalls === 1,
            'Retrying identical input against a 4xx cannot change the outcome.');
    }

    console.log('\n── 7. 5xx retries, then gives up (no infinite storm) ──');
    {
        fetchCalls = [];
        fetchImpl = async () => jsonRes({ error: 'boom' }, { status: 500 });

        const r = await WaveformEngine.getPeaks('asset-500', { proxyUrl: '/api/proxy/gcs-media/proxies/u/w/proxy.mp4' });
        const extractCalls = fetchCalls.filter(u => String(u).includes('/extract')).length;
        check('500 eventually returned null', r === null);
        check('500 retried a bounded number of times', extractCalls === 3, `made ${extractCalls}`);

        // Subsequent asks must not restart the storm...
        fetchCalls = [];
        await WaveformEngine.getPeaks('asset-500', { proxyUrl: '/api/proxy/gcs-media/proxies/u/w/proxy.mp4' });
        check('a failed asset stops retrying on later renders',
            fetchCalls.length === 0,
            'Otherwise every re-render of a broken clip re-hammers the route.');

        // ...until something changes that could plausibly fix it.
        WaveformEngine.reset('asset-500');
        fetchCalls = [];
        await WaveformEngine.getPeaks('asset-500', { proxyUrl: '/api/proxy/gcs-media/proxies/u/w/proxy.mp4' });
        check('reset() re-enables retry (e.g. proxy job finally finished)',
            fetchCalls.filter(u => String(u).includes('/extract')).length > 0);
    }

    console.log('\n── 8. Inline-peaks fallback (server storage upload failed) ──');
    {
        fetchImpl = async () => jsonRes({ peaksUrl: null, peaks: [0.7, 0.2], duration: 2 });
        const r = await WaveformEngine.getPeaks('asset-inline', { proxyUrl: '/api/proxy/gcs-media/proxies/u/i/proxy.mp4' });
        check('inline peaks are accepted when no peaksUrl is returned',
            r?.peaks?.length === 2,
            'The server returns peaks inline rather than leaving the client empty-handed.');
    }

    console.log('\n── 9. A newly-ready proxy invalidates a prior no-audio result ──');
    {
        fetchCalls = [];
        fetchImpl = async (url) => {
            if (String(url).includes('/extract')) return jsonRes({ peaks: [], duration: 0, hasAudio: false });
            return jsonRes({ peaks: [0.2, 0.8], duration: 2 });
        };
        const first = await WaveformEngine.getPeaks('asset-proxy-ready', {
            proxyUrl: '/api/proxy/gcs-media/raw/u/original.mp4',
        });
        check('no-audio response is cached for the first source', first?.hasAudio === false);

        WaveformEngine.reset('asset-proxy-ready');
        fetchImpl = async (url) => {
            if (String(url).includes('/extract')) return jsonRes({ peaksUrl: null, peaks: [0.2, 0.8], duration: 2 });
            return jsonRes({ peaks: [0.2, 0.8], duration: 2 });
        };
        const second = await WaveformEngine.getPeaks('asset-proxy-ready', {
            proxyUrl: '/api/proxy/gcs-media/proxies/u/ready.mp4',
        });
        check('reset clears the cached no-audio result and extracts from the proxy',
            second?.peaks?.length === 2
            && fetchCalls.filter(url => String(url).includes('/extract')).length === 2);
    }

    console.log(
        failures === 0
            ? '\nALL WAVEFORM ENGINE TESTS PASSED\n'
            : `\n${failures} WAVEFORM ENGINE TEST(S) FAILED\n`
    );
    process.exit(failures === 0 ? 0 : 1);
};

run().catch(err => {
    console.error('\nTest harness error:', err);
    process.exit(1);
});
