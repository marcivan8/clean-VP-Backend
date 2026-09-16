/**
 * client/src/motion/StickerLibraryAdapter.js
 *
 * R83 — turns a sticker-library asset row (server/audio-engine/search/
 * TaxonomyService.js's getStickersByKeywords/getStickersByKind/
 * getStickerByName — a merged `assets` + `stickers` row) into an overlay
 * placement descriptor, the SAME shape `client/src/motion/
 * ComponentLibrary.js`'s R65 `graphicPlacement()` already produces for its 5
 * built-in graphics: `{ trackType: 'overlay', asset: {id, name, url}, clip }`.
 *
 * A separate small file rather than a change to ComponentLibrary.js on
 * purpose — that file's `GRAPHICS` map is a closed, hardcoded set of 5
 * committed PNGs; the sticker library is an open, growing, DATABASE-backed
 * set queried at runtime. Duplicating the placement SHAPE (not the
 * mechanism — this calls the same `applyPresetToClip`) keeps R65's tested
 * file untouched while giving this open set its own adapter. Same
 * "duplicate deliberately across a real boundary" precedent as
 * `AnimationKnowledgeGraph.js`'s server-side `layerKindForClip`.
 *
 * PURE, like every other file in `client/src/motion/`: no store, no
 * network, no React — takes a sticker row (already fetched) and params,
 * returns a plain placement descriptor. The caller (a future AI command, or
 * a manual "insert sticker" action) is responsible for actually dispatching
 * it via `addOverlayClip`/`addClip`, same division of labour as
 * `ComponentLibrary.buildComponent()`.
 *
 * ─── WHAT THIS DOES NOT DECIDE ──────────────────────────────────────────────
 * This file does not decide WHEN a sticker should be auto-inserted during
 * editing, or which keyword to search for at a given moment — those are real
 * product/taste calls (would the brain add a 💰 emoji on every mention of
 * money? every time?) that deserve their own scoping conversation, the same
 * way R78's b-roll matching and R80's (reverted) image generation each got
 * one before being wired into automatic placement. This file only makes an
 * already-found sticker PLACEABLE — closing the loop from "the library has
 * this asset" to "here's a clip descriptor for it" — not automatic.
 */

import { applyPresetToClip } from './ClipAdapter.js';

/**
 * @param {object} sticker — a merged row from TaxonomyService's sticker
 *   methods: needs at minimum `id`, `name`, and a URL field
 *   (`preview_url`/`gcs_path`/`thumbnail_url` — whichever is set; the seed
 *   script always sets all three to the same resolved URL).
 * @param {object} [opts]
 * @param {number} [opts.x=50] percent of frame
 * @param {number} [opts.y=50] percent of frame
 * @param {number} [opts.scale=1]
 * @param {number} [opts.rotation=0]
 * @param {number} [opts.duration=2] seconds
 * @param {?string} [opts.motionId] a real MotionPresets.js id (e.g. from
 *   R81/R82's AnimationKnowledgeGraph — `sticker-pop`, `bounce`, ...);
 *   omitted means no animation, a static overlay.
 * @param {number} [opts.intensity] — R81, passed through to `applyPresetToClip`
 * @param {?string} [opts.secondaryPresetId] — R82, passed through likewise
 * @returns {{trackType: 'overlay', asset: {id: string, name: string, url: string}, clip: object}|null}
 *   null when the sticker has no usable URL — callers must check.
 */
export function buildStickerPlacement(sticker, opts = {}) {
    if (!sticker) return null;
    const url = sticker.preview_url || sticker.gcs_path || sticker.thumbnail_url || null;
    if (!url) return null;

    const x = Number.isFinite(Number(opts.x)) ? Number(opts.x) : 50;
    const y = Number.isFinite(Number(opts.y)) ? Number(opts.y) : 50;
    const scale = Number.isFinite(Number(opts.scale)) ? Number(opts.scale) : 1;
    const rotation = Number.isFinite(Number(opts.rotation)) ? Number(opts.rotation) : 0;
    const duration = Number(opts.duration) > 0 ? Number(opts.duration) : 2;

    const anim = opts.motionId
        ? applyPresetToClip({ duration }, opts.motionId, {
            intensity: opts.intensity,
            secondaryPresetId: opts.secondaryPresetId,
        })
        : {};

    return {
        trackType: 'overlay',
        asset: {
            id:   sticker.id || `sticker-library-${sticker.name || 'unknown'}`,
            name: sticker.display_name || sticker.name || 'Sticker',
            url,
        },
        clip: { x, y, scale, rotation, duration, ...anim },
    };
}

export default { buildStickerPlacement };
