/**
 * scripts/test_multicam_and_sync.mjs
 *
 * Automated tests for:
 * 1. Acoustic waveform cross-correlation (sub-millisecond synchronization of separate audio/video).
 * 2. Multi-camera interview alignment & speaker-driven auto-cutting director.
 * 3. AI Copilot command resolution for audio sync and multicam interview editing.
 */

import assert from 'assert/strict';
import { computeCrossCorrelation } from '../client/src/utils/audioCrossCorrelation.js';
import { extractSpeakerTurns, planMultiCamCuts } from '../client/src/agent/MultiCamDirector.js';
import { resolveCommand } from '../client/src/agent/CommandRegistry.js';

let passed = 0;
let failed = 0;

function log(msg = '') {
    process.stdout.write(msg + '\n');
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        log(`  ✗ ${name}\n    Error: ${err.message}`);
    }
}

log('\n--- Acoustic Waveform Cross-Correlation & Multi-Cam Director Tests ---');

// ── Test 1: Cross-correlation accuracy on synthetic signals ────────────────
await test('computeCrossCorrelation accurately detects offset of delayed signal', () => {
    const sampleRate = 8000;
    const durationSec = 10;
    const len = sampleRate * durationSec;
    const sigRef = new Float32Array(len);

    // Generate pseudo-random speech-like signal
    for (let i = 0; i < len; i++) {
        sigRef[i] = Math.sin(2 * Math.PI * 220 * (i / sampleRate)) +
                    0.5 * Math.sin(2 * Math.PI * 440 * (i / sampleRate)) +
                    0.25 * ((Math.random() * 2) - 1);
    }

    // Delay target by exactly 1.250 seconds (10,000 samples)
    const trueOffsetSec = 1.250;
    const lagSamples = Math.round(trueOffsetSec * sampleRate);
    const sigTarget = new Float32Array(len);
    for (let i = lagSamples; i < len; i++) {
        sigTarget[i] = sigRef[i - lagSamples];
    }

    const result = computeCrossCorrelation(sigRef, sigTarget, sampleRate, 10);
    const diff = Math.abs(result.offsetSeconds - trueOffsetSec);

    assert.ok(diff < 0.005, `Detected offset ${result.offsetSeconds}s should be within 5ms of true offset ${trueOffsetSec}s (diff: ${diff}s)`);
    assert.ok(result.confidence > 0.4, `Confidence should be high, got ${result.confidence}`);
});

await test('computeCrossCorrelation gracefully handles zero/empty signals', () => {
    const res = computeCrossCorrelation(new Float32Array(0), new Float32Array(0));
    assert.equal(res.offsetSeconds, 0);
    assert.equal(res.confidence, 0);
});

// ── Test 2: Speaker turn extraction ─────────────────────────────────────────
await test('extractSpeakerTurns groups diarized words into turns', () => {
    const words = [
        { word: 'Hello', start: 0.0, end: 0.4, speaker: 'SPEAKER_00' },
        { word: 'welcome', start: 0.5, end: 0.9, speaker: 'SPEAKER_00' },
        { word: 'to', start: 1.0, end: 1.2, speaker: 'SPEAKER_00' },
        { word: 'the', start: 1.3, end: 1.5, speaker: 'SPEAKER_00' },
        { word: 'show', start: 1.6, end: 2.0, speaker: 'SPEAKER_00' },
        // Guest speaks
        { word: 'Thank', start: 3.0, end: 3.3, speaker: 'SPEAKER_01' },
        { word: 'you', start: 3.4, end: 3.6, speaker: 'SPEAKER_01' },
        { word: 'for', start: 3.7, end: 3.9, speaker: 'SPEAKER_01' },
        { word: 'having', start: 4.0, end: 4.4, speaker: 'SPEAKER_01' },
        { word: 'me', start: 4.5, end: 4.8, speaker: 'SPEAKER_01' },
    ];

    const turns = extractSpeakerTurns(words, ['SPEAKER_00', 'SPEAKER_01']);
    assert.equal(turns.length, 2, `Should extract 2 conversational turns, got ${turns.length}`);
    assert.equal(turns[0].speaker, 'SPEAKER_00');
    assert.equal(turns[0].text, 'Hello welcome to the show');
    assert.equal(turns[1].speaker, 'SPEAKER_01');
    assert.equal(turns[1].text, 'Thank you for having me');
});

