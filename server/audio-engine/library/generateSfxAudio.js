'use strict';

/**
 * server/audio-engine/library/generateSfxAudio.js
 *
 * Generates PLACEHOLDER audio for the 33 STARTER_SFX entries in starterLibrary.js.
 *
 * Why this exists: the starter SFX library (see starterLibrary.js header comment)
 * ships as metadata only — "gcs_path=null until seeded with real files". Nothing
 * ever populated real audio, so the search engine returned correct matches but
 * SoundCard's Play button had nothing to play (sfx.preview_url was always null).
 *
 * This script procedurally synthesizes short SFX clips with ffmpeg (noise bursts,
 * tone sweeps, chords, arpeggios — no external/licensed audio involved, so there's
 * no copyright/licensing exposure) and writes them to client/public/sfx-library/,
 * the same "bundled static asset" pattern already used for fonts
 * (client/public/fonts/ — see EXT2 in CLAUDE.md). Being static files served by
 * whatever hosts the SPA build means no GCS credentials or backend route changes
 * are needed — same as fonts, this works identically in every environment.
 *
 * These are PLACEHOLDER sounds, not a polished sound-design library. Swap in a
 * licensed SFX pack later by dropping matching-named files into
 * client/public/sfx-library/ and re-running the DB update below (or just
 * overwriting the files — the assets.preview_url values don't need to change).
 *
 * Usage:
 *   node server/audio-engine/library/generateSfxAudio.js
 *
 * Requires: ffmpeg on PATH (already a runtime dependency — see R6 in CLAUDE.md).
 * Safe to re-run — always overwrites.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '../../../client/public/sfx-library');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

function outPath(name) {
    return path.join(OUT_DIR, `${name}.mp3`);
}

function sh(cmd) {
    execSync(cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
}

// ── Synthesis primitives ──────────────────────────────────────────────────────

/** Bandpass-filtered noise burst with an attack/decay envelope — whooshes, rustle, wind, risers. */
function noiseBurst(name, { duration, color = 'pink', freq, width = 1000, fadeIn = 0.02, fadeOut = 0.1, gainDb = 0 }) {
    const fo = Math.max(0.01, Math.min(fadeOut, duration - fadeIn - 0.01));
    const st = Math.max(0, duration - fo);
    sh(
        `ffmpeg -hide_banner -loglevel error -y ` +
        `-f lavfi -i "anoisesrc=color=${color}:duration=${duration}:sample_rate=44100" ` +
        `-af "bandpass=f=${freq}:width_type=h:w=${width},afade=t=in:d=${fadeIn},afade=t=out:st=${st}:d=${fo},volume=${gainDb}dB" ` +
        `-ac 2 -b:a 128k "${outPath(name)}"`
    );
}

/** Alias of noiseBurst tuned for long, quiet ambient beds. */
function droneNoise(name, { duration, color = 'brown', freq = 300, width = 600, gainDb = -8, fadeIn = 1, fadeOut = 1 }) {
    const fi = Math.min(fadeIn, duration / 3);
    const fo = Math.min(fadeOut, duration / 3);
    noiseBurst(name, { duration, color, freq, width, fadeIn: fi, fadeOut: fo, gainDb });
}

/** Single sine/triangle tone with an envelope — beeps, dings. */
function tone(name, { duration, freq, wave = 'sine', fadeIn = 0.01, fadeOut = 0.15, gainDb = 0 }) {
    const fo = Math.max(0.01, Math.min(fadeOut, duration - fadeIn - 0.01));
    const st = Math.max(0, duration - fo);
    sh(
        `ffmpeg -hide_banner -loglevel error -y ` +
        `-f lavfi -i "${wave}=frequency=${freq}:duration=${duration}:sample_rate=44100" ` +
        `-af "afade=t=in:d=${fadeIn},afade=t=out:st=${st}:d=${fo},volume=${gainDb}dB" ` +
        `-ac 2 -b:a 128k "${outPath(name)}"`
    );
}

