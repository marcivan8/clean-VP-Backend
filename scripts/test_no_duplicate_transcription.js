/**
 * scripts/test_no_duplicate_transcription.js
 *
 *   node scripts/test_no_duplicate_transcription.js
 *
 * Pins that IDELayout never fires a second, identical background-transcription
 * pipeline for a file whose first attempt already failed.
 *
 * WHY THIS EXISTS
 * ---------------
 * Upload triggers transcription TWICE by design: once "early", the instant the
 * raw file lands on GCS (parallel with proxy encoding), and once more when the
 * proxy finishes, as a fallback for the legacy path where the early attempt
 * never got a gcsPath. The second call was guarded by
 * `alreadyRunning = tmStatus in {transcribing, analyzing, ready}` — which
 * covers an attempt still in flight or already succeeded, but NOT an attempt
 * that already FAILED. TranscriptionManager clears its in-flight controller and
 * sets status to 'failed' in its own `finally` block the moment the early
 * attempt times out, which for a long/4K file is common (diarization +
 * Whisper on real interview-length audio can exceed the 300s client budget).
 *
 * So a slow file got transcribed twice, back to back, each attempt burning its
 * own 300s budget and its own diarize+transcribe job pair. On a codebase whose
 * audio worker is deliberately capped at concurrency 1 (R24 — precisely because
 * two heavy jobs sharing that process reliably starves the others), doubling
 * the load for one asset is what dragged waveform extraction and background
 * scene analysis into timeouts in the same session — several "different" bugs
 * with one real cause.
 *
 * Static analysis of the real source.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const IDE_PATH = path.resolve(__dirname, '../client/src/layouts/IDELayout.jsx');
const src = fs.readFileSync(IDE_PATH, 'utf8');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

// Isolate the post-proxy retry block so assertions can't accidentally match
// the unrelated early-transcription call earlier in the same file.
const blockStart = src.indexOf('// Start (or retry) transcription');
const blockEnd   = src.indexOf('// Store the GCS raw path', blockStart);
const block = blockStart !== -1 && blockEnd !== -1 ? src.slice(blockStart, blockEnd) : '';

console.log('\n── IDELayout does not blindly retry a just-failed transcription ──');

check('the post-proxy retry block was found', !!block);

check('it captures the CURRENT transcription status',
    /const tmStatus = transcriptionManager\.getStatus\(\)\.status/.test(block));

check('it computes an "already attempted this exact file" flag',
    /alreadyAttemptedThisFile/.test(block),
    'Without this, a failed early attempt is indistinguishable from no attempt at all.');

check('the flag compares against the EARLY attempt\'s path, not just any path',
    /transcriptPath === earlyTranscriptionPath/.test(block),
    'A retry against a genuinely different path (legacy upload flow) must still be allowed.');

check('the flag fires on a FAILED status, not only a running one',
    /tmStatus === 'failed'/.test(block),
    'This is the exact state the early attempt is in when it has already timed out.');

check('a fresh attempt requires passing all three guards',
    /if \(!alreadyRunning && !alreadyAttemptedThisFile && transcriptPath\)/.test(block));

check('a suppressed retry is logged, not silently dropped',
    /console\.warn\(/.test(block) && /Skipping automatic transcription retry/.test(block),
    'A silent skip here would look identical to "nothing happened" from the outside.');

console.log(
    failures === 0
        ? '\nALL NO-DUPLICATE-TRANSCRIPTION TESTS PASSED\n'
        : `\n${failures} NO-DUPLICATE-TRANSCRIPTION TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
