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
// R95 PHASE 2: the four designed components are composed as scenes and laid
// out for the real frame; see SceneComposer.js. The rest still build here.
import { composeComponentScene, COMPOSED_COMPONENTS } from './SceneComposer.js';
import { flattenScene } from './SceneSchema.js';
import { templateParams, templateSize, TEMPLATE_WIDTH_FRACTION } from './TemplateGraphics.js';
import { computeAccentBounds, fitTextToBox } from './TextMeasurement.js';

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
        dark:          { motion: 'slide-up', bar: 'barDark',  textColor: '#ffffff' },
        light:         { motion: 'slide-up', bar: 'barLight', textColor: '#111111' },
        'pro-minimal': { motion: 'slide-up', textColor: '#ffffff', accentColor: '#00E5FF' },
        'modern-line': { motion: 'slide-up', textColor: '#ffffff', accentColor: '#FFE500' },
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
    TitleSequence: {
        cinematic:     { motion: 'slide-up', accent: 'underline',     accentColor: '#FFE500', textColor: '#ffffff', subColor: '#E2E8F0' },
        'modern-bold': { motion: 'pop',      accent: 'highlight-box', accentColor: '#00E5FF', textColor: '#ffffff', subColor: '#E2E8F0' },
        minimal:       { motion: 'fade',     accent: 'underline',     accentColor: '#ffffff', textColor: '#ffffff', subColor: '#A0AEC0' },
    },
    KineticTitle: {
        punchy:  { motion: 'pop',         accent: 'burst',         accentColor: '#FFE500', textColor: '#FFE500', kickerColor: '#ffffff' },
        creator: { motion: 'sticker-pop', accent: 'highlight-box', accentColor: '#FF3B5C', textColor: '#ffffff', kickerColor: '#00E5FF' },
    },
    StatCallout: {
        'metric-callout': { motion: 'pop', accent: 'circle-callout', accentColor: '#00E5FF', statColor: '#00E5FF', labelColor: '#ffffff' },
        growth:           { motion: 'pop', accent: 'underline',      accentColor: '#10B981', statColor: '#10B981', labelColor: '#ffffff' },
    },
};

export const COMPONENT_IDS = Object.keys(COMPONENT_PRESETS);

const DEFAULT_DURATION = {
    AnimatedText: 3, AnimatedImage: 4, AnimatedSticker: 3, AnimatedEmoji: 2,
    AnimatedArrow: 2.5, LowerThird: 4, Callout: 3, QuoteCard: 4, CTAWidget: 3,
    TitleSequence: 4, KineticTitle: 3, StatCallout: 3.5,
};

function resolvePreset(componentId, presetId) {
    const catalogue = COMPONENT_PRESETS[componentId];
    if (!catalogue) return null;
    return catalogue[presetId] || catalogue[Object.keys(catalogue)[0]] || null;
}

/** A text-track placement. `motionId` is a MotionPresets id or null/'none'. */
function textPlacement({ content, x = 50, y = 50, fontSize = 56, color = '#ffffff', fontWeight, fontFamily, tracking, duration, motionId, delay = 0, extra = {} }) {
    const anim = motionId ? applyPresetToClip({ duration }, motionId, { delay }) : {};
    return {
        trackType: 'text',
        clip: {
            type: 'text',
            content,
            x,
            y,
            fontSize,
            color,
            fontWeight,
            ...(fontFamily ? { fontFamily } : {}),
            ...(tracking ? { tracking } : {}),
            duration,
            ...extra,
            ...anim,
        },
    };
}

/** An overlay-track placement, using one of the built-in GRAPHICS. */
function graphicPlacement({ graphicKey, url, x = 50, y = 50, scale = 1, rotation = 0, duration, motionId, delay = 0 }) {
    const g = graphicKey ? GRAPHICS[graphicKey] : null;
    const resolvedUrl = g ? g.url : url;
    const anim = motionId ? applyPresetToClip({ duration }, motionId, { delay }) : {};
    return {
        trackType: 'overlay',
        asset: { id: `motion-component-${graphicKey || 'custom'}`, name: graphicKey || 'Overlay', url: resolvedUrl },
        clip: { x, y, scale, rotation, duration, ...anim },
    };
}

