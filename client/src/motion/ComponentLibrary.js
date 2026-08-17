/**
 * client/src/motion/ComponentLibrary.js
 *
 * R65 — Motion Graphics Components: named, preset-driven building blocks
 * (AnimatedText, AnimatedImage, AnimatedSticker, AnimatedEmoji, AnimatedArrow,
 * LowerThird, Callout, QuoteCard, CTAWidget) meant to be callable by name from
 * an AI tool call — `{ component: "CTAWidget", preset: "subscribe" }` — the
 * same way a person would pick a look from a picker, not by hand-authoring
 * clip fields.
 *
 * PURE, like every other file in this directory: no React, no DOM, no store,
 * no network. `buildComponent()` takes a component id, a preset id and a
 * params bag, and returns PLACEMENT DESCRIPTORS — plain objects describing
 * what clip(s) to add and to which kind of track — never touching
 * `useTimelineStore` itself. `useTimelineStore.addMotionComponent()` is the
 * (small, separate) integration layer that turns a placement into a real
 * `addClip` call. Same split as `Compositor.js`/`CaptionCompiler.js`
 * (client decides WHAT, a thin caller decides how to apply it) for the same
 * reason: a pure function is unit-testable without a store, a DOM, or React.
 *
 * ─── WHY 5 OF THE 9 ARE ONE CLIP AND 4 ARE TWO-OR-THREE ────────────────────
 * AnimatedText/Image/Sticker/Emoji/Arrow map onto a SINGLE existing clip kind
 * (text, or an overlay-track sticker/image) plus a motion preset — nothing
 * new to render. LowerThird/Callout/QuoteCard/CTAWidget are actually a
 * background graphic PLUS text (QuoteCard: graphic + quote + optional
 * attribution). At R65 this codebase had no clip-GROUPING model at all, so
 * these shipped as independent clips added together — moving the background
 * didn't move the text with it, an explicitly stated scope limit at the
 * time. R66 (`ClipGrouping.js`) closed that: any component whose
 * `buildComponent()` result has more than one placement is now stamped with
 * a shared `groupId` via `assignGroupId()` before it's returned — every
 * composite component IS a real, moveable/deletable/duplicable group from
 * the moment it's created. The 5 single-clip components are unaffected
 * (`assignGroupId` is a no-op below 2 placements).
 *
 * ─── WHERE THE GRAPHICS COME FROM ──────────────────────────────────────────
 * AnimatedArrow/LowerThird/Callout/QuoteCard/CTAWidget need a graphic this
 * app has never had (no built-in icon/shape library existed before this —
 * "sticker" meant user-uploaded images only). Rather than inventing a new
 * SVG/canvas shape renderer (a stubbed `LAYER_KINDS.SHAPE` has existed with
 * zero implementation since R58) or a new asset-upload code path, five small
 * PNG files are committed to `client/public/motion-assets/` and referenced
 * by ordinary relative URL — the exact same "commit real files, serve them
 * statically" precedent already used for this app's 44 bundled font TTFs
 * (see ADR-001 Phase 5). They flow through `addClip`'s EXISTING sticker/
 * image-on-the-overlay-track path (R62) end to end: same DOM preview
 * (`GraphicOverlay.jsx`), same compositor (`Compositor.js`), same export
 * (`exportProcessor.js` STEP 2.5) — zero new rendering code. PNG rather than
 * SVG deliberately: SVG decoding needs a librsvg-enabled ffmpeg build, which
 * is not guaranteed on the deployed binary; PNG has no such dependency.
 */

import { applyPresetToClip } from './ClipAdapter.js';
import { assignGroupId } from './ClipGrouping.js';

/** Relative URL into the app's own static assets — resolved to absolute the
 *  same way every other clip URL in this app already is (see project.tsx's
 *  `fixUrl`), and downloaded by the export worker's existing "absolute HTTP
 *  URL" fetch path once resolved — no new server code required. */
const asset = (file) => `/motion-assets/${file}`;

const GRAPHICS = {
    arrow:           { url: asset('arrow.png') },
    barDark:         { url: asset('bar-dark.png') },
    barLight:        { url: asset('bar-light.png') },
    quoteMark:       { url: asset('quote-mark.png') },
    subscribeBadge:  { url: asset('subscribe-badge.png') },
};

/** direction → degrees, so AnimatedArrow needs exactly ONE source graphic
 *  (drawn pointing right) and reuses the existing, already-animatable
 *  `rotation` property instead of four separate pre-rotated assets. */
const ARROW_DIRECTIONS = { right: 0, down: 90, left: 180, up: 270 };

