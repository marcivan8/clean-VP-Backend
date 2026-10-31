/**
 * client/src/motion/TemplateGraphics.js
 *
 * R89 (to-do A5) — animated template components: flip counter ("JOUR 14/30"),
 * number/price pop ("15-20€"), logo card, code-typing window.
 *
 * ONE drawing function per template, called by BOTH renderers:
 *   - the preview (Player/TemplateCanvas.jsx) draws every frame on a <canvas>;
 *   - the export (server/compositor/TemplateRenderer.js) imports this same file
 *     and draws every output frame with @napi-rs/canvas (Skia, like Chrome).
 * Only standard Canvas 2D calls and no DOM: it must run in both. R107 added
 * the one import this file has — `TextCraft.js`, which is pure arithmetic with
 * no imports of its own, so the dynamic import() in TemplateRenderer resolves
 * it in Node exactly as Vite does in the browser. Anything that reaches for a
 * canvas, the DOM or a measurement context still does not belong here.
 *
 * Sizes are in REFERENCE pixels (a 1080-wide frame). A template clip lives on
 * the overlay track; its box (x, y, scale, rotation, motion presets) is placed
 * exactly like a sticker, and these functions only draw INSIDE the box.
 */

import { applyBrand, brandFonts } from './BrandKit.js';
import { drawIcon, iconFromText } from './IconLibrary.js';
import {
    caretOpacity,
    planWordCycle,
    crossfadeWeights,
    MIN_SWAP_DWELL_S,
} from './TextCraft.js';

export const TEMPLATE_KINDS = ['counter', 'price-pop', 'logo-card', 'code-window',
    // R92: vector shapes
    'highlight-box', 'underline', 'circle-callout', 'arrow', 'progress-bar', 'bar-chart', 'burst',
    // Creative Suite additions
    'line-graph', 'circular-meter', 'data-counter', 'film-grain', 'vhs-glitch', 'light-leak',
    // Online trend additions (Talking Head, Vlog, Short Form, Repurposing)
    'lower-third-minimal', 'location-badge', 'retention-progress-bar', 'quote-card',
    // Expanded Motion Catalog (Editorial, Social Proof, Comparison, KPI)
    'comparison-card', 'social-notification', 'comment-bubble', 'kpi-stat-callout', 'newspaper-headline', 'search-bar',
    // R95 PHASE 2: a sized, gradient-filled backdrop for a block of text
    'panel',
    // R107: a slot that cycles through words in a reserved box
    'word-cycle',
    // R112: the graphic vocabulary the storyboard asks for. A reference-grade
    // short alternates evidence (a screenshot, a face, a figure) with
    // structure (steps, a checklist, a question, two sides); the catalogue had
    // the figures and almost none of the rest.
    'step-card', 'checklist', 'question-card', 'split-label',
    'screenshot-card', 'phone-frame', 'scene-background', 'ui-card', 'profile-portrait', 'stat-grid',
    // R113: the reusable building blocks. Labels and markers are the ones a
    // real edit reaches for constantly and the catalogue had none of; the
    // chart family was half-built; diagrams were missing entirely.
    'status-label', 'numbered-marker', 'spotlight', 'magnifier', 'crosshair',
    'pie-chart', 'donut-chart', 'area-chart', 'h-bar-chart',
    'video-thumbnail', 'video-player', 'engagement-counter',
    'process-flow', 'timeline-steps', 'funnel',
    // R114: the brand graphics (category 12), the rest of the diagram family
    // (8), the two missing social cards (3.1) and the audio pair (11).
    'logo-reveal', 'end-card', 'cta-banner', 'episode-badge', 'sponsor-card',
    'comparison-matrix', 'hierarchy', 'cycle-diagram', 'concept-map', 'annotated-shot',
    'reply-thread', 'dm-bubble',
    'waveform', 'audio-bars',
    // R115: the icon set reaching the catalogue (9), and the advanced
    // effects worth having (13).
    'icon', 'icon-label', 'icon-row',
    'light-sweep', 'particles', 'gradient-wash', 'chroma-pulse'];

/**
 * R113: the kinds that act ON the frame rather than sitting in it.
 *
 * A card is drawn to be seen on its own and comes out near-opaque. These do
 * not, and the difference is load-bearing for anything that measures what a
 * template put on screen:
 *
 *   spotlight   a DIM LAYER with a hole erased out of it. Its own pixels are
 *               translucent black by design (like `panel`), and the part that
 *               matters most is the part it removed.
 *   magnifier   dims at a quarter alpha, then rings the lens.
 *   crosshair   strokes only. It covers well under a percent of the frame and
 *               is supposed to.
 *
 * `scripts/test_transitions_templates.mjs` asserts every template "draws
 * something" by counting near-opaque pixels over a share of its box. That
 * test is right for a card and wrong for these three, which is how it caught
 * them — so they are classified here rather than the assertion being loosened
 * for everything.
 */
export const FRAME_EFFECT_KINDS = [
    // R115: all four advanced effects act ON the frame and are translucent
    // by design, like the three below them.
    'light-sweep', 'particles', 'gradient-wash', 'chroma-pulse',
    'spotlight', 'magnifier', 'crosshair',
    // R114: `annotated-shot` is pins and leader lines ON the shot beneath.
    // Giving it a surface would defeat the one thing it is for, so it is
    // sparse by design like the other three.
    'annotated-shot'];

/**
 * R114: kinds that REFUSE to draw without real data.
 *
 * `waveform` and `audio-bars` depict audio. A default shape would be a
 * decoration pretending to be data — lying about the very thing it shows — so
 * their `samples` default to empty and they draw nothing.
 *
 * That collides with the catalogue-wide rule that every template draws
 * something from its defaults, which is how the render check found them. The
 * answer is not to invent defaults but to say which kinds need input, and to
 * give a PREVIEW sample explicitly where one is wanted (a picker, a test).
 */
export const DATA_REQUIRED_KINDS = ['waveform', 'audio-bars'];

/** A synthetic 48-point envelope, for previews only. Never a default. */
const PREVIEW_SAMPLES = Array.from({ length: 48 }, (_, i) =>
    (0.25 + 0.75 * Math.abs(Math.sin(i * 0.63) * Math.cos(i * 0.21))).toFixed(3)).join(',');

/**
 * Params that make `kind` draw something worth looking at.
 *
 * For every kind but the data-required ones this is `{}` — their defaults
 * already show what they are. Use it for a template picker or a render check;
 * never as the params of a graphic placed in someone's video.
 */
export function previewParams(kind) {
    return DATA_REQUIRED_KINDS.includes(kind) ? { samples: PREVIEW_SAMPLES } : {};
}

/** R92: the shape kinds (drawn strokes and charts, not cards). */
export const SHAPE_KINDS = ['highlight-box', 'underline', 'circle-callout', 'arrow', 'progress-bar', 'bar-chart', 'burst',
    'line-graph', 'circular-meter', 'data-counter', 'film-grain', 'vhs-glitch', 'light-leak'];

export const TEMPLATE_FONTS = Object.freeze({
    display: 'Anton',          // client/public/fonts/Anton-Regular.ttf
    label: 'Montserrat',       // client/public/fonts/Montserrat-Bold.ttf
    body: 'Inter',             // client/public/fonts/Inter-Regular.ttf
    mono: 'JetBrains Mono',    // latin subset woff2 (index.css)
});

export const TEMPLATE_DEFAULTS = {
    'counter':     { label: 'DAY', value: 14, total: 30, from: null, accent: '#FFE500' },
    'price-pop':   { text: '15-20€', color: '#FFE500', sub: '' },
    'logo-card':   { label: 'Your brand', sub: '', imageUrl: null, accent: '#00E5FF' },
    'code-window': { title: 'index.js', code: "const views = await post('reel');\nif (views > 1e6) celebrate();", cps: 28 },
    'highlight-box':  { color: '#FFE500', thickness: 10, fill: false },
    'underline':      { color: '#FFE500', thickness: 18 },
    'circle-callout': { color: '#FF3B5C', thickness: 10 },
    'arrow':          { color: '#FFFFFF', thickness: 14, direction: 'right', curve: 0.25 },
    'progress-bar':   { label: 'Progress', value: 72, color: '#00E5FF' },
    'bar-chart':      { values: '35,60,90', labels: 'Before,During,After', color: '#00E5FF', accent: '#FFE500' },
    'burst':          { color: '#FFE500', thickness: 12, rays: 12 },
    // Creative Suite additions
    'line-graph':     { values: '20,45,35,70,95', labels: 'Q1,Q2,Q3,Q4,Target', color: '#00E5FF', accent: '#FFE500' },
    'circular-meter': { value: 84, label: 'GROWTH', color: '#00E5FF', accent: '#10B981' },
    'data-counter':   { prefix: '$', value: 250000, suffix: '', label: 'NET REVENUE', color: '#10B981' },
    'film-grain':     { intensity: 0.15 },
    'vhs-glitch':     { lines: 4, intensity: 0.25, color: '#00E5FF' },
    'light-leak':     { color: '#FFA500' },
    // Online trend additions
    'lower-third-minimal': { name: 'Dr. Sarah Chen', role: 'Lead AI Researcher', color: '#00E5FF' },
    'location-badge':      { location: 'Tokyo, Shibuya', time: '09:42 AM', color: '#FF3B5C' },
    'retention-progress-bar': { label: 'Keep Watching', value: 75, color: '#00E5FF', accent: '#FFE500' },
    'quote-card':          { quote: 'Focus on leverage, not just hours.', author: 'Naval Ravikant', color: '#FFE500' },
    // Expanded Motion Catalog
    'comparison-card':     { beforeLabel: 'BEFORE', beforeVal: '14 Hours', afterLabel: 'AFTER', afterVal: '35 Mins', color: '#00E5FF', accent: '#10B981' },
    'social-notification': { title: 'NEW SUBSCRIBER', subtitle: '@alex started following you', color: '#FF3B5C', accent: '#FFFFFF' },
    'comment-bubble':      { user: '@marcus_dev', text: 'How do you structure this without ads?', color: '#38BDF8' },
    'kpi-stat-callout':     { stat: '+184%', label: 'ORGANIC RETENTION RATE', color: '#10B981', accent: '#38BDF8' },
    'newspaper-headline':  { publication: 'THE TECH DISPATCH', headline: 'AI OVERHAULS CREATOR PRODUCTION', highlight: 'OVERHAULS', date: 'OCTOBER 2026' },
    'search-bar':          { query: 'how to edit viral videos', placeholder: 'Search Google...', color: '#00E5FF' },
    // R95 PHASE 2 - `panel`: the backdrop a block of text sits on, sized by
    // the layout (`w`/`h` in reference px) rather than guessed. Two colours
    // make a real gradient; `opacity` keeps the footage readable through it.
    'panel': { color: '#0E0F11', color2: null, angle: 160, opacity: 0.72, radius: 28, border: 0, borderColor: '#FFFFFF', reveal: 'wipe', w: 0, h: 0 },
    // R107 PHASE 2 - `word-cycle`: one line whose middle word changes. The
    // slot is sized from the WIDEST word in `words`, so the prefix and the
    // suffix never move. `dwell` of 0 means "share the duration evenly".
    'word-cycle': { prefix: 'Made for', words: 'Reels,Shorts,TikTok,Ads', suffix: '', dwell: 0, fontSize: 86, color: '#FFFFFF', accent: '#00E5FF' },
    // ── R112 ──────────────────────────────────────────────────────────────
    // `steps` and `items` are comma lists, like `bar-chart`'s `values`: one
    // field, parsed by parseList, so a caller never has to build an array.
    'step-card':        { steps: 'Record,Upload,Publish', title: '', accent: '#00E5FF', color: '#FFFFFF' },
    'checklist':        { items: 'No timeline,No keyframes,No plugins', accent: '#10B981', color: '#FFFFFF' },
    'question-card':    { question: 'What would you do?', accent: '#FFE500', color: '#FFFFFF' },
    'split-label':      { left: 'BEFORE', right: 'AFTER', leftColor: '#EF4444', rightColor: '#10B981', divider: 'vertical' },
    // R112 round C: the field is `imageUrl`, NOT a name of its own.
    // `logo-card` already uses `imageUrl`, TemplateCanvas resolves exactly
    // that key into `opts.images` for the preview, and the export path keys
    // its downloaded files by the same url. A new param name would have meant
    // a card that looks right in the designer's head and renders empty
    // everywhere else. With no url the frame draws its own placeholder rather
    // than a hole: nothing in the pipeline guarantees an asset.
    'screenshot-card':  { imageUrl: '', title: 'vibedstudio.com', chrome: 'browser', radius: 18, accent: '#00E5FF', theme: 'dark' },
    'phone-frame':      { accent: '#FFFFFF', theme: 'dark' },
    'scene-background': { color: '#F9FAFB' },
    'ui-card':          { title: 'Your edit', rows: 'Captions,Zoom rhythm,Colour grade', cta: 'Export', accent: '#00E5FF', theme: 'dark' },
    'profile-portrait': { imageUrl: '', name: 'Marc', handle: '@vibedstudio', accent: '#00E5FF', ring: 1, shape: 'circle', theme: 'dark' },
    'stat-grid':        { values: '40%,3x,12k', labels: 'Revenue,Faster,Views', accent: '#00E5FF', color: '#FFFFFF', theme: 'dark' },
    // ── R113 ──────────────────────────────────────────────────────────────
    // `tone` picks the colour and the glyph from one table, so "warning" and
    // "success" are the SAME template rather than ten near-identical ones.
    // Ten separate kinds would be ten places to fix the same padding bug.
    // `accent` is only used by the `category` tone: the other tones MEAN
    // their colour (a red warning, a green success), and letting a brand
    // repaint them would destroy the one thing a status label is for.
    'status-label':     { text: 'PRO TIP', tone: 'tip', icon: 'auto', accent: '#38BDF8' },
    'numbered-marker':  { number: 1, label: '', accent: '#00E5FF' },
    // A spotlight DARKENS everything but a hole, so it is frame-sized by
    // nature; x/y are the hole's centre as a fraction of the frame.
    'spotlight':        { x: 0.5, y: 0.45, radius: 0.22, dim: 0.72, soft: 0.06 },
    'magnifier':        { x: 0.5, y: 0.45, radius: 0.16, accent: '#00E5FF', handle: 1 },
    'crosshair':        { x: 0.5, y: 0.45, size: 0.18, accent: '#00E5FF', label: '' },
    // Charts take `values` and `labels` as comma lists, like `bar-chart`:
    // structured data, never text drawn to look like a chart, so the numbers
    // and the picture cannot disagree.
    'pie-chart':        { values: '45,30,25', labels: 'Organic,Paid,Direct', colors: '', title: '', accent: '#00E5FF' },
    'donut-chart':      { values: '45,30,25', labels: 'Organic,Paid,Direct', colors: '', center: '', title: '', accent: '#00E5FF' },
    'area-chart':       { values: '12,18,15,26,31,44', labels: '', accent: '#00E5FF', title: '' },
    'h-bar-chart':      { values: '82,64,41', labels: 'YouTube,TikTok,Reels', accent: '#00E5FF', suffix: '' },
    'video-thumbnail':  { imageUrl: '', title: 'How I edit in 10 minutes', channel: '', duration: '10:24', views: '', accent: '#FF0033' },
    'video-player':     { imageUrl: '', title: '', progress: 0.35, playing: 1, accent: '#FF0033' },
    'engagement-counter': { likes: '12.4K', comments: '389', shares: '1.2K', accent: '#FF3B5C' },
    'process-flow':     { steps: 'Record,Edit,Publish', accent: '#00E5FF', direction: 'horizontal' },
    'timeline-steps':   { steps: 'Jan,Mar,Jun,Sep', labels: '', accent: '#00E5FF' },
    'funnel':           { stages: 'Views,Clicks,Signups,Paid', values: '100,42,18,6', accent: '#00E5FF' },
    // ── R114 ──────────────────────────────────────────────────────────────
    // The brand graphics take their look from the kit via `applyBrand`, so
    // their defaults are the neutral fallback rather than a second palette.
    'logo-reveal':      { name: 'VIBED', tagline: '', imageUrl: '', accent: '#00E5FF', color: '#FFFFFF' },
    'end-card':         { title: 'Thanks for watching', cta: 'Subscribe', handle: '', imageUrl: '', accent: '#00E5FF', color: '#FFFFFF' },
    'cta-banner':       { text: 'Link in bio', sub: '', accent: '#00E5FF', color: '#FFFFFF' },
    'episode-badge':    { series: '', number: 12, title: '', accent: '#00E5FF', color: '#FFFFFF' },
    'sponsor-card':     { label: 'Sponsored by', name: '', imageUrl: '', accent: '#00E5FF', color: '#FFFFFF' },
    // `rows` is one option per line, `cols` the criteria; `marks` is a grid of
    // y/n/~ read row-major, so the data is structured rather than drawn.
    'comparison-matrix': { options: 'VIBED,Editor,DIY', criteria: 'Fast,Cheap,No skills', marks: 'y,y,y,n,n,y,y,n,n', accent: '#00E5FF' },
    'hierarchy':        { root: 'Channel', children: 'Shorts,Long form,Podcast', accent: '#00E5FF' },
    'cycle-diagram':    { steps: 'Film,Edit,Post,Learn', accent: '#00E5FF' },
    'concept-map':      { center: 'Retention', nodes: 'Hook,Pacing,Captions,Payoff', accent: '#00E5FF' },
    // Pins are "x,y,label" triples in frame fractions over the shot beneath.
    'annotated-shot':   { pins: '0.3,0.35,The hook;0.7,0.6,The payoff', accent: '#00E5FF' },
    'reply-thread':     { messages: 'How do you edit so fast?|I just describe it', users: 'alex|you', accent: '#38BDF8' },
    'dm-bubble':        { text: 'Can you edit mine too?', user: '@alex', side: 'left', accent: '#38BDF8' },
    // Both take REAL samples. With none they draw nothing: a waveform that
    // invents its own shape is a decoration pretending to be data.
    'waveform':         { samples: '', accent: '#00E5FF', mirror: 1 },
    'audio-bars':       { samples: '', accent: '#00E5FF', bars: 24 },
    // ── R115 ──────────────────────────────────────────────────────────────
    // `icon` names a shape in IconLibrary; an unknown one draws nothing
    // rather than a placeholder, so a typo is visible instead of silently
    // becoming some other symbol.
    'icon':             { icon: 'sparkle', accent: '#00E5FF', weight: 2, fill: 0, background: 'soft-glow' },
    'icon-label':       { icon: 'bulb', text: 'Pro tip', accent: '#00E5FF', color: '#FFFFFF' },
    'icon-row':         { icons: 'camera,scissors,send', labels: '', accent: '#00E5FF' },
    // Advanced effects. All four are frame-sized because they act on the
    // frame, and all four are translucent by design.
    'light-sweep':      { angle: 20, width: 0.18, color: '#FFFFFF', strength: 0.45 },
    // 40 dots of radius 5 over a 1080x1920 frame is a field nobody can see —
    // measured at 0.15% coverage, which is also below the floor at which the
    // render check counts anything as drawn. These defaults are what a
    // particle field has to be to read at all.
    'particles':        { count: 70, accent: '#FFFFFF', size: 8, drift: 'up', seed: 7 },
    'gradient-wash':    { color: '#00E5FF', color2: '#8A2BE2', angle: 150, opacity: 0.4 },
    'chroma-pulse':     { strength: 0.012, color: '#FF3B5C', color2: '#00E5FF' },
};

/** Width as a fraction of the frame, the size a new template is dropped at. */
export const TEMPLATE_WIDTH_FRACTION = {
    'counter': 0.5, 'price-pop': 0.62, 'logo-card': 0.72, 'code-window': 0.86,
    'highlight-box': 0.7, 'underline': 0.6, 'circle-callout': 0.45, 'arrow': 0.4,
    'progress-bar': 0.8, 'bar-chart': 0.8, 'burst': 0.35,
    'line-graph': 0.85, 'circular-meter': 0.5, 'data-counter': 0.6,
    'film-grain': 1.0, 'vhs-glitch': 1.0, 'light-leak': 1.0,
    'lower-third-minimal': 0.75, 'location-badge': 0.55, 'retention-progress-bar': 0.88, 'quote-card': 0.82,
    'comparison-card': 0.85, 'social-notification': 0.72, 'comment-bubble': 0.82,
    'kpi-stat-callout': 0.78, 'newspaper-headline': 0.86, 'search-bar': 0.80,
    'panel': 0.8,
    'word-cycle': 0.86,
    'step-card': 0.82, 'checklist': 0.78, 'question-card': 0.84, 'split-label': 0.9,
    'screenshot-card': 0.78, 'phone-frame': 0.25, 'scene-background': 0.25, 'ui-card': 0.74, 'profile-portrait': 0.42, 'stat-grid': 0.9,
    'status-label': 0.38, 'numbered-marker': 0.2,
    'spotlight': 1.0, 'magnifier': 1.0, 'crosshair': 1.0,
    'pie-chart': 0.68, 'donut-chart': 0.68, 'area-chart': 0.88, 'h-bar-chart': 0.86,
    'video-thumbnail': 0.74, 'video-player': 0.82, 'engagement-counter': 0.6,
    'process-flow': 0.92, 'timeline-steps': 0.9, 'funnel': 0.74,
    'logo-reveal': 0.7, 'end-card': 0.88, 'cta-banner': 0.9, 'episode-badge': 0.56, 'sponsor-card': 0.62,
    'comparison-matrix': 0.94, 'hierarchy': 0.9, 'cycle-diagram': 0.72, 'concept-map': 0.86,
    'annotated-shot': 1.0,
    'reply-thread': 0.84, 'dm-bubble': 0.76,
    'waveform': 0.9, 'audio-bars': 0.8,
    'icon': 0.22, 'icon-label': 0.5, 'icon-row': 0.76,
    'light-sweep': 1.0, 'particles': 1.0, 'gradient-wash': 1.0, 'chroma-pulse': 1.0,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

export function templateParams(kind, params) {
    return { ...(TEMPLATE_DEFAULTS[kind] || {}), ...(params || {}) };
}

function splitLines(code) {
    return String(code || '').replace(/\t/g, '  ').split('\n').slice(0, 14).map(l => l.slice(0, 48));
}

/** Natural size of a template in reference pixels. */
export function templateSize(kind, params) {
    const p = templateParams(kind, params);
    if (Number(p.w) > 0 && Number(p.h) > 0) {
        return { w: Math.round(Number(p.w)), h: Math.round(Number(p.h)) };
    }
    switch (kind) {
        case 'panel': return { w: 900, h: 300 };
        case 'counter': return { w: 540, h: 300 };
        case 'price-pop': return { w: 680, h: 300 };
        case 'logo-card': return { w: 780, h: 210 };
        case 'code-window': {
            const lines = Math.max(2, splitLines(p.code).length);
            return { w: 930, h: 110 + lines * 54 + 40 };
        }
        case 'highlight-box': return { w: 800, h: 300 };
        case 'underline': return { w: 800, h: 70 };
        case 'circle-callout': return { w: 600, h: 400 };
        case 'arrow': return (p.direction === 'up' || p.direction === 'down') ? { w: 260, h: 600 } : { w: 600, h: 260 };
        case 'progress-bar': return { w: 900, h: 150 };
        case 'bar-chart': return { w: 900, h: 560 };
        case 'burst': return { w: 400, h: 400 };
        case 'line-graph': return { w: 900, h: 560 };
        case 'circular-meter': return { w: 500, h: 500 };
        case 'data-counter': return { w: 700, h: 280 };
        case 'film-grain': return { w: 1080, h: 1920 };
        case 'vhs-glitch': return { w: 1080, h: 1920 };
        case 'light-leak': return { w: 1080, h: 1920 };
        case 'lower-third-minimal': return { w: 780, h: 160 };
        case 'location-badge': return { w: 560, h: 110 };
        case 'retention-progress-bar': return { w: 920, h: 100 };
        case 'quote-card': return { w: 840, h: 300 };
        case 'comparison-card': return { w: 860, h: 220 };
        case 'social-notification': return { w: 680, h: 140 };
        case 'comment-bubble': return { w: 800, h: 200 };
        case 'kpi-stat-callout': return { w: 760, h: 210 };
        case 'newspaper-headline': return { w: 880, h: 260 };
        case 'search-bar': return { w: 780, h: 130 };
        case 'word-cycle': return { w: 980, h: 240 };
        // R112 - the list cards grow with their content instead of clipping it.
        case 'step-card': {
            const n = Math.max(1, parseList(p.steps, 5).length);
            return { w: 880, h: (String(p.title || '').trim() ? 86 : 28) + n * 108 + 28 };
        }
        case 'checklist': {
            const n = Math.max(1, parseList(p.items, 6).length);
            return { w: 820, h: 28 + n * 92 + 28 };
        }
        case 'question-card': return { w: 900, h: 320 };
        case 'split-label': return p.divider === 'horizontal' ? { w: 1000, h: 620 } : { w: 1000, h: 300 };
        case 'screenshot-card': return p.chrome === 'phone' ? { w: 520, h: 920 } : { w: 860, h: 600 };
        case 'phone-frame': return { w: 520, h: 920 };
        case 'scene-background': return { w: 1080, h: 1920 };
        case 'ui-card': {
            const n = Math.max(1, parseList(p.rows, 5).length);
            return { w: 760, h: 150 + n * 86 + (String(p.cta || '').trim() ? 110 : 20) };
        }
        case 'profile-portrait': return { w: 440, h: 560 };
        case 'stat-grid': {
            const n = Math.max(1, Math.min(4, parseList(p.values, 4).length));
            return { w: 260 * n + 40 * (n - 1), h: 300 };
        }
        // R113 — a label is sized by its own text so it never has slack on one
        // side and clipping on the other; 17px a character is Montserrat Bold
        // at 34px, measured, not guessed.
        case 'status-label': {
            const chars = Math.max(2, String(p.text || '').trim().length);
            return { w: Math.min(760, 150 + chars * 19), h: 86 };
        }
        case 'numbered-marker': {
            const label = String(p.label || '').trim();
            return label ? { w: Math.min(620, 120 + label.length * 18), h: 96 } : { w: 96, h: 96 };
        }
        // These three cover the frame because they act ON it: a spotlight is
        // a hole in a dim layer, not a sticker.
        case 'spotlight':
        case 'magnifier':
        case 'crosshair': return { w: 1080, h: 1920 };
        case 'pie-chart':
        case 'donut-chart': {
            const n = parseList(p.labels, 6).length;
            return { w: 760, h: 520 + (n > 0 ? Math.ceil(n / 2) * 46 : 0) + (String(p.title || '').trim() ? 70 : 0) };
        }
        case 'area-chart': return { w: 900, h: 520 + (String(p.title || '').trim() ? 70 : 0) };
        case 'h-bar-chart': {
            const n = Math.max(1, parseList(p.values, 6).length);
            return { w: 880, h: 40 + n * 104 + 20 };
        }
        case 'video-thumbnail': return { w: 760, h: 560 };
        case 'video-player': return { w: 900, h: 560 };
        case 'engagement-counter': return { w: 620, h: 150 };
        case 'process-flow': {
            const n = Math.max(1, parseList(p.steps, 5).length);
            return p.direction === 'vertical'
                ? { w: 700, h: 60 + n * 150 }
                : { w: Math.max(700, n * 250 + 60), h: 280 };
        }
        case 'timeline-steps': {
            const n = Math.max(1, parseList(p.steps, 6).length);
            return { w: Math.max(700, n * 210 + 80), h: 300 };
        }
        case 'funnel': {
            const n = Math.max(2, parseList(p.stages, 5).length);
            return { w: 740, h: 60 + n * 118 };
        }
        // R114
        case 'logo-reveal': return { w: 720, h: String(p.tagline || '').trim() ? 400 : 320 };
        case 'end-card': return { w: 900, h: 620 };
        case 'cta-banner': return { w: 960, h: String(p.sub || '').trim() ? 190 : 130 };
        case 'episode-badge': return { w: 560, h: String(p.title || '').trim() ? 220 : 150 };
        case 'sponsor-card': return { w: 640, h: 180 };
        case 'comparison-matrix': {
            const cols = Math.max(1, parseList(p.options, 4).length);
            const rows = Math.max(1, parseList(p.criteria, 6).length);
            return { w: 300 + cols * 190, h: 110 + rows * 96 + 20 };
        }
        case 'hierarchy': {
            const n = Math.max(1, parseList(p.children, 4).length);
            return { w: Math.max(640, n * 230 + 60), h: 420 };
        }
        case 'cycle-diagram': return { w: 720, h: 720 };
        case 'concept-map': return { w: 860, h: 700 };
        case 'annotated-shot': return { w: 1080, h: 1920 };
        case 'reply-thread': {
            const n = Math.max(1, parseList(p.messages, 4, '|').length);
            return { w: 840, h: 40 + n * 150 };
        }
        case 'dm-bubble': return { w: 760, h: 200 };
        case 'waveform': return { w: 900, h: 260 };
        case 'audio-bars': return { w: 760, h: 320 };
        // R115
        case 'icon': return { w: 240, h: 240 };
        case 'icon-label': {
            const chars = Math.max(2, String(p.text || '').trim().length);
            return { w: Math.min(720, 150 + chars * 19), h: 110 };
        }
        case 'icon-row': {
            const n = Math.max(1, parseList(p.icons, 5).length);
            const tall = parseList(p.labels, 5).length > 0;
            return { w: n * 180 + 40, h: tall ? 240 : 170 };
        }
        case 'light-sweep':
        case 'particles':
        case 'gradient-wash':
        case 'chroma-pulse': return { w: 1080, h: 1920 };
        default: return { w: 400, h: 200 };
    }
}

/** Envelope: pop/slide in over `inDur`, out over `outDur` before the end. */
function envelope(t, duration, inDur, outDur) {
    const tin = clamp(t / inDur, 0, 1);
    const tout = clamp((duration - t) / outDur, 0, 1);
    return { tin, tout };
}

function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
}

