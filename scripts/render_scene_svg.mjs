// scripts/render_scene_svg.mjs
//
//   node scripts/render_scene_svg.mjs [outDir]
//
// A DIAGNOSTIC renderer: turns a composed scene into an SVG you can actually
// look at, at the real frame size, with the safe zone drawn on.
//
// Why this exists: every motion change so far has been verified by asserting
// on numbers — font sizes, y positions, validator counts. Those catch a
// breach or a frame-blind constant, but nobody can see whether the result
// LOOKS right, and the only way to find out has been to open the app. This
// closes that gap for layout specifically.
//
// WHAT IT IS NOT: this is not the app's renderer. It draws from the flattened
// placements with its own SVG primitives, so colours, type and geometry are
// faithful (the wrapping uses the app's OWN TextMeasurement, so line breaks
// and shrink-to-fit match), but shadows, outlines and shape detail are
// approximations and nothing here animates. Trust it for "is the type the
// right size, does it wrap where the app wraps it, is it inside the safe
// zone, does it collide" — not for final pixel fidelity.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'render-previews'));
fs.mkdirSync(OUT, { recursive: true });

const CL = await import('../client/src/motion/ComponentLibrary.js');
const SC = await import('../client/src/motion/SceneComposer.js');
const SV = await import('../client/src/motion/SceneValidator.js');
const SL = await import('../client/src/motion/SceneLayout.js');
const SD = await import('../client/src/motion/SceneDirector.js');
const SS = await import('../client/src/motion/SceneSchema.js');
const TM = await import('../client/src/motion/TextMeasurement.js');

const OVERLAY_BASE = SS.OVERLAY_WIDTH_FRACTION;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The flattened clip's `name` is its layout role, which is what decides the
// measure the text was wrapped to. Mapping it back is what lets this preview
// break lines in the same places the real layout did.
const ROLE_BY_NAME = { Display: 'display', Title: 'title', Stat: 'stat', Subtitle: 'subtitle', Kicker: 'kicker', Label: 'label' };
const roleOf = (clip) => ROLE_BY_NAME[clip.name] || (/stat|value/i.test(clip.name || '') ? 'stat' : 'title');

function textSvg(clip, frame) {
    const role = roleOf(clip);
    // measureFor, not the MEASURE table: the measure is aspect-aware now, and
    // reading the landscape constants here made the preview wrap text the
    // engine lays out on fewer lines — which then looked like engine bugs
    // (a stat broken across three lines, an attribution colliding with a
    // quote). Deriving it from the engine is what keeps the two in step.
    const maxWidth = SC.measureFor(role, frame) * frame.w;
    const fontSize = Number(clip.fontSize) || 56;
    const bounds = TM.measureTextBounds(clip.content, {
        fontSize,
        fontFamily: clip.fontFamily,
        fontWeight: clip.fontWeight,
        maxWidth,
        lineHeight: 1.2,
    });
    const lines = bounds.lines && bounds.lines.length ? bounds.lines : [String(clip.content ?? '')];
    const lh = fontSize * 1.2;
    const cx = (Number(clip.x) / 100) * frame.w;
    const cy = (Number(clip.y) / 100) * frame.h;
    // Centre the whole block on the clip's y, the way a centred overlay sits.
    const firstBaseline = cy - ((lines.length - 1) * lh) / 2 + fontSize * 0.34;
    const tracking = Number(clip.tracking);
    const strokeAttrs = clip.stroke
        ? ` stroke="${esc(clip.stroke.color || '#000')}" stroke-width="${Number(clip.stroke.width) || 4}" paint-order="stroke fill"`
        : '';
    const tspans = lines.map((line, i) => `<tspan x="${cx.toFixed(1)}" y="${(firstBaseline + i * lh).toFixed(1)}">${esc(line)}</tspan>`).join('');
    // Only ask for a weight the family actually ships. Anton, Playfair
    // Display and the other display faces here are single-weight, and an SVG
    // renderer handed font-weight:800 on a Regular-only family SYNTHESISES
    // the bold by widening the glyphs — so the preview showed a two-line CTA
    // bursting out of its plate while the engine's own measurement (727px of
    // text in an 804px plate, confirmed against Anton's real hmtx table) was
    // correct to within 0.3%. A preview that lies is worse than no preview:
    // this is the fourth time a harness artefact was nearly filed as an
    // engine bug, and the rule stands — the harness derives its rules from
    // the engine, and never asks the renderer for something the assets
    // cannot give.
    const SINGLE_WEIGHT = new Set(['Anton', 'Playfair Display', 'Orbitron', 'Bebas Neue']);
    const weight = SINGLE_WEIGHT.has(clip.fontFamily) ? 400 : (clip.fontWeight || 400);
    return `  <text text-anchor="middle" font-family="${esc(clip.fontFamily || 'Inter')}" font-size="${fontSize}" font-weight="${weight}" fill="${esc(clip.color || '#fff')}"${strokeAttrs}${Number.isFinite(tracking) ? ` letter-spacing="${(tracking * fontSize).toFixed(2)}"` : ''} filter="url(#lift)">${tspans}</text>`;
}

