#!/usr/bin/env node
/**
 * Regression: every caption font actually LOADS in the browser (R57).
 *
 * All 36 caption fonts have shipped as real .ttf files in
 * client/public/fonts/ for a while — FONT_SPECS in jobs/exportProcessor.js
 * has always resolved them correctly for the EXPORT, because drawtext reads
 * font files directly off disk. But client/src/index.css never declared an
 * @font-face for a single one of them; it only ever had faces for the app's
 * own UI chrome (Geist, Instrument Serif, JetBrains Mono). So every caption,
 * in both TextOverlay.jsx (the live preview) and the Revideo scene that's
 * actually mounted (client/src/revideo/project.tsx), silently fell back to
 * the browser's default font — the export was never the broken half.
 *
 * FONT_SPECS (export) and the @font-face rules (preview) are two
 * hand-maintained lists that must describe the same 36 fonts. This asserts
 * they do, and fails the way R57 failed if they ever drift apart again:
 * silently, in the browser, with no error anywhere.
 *
 * Run: node scripts/test_caption_fonts.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const exportSrc = read('jobs/exportProcessor.js');
const cssSrc    = read('client/src/index.css');

// ── Parse FONT_SPECS out of exportProcessor.js ──────────────────────────────
const specsStart = exportSrc.indexOf('const FONT_SPECS = {');
const specsEnd   = exportSrc.indexOf('\n};', specsStart);
const specsBlock = exportSrc.slice(specsStart, specsEnd);

const FONT_SPECS = {};
const specRe = /'([^']+)':\s*{\s*file:\s*'([^']+)',\s*slug:\s*'[^']+',\s*weight:\s*(\d+)/g;
let m;
while ((m = specRe.exec(specsBlock))) {
    FONT_SPECS[m[1]] = { file: m[2], weight: Number(m[3]) };
}

// ── Parse @font-face rules out of index.css ─────────────────────────────────
// Only the single-line caption-font rules added for R57 — the multi-line
// Geist/Instrument Serif/JetBrains Mono blocks (UI chrome, unicode-range
// subsets) are a different thing and must NOT be mistaken for caption fonts.
const faceRe = /@font-face\s*{\s*font-family:\s*'([^']+)';\s*font-style:\s*normal;\s*font-weight:\s*(\d+);\s*font-display:\s*swap;\s*src:\s*url\('\/fonts\/([^']+)'\)\s*format\('truetype'\);\s*}/g;
const CSS_FACES = {};
while ((m = faceRe.exec(cssSrc))) {
    CSS_FACES[m[1]] = { weight: Number(m[2]), file: m[3] };
}

section('1 · FONT_SPECS was parsed correctly (sanity check on the parser itself)');
{
    check('FONT_SPECS block was found', specsStart !== -1 && specsEnd !== -1);
    check('a representative entry parsed', FONT_SPECS['Anton']?.file === 'Anton-Regular.ttf');
    check('at least 30 fonts were parsed out of exportProcessor.js',
        Object.keys(FONT_SPECS).length >= 30,
        `parsed ${Object.keys(FONT_SPECS).length} — the regex above may be out of sync with FONT_SPECS' formatting`);
}

section('2 · Every FONT_SPECS entry has a matching @font-face (R57)');
{
    const missing = Object.keys(FONT_SPECS).filter(name => !CSS_FACES[name]);
    check('no caption font is missing an @font-face declaration',
        missing.length === 0,
        missing.length ? `missing: ${missing.join(', ')} — these fonts export correctly but silently fall back to the browser default in the preview` : '');
}

section('3 · Every declared @font-face points at a real file that ships (R6/EXT2 — no runtime downloads)');
{
    const fontsDir = path.join(ROOT, 'client/public/fonts');
    for (const [name, spec] of Object.entries(FONT_SPECS)) {
        const face = CSS_FACES[name];
        if (!face) continue; // already reported as missing in §2
        check(`${name}: @font-face src references the same file FONT_SPECS resolves`,
            face.file === spec.file,
            `CSS points at ${face.file}, FONT_SPECS points at ${spec.file} — these must be the exact same file or the preview and export can silently render different fonts`);
        const filePath = path.join(fontsDir, spec.file);
        check(`${name}: ${spec.file} actually exists on disk`,
            fs.existsSync(filePath) && fs.statSync(filePath).size > 1000,
            `missing or truncated — the Dockerfile's verify-fonts.js build gate should have caught this too`);
    }
}

section('4 · Weight declared in CSS matches the actual static instance (R57)');
{
    // Every file here is a SINGLE static weight (no variable fonts, no separate
    // bold/italic cuts besides Montserrat-Bold and BarlowCondensed-Bold). If the
    // @font-face weight disagrees with FONT_SPECS, the browser may refuse to
    // match the face for the weight a caption actually requests.
    for (const [name, spec] of Object.entries(FONT_SPECS)) {
        const face = CSS_FACES[name];
        if (!face) continue;
        check(`${name}: @font-face weight (${face.weight}) matches FONT_SPECS (${spec.weight})`,
            face.weight === spec.weight);
    }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Caption fonts: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