// ─── counter ────────────────────────────────────────────────────────────────

function drawCounter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('counter', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const s = easeOutBack(tin) * (0.85 + 0.15 * tout);
    const alpha = Math.min(1, tin * 3) * tout;
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);

    // Card
    ctx.fillStyle = 'rgba(12,12,16,0.92)';
    roundRect(ctx, 6, 6, w - 12, h - 12, 34);
    ctx.fill();

    // Label
    ctx.fillStyle = p.accent || '#FFE500';
    ctx.font = `44px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(p.label || '').toUpperCase().slice(0, 14), w / 2, 76);

    // Digits: count from `from` (default value-6) to `value` over 0.9 s.
    const value = Math.max(0, Math.round(Number(p.value) || 0));
    const from = Number.isFinite(Number(p.from)) && p.from !== null ? Math.max(0, Math.round(Number(p.from))) : Math.max(0, value - 6);
    const steps = Math.max(0, value - from);
    const k = clamp((t - 0.25) / 0.9, 0, 1) * steps;
    const shown = from + Math.floor(k);
    const flip = steps > 0 && shown < value ? k - Math.floor(k) : 1;
    const next = Math.min(value, shown + 1);
    const digitsNow = String(shown);
    const digitsNext = String(next);
    const nDigits = Math.max(digitsNow.length, digitsNext.length, String(value).length);
    const total = p.total !== null && p.total !== '' && Number.isFinite(Number(p.total)) ? `/${Math.round(Number(p.total))}` : '';

    const tileW = 96, tileH = 140, gap = 12;
    ctx.font = `150px "${F.display}"`;
    const totalW = total ? ctx.measureText(total).width * 0.55 + 14 : 0;
    const digitsW = nDigits * tileW + (nDigits - 1) * gap;
    let x = (w - (digitsW + totalW)) / 2;
    const y = 104;

    for (let i = 0; i < nDigits; i++) {
        const a = digitsNow.padStart(nDigits, ' ')[i];
        const b = digitsNext.padStart(nDigits, ' ')[i];
        // Tile
        ctx.fillStyle = '#1D1D26';
        roundRect(ctx, x, y, tileW, tileH, 14);
        ctx.fill();
        const drawHalf = (ch, top, scaleY) => {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, top ? y : y + tileH / 2, tileW, tileH / 2);
            ctx.clip();
            const cy = y + tileH / 2;
            ctx.translate(0, cy);
            ctx.scale(1, scaleY);
            ctx.translate(0, -cy);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `120px "${F.display}"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            if (ch.trim()) ctx.fillText(ch, x + tileW / 2, cy + 4);
            ctx.restore();
        };
        if (a === b || flip >= 1) {
            drawHalf(flip >= 1 ? b : a, true, 1);
            drawHalf(flip >= 1 ? b : a, false, 1);
        } else {
            // Split-flap: new top behind, old bottom until the flap passes.
            drawHalf(b, true, 1);
            drawHalf(a, false, 1);
            if (flip < 0.5) drawHalf(a, true, 1 - flip * 2);       // old top folding down
            else drawHalf(b, false, (flip - 0.5) * 2);             // new bottom unfolding
        }
        // Hinge line
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x, y + tileH / 2 - 2, tileW, 4);
        x += tileW + gap;
    }
    if (total) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `82px "${F.display}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(total, x + 2, y + tileH - 12);
    }
    ctx.restore();
}

// ─── price / number pop ─────────────────────────────────────────────────────

function drawPricePop(ctx, p, t, duration, F) {
    const { w, h } = templateSize('price-pop', p);
    const { tin, tout } = envelope(t, duration, 0.38, 0.2);
    if (tout <= 0 || tin <= 0) return;
    const pop = easeOutBack(tin);
    const s = pop * (0.6 + 0.4 * easeOutCubic(tout));
    const wobble = tin >= 1 ? Math.sin((t - 0.38) * 5) * 0.012 : 0;
    const cx = w / 2, cy = h / 2;

    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 4) * tout;

    // Burst rays during the pop
    if (t < 0.7) {
        const r = clamp(t / 0.7, 0, 1);
        ctx.save();
        ctx.strokeStyle = p.color || '#FFE500';
        ctx.lineCap = 'round';
        ctx.lineWidth = 12 * (1 - r);
        for (let i = 0; i < 10; i++) {
            const ang = (i / 10) * Math.PI * 2 + 0.3;
            const r0 = 120 + 160 * easeOutCubic(r);
            const r1 = r0 + 60 * (1 - r);
            ctx.globalAlpha = (1 - r) * tout;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(ang) * r0 * 1.6, cy + Math.sin(ang) * r0 * 0.7);
            ctx.lineTo(cx + Math.cos(ang) * r1 * 1.6, cy + Math.sin(ang) * r1 * 0.7);
            ctx.stroke();
        }
        ctx.restore();
    }

    ctx.translate(cx, cy);
    ctx.rotate(-0.06 + wobble);
    ctx.scale(s, s);
    const text = String(p.text || '').slice(0, 14);
    let size = 190;
    ctx.font = `${size}px "${F.display}"`;
    const maxW = w * 0.9;
    const mw = ctx.measureText(text).width;
    if (mw > maxW) { size = Math.floor(size * maxW / mw); ctx.font = `${size}px "${F.display}"`; }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    // Hard drop shadow, thick outline, fill
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, 10, 14);
    ctx.strokeStyle = '#0A0A0E';
    ctx.lineWidth = size * 0.14;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = p.color || '#FFE500';
    ctx.fillText(text, 0, 0);
    if (p.sub) {
        ctx.font = `40px "${F.label}"`;
        ctx.fillStyle = '#FFFFFF';
        ctx.lineWidth = 8;
        ctx.strokeText(String(p.sub).slice(0, 28), 0, size * 0.62);
        ctx.fillText(String(p.sub).slice(0, 28), 0, size * 0.62);
    }
    ctx.restore();
}

// ─── logo card ──────────────────────────────────────────────────────────────

function drawLogoCard(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('logo-card', p);
    const { tin, tout } = envelope(t, duration, 0.45, 0.3);
    if (tin <= 0 || tout <= 0) return;
    const slide = (1 - easeOutCubic(tin)) * -w * 0.25 + (1 - easeOutCubic(tout)) * w * 0.08;
    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 2) * tout;
    ctx.translate(slide, 0);

    ctx.fillStyle = 'rgba(14,14,18,0.94)';
    roundRect(ctx, 6, 6, w - 12, h - 12, 40);
    ctx.fill();
    // Accent bar grows in
    ctx.fillStyle = p.accent || '#00E5FF';
    roundRect(ctx, 6, 6, 14, (h - 12) * easeOutCubic(clamp((t - 0.2) / 0.4, 0, 1)), 7);
    ctx.fill();

    // Logo tile
    const tile = h - 60;
    const tx = 44, ty = 30;
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, tx, ty, tile, tile, 28);
    ctx.fill();
    const img = images && p.imageUrl ? images[p.imageUrl] : null;
    if (img && img.width > 0 && img.height > 0) {
        const pad = 16;
        const box = tile - pad * 2;
        const r = Math.min(box / img.width, box / img.height);
        const iw = img.width * r, ih = img.height * r;
        ctx.save();
        roundRect(ctx, tx, ty, tile, tile, 28);
        ctx.clip();
        ctx.drawImage(img, tx + (tile - iw) / 2, ty + (tile - ih) / 2, iw, ih);
        ctx.restore();
    } else {
        ctx.fillStyle = '#0E0E12';
        ctx.font = `72px "${F.display}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(p.label || '?').trim().charAt(0).toUpperCase(), tx + tile / 2, ty + tile / 2 + 4);
    }

    // Text, revealed left to right
    const reveal = easeOutCubic(clamp((t - 0.25) / 0.5, 0, 1));
    const textX = tx + tile + 34;
    ctx.save();
    ctx.beginPath();
    ctx.rect(textX, 0, (w - textX - 30) * reveal, h);
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `62px "${F.label}"`;
    ctx.fillText(String(p.label || '').slice(0, 22), textX, p.sub ? h / 2 + 6 : h / 2 + 22);
    if (p.sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `36px "${F.body}"`;
        ctx.fillText(String(p.sub).slice(0, 34), textX, h / 2 + 56);
    }
    ctx.restore();
    ctx.restore();
}

// ─── code window ────────────────────────────────────────────────────────────

const KEYWORDS = new Set(('const let var function return if else for while do switch case break continue import from export default class new await async try catch finally throw typeof instanceof in of this null undefined true false def print elif lambda yield').split(' '));

/** Tokens with colours for one line (very small highlighter: enough for a reel). */
export function highlightLine(line) {
    const out = [];
    const re = /(\/\/.*$|#.*$)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?(?:e\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        if (m[1]) out.push({ text: m[1], color: '#6B7089' });
        else if (m[2]) out.push({ text: m[2], color: '#A6E3A1' });
        else if (m[3]) out.push({ text: m[3], color: '#FAB387' });
        else if (m[4]) out.push({ text: m[4], color: KEYWORDS.has(m[4]) ? '#CBA6F7' : (line[re.lastIndex] === '(' ? '#89B4FA' : '#CDD6F4') });
        else out.push({ text: m[5] || m[6], color: '#CDD6F4' });
        if (m[0] === '') re.lastIndex++;
    }
    return out;
}

function drawCodeWindow(ctx, p, t, duration, F) {
    const { w, h } = templateSize('code-window', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    if (tin <= 0 || tout <= 0) return;
    const s = 0.92 + 0.08 * easeOutCubic(tin);
    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 2.5) * tout;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);

    ctx.fillStyle = '#1E1E2E';
    roundRect(ctx, 6, 6, w - 12, h - 12, 26);
    ctx.fill();
    ctx.fillStyle = '#181825';
    roundRect(ctx, 6, 6, w - 12, 76, 26);
    ctx.fill();
    ctx.fillRect(6, 56, w - 12, 26);
    ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(46 + i * 38, 44, 12, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = 'rgba(205,214,244,0.7)';
    ctx.font = `30px "${F.body}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.title || '').slice(0, 30), w / 2, 46);

    // Typing
    const lines = splitLines(p.code);
    const cps = clamp(Number(p.cps) || 28, 4, 200);
    let budget = Math.max(0, Math.floor((t - 0.35) * cps));
    ctx.font = `36px "${F.mono}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x0 = 48;
    let y = 150;
    let cursor = null;
    for (const line of lines) {
        if (budget <= 0 && cursor) break;
        let x = x0;
        const visible = line.slice(0, Math.max(0, budget));
        for (const tok of highlightLine(visible)) {
            ctx.fillStyle = tok.color;
            ctx.fillText(tok.text, x, y);
            x += ctx.measureText(tok.text).width;
        }
        cursor = { x, y };
        budget -= line.length + 1;
        if (budget < 0) break;
        y += 54;
    }
    // R107 - the caret fades rather than toggling. A caret that switches on
    // and off between two frames reads as a dropped frame, because nothing
    // else in a rendered frame changes state instantly. It stays solid while
    // the line is still arriving: a blink during typing competes with the
    // letters, and its return is the cue that the typing is done.
    const typing = budget < 0;
    if (cursor) {
        const prev = ctx.globalAlpha;
        ctx.globalAlpha = prev * caretOpacity(t, { typing });
        ctx.fillStyle = '#F5E0DC';
        ctx.fillRect(cursor.x + 2, cursor.y - 32, 18, 40);
        ctx.globalAlpha = prev;
    }
    ctx.restore();
}

// ─── R92: vector shapes (highlight box, underline, circle, arrow, bars) ─────
//
// The SHAPE layer kind had no renderer before R92. These are drawn with plain
// Canvas 2D paths, so the preview and the Skia export draw the same pixels.
// Every shape "draws on" (stroke reveal), holds, then fades in the last
// 0.25 s, like the strokes a motion designer animates by hand.

const SHAPE_IN = 0.55;
const SHAPE_OUT = 0.25;

/** Stroke a path progressively: p = 0..1 of its length. */
function strokeProgress(ctx, length, p) {
    const L = Math.max(1, length);
    ctx.setLineDash([L, L]);
    ctx.lineDashOffset = L * (1 - clamp(p, 0, 1));
    ctx.stroke();
    ctx.setLineDash([]);
}

function shapeAlpha(t, duration) {
    return clamp((duration - t) / SHAPE_OUT, 0, 1);
}

function shapeStroke(ctx, p) {
    ctx.strokeStyle = p.color || '#FFE500';
    ctx.lineWidth = clamp(Number(p.thickness) || 10, 2, 40);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
}

function drawHighlightBox(ctx, p, t, duration) {
    const { w, h } = templateSize('highlight-box', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const lw = clamp(Number(p.thickness) || 10, 2, 40);
    const x = lw, y = lw, bw = w - lw * 2, bh = h - lw * 2, r = Math.min(28, bh / 3);
    const prog = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    if (p.fill) {
        ctx.globalAlpha = a * 0.22 * prog;
        ctx.fillStyle = p.color || '#FFE500';
        roundRect(ctx, x, y, bw, bh, r);
        ctx.fill();
        ctx.globalAlpha = a;
    }
    shapeStroke(ctx, p);
    // A gentle glow pulse once the box is drawn.
    const pulse = t > SHAPE_IN ? 0.5 + 0.5 * Math.sin((t - SHAPE_IN) * 4) : 0;
    ctx.shadowColor = p.color || '#FFE500';
    ctx.shadowBlur = 6 + 10 * pulse;
    roundRect(ctx, x, y, bw, bh, r);
    strokeProgress(ctx, 2 * (bw + bh), prog);
    ctx.restore();
}

/**
 * R95 PHASE 2 - a backdrop panel: rounded, gradient-filled, revealed by a
 * wipe, a grow or a fade. Its size comes from the layout (`w`/`h`), so the
 * panel is as wide as the text it carries rather than a fixed fraction.
 *
 * Drawn here, which means ONE implementation covers preview and export: the
 * worker's `server/compositor/TemplateRenderer.js` imports this same module
 * and calls `drawTemplate`.
 */
function drawPanel(ctx, p, t, duration) {
    const w = Number(p.w) > 0 ? Number(p.w) : 900;
    const h = Number(p.h) > 0 ? Number(p.h) : 300;
    const radius = clamp(Number(p.radius) >= 0 ? Number(p.radius) : 28, 0, Math.min(w, h) / 2);
    const baseAlpha = clamp(Number(p.opacity) >= 0 ? Number(p.opacity) : 0.72, 0, 1);
    const inProg = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    const outProg = clamp((duration - t) / SHAPE_OUT, 0, 1);
    const reveal = String(p.reveal || 'wipe');

    ctx.save();
    ctx.globalAlpha = baseAlpha * (reveal === 'wipe' ? 1 : inProg) * outProg;

    // The fill: one colour, or a real gradient along `angle`.
    let fill = p.color || '#0E0F11';
    if (p.color2) {
        // Number(0) || 160 would turn a horizontal gradient into a diagonal one.
        const angle = Number.isFinite(Number(p.angle)) ? Number(p.angle) : 160;
        const rad = (angle * Math.PI) / 180;
        const cx = w / 2;
        const cy = h / 2;
        const half = Math.abs(Math.cos(rad) * w) / 2 + Math.abs(Math.sin(rad) * h) / 2;
        const g = ctx.createLinearGradient(
            cx - Math.cos(rad) * half, cy - Math.sin(rad) * half,
            cx + Math.cos(rad) * half, cy + Math.sin(rad) * half,
        );
        g.addColorStop(0, p.color || '#0E0F11');
        g.addColorStop(1, p.color2);
        fill = g;
    }

    if (reveal === 'wipe') {
        // Grow from the left edge, so text can appear as the panel passes under it.
        ctx.beginPath();
        ctx.rect(0, 0, Math.max(0, w * inProg), h);
        ctx.clip();
    } else if (reveal === 'grow') {
        ctx.translate(w / 2, h / 2);
        ctx.scale(1, Math.max(0.001, inProg));
        ctx.translate(-w / 2, -h / 2);
    }

    ctx.fillStyle = fill;
    roundRect(ctx, 0, 0, w, h, radius);
    ctx.fill();

    const border = Number(p.border) || 0;
    if (border > 0) {
        ctx.strokeStyle = p.borderColor || '#FFFFFF';
        ctx.lineWidth = clamp(border, 1, 24);
        ctx.globalAlpha *= 0.8;
        roundRect(ctx, border / 2, border / 2, w - border, h - border, Math.max(0, radius - border / 2));
        ctx.stroke();
    }
    ctx.restore();
}

function drawUnderline(ctx, p, t, duration) {
    const { w, h } = templateSize('underline', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / (SHAPE_IN * 0.8), 0, 1));
    ctx.save();
    ctx.globalAlpha = a * 0.92;
    shapeStroke(ctx, { ...p, thickness: Number(p.thickness) || 18 });
    ctx.beginPath();
    const y0 = h * 0.62, y1 = h * 0.42;
    const padX = Math.min(20, Math.round(w * 0.08));
    ctx.moveTo(padX, y0);
    ctx.quadraticCurveTo(w * 0.5, h * 0.3, w - padX, y1);
    strokeProgress(ctx, w * 1.02, prog);
    ctx.restore();
}

function drawCircleCallout(ctx, p, t, duration) {
    const { w, h } = templateSize('circle-callout', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    const lw = clamp(Number(p.thickness) || 10, 2, 40);
    const rx = w / 2 - lw * 1.5, ry = h / 2 - lw * 1.5;
    ctx.save();
    ctx.globalAlpha = a;
    shapeStroke(ctx, p);
    ctx.beginPath();
    // Slightly more than a full turn with a drifting radius: reads as drawn by hand.
    const turns = 1.08;
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
        const k = i / steps;
        const ang = -Math.PI * 0.6 + k * Math.PI * 2 * turns;
        const wob = 1 + 0.035 * Math.sin(k * 9) - 0.03 * k;
        const px = w / 2 + Math.cos(ang) * rx * wob;
        const py = h / 2 + Math.sin(ang) * ry * wob;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    const perim = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry))) * turns;
    strokeProgress(ctx, perim, prog);
    ctx.restore();
}

function drawArrow(ctx, p, t, duration) {
    const { w, h } = templateSize('arrow', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / SHAPE_IN, 0, 1));
    const dir = ['left', 'right', 'up', 'down'].includes(p.direction) ? p.direction : 'right';
    // A curve of 0 is a straight arrow, which is a thing people ask for.
    const curve = clamp(numOr(p.curve, 0.25), -0.6, 0.6);
    ctx.save();
    ctx.globalAlpha = a;
    // Draw a left→right arrow, rotated for the other directions.
    ctx.translate(w / 2, h / 2);
    const rot = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir];
    ctx.rotate(rot);
    const len = (dir === 'up' || dir === 'down') ? h : w;
    const half = len / 2 - 30;
    shapeStroke(ctx, { ...p, thickness: Number(p.thickness) || 14 });
    ctx.beginPath();
    ctx.moveTo(-half, 0);
    const cy = -len * curve;
    ctx.quadraticCurveTo(0, cy, half, 0);
    strokeProgress(ctx, len * (1 + Math.abs(curve) * 0.6), prog);
    // Head pops in once the shaft arrives.
    const head = clamp((t - SHAPE_IN * 0.8) / 0.18, 0, 1);
    if (head > 0) {
        const s = easeOutBack(head) * 34;
        const ang = Math.atan2(0 - cy / 2, half);
        ctx.beginPath();
        ctx.moveTo(half - Math.cos(ang - 0.5) * s, -Math.sin(ang - 0.5) * s);
        ctx.lineTo(half, 0);
        ctx.lineTo(half - Math.cos(ang + 0.5) * s, -Math.sin(ang + 0.5) * s);
        ctx.stroke();
    }
    ctx.restore();
}

