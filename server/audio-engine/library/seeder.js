'use strict';

/**
 * server/audio-engine/library/seeder.js
 *
 * Seeds the Supabase DB with system SFX, LUTs, and Presets.
 * Safe to re-run — uses upsert (on_conflict: name).
 *
 * Usage:
 *   node server/audio-engine/library/seeder.js
 *   NODE_ENV=production node server/audio-engine/library/seeder.js
 *
 * Requires:
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (same as main app).
 */

require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const { SFX_LIBRARY }    = require('./starterLibrary.js');
const { LUT_LIBRARY }    = require('./starterLUTs.js');
const { PRESET_LIBRARY } = require('./systemPresets.js');
const { AssetType }      = require('../types.js');

// ── Supabase admin client ─────────────────────────────────────────────────────

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Upsert a list of base asset records into the `assets` table.
 * Returns a map of name → uuid from the inserted rows.
 *
 * @param {Array<Object>} records
 * @returns {Promise<Record<string, string>>} name → id
 */
async function upsertAssets(records) {
    const rows = records.map(r => ({
        type:                   r.type,
        name:                   r.name,
        display_name:           r.displayName,
        description:            r.description || null,
        gcs_path:               r.gcsPath || null,
        preview_url:            r.previewUrl || null,
        thumbnail_url:          r.thumbnailUrl || null,
        duration:               r.duration || null,
        file_size:              r.fileSize || null,
        mime_type:              r.mimeType || null,
        license:                r.license || 'royalty_free',
        creator:                r.creator || null,
        pack:                   r.pack || null,
        editing_intents:        r.editingIntents || [],
        emotion_tags:           r.emotionTags    || [],
        energy_level:           r.energyLevel    || 3,
        style:                  r.style          || [],
        search_keywords:        r.searchKeywords || [],
        best_use_cases:         r.bestUseCases   || [],
        category:               r.category       || null,
        sub_category:           r.subCategory    || null,
        embedding:              null,
        use_count:              r.useCount    || 0,
        favorite_count:         r.favoriteCount || 0,
        is_system:              true,
        is_active:              true,
    }));

    const { data, error } = await supabase
        .from('assets')
        .upsert(rows, { onConflict: 'name', ignoreDuplicates: false })
        .select('id, name');

    if (error) throw new Error(`upsertAssets failed: ${error.message}`);

    const nameToId = {};
    (data || []).forEach(row => { nameToId[row.name] = row.id; });
    return nameToId;
}

/**
 * Seed the sound_effects child table.
 */
async function seedSoundEffects(sfxList, nameToId) {
    const rows = sfxList.map(sfx => ({
        id:                         nameToId[sfx.name],
        loudness_lufs:              sfx.loudnessLUFS || -20,
        peak_db:                    sfx.peakDB || -3,
        sample_rate:                sfx.sampleRate || 44100,
        channels:                   sfx.channels || 2,
        bit_depth:                  sfx.bitDepth || 24,
        has_attack:                 sfx.hasAttack ?? true,
        has_release:                sfx.hasRelease ?? true,
        is_tonal:                   sfx.isTonal ?? false,
        is_pitchable:               sfx.isPitchable ?? false,
        recommended_volume:         sfx.recommendedVolume ?? 0.8,
        recommended_fade_in:        sfx.recommendedFadeIn || 0,
        recommended_fade_out:       sfx.recommendedFadeOut || 0,
        offset_from_event:          sfx.offsetFromEvent || 0,
        placement_strategy:         sfx.placementStrategy || 'on_event',
        similar_sound_ids:          [],
        complementary_sound_ids:    [],
        compatible_timeline_events: sfx.compatibleTimelineEvents || [],
    })).filter(r => r.id); // skip any whose asset upsert may have failed

    if (rows.length === 0) return;

    const { error } = await supabase
        .from('sound_effects')
        .upsert(rows, { onConflict: 'id' });

    if (error) throw new Error(`seedSoundEffects failed: ${error.message}`);
}

/**
 * Seed the luts child table.
 */
async function seedLUTs(lutList, nameToId) {
    const rows = lutList.map(lut => ({
        id:                         nameToId[lut.name],
        format:                     lut.format || 'cube',
        dimensions:                 lut.dimensions || 33,
        color_space:                lut.colorSpace || 'rec709',
        input_color_space:          lut.inputColorSpace || 'rec709',
        output_color_space:         lut.outputColorSpace || 'srgb',
        warmth:                     lut.warmth || 0,
        contrast:                   lut.contrast || 0,
        saturation:                 lut.saturation || 0,
        highlights:                 lut.highlights || 0,
        shadows:                    lut.shadows || 0,
        cinematic:                  lut.cinematic ?? false,
        css_filter_preview:         lut.cssFilterPreview,         // NOT NULL
        suitable_content_types:     lut.suitableContentTypes || [],
        suitable_lighting_conditions: lut.suitableLightingConditions || [],
        platform_suggestions:       lut.platformSuggestions || [],
        pairs_with:                 [],
    })).filter(r => r.id && r.css_filter_preview);

    if (rows.length === 0) return;

    const { error } = await supabase
        .from('luts')
        .upsert(rows, { onConflict: 'id' });

    if (error) throw new Error(`seedLUTs failed: ${error.message}`);
}

/**
 * Seed the presets child table.
 */
async function seedPresets(presetList, nameToId) {
    const rows = presetList.map(preset => ({
        id:               nameToId[preset.name],
        preset_type:      preset.presetType,
        settings:         preset.settings || {},
        command_sequence: preset.commandSequence || null,
        is_public:        preset.isPublic ?? true,
        saved_count:      preset.savedCount || 0,
    })).filter(r => r.id);

    if (rows.length === 0) return;

    const { error } = await supabase
        .from('presets')
        .upsert(rows, { onConflict: 'id' });

    if (error) throw new Error(`seedPresets failed: ${error.message}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
    console.log('[seeder] Starting Creative Asset seed…');

    // ── SFX
    console.log(`[seeder] Upserting ${SFX_LIBRARY.length} SFX assets…`);
    const sfxNameToId = await upsertAssets(SFX_LIBRARY);
    await seedSoundEffects(SFX_LIBRARY, sfxNameToId);
    console.log(`[seeder] SFX done — ${Object.keys(sfxNameToId).length} rows`);

    // ── LUTs (asset rows first, then luts child)
    const lutAssetRows = LUT_LIBRARY.map(l => ({ ...l, type: AssetType.LUT }));
    console.log(`[seeder] Upserting ${lutAssetRows.length} LUT assets…`);
    const lutNameToId = await upsertAssets(lutAssetRows);
    await seedLUTs(LUT_LIBRARY, lutNameToId);
    console.log(`[seeder] LUTs done — ${Object.keys(lutNameToId).length} rows`);

    // ── Presets
    const presetAssetRows = PRESET_LIBRARY.map(p => ({ ...p, type: AssetType.LUT }));
    console.log(`[seeder] Upserting ${presetAssetRows.length} Preset assets…`);
    const presetNameToId = await upsertAssets(presetAssetRows);
    await seedPresets(PRESET_LIBRARY, presetNameToId);
    console.log(`[seeder] Presets done — ${Object.keys(presetNameToId).length} rows`);

    console.log('[seeder] Seed complete.');
}

seed().catch(err => {
    console.error('[seeder] Fatal error:', err.message);
    process.exit(1);
});
