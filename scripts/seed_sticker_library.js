#!/usr/bin/env node
/**
 * scripts/seed_sticker_library.js
 *
 * R83 — Sticker/Icon/Emoji Asset Library. One-time (and re-runnable)
 * provisioning script: uploads the curated PNGs in
 * scripts/sticker-library-src/ to storage (GCS with the SAME local-disk
 * fallback every other upload in this app uses — see routes/projectRoutes.js
 * POST /:id/thumbnail, the pattern this script deliberately copies) and
 * upserts one `assets` + one `stickers` row per asset (server/audio-engine/
 * types.js's AssetType.STICKER — reserved since 20240002_asset_engine.sql,
 * never given a detail table until this migration).
 *
 * ─── SOURCING AND LICENSING (why these two packs, specifically) ────────────
 * Icons: Lucide (`lucide-static` npm package) — ISC license, no attribution
 * required, ships its own `tags.json` keyword file we use directly rather
 * than hand-tagging every icon.
 *
 * Emoji: Google's Noto Emoji, via `@svgmoji/noto` (npm) + `emojibase-data`
 * (npm, MIT, for keywords/group/subgroup) for metadata — Apache License 2.0
 * for the actual glyph artwork. Twemoji (Twitter, also genuinely free) was
 * considered and deliberately NOT used: Twemoji's graphics are CC-BY 4.0,
 * which requires attribution on every derivative work — for a video EXPORT
 * (the derivative work here), that would mean every exported video technically
 * needs a Twemoji credit. Apache-2.0 carries no such per-output obligation
 * (it requires preserving notices in redistributed SOURCE, which this
 * script's own header + the `creator`/`license`/`pack` columns already do),
 * making it the only one of the two that's actually practical for a video
 * product's exports. This is recorded here plainly, not glossed over — see
 * CLAUDE.md's R83 entry for the full reasoning.
 *
 * Both packs were rasterized to 512×512 transparent PNG (client/src/motion/
 * ComponentLibrary.js's R65 precedent: PNG not SVG, because the export
 * ffmpeg pipeline is not guaranteed to be built with librsvg support).
 *
 * ─── IDEMPOTENT BY DESIGN ────────────────────────────────────────────────────
 * Upserts on `assets.name` (already `unique` in 20240002_asset_engine.sql) —
 * re-running this script after the manifest grows (more curated assets added
 * later) only inserts what's new; it never duplicates or errors on what's
 * already there.
 *
 * ─── PREREQUISITE ────────────────────────────────────────────────────────────
 * supabase/migrations/20240009_sticker_library.sql MUST be applied first
 * (this project's own convention is the Supabase Dashboard SQL Editor — see
 * STAGING_SETUP.md — there is no `supabase` CLI or direct DB connection
 * string configured in this environment to apply it automatically). This
 * script checks for the `stickers` table up front and fails with a clear,
 * actionable message rather than a confusing insert error if it's missing.
 *
 * Run: node scripts/seed_sticker_library.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { supabaseAdmin } = require('../config/database.js');
const storageConfig = require('../config/storage.js');

const SRC_DIR = path.join(__dirname, 'sticker-library-src');
const MANIFEST_PATH = path.join(SRC_DIR, 'manifest.json');

async function checkTableExists() {
    const { error } = await supabaseAdmin.from('stickers').select('id').limit(1);
    if (error && /relation .* does not exist/i.test(error.message || '')) {
        return false;
    }
    if (error) throw new Error(`Unexpected error checking stickers table: ${error.message}`);
    return true;
}

async function uploadPng(entry, buffer) {
    const objectPath = `sticker-library/${entry.sticker_kind}/${entry.name}.png`;

    if (storageConfig.bucket && !storageConfig.useLocalStorage) {
        const file = storageConfig.bucket.file(objectPath);
        await file.save(buffer, { contentType: 'image/png' });
        return `/api/proxy/gcs-media/${objectPath}`;
    }

    const uploadsDir = path.join(__dirname, '..', 'uploads', 'sticker-library', entry.sticker_kind);
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, `${entry.name}.png`), buffer);
    return `/uploads/sticker-library/${entry.sticker_kind}/${entry.name}.png`;
}

async function upsertAsset(entry, publicUrl, buffer) {
    const { data: assetRow, error: assetErr } = await supabaseAdmin
        .from('assets')
        .upsert({
            type:            'STICKER',
            name:            entry.name,
            display_name:    entry.display_name,
            description:     null,
            gcs_path:        publicUrl,
            preview_url:     publicUrl,
            thumbnail_url:   publicUrl,
            duration:        null,
            file_size:       buffer.length,
            mime_type:       'image/png',
            license:         entry.license,
            creator:         entry.creator,
            pack:            entry.pack,
            editing_intents: [],
            emotion_tags:    [],
            energy_level:    3,
            style:           [],
            search_keywords: entry.search_keywords || [],
            best_use_cases:  [],
            category:        entry.category,
            sub_category:    entry.sub_category,
            is_system:       true,
            is_active:       true,
        }, { onConflict: 'name' })
        .select('id')
        .single();

    if (assetErr) throw new Error(`assets upsert failed for "${entry.name}": ${assetErr.message}`);

    const { error: stickerErr } = await supabaseAdmin
        .from('stickers')
        .upsert({
            id:                         assetRow.id,
            sticker_kind:               entry.sticker_kind,
            unicode_codepoint:          entry.unicode_codepoint,
            native_width:               entry.native_width || 512,
            native_height:              entry.native_height || 512,
            has_transparent_bg:         true,
            compatible_timeline_events: [],
        }, { onConflict: 'id' });

    if (stickerErr) throw new Error(`stickers upsert failed for "${entry.name}": ${stickerErr.message}`);
}

async function main() {
    if (!fs.existsSync(MANIFEST_PATH)) {
        console.error(`✗ manifest not found at ${MANIFEST_PATH} — nothing to seed.`);
        process.exit(1);
    }

    const tableExists = await checkTableExists();
    if (!tableExists) {
        console.error(
            '✗ the "stickers" table does not exist yet.\n' +
            '  Apply supabase/migrations/20240009_sticker_library.sql first — ' +
            'this project\'s convention (see STAGING_SETUP.md) is to run it via ' +
            'the Supabase Dashboard → SQL Editor for whichever project this app ' +
            'points to, then re-run this script.'
        );
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    console.log(`Seeding ${manifest.length} sticker-library assets ` +
        `(storage: ${storageConfig.bucket && !storageConfig.useLocalStorage ? 'GCS' : 'local disk fallback'})...`);

    let ok = 0, failed = 0;
    for (const entry of manifest) {
        try {
            const pngPath = path.join(SRC_DIR, 'png', entry.png_file);
            const buffer = fs.readFileSync(pngPath);
            const publicUrl = await uploadPng(entry, buffer);
            await upsertAsset(entry, publicUrl, buffer);
            ok++;
        } catch (err) {
            failed++;
            console.error(`  ✗ ${entry.name}: ${err.message}`);
        }
    }

    console.log(`\n${ok} seeded, ${failed} failed (of ${manifest.length} total).`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
    console.error('[seed_sticker_library] fatal:', err.message);
    process.exit(1);
});
