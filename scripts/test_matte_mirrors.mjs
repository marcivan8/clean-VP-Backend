// scripts/test_matte_mirrors.mjs
//
// R92 fix: speaker pop-out ("Mise en avant de la personne") threw a visible,
// unrecoverable error -- "Failed to fetch dynamically imported module:
// https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
// -- whenever the viewer's network, firewall, or an ad-blocker couldn't reach
// jsdelivr. MatteBaker.js now tries a list of mirror CDNs in turn via
// withMirrors() before giving up. This proves that helper's contract in
// isolation: first success short-circuits with no fallback call, a failing
// first source falls through to the next, and if every source fails the
// caller gets ONE clear, actionable error (not the bare browser message)
// that still carries the real underlying reason.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};

let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}\n${err.stack}`); }
}

const { withMirrors } = await import('../client/src/vision/MatteBaker.js');

await check('first mirror succeeding never touches the second', async () => {
    let calls = 0;
    const result = await withMirrors(['https://a.test/x', 'https://b.test/x'], async (url) => {
        calls += 1;
        assert.equal(url, 'https://a.test/x');
        return 'ok-from-a';
    });
    assert.equal(result, 'ok-from-a');
    assert.equal(calls, 1, 'the second mirror should never have been tried');
});

await check('a failing first mirror falls through to the second, which succeeds', async () => {
    const seen = [];
    const result = await withMirrors(['https://cdn.jsdelivr.net/x', 'https://unpkg.com/x'], async (url) => {
        seen.push(url);
        if (url.includes('jsdelivr')) throw new Error('Failed to fetch dynamically imported module');
        return 'ok-from-unpkg';
    });
    assert.equal(result, 'ok-from-unpkg');
    assert.deepEqual(seen, ['https://cdn.jsdelivr.net/x', 'https://unpkg.com/x']);
});

await check('every mirror failing throws one clear, actionable error that keeps the real reason', async () => {
    await assert.rejects(
        () => withMirrors(['https://a.test/x', 'https://b.test/x'], async () => {
            throw new Error('Failed to fetch dynamically imported module: https://a.test/x');
        }),
        (err) => {
            assert.ok(/speaker pop-out/i.test(err.message), `expected an actionable, user-facing message, got: ${err.message}`);
            assert.ok(/2 sources/.test(err.message), `expected the error to say how many sources were tried, got: ${err.message}`);
            assert.ok(err.message.includes('Failed to fetch dynamically imported module'), 'the real underlying error should still be visible for debugging');
            return true;
        },
    );
});

await check('a single source that fails is reported as "1 source", not "1 sources"', async () => {
    await assert.rejects(
        () => withMirrors(['https://a.test/x'], async () => { throw new Error('offline'); }),
        (err) => {
            assert.ok(/1 source\b/.test(err.message) && !/1 sources/.test(err.message), err.message);
            return true;
        },
    );
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL MATTE-MIRROR CHECKS PASSED');
process.exit(failures ? 1 : 0);