function drawProgressBar(ctx, p, t, duration, F) {
    const { w } = templateSize('progress-bar', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const appear = easeOutCubic(clamp(t / 0.3, 0, 1));
    const value = clamp(Number(p.value), 0, 100);
    const fill = easeOutCubic(clamp((t - 0.2) / 1.0, 0, 1)) * value;
    ctx.save();
    ctx.globalAlpha = a * appear;
    const barY = 86, barH = 46;
    ctx.font = `40px "${F.label}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText(String(p.label || '').slice(0, 28), 8, 58);
    ctx.textAlign = 'right';
    ctx.fillStyle = p.color || '#00E5FF';
    ctx.fillText(`${Math.round(fill)}%`, w - 8, 58);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    roundRect(ctx, 6, barY, w - 12, barH, barH / 2);
    ctx.fill();
    if (fill > 0) {
        ctx.fillStyle = p.color || '#00E5FF';
        roundRect(ctx, 6, barY, Math.max(barH, (w - 12) * (fill / 100)), barH, barH / 2);
        ctx.fill();
    }
    ctx.restore();
}

function parseList(v, max, sep = ',') {
    // The separator is an argument because a chat MESSAGE legitimately
    // contains commas; splitting "How do you edit so fast, Marc?" on one
    // would turn a single reply into two.
    return String(v ?? '').split(sep).map(s => s.trim()).filter(s => s.length > 0).slice(0, max);
}

function drawBarChart(ctx, p, t, duration, F) {
    const { w, h } = templateSize('bar-chart', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const values = parseList(p.values, 6).map(Number).map(v => (Number.isFinite(v) ? v : 0));
    if (values.length === 0) return;
    const labels = parseList(p.labels, 6);
    const max = Math.max(1, ...values.map(Math.abs));
    const n = values.length;
    const gap = 26;
    const top = 70, bottom = h - 70;
    const bw = (w - gap * (n + 1)) / n;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gap / 2, bottom + 2);
    ctx.lineTo(w - gap / 2, bottom + 2);
    ctx.stroke();
    values.forEach((v, i) => {
        // Staggered growth: each bar starts 0.12 s after the previous one.
        const g = easeOutBack(clamp((t - 0.15 - i * 0.12) / 0.6, 0, 1));
        const bh = Math.max(0, (bottom - top) * (Math.abs(v) / max) * g);
        const x = gap + i * (bw + gap);
        ctx.fillStyle = i === values.indexOf(Math.max(...values)) ? (p.accent || '#FFE500') : (p.color || '#00E5FF');
        roundRect(ctx, x, bottom - bh, bw, Math.max(bh, 0.01), Math.min(14, bw / 4));
        ctx.fill();
        if (g > 0.6) {
            ctx.globalAlpha = a * clamp((g - 0.6) / 0.4, 0, 1);
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.font = `36px "${F.label}"`;
            ctx.fillText(String(Math.round(v * 10) / 10), x + bw / 2, bottom - bh - 14);
            ctx.globalAlpha = a;
        }
        if (labels[i]) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.textAlign = 'center';
            ctx.font = `30px "${F.body}"`;
            ctx.fillText(labels[i].slice(0, 10), x + bw / 2, bottom + 44);
        }
    });
    ctx.restore();
}

function drawBurst(ctx, p, t, duration) {
    const { w, h } = templateSize('burst', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const rays = clamp(Math.round(Number(p.rays) || 12), 4, 24);
    // Rays shoot out with an overshoot, then hold and turn slowly.
    const outer = easeOutBack(clamp(t / 0.45, 0, 1));
    const inner = easeOutCubic(clamp((t - 0.1) / 0.5, 0, 1));
    const R = Math.min(w, h) / 2 - 16;
    ctx.save();
    ctx.globalAlpha = a;
    shapeStroke(ctx, { ...p, thickness: Number(p.thickness) || 12 });
    ctx.translate(w / 2, h / 2);
    ctx.rotate(t * 0.25);
    for (let i = 0; i < rays; i++) {
        const ang = (i / rays) * Math.PI * 2;
        const r0 = R * (0.3 + 0.25 * inner);
        const r1 = R * Math.min(1, 0.35 + 0.65 * outer);
        if (r1 <= r0) continue;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
        ctx.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
        ctx.stroke();
    }
    ctx.restore();
}

function drawLineGraph(ctx, p, t, duration, F) {
    const { w, h } = templateSize('line-graph', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const vals = String(p.values || '20,45,35,70,95').split(',').map(v => Number(v.trim())).filter(Number.isFinite);
    if (vals.length < 2) return;
    const labels = String(p.labels || '').split(',').map(s => s.trim());
    const maxVal = Math.max(...vals, 1);
    const prog = easeOutCubic(clamp(t / (duration * 0.4), 0, 1));

    ctx.save();
    ctx.globalAlpha = a;

    // Card background
    ctx.fillStyle = 'rgba(15,18,28,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 6, 6, w - 12, h - 12, 28);
    ctx.fill();
    ctx.stroke();

    const padX = 70;
    const padY = 60;
    const chartW = w - padX * 2;
    const chartH = h - padY * 2 - 40;
    const stepX = chartW / (vals.length - 1);

    const pts = vals.map((v, i) => {
        const px = padX + i * stepX;
        const norm = (v / maxVal) * prog;
        const py = padY + chartH - norm * chartH;
        return { x: px, y: py };
    });

    // Area fill under curve
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, padY + chartH);
    pts.forEach(pt => ctx.lineTo(pt.x, pt.y));
    ctx.lineTo(pts[pts.length - 1].x, padY + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padY, 0, padY + chartH);
    grad.addColorStop(0, p.color ? `${p.color}55` : 'rgba(0,229,255,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // Line stroke
    ctx.save();
    ctx.strokeStyle = p.color || '#00E5FF';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = p.color || '#00E5FF';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    pts.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
    ctx.restore();

    // Data points & labels
    pts.forEach((pt, i) => {
        ctx.fillStyle = p.accent || '#FFE500';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
        ctx.fill();

        if (labels[i]) {
            ctx.fillStyle = '#94A3B8';
            ctx.font = `20px "${F.body}"`;
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], pt.x, h - padY + 15);
        }
    });

    ctx.restore();
}

function drawCircularMeter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('circular-meter', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    // `|| 84` would turn a meter set to 0% into one reading 84%: zero is a
    // real value here, and falsy. Found by a check on `particles`, then the
    // same shape turned up in three more places.
    const targetVal = clamp(numOr(p.value, 84), 0, 100);
    const prog = easeOutCubic(clamp(t / (duration * 0.45), 0, 1));
    const curVal = Math.round(targetVal * prog);

    ctx.save();
    ctx.globalAlpha = a;

    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 30;
    ctx.fillStyle = 'rgba(15,18,28,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 20, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI * 0.75, Math.PI * 0.75);
    ctx.stroke();

    const startAng = -Math.PI * 0.75;
    const totalAng = Math.PI * 1.5;
    const endAng = startAng + totalAng * (curVal / 100);
    ctx.strokeStyle = p.color || '#00E5FF';
    ctx.lineWidth = 26;
    ctx.lineCap = 'round';
    ctx.shadowColor = p.color || '#00E5FF';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAng, endAng);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 84px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${curVal}%`, cx, cy - 10);

    if (p.label) {
        ctx.fillStyle = p.accent || '#10B981';
        ctx.font = `bold 24px "${F.label}"`;
        ctx.fillText(String(p.label).toUpperCase(), cx, cy + 55);
    }
    ctx.restore();
}

function drawDataCounter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('data-counter', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const target = numOr(p.value, 250000);
    const prog = easeOutCubic(clamp(t / (duration * 0.4), 0, 1));
    const cur = Math.round(target * prog);
    const formatted = cur.toLocaleString('en-US');

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(12,15,24,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 6, 6, w - 12, h - 12, 28);
    ctx.fill();
    ctx.stroke();

    if (p.label) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = `bold 22px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.fillText(String(p.label).toUpperCase(), w / 2, 60);
    }

    ctx.fillStyle = p.color || '#10B981';
    ctx.font = `900 88px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = p.color || '#10B981';
    ctx.shadowBlur = 16;
    const prefix = p.prefix || '';
    const suffix = p.suffix || '';
    ctx.fillText(`${prefix}${formatted}${suffix}`, w / 2, h - 60);
    ctx.restore();
}

function drawFilmGrain(ctx, p, t, duration) {
    const { w, h } = templateSize('film-grain', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 1. Cinematic 35mm letterbox frame
    const barH = 50;
    ctx.fillStyle = 'rgba(8, 10, 14, 0.96)';
    ctx.fillRect(0, 0, w, barH);
    ctx.fillRect(0, h - barH, w, barH);

    // Film stock margin label
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
    ctx.fillText('35MM KODAK 500T · RAW', 36, 32);

    // 2. High-density deterministic grain specks
    const seed = Math.floor(t * 24);
    for (let i = 0; i < 800; i++) {
        const gx = ((Math.sin(seed * 99 + i * 13) * 10000) % 1 + 1) % 1 * w;
        const gy = ((Math.cos(seed * 77 + i * 17) * 10000) % 1 + 1) % 1 * (h - barH * 2) + barH;
        const gw = (i % 3) + 1;
        ctx.fillStyle = i % 2 === 0 ? 'rgba(255, 255, 255, 0.88)' : 'rgba(15, 15, 20, 0.88)';
        ctx.fillRect(gx, gy, gw, gw);
    }
    ctx.restore();
}

function drawVhsGlitch(ctx, p, t, duration) {
    const { w, h } = templateSize('vhs-glitch', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;

    // 1. VHS tracking noise band (solid noise block, height 68px = 3.5% of 1920)
    const bandH = 68;
    const trackY = Math.floor(((t * 2.5) % 1) * (h - bandH));
    ctx.fillStyle = 'rgba(240, 245, 255, 0.92)';
    ctx.fillRect(0, trackY, w, bandH);

    // Static noise lines within tracking band
    ctx.fillStyle = 'rgba(20, 20, 30, 0.95)';
    for (let i = 0; i < 6; i++) {
        const ny = trackY + i * 11;
        ctx.fillRect(0, ny, w, 4);
    }

    // 2. VHS OSD Header
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = 'bold 32px monospace';
    ctx.fillText('PLAY ▶', 40, 60);
    ctx.fillText('SP 00:24:19', 40, 105);

    // 3. Chromatic scanline glitches
    const lines = clamp(Number(p.lines) || 4, 1, 10);
    for (let i = 0; i < lines; i++) {
        const ly = ((t * 280 + i * (h / lines)) % h);
        ctx.fillStyle = p.color || '#00E5FF';
        ctx.fillRect(0, ly, w, 3);
    }
    ctx.restore();
}

function drawLightLeak(ctx, p, t, duration) {
    const { w, h } = templateSize('light-leak', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = (t % 3) / 3;
    const lx = prog * (w + 400) - 200;
    const ly = h * 0.35;
    ctx.save();
    ctx.globalAlpha = a;

    // Glowing warm anamorphic flare core with alpha > 200 covering > 5% of screen
    const grad = ctx.createRadialGradient(lx, ly, 30, lx, ly, 500);
    grad.addColorStop(0, '#FFF5CC');
    grad.addColorStop(0.2, p.color || '#FFA500');
    grad.addColorStop(0.45, 'rgba(255, 70, 0, 0.88)');
    grad.addColorStop(0.75, 'rgba(255, 20, 50, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}

function drawLowerThirdMinimal(ctx, p, t, duration, F) {
    const { w, h } = templateSize('lower-third-minimal', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;

    // Slide in from left
    const slideX = (1 - prog) * -50;
    ctx.translate(slideX, 0);

    // Frosted pill card background (alpha 0.94 > 200)
    ctx.fillStyle = 'rgba(12, 16, 26, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fill();
    ctx.stroke();

    // Accent indicator vertical bar on left edge
    ctx.fillStyle = p.color || '#00E5FF';
    roundRect(ctx, 16, 20, 8, h - 40, 4);
    ctx.fill();

    // Speaker Name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 32px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(p.name || 'SPEAKER NAME').toUpperCase(), 44, 68);

    // Role / Title
    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 20px "${F.body}"`;
    ctx.fillText(String(p.role || 'LEAD CREATOR').toUpperCase(), 44, 114);

    ctx.restore();
}

function drawLocationBadge(ctx, p, t, duration, F) {
    const { w, h } = templateSize('location-badge', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Dark pill container
    ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, h / 2);
    ctx.fill();
    ctx.stroke();

    // Red Location Pin Dot
    ctx.fillStyle = p.color || '#FF3B5C';
    ctx.beginPath();
    ctx.arc(42, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();

    // Pin pulse ring
    ctx.strokeStyle = p.color || '#FF3B5C';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(42, h / 2, 16, 0, Math.PI * 2);
    ctx.stroke();

    // Location name
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 24px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(p.location || 'LOCATION').toUpperCase(), 72, h / 2 - 1);

    // Time / secondary
    if (p.time) {
        ctx.fillStyle = '#94A3B8';
        ctx.font = `500 18px "${F.body}"`;
        ctx.textAlign = 'right';
        ctx.fillText(String(p.time), w - 36, h / 2);
    }

    ctx.restore();
}

function drawRetentionProgressBar(ctx, p, t, duration, F) {
    const { w, h } = templateSize('retention-progress-bar', p);
    const a = shapeAlpha(t, duration);
    if (a <= 0) return;
    const prog = easeOutCubic(clamp(t / (duration * 0.9), 0, 1));
    const targetVal = clamp(numOr(p.value, 75), 0, 100);
    const fillPercent = targetVal * prog;

    ctx.save();
    ctx.globalAlpha = a;

    // Background container
    ctx.fillStyle = 'rgba(12, 15, 24, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 18);
    ctx.fill();
    ctx.stroke();

    // Progress track bar
    const barX = 24, barY = 46, barW = w - 48, barH = 26;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    roundRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fill();

    // Active fill with glowing gradient
    if (fillPercent > 0) {
        const fillW = Math.max(barH, (barW * fillPercent) / 100);
        const grad = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
        grad.addColorStop(0, p.color || '#00E5FF');
        grad.addColorStop(1, p.accent || '#FFE500');
        ctx.fillStyle = grad;
        ctx.shadowColor = p.color || '#00E5FF';
        ctx.shadowBlur = 12;
        roundRect(ctx, barX, barY, fillW, barH, barH / 2);
        ctx.fill();
    }

    // Top Label & Percentage
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.fillText(String(p.label || 'PROGRESS').toUpperCase(), barX + 4, 30);

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'right';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.fillText(`${Math.round(fillPercent)}%`, barX + barW - 4, 30);

    ctx.restore();
}

function drawQuoteCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('quote-card', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Card background
    ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 24);
    ctx.fill();
    ctx.stroke();

    // Stylized quote mark
    ctx.fillStyle = p.color || '#FFE500';
    ctx.font = `900 64px "${F.display}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('“', 32, 60);

    // Quote text
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `500 24px "${F.body}"`;
    ctx.textBaseline = 'alphabetic';
    const quoteStr = String(p.quote || 'Simplicity is prerequisite for reliability.');
    ctx.fillText(`"${quoteStr.slice(0, 56)}"`, 36, 130);
    if (quoteStr.length > 56) {
        ctx.fillText(quoteStr.slice(56, 116), 36, 168);
    }

    // Author line
    const authorY = h - 45;
    ctx.fillStyle = p.color || '#FFE500';
    ctx.beginPath();
    ctx.arc(48, authorY - 6, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.author || 'AUTHOR').toUpperCase(), 70, authorY);

    ctx.restore();
}

function drawComparisonCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('comparison-card', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Card background
    ctx.fillStyle = 'rgba(14, 18, 28, 0.95)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 22);
    ctx.fill();
    ctx.stroke();

    // Divider
    const midX = w / 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, 24);
    ctx.lineTo(midX, h - 24);
    ctx.stroke();

    // "VS" badge in center
    ctx.fillStyle = 'rgba(30, 41, 59, 0.9)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(midX, h / 2, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 16px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VS', midX, h / 2);

    // Left (Before)
    const leftX = midX / 2;
    ctx.fillStyle = '#EF4444';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(p.beforeLabel || 'BEFORE').toUpperCase(), leftX, 60);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = `900 36px "${F.display}"`;
    ctx.fillText(String(p.beforeVal || '14 Hours'), leftX, 120);

    // Right (After)
    const rightX = midX + midX / 2;
    ctx.fillStyle = p.accent || '#10B981';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.fillText(String(p.afterLabel || 'AFTER').toUpperCase(), rightX, 60);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `900 38px "${F.display}"`;
    ctx.fillText(String(p.afterVal || '35 Mins'), rightX, 120);

    ctx.restore();
}

function drawSocialNotification(ctx, p, t, duration, F) {
    const { w, h } = templateSize('social-notification', p);
    const { tin, tout } = envelope(t, duration, 0.30, 0.25);
    const a = Math.min(1, tin * 2.5) * tout;
    if (a <= 0) return;
    const slide = easeOutBack(clamp(t / 0.30, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - slide) * -20);

    // Notification Capsule
    ctx.fillStyle = 'rgba(16, 22, 34, 0.96)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 24);
    ctx.fill();
    ctx.stroke();

    // App/Social Icon Circle
    const iconX = 54, iconY = h / 2;
    ctx.fillStyle = p.color || '#FF3B5C';
    ctx.beginPath();
    ctx.arc(iconX, iconY, 24, 0, Math.PI * 2);
    ctx.fill();

    // Notification bell / star symbol inside circle
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 22px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('★', iconX, iconY);

    // Title / App Name
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.title || 'NEW SUBSCRIBER').toUpperCase(), 96, 54);

    // Timestamp
    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 16px "${F.body}"`;
    ctx.textAlign = 'right';
    ctx.fillText('now', w - 32, 54);

    // Subtitle / message
    ctx.textAlign = 'left';
    ctx.fillStyle = '#CBD5E1';
    ctx.font = `500 20px "${F.body}"`;
    const subStr = String(p.subtitle || '@alex started following you');
    ctx.fillText(subStr.slice(0, 42), 96, 95);

    ctx.restore();
}

function drawCommentBubble(ctx, p, t, duration, F) {
    const { w, h } = templateSize('comment-bubble', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Comment Card
    ctx.fillStyle = 'rgba(15, 23, 42, 0.96)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 22);
    ctx.fill();
    ctx.stroke();

    // Avatar Circle
    const avX = 52, avY = 56;
    const grad = ctx.createLinearGradient(avX - 22, avY - 22, avX + 22, avY + 22);
    grad.addColorStop(0, p.color || '#38BDF8');
    grad.addColorStop(1, '#818CF8');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(avX, avY, 22, 0, Math.PI * 2);
    ctx.fill();

    // Avatar Initial
    const userStr = String(p.user || '@marcus_dev');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 18px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(userStr.replace('@', '')[0]?.toUpperCase() || 'U', avX, avY);

    // Username
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 22px "${F.label}"`;
    ctx.fillText(userStr, 90, 52);

    // Verified badge icon
    ctx.fillStyle = '#38BDF8';
    ctx.beginPath();
    ctx.arc(90 + ctx.measureText(userStr).width + 16, 45, 8, 0, Math.PI * 2);
    ctx.fill();

    // Comment Text
    ctx.fillStyle = '#E2E8F0';
    ctx.font = `500 22px "${F.body}"`;
    const cText = String(p.text || 'How do you structure this without ads?');
    ctx.fillText(cText.slice(0, 52), 90, 110);
    if (cText.length > 52) {
        ctx.fillText(cText.slice(52, 105), 90, 145);
    }

    ctx.restore();
}