function shapeSvg(clip, frame) {
    const kind = clip.template?.kind || 'rect';
    const p = clip.template?.params || {};
    const res = clip.metadata?.resolution || {};
    // `w`/`h` on the template params are ALREADY the final pixel size. The
    // clip's `scale` expresses that same size a second way — it is the factor
    // from the renderer's base overlay width (frame.w * OVERLAY_WIDTH_FRACTION)
    // up to `w`, which is how SceneLayout.backdropFor derives it:
    //   scale = w / (frame.w * OVERLAY_WIDTH_FRACTION)
    // Multiplying w by scale therefore counts the size twice, which drew every
    // accent about 2.5x too big — a circle-callout 1.5x wider than the frame.
    const intrinsicW = Number(p.w) || Number(res.w) || 200;
    const intrinsicH = Number(p.h) || Number(res.h) || 20;
    const scale = Number(clip.scale) > 0 ? Number(clip.scale) : 1;
    // Base overlay width is SceneSchema.OVERLAY_WIDTH_FRACTION of the frame.
    const w = OVERLAY_BASE * frame.w * scale;
    const h = w * (intrinsicH / Math.max(1, intrinsicW));
    const cx = (Number(clip.x) / 100) * frame.w;
    const cy = (Number(clip.y) / 100) * frame.h;
    const colour = esc(p.color || '#FFE500');
    const opacity = Number.isFinite(Number(p.opacity)) ? Number(p.opacity) : 1;
    switch (kind) {
        case 'underline': {
            const t = Number(p.thickness) || 14;
            return `  <rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - t / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${t}" rx="${(t / 2).toFixed(1)}" fill="${colour}" opacity="${opacity}"/>`;
        }
        case 'circle-callout':
            return `  <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(w / 2).toFixed(1)}" ry="${(h / 2).toFixed(1)}" fill="none" stroke="${colour}" stroke-width="8" opacity="${opacity}"/>`;
        case 'highlight-box': {
            const filled = p.fill !== false;
            return `  <rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="16" ${filled ? `fill="${colour}"` : `fill="none" stroke="${colour}" stroke-width="8"`} opacity="${opacity}"/>`;
        }
        case 'panel':
            return `  <rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Number(p.radius) || 24}" fill="${esc(p.color || '#0E0F11')}" opacity="${opacity}"/>`;
        default:
            return `  <rect x="${(cx - w / 2).toFixed(1)}" y="${(cy - h / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="12" fill="${colour}" opacity="${opacity}"/>`;
    }
}

function svgFor(label, placements, aspect, notes = []) {
    const frame = SL.resolveFrame(aspect);
    const safeZone = SV.safeZoneForAspect(aspect);
    const rect = SL.contentRectFor(frame, safeZone);
    // Shapes first so text sits over its own accent, as it does on screen.
    const shapes = placements.filter(p => p.trackType !== 'text');
    const texts = placements.filter(p => p.trackType === 'text');
    const body = [
        ...shapes.map(p => shapeSvg(p.clip, frame)),
        ...texts.map(p => textSvg(p.clip, frame)),
    ].join('\n');
    const noteLines = notes.map((n, i) => `  <text x="28" y="${48 + i * 34}" font-family="Inter" font-size="26" fill="#7CF5C4">${esc(n)}</text>`).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.w}" height="${frame.h}" viewBox="0 0 ${frame.w} ${frame.h}">
  <defs><filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="9" flood-color="#000" flood-opacity="0.55"/></filter></defs>
  <rect width="${frame.w}" height="${frame.h}" fill="#1b1d22"/>
  <rect x="0" y="0" width="${frame.w}" height="${frame.h}" fill="url(#g)"/>
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2f3a"/><stop offset="1" stop-color="#14161a"/></linearGradient></defs>
  <rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="none" stroke="#FF3B5C" stroke-width="3" stroke-dasharray="18 14" opacity="0.6"/>