/**
 * Each component's preset catalogue. `motion` is a real `MotionPresets.js`
 * id (reused as-is, via `applyPresetToClip` — the exact function `MotionPanel`
 * itself calls) — components never invent their own animation math. Extra
 * fields (`bar`, `badge`, `textColor`, `label`) are this component's own
 * visual-style knobs, not part of the motion engine.
 */
export const COMPONENT_PRESETS = {
    AnimatedText: {
        fade:        { motion: 'fade' },
        pop:         { motion: 'pop' },
        'slide-up':  { motion: 'slide-up' },
        typewriter:  { motion: 'typewriter' },
    },
    AnimatedImage: {
        'ken-burns': { motion: 'ken-burns' },
        zoom:        { motion: 'zoom' },
        pan:         { motion: 'pan' },
        float:       { motion: 'float' },
    },
    AnimatedSticker: {
        pop:    { motion: 'sticker-pop' },
        bounce: { motion: 'bounce' },
        pulse:  { motion: 'pulse' },
        wiggle: { motion: 'wiggle' },
    },
    AnimatedEmoji: {
        pop:    { motion: 'sticker-pop' },
        bounce: { motion: 'bounce' },
        pulse:  { motion: 'pulse' },
    },
    AnimatedArrow: {
        point:  { motion: 'sticker-pop' },
        bounce: { motion: 'bounce' },
        wiggle: { motion: 'wiggle' },
    },
    LowerThird: {
        dark:  { motion: 'slide-up', bar: 'barDark',  textColor: '#ffffff' },
        light: { motion: 'slide-up', bar: 'barLight', textColor: '#111111' },
    },
    Callout: {
        dark:  { motion: 'pop', bar: 'barDark',  textColor: '#ffffff' },
        light: { motion: 'pop', bar: 'barLight', textColor: '#111111' },
    },
    QuoteCard: {
        classic: { motion: 'fade', textColor: '#ffffff' },
    },
    CTAWidget: {
        subscribe: { motion: 'sticker-pop', badge: 'subscribeBadge', label: 'Subscribe', textColor: '#ffffff' },
        follow:    { motion: 'sticker-pop', badge: 'subscribeBadge', label: 'Follow',    textColor: '#ffffff' },
    },
};

export const COMPONENT_IDS = Object.keys(COMPONENT_PRESETS);

const DEFAULT_DURATION = {
    AnimatedText: 3, AnimatedImage: 4, AnimatedSticker: 3, AnimatedEmoji: 2,
    AnimatedArrow: 2.5, LowerThird: 4, Callout: 3, QuoteCard: 4, CTAWidget: 3,
};

function resolvePreset(componentId, presetId) {
    const catalogue = COMPONENT_PRESETS[componentId];
    if (!catalogue) return null;
    return catalogue[presetId] || catalogue[Object.keys(catalogue)[0]] || null;
}

/** A text-track placement. `motionId` is a MotionPresets id or null/'none'. */
function textPlacement({ content, x = 50, y = 50, fontSize = 56, color = '#ffffff', fontWeight, duration, motionId, extra = {} }) {
    const anim = motionId ? applyPresetToClip({ duration }, motionId) : {};
    return {
        trackType: 'text',
        clip: { type: 'text', content, x, y, fontSize, color, fontWeight, duration, ...extra, ...anim },
    };
}

/** An overlay-track placement, using one of the built-in GRAPHICS. */
function graphicPlacement({ graphicKey, url, x = 50, y = 50, scale = 1, rotation = 0, duration, motionId }) {
    const g = graphicKey ? GRAPHICS[graphicKey] : null;
    const resolvedUrl = g ? g.url : url;
    const anim = motionId ? applyPresetToClip({ duration }, motionId) : {};
    return {
        trackType: 'overlay',
        asset: { id: `motion-component-${graphicKey || 'custom'}`, name: graphicKey || 'Overlay', url: resolvedUrl },
        clip: { x, y, scale, rotation, duration, ...anim },
    };
}

/**
 * Build the placement list for one component instance.
 *
 * @param {string} componentId one of COMPONENT_IDS
 * @param {string} presetId a key in COMPONENT_PRESETS[componentId] (falls back to the first preset)
 * @param {object} [params] component-specific content: text/url/emoji/direction/x/y/duration/fontSize/color/scale...
 * @returns {{ placements: Array, error?: string }} placements is [] on any failure — callers must check
 */