function drawKpiStatCallout(ctx, p, t, duration, F) {
    const { w, h } = templateSize('kpi-stat-callout', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Background Card with neon border
    ctx.fillStyle = 'rgba(12, 18, 32, 0.96)';
    ctx.strokeStyle = p.color || '#10B981';
    ctx.lineWidth = 2.5;
    roundRect(ctx, 4, 4, w - 8, h - 8, 22);
    ctx.fill();
    ctx.stroke();

    // Big Stat Number
    ctx.fillStyle = p.color || '#10B981';
    ctx.font = `900 76px "${F.display}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const statText = String(p.stat || '+184%');
    ctx.fillText(statText, 40, 106);

    // Trending up pill
    const statW = ctx.measureText(statText).width;
    const pillX = 50 + statW, pillY = 56, pillW = 86, pillH = 34;
    ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
    ctx.strokeStyle = p.color || '#10B981';
    ctx.lineWidth = 1.5;
    roundRect(ctx, pillX, pillY, pillW, pillH, 17);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold 16px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▲ DELTA', pillX + pillW / 2, pillY + pillH / 2);

    // Label Line
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.label || 'ORGANIC RETENTION RATE').toUpperCase(), 40, 160);

    // Accent line underneath
    ctx.fillStyle = p.accent || '#38BDF8';
    ctx.fillRect(40, 178, w - 80, 4);

    ctx.restore();
}

function drawNewspaperHeadline(ctx, p, t, duration, F) {
    const { w, h } = templateSize('newspaper-headline', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Cream newspaper background with crisp editorial feel
    ctx.fillStyle = 'rgba(248, 246, 240, 0.98)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 12);
    ctx.fill();
    ctx.stroke();

    // Masthead header rules
    const pubName = String(p.publication || 'THE TECH DISPATCH').toUpperCase();
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(32, 28);
    ctx.lineTo(w - 32, 28);
    ctx.moveTo(32, 62);
    ctx.lineTo(w - 32, 62);
    ctx.stroke();

    // Publication title
    ctx.fillStyle = '#0F172A';
    ctx.font = `900 22px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pubName, w / 2, 45);

    // Date
    ctx.font = `600 13px "${F.label}"`;
    ctx.textAlign = 'right';
    ctx.fillText(String(p.date || 'OCTOBER 2026').toUpperCase(), w - 40, 45);

    // Headline
    const hl = String(p.headline || 'AI OVERHAULS CREATOR PRODUCTION');
    ctx.fillStyle = '#000000';
    ctx.font = `900 36px "${F.display}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(hl.slice(0, 36), 36, 128);
    if (hl.length > 36) {
        ctx.fillText(hl.slice(36, 75), 36, 172);
    }

    // Yellow highlighter over key phrase
    const highlightWord = p.highlight || 'OVERHAULS';
    const hlProgress = clamp((t - 0.2) / 0.4, 0, 1);
    if (hlProgress > 0) {
        ctx.fillStyle = 'rgba(254, 240, 138, 0.65)';
        ctx.fillRect(36, 138, (w - 72) * hlProgress, 28);
    }

    // Bottom column divider & deck
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(36, 214);
    ctx.lineTo(w - 36, 214);
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.font = `500 16px "${F.body}"`;
    ctx.fillText('SPECIAL REPORT • EDITION No. 42', 36, 238);

    ctx.restore();
}

function drawSearchBar(ctx, p, t, duration, F) {
    const { w, h } = templateSize('search-bar', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.35, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    // Search pill capsule
    ctx.fillStyle = 'rgba(18, 24, 38, 0.96)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = 2.5;
    roundRect(ctx, 4, 4, w - 8, h - 8, (h - 8) / 2);
    ctx.fill();
    ctx.stroke();

    // Magnifying glass icon on left
    const iconX = 52, iconY = h / 2;
    ctx.strokeStyle = p.color || '#00E5FF';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(iconX, iconY - 3, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(iconX + 8, iconY + 5);
    ctx.lineTo(iconX + 17, iconY + 14);
    ctx.stroke();

    // Animated typing query
    const fullQuery = String(p.query || 'how to edit viral videos');
    const typeProg = clamp((t - 0.2) / (duration * 0.6), 0, 1);
    const charCount = Math.floor(typeProg * fullQuery.length);
    const displayedQuery = fullQuery.slice(0, charCount);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 24px "${F.body}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(displayedQuery || (t < 0.25 ? String(p.placeholder || 'Search...') : ''), 88, h / 2);

    // Blinking cursor
    const cursorVisible = Math.floor(t * 4) % 2 === 0;
    if (cursorVisible && charCount < fullQuery.length) {
        const textW = ctx.measureText(displayedQuery).width;
        ctx.fillStyle = p.color || '#00E5FF';
        ctx.fillRect(92 + textW, h / 2 - 14, 3, 28);
    }

    ctx.restore();
}

/**
 * Draw a template at time t (seconds since the clip started) into a context
 * whose drawing area is the template box scaled by `scale`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} kind
 * @param {object} params
 * @param {number} t
 * @param {number} duration
 * @param {{scale?:number, fonts?:object, images?:object}} opts images: url → loaded image
 */
/**
 * R107 PHASE 2 - `word-cycle`: "Made for [Reels | Shorts | TikTok]".
 *
 * The device is everywhere in social video and VIBED had no way to draw it.
 * What makes the difference between the version that looks made and the
 * version that looks generated is one measurement: the slot is as wide as
 * the WIDEST word, not as wide as the word currently in it. Size it from the
 * current word and the prefix shifts on every swap, which is the content
 * driving the layout instead of the layout reserving room for the content.
 *
 * The swap itself overlaps the two words for `TextCraft.SWAP_CROSSFADE_S`: one
 * leaves upward, the next arrives from below. Replacing the string in place
 * gives no frame in which the change is visible, so the slot just stutters.
 *
 * Words that would get less than `TextCraft.MIN_SWAP_DWELL_S` on screen are
 * dropped rather than rushed, because a word nobody can read is a word
 * nobody read however well it animates.
 */
// ─── R112: the storyboard's graphic vocabulary ───────────────────────────────
//
// Every one of these follows the same two rules as the templates above, and
// both exist because preview and export are the SAME code: nothing here reads
// the clock, a random seed, or anything outside (ctx, p, t, duration, F), and
// every element's entrance is a pure function of `t`. A graphic that drifted
// between the browser and the render worker would break parity by
// construction, and no test downstream could tell you which half was right.
//
// The second rule is staggering. Each item in a list enters on its own offset
// (`STAGGER_S`), because "elements arrive simultaneously when they should be
// staggered" is one of the four defects this round exists to close — and the
// cheapest place to fix it is here, where the item index is already in hand.

/** Seconds between two items of a list entering. */
const STAGGER_S = 0.11;

/** The entrance of item `i` of `n`, 0 to 1, within the card's own `tin`. */
function itemIn(t, i, inDur = 0.42) {
    return clamp((t - i * STAGGER_S) / inDur, 0, 1);
}

/** Lay `text` out in at most `maxLines` lines that fit `maxWidth`, shrinking the font if it cannot. */
function fitLines(ctx, text, font, size, maxWidth, maxLines) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { lines: [], size };
    let px = size;
    for (let guard = 0; guard < 24; guard++) {
        ctx.font = `${px}px "${font}"`;
        const lines = [];
        let line = '';
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (ctx.measureText(next).width <= maxWidth || !line) line = next;
            else { lines.push(line); line = word; }
        }
        if (line) lines.push(line);
        if (lines.length <= maxLines) return { lines, size: px };
        px = Math.round(px * 0.92);
        if (px < 18) return { lines: lines.slice(0, maxLines), size: px };
    }
    return { lines: [String(text)], size: px };
}

/** The card chrome every R112 card shares: one surface, one hairline. */
function cardSurface(ctx, w, h, radius = 26, fill = 'rgba(14, 18, 28, 0.94)') {
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, radius);
    ctx.fill();
    ctx.stroke();
}

/** Numbered steps, each sliding in from the left on its own beat. */
function drawStepCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('step-card', p);
    const steps = parseList(p.steps, 5);
    if (steps.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const title = String(p.title || '').trim();

    ctx.save();
    ctx.globalAlpha = a;
    cardSurface(ctx, w, h);

    let y = 28;
    if (title) {
        ctx.fillStyle = accent;
        ctx.font = `bold 26px "${F.label}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(title.toUpperCase().slice(0, 32), 40, y + 14);
        y += 86;
    } else {
        y += 0;
    }

    steps.forEach((step, i) => {
        const e = easeOutCubic(itemIn(t, i));
        if (e <= 0) return;
        const top = y + i * 108;
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate((1 - e) * -40, 0);

        // The number sits in its own filled disc: the reference edits all
        // carry the index as an object, not as a prefix character.
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(40 + 34, top + 40, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#0B0E14';
        ctx.font = `bold 34px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), 40 + 34, top + 42);

        ctx.fillStyle = p.color || '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const { lines, size } = fitLines(ctx, step, F.body, 40, w - 190, 1);
        ctx.font = `600 ${size}px "${F.body}"`;
        ctx.fillText(lines[0] || '', 130, top + 42);
        ctx.restore();
    });
    ctx.restore();
}

/** Ticked items, each tick drawn as it lands. */
function drawChecklist(ctx, p, t, duration, F) {
    const { w, h } = templateSize('checklist', p);
    const items = parseList(p.items, 6);
    if (items.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#10B981';

    ctx.save();
    ctx.globalAlpha = a;
    cardSurface(ctx, w, h);

    items.forEach((item, i) => {
        const e = easeOutCubic(itemIn(t, i));
        if (e <= 0) return;
        const cy = 28 + i * 92 + 46;
        ctx.save();
        ctx.globalAlpha = a * e;

        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        roundRect(ctx, 40, cy - 26, 52, 52, 14);
        ctx.stroke();

        // The tick is DRAWN, not faded: the stroke length follows the same
        // entrance, so it reads as being written rather than appearing.
        const tick = clamp((itemIn(t, i) - 0.35) / 0.5, 0, 1);
        if (tick > 0) {
            ctx.save();
            ctx.strokeStyle = accent;
            ctx.lineWidth = 6;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            const pts = [[52, cy], [63, cy + 12], [82, cy - 14]];
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            if (tick <= 0.5) {
                const k = tick / 0.5;
                ctx.lineTo(pts[0][0] + (pts[1][0] - pts[0][0]) * k, pts[0][1] + (pts[1][1] - pts[0][1]) * k);
            } else {
                const k = (tick - 0.5) / 0.5;
                ctx.lineTo(pts[1][0], pts[1][1]);
                ctx.lineTo(pts[1][0] + (pts[2][0] - pts[1][0]) * k, pts[1][1] + (pts[2][1] - pts[1][1]) * k);
            }
            ctx.stroke();
            ctx.restore();
        }

        ctx.fillStyle = p.color || '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const { lines, size } = fitLines(ctx, item, F.body, 38, w - 160, 1);
        ctx.font = `600 ${size}px "${F.body}"`;
        ctx.fillText(lines[0] || '', 120, cy + 2);
        ctx.restore();
    });
    ctx.restore();
}

/** A question, with the mark as a graphic element rather than punctuation. */
function drawQuestionCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('question-card', p);
    const { tin, tout } = envelope(t, duration, 0.38, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#FFE500';
    const pop = easeOutBack(clamp(t / 0.38, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);
    cardSurface(ctx, w, h, 30);

    // The mark is a graphic element in its own COLUMN, not a watermark behind
    // the words: drawn under the text it collides with the first line, which
    // is the "text is unreadable against the background" defect committed by
    // the card itself. The gutter below is what the text is measured against.
    const markW = Math.round(w * 0.16);
    ctx.save();
    ctx.globalAlpha = a * 0.3 * easeOutCubic(clamp((t - 0.1) / 0.5, 0, 1));
    ctx.fillStyle = accent;
    ctx.font = `${Math.round(h * 0.78)}px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', w - 34 - markW / 2, h / 2 + h * 0.06);
    ctx.restore();

    const text = String(p.question || '').replace(/\s*\?\s*$/, '').trim();
    ctx.fillStyle = p.color || '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const { lines, size } = fitLines(ctx, text, F.display, 72, w - 110 - markW, 3);
    ctx.font = `${size}px "${F.display}"`;
    const lh = size * 1.12;
    const top = h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => {
        const e = easeOutCubic(itemIn(t, i, 0.38));
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate(0, (1 - e) * 16);
        ctx.fillText(line, 56, top + i * lh);
        ctx.restore();
    });
    ctx.restore();
}

/** Two labels on either side of a drawn divider: the contrast beat. */
function drawSplitLabel(ctx, p, t, duration, F) {
    const { w, h } = templateSize('split-label', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.22);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const horizontal = p.divider === 'horizontal';
    const grow = easeOutCubic(clamp(t / 0.4, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (horizontal) {
        const y = h / 2;
        ctx.moveTo(w / 2 - (w / 2) * grow, y);
        ctx.lineTo(w / 2 + (w / 2) * grow, y);
    } else {
        const x = w / 2;
        ctx.moveTo(x, h / 2 - (h / 2) * grow);
        ctx.lineTo(x, h / 2 + (h / 2) * grow);
    }
    ctx.stroke();

    const pairs = horizontal
        ? [[p.left, p.leftColor, w / 2, h / 4, -1], [p.right, p.rightColor, w / 2, (h * 3) / 4, 1]]
        : [[p.left, p.leftColor, w / 4, h / 2, -1], [p.right, p.rightColor, (w * 3) / 4, h / 2, 1]];

    pairs.forEach(([label, color, cx, cy, dir], i) => {
        const text = String(label || '').trim();
        if (!text) return;
        const e = easeOutCubic(itemIn(t, i, 0.4));
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate(horizontal ? 0 : dir * (1 - e) * 44, horizontal ? dir * (1 - e) * 36 : 0);
        ctx.fillStyle = color || '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const { lines, size } = fitLines(ctx, text, F.display, 76, (horizontal ? w : w / 2) - 90, 2);
        ctx.font = `${size}px "${F.display}"`;
        const lh = size * 1.1;
        const top = cy - ((lines.length - 1) * lh) / 2;
        lines.forEach((line, k) => ctx.fillText(line, cx, top + k * lh));
        ctx.restore();
    });
    ctx.restore();
}

/** A browser or phone frame around an image — the product/evidence beat. */
function drawScreenshotCard(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('screenshot-card', p);
    const { tin, tout } = envelope(t, duration, 0.42, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.42, 0, 1));
    const phone = p.chrome === 'phone';
    const radius = Math.max(0, Number(p.radius) || 18);
    const barH = phone ? 46 : 54;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    const light = p.theme === 'light';
    ctx.fillStyle = light ? '#FFFFFF' : 'rgba(10, 13, 20, 0.97)';
    ctx.strokeStyle = light ? '#1F2937' : 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, phone ? 40 : radius + 10);
    ctx.fill();
    ctx.stroke();

    // Chrome: three dots and an address pill for a browser, a notch for a phone.
    if (phone) {
        ctx.fillStyle = light ? '#111827' : 'rgba(255, 255, 255, 0.16)';
        roundRect(ctx, w / 2 - 70, 20, 140, 16, 8);
        ctx.fill();
    } else {
        ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(34 + i * 26, 4 + barH / 2, 8, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        roundRect(ctx, 126, 4 + barH / 2 - 15, w - 170, 30, 15);
        ctx.fill();
        const title = String(p.title || '').slice(0, 42);
        if (title) {
            ctx.fillStyle = light ? '#374151' : 'rgba(255, 255, 255, 0.6)';
            ctx.font = `17px "${F.body}"`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(title, 146, 4 + barH / 2);
        }
    }

    const vx = 18;
    const vy = 4 + barH + 8;
    const vw = w - 36;
    const vh = h - vy - 22;
    ctx.save();
    roundRect(ctx, vx, vy, vw, vh, radius);
    ctx.clip();
    const img = (images || {})[p.imageUrl] || null;
    if (img) {
        // Cover, centred: a screenshot letterboxed inside its own frame looks
        // like a bug, and the frame is already the right shape to fill.
        const sr = (img.width || 1) / (img.height || 1);
        const dr = vw / vh;
        let dw = vw;
        let dh = vh;
        if (sr > dr) dw = vh * sr; else dh = vw / sr;
        ctx.drawImage(img, vx + (vw - dw) / 2, vy + (vh - dh) / 2, dw, dh);
    } else {
        // No asset: a plausible interface rather than an empty rectangle.
        ctx.fillStyle = light ? '#F3F4F6' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(vx, vy, vw, vh);
        ctx.fillStyle = p.accent || '#00E5FF';
        ctx.globalAlpha = a * 0.5;
        roundRect(ctx, vx + 28, vy + 26, Math.min(220, vw * 0.4), 18, 9);
        ctx.fill();
        ctx.globalAlpha = a * (light ? 0.5 : 0.18);
        ctx.fillStyle = light ? '#D1D5DB' : '#FFFFFF';
        for (let i = 0; i < 5; i++) {
            const rowY = vy + 76 + i * 46;
            if (rowY + 20 > vy + vh) break;
            roundRect(ctx, vx + 28, rowY, vw - 56 - (i % 2 ? 90 : 0), 20, 10);
            ctx.fill();
        }
    }
    ctx.restore();
    ctx.restore();
}

/** Transparent device shell. A separately rendered project-video clip sits in its screen opening. */
function drawPhoneFrame(ctx, p, t, duration) {
    const { w, h } = templateSize('phone-frame', p);
    const { tin, tout } = envelope(t, duration, 0.38, 0.24);
    const alpha = Math.min(1, tin * 2.4) * tout;
    if (alpha <= 0) return;
    const shell = p.theme === 'light' ? '#F9FAFB' : '#111318';
    const edge = p.theme === 'light' ? '#D1D5DB' : '#535861';
    const sx = w * 0.075, sy = h * 0.055, sw = w * 0.85, sh = h * 0.89;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.32)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 18;
    ctx.fillStyle = shell;
    roundRect(ctx, 4, 4, w - 8, h - 8, 68);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    roundRect(ctx, sx, sy, sw, sh, 48);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 8;
    roundRect(ctx, 4, 4, w - 8, h - 8, 68);
    ctx.stroke();
    // Earpiece and camera sit in the bezel, outside the transparent screen.
    ctx.fillStyle = shell;
    roundRect(ctx, w * 0.39, h * 0.022, w * 0.22, 14, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(w * 0.68, h * 0.03, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.accent || '#FFFFFF';
    ctx.globalAlpha = alpha * 0.22;
    ctx.lineWidth = 2;
    roundRect(ctx, sx + 3, sy + 3, sw - 6, sh - 6, 45);
    ctx.stroke();
    ctx.restore();
}

function drawSceneBackground(ctx, p) {
    const { w, h } = templateSize('scene-background', p);
    ctx.save();
    ctx.fillStyle = p.color || '#F9FAFB';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}

/** A small app surface: title, rows, a button. The "show the product" beat. */
function drawUiCard(ctx, p, t, duration, F) {
    const { w, h } = templateSize('ui-card', p);
    const rows = parseList(p.rows, 5);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const cta = String(p.cta || '').trim();
    const light = p.theme === 'light';

    ctx.save();
    ctx.globalAlpha = a;
    cardSurface(ctx, w, h, 28, light ? '#FFFFFF' : 'rgba(12, 15, 22, 0.96)');
    if (light) { ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 3; roundRect(ctx, 2, 2, w - 4, h - 4, 28); ctx.stroke(); }

    const title = String(p.title || '').trim();
    if (title) {
        ctx.fillStyle = light ? '#111827' : '#FFFFFF';
        ctx.font = `600 36px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(title.slice(0, 26), 40, 74);
    }

    rows.forEach((row, i) => {
        const e = easeOutCubic(itemIn(t, i + 1));
        if (e <= 0) return;
        const top = 130 + i * 86;
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate(0, (1 - e) * 14);
        ctx.fillStyle = light ? '#F3F4F6' : 'rgba(255, 255, 255, 0.06)';
        roundRect(ctx, 32, top, w - 64, 66, 16);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(66, top + 33, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = light ? '#1F2937' : 'rgba(255, 255, 255, 0.88)';
        const { lines, size } = fitLines(ctx, row, F.body, 30, w - 150, 1);
        ctx.font = `500 ${size}px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(lines[0] || '', 96, top + 35);
        ctx.restore();
    });

    if (cta) {
        const e = easeOutCubic(itemIn(t, rows.length + 1));
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.fillStyle = accent;
        roundRect(ctx, 32, h - 100, w - 64, 66, 18);
        ctx.fill();
        ctx.fillStyle = light ? '#FFFFFF' : '#0B0E14';
        ctx.font = `bold 30px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cta.slice(0, 20), w / 2, h - 65);
        ctx.restore();
    }
    ctx.restore();
}

/** A circular portrait with a name under it — the floating faces in a social proof beat. */
function drawProfilePortrait(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('profile-portrait', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    if (p.shape === 'rounded') {
        const x = 14, y = 14, cardW = w - 28, cardH = h - 28;
        const img = (images || {})[p.imageUrl] || null;
        ctx.save();
        ctx.globalAlpha = a;
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 10;
        ctx.fillStyle = p.theme === 'light' ? '#FFFFFF' : '#111827';
        roundRect(ctx, x, y, cardW, cardH, 38);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.save();
        roundRect(ctx, x + 8, y + 8, cardW - 16, cardH - 16, 32);
        ctx.clip();
        if (img) {
            const iw = img.width || 1, ih = img.height || 1;
            const boxW = cardW - 16, boxH = cardH - 16;
            const scale = Math.max(boxW / iw, boxH / ih);
            const dw = iw * scale, dh = ih * scale;
            ctx.drawImage(img, x + 8 + (boxW - dw) / 2, y + 8 + (boxH - dh) / 2, dw, dh);
        } else {
            ctx.fillStyle = '#E5E7EB';
            ctx.fillRect(x + 8, y + 8, cardW - 16, cardH - 16);
        }
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.lineWidth = 8;
        roundRect(ctx, x + 4, y + 4, cardW - 8, cardH - 8, 36);
        ctx.stroke();
        ctx.restore();
        return;
    }
    const pop = easeOutBack(clamp(t / 0.4, 0, 1));
    const r = 150;
    const cx = w / 2;
    const cy = 30 + r;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    ctx.translate(-cx, -cy);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const img = (images || {})[p.imageUrl] || null;
    if (img) {
        const side = r * 2;
        const sr = (img.width || 1) / (img.height || 1);
        let dw = side;
        let dh = side;
        if (sr > 1) dw = side * sr; else dh = side / sr;
        ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    } else {
        // A neutral silhouette, never a blank disc.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.beginPath();
        ctx.arc(cx, cy - 34, 56, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy + 148, 110, Math.PI, 0);
        ctx.fill();
    }
    ctx.restore();

    if (Number(p.ring) !== 0) {
        // The ring is DRAWN round as the portrait lands, so the eye follows it
        // to the face instead of the whole thing appearing at once.
        const sweep = easeOutCubic(clamp((t - 0.12) / 0.55, 0, 1));
        ctx.strokeStyle = accent;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(cx, cy, r + 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep);
        ctx.stroke();
    }

    const name = String(p.name || '').trim();
    const handle = String(p.handle || '').trim();
    if (name) {
        ctx.globalAlpha = a * easeOutCubic(itemIn(t, 1));
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 44px "${F.body}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(name.slice(0, 18), cx, cy + r + 34);
    }
    if (handle) {
        ctx.globalAlpha = a * easeOutCubic(itemIn(t, 2));
        ctx.fillStyle = accent;
        ctx.font = `28px "${F.body}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(handle.slice(0, 22), cx, cy + r + 92);
    }
    ctx.restore();
}

/** Two to four figures side by side, each with its label. */
function drawStatGrid(ctx, p, t, duration, F) {
    const { w, h } = templateSize('stat-grid', p);
    const values = parseList(p.values, 4);
    if (values.length === 0) return;
    const labels = parseList(p.labels, 4);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const light = p.theme === 'light';
    const cellW = 260;
    const gap = 40;
    const totalW = values.length * cellW + (values.length - 1) * gap;
    const x0 = (w - totalW) / 2;

    ctx.save();
    ctx.globalAlpha = a;
    values.forEach((value, i) => {
        const e = easeOutCubic(itemIn(t, i, 0.4));
        if (e <= 0) return;
        const cx = x0 + i * (cellW + gap) + cellW / 2;
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate(0, (1 - e) * 26);

        ctx.fillStyle = light ? '#FFFFFF' : 'rgba(14, 18, 28, 0.92)';
        ctx.strokeStyle = light ? '#E5E7EB' : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 2;
        roundRect(ctx, cx - cellW / 2, 10, cellW, h - 20, 24);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const { lines, size } = fitLines(ctx, value, F.display, 96, cellW - 40, 1);
        ctx.font = `${size}px "${F.display}"`;
        ctx.fillText(lines[0] || '', cx, h / 2 - 22);

        const label = labels[i];
        if (label) {
            ctx.fillStyle = light ? '#6B7280' : 'rgba(255, 255, 255, 0.7)';
            const lf = fitLines(ctx, label, F.label, 26, cellW - 36, 1);
            ctx.font = `bold ${lf.size}px "${F.label}"`;
            ctx.fillText((lf.lines[0] || '').toUpperCase(), cx, h / 2 + 62);
        }
        ctx.restore();
    });
    ctx.restore();
}

// ─── R113: labels, markers and the rest of the chart family ──────────────────
//
// Same two rules as every template above: pure in (ctx, p, t, duration, F),
// and every list staggers. One more rule earns its own note here —
//
// A CHART IS DRAWN FROM ITS NUMBERS. `values` is a comma list parsed into
// numbers, and every bar, slice and point is computed from it. Nothing here
// draws text shaped like a chart. That is what makes a chart editable after
// the fact and lets a checker compare the label against the value, and it is
// why `pie-chart` recomputes its percentages rather than taking them as
// strings: a slice and its caption cannot disagree if only one of them exists.

/** The tones a `status-label` can take: colour, and the glyph drawn beside it. */
export const LABEL_TONES = Object.freeze({
    tip:      { color: '#00E5FF', glyph: 'bulb' },
    warning:  { color: '#FFB020', glyph: 'bang' },
    success:  { color: '#10B981', glyph: 'tick' },
    error:    { color: '#EF4444', glyph: 'cross' },
    new:      { color: '#A855F7', glyph: 'star' },
    live:     { color: '#FF3B5C', glyph: 'dot' },
    time:     { color: '#94A3B8', glyph: 'clock' },
    source:   { color: '#94A3B8', glyph: 'link' },
    category: { color: '#38BDF8', glyph: 'none' },
});

/**
 * A number, or the fallback when there isn't one.
 *
 * `Number(x) || fallback` is wrong wherever ZERO is a legitimate value: 0 is
 * falsy, so a meter set to 0% silently reads as the default. This is the
 * shape every such param needs.
 */
function numOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * A deterministic 0..1 hash of an integer.
 *
 * NOT Math.random. The preview and the export draw the same frame
 * independently, so anything random would place a particle differently in
 * each and no parity check could say which was right. TransitionFX has its
 * own copy of this for the same reason.
 */
function noise(i) {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

/** Is this a usable #rrggbb? Local: BrandKit is not imported by the catalogue. */
function isHex(v) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v ?? '').trim());
}

/** Numbers from a comma list, junk dropped. */
function parseNumbers(v, max) {
    return parseList(v, max).map(x => Number(String(x).replace(/[^\d.\-]/g, ''))).filter(Number.isFinite);
}

/**
 * A palette for a chart with no colours of its own.
 *
 * Lightness steps off the accent keep it ONE palette rather than a set of
 * unrelated hues. The first version stepped by 0.12 to 0.62 toward white and
 * the slices came out indistinguishable on screen — a legend saying 45/30/25
 * beside three identical cyans is a chart that cannot be read, which was
 * caught by rendering it and not by any assertion. The series now alternates
 * toward white and toward black, so adjacent entries differ in the direction
 * the eye is most sensitive to.
 */
function seriesColors(given, n, accent) {
    const named = parseList(given, 8);
    if (named.length >= n) return named.slice(0, n);
    const base = accent || '#00E5FF';
    const out = [...named];
    const steps = [0, 0.55, 0.3, 0.75, 0.15, 0.62, 0.42, 0.85];
    for (let i = out.length; i < n; i++) {
        const k = steps[i % steps.length];
        // Even entries lighten, odd entries deepen: neighbours never land on
        // the same perceived tone.
        out.push(i % 2 === 0 ? mixHex(base, '#FFFFFF', k) : mixHex(base, '#0A1A20', k));
    }
    return out;
}

/** Blend two #rrggbb colours. Local to this file: ColorTheory is not imported here. */
function mixHex(a, b, k) {
    const hex = (c) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim());
        return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : [0, 229, 255];
    };
    const [r1, g1, b1] = hex(a);
    const [r2, g2, b2] = hex(b);
    const t = clamp(Number(k) || 0, 0, 1);
    const to = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0');
    return `#${to(r1, r2)}${to(g1, g2)}${to(b1, b2)}`;
}

