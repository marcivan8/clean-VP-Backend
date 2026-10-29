// R126/R127 — QC loop Slice 1: exportProcessor.js already computes
// revideoWarning/compositorWarning when the overlay/motion-graphics pass (or
// the whole Revideo path) failed outright — the export "succeeds" but ships
// without captions/motion-graphics/stickers entirely. Those two warnings were
// already surfaced to the user (ExportModal.jsx) and counted in telemetry
// before this round; what was missing was a retry. runExportWithAutoRetry()
// gives those two specific warnings exactly one free automatic retry before
// the user ever sees them, and deliberately does NOT retry the other warning
// fields (captionWarning/transitionWarning/clipWarning/captionProgramWarning)
// because those usually mean something about the content itself that an
// identical second render would reproduce exactly.
import assert from 'assert/strict';
import { runExportWithAutoRetry, firstTransientWarningKey, TRANSIENT_EXPORT_WARNING_KEYS } from '../client/src/utils/exportAutoRetry.js';

const ok = (name) => console.log(`✓ ${name}`);

// ── firstTransientWarningKey ────────────────────────────────────────────────
{
    assert.deepEqual(TRANSIENT_EXPORT_WARNING_KEYS, ['revideoWarning', 'compositorWarning']);
    assert.equal(firstTransientWarningKey(null), null);
    assert.equal(firstTransientWarningKey(undefined), null);
    assert.equal(firstTransientWarningKey({}), null);
    assert.equal(firstTransientWarningKey({ captionWarning: 'font missing' }), null, 'a non-transient warning alone must not trigger a retry');
    assert.equal(firstTransientWarningKey({ revideoWarning: 'worker down' }), 'revideoWarning');
    assert.equal(firstTransientWarningKey({ compositorWarning: 'overlay pass failed' }), 'compositorWarning');
    ok('firstTransientWarningKey only flags revideoWarning/compositorWarning, never the other warning fields');
}

// ── a clean first result: no retry at all ──────────────────────────────────
{
    let calls = 0;
    const runExport = async () => { calls++; return { url: 'a.mp4' }; };
    const { result, retried, resolvedBy } = await runExportWithAutoRetry(runExport, {});
    assert.equal(calls, 1, 'a clean first result must not trigger a second export');
    assert.equal(retried, false);
    assert.equal(resolvedBy, null);
    assert.equal(result.url, 'a.mp4');
    ok('a clean first attempt (no transient warning) never retries');
}

// ── a non-transient warning: still no retry ─────────────────────────────────
{
    let calls = 0;
    const runExport = async () => { calls++; return { url: 'a.mp4', captionWarning: 'font substituted' }; };
    const { retried } = await runExportWithAutoRetry(runExport, {});
    assert.equal(calls, 1, 'a non-transient warning must not trigger a retry — it would just reproduce the same content issue');
    assert.equal(retried, false);
    ok('captionWarning (not in the transient list) never triggers a retry');
}

// ── a transient warning that clears on retry ────────────────────────────────
{
    let calls = 0;
    let onRetryCalledWith = null;
    const runExport = async () => {
        calls++;
        if (calls === 1) return { url: 'a.mp4', revideoWarning: 'worker timeout' };
        return { url: 'a.mp4' }; // clean on retry
    };
    const { result, retried, resolvedBy } = await runExportWithAutoRetry(runExport, {}, {
        onRetry: (k) => { onRetryCalledWith = k; },
    });
    assert.equal(calls, 2, 'a transient warning must trigger exactly one retry');
    assert.equal(retried, true);
    assert.equal(resolvedBy, 'revideoWarning', 'resolvedBy must name the warning the retry actually cleared');
    assert.equal(onRetryCalledWith, 'revideoWarning', 'onRetry must fire with the warning key that triggered it');
    assert.equal(result.revideoWarning, undefined, 'the returned result must be the clean retry, not the first warned attempt');
    ok('revideoWarning on the first attempt triggers exactly one retry, and a clean retry resolves it');
}

// ── a transient warning that persists: bounded, not a loop ─────────────────
{
    let calls = 0;
    const runExport = async () => { calls++; return { url: 'a.mp4', compositorWarning: 'overlay pass failed again' }; };
    const { result, retried, resolvedBy } = await runExportWithAutoRetry(runExport, {});
    assert.equal(calls, 2, 'exactly two attempts total, never a third — this is a bounded retry, not a loop');
    assert.equal(retried, true);
    assert.equal(resolvedBy, null, 'resolvedBy must be null when the retry still carries a transient warning');
    assert.equal(result.compositorWarning, 'overlay pass failed again', 'the result returned is still the (still-warned) retry, for the caller to surface normally');
    ok('a transient warning that persists through the retry is bounded to two attempts and surfaced, not retried forever');
}

// ── settings are passed through unchanged to every attempt ─────────────────
{
    const seenSettings = [];
    const runExport = async (settings) => {
        seenSettings.push(settings);
        return seenSettings.length === 1 ? { revideoWarning: 'x' } : {};
    };
    await runExportWithAutoRetry(runExport, { resolution: '4k', platform: 'youtube' });
    assert.equal(seenSettings.length, 2);
    assert.deepEqual(seenSettings[0], { resolution: '4k', platform: 'youtube' });
    assert.deepEqual(seenSettings[1], { resolution: '4k', platform: 'youtube' });
    ok('the same settings object is passed to both the first attempt and the retry');
}

console.log('\nALL EXPORT AUTO RETRY TESTS PASSED');