export function buildComponent(componentId, presetId, params = {}) {
    const preset = resolvePreset(componentId, presetId);
    if (!preset) {
        return { placements: [], error: `unknown component "${componentId}"` };
    }

    const duration = Number(params.duration) > 0 ? Number(params.duration) : DEFAULT_DURATION[componentId];
    const x = Number.isFinite(Number(params.x)) ? Number(params.x) : 50;
    const y = Number.isFinite(Number(params.y)) ? Number(params.y) : 50;
    const fontSize = Number(params.fontSize) > 0 ? Number(params.fontSize) : undefined;

    // R66 — every composite component (2+ placements) comes out of the
    // switch below GROUPED, via ClipGrouping.assignGroupId (a no-op for the
    // 5 single-clip components, since it only stamps a groupId when there's
    // more than one placement to group). Wrapped in an IIFE so every
    // existing `return { placements, error }` inside the switch keeps
    // working unmodified — this only touches what happens to the result.
    const result = (() => {
    switch (componentId) {
        case 'AnimatedText':
            return { placements: [textPlacement({
                content: params.text || 'Your text here', x, y, duration, motionId: preset.motion,
                fontSize: fontSize || 56, color: params.color,
            })] };

        case 'AnimatedImage':
        case 'AnimatedSticker':
            // Neither has a built-in graphic — this app has never had an icon/
            // photo library, only user uploads. `params.url` must point at a
            // real, already-uploaded asset; that is exactly the R62 overlay
            // pipeline these two reuse verbatim.
            if (!params.url) return { placements: [], error: `${componentId} requires params.url (no built-in image library exists — see file header)` };
            return { placements: [graphicPlacement({
                url: params.url, x, y, duration, motionId: preset.motion,
                scale: Number(params.scale) > 0 ? Number(params.scale) : 1,
            })] };

        case 'AnimatedEmoji':
            // An emoji is just a glyph — rendered as a big TEXT clip rather
            // than needing an emoji-image library. System/browser emoji fonts
            // already render these glyphs; nothing new to build.
            if (!params.emoji) return { placements: [], error: 'AnimatedEmoji requires params.emoji' };
            return { placements: [textPlacement({
                content: params.emoji, x, y, duration, motionId: preset.motion, fontSize: fontSize || 96,
            })] };

        case 'AnimatedArrow': {
            const rotation = ARROW_DIRECTIONS[params.direction] ?? (Number.isFinite(Number(params.rotation)) ? Number(params.rotation) : 0);
            return { placements: [graphicPlacement({
                graphicKey: 'arrow', x, y, duration, motionId: preset.motion, rotation,
                scale: Number(params.scale) > 0 ? Number(params.scale) : 1,
            })] };
        }

        case 'LowerThird': {
            const title = params.title || 'Name';
            const placements = [
                graphicPlacement({ graphicKey: preset.bar, x: 50, y: 88, duration, motionId: preset.motion }),
                textPlacement({
                    content: title, x: 50, y: 87, duration, motionId: preset.motion,
                    color: preset.textColor, fontSize: fontSize || 40, fontWeight: 700,
                }),
            ];
            if (params.subtitle) {
                placements.push(textPlacement({
                    content: params.subtitle, x: 50, y: 92, duration, motionId: preset.motion,
                    color: preset.textColor, fontSize: (fontSize || 40) * 0.55,
                }));
            }
            return { placements };
        }

        case 'Callout': {
            if (!params.text) return { placements: [], error: 'Callout requires params.text' };
            return { placements: [
                graphicPlacement({ graphicKey: preset.bar, x, y, duration, motionId: preset.motion }),
                textPlacement({
                    content: params.text, x, y, duration, motionId: preset.motion,
                    color: preset.textColor, fontSize: fontSize || 36,
                }),
            ] };
        }

        case 'QuoteCard': {
            const quote = params.quote || '"Quote goes here"';
            const placements = [
                graphicPlacement({ graphicKey: 'quoteMark', x: 50, y: 28, duration, motionId: 'fade', scale: 0.6 }),
                textPlacement({
                    content: quote, x: 50, y: 50, duration, motionId: preset.motion,
                    color: preset.textColor, fontSize: fontSize || 44,
                }),
            ];
            if (params.author) {
                placements.push(textPlacement({
                    content: `— ${params.author}`, x: 50, y: 68, duration, motionId: 'fade',
                    color: preset.textColor, fontSize: (fontSize || 44) * 0.5,
                }));
            }
            return { placements };
        }

        case 'CTAWidget': {
            return { placements: [
                graphicPlacement({
                    graphicKey: preset.badge, x: 50, y: 46, duration, motionId: preset.motion,
                    scale: Number(params.scale) > 0 ? Number(params.scale) : 1,
                }),
                textPlacement({
                    content: params.label || preset.label, x: 50, y: 66, duration, motionId: preset.motion,
                    color: preset.textColor, fontSize: fontSize || 32, fontWeight: 700,
                }),
            ] };
        }

        default:
            return { placements: [], error: `unknown component "${componentId}"` };
    }
    })();

    if (result.error || !Array.isArray(result.placements) || result.placements.length === 0) return result;
    return { placements: assignGroupId(result.placements) };
}

export default { COMPONENT_IDS, COMPONENT_PRESETS, buildComponent };