/** The small glyphs a status label can carry, drawn in a 24px box at (0,0). */
function drawGlyph(ctx, glyph, size, color) {
    const u = size / 24;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.4 * u;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (glyph === 'bulb') {
        ctx.arc(12 * u, 10 * u, 6 * u, Math.PI * 0.85, Math.PI * 0.15);
        ctx.moveTo(9 * u, 17 * u); ctx.lineTo(15 * u, 17 * u);
        ctx.moveTo(10 * u, 20 * u); ctx.lineTo(14 * u, 20 * u);
        ctx.stroke();
    } else if (glyph === 'bang') {
        ctx.moveTo(12 * u, 4 * u); ctx.lineTo(22 * u, 20 * u); ctx.lineTo(2 * u, 20 * u); ctx.closePath();
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(12 * u, 10 * u); ctx.lineTo(12 * u, 14 * u); ctx.stroke();
        ctx.beginPath(); ctx.arc(12 * u, 17 * u, 1.2 * u, 0, Math.PI * 2); ctx.fill();
    } else if (glyph === 'tick') {
        ctx.moveTo(5 * u, 13 * u); ctx.lineTo(10 * u, 18 * u); ctx.lineTo(19 * u, 6 * u); ctx.stroke();
    } else if (glyph === 'cross') {
        ctx.moveTo(6 * u, 6 * u); ctx.lineTo(18 * u, 18 * u);
        ctx.moveTo(18 * u, 6 * u); ctx.lineTo(6 * u, 18 * u); ctx.stroke();
    } else if (glyph === 'star') {
        for (let i = 0; i < 5; i++) {
            const a = -Math.PI / 2 + (i * Math.PI * 4) / 5;
            const x = 12 * u + Math.cos(a) * 9 * u;
            const y = 12 * u + Math.sin(a) * 9 * u;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill();
    } else if (glyph === 'dot') {
        ctx.arc(12 * u, 12 * u, 5 * u, 0, Math.PI * 2); ctx.fill();
    } else if (glyph === 'clock') {
        ctx.arc(12 * u, 12 * u, 8.5 * u, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(12 * u, 7 * u); ctx.lineTo(12 * u, 12 * u); ctx.lineTo(16 * u, 14 * u); ctx.stroke();
    } else if (glyph === 'link') {
        ctx.moveTo(9 * u, 15 * u); ctx.lineTo(15 * u, 9 * u); ctx.stroke();
        ctx.beginPath(); ctx.arc(7 * u, 17 * u, 4 * u, Math.PI * 1.75, Math.PI * 0.75); ctx.stroke();
        ctx.beginPath(); ctx.arc(17 * u, 7 * u, 4 * u, Math.PI * 0.75, Math.PI * 1.75); ctx.stroke();
    }
    ctx.restore();
}

/** A pill: tone colour, optional glyph, the words. */
function drawStatusLabel(ctx, p, t, duration, F) {
    const { w, h } = templateSize('status-label', p);
    const text = String(p.text || '').trim();
    if (!text) return;
    const base = LABEL_TONES[p.tone] || LABEL_TONES.category;
    // Only `category` is repaintable; see the note on this template's defaults.
    const tone = (p.tone === 'category' || !LABEL_TONES[p.tone]) && isHex(p.accent)
        ? { ...base, color: p.accent }
        : base;
    const { tin, tout } = envelope(t, duration, 0.3, 0.22);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.3, 0, 1));
    const glyph = p.icon === 'none' ? 'none' : (p.icon === 'auto' || !p.icon ? tone.glyph : p.icon);
    const hasGlyph = glyph && glyph !== 'none';

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    ctx.fillStyle = 'rgba(10, 13, 20, 0.92)';
    ctx.strokeStyle = tone.color;
    ctx.lineWidth = 3;
    roundRect(ctx, 3, 3, w - 6, h - 6, (h - 6) / 2);
    ctx.fill();
    ctx.stroke();

    let x = 30;
    if (hasGlyph) {
        // `live` pulses, because that is the one tone whose whole meaning is
        // "this is happening now".
        const beat = p.tone === 'live' ? 0.7 + 0.3 * (0.5 + 0.5 * Math.cos(t * 5.2)) : 1;
        ctx.save();
        ctx.globalAlpha = a * beat;
        ctx.translate(x, h / 2 - 16);
        drawGlyph(ctx, glyph, 32, tone.color);
        ctx.restore();
        x += 48;
    }
    ctx.fillStyle = tone.color;
    ctx.font = `bold 34px "${F.label}"`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.toUpperCase().slice(0, 32), x, h / 2 + 1);
    ctx.restore();
}

/** A numbered disc, with an optional label beside it. */
function drawNumberedMarker(ctx, p, t, duration, F) {
    const { w, h } = templateSize('numbered-marker', p);
    const { tin, tout } = envelope(t, duration, 0.32, 0.22);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const pop = easeOutBack(clamp(t / 0.32, 0, 1));
    const label = String(p.label || '').trim();

    ctx.save();
    ctx.globalAlpha = a;
    ctx.save();
    ctx.translate(48, 48);
    ctx.scale(pop, pop);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0B0E14';
    ctx.font = `bold 44px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Number(p.number) || 0)).slice(0, 2), 0, 2);
    ctx.restore();

    if (label) {
        const e = easeOutCubic(clamp((t - 0.14) / 0.36, 0, 1));
        ctx.globalAlpha = a * e;
        ctx.fillStyle = 'rgba(10, 13, 20, 0.9)';
        const lw = w - 104;
        roundRect(ctx, 100, 20, lw * e, 56, 14);
        ctx.fill();
        ctx.save();
        roundRect(ctx, 100, 20, lw * e, 56, 14);
        ctx.clip();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 30px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.slice(0, 30), 120, 49);
        ctx.restore();
    }
    ctx.restore();
}

/** Darken the frame except a soft hole. Frame-sized by nature. */
function drawSpotlight(ctx, p, t, duration) {
    const { w, h } = templateSize('spotlight', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.3);
    const a = Math.min(1, tin) * tout;
    if (a <= 0) return;
    const cx = clamp(Number(p.x) || 0.5, 0, 1) * w;
    const cy = clamp(Number(p.y) || 0.45, 0, 1) * h;
    const r = Math.max(10, (Number(p.radius) || 0.22) * w);
    const soft = Math.max(0, Number(p.soft) || 0.06) * w;
    const dim = clamp(numOr(p.dim, 0.72), 0, 1);
    // The hole OPENS: a dim layer that appears fully formed reads as a cut to
    // a different shot rather than attention moving.
    const grow = easeOutCubic(clamp(t / 0.4, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = `rgba(0, 0, 0, ${dim})`;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    const rr = Math.max(1, r * grow);
    const g = ctx.createRadialGradient(cx, cy, Math.max(0, rr - soft), cx, cy, rr + soft);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, rr + soft, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** A lens ring with a handle, over a lightly dimmed frame. */
function drawMagnifier(ctx, p, t, duration) {
    const { w, h } = templateSize('magnifier', p);
    const { tin, tout } = envelope(t, duration, 0.38, 0.26);
    const a = Math.min(1, tin) * tout;
    if (a <= 0) return;
    const cx = clamp(Number(p.x) || 0.5, 0, 1) * w;
    const cy = clamp(Number(p.y) || 0.45, 0, 1) * h;
    const r = Math.max(20, (Number(p.radius) || 0.16) * w);
    const accent = p.accent || '#00E5FF';
    const pop = easeOutBack(clamp(t / 0.38, 0, 1));

    ctx.save();
    ctx.globalAlpha = a * 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r * pop, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, r * pop, 0, Math.PI * 2);
    ctx.stroke();
    if (Number(p.handle) !== 0) {
        const d = r * pop * 0.7071;
        ctx.lineCap = 'round';
        ctx.lineWidth = 16;
        ctx.beginPath();
        ctx.moveTo(cx + d, cy + d);
        ctx.lineTo(cx + d + r * 0.6 * pop, cy + d + r * 0.6 * pop);
        ctx.stroke();
    }
    ctx.restore();
}

/** Corner brackets closing on a point, with an optional label. */
function drawCrosshair(ctx, p, t, duration, F) {
    const { w, h } = templateSize('crosshair', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.26);
    const a = Math.min(1, tin) * tout;
    if (a <= 0) return;
    const cx = clamp(Number(p.x) || 0.5, 0, 1) * w;
    const cy = clamp(Number(p.y) || 0.45, 0, 1) * h;
    const size = Math.max(40, (Number(p.size) || 0.18) * w);
    const accent = p.accent || '#00E5FF';
    // The brackets CLOSE in from outside: a target that appears at its final
    // size does not read as locking on to anything.
    const close = easeOutCubic(clamp(t / 0.4, 0, 1));
    const half = size / 2 + (1 - close) * size * 0.45;
    const arm = size * 0.3;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = cx + sx * half;
        const y = cy + sy * half;
        ctx.beginPath();
        ctx.moveTo(x - sx * arm, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y - sy * arm);
        ctx.stroke();
    }
    ctx.globalAlpha = a * 0.8;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.1, cy); ctx.lineTo(cx + size * 0.1, cy);
    ctx.moveTo(cx, cy - size * 0.1); ctx.lineTo(cx, cy + size * 0.1);
    ctx.stroke();

    const label = String(p.label || '').trim();
    if (label) {
        ctx.globalAlpha = a * easeOutCubic(clamp((t - 0.2) / 0.4, 0, 1));
        ctx.font = `bold 30px "${F.label}"`;
        const tw = ctx.measureText(label.toUpperCase()).width;
        ctx.fillStyle = 'rgba(10,13,20,0.92)';
        roundRect(ctx, cx - tw / 2 - 18, cy + half + 18, tw + 36, 52, 12);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label.toUpperCase(), cx, cy + half + 45);
    }
    ctx.restore();
}

/** Shared by pie and donut: slices grown around the circle, then a legend. */
function drawPieLike(ctx, p, t, duration, F, kind) {
    const { w, h } = templateSize(kind, p);
    const values = parseNumbers(p.values, 6);
    if (values.length === 0) return;
    const total = values.reduce((x, y) => x + Math.max(0, y), 0);
    if (!(total > 0)) return;
    const labels = parseList(p.labels, 6);
    const colors = seriesColors(p.colors, values.length, p.accent);
    const { tin, tout } = envelope(t, duration, 0.5, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const title = String(p.title || '').trim();
    const titleH = title ? 70 : 0;

    ctx.save();
    ctx.globalAlpha = a;
    if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold 30px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(title.toUpperCase().slice(0, 34), w / 2, 38);
    }

    const cx = w / 2;
    const cy = titleH + 230;
    const r = 200;
    // The whole circle is swept once, so the slices appear in order rather
    // than all at once — the stagger rule, in polar form.
    const sweep = easeOutCubic(clamp(t / 0.6, 0, 1)) * Math.PI * 2;
    let at = -Math.PI / 2;
    values.forEach((v, i) => {
        const share = Math.max(0, v) / total;
        const span = share * Math.PI * 2;
        const drawn = clamp(sweep - (at + Math.PI / 2), 0, span);
        if (drawn <= 0) return;
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, at, at + drawn);
        ctx.closePath();
        ctx.fill();
        at += span;
    });

    if (kind === 'donut-chart') {
        // The hole is punched, not filled with a dark disc: filling assumes a
        // background colour this card does not own.
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        const center = String(p.center || '').trim();
        if (center) {
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const fit = fitLines(ctx, center, F.display, 86, r * 0.95, 1);
            ctx.font = `${fit.size}px "${F.display}"`;
            ctx.fillText(fit.lines[0] || '', cx, cy + 4);
        }
    }

    // The legend states each slice's share, recomputed from the SAME numbers
    // the slice was drawn from, so a caption cannot contradict the picture.
    labels.forEach((label, i) => {
        if (i >= values.length) return;
        const e = easeOutCubic(itemIn(t, i, 0.4));
        if (e <= 0) return;
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 60 + col * (w - 120) / 2;
        const y = titleH + 470 + row * 46;
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.fillStyle = colors[i];
        roundRect(ctx, x, y - 12, 24, 24, 7);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.86)';
        ctx.font = `500 26px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const pct = Math.round((Math.max(0, values[i]) / total) * 100);
        ctx.fillText(`${String(label).slice(0, 16)}  ${pct}%`, x + 38, y + 1);
        ctx.restore();
    });
    ctx.restore();
}

/** A filled line chart: the line is drawn, the fill follows it. */
function drawAreaChart(ctx, p, t, duration, F) {
    const { w, h } = templateSize('area-chart', p);
    const values = parseNumbers(p.values, 24);
    if (values.length < 2) return;
    const { tin, tout } = envelope(t, duration, 0.5, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const title = String(p.title || '').trim();
    const top = title ? 90 : 40;
    const bottom = h - 70;
    const left = 60;
    const right = w - 50;
    const max = Math.max(...values);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const reveal = easeOutCubic(clamp(t / 0.7, 0, 1));
    const at = (i) => ({
        x: left + ((right - left) * i) / (values.length - 1),
        y: bottom - ((values[i] - min) / span) * (bottom - top),
    });

    ctx.save();
    ctx.globalAlpha = a;
    // A backing surface, as `line-graph` and `bar-chart` already have. Without
    // it this was a 6px line and a 45% gradient over whatever the shot was
    // doing — the "text is unreadable against the background" defect in chart
    // form, and sparse enough that the render check called it blank.
    cardSurface(ctx, w, h, 24, 'rgba(12, 16, 24, 0.9)');
    if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `bold 30px "${F.label}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(title.toUpperCase().slice(0, 34), left, 44);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    for (let k = 0; k <= 3; k++) {
        const y = top + ((bottom - top) * k) / 3;
        ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    }

    const cut = left + (right - left) * reveal;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, cut, h);
    ctx.clip();

    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, mixHex(accent, '#000000', 0.1));
    grad.addColorStop(1, mixHex(accent, '#000000', 0.85));
    ctx.globalAlpha = a * 0.62;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(at(0).x, bottom);
    for (let i = 0; i < values.length; i++) { const q = at(i); ctx.lineTo(q.x, q.y); }
    ctx.lineTo(at(values.length - 1).x, bottom);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = a;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
        const q = at(i);
        if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();

    // The head of the line, so the eye has somewhere to be.
    const headI = Math.min(values.length - 1, Math.floor(reveal * (values.length - 1)));
    const head = at(headI);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(head.x, head.y, 9, 0, Math.PI * 2);
    ctx.fill();

    const labels = parseList(p.labels, values.length);
    if (labels.length) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `22px "${F.body}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        labels.forEach((label, i) => {
            if (i >= values.length) return;
            ctx.fillText(String(label).slice(0, 10), at(i).x, bottom + 16);
        });
    }
    ctx.restore();
}

/** Horizontal bars: the long form, for labels that do not fit under a column. */
function drawHBarChart(ctx, p, t, duration, F) {
    const { w, h } = templateSize('h-bar-chart', p);
    const values = parseNumbers(p.values, 6);
    if (values.length === 0) return;
    const labels = parseList(p.labels, 6);
    const { tin, tout } = envelope(t, duration, 0.45, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const suffix = String(p.suffix || '');
    const max = Math.max(...values.map(v => Math.abs(v)), 1);
    const labelW = 230;
    const trackX = labelW + 30;
    const trackW = w - trackX - 120;

    ctx.save();
    ctx.globalAlpha = a;
    values.forEach((v, i) => {
        const e = easeOutCubic(itemIn(t, i, 0.5));
        if (e <= 0) return;
        const y = 40 + i * 104;
        ctx.save();
        ctx.globalAlpha = a * Math.min(1, e * 2);

        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = `600 28px "${F.body}"`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(labels[i] || '').slice(0, 14), labelW, y + 32);

        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        roundRect(ctx, trackX, y + 10, trackW, 44, 22);
        ctx.fill();

        const frac = (Math.abs(v) / max) * e;
        ctx.fillStyle = mixHex(accent, '#FFFFFF', (i / Math.max(1, values.length - 1)) * 0.35);
        roundRect(ctx, trackX, y + 10, Math.max(44, trackW * frac), 44, 22);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 30px "${F.label}"`;
        ctx.textAlign = 'left';
        // The number counts UP with the bar, so the figure and the length
        // always agree on screen.
        ctx.fillText(`${Math.round(v * e)}${suffix}`, trackX + trackW + 18, y + 32);
        ctx.restore();
    });
    ctx.restore();
}

/** A YouTube-shaped thumbnail: image, duration chip, title, channel, views. */
function drawVideoThumbnail(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('video-thumbnail', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.4, 0, 1));
    const accent = p.accent || '#FF0033';
    const thumbH = Math.round((w - 32) * 9 / 16);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    ctx.save();
    roundRect(ctx, 16, 16, w - 32, thumbH, 18);
    ctx.clip();
    const img = (images || {})[p.imageUrl] || null;
    if (img) {
        const sr = (img.width || 16) / (img.height || 9);
        const dr = (w - 32) / thumbH;
        let dw = w - 32;
        let dh = thumbH;
        if (sr > dr) dw = thumbH * sr; else dh = (w - 32) / sr;
        ctx.drawImage(img, 16 + (w - 32 - dw) / 2, 16 + (thumbH - dh) / 2, dw, dh);
    } else {
        const g = ctx.createLinearGradient(16, 16, w - 16, 16 + thumbH);
        g.addColorStop(0, '#1E2430');
        g.addColorStop(1, '#0D1016');
        ctx.fillStyle = g;
        ctx.fillRect(16, 16, w - 32, thumbH);
        // A play glyph rather than a blank rectangle, so a thumbnail with no
        // image still reads as a video.
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.beginPath();
        const cx = w / 2;
        const cy = 16 + thumbH / 2;
        ctx.moveTo(cx - 26, cy - 34);
        ctx.lineTo(cx + 36, cy);
        ctx.lineTo(cx - 26, cy + 34);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    const dur = String(p.duration || '').trim();
    if (dur) {
        ctx.font = `bold 24px "${F.label}"`;
        const tw = ctx.measureText(dur).width;
        ctx.fillStyle = 'rgba(0,0,0,0.82)';
        roundRect(ctx, w - 32 - tw - 36, 16 + thumbH - 50, tw + 24, 36, 8);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(dur, w - 32 - tw - 24, 16 + thumbH - 31);
    }

    // A red progress sliver along the bottom edge: the "already watched" line
    // every platform draws, and what makes this read as a thumbnail at a
    // glance rather than a photo in a box.
    ctx.fillStyle = accent;
    roundRect(ctx, 16, 16 + thumbH - 10, (w - 32) * 0.35, 8, 4);
    ctx.fill();

    const title = String(p.title || '').trim();
    if (title) {
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const fit = fitLines(ctx, title, F.body, 32, w - 48, 2);
        ctx.font = `600 ${fit.size}px "${F.body}"`;
        fit.lines.forEach((line, i) => ctx.fillText(line, 24, 16 + thumbH + 22 + i * (fit.size * 1.25)));
    }
    const meta = [String(p.channel || '').trim(), String(p.views || '').trim()].filter(Boolean).join('  ·  ');
    if (meta) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `24px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(meta.slice(0, 40), 24, h - 20);
    }
    ctx.restore();
}

/** A player frame with a scrubber that actually moves. */
function drawVideoPlayer(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('video-player', p);
    const { tin, tout } = envelope(t, duration, 0.4, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#FF0033';
    const pop = easeOutBack(clamp(t / 0.4, 0, 1));
    const barH = 78;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);

    ctx.fillStyle = '#05070B';
    roundRect(ctx, 4, 4, w - 8, h - 8, 20);
    ctx.fill();

    ctx.save();
    roundRect(ctx, 4, 4, w - 8, h - 8 - barH, 20);
    ctx.clip();
    const img = (images || {})[p.imageUrl] || null;
    if (img) {
        const vh = h - 8 - barH;
        const sr = (img.width || 16) / (img.height || 9);
        const dr = (w - 8) / vh;
        let dw = w - 8;
        let dh = vh;
        if (sr > dr) dw = vh * sr; else dh = (w - 8) / sr;
        ctx.drawImage(img, 4 + (w - 8 - dw) / 2, 4 + (vh - dh) / 2, dw, dh);
    } else {
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#1A212C');
        g.addColorStop(1, '#0A0D13');
        ctx.fillStyle = g;
        ctx.fillRect(4, 4, w - 8, h - 8 - barH);
    }
    ctx.restore();

    // The play/pause button, and the scrubber. `progress` is the resting
    // position; while `playing` it creeps forward in real time, so a still
    // frame of this never looks frozen.
    const vh = h - 8 - barH;
    const playing = Number(p.playing) !== 0;
    const prog = clamp(numOr(p.progress, 0.35) + (playing ? (t / Math.max(0.5, duration)) * 0.18 : 0), 0, 1);

    ctx.save();
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(w / 2, 4 + vh / 2, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    if (playing) {
        roundRect(ctx, w / 2 - 20, 4 + vh / 2 - 26, 14, 52, 4); ctx.fill();
        roundRect(ctx, w / 2 + 6, 4 + vh / 2 - 26, 14, 52, 4); ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(w / 2 - 18, 4 + vh / 2 - 28);
        ctx.lineTo(w / 2 + 28, 4 + vh / 2);
        ctx.lineTo(w / 2 - 18, 4 + vh / 2 + 28);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();

    const barY = h - barH + 10;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    roundRect(ctx, 28, barY, w - 56, 8, 4);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, 28, barY, (w - 56) * prog, 8, 4);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(28 + (w - 56) * prog, barY + 4, 13, 0, Math.PI * 2);
    ctx.fill();

    const title = String(p.title || '').trim();
    if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.72)';
        ctx.font = `500 24px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(title.slice(0, 38), 28, barY + 42);
    }
    ctx.restore();
}

/** Likes, comments, shares — each counting up on its own beat. */
function drawEngagementCounter(ctx, p, t, duration, F) {
    const { w, h } = templateSize('engagement-counter', p);
    const { tin, tout } = envelope(t, duration, 0.38, 0.24);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#FF3B5C';
    const items = [
        { glyph: 'heart', value: String(p.likes || '').trim(), color: accent },
        { glyph: 'speech', value: String(p.comments || '').trim(), color: '#FFFFFF' },
        { glyph: 'share', value: String(p.shares || '').trim(), color: '#FFFFFF' },
    ].filter(x => x.value);
    if (items.length === 0) return;

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(10, 13, 20, 0.9)';
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, w - 8, h - 8, 28);
    ctx.fill();
    ctx.stroke();

    const slot = (w - 40) / items.length;
    items.forEach((item, i) => {
        const e = easeOutBack(clamp(itemIn(t, i, 0.34), 0, 1));
        if (e <= 0) return;
        const cx = 20 + slot * i + slot / 2;
        ctx.save();
        ctx.globalAlpha = a * Math.min(1, e);
        ctx.translate(cx, h / 2);
        ctx.scale(Math.min(1.08, e), Math.min(1.08, e));

        ctx.save();
        ctx.translate(-56, -18);
        if (item.glyph === 'heart') {
            ctx.fillStyle = item.color;
            ctx.beginPath();
            ctx.moveTo(18, 34);
            ctx.bezierCurveTo(-6, 18, 2, -2, 18, 10);
            ctx.bezierCurveTo(34, -2, 42, 18, 18, 34);
            ctx.fill();
        } else if (item.glyph === 'speech') {
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 3.4;
            ctx.lineJoin = 'round';
            roundRect(ctx, 2, 4, 32, 24, 8);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(10, 28); ctx.lineTo(10, 36); ctx.lineTo(19, 28);
            ctx.stroke();
        } else {
            ctx.strokeStyle = item.color;
            ctx.lineWidth = 3.4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(4, 20); ctx.lineTo(34, 6); ctx.lineTo(28, 34); ctx.lineTo(22, 22); ctx.closePath();
            ctx.stroke();
        }
        ctx.restore();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 34px "${F.label}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.value.slice(0, 8), -8, 2);
        ctx.restore();
    });
    ctx.restore();
}

/** Boxes joined by arrows: the simplest diagram, and the most asked for. */
function drawProcessFlow(ctx, p, t, duration, F) {
    const { w, h } = templateSize('process-flow', p);
    const steps = parseList(p.steps, 5);
    if (steps.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.45, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const vertical = p.direction === 'vertical';

    ctx.save();
    ctx.globalAlpha = a;
    steps.forEach((step, i) => {
        // The box lands, THEN the arrow to the next one draws. A flow whose
        // arrows appear with their boxes does not read as a sequence.
        const e = easeOutCubic(itemIn(t, i * 2, 0.34));
        if (e <= 0) return;
        const boxW = vertical ? w - 120 : (w - 60) / steps.length - 50;
        const boxH = vertical ? 100 : 150;
        const x = vertical ? 60 : 30 + i * ((w - 60) / steps.length);
        const y = vertical ? 30 + i * 150 : (h - boxH) / 2;

        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate(x + boxW / 2, y + boxH / 2);
        ctx.scale(0.9 + 0.1 * e, 0.9 + 0.1 * e);
        ctx.translate(-(x + boxW / 2), -(y + boxH / 2));
        ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        roundRect(ctx, x, y, boxW, boxH, 20);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, step, F.body, 30, boxW - 30, 2);
        ctx.font = `600 ${fit.size}px "${F.body}"`;
        const lh = fit.size * 1.2;
        const top = y + boxH / 2 - ((fit.lines.length - 1) * lh) / 2;
        fit.lines.forEach((line, k) => ctx.fillText(line, x + boxW / 2, top + k * lh));
        ctx.restore();

        if (i < steps.length - 1) {
            const ae = easeOutCubic(itemIn(t, i * 2 + 1, 0.3));
            if (ae <= 0) return;
            ctx.save();
            ctx.globalAlpha = a * ae;
            ctx.strokeStyle = accent;
            ctx.fillStyle = accent;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            if (vertical) {
                const x0 = x + boxW / 2;
                ctx.moveTo(x0, y + boxH + 6);
                ctx.lineTo(x0, y + boxH + 6 + 38 * ae);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x0 - 10, y + boxH + 34 * ae);
                ctx.lineTo(x0, y + boxH + 46 * ae);
                ctx.lineTo(x0 + 10, y + boxH + 34 * ae);
                ctx.closePath(); ctx.fill();
            } else {
                const y0 = y + boxH / 2;
                ctx.moveTo(x + boxW + 8, y0);
                ctx.lineTo(x + boxW + 8 + 34 * ae, y0);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(x + boxW + 30 * ae, y0 - 10);
                ctx.lineTo(x + boxW + 44 * ae, y0);
                ctx.lineTo(x + boxW + 30 * ae, y0 + 10);
                ctx.closePath(); ctx.fill();
            }
            ctx.restore();
        }
    });
    ctx.restore();
}

/** Milestones on a drawn rail. */
function drawTimelineSteps(ctx, p, t, duration, F) {
    const { w, h } = templateSize('timeline-steps', p);
    const steps = parseList(p.steps, 6);
    if (steps.length === 0) return;
    const labels = parseList(p.labels, 6);
    const { tin, tout } = envelope(t, duration, 0.45, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const y = h / 2;
    const left = 70;
    const right = w - 70;
    // The rail draws first and the markers land on it as it passes, so the
    // eye travels the timeline rather than being shown it.
    const run = easeOutCubic(clamp(t / 0.7, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    // Same reason as area-chart: a rail and four dots over live footage is
    // not legible, and the other diagram kinds all carry a surface.
    cardSurface(ctx, w, h, 24, 'rgba(12, 16, 24, 0.9)');
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + (right - left) * run, y); ctx.stroke();

    steps.forEach((step, i) => {
        const x = steps.length > 1 ? left + ((right - left) * i) / (steps.length - 1) : (left + right) / 2;
        // +14: the rail head stops exactly ON the last marker's centre, so a
        // strict "has the head passed x" test leaves the final milestone
        // permanently invisible. Found by counting the dots in a render.
        const reached = clamp((left + (right - left) * run - x + 14) / 40, 0, 1);
        if (reached <= 0) return;
        ctx.save();
        ctx.globalAlpha = a * reached;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(x, y, 18 * easeOutBack(reached), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `bold 28px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(step).slice(0, 12), x, y - 36);
        const label = labels[i];
        if (label) {
            ctx.fillStyle = 'rgba(255,255,255,0.6)';
            ctx.font = `22px "${F.body}"`;
            ctx.textBaseline = 'top';
            ctx.fillText(String(label).slice(0, 16), x, y + 34);
        }
        ctx.restore();
    });
    ctx.restore();
}