/** Multiple simultaneous sine tones mixed together — pleasant chimes/notifications. */
function chord(name, { duration, freqs, fadeIn = 0.01, fadeOut = 0.3, gainDb = -4 }) {
    const fo = Math.max(0.01, Math.min(fadeOut, duration - fadeIn - 0.01));
    const st = Math.max(0, duration - fo);
    const inputs = freqs.map(f => `-f lavfi -i "sine=frequency=${f}:duration=${duration}:sample_rate=44100"`).join(' ');
    const labels = freqs.map((_, i) => `[${i}:a]`).join('');
    const filter = `${labels}amix=inputs=${freqs.length}:normalize=0,afade=t=in:d=${fadeIn},afade=t=out:st=${st}:d=${fo},volume=${gainDb}dB`;
    sh(`ffmpeg -hide_banner -loglevel error -y ${inputs} -filter_complex "${filter}" -ac 2 -b:a 128k "${outPath(name)}"`);
}

/** Sequential sine notes concatenated — ascending/descending runs (level-up, fanfare, sparkle). */
function arpeggio(name, { notes, gainDb = -2 }) {
    const inputs = notes.map(n => `-f lavfi -i "sine=frequency=${n.freq}:duration=${n.dur}:sample_rate=44100"`).join(' ');
    const stages = notes.map((n, i) => {
        const fo = Math.min(0.03, n.dur / 3);
        const st = Math.max(0, n.dur - fo);
        return `[${i}:a]afade=t=in:d=0.01,afade=t=out:st=${st}:d=${fo}[a${i}]`;
    }).join(';');
    const concatIn = notes.map((_, i) => `[a${i}]`).join('');
    const filter = `${stages};${concatIn}concat=n=${notes.length}:v=0:a=1,volume=${gainDb}dB`;
    sh(`ffmpeg -hide_banner -loglevel error -y ${inputs} -filter_complex "${filter}" -ac 2 -b:a 128k "${outPath(name)}"`);
}

/** Low sine "thump" + short noise transient — impacts, booms, drops, punches. */
function impact(name, { duration, subFreq = 80, snapDuration = 0.04, gainDb = 4 }) {
    const subDecayStart = Math.min(0.05, duration / 4);
    sh(
        `ffmpeg -hide_banner -loglevel error -y ` +
        `-f lavfi -i "sine=frequency=${subFreq}:duration=${duration}:sample_rate=44100" ` +
        `-f lavfi -i "anoisesrc=color=white:duration=${snapDuration}:sample_rate=44100" ` +
        `-filter_complex "[0:a]afade=t=in:d=0.002,afade=t=out:st=${subDecayStart}:d=${Math.max(0.05, duration - subDecayStart)},volume=6dB[sub];` +
        `[1:a]afade=t=out:st=0:d=${snapDuration},highpass=f=1500,volume=4dB[snap];` +
        `[sub][snap]amix=inputs=2:duration=first:normalize=0,volume=${gainDb}dB" ` +
        `-ac 2 -b:a 128k "${outPath(name)}"`
    );
}

/** Very short high-passed noise burst — UI clicks, camera shutter, keyboard taps. */
function click(name, { duration = 0.06, freq = 3000, gainDb = 0 }) {
    const fo = Math.max(0.005, Math.min(0.02, duration / 3));
    const st = Math.max(0, duration - fo);
    sh(
        `ffmpeg -hide_banner -loglevel error -y ` +
        `-f lavfi -i "anoisesrc=color=white:duration=${duration}:sample_rate=44100" ` +
        `-af "highpass=f=${freq},afade=t=in:d=0.002,afade=t=out:st=${st}:d=${fo},volume=${gainDb}dB" ` +
        `-ac 2 -b:a 128k "${outPath(name)}"`
    );
}