// ── Test 3: Multi-cam cutting logic ─────────────────────────────────────────
await test('planMultiCamCuts assigns angles, wide pauses, and enforces minimum shot duration', () => {
    const angleA = { id: 'cam_host', name: 'Host Angle' };
    const angleB = { id: 'cam_guest', name: 'Guest Angle' };
    const wideAngle = { id: 'cam_wide', name: 'Wide 2-Shot' };

    const words = [
        // Host turn (0.0 - 2.5s)
        { word: 'Host', start: 0.0, end: 0.5, speaker: 'SPEAKER_00' },
        { word: 'intro', start: 0.6, end: 2.5, speaker: 'SPEAKER_00' },
        // Long pause (2.5s - 4.5s -> 2.0s gap > 1.4s threshold)
        // Guest turn (4.5 - 7.5s)
        { word: 'Guest', start: 4.5, end: 5.0, speaker: 'SPEAKER_01' },
        { word: 'reply', start: 5.1, end: 7.5, speaker: 'SPEAKER_01' },
    ];

    const cuts = planMultiCamCuts({
        angleA,
        angleB,
        wideAngle,
        words,
        speakers: ['SPEAKER_00', 'SPEAKER_01'],
        totalDuration: 10,
    });

    assert.ok(cuts.length >= 3, `Expected at least 3 cuts, got ${cuts.length}`);

    // Cut 1 should be Host (cam_host)
    assert.equal(cuts[0].activeAngle, 'cam_host');
    assert.equal(cuts[0].speaker, 'SPEAKER_00');
    assert.ok(cuts[0].duration >= 1.8, `Duration must satisfy MIN_SHOT_DURATION_S (1.8s), got ${cuts[0].duration}s`);

    // The gap between 2.5s and 4.5s should trigger Wide angle
    const wideCut = cuts.find(c => c.activeAngle === 'cam_wide');
    assert.ok(wideCut, 'Expected wide angle cut during 2.0s pause between host and guest');
    assert.equal(wideCut.speaker, 'pause');

    // Guest cut should be Guest (cam_guest)
    const guestCut = cuts.find(c => c.activeAngle === 'cam_guest');
    assert.ok(guestCut, 'Expected guest angle cut when SPEAKER_01 speaks');
    assert.equal(guestCut.speaker, 'SPEAKER_01');
});

// ── Test 4: AI Command Resolution ──────────────────────────────────────────
await test('CommandRegistry resolves audio alignment and multicam interview requests', () => {
    const syncRes = resolveCommand('sync audio with video');
    assert.ok(syncRes.match, 'Should match sync request');
    assert.equal(syncRes.match.id, 'align_audio_waveform');

    const multicamRes = resolveCommand('cut multicam by speaker');
    assert.ok(multicamRes.match, 'Should match multicam interview cut request');
    assert.equal(multicamRes.match.id, 'edit_multicam_interview');

    const frSyncRes = resolveCommand('synchroniser l audio');
    assert.ok(frSyncRes.match, 'Should match French audio sync request');
    assert.equal(frSyncRes.match.id, 'align_audio_waveform');

    const frMultiRes = resolveCommand('monter l interview multi camera');
    assert.ok(frMultiRes.match, 'Should match French multicam interview request');
    assert.equal(frMultiRes.match.id, 'edit_multicam_interview');
});

log(`\n────────────────────────────────────────────────────────────`);
log(`Multi-Cam & Audio Sync Engine: ${passed} passed, ${failed} failed`);
log(`────────────────────────────────────────────────────────────\n`);

process.exit(failed ? 1 : 0);