/** Stacked tapering bands, each as wide as its own number says. */
function drawFunnel(ctx, p, t, duration, F) {
    const { w, h } = templateSize('funnel', p);
    const stages = parseList(p.stages, 5);
    if (stages.length === 0) return;
    const values = parseNumbers(p.values, 5);
    const { tin, tout } = envelope(t, duration, 0.45, 0.25);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const max = values.length ? Math.max(...values, 1) : 1;
    const bandH = 98;
    const gap = 20;

    ctx.save();
    ctx.globalAlpha = a;
    stages.forEach((stage, i) => {
        const e = easeOutCubic(itemIn(t, i, 0.4));
        if (e <= 0) return;
        // The width comes from the VALUE, falling back to an even taper only
        // when there are no numbers. A funnel whose widths are decorative is
        // a picture of a funnel, not a chart.
        const frac = values.length > i ? Math.max(0.12, values[i] / max) : 1 - (i / stages.length) * 0.65;
        const bw = (w - 80) * frac * e;
        const x = (w - bw) / 2;
        const y = 30 + i * (bandH + gap);
        ctx.save();
        ctx.globalAlpha = a * Math.min(1, e * 1.4);
        ctx.fillStyle = mixHex(accent, '#000000', (i / Math.max(1, stages.length - 1)) * 0.45);
        roundRect(ctx, x, y, Math.max(90, bw), bandH, 18);
        ctx.fill();

        // A narrow band cannot hold its own label: the last stages of a real
        // funnel are the narrow ones, and clipping "SIGNUPS" to "GNUP" is
        // worse than putting it outside. Measured, then placed.
        const label = String(stage).toUpperCase();
        const drawn = Math.max(90, bw);
        ctx.font = `bold 30px "${F.label}"`;
        const textW = ctx.measureText(label).width;
        const inside = textW + 36 <= drawn;
        const valueText = values.length > i ? String(Math.round(values[i])) : '';
        ctx.textBaseline = 'middle';
        if (inside) {
            ctx.fillStyle = '#06080C';
            ctx.textAlign = 'center';
            ctx.fillText(label, w / 2, y + bandH / 2 - (valueText ? 14 : 0));
            if (valueText) {
                ctx.fillStyle = 'rgba(6, 8, 12, 0.72)';
                ctx.font = `600 24px "${F.body}"`;
                ctx.fillText(valueText, w / 2, y + bandH / 2 + 20);
            }
        } else {
            if (valueText) {
                ctx.fillStyle = '#06080C';
                ctx.textAlign = 'center';
                ctx.font = `bold 28px "${F.label}"`;
                ctx.fillText(valueText, w / 2, y + bandH / 2 + 1);
            }
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `bold 28px "${F.label}"`;
            ctx.textAlign = 'left';
            ctx.fillText(label, w / 2 + drawn / 2 + 18, y + bandH / 2 + 1);
        }
        ctx.restore();
    });
    ctx.restore();
}

// ─── R114: brand, diagrams, social and audio ─────────────────────────────────

/** A logo image if there is one, else the brand's initial in a disc. */
function drawMark(ctx, p, cx, cy, r, images, F, accent, nameFor) {
    const img = (images || {})[p.imageUrl] || null;
    if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        const side = r * 2;
        const sr = (img.width || 1) / (img.height || 1);
        let dw = side;
        let dh = side;
        if (sr > 1) dw = side * sr; else dh = side / sr;
        ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
        ctx.restore();
        return;
    }
    // A monogram, not an empty circle: a brand graphic with a hole where the
    // logo goes looks like a failed download.
    // Not every card that carries a mark has a `name`: an end card has a
    // `title`, a sponsor card has its own `name`. Without this the monogram
    // fell back to "?" and the end card read as a broken image.
    const source = String(nameFor ?? p.name ?? '').trim();
    const initial = source.charAt(0).toUpperCase() || '?';
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#06080C';
    ctx.font = `${Math.round(r * 1.1)}px "${F.display}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, cx, cy + r * 0.04);
}

/** The mark lands, the name follows, a rule draws under it. */
function drawLogoReveal(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('logo-reveal', p);
    const { tin, tout } = envelope(t, duration, 0.45, 0.3);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const name = String(p.name || '').trim();
    const tagline = String(p.tagline || '').trim();
    const pop = easeOutBack(clamp(t / 0.45, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    const r = 72;
    ctx.save();
    ctx.translate(w / 2, 40 + r);
    ctx.scale(pop, pop);
    ctx.translate(-(w / 2), -(40 + r));
    drawMark(ctx, p, w / 2, 40 + r, r, images, F, accent);
    ctx.restore();

    if (name) {
        const e = easeOutCubic(itemIn(t, 1, 0.4));
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.translate(0, (1 - e) * 14);
        ctx.fillStyle = p.color || '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, name, F.display, 88, w - 80, 1);
        ctx.font = `${fit.size}px "${F.display}"`;
        ctx.fillText(fit.lines[0] || '', w / 2, 40 + r * 2 + 58);
        ctx.restore();
    }

    // The rule is DRAWN outward from the centre, so it reads as the mark
    // settling rather than a line appearing beside it.
    const rule = easeOutCubic(itemIn(t, 2, 0.4));
    if (rule > 0) {
        ctx.globalAlpha = a;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        const half = (w * 0.28) * rule;
        const ry = 40 + r * 2 + 112;
        ctx.beginPath();
        ctx.moveTo(w / 2 - half, ry);
        ctx.lineTo(w / 2 + half, ry);
        ctx.stroke();
    }

    if (tagline) {
        const e = easeOutCubic(itemIn(t, 3, 0.4));
        ctx.globalAlpha = a * e;
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, tagline, F.body, 30, w - 100, 1);
        ctx.font = `500 ${fit.size}px "${F.body}"`;
        ctx.fillText(fit.lines[0] || '', w / 2, 40 + r * 2 + 168);
    }
    ctx.restore();
}

/** The end screen: mark, thanks, a filled CTA, a handle. */
function drawEndCard(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('end-card', p);
    const { tin, tout } = envelope(t, duration, 0.45, 0.3);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';

    ctx.save();
    ctx.globalAlpha = a;
    cardSurface(ctx, w, h, 32, 'rgba(10, 13, 20, 0.95)');

    const pop = easeOutBack(clamp(t / 0.45, 0, 1));
    ctx.save();
    ctx.translate(w / 2, 150);
    ctx.scale(pop, pop);
    ctx.translate(-(w / 2), -150);
    drawMark(ctx, p, w / 2, 150, 64, images, F, accent, p.handle || p.title);
    ctx.restore();

    const title = String(p.title || '').trim();
    if (title) {
        const e = easeOutCubic(itemIn(t, 1, 0.4));
        ctx.globalAlpha = a * e;
        ctx.fillStyle = p.color || '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, title, F.display, 74, w - 110, 2);
        ctx.font = `${fit.size}px "${F.display}"`;
        const lh = fit.size * 1.12;
        const top = 300 - ((fit.lines.length - 1) * lh) / 2;
        fit.lines.forEach((line, i) => ctx.fillText(line, w / 2, top + i * lh));
    }

    const cta = String(p.cta || '').trim();
    if (cta) {
        const e = easeOutBack(clamp(itemIn(t, 2, 0.4), 0, 1));
        ctx.save();
        ctx.globalAlpha = a * Math.min(1, e);
        const bw = w * 0.56;
        ctx.translate(w / 2, 450);
        ctx.scale(Math.min(1.04, e), Math.min(1.04, e));
        ctx.translate(-(w / 2), -450);
        ctx.fillStyle = accent;
        roundRect(ctx, (w - bw) / 2, 410, bw, 82, 41);
        ctx.fill();
        ctx.fillStyle = '#06080C';
        ctx.font = `bold 36px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cta.toUpperCase().slice(0, 20), w / 2, 452);
        ctx.restore();
    }

    const handle = String(p.handle || '').trim();
    if (handle) {
        ctx.globalAlpha = a * easeOutCubic(itemIn(t, 3, 0.4));
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `500 30px "${F.body}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(handle.slice(0, 28), w / 2, 548);
    }
    ctx.restore();
}

/** A full-width banner that slides up from its own edge. */
function drawCtaBanner(ctx, p, t, duration, F) {
    const { w, h } = templateSize('cta-banner', p);
    const text = String(p.text || '').trim();
    if (!text) return;
    const { tin, tout } = envelope(t, duration, 0.38, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const sub = String(p.sub || '').trim();
    const rise = easeOutCubic(clamp(t / 0.38, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - rise) * h);
    ctx.fillStyle = 'rgba(10, 13, 20, 0.94)';
    roundRect(ctx, 4, 4, w - 8, h - 8, 26);
    ctx.fill();

    // The accent is a bar at the leading edge rather than a full fill: a
    // banner that is entirely brand colour fights the footage above it.
    ctx.fillStyle = accent;
    roundRect(ctx, 4, 4, 14, h - 8, 7);
    ctx.fill();

    ctx.fillStyle = p.color || '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = sub ? 'alphabetic' : 'middle';
    const fit = fitLines(ctx, text, F.display, 54, w - 110, 1);
    ctx.font = `${fit.size}px "${F.display}"`;
    ctx.fillText(fit.lines[0] || '', 44, sub ? 86 : h / 2);
    if (sub) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `500 26px "${F.body}"`;
        ctx.fillText(sub.slice(0, 48), 44, 136);
    }
    ctx.restore();
}

/** Series, a big number, and an optional episode title. */
function drawEpisodeBadge(ctx, p, t, duration, F) {
    const { w, h } = templateSize('episode-badge', p);
    const { tin, tout } = envelope(t, duration, 0.34, 0.24);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const series = String(p.series || '').trim();
    const title = String(p.title || '').trim();
    const pop = easeOutBack(clamp(t / 0.34, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);
    cardSurface(ctx, w, h, 22, 'rgba(10, 13, 20, 0.92)');

    ctx.fillStyle = accent;
    roundRect(ctx, 22, 22, 104, 104, 18);
    ctx.fill();
    ctx.fillStyle = '#06080C';
    ctx.font = `bold 54px "${F.label}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Number(p.number) || 0)).slice(0, 3), 74, 76);

    ctx.textAlign = 'left';
    if (series) {
        ctx.fillStyle = accent;
        ctx.font = `bold 22px "${F.label}"`;
        ctx.fillText(series.toUpperCase().slice(0, 22), 148, title ? 56 : 62);
    }
    ctx.fillStyle = p.color || '#FFFFFF';
    ctx.font = `600 34px "${F.body}"`;
    ctx.fillText(`EPISODE ${Math.max(0, Number(p.number) || 0)}`, 148, series ? (title ? 100 : 100) : 76);
    if (title) {
        ctx.fillStyle = 'rgba(255,255,255,0.68)';
        const fit = fitLines(ctx, title, F.body, 28, w - 180, 2);
        ctx.font = `500 ${fit.size}px "${F.body}"`;
        fit.lines.forEach((line, i) => ctx.fillText(line, 148, 150 + i * (fit.size * 1.25)));
    }
    ctx.restore();
}