/** Continuous pitch glide via aevalsrc phase integral — glissandi (boing, slide whistle, zoom, bass drop). */
function sweep(name, { duration, f0, f1, gainDb = 0, fadeOut = 0.1 }) {
    const T = duration;
    const expr = `sin(2*PI*(${f0}*t+((${f1}-${f0})/(2*${T}))*t*t))`;
    const fo = Math.max(0.01, Math.min(fadeOut, duration - 0.02));
    const st = Math.max(0, duration - fo);
    sh(
        `ffmpeg -hide_banner -loglevel error -y ` +
        `-f lavfi -i "aevalsrc=${expr}:s=44100:d=${duration}" ` +
        `-af "afade=t=in:d=0.01,afade=t=out:st=${st}:d=${fo},volume=${gainDb}dB" ` +
        `-ac 2 -b:a 128k "${outPath(name)}"`
    );
}

// ── The 33 STARTER_SFX recipes ────────────────────────────────────────────────
// Parameters chosen to loosely match each entry's name/category/duration/energy
// in starterLibrary.js. These are placeholders — see file header.

function generateAll() {
    droneNoise('ambient-tension-low',      { duration: 5,   color: 'brown', freq: 90,   width: 300,  gainDb: 12,  fadeIn: 1.5, fadeOut: 1.5 });
    chord('ambient-warmth-guitar',         { duration: 2.5, freqs: [196.00, 246.94, 293.66], fadeIn: 0.02, fadeOut: 1.8, gainDb: 6 });
    droneNoise('silence-fill-ambience',    { duration: 10,  color: 'pink',  freq: 1000, width: 4000, gainDb: 15, fadeIn: 0.5, fadeOut: 0.5 });

    noiseBurst('cinematic-riser-01',       { duration: 4,   color: 'white', freq: 1000, width: 2000, fadeIn: 3.5, fadeOut: 0.4, gainDb: 3 });
    impact('cinematic-stinger-hit',        { duration: 1.5, subFreq: 65, snapDuration: 0.06, gainDb: 6 });

    sweep('comedy-boing-01',               { duration: 0.6, f0: 200, f1: 700, gainDb: -2, fadeOut: 0.15 });
    impact('comedy-pop-01',                { duration: 0.2, subFreq: 220, snapDuration: 0.03, gainDb: 3 });
    sweep('comedy-slide-whistle',          { duration: 0.8, f0: 1200, f1: 400, gainDb: -2, fadeOut: 0.15 });
    impact('comedy-vine-boom',             { duration: 0.7, subFreq: 55, snapDuration: 0.05, gainDb: 6 });

    sweep('bass-drop-01',                  { duration: 2,   f0: 150, f1: 40, gainDb: 4, fadeOut: 0.5 });

    click('fashion-camera-click',          { duration: 0.15, freq: 2500, gainDb: 3 });
    click('foley-keyboard-tap',            { duration: 0.1,  freq: 3500, gainDb: 1 });
    noiseBurst('foley-paper-rustle',       { duration: 0.6, color: 'white', freq: 4000, width: 6000, fadeIn: 0.05, fadeOut: 0.3, gainDb: -2 });

    arpeggio('gaming-kill-confirm',        { notes: [{ freq: 1200, dur: 0.08 }, { freq: 1800, dur: 0.15 }], gainDb: 0 });
    arpeggio('gaming-level-up',            { notes: [{ freq: 523, dur: 0.15 }, { freq: 659, dur: 0.15 }, { freq: 784, dur: 0.15 }, { freq: 1046, dur: 0.9 }], gainDb: -2 });

    impact('impact-boom-01',               { duration: 1.2, subFreq: 60,  snapDuration: 0.07, gainDb: 6 });
    impact('impact-hit-soft',              { duration: 0.8, subFreq: 100, snapDuration: 0.03, gainDb: 0 });

    arpeggio('money-coin-drop',            { notes: [{ freq: 2500, dur: 0.08 }, { freq: 3200, dur: 0.12 }, { freq: 2800, dur: 0.4 }], gainDb: -4 });

    droneNoise('nature-wind-subtle',       { duration: 8,   color: 'pink', freq: 500, width: 1800, gainDb: 28, fadeIn: 2, fadeOut: 2 });

    click('speaker-change-soft-cut',       { duration: 0.2, freq: 1500, gainDb: -8 });

    sweep('reveal-power-up',               { duration: 1.2, f0: 300, f1: 1400, gainDb: 2, fadeOut: 0.2 });
    arpeggio('reveal-sparkle-01',          { notes: [{ freq: 2000, dur: 0.1 }, { freq: 2500, dur: 0.1 }, { freq: 3000, dur: 0.1 }, { freq: 3500, dur: 0.7 }], gainDb: -6 });

    impact('social-like-pop',              { duration: 0.25, subFreq: 300, snapDuration: 0.02, gainDb: 0 });
    chord('social-notification-01',        { duration: 0.4,  freqs: [880, 1108.73], fadeIn: 0.01, fadeOut: 0.3, gainDb: -4 });

    tone('tech-scan-beep',                 { duration: 0.4, freq: 1200, fadeIn: 0.01, fadeOut: 0.15, gainDb: -3 });

    noiseBurst('text-whoosh-in',           { duration: 0.3,  color: 'white', freq: 1500, width: 2500, fadeIn: 0.02, fadeOut: 0.15, gainDb: 0 });
    noiseBurst('hard-cut-whoosh-01',       { duration: 0.4,  color: 'pink',  freq: 1200, width: 1800, fadeIn: 0.02, fadeOut: 0.2,  gainDb: 4 });
    noiseBurst('hard-cut-whoosh-02',       { duration: 0.35, color: 'pink',  freq: 700,  width: 1200, fadeIn: 0.02, fadeOut: 0.15, gainDb: 5 });

    chord('ui-chime-positive',             { duration: 0.5, freqs: [659.25, 830.61, 987.77], fadeIn: 0.01, fadeOut: 0.35, gainDb: 8 });
    click('ui-click-soft',                 { duration: 0.08, freq: 2200, gainDb: -4 });

    arpeggio('victory-fanfare-short',      { notes: [{ freq: 523, dur: 0.2 }, { freq: 659, dur: 0.2 }, { freq: 784, dur: 0.2 }, { freq: 1046, dur: 1.4 }], gainDb: 0 });

    sweep('zoom-out-whoosh',               { duration: 0.6, f0: 1000, f1: 300, gainDb: -2, fadeOut: 0.2 });
    impact('zoom-punch-01',                { duration: 0.5, subFreq: 90, snapDuration: 0.04, gainDb: 6 });
}