${body}
  <text x="28" y="${frame.h - 28}" font-family="Inter" font-size="28" fill="#A0AEC0">${esc(label)}  ·  ${frame.w}x${frame.h}  ·  dashed = safe area</text>
${noteLines}
</svg>`;
}

const CASES = [];
const add = (file, label, placements, aspect, notes) => {
    const svg = svgFor(label, placements, aspect, notes);
    fs.writeFileSync(path.join(OUT, file), svg);
    CASES.push(file);
};

const buildOpts = (aspect) => ({ aspectRatio: aspect, safeZone: SV.safeZoneForAspect(aspect) });
const sizesOf = (out) => out.placements.filter(p => p.trackType === 'text').map(p => `${p.clip.name}:${p.clip.fontSize}px`).join('  ');

// ── The three components that just joined the design system ────────────────
for (const [id, preset, params] of [
    ['Callout', 'dark', { text: 'This is the important part' }],
    ['QuoteCard', 'classic', { quote: 'It changed how I think about everything I do', author: 'Marc Ivan' }],
    ['CTAWidget', 'subscribe', { text: 'Follow for part two' }],
    ['CTAWidget', 'follow', { text: 'Follow for part two' }],
]) {
    const out = CL.buildComponent(id, preset, { ...params, duration: 3 }, buildOpts('9:16'));
    add(`${id.toLowerCase()}-${preset}-9x16.svg`, `${id} / ${preset}`, out.placements, '9:16', [sizesOf(out)]);
}

// ── A designed hook, the way Pro Finish composes it ────────────────────────
const hook = SD.composeSceneFromBrief('A punchy short-form hook: open strong and surface the single most important point.', {
    plan: { beats: [
        { kind: 'intro', text: 'Zero To Forty Thousand', motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.9 } },
        { kind: 'point', text: 'Six weeks start to finish', kicker: '01' },
    ] },
    tone: 'viral',
    duration: 5.2,
    aspectRatio: '9:16',
    safeZone: SV.safeZoneForAspect('9:16'),
    subject: { cx: 0.5, cy: 0.62, w: 0.5, h: 0.6 },
});
if (hook?.scene) {
    const { placements } = SS.flattenScene(hook.scene);
    // Both beats run in sequence, so show only what is on screen in beat one.
    const beatOne = placements.filter(p => (Number(p.clip.start) || 0) < 1.5);
    add('hook-beat1-9x16.svg', 'Directed hook, beat 1 (viral tone)', beatOne, '9:16', [
        sizesOf({ placements: beatOne }),
        `placement: ${hook.placement.anchor} — ${hook.placement.reason}`,
    ]);
    const beatTwo = placements.filter(p => (Number(p.clip.start) || 0) >= 1.5);
    if (beatTwo.length) add('hook-beat2-9x16.svg', 'Directed hook, beat 2', beatTwo, '9:16', [sizesOf({ placements: beatTwo })]);
}

// ── A stat callout, the thing a spoken figure turns into ───────────────────
const stat = CL.buildComponent('StatCallout', 'metric-callout', { value: '40 000 €', label: 'in six weeks', duration: 3 }, buildOpts('9:16'));
add('statcallout-9x16.svg', 'StatCallout / metric-callout', stat.placements, '9:16', [sizesOf(stat)]);

// ── The same callout wide, to show the type is frame-relative ──────────────
const wide = CL.buildComponent('Callout', 'dark', { text: 'This is the important part' }, buildOpts('16:9'));
add('callout-16x9.svg', 'Callout / dark (16:9, same words)', wide.placements, '16:9', [sizesOf(wide)]);

console.log(`${CASES.length} SVGs written to ${OUT}`);
for (const f of CASES) console.log('  ' + path.join(OUT, f));