/** "Sponsored by" plus a mark and a name. */
function drawSponsorCard(ctx, p, t, duration, F, images) {
    const { w, h } = templateSize('sponsor-card', p);
    const { tin, tout } = envelope(t, duration, 0.36, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const slide = easeOutCubic(clamp(t / 0.36, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate((1 - slide) * -40, 0);
    cardSurface(ctx, w, h, 22, 'rgba(10, 13, 20, 0.92)');
    drawMark(ctx, p, 76, h / 2, 48, images, F, accent);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `bold 20px "${F.label}"`;
    ctx.fillText(String(p.label || 'Sponsored by').toUpperCase().slice(0, 24), 148, 76);
    ctx.fillStyle = p.color || '#FFFFFF';
    const fit = fitLines(ctx, String(p.name || '').trim() || '—', F.display, 44, w - 180, 1);
    ctx.font = `${fit.size}px "${F.display}"`;
    ctx.fillText(fit.lines[0] || '', 148, 128);
    ctx.restore();
}

/** Options across the top, criteria down the side, a mark in each cell. */
function drawComparisonMatrix(ctx, p, t, duration, F) {
    const { w, h } = templateSize('comparison-matrix', p);
    const options = parseList(p.options, 4);
    const criteria = parseList(p.criteria, 6);
    if (options.length === 0 || criteria.length === 0) return;
    const marks = parseList(p.marks, 24);
    const { tin, tout } = envelope(t, duration, 0.5, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const labelW = 300;
    const colW = (w - labelW - 30) / options.length;

    ctx.save();
    ctx.globalAlpha = a;
    cardSurface(ctx, w, h, 24, 'rgba(12, 16, 24, 0.94)');

    ctx.textBaseline = 'middle';
    options.forEach((option, c) => {
        ctx.fillStyle = c === 0 ? accent : 'rgba(255,255,255,0.7)';
        ctx.font = `bold 26px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.fillText(String(option).toUpperCase().slice(0, 12), labelW + colW * c + colW / 2, 66);
    });

    criteria.forEach((row, r) => {
        const y = 110 + r * 96 + 48;
        ctx.globalAlpha = a * easeOutCubic(itemIn(t, r, 0.4));
        ctx.fillStyle = 'rgba(255,255,255,0.82)';
        ctx.font = `500 28px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.fillText(String(row).slice(0, 18), 30, y);

        options.forEach((_, c) => {
            // Row-major, so marks read in the order a person would write them.
            const mark = String(marks[r * options.length + c] || '').toLowerCase();
            const cx = labelW + colW * c + colW / 2;
            ctx.save();
            ctx.globalAlpha = a * easeOutCubic(itemIn(t, r * options.length + c, 0.36));
            if (mark === 'y') {
                ctx.strokeStyle = accent;
                ctx.lineWidth = 6;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(cx - 16, y); ctx.lineTo(cx - 4, y + 13); ctx.lineTo(cx + 18, y - 15);
                ctx.stroke();
            } else if (mark === 'n') {
                ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                ctx.lineWidth = 6;
                ctx.lineCap = 'round';
                ctx.beginPath();
                ctx.moveTo(cx - 14, y - 14); ctx.lineTo(cx + 14, y + 14);
                ctx.moveTo(cx + 14, y - 14); ctx.lineTo(cx - 14, y + 14);
                ctx.stroke();
            } else {
                ctx.fillStyle = 'rgba(255,255,255,0.3)';
                roundRect(ctx, cx - 16, y - 4, 32, 8, 4);
                ctx.fill();
            }
            ctx.restore();
        });
    });
    ctx.restore();
}

/** A root box with children hanging off a bus. */
function drawHierarchy(ctx, p, t, duration, F) {
    const { w, h } = templateSize('hierarchy', p);
    const children = parseList(p.children, 4);
    const root = String(p.root || '').trim();
    if (!root && children.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.45, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';

    ctx.save();
    ctx.globalAlpha = a;
    const rootW = 300;
    const rootX = (w - rootW) / 2;
    const pop = easeOutBack(clamp(t / 0.45, 0, 1));
    ctx.save();
    ctx.translate(w / 2, 70);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -70);
    ctx.fillStyle = accent;
    roundRect(ctx, rootX, 30, rootW, 92, 20);
    ctx.fill();
    ctx.fillStyle = '#06080C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const rf = fitLines(ctx, root, F.label, 32, rootW - 30, 1);
    ctx.font = `bold ${rf.size}px "${F.label}"`;
    ctx.fillText((rf.lines[0] || '').toUpperCase(), w / 2, 78);
    ctx.restore();

    if (children.length === 0) { ctx.restore(); return; }
    const childW = (w - 60) / children.length - 24;
    const busY = 190;
    const grow = easeOutCubic(itemIn(t, 1, 0.4));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(w / 2, 122);
    ctx.lineTo(w / 2, 122 + (busY - 122) * grow);
    ctx.stroke();
    if (grow >= 1 && children.length > 1) {
        const first = 30 + childW / 2 + 12;
        const last = 30 + (children.length - 1) * (childW + 24) + childW / 2 + 12;
        const spread = easeOutCubic(itemIn(t, 2, 0.34));
        ctx.beginPath();
        ctx.moveTo(w / 2 - (w / 2 - first) * spread, busY);
        ctx.lineTo(w / 2 + (last - w / 2) * spread, busY);
        ctx.stroke();
    }

    children.forEach((child, i) => {
        const e = easeOutCubic(itemIn(t, i + 3, 0.34));
        if (e <= 0) return;
        const x = 30 + i * (childW + 24) + 12;
        ctx.save();
        ctx.globalAlpha = a * e;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x + childW / 2, busY);
        ctx.lineTo(x + childW / 2, 250);
        ctx.stroke();
        ctx.fillStyle = 'rgba(14, 18, 28, 0.94)';
        ctx.lineWidth = 3;
        roundRect(ctx, x, 250, childW, 96, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const cf = fitLines(ctx, child, F.body, 28, childW - 24, 2);
        ctx.font = `600 ${cf.size}px "${F.body}"`;
        const lh = cf.size * 1.2;
        const top = 298 - ((cf.lines.length - 1) * lh) / 2;
        cf.lines.forEach((line, k) => ctx.fillText(line, x + childW / 2, top + k * lh));
        ctx.restore();
    });
    ctx.restore();
}

/** Steps around a ring, with an arc arrow between each pair. */
function drawCycleDiagram(ctx, p, t, duration, F) {
    const { w, h } = templateSize('cycle-diagram', p);
    const steps = parseList(p.steps, 6);
    if (steps.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.5, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.33;

    ctx.save();
    ctx.globalAlpha = a;
    // A surface, for the same reason area-chart and timeline-steps have one:
    // a thin ring, small discs and white labels over live footage is not
    // legible, and the render check said so by calling this blank.
    cardSurface(ctx, w, h, 28, 'rgba(12, 16, 24, 0.9)');
    // The ring draws round once, then the nodes land on it in order.
    const sweep = easeOutCubic(clamp(t / 0.6, 0, 1));
    ctx.strokeStyle = `rgba(255,255,255,0.14)`;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * sweep);
    ctx.stroke();

    steps.forEach((step, i) => {
        const ang = -Math.PI / 2 + (i / steps.length) * Math.PI * 2;
        const reached = clamp((sweep * Math.PI * 2 - (i / steps.length) * Math.PI * 2) / 0.5 + 0.2, 0, 1);
        if (reached <= 0) return;
        const x = cx + Math.cos(ang) * R;
        const y = cy + Math.sin(ang) * R;
        ctx.save();
        ctx.globalAlpha = a * reached;
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(x, y, 26 * easeOutBack(reached), 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#06080C';
        ctx.font = `bold 26px "${F.label}"`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x, y + 1);

        // The label sits OUTSIDE the ring, pushed along the radius, so it
        // never lands on the ring or on its neighbour — and then CLAMPED
        // inside the card, because a step at 3 o'clock pushed R+74 right runs
        // off the edge ("Learn" rendered as "arn").
        const label = String(step).slice(0, 14);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 30px "${F.body}"`;
        const align = Math.abs(Math.cos(ang)) < 0.3 ? 'center' : (Math.cos(ang) > 0 ? 'left' : 'right');
        ctx.textAlign = align;
        const tw = ctx.measureText(label).width;
        let lx = cx + Math.cos(ang) * (R + 74);
        const ly = cy + Math.sin(ang) * (R + 74);
        const pad = 18;
        if (align === 'left') lx = Math.min(lx, w - pad - tw);
        else if (align === 'right') lx = Math.max(lx, pad + tw);
        else lx = clamp(lx, pad + tw / 2, w - pad - tw / 2);
        ctx.fillText(label, lx, ly);
        ctx.restore();
    });
    ctx.restore();
}

/** A centre node with spokes to its satellites. */
function drawConceptMap(ctx, p, t, duration, F) {
    const { w, h } = templateSize('concept-map', p);
    const nodes = parseList(p.nodes, 6);
    const center = String(p.center || '').trim();
    if (!center && nodes.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.5, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.32;

    ctx.save();
    ctx.globalAlpha = a;
    nodes.forEach((node, i) => {
        const e = easeOutCubic(itemIn(t, i + 1, 0.4));
        if (e <= 0) return;
        const ang = -Math.PI / 2 + (i / nodes.length) * Math.PI * 2;
        const x = cx + Math.cos(ang) * R;
        const y = cy + Math.sin(ang) * R;
        ctx.save();
        ctx.globalAlpha = a * e;
        // The spoke grows from the centre OUT, so the eye travels from the
        // idea to its parts rather than finding them already there.
        ctx.strokeStyle = `rgba(255,255,255,0.22)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + (x - cx) * e, cy + (y - cy) * e);
        ctx.stroke();

        const nw = 190;
        const nh = 78;
        ctx.fillStyle = 'rgba(14, 18, 28, 0.95)';
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        roundRect(ctx, x - nw / 2, y - nh / 2, nw, nh, 18);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, node, F.body, 26, nw - 24, 2);
        ctx.font = `600 ${fit.size}px "${F.body}"`;
        const lh = fit.size * 1.18;
        const top = y - ((fit.lines.length - 1) * lh) / 2;
        fit.lines.forEach((line, k) => ctx.fillText(line, x, top + k * lh));
        ctx.restore();
    });

    if (center) {
        const pop = easeOutBack(clamp(t / 0.45, 0, 1));
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(pop, pop);
        ctx.translate(-cx, -cy);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(cx, cy, 92, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#06080C';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, center, F.label, 32, 160, 2);
        ctx.font = `bold ${fit.size}px "${F.label}"`;
        const lh = fit.size * 1.15;
        const top = cy - ((fit.lines.length - 1) * lh) / 2;
        fit.lines.forEach((line, k) => ctx.fillText((line || '').toUpperCase(), cx, top + k * lh));
        ctx.restore();
    }
    ctx.restore();
}

/** Pins with leader lines over the shot beneath. Frame-sized. */
function drawAnnotatedShot(ctx, p, t, duration, F) {
    const { w, h } = templateSize('annotated-shot', p);
    // "x,y,label" triples separated by ';' — the label may contain a comma.
    const pins = parseList(p.pins, 6, ';').map(entry => {
        const parts = String(entry).split(',');
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        const label = parts.slice(2).join(',').trim();
        return Number.isFinite(x) && Number.isFinite(y) ? { x: clamp(x, 0, 1), y: clamp(y, 0, 1), label } : null;
    }).filter(Boolean);
    if (pins.length === 0) return;
    const { tin, tout } = envelope(t, duration, 0.45, 0.28);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';

    ctx.save();
    ctx.globalAlpha = a;
    pins.forEach((pin, i) => {
        const e = easeOutCubic(itemIn(t, i, 0.4));
        if (e <= 0) return;
        const x = pin.x * w;
        const y = pin.y * h;
        ctx.save();
        ctx.globalAlpha = a * e;

        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, y, 16 * easeOutBack(e), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();

        if (!pin.label) { ctx.restore(); return; }
        // The leader goes toward the nearer side, so a pin on the right edge
        // does not throw its label off the frame.
        const dir = x > w / 2 ? -1 : 1;
        const len = 120 * e;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + dir * 18, y);
        ctx.lineTo(x + dir * (18 + len), y - 36 * e);
        ctx.stroke();

        ctx.font = `bold 32px "${F.label}"`;
        const tw = ctx.measureText(pin.label).width;
        const bx = dir > 0 ? x + 18 + len : x - 18 - len - tw - 32;
        ctx.fillStyle = 'rgba(10,13,20,0.92)';
        roundRect(ctx, bx, y - 36 * e - 30, tw + 32, 58, 14);
        ctx.fill();
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(pin.label, bx + 16, y - 36 * e);
        ctx.restore();
    });
    ctx.restore();
}

/** One bubble per message, alternating sides. */
function drawReplyThread(ctx, p, t, duration, F) {
    const { w, h } = templateSize('reply-thread', p);
    const messages = parseList(p.messages, 4, '|');
    if (messages.length === 0) return;
    const users = parseList(p.users, 4, '|');
    const { tin, tout } = envelope(t, duration, 0.45, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#38BDF8';

    ctx.save();
    ctx.globalAlpha = a;
    messages.forEach((message, i) => {
        const e = easeOutCubic(itemIn(t, i, 0.4));
        if (e <= 0) return;
        const mine = i % 2 === 1;
        const top = 20 + i * 150;
        const bw = w * 0.72;
        const x = mine ? w - bw - 24 : 24;
        ctx.save();
        ctx.globalAlpha = a * e;
        // Each bubble slides in from ITS OWN side: a thread where both sides
        // arrive from the same direction does not read as a conversation.
        ctx.translate((mine ? 1 : -1) * (1 - e) * 44, 0);

        const user = users[i];
        if (user) {
            ctx.fillStyle = 'rgba(255,255,255,0.45)';
            ctx.font = `500 22px "${F.body}"`;
            ctx.textAlign = mine ? 'right' : 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(String(user).slice(0, 18), mine ? w - 28 : 28, top);
        }

        ctx.fillStyle = mine ? accent : 'rgba(255,255,255,0.1)';
        roundRect(ctx, x, top + 30, bw, 96, 24);
        ctx.fill();
        ctx.fillStyle = mine ? '#06080C' : '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const fit = fitLines(ctx, message, F.body, 30, bw - 44, 2);
        ctx.font = `500 ${fit.size}px "${F.body}"`;
        const lh = fit.size * 1.2;
        const ty = top + 78 - ((fit.lines.length - 1) * lh) / 2;
        fit.lines.forEach((line, k) => ctx.fillText(line, x + 22, ty + k * lh));
        ctx.restore();
    });
    ctx.restore();
}

/** One message bubble with a tail. */
function drawDmBubble(ctx, p, t, duration, F) {
    const { w, h } = templateSize('dm-bubble', p);
    const text = String(p.text || '').trim();
    if (!text) return;
    const { tin, tout } = envelope(t, duration, 0.36, 0.24);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#38BDF8';
    const right = p.side === 'right';
    const pop = easeOutBack(clamp(t / 0.36, 0, 1));
    const user = String(p.user || '').trim();

    ctx.save();
    ctx.globalAlpha = a;
    // Scaled from the TAIL, so the bubble grows out of the speaker's corner.
    const ox = right ? w - 30 : 30;
    ctx.translate(ox, h - 30);
    ctx.scale(pop, pop);
    ctx.translate(-ox, -(h - 30));

    if (user) {
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `500 24px "${F.body}"`;
        ctx.textAlign = right ? 'right' : 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(user.slice(0, 20), right ? w - 24 : 24, 10);
    }

    const by = user ? 52 : 20;
    const bh = h - by - 34;
    ctx.fillStyle = right ? accent : 'rgba(18, 22, 32, 0.96)';
    roundRect(ctx, 20, by, w - 40, bh, 26);
    ctx.fill();
    ctx.beginPath();
    if (right) { ctx.moveTo(w - 54, by + bh); ctx.lineTo(w - 22, by + bh + 26); ctx.lineTo(w - 24, by + bh - 6); }
    else { ctx.moveTo(54, by + bh); ctx.lineTo(22, by + bh + 26); ctx.lineTo(24, by + bh - 6); }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = right ? '#06080C' : '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const fit = fitLines(ctx, text, F.body, 32, w - 92, 2);
    ctx.font = `500 ${fit.size}px "${F.body}"`;
    const lh = fit.size * 1.2;
    const ty = by + bh / 2 - ((fit.lines.length - 1) * lh) / 2;
    fit.lines.forEach((line, k) => ctx.fillText(line, 46, ty + k * lh));
    ctx.restore();
}

/**
 * A waveform from REAL samples.
 *
 * `samples` is a comma list of 0..1 amplitudes — the caller supplies them
 * from the audio it already has. With none this draws NOTHING, on purpose: a
 * waveform that invents its own shape is a decoration pretending to be data,
 * and it would be lying about the very thing it depicts.
 */
function drawWaveform(ctx, p, t, duration, F) {
    const { w, h } = templateSize('waveform', p);
    const samples = parseNumbers(p.samples, 400);
    if (samples.length < 2) return;
    const { tin, tout } = envelope(t, duration, 0.4, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const mirror = Number(p.mirror) !== 0;
    const mid = h / 2;
    const max = Math.max(...samples.map(Math.abs), 1);
    const reveal = easeOutCubic(clamp(t / 0.7, 0, 1));
    const bars = samples.length;
    const bw = Math.max(2, (w - 40) / bars - 2);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = accent;
    const upTo = Math.ceil(bars * reveal);
    for (let i = 0; i < upTo; i++) {
        const amp = (Math.abs(samples[i]) / max) * (mirror ? h * 0.42 : h * 0.82);
        const x = 20 + i * ((w - 40) / bars);
        if (mirror) roundRect(ctx, x, mid - amp, bw, amp * 2, Math.min(bw / 2, 4));
        else roundRect(ctx, x, h - 20 - amp, bw, amp, Math.min(bw / 2, 4));
        ctx.fill();
    }
    ctx.restore();
}

/** A bar spectrum from real sample values. Same refusal as the waveform. */
function drawAudioBars(ctx, p, t, duration, F) {
    const { w, h } = templateSize('audio-bars', p);
    const samples = parseNumbers(p.samples, 64);
    if (samples.length < 2) return;
    const { tin, tout } = envelope(t, duration, 0.4, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const n = Math.max(2, Math.min(samples.length, Math.max(2, Number(p.bars) || 24)));
    const max = Math.max(...samples.map(Math.abs), 1);
    const slot = (w - 40) / n;
    const bw = Math.max(4, slot - 8);

    ctx.save();
    ctx.globalAlpha = a;
    for (let i = 0; i < n; i++) {
        // Resampled to `bars`, so the picture is the caller's data at the
        // resolution they asked for rather than whatever length it happened
        // to arrive in.
        const at = Math.floor((i / n) * samples.length);
        const e = easeOutCubic(itemIn(t, i % 8, 0.36));
        const amp = (Math.abs(samples[at]) / max) * (h - 60) * e;
        if (amp <= 0) continue;
        ctx.fillStyle = mixHex(accent, '#FFFFFF', (i / Math.max(1, n - 1)) * 0.4);
        roundRect(ctx, 20 + i * slot + 4, h - 30 - amp, bw, amp, Math.min(bw / 2, 8));
        ctx.fill();
    }
    ctx.restore();
}

// ─── R115: icons in the catalogue, and the advanced effects ──────────────────

/** A single icon, popped in. Unknown name draws nothing — see the defaults. */
function drawIconTemplate(ctx, p, t, duration) {
    const { w, h } = templateSize('icon', p);
    const { tin, tout } = envelope(t, duration, 0.34, 0.24);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const pop = easeOutBack(clamp(t / 0.34, 0, 1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    const treatment = ['badge', 'frame', 'burst'].includes(p.treatment) ? p.treatment : 'solo';
    const accent = p.accent || '#00E5FF';
    const size = w * (treatment === 'solo' ? 0.78 : 0.54);
    const background = ['soft-glow', 'gradient-orb', 'glass-panel', 'radial-burst'].includes(p.background)
        ? p.background
        : 'soft-glow';
    if (background === 'soft-glow') {
        const glow = ctx.createRadialGradient(0, 0, w * 0.04, 0, 0, w * 0.48);
        glow.addColorStop(0, accent);
        glow.addColorStop(0.55, accent);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a * 0.22;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.48, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a;
    } else if (background === 'gradient-orb') {
        const orb = ctx.createRadialGradient(-w * 0.14, -w * 0.16, w * 0.02, 0, 0, w * 0.46);
        orb.addColorStop(0, '#FFFFFF');
        orb.addColorStop(0.24, accent);
        orb.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = a * 0.34;
        ctx.fillStyle = orb;
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a;
    } else if (background === 'glass-panel') {
        const bgGradient = ctx.createLinearGradient(-w * 0.42, -w * 0.42, w * 0.42, w * 0.42);
        bgGradient.addColorStop(0, accent);
        bgGradient.addColorStop(1, '#FFFFFF');
        ctx.globalAlpha = a * 0.12;
        ctx.fillStyle = bgGradient;
        roundRect(ctx, -w * 0.45, -w * 0.42, w * 0.9, w * 0.84, w * 0.2);
        ctx.fill();
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(2, w * 0.012);
        roundRect(ctx, -w * 0.45, -w * 0.42, w * 0.9, w * 0.84, w * 0.2);
        ctx.stroke();
        ctx.globalAlpha = a;
    } else if (background === 'radial-burst') {
        ctx.save();
        ctx.globalAlpha = a * 0.2;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(2, w * 0.014);
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(angle) * w * 0.3, Math.sin(angle) * w * 0.3);
            ctx.lineTo(Math.cos(angle) * w * 0.46, Math.sin(angle) * w * 0.46);
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.31, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = a * 0.1;
        ctx.fill();
        ctx.restore();
    }
    if (treatment === 'badge') {
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.43, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.globalAlpha = a * 0.18;
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(3, w * 0.018);
        ctx.stroke();
    } else if (treatment === 'frame') {
        ctx.fillStyle = accent;
        ctx.globalAlpha = a * 0.13;
        roundRect(ctx, -w * 0.44, -w * 0.44, w * 0.88, w * 0.88, w * 0.16);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(3, w * 0.018);
        roundRect(ctx, -w * 0.44, -w * 0.44, w * 0.88, w * 0.88, w * 0.16);
        ctx.stroke();
    } else if (treatment === 'burst') {
        ctx.beginPath();
        for (let i = 0; i < 24; i++) {
            const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
            const radius = i % 2 === 0 ? w * 0.44 : w * 0.34;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.globalAlpha = a * 0.16;
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(3, w * 0.018);
        ctx.stroke();
    }
    ctx.translate(-size / 2, -size / 2);
    drawIcon(ctx, p.icon, size, { color: accent, weight: Math.max(0.5, Number(p.weight) || 2) });
    ctx.restore();
}

/** An icon beside a word: the smallest useful labelled thing. */
function drawIconLabel(ctx, p, t, duration, F) {
    const { w, h } = templateSize('icon-label', p);
    const text = String(p.text || '').trim();
    const { tin, tout } = envelope(t, duration, 0.32, 0.24);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const pop = easeOutBack(clamp(t / 0.32, 0, 1));

    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(w / 2, h / 2);
    ctx.scale(pop, pop);
    ctx.translate(-w / 2, -h / 2);
    cardSurface(ctx, w, h, h / 2, 'rgba(10, 13, 20, 0.92)');

    ctx.save();
    ctx.translate(26, h / 2 - 26);
    // A missing icon leaves the pill without a hole in it: the text simply
    // shifts left, because `drawIcon` reports whether it drew.
    const drew = drawIcon(ctx, p.icon, 52, { color: accent, weight: 2 });
    ctx.restore();

    if (text) {
        ctx.fillStyle = p.color || '#FFFFFF';
        ctx.font = `600 36px "${F.body}"`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text.slice(0, 28), drew ? 96 : 34, h / 2 + 1);
    }
    ctx.restore();
}

/** Several icons in a row, each landing on its own beat. */
function drawIconRow(ctx, p, t, duration, F) {
    const { w, h } = templateSize('icon-row', p);
    const icons = parseList(p.icons, 5);
    if (icons.length === 0) return;
    const labels = parseList(p.labels, 5);
    const { tin, tout } = envelope(t, duration, 0.4, 0.26);
    const a = Math.min(1, tin * 2) * tout;
    if (a <= 0) return;
    const accent = p.accent || '#00E5FF';
    const slot = (w - 40) / icons.length;

    ctx.save();
    ctx.globalAlpha = a;
    icons.forEach((name, i) => {
        const e = easeOutBack(clamp(itemIn(t, i, 0.34), 0, 1));
        if (e <= 0) return;
        const cx = 20 + slot * i + slot / 2;
        ctx.save();
        ctx.globalAlpha = a * Math.min(1, e);
        ctx.translate(cx, 86);
        ctx.scale(Math.min(1.06, e), Math.min(1.06, e));
        ctx.translate(-44, -44);
        // 0.08 white is alpha 20 — below the threshold at which anything
        // counts as drawn, and barely visible over footage. The tile has to
        // be a real surface or the row is three thin glyphs on nothing.
        ctx.fillStyle = 'rgba(10, 13, 20, 0.88)';
        roundRect(ctx, 0, 0, 88, 88, 24);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 2;
        roundRect(ctx, 0, 0, 88, 88, 24);
        ctx.stroke();
        ctx.save();
        ctx.translate(22, 22);
        drawIcon(ctx, name, 44, { color: accent, weight: 2 });
        ctx.restore();
        ctx.restore();

        const label = labels[i];
        if (label) {
            ctx.save();
            ctx.globalAlpha = a * Math.min(1, e);
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = `500 26px "${F.body}"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(String(label).slice(0, 14), cx, 160);
            ctx.restore();
        }
    });
    ctx.restore();
}

/**
 * A band of light travelling across the frame.
 *
 * It sweeps ONCE over the clip's life rather than looping: a light sweep that
 * repeats reads as a screensaver, and the whole point of one is to mark a
 * single moment.
 */
function drawLightSweep(ctx, p, t, duration) {
    const { w, h } = templateSize('light-sweep', p);
    const prog = clamp(t / Math.max(0.2, duration), 0, 1);
    const strength = clamp(numOr(p.strength, 0.45), 0, 1);
    if (strength <= 0) return;
    const band = Math.max(0.02, Number(p.width) || 0.18) * w;
    const angle = ((Number(p.angle) || 0) * Math.PI) / 180;
    // The travel is the frame's HALF DIAGONAL plus the band, each way: any
    // further and the sweep spends most of the clip off-screen. The first
    // version used (w + h) * 1.2 with an eased travel, which put the band
    // outside the frame by halfway and made the effect invisible for most of
    // its life — found by sampling the alpha at five times, not by reading it.
    //
    // And the travel is LINEAR: light moves at a constant speed, and an eased
    // sweep reads as a wipe that hesitates.
    const reach = Math.hypot(w, h) / 2 + band;
    const at = -reach + 2 * reach * prog;

    ctx.save();
    // Fades in and out with its own travel, so there is no hard edge when the
    // clip starts or ends mid-sweep.
    ctx.globalAlpha = strength * Math.sin(prog * Math.PI);
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(w / 2, h / 2);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(at - band, 0, at + band, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, p.color || '#FFFFFF');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    // The fill has to cover the rotated frame entirely, whatever the angle.
    ctx.fillRect(-reach * 2, -reach * 2, reach * 4, reach * 4);
    ctx.restore();
}

/**
 * Drifting particles.
 *
 * Positions come from a SEEDED hash of the particle index, never from
 * Math.random: the preview and the export draw the same frame independently,
 * so anything random would put the particles in different places in each and
 * the parity check could not tell which was right.
 */
function drawParticles(ctx, p, t, duration) {
    const { w, h } = templateSize('particles', p);
    // `Number(p.count) || 40` would turn an explicit 0 into 40, because 0 is
    // falsy: asking for no particles would have given the default field.
    // Every numeric param in this file that can legitimately be zero needs
    // this shape, not `||`.
    const asked = Number(p.count);
    const count = Math.max(0, Math.min(200, Number.isFinite(asked) ? asked : 40));
    if (count === 0) return;
    const { tin, tout } = envelope(t, duration, 0.5, 0.5);
    const a = Math.min(1, tin) * tout;
    if (a <= 0) return;
    const seed = Number(p.seed) || 7;
    const size = Math.max(1, Number(p.size) || 5);
    const up = p.drift !== 'down';

    ctx.save();
    ctx.fillStyle = p.accent || '#FFFFFF';
    for (let i = 0; i < count; i++) {
        const r1 = noise(i * 3 + seed);
        const r2 = noise(i * 3 + 1 + seed);
        const r3 = noise(i * 3 + 2 + seed);
        const speed = 0.06 + r3 * 0.12;
        // Wrapped, so a particle leaving one edge reappears at the other and
        // the field never thins out over a long clip.
        const travel = (r2 + t * speed) % 1;
        const y = up ? (1 - travel) * h : travel * h;
        const x = (r1 + Math.sin((t + r2 * 10) * 0.6) * 0.02) * w;
        const rad = size * (0.5 + r3);
        ctx.globalAlpha = a * (0.25 + r3 * 0.55) * Math.sin(travel * Math.PI);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** A two-colour gradient over the frame, for a mood change. */
function drawGradientWash(ctx, p, t, duration) {
    const { w, h } = templateSize('gradient-wash', p);
    const { tin, tout } = envelope(t, duration, 0.6, 0.6);
    const a = Math.min(1, tin) * tout * clamp(numOr(p.opacity, 0.4), 0, 1);
    if (a <= 0) return;
    const angle = ((Number(p.angle) || 150) * Math.PI) / 180;
    const span = Math.max(w, h);
    const dx = Math.cos(angle) * span;
    const dy = Math.sin(angle) * span;

    ctx.save();
    ctx.globalAlpha = a;
    const g = ctx.createLinearGradient(w / 2 - dx / 2, h / 2 - dy / 2, w / 2 + dx / 2, h / 2 + dy / 2);
    g.addColorStop(0, p.color || '#00E5FF');
    g.addColorStop(1, p.color2 || '#8A2BE2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
}

/**
 * A chromatic split: two offset colour fields that pulse once and settle.
 *
 * Not a per-pixel channel separation — that needs the frame beneath, which a
 * template layer does not have. This is the look, built from what a layer
 * CAN do, and it is named `chroma-pulse` rather than "chromatic aberration"
 * so nobody expects the real optical effect.
 */
function drawChromaPulse(ctx, p, t, duration) {
    const { w, h } = templateSize('chroma-pulse', p);
    const strength = clamp(numOr(p.strength, 0.012), 0, 0.1);
    if (strength <= 0) return;
    const prog = clamp(t / Math.max(0.2, duration), 0, 1);
    // One pulse that decays: a constant split reads as a broken display.
    const pulse = Math.sin(prog * Math.PI) * Math.exp(-prog * 1.4);
    const off = strength * w * pulse;
    if (Math.abs(off) < 0.3) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 * pulse;
    ctx.fillStyle = p.color || '#FF3B5C';
    ctx.fillRect(-off, 0, w, h);
    ctx.fillStyle = p.color2 || '#00E5FF';
    ctx.fillRect(off, 0, w, h);
    ctx.restore();
}

function drawWordCycle(ctx, p, t, duration, F) {
    const { w, h } = templateSize('word-cycle', p);
    const { tin, tout } = envelope(t, duration, 0.35, 0.3);
    if (tin <= 0 || tout <= 0) return;

    const all = String(p.words || '').split(/[,|\n]/).map((s) => s.trim()).filter(Boolean);
    if (all.length === 0) return;

    const size = clamp(Number(p.fontSize) || 86, 24, 220);
    const prefix = String(p.prefix || '');
    const suffix = String(p.suffix || '');

    ctx.save();
    ctx.globalAlpha = Math.min(1, tin * 2.5) * tout;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `${size}px "${F.display}"`;

    // How many of the words actually fit at a readable dwell, and when each
    // one holds and swaps — one plan, shared with the validator's rules.
    const maxWords = Math.max(1, Math.floor(duration / MIN_SWAP_DWELL_S));
    const words = all.slice(0, maxWords);
    const plan = planWordCycle(words, duration, { dwell: Number(p.dwell) || 0 });

    const prefixText = prefix ? `${prefix} ` : '';
    const suffixText = suffix ? ` ${suffix}` : '';
    const prefixW = prefixText ? ctx.measureText(prefixText).width : 0;
    const suffixW = suffixText ? ctx.measureText(suffixText).width : 0;
    // The reserved slot: widest word, plus a little room so a word that
    // exactly fills it is not clipped by the arrival offset.
    let slotW = 0;
    for (const word of words) slotW = Math.max(slotW, ctx.measureText(word).width);
    slotW *= 1.04;

    const x0 = (w - (prefixW + slotW + suffixW)) / 2;
    const y = h / 2;
    const slotX = x0 + prefixW;

    ctx.fillStyle = p.color || '#FFFFFF';
    if (prefixText) ctx.fillText(prefixText, x0, y);
    if (suffixText) ctx.fillText(suffixText, slotX + slotW, y);

    // Which word, and whether it is mid-swap.
    const idx = clamp(Math.floor(t / plan.dwell), 0, words.length - 1);
    const step = plan.steps[idx];
    const weights = step && step.swapAt !== null && t >= step.swapAt
        ? crossfadeWeights(t, step.swapAt, plan.crossfade)
        : { out: 1, in: 0 };

    const base = ctx.globalAlpha;
    const rise = size * 0.26;
    const drawWord = (word, alpha, dy) => {
        if (alpha <= 0.01) return;
        ctx.globalAlpha = base * alpha;
        ctx.fillStyle = p.accent || '#00E5FF';
        ctx.fillText(word, slotX, y + dy);
    };
    // Outgoing leaves upward, incoming arrives from below: the eye is handed
    // from one word to the next instead of being shown a substitution.
    drawWord(words[idx], weights.out, -rise * weights.in);
    if (weights.in > 0) drawWord(words[idx + 1], weights.in, rise * weights.out);

    // The accent rule under the slot marks the box as a slot rather than a
    // word that happens to be a different colour. It is drawn at the
    // reserved width, so it never changes length.
    ctx.globalAlpha = base * 0.85;
    ctx.fillStyle = p.accent || '#00E5FF';
    const ruleH = Math.max(4, size * 0.07);
    const ruleW = slotW * easeOutCubic(clamp(t / 0.45, 0, 1));
    roundRect(ctx, slotX, y + size * 0.62, ruleW, ruleH, ruleH / 2);
    ctx.fill();

    ctx.globalAlpha = base;
    ctx.restore();
}

export function drawTemplate(ctx, kind, params, t, duration, opts = {}) {
    if (!ctx || !TEMPLATE_KINDS.includes(kind)) return;
    // R114 - the brand is resolved HERE, once, for all 52 kinds. Threading it
    // through every draw function would be 52 edits and a silent divergence
    // the moment a 53rd is added. `applyBrand` fills only the colour slots the
    // caller left at the template's own default, so a hand-picked colour on a
    // clip already on someone's timeline is never repainted.
    const branded = opts.brand ? applyBrand(kind, params, opts.brand, TEMPLATE_DEFAULTS[kind]) : params;
    const p = templateParams(kind, branded);
    const F = { ...TEMPLATE_FONTS, ...(opts.brand ? brandFonts(opts.brand) : {}), ...(opts.fonts || {}) };
    const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
    const d = Math.max(0.5, Number(duration) || 3);
    const tt = clamp(Number(t) || 0, 0, d);
    ctx.save();
    ctx.scale(scale, scale);
    try {
        if (kind === 'counter') drawCounter(ctx, p, tt, d, F);
        else if (kind === 'price-pop') drawPricePop(ctx, p, tt, d, F);
        else if (kind === 'logo-card') drawLogoCard(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'code-window') drawCodeWindow(ctx, p, tt, d, F);
        else if (kind === 'highlight-box') drawHighlightBox(ctx, p, tt, d);
        else if (kind === 'underline') drawUnderline(ctx, p, tt, d);
        else if (kind === 'circle-callout') drawCircleCallout(ctx, p, tt, d);
        else if (kind === 'arrow') drawArrow(ctx, p, tt, d);
        else if (kind === 'progress-bar') drawProgressBar(ctx, p, tt, d, F);
        else if (kind === 'bar-chart') drawBarChart(ctx, p, tt, d, F);
        else if (kind === 'burst') drawBurst(ctx, p, tt, d);
        else if (kind === 'line-graph') drawLineGraph(ctx, p, tt, d, F);
        else if (kind === 'circular-meter') drawCircularMeter(ctx, p, tt, d, F);
        else if (kind === 'data-counter') drawDataCounter(ctx, p, tt, d, F);
        else if (kind === 'film-grain') drawFilmGrain(ctx, p, tt, d);
        else if (kind === 'vhs-glitch') drawVhsGlitch(ctx, p, tt, d);
        else if (kind === 'light-leak') drawLightLeak(ctx, p, tt, d);
        else if (kind === 'lower-third-minimal') drawLowerThirdMinimal(ctx, p, tt, d, F);
        else if (kind === 'location-badge') drawLocationBadge(ctx, p, tt, d, F);
        else if (kind === 'retention-progress-bar') drawRetentionProgressBar(ctx, p, tt, d, F);
        else if (kind === 'quote-card') drawQuoteCard(ctx, p, tt, d, F);
        else if (kind === 'comparison-card') drawComparisonCard(ctx, p, tt, d, F);
        else if (kind === 'social-notification') drawSocialNotification(ctx, p, tt, d, F);
        else if (kind === 'comment-bubble') drawCommentBubble(ctx, p, tt, d, F);
        else if (kind === 'kpi-stat-callout') drawKpiStatCallout(ctx, p, tt, d, F);
        else if (kind === 'newspaper-headline') drawNewspaperHeadline(ctx, p, tt, d, F);
        else if (kind === 'search-bar') drawSearchBar(ctx, p, tt, d, F);
        else if (kind === 'panel') drawPanel(ctx, p, tt, d);
        else if (kind === 'word-cycle') drawWordCycle(ctx, p, tt, d, F);
        else if (kind === 'step-card') drawStepCard(ctx, p, tt, d, F);
        else if (kind === 'checklist') drawChecklist(ctx, p, tt, d, F);
        else if (kind === 'question-card') drawQuestionCard(ctx, p, tt, d, F);
        else if (kind === 'split-label') drawSplitLabel(ctx, p, tt, d, F);
        else if (kind === 'screenshot-card') drawScreenshotCard(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'phone-frame') drawPhoneFrame(ctx, p, tt, d);
        else if (kind === 'scene-background') drawSceneBackground(ctx, p);
        else if (kind === 'ui-card') drawUiCard(ctx, p, tt, d, F);
        else if (kind === 'profile-portrait') drawProfilePortrait(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'stat-grid') drawStatGrid(ctx, p, tt, d, F);
        else if (kind === 'status-label') drawStatusLabel(ctx, p, tt, d, F);
        else if (kind === 'numbered-marker') drawNumberedMarker(ctx, p, tt, d, F);
        else if (kind === 'spotlight') drawSpotlight(ctx, p, tt, d);
        else if (kind === 'magnifier') drawMagnifier(ctx, p, tt, d);
        else if (kind === 'crosshair') drawCrosshair(ctx, p, tt, d, F);
        else if (kind === 'pie-chart') drawPieLike(ctx, p, tt, d, F, 'pie-chart');
        else if (kind === 'donut-chart') drawPieLike(ctx, p, tt, d, F, 'donut-chart');
        else if (kind === 'area-chart') drawAreaChart(ctx, p, tt, d, F);
        else if (kind === 'h-bar-chart') drawHBarChart(ctx, p, tt, d, F);
        else if (kind === 'video-thumbnail') drawVideoThumbnail(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'video-player') drawVideoPlayer(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'engagement-counter') drawEngagementCounter(ctx, p, tt, d, F);
        else if (kind === 'process-flow') drawProcessFlow(ctx, p, tt, d, F);
        else if (kind === 'timeline-steps') drawTimelineSteps(ctx, p, tt, d, F);
        else if (kind === 'funnel') drawFunnel(ctx, p, tt, d, F);
        else if (kind === 'logo-reveal') drawLogoReveal(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'end-card') drawEndCard(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'cta-banner') drawCtaBanner(ctx, p, tt, d, F);
        else if (kind === 'episode-badge') drawEpisodeBadge(ctx, p, tt, d, F);
        else if (kind === 'sponsor-card') drawSponsorCard(ctx, p, tt, d, F, opts.images || {});
        else if (kind === 'comparison-matrix') drawComparisonMatrix(ctx, p, tt, d, F);
        else if (kind === 'hierarchy') drawHierarchy(ctx, p, tt, d, F);
        else if (kind === 'cycle-diagram') drawCycleDiagram(ctx, p, tt, d, F);
        else if (kind === 'concept-map') drawConceptMap(ctx, p, tt, d, F);
        else if (kind === 'annotated-shot') drawAnnotatedShot(ctx, p, tt, d, F);
        else if (kind === 'reply-thread') drawReplyThread(ctx, p, tt, d, F);
        else if (kind === 'dm-bubble') drawDmBubble(ctx, p, tt, d, F);
        else if (kind === 'waveform') drawWaveform(ctx, p, tt, d, F);
        else if (kind === 'audio-bars') drawAudioBars(ctx, p, tt, d, F);
        else if (kind === 'icon') drawIconTemplate(ctx, p, tt, d);
        else if (kind === 'icon-label') drawIconLabel(ctx, p, tt, d, F);
        else if (kind === 'icon-row') drawIconRow(ctx, p, tt, d, F);
        else if (kind === 'light-sweep') drawLightSweep(ctx, p, tt, d);
        else if (kind === 'particles') drawParticles(ctx, p, tt, d);
        else if (kind === 'gradient-wash') drawGradientWash(ctx, p, tt, d);
        else if (kind === 'chroma-pulse') drawChromaPulse(ctx, p, tt, d);
    } finally {
        ctx.restore();
    }
}

/**
 * Pull template parameters out of a request ("add a counter day 14 of 30",
 * "price pop 15-20€", "code window \"npm i vibed\""). Returns null if the
 * text names no template.
 */
export function templateFromText(text) {
    const raw = String(text || '');
    const s = raw.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const quoted = (raw.match(/["“«]\s*([^"”»]+?)\s*["”»]/) || [])[1] || null;
    // R92: shapes first, so "bar chart 10 of 30" is not read as a counter.
    const shape = shapeFromText(s, raw, quoted);
    if (shape) return shape;
    // R107 - a cycling word slot. Needs the alternatives, so it only matches
    // when the request actually lists them ("cycle through reels, shorts,
    // tiktok"); a bare "cycle" is left for whatever else wants it.
    const cycle = s.match(/(?:cycle|rotate|alternate|flip)(?:\s+\w+){0,3}?\s*(?:through|between|entre)?\s*:?\s*(.+)$/);
    if (cycle) {
        const listRaw = (quoted || cycle[1] || '');
        const list = listRaw.split(/[,|]|\bor\b|\band\b|\bou\b/).map((x) => x.trim()).filter(Boolean);
        if (list.length >= 2) {
            const lead = raw.match(/^\s*(.*?)\s*(?:cycle|rotate|alternate|flip)/i);
            return {
                kind: 'word-cycle',
                params: {
                    words: list.slice(0, 8).join(','),
                    ...(lead && lead[1] && lead[1].length <= 40 ? { prefix: lead[1] } : {}),
                },
            };
        }
    }
    if (/counter|compteur|day \d|jour \d|\d+\s*(?:\/|of|sur)\s*\d+/.test(s) && !/code/.test(s)) {
        const m = s.match(/(\d+)\s*(?:\/|of|sur|out of)\s*(\d+)/);
        const lab = s.match(/\b(day|jour|week|semaine|step|etape|episode|ep|part|partie)\b/);
        return {
            kind: 'counter',
            params: {
                ...(m ? { value: Number(m[1]), total: Number(m[2]) } : {}),
                ...(lab ? { label: lab[1].toUpperCase() } : {}),
            },
        };
    }
    if (/price|prix|number pop|chiffre|amount|montant|pop/.test(s)) {
        const tok = quoted || (raw.match(/[\d][\d\s.,]*(?:-[\d.,]+)?\s*(?:€|\$|£|%|k\b|m\b)?/) || [])[0];
        return { kind: 'price-pop', params: tok ? { text: String(tok).trim() } : {} };
    }
    if (/code|terminal|typing|tape du code/.test(s)) {
        return { kind: 'code-window', params: quoted ? { code: quoted } : {} };
    }
    if (/logo card|logo|carte logo|brand card/.test(s)) {
        return { kind: 'logo-card', params: quoted ? { label: quoted } : {} };
    }
    return null;
}

/** R92: shapes named in a request. `s` is lower-cased and accent-free. */
function shapeFromText(s, raw, quoted) {
    // Same reason as the charts below: the generic matcher's French word
    // "diagramme" claims "diagramme de flux" before this ever runs.
    if (/process flow|flow chart|flowchart|workflow diagram|diagramme de flux|processus/.test(s)) {
        const steps = quoted ? quoted.split(/\s*[,;>→]\s*/).filter(Boolean) : [];
        return { kind: 'process-flow', params: { ...(steps.length ? { steps: steps.join(',') } : {}), ...(/vertical/.test(s) ? { direction: 'vertical' } : {}) } };
    }
    if (/timeline|milestones|chronologie|frise|jalons/.test(s)) {
        const steps = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'timeline-steps', params: steps.length ? { steps: steps.join(',') } : {} };
    }
    if (/funnel|conversion stages|entonnoir|tunnel de conversion/.test(s)) {
        const stages = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'funnel', params: stages.length ? { stages: stages.join(',') } : {} };
    }
    // R115 - the icon kinds, and the four frame effects. These run before
    // everything else: an icon NAME ("search", "timeline", "chart-bar") is a
    // word several looser matchers already claim.
    if (/icon row|row of icons|icones? en ligne|serie d icones/.test(s)) {
        const names = quoted ? quoted.split(/\s*[,;]\s*/).map(x => iconFromText(x)).filter(Boolean) : [];
        return { kind: 'icon-row', params: names.length ? { icons: names.join(',') } : {} };
    }
    if (/\bicon\b|\bicone\b|pictogramme|\billustration\b|\bvector\b|\bvisuel vectoriel\b/.test(s)) {
        const named = iconFromText(s.replace(/\bicon\b|\bicone\b|pictogramme|\billustration\b|\bvector\b|\bvisuel vectoriel\b|\bof\b|\bfor\b|\bde\b|\bdu\b|\bune?\b|\ban?\b/g, ' '));
        const withLabel = quoted || /label|with text|avec texte|legende/.test(s);
        const treatment = /burst|impact|éclat|eclat/.test(s) ? 'burst'
            : /badge|medallion|médaillon|medaillon/.test(s) ? 'badge'
                : /frame|framed|encadré|encadre|card/.test(s) ? 'frame' : 'solo';
        if (withLabel) {
            return { kind: 'icon-label', params: { ...(named ? { icon: named } : {}), ...(quoted ? { text: quoted } : {}) } };
        }
        // No usable name means no icon: handing back the default would put
        // some unrelated symbol on screen under the user's own words.
        return named ? { kind: 'icon', params: { icon: named, treatment } } : null;
    }
    if (/light sweep|shine across|light pass|balayage|reflet/.test(s)) return { kind: 'light-sweep', params: {} };
    if (/particles?|confetti|floating dots|particules|poussiere/.test(s)) return { kind: 'particles', params: {} };
    if (/gradient wash|colou?r wash|gradient overlay|degrade|teinte/.test(s)) return { kind: 'gradient-wash', params: {} };
    if (/chroma|chromatic|rgb split|aberration|dedoublement/.test(s)) return { kind: 'chroma-pulse', params: {} };

    // R114 - these go before everything, because several of their words
    // ("card", "chart", "bubble", "diagramme") are claimed by looser matches.
    if (/logo reveal|animated logo|brand mark|reveal.*logo|revele.*logo/.test(s)) {
        return { kind: 'logo-reveal', params: quoted ? { name: quoted } : {} };
    }
    if (/end card|end screen|outro card|ecran de fin|carte de fin/.test(s)) {
        return { kind: 'end-card', params: quoted ? { title: quoted } : {} };
    }
    if (/cta banner|call to action banner|banner|banniere|bandeau/.test(s)) {
        return { kind: 'cta-banner', params: quoted ? { text: quoted } : {} };
    }
    if (/episode (?:badge|number)|numero d episode|badge episode/.test(s)) {
        const m = /\b(\d{1,3})\b/.exec(raw);
        return { kind: 'episode-badge', params: { ...(m ? { number: Number(m[1]) } : {}), ...(quoted ? { series: quoted } : {}) } };
    }
    if (/sponsor|sponsored by|partenaire|sponsorise/.test(s)) {
        return { kind: 'sponsor-card', params: quoted ? { name: quoted } : {} };
    }
    if (/comparison matrix|feature (?:grid|matrix)|pros and cons|tableau comparatif|matrice/.test(s)) {
        const opts = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'comparison-matrix', params: opts.length >= 2 ? { options: opts.join(',') } : {} };
    }
    if (/hierarchy|org chart|organigramme|hierarchie|arborescence/.test(s)) {
        const parts = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'hierarchy', params: parts.length >= 2 ? { root: parts[0], children: parts.slice(1).join(',') } : {} };
    }
    // "cycle" alone belongs to R107's `word-cycle` ("cycle through reels,
    // shorts, tiktok"), which is matched further down. A DIAGRAM has to say
    // so: a bare "cycle" with a list is a word cycle, not a ring of steps.
    // Caught by an existing suite, not by this one.
    if (/cycle diagram|loop diagram|recurring process|circular process|boucle|diagramme circulaire/.test(s)) {
        const steps = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'cycle-diagram', params: steps.length ? { steps: steps.join(',') } : {} };
    }
    if (/concept map|mind map|carte mentale|carte conceptuelle/.test(s)) {
        const parts = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'concept-map', params: parts.length >= 2 ? { center: parts[0], nodes: parts.slice(1).join(',') } : {} };
    }
    if (/annotate|annotated (?:shot|screenshot|frame)|pins on|annote|annotation sur/.test(s)) {
        return { kind: 'annotated-shot', params: {} };
    }
    if (/reply thread|comment thread|conversation|fil de reponses|echange/.test(s)) {
        const msgs = quoted ? quoted.split(/\s*\|\s*/).filter(Boolean) : [];
        return { kind: 'reply-thread', params: msgs.length ? { messages: msgs.join('|') } : {} };
    }
    if (/\bdm\b|direct message|message prive|bulle de message/.test(s)) {
        return { kind: 'dm-bubble', params: quoted ? { text: quoted } : {} };
    }
    if (/waveform|forme d onde|onde audio/.test(s)) return { kind: 'waveform', params: {} };
    if (/audio bars|spectrum|equali[sz]er|spectre|barres audio/.test(s)) return { kind: 'audio-bars', params: {} };

    // R113 - the specific chart kinds go BEFORE the generic ones: "pie chart"
    // and "area chart" both contain "chart", and the line-graph/bar-chart
    // matchers below are loose enough to claim them. Found by asking for a
    // pie chart and getting a bar chart.
    if (/donut chart|doughnut|anneau|camembert troue/.test(s)) {
        const nums = (raw.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        return { kind: 'donut-chart', params: { ...(nums.length >= 2 ? { values: nums.join(',') } : {}), ...(quoted ? { center: quoted } : {}) } };
    }
    if (/pie chart|camembert|graphique circulaire/.test(s)) {
        const nums = (raw.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        return { kind: 'pie-chart', params: nums.length >= 2 ? { values: nums.join(',') } : {} };
    }
    if (/area chart|filled line|aire|courbe remplie/.test(s)) {
        const nums = (raw.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        return { kind: 'area-chart', params: nums.length >= 2 ? { values: nums.join(',') } : {} };
    }
    // \b on "h bar": without it the substring matches "searc[h bar]", and
    // "search bar \"best AI tools\"" came back as a horizontal bar chart.
    // Caught by an existing suite, not by this one.
    if (/horizontal bar|\bh[- ]bar\b|bar ranking|barres horizontales|classement/.test(s)) {
        const nums = (raw.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        return { kind: 'h-bar-chart', params: nums.length >= 2 ? { values: nums.join(',') } : {} };
    }
    if (/line graph|trend line|courbe|tendance/.test(s)) {
        const nums = (raw.match(/-?\d+(?:[.,]\d+)?/g) || []).slice(0, 6).map(n => n.replace(',', '.'));
        return { kind: 'line-graph', params: nums.length >= 2 ? { values: nums.join(',') } : {} };
    }
    if (/bar chart|\bgraph\b|\bchart\b|histogram|graphique|diagramme/.test(s)) {
        const nums = (raw.match(/-?\d+(?:[.,]\d+)?/g) || []).slice(0, 6).map(n => n.replace(',', '.'));
        return { kind: 'bar-chart', params: nums.length >= 2 ? { values: nums.join(','), labels: '' } : {} };
    }
    if (/progress bar|progress|barre de progression|progression/.test(s)) {
        const m = s.match(/(\d{1,3})\s*%/);
        return { kind: 'progress-bar', params: { ...(m ? { value: Number(m[1]) } : {}), ...(quoted ? { label: quoted } : {}) } };
    }
    if (/arrow|fleche/.test(s)) {
        const d = (s.match(/\b(left|right|up|down|gauche|droite|haut|bas)\b/) || [])[1];
        const map = { gauche: 'left', droite: 'right', haut: 'up', bas: 'down' };
        return { kind: 'arrow', params: d ? { direction: map[d] || d } : {} };
    }
    // R113 - the building blocks. These sit FIRST because several of them
    // ("pie chart", "live") contain words the looser matches below would
    // otherwise claim.
    {
        // A status label is one template with a tone, so the phrasing picks
        // the tone rather than a different kind per badge.
        const tones = [
            [/pro.?tip|^tip\b|astuce|conseil/, 'tip', 'PRO TIP'],
            [/warning|careful|attention|alerte|avertissement/, 'warning', 'WARNING'],
            [/success|done|validated|succes|reussi|valide/, 'success', 'SUCCESS'],
            [/error|wrong|erreur|faux/, 'error', 'ERROR'],
            [/\bnew\b|trending|nouveau|tendance/, 'new', 'NEW'],
            [/\blive\b|en direct|direct\b/, 'live', 'LIVE'],
            [/timestamp|horodatage/, 'time', ''],
            [/source|citation|credit/, 'source', 'SOURCE'],
        ];
        for (const [re, tone, fallback] of tones) {
            if (!re.test(s)) continue;
            if (!/label|badge|tag|chip|pill|indicator|etiquette|badge/.test(s)
                && !/^(pro.?tip|tip|warning|live|new|source)\b/.test(s.trim())) continue;
            return { kind: 'status-label', params: { tone, ...(quoted ? { text: quoted } : (fallback ? { text: fallback } : {})) } };
        }
    }
    if (/numbered marker|number marker|step marker|marqueur numerote|puce numerotee/.test(s)) {
        const m = /\b(\d{1,2})\b/.exec(raw);
        return { kind: 'numbered-marker', params: { ...(m ? { number: Number(m[1]) } : {}), ...(quoted ? { label: quoted } : {}) } };
    }
    if (/spotlight|projecteur|coup de projecteur|dim everything|assombris/.test(s)) return { kind: 'spotlight', params: {} };
    if (/magnif|loupe|zoom lens|lens on/.test(s)) return { kind: 'magnifier', params: {} };
    if (/crosshair|target on|reticle|viseur|cible sur/.test(s)) return { kind: 'crosshair', params: quoted ? { label: quoted } : {} };
    if (/video thumbnail|thumbnail|miniature|vignette/.test(s)) {
        return { kind: 'video-thumbnail', params: quoted ? { title: quoted } : {} };
    }
    if (/video player|player mockup|lecteur video|maquette lecteur/.test(s)) {
        return { kind: 'video-player', params: quoted ? { title: quoted } : {} };
    }
    if (/engagement|likes? counter|like count|compteur de likes|mentions j aime/.test(s)) {
        return { kind: 'engagement-counter', params: {} };
    }
    // R112 - the storyboard's own vocabulary, askable by hand too. Ordered
    // before the looser shape matches below so "step by step" is not eaten by
    // a generic word.
    if (/step card|steps card|step by step|numbered steps|etapes|etape par etape/.test(s)) {
        const steps = quoted ? quoted.split(/\s*[,;\u2022]\s*/).filter(Boolean) : [];
        return { kind: 'step-card', params: steps.length ? { steps: steps.join(',') } : {} };
    }
    if (/checklist|check list|tick list|liste a cocher|cases a cocher/.test(s)) {
        const items = quoted ? quoted.split(/\s*[,;\u2022]\s*/).filter(Boolean) : [];
        return { kind: 'checklist', params: items.length ? { items: items.join(',') } : {} };
    }
    if (/question card|carte question|pose la question/.test(s)) {
        return { kind: 'question-card', params: quoted ? { question: quoted } : {} };
    }
    if (/split label|before and after labels|labels? de chaque cote|avant apres/.test(s)) {
        const sides = quoted ? quoted.split(/\s*(?:,|vs\.?|versus)\s*/i).filter(Boolean) : [];
        return { kind: 'split-label', params: sides.length >= 2 ? { left: sides[0], right: sides[1] } : {} };
    }
    if (/screenshot|screen shot|browser window|browser frame|capture d ?ecran|fenetre navigateur/.test(s)) {
        return { kind: 'screenshot-card', params: { ...(quoted ? { title: quoted } : {}), ...(/phone|mobile|telephone/.test(s) ? { chrome: 'phone' } : {}) } };
    }
    if (/ui card|app card|interface card|carte interface|maquette/.test(s)) {
        return { kind: 'ui-card', params: quoted ? { title: quoted } : {} };
    }
    if (/profile (?:portrait|picture|photo)|avatar|portrait|photo de profil/.test(s)) {
        return { kind: 'profile-portrait', params: quoted ? { name: quoted } : {} };
    }
    if (/stat grid|stats grid|number grid|grille de (?:stats|chiffres)|plusieurs chiffres/.test(s)) {
        const vals = quoted ? quoted.split(/\s*[,;]\s*/).filter(Boolean) : [];
        return { kind: 'stat-grid', params: vals.length ? { values: vals.join(',') } : {} };
    }
    if (/circle|encercle|cercle/.test(s)) return { kind: 'circle-callout', params: {} };
    if (/underline|souligne/.test(s)) return { kind: 'underline', params: {} };
    if (/highlight box|box around|frame around|rectangle|encadre|cadre/.test(s)) return { kind: 'highlight-box', params: {} };
    if (/burst|starburst|explosion|eclat/.test(s)) return { kind: 'burst', params: {} };
    if (/circular meter|gauge|radial meter|jauge/.test(s)) {
        const m = s.match(/(\d{1,3})\s*%/);
        return { kind: 'circular-meter', params: m ? { value: Number(m[1]) } : {} };
    }
    if (/data counter|metric counter|chiffre anime/.test(s)) {
        const m = s.match(/[\d,.]+/);
        return { kind: 'data-counter', params: m ? { value: Number(m[0].replace(/,/g, '')) } : {} };
    }
    if (/film grain|grain 35mm|grain pellicule|35mm/.test(s)) return { kind: 'film-grain', params: {} };
    if (/vhs|glitch|retro tape|scanline/.test(s)) return { kind: 'vhs-glitch', params: {} };
    if (/light leak|leak|flare|lueur/.test(s)) return { kind: 'light-leak', params: {} };
    if (/lower third|titre bas|speaker card|nom du speaker/.test(s)) {
        return { kind: 'lower-third-minimal', params: quoted ? { name: quoted } : {} };
    }
    if (/\b(location|lieu|pin|badge lieu|city|ville)\b/.test(s)) {
        return { kind: 'location-badge', params: quoted ? { location: quoted } : {} };
    }
    if (/retention bar|retention progress|watch progress/.test(s)) {
        const m = s.match(/(\d{1,3})\s*%/);
        return { kind: 'retention-progress-bar', params: m ? { value: Number(m[1]) } : {} };
    }
    if (/quote card|citation|quote|tweet/.test(s)) {
        return { kind: 'quote-card', params: quoted ? { quote: quoted } : {} };
    }
    if (/\b(comparison|before after|avant apres|comparatif|comparaison)\b/.test(s)) {
        return { kind: 'comparison-card', params: quoted ? { beforeVal: quoted } : {} };
    }
    if (/\b(notification|social notif|notif|subscriber|nouvel abonne)\b/.test(s)) {
        return { kind: 'social-notification', params: quoted ? { subtitle: quoted } : {} };
    }
    if (/\b(comment bubble|commentaire|bubble|social proof|temoignage)\b/.test(s)) {
        return { kind: 'comment-bubble', params: quoted ? { text: quoted } : {} };
    }
    if (/\b(kpi|stat callout|metrique cle|taux|chiffre cle)\b/.test(s)) {
        return { kind: 'kpi-stat-callout', params: quoted ? { stat: quoted } : {} };
    }
    if (/\b(newspaper|headline|journal|gazette|titre presse|presse)\b/.test(s)) {
        return { kind: 'newspaper-headline', params: quoted ? { headline: quoted } : {} };
    }
    if (/\b(search bar|barre de recherche|recherche|google search)\b/.test(s)) {
        return { kind: 'search-bar', params: quoted ? { query: quoted } : {} };
    }
    return null;
}

export default {
    TEMPLATE_KINDS, SHAPE_KINDS, FRAME_EFFECT_KINDS, DATA_REQUIRED_KINDS, previewParams, TEMPLATE_FONTS, TEMPLATE_DEFAULTS, TEMPLATE_WIDTH_FRACTION, LABEL_TONES,
    templateParams, templateSize, drawTemplate, highlightLine, templateFromText,
};