/** An overlay-track placement using a procedural shape template (TemplateGraphics.js). */
function templatePlacement({ kind, params = {}, x = 50, y = 50, scale, rotation = 0, duration, motionId, delay = 0 }) {
    const p = templateParams(kind, params);
    const size = templateSize(kind, p);
    const anim = motionId ? applyPresetToClip({ duration }, motionId, { delay }) : {};
    const effectiveScale = scale !== undefined ? scale : ((TEMPLATE_WIDTH_FRACTION[kind] || 0.5) / 0.25);
    return {
        trackType: 'overlay',
        clip: {
            type: 'template',
            name: kind,
            template: { kind, params: p },
            metadata: { resolution: { w: size.w, h: size.h } },
            x,
            y,
            scale: effectiveScale,
            rotation,
            duration,
            ...anim,
        },
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
export function buildComponent(componentId, presetId, params = {}, opts = {}) {
    const preset = resolvePreset(componentId, presetId);
    if (!preset) {
        return { placements: [], error: `unknown component "${componentId}"` };
    }

    // ── R95 PHASE 2 ──────────────────────────────────────────────────────
    // The designed components are composed as a SCENE first: type sizes from
    // the frame's own scale, positions from measuring the text and stacking
    // it inside the usable rectangle, the accent measured from the text in
    // THIS frame, and staggered motion. Flattened here, so every existing
    // caller gets the better layout unchanged. `opts.aspectRatio` is what
    // makes it frame-aware — without it a graphic is laid out for 16:9, which
    // is how an accent ended up 83 % of the width of a vertical frame.
    if (COMPOSED_COMPONENTS.includes(componentId)) {
        const scene = composeComponentScene(componentId, presetId, params, opts);
        if (scene) return { placements: flattenScene(scene).placements, scene };
        // A composer that could not run must not lose the graphic: fall
        // through to the hand-built path below.
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
            const title = params.title || params.name || 'Name';
            if (preset.bar) {
                const placements = [
                    graphicPlacement({ graphicKey: preset.bar, x: 50, y: 88, duration, motionId: preset.motion }),
                    textPlacement({
                        content: title, x: 50, y: 87, duration, motionId: preset.motion,
                        color: preset.textColor, fontSize: fontSize || 40, fontWeight: 700,
                    }),
                ];
                if (params.subtitle || params.role) {
                    placements.push(textPlacement({
                        content: params.subtitle || params.role, x: 50, y: 92, duration, motionId: preset.motion,
                        color: preset.textColor, fontSize: (fontSize || 40) * 0.55,
                    }));
                }
                return { placements };
            }
            // Procedural shape variant (pro-minimal / modern-line)
            const accentShape = presetId === 'pro-minimal' ? 'underline' : 'highlight-box';
            const baseFontSize = fontSize || (presetId === 'pro-minimal' ? 42 : 40);
            const fitted = fitTextToBox(title, { maxWidth: 680, maxHeight: 120 }, {
                initialFontSize: baseFontSize,
                fontFamily: 'Inter',
                fontWeight: 700,
                allowWrap: false,
            });
            const effectiveNameFontSize = fitted.fontSize;
            const accent = computeAccentBounds(title, {
                shapeKind: accentShape,
                fontSize: effectiveNameFontSize,
                fontFamily: 'Inter',
                fontWeight: 700,
            });
            const placements = [
                templatePlacement({
                    kind: accentShape,
                    params: { color: params.accentColor || preset.accentColor, thickness: accent.thickness, w: accent.w, h: accent.h },
                    scale: accent.scale,
                    x: 50, y: 90, duration, motionId: preset.motion, delay: 0.0,
                }),
                textPlacement({
                    content: title, x: 50, y: 86, duration, motionId: preset.motion, delay: 0.10,
                    color: params.color || preset.textColor, fontSize: effectiveNameFontSize, fontWeight: 700,
                }),
            ];
            if (params.subtitle || params.role) {
                placements.push(textPlacement({
                    content: params.subtitle || params.role, x: 50, y: 92, duration, motionId: preset.motion, delay: 0.20,
                    color: params.subColor || '#CBD5E1', fontSize: Math.round(effectiveNameFontSize * 0.52), fontWeight: 500,
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

        case 'TitleSequence': {
            const title = params.title || params.headline || params.text || 'THE HEADLINE';
            // Only what the user asked for: no invented supporting line.
            const subtitle = params.subtitle || params.sub || null;
            const kicker = params.kicker || null;
            const placements = [];

            // 1. Auto-fit headline into reference frame box (max 880px wide)
            const initialFontSize = fontSize || 56;
            const fitted = fitTextToBox(title, { maxWidth: 880, maxHeight: 180 }, {
                initialFontSize,
                fontFamily: 'Montserrat',
                fontWeight: 800,
                allowWrap: false,
            });
            const effectiveTitleFontSize = fitted.fontSize;

            // 2. Measure and dynamically size accent shape to fit the title
            const accent = computeAccentBounds(title, {
                shapeKind: preset.accent,
                fontSize: effectiveTitleFontSize,
                fontFamily: 'Montserrat',
                fontWeight: 800,
            });

            if (kicker) {
                placements.push(textPlacement({
                    content: kicker, x, y: y - 10, duration, motionId: 'fade', delay: 0.0,
                    color: params.kickerColor || '#A0AEC0', fontSize: Math.round(effectiveTitleFontSize * 0.42), fontWeight: 700,
                }));
            }

            if (preset.accent === 'underline') {
                placements.push(templatePlacement({
                    kind: 'underline',
                    params: { color: params.accentColor || preset.accentColor, thickness: accent.thickness, w: accent.w, h: accent.h },
                    scale: accent.scale,
                    x, y: y + 9, duration, motionId: 'scale-reveal', delay: 0.05,
                }));
            } else if (preset.accent === 'highlight-box') {
                placements.push(templatePlacement({
                    kind: 'highlight-box',
                    params: { color: params.accentColor || preset.accentColor, thickness: accent.thickness, fill: false, w: accent.w, h: accent.h },
                    scale: accent.scale,
                    x, y, duration, motionId: 'pop', delay: 0.0,
                }));
            }

            placements.push(textPlacement({
                content: title, x, y, duration, motionId: preset.motion, delay: 0.12,
                color: params.color || preset.textColor, fontSize: effectiveTitleFontSize, fontWeight: 800,
            }));

            if (subtitle) {
                placements.push(textPlacement({
                    content: subtitle, x, y: y + 14, duration, motionId: 'slide-up', delay: 0.25,
                    color: params.subColor || preset.subColor, fontSize: Math.round(effectiveTitleFontSize * 0.5), fontWeight: 500,
                }));
            }

            return { placements };
        }

        case 'KineticTitle': {
            // The sample kicker only goes with the sample headline.
            const userHeadline = params.title || params.headline || params.text;
            const kicker = params.kicker || params.lead || (userHeadline ? null : 'HOW TO');
            const headline = params.title || params.headline || params.text || 'SCALE 10X';
            const fitted = fitTextToBox(headline, { maxWidth: 860, maxHeight: 200 }, {
                initialFontSize: fontSize || 66,
                fontFamily: 'Anton',
                fontWeight: 900,
                allowWrap: false,
            });
            const effectiveHeadlineFontSize = fitted.fontSize;
            const accent = computeAccentBounds(headline, {
                shapeKind: preset.accent,
                fontSize: effectiveHeadlineFontSize,
                fontFamily: 'Anton',
                fontWeight: 900,
            });

            const placements = [
                ...(kicker ? [textPlacement({
                    content: kicker, x, y: y - 9, duration, motionId: preset.motion, delay: 0.0,
                    color: params.kickerColor || preset.kickerColor, fontSize: Math.round(effectiveHeadlineFontSize * 0.45), fontWeight: 700,
                })] : []),
                textPlacement({
                    content: headline, x, y: y + 2, duration, motionId: preset.motion, delay: 0.12,
                    color: params.color || preset.textColor, fontSize: effectiveHeadlineFontSize, fontWeight: 900,
                }),
            ];
            if (preset.accent) {
                placements.push(templatePlacement({
                    kind: preset.accent,
                    params: { color: params.accentColor || preset.accentColor, w: accent.w, h: accent.h, thickness: accent.thickness },
                    scale: preset.accent === 'burst' ? 1.0 : accent.scale,
                    x: preset.accent === 'burst' ? x + 24 : x,
                    y: preset.accent === 'burst' ? y + 10 : y + 2,
                    duration, motionId: 'pop', delay: 0.22,
                }));
            }
            return { placements };
        }

        case 'StatCallout': {
            const stat = params.value || params.stat || '+00%'; // placeholder to edit, never an invented figure
            const label = params.label || params.text || 'YOUR METRIC';
            const fittedStat = fitTextToBox(stat, { maxWidth: 640, maxHeight: 180 }, {
                initialFontSize: fontSize || 72,
                fontFamily: 'Montserrat',
                fontWeight: 900,
                allowWrap: false,
            });
            const effectiveStatFontSize = fittedStat.fontSize;
            const accent = computeAccentBounds(stat, {
                shapeKind: preset.accent,
                fontSize: effectiveStatFontSize,
                fontFamily: 'Montserrat',
                fontWeight: 900,
            });

            const placements = [
                templatePlacement({
                    kind: preset.accent,
                    params: { color: params.accentColor || preset.accentColor, thickness: accent.thickness, w: accent.w, h: accent.h },
                    scale: accent.scale,
                    x, y: y - 5, duration, motionId: 'pop', delay: 0.0,
                }),
                textPlacement({
                    content: stat, x, y: y - 5, duration, motionId: 'pop', delay: 0.10,
                    color: params.color || preset.statColor, fontSize: effectiveStatFontSize, fontWeight: 900,
                }),
                textPlacement({
                    content: label, x, y: y + 14, duration, motionId: 'slide-up', delay: 0.22,
                    color: params.labelColor || preset.labelColor, fontSize: Math.round(effectiveStatFontSize * 0.4), fontWeight: 700,
                }),
            ];
            return { placements };
        }

        default:
            return { placements: [], error: `unknown component "${componentId}"` };
    }
    })();

    if (result.error || !Array.isArray(result.placements) || result.placements.length === 0) return result;
    return { placements: assignGroupId(result.placements) };
}

export default { COMPONENT_IDS, COMPONENT_PRESETS, buildComponent };