const SFX_NAMES = [
    'ambient-tension-low', 'ambient-warmth-guitar', 'silence-fill-ambience',
    'cinematic-riser-01', 'cinematic-stinger-hit',
    'comedy-boing-01', 'comedy-pop-01', 'comedy-slide-whistle', 'comedy-vine-boom',
    'bass-drop-01',
    'fashion-camera-click', 'foley-keyboard-tap', 'foley-paper-rustle',
    'gaming-kill-confirm', 'gaming-level-up',
    'impact-boom-01', 'impact-hit-soft',
    'money-coin-drop',
    'nature-wind-subtle',
    'speaker-change-soft-cut',
    'reveal-power-up', 'reveal-sparkle-01',
    'social-like-pop', 'social-notification-01',
    'tech-scan-beep',
    'text-whoosh-in', 'hard-cut-whoosh-01', 'hard-cut-whoosh-02',
    'ui-chime-positive', 'ui-click-soft',
    'victory-fanfare-short',
    'zoom-out-whoosh', 'zoom-punch-01',
];

if (require.main === module) {
    console.log(`[generateSfxAudio] Synthesizing ${SFX_NAMES.length} placeholder SFX clips into ${OUT_DIR}…`);
    generateAll();

    const missing = SFX_NAMES.filter(name => !fs.existsSync(outPath(name)));
    if (missing.length > 0) {
        console.error('[generateSfxAudio] Missing output files:', missing.join(', '));
        process.exit(1);
    }
    console.log(`[generateSfxAudio] Done — ${SFX_NAMES.length} files written.`);
}

module.exports = { generateAll, SFX_NAMES, OUT_DIR };
