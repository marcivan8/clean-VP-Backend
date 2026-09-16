#!/usr/bin/env node
/**
 * Regression: R83 — Sticker/Icon/Emoji Asset Library.
 *
 * Covers:
 *   1. supabase/migrations/20240009_sticker_library.sql — the `stickers`
 *      table shape, matching the sound_effects/luts/presets precedent.
 *   2. scripts/sticker-library-src/manifest.json + the PNGs it references —
 *      every entry has the fields the seed script and DB schema require,
 *      no duplicate `name` (assets.name is UNIQUE), every referenced PNG
 *      file actually exists on disk, emoji entries carry a unicode_codepoint
 *      and icons don't, license/creator are set per real source pack.
 *   3. server/audio-engine/search/TaxonomyService.js — the three new
 *      sticker methods exist, query the right table/columns, and
 *      `_mergeStickers` is wired in.
 *   4. scripts/seed_sticker_library.js — uses the SAME GCS/local-fallback
 *      upload pattern as routes/projectRoutes.js's thumbnail upload (not a
 *      new one), upserts idempotently by name/id, and fails with a clear
 *      message rather than a confusing insert error when the migration
 *      hasn't been applied yet.
 *   5. client/src/motion/StickerLibraryAdapter.js's `buildStickerPlacement`
 *      — REAL end-to-end evaluation (not just source regex) via the same
 *      CJS-strip-eval technique test_animation_combiner.js established,
 *      confirming it returns R65 ComponentLibrary's exact placement shape,
 *      resolves whichever URL field is present, returns null with no URL,
 *      and passes intensity/secondaryPresetId through to applyPresetToClip.
 *
 * Run: node scripts/test_sticker_library.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};

section('1 · migration — supabase/migrations/20240009_sticker_library.sql');
{
    const sql = read('supabase/migrations/20240009_sticker_library.sql');
    check('creates a stickers table', /create table if not exists stickers/i.test(sql));
    check('id references assets(id) — same 1:1 detail-table shape as sound_effects/luts/presets',
        /id\s+uuid primary key references assets\(id\) on delete cascade/i.test(sql));
    check('sticker_kind is constrained to icon|emoji',
        /sticker_kind\s+text not null check \(sticker_kind in \('icon', 'emoji'\)\)/i.test(sql));
    check('has a unicode_codepoint column (nullable — icons never set it)',
        /unicode_codepoint\s+text/i.test(sql));
    check('enables row level security', /alter table stickers enable row level security/i.test(sql));
    check('has a public-read policy for authenticated users (matches sound_effects/luts/presets)',
        /create policy "stickers_public_read"[\s\S]{0,150}to authenticated/i.test(sql));
}

section('2 · manifest — scripts/sticker-library-src/manifest.json + referenced PNGs');
{
    const manifestPath = path.join(ROOT, 'scripts/sticker-library-src/manifest.json');
    let manifest = [];
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
        failed++;
        console.log(`  ✗ could not read/parse manifest.json — ${err.message}`);
    }

    check('manifest is a non-empty array', Array.isArray(manifest) && manifest.length > 0);
    check('manifest size is within the curated-starter-set range (50-150, per the user\'s chosen scope)',
        manifest.length >= 50 && manifest.length <= 150, `actual: ${manifest.length}`);

    const requiredFields = ['sticker_kind', 'name', 'display_name', 'category', 'search_keywords', 'license', 'creator', 'pack', 'png_file'];
    const missingFields = [];
    for (const entry of manifest) {
        for (const field of requiredFields) {
            if (entry[field] === undefined) missingFields.push(`${entry.name || '?'}.${field}`);
        }
    }
    check('every entry has all required fields', missingFields.length === 0, missingFields.slice(0, 10).join(', '));

    const names = manifest.map((e) => e.name);
    const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
    check('no duplicate `name` values (assets.name is UNIQUE — a dupe would break the seed upsert)',
        dupeNames.length === 0, [...new Set(dupeNames)].join(', '));

    const badEmoji = manifest.filter((e) => e.sticker_kind === 'emoji' && !e.unicode_codepoint);
    check('every emoji entry has a unicode_codepoint', badEmoji.length === 0,
        badEmoji.map((e) => e.name).join(', '));
    const badIcons = manifest.filter((e) => e.sticker_kind === 'icon' && e.unicode_codepoint);
    check('no icon entry has a unicode_codepoint (icons are not emoji)', badIcons.length === 0,
        badIcons.map((e) => e.name).join(', '));

    const licenses = new Set(manifest.map((e) => e.license));
    check('only the two expected, real source licenses are present (ISC=Lucide, Apache-2.0=Noto)',
        [...licenses].every((l) => l === 'ISC' || l === 'Apache-2.0'), [...licenses].join(', '));

    const missingPngs = [];
    for (const entry of manifest) {
        const pngPath = path.join(ROOT, 'scripts/sticker-library-src/png', entry.png_file || '');
        if (!entry.png_file || !fs.existsSync(pngPath)) missingPngs.push(entry.name);
    }
    check('every manifest entry\'s png_file actually exists on disk', missingPngs.length === 0,
        missingPngs.slice(0, 10).join(', '));

    const iconCount = manifest.filter((e) => e.sticker_kind === 'icon').length;
    const emojiCount = manifest.filter((e) => e.sticker_kind === 'emoji').length;
    check('both icons and emoji are present (the two asset types chosen for this pass)',
        iconCount > 0 && emojiCount > 0, `icons=${iconCount} emoji=${emojiCount}`);
}

section('3 · TaxonomyService.js — sticker query methods');
{
    const src = read('server/audio-engine/search/TaxonomyService.js');
    check('getStickersByKeywords exists and queries assets joined to stickers',
        /async getStickersByKeywords\(keywords, kindFilter = null, limit = 10\)/.test(src) &&
        /\.from\('assets'\)\s*\.select\(`\*, stickers!inner \(\*\)`\)/.test(src));
    check('getStickersByKeywords filters by AssetType.STICKER and overlaps search_keywords',
        /\.eq\('type', AssetType\.STICKER\)/.test(src) && /\.overlaps\('search_keywords', keywords\)/.test(src));
    check('getStickersByKind exists and filters by stickers.sticker_kind',
        /async getStickersByKind\(kind, limit = 20\)/.test(src) && /\.eq\('stickers\.sticker_kind', kind\)/.test(src));
    check('getStickerByName exists', /async getStickerByName\(name\)/.test(src));
    check('_mergeStickers exists and flattens the stickers sub-object',
        /_mergeStickers\(rows\)/.test(src) && /const \{ stickers: _ignored, \.\.\.base \} = row;/.test(src));
    check('the class header documents the new Sticker method group',
        /Sticker — getStickersByKeywords, getStickersByKind, getStickerByName \(R83\)/.test(src));
}

section('4 · seed_sticker_library.js — storage pattern + idempotency + clear failure mode');
{
    const src = read('scripts/seed_sticker_library.js');
    check('uses the SAME GCS/local-fallback condition as routes/projectRoutes.js\'s thumbnail upload',
        /storageConfig\.bucket && !storageConfig\.useLocalStorage/.test(src));
    check('GCS path is served through the existing proxy, never a direct bucket URL',
        /\/api\/proxy\/gcs-media\//.test(src));
    check('local fallback writes under uploads/, served via /uploads/...',
        /uploads/.test(src) && /\/uploads\/sticker-library\//.test(src));
    // Bounded lookahead from each table's .from(...) call, not from the bare
    // .upsert({ itself — the assets object alone runs ~20 fields long (930
    // chars in the real file), so a tight bound anchored only on ".upsert({"
    // false-negatived here before; anchoring on ".from('assets'|'stickers')"
    // first keeps the check honest about WHICH upsert it's matching, and a
    // generous 2000-char window tolerates the object growing further.
    check('upserts assets onConflict: name (idempotent re-runs)',
        /\.from\('assets'\)[\s\S]{0,80}\.upsert\(\{[\s\S]{0,2000}\}, \{ onConflict: 'name' \}\)/.test(src));
    check('upserts stickers onConflict: id',
        /\.from\('stickers'\)[\s\S]{0,80}\.upsert\(\{[\s\S]{0,2000}\}, \{ onConflict: 'id' \}\)/.test(src));
    check('checks the stickers table exists before seeding, with an actionable message if not',
        /checkTableExists/.test(src) && /Apply supabase\/migrations\/20240009_sticker_library\.sql first/.test(src));
    check('type is set to STICKER on every asset row', /type:\s*'STICKER',/.test(src));
}

// ── Build the REAL applyPresetToClip + StickerLibraryAdapter via strip-eval ──
function stripModuleSyntax(src) {
    return src
        .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function)\b/g, '$1');
}

let schemaSrc = stripModuleSyntax(read('client/src/motion/MotionSchema.js')).replace(/\bclamp\(/g, '__clamp(');
let presetsSrc = stripModuleSyntax(read('client/src/motion/MotionPresets.js'));
let synthSrc = stripModuleSyntax(read('client/src/motion/AnimationSynthesizer.js'));
const clipAdapterFullSrc = read('client/src/motion/ClipAdapter.js');
const applyMatch = clipAdapterFullSrc.match(/export function applyPresetToClip\(clip, presetId, opts = \{\}\) \{[\s\S]*?\n\}/);
const adapterSrc = stripModuleSyntax(read('client/src/motion/StickerLibraryAdapter.js'))
    .replace(/^import \{ applyPresetToClip \} from '\.\/ClipAdapter\.js';\s*$/m, '');

let buildStickerPlacement = null;
if (applyMatch) {
    const applyFnSrc = applyMatch[0].replace(/^export function/, 'function');
    const harness = `
        const __clamp = (v, min, max) => Math.max(min, Math.min(max, v));
        ${schemaSrc}
        ${presetsSrc}
        ${synthSrc}
        ${applyFnSrc}
        ${adapterSrc}
        return { buildStickerPlacement };
    `;
    try {
        // eslint-disable-next-line no-new-func
        ({ buildStickerPlacement } = new Function(harness)());
    } catch (err) {
        failed++;
        console.log(`  ✗ could not evaluate StickerLibraryAdapter.js end-to-end — ${err.message}`);
    }
} else {
    failed++;
    console.log('  ✗ could not locate applyPresetToClip in ClipAdapter.js for the strip-eval harness');
}

section('5 · buildStickerPlacement — REAL end-to-end evaluation');
{
    if (typeof buildStickerPlacement === 'function') {
        check('null sticker → null', buildStickerPlacement(null) === null);

        const noUrlSticker = { id: 's1', name: 'icon-heart', display_name: 'Heart' };
        check('a sticker with no URL field at all → null (never a broken placement)',
            buildStickerPlacement(noUrlSticker) === null);

        const sticker = { id: 's1', name: 'icon-heart', display_name: 'Heart', preview_url: '/uploads/sticker-library/icon/icon-heart.png' };
        const placement = buildStickerPlacement(sticker, { duration: 3 });
        check('matches R65 ComponentLibrary\'s exact placement shape (trackType/asset/clip)',
            placement && placement.trackType === 'overlay' &&
            placement.asset?.id === 's1' && placement.asset?.name === 'Heart' &&
            placement.asset?.url === '/uploads/sticker-library/icon/icon-heart.png' &&
            typeof placement.clip === 'object');
        check('defaults x/y to 50 (center), scale to 1, rotation to 0',
            placement.clip.x === 50 && placement.clip.y === 50 && placement.clip.scale === 1 && placement.clip.rotation === 0);
        check('duration is passed through', placement.clip.duration === 3);
        check('with no motionId: no animation fields added (static overlay)',
            placement.clip.animations === undefined && placement.clip.animation === undefined);

        const animated = buildStickerPlacement(sticker, { duration: 2, motionId: 'sticker-pop', intensity: 0.9, secondaryPresetId: 'wiggle' });
        check('with a motionId: applyPresetToClip actually runs — animations present, includes BOTH primary and secondary',
            Array.isArray(animated.clip.animations) && animated.clip.animations.length === 2 &&
            animated.clip.animations.some((a) => a.presetId === 'sticker-pop') &&
            animated.clip.animations.some((a) => a.presetId === 'wiggle'));

        const fallbackUrlSticker = { id: 's2', name: 'emoji-fire', gcs_path: 'sticker-library/emoji/emoji-fire.png' };
        const fallbackPlacement = buildStickerPlacement(fallbackUrlSticker);
        check('falls back to gcs_path when preview_url is absent', fallbackPlacement?.asset?.url === 'sticker-library/emoji/emoji-fire.png');
    } else {
        failed++;
        console.log('  ✗ buildStickerPlacement was not evaluable — skipping section 5');
    }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
