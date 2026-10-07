/**
 * client/src/agent/shortPolish.js
 *
 * R92 round C: the "pro" treatment for a short, so a repurposed clip comes out
 * finished, not just cut. Pure: a built short (agent/shortTimeline.js) in,
 * a richer short out. Everything it adds is ordinary timeline data the
 * preview and the export already render, so the result can also be opened as
 * its own project and edited by hand.
 *
 * Layers, each tuned per platform (agent/PlatformProfiles.js):
 *   1. HOOK TITLE: a short headline on screen for the first seconds, with
 *      motion written by MotionComposer (slam / pop / rise + a punch on the
 *      key word moment + an exit) and a hand-drawn underline that draws on.
 *   2. CAPTIONS: the platform's caption pack (word highlight included), kept
 *      in the safe zone, with one or two key words emphasised per line.
 *   3. CAMERA: a slow push across each shot and a punch-in on every detected
 *      moment (reveal, punchline, emphasis), on the video clips themselves.
 *   4. NUMBER POPS: spoken prices, percentages and figures pop on screen.
 *   5. CUTS: transitions on scene changes and spaced jump cuts.
 *   6. SPEAKER POP-OUT (optional): background dimmed and softened behind the
 *      person, when a background mask exists for the clip.
 * Sound effects for all of this are placed by the caller (they need the
 * sound library), from agent/sfxCues.js on the polished tracks.
 */

import { composeMotion, COMPOSED } from '../motion/MotionComposer.js';
import { stylePackToClipFields } from '../motion/CaptionModel.js';
import { templateParams, templateSize, TEMPLATE_WIDTH_FRACTION } from '../motion/TemplateGraphics.js';
import { STYLE_RECIPES, pickTransitionCuts, recipeTransitionForCut } from '../motion/StyleRecipes.js';
import { TRANSITION_DEFAULT_DURATION } from '../motion/TransitionFX.js';
import { normalizeMatte } from '../motion/MatteSettings.js';

const STOP = new Set(('a an the and or but so to of in on at for with is are was were be been it this that these those i you we they he she my your our their me us them ' +
    'just really very like um uh then also do does did have has had will would can could should not no yes if about from as by here ' +
    'le la les un une des et ou mais donc de du en au aux pour avec est sont je tu il elle nous vous ils elles mon ton son ce cette ces ici').split(' '));

/** Per-platform look of the treatment. */
export const POLISH_LOOK = Object.freeze({
    tiktok: { recipe: 'punchy', titleFont: 'Anton', titleColor: '#FFFFFF', accent: '#FFE500', titleEntrance: 'slam-in', titleExit: 'whip-out', cameraEnergy: 0.7, upper: true },
    reels:  { recipe: 'travel', titleFont: 'Montserrat', titleColor: '#FFFFFF', accent: '#FF3B5C', titleEntrance: 'blur-in', titleExit: 'fade-out', cameraEnergy: 0.45, upper: false },
    shorts: { recipe: 'punchy', titleFont: 'Anton', titleColor: '#FFFFFF', accent: '#00E5FF', titleEntrance: 'pop-in', titleExit: 'shrink-out', cameraEnergy: 0.6, upper: true },
});

const MOMENT_TYPES = new Set(['REVEAL', 'PUNCHLINE_DETECTED', 'EMPHASIS_MOMENT']);

const wordOf = w => String(w?.word ?? w?.text ?? '').trim();
const clean = s => s.replace(/[^\p{L}\p{N}%€$£'-]/gu, '');

/**
 * A headline from the short's opening words when no AI headline is given:
 * up to 6 meaningful words, starting at the first content word.
 */
export function headlineFromText(text, { maxWords = 6, upper = true } = {}) {
    const words = String(text || '').split(/\s+/).map(clean).filter(Boolean);
    let i = 0;
    while (i < words.length - 2 && STOP.has(words[i].toLowerCase())) i += 1;
    const picked = words.slice(i, i + maxWords);
    while (picked.length > 2 && STOP.has(picked[picked.length - 1].toLowerCase())) picked.pop();
    const out = picked.join(' ');
    return upper ? out.toUpperCase() : out.charAt(0).toUpperCase() + out.slice(1);
}

/** Spoken prices, percentages and figures in timeline words: [{t, text}]. */
export function spokenNumbers(words, { max = 4, gap = 4 } = {}) {
    const out = [];
    for (let i = 0; i < (words || []).length; i++) {
        const raw = wordOf(words[i]);
        const next = wordOf(words[i + 1]).toLowerCase();
        const m = raw.match(/^[$€£]?\d[\d,.]*(?:k|m|%|€|\$)?$/i);
        if (!m) continue;
        const n = Number(raw.replace(/[^\d.]/g, ''));
        if (!Number.isFinite(n) || (n < 10 && !/[%$€£]/.test(raw) && !/percent|dollars?|euros?|k\b|thousand|million/.test(next))) continue;
        let text = raw.replace(/[.,]$/, '');
        if (/^percent/.test(next)) text += '%';
        else if (/^dollars?/.test(next)) text = `$${text}`;
        else if (/^euros?/.test(next)) text += '€';
        else if (/^thousand/.test(next)) text += 'K';
        else if (/^million/.test(next)) text += 'M';
        const t = Number(words[i].start);
        if (!Number.isFinite(t)) continue;
        if (out.length && t - out[out.length - 1].t < gap) continue;
        out.push({ t, text });
        if (out.length >= max) break;
    }
    return out;
}

/** Indices of 1-2 key words in a caption (numbers first, then long content words, or AI keywords). */
export function emphasisIndices(content, keywords = []) {
    const tokens = String(content || '').split(' ').filter(Boolean);
    const keys = new Set((keywords || []).map(k => String(k).toLowerCase()));
    const scored = tokens.map((tok, i) => {
        const w = clean(tok).toLowerCase();
        if (!w || STOP.has(w)) {
            const nextW = clean(tokens[i + 1] || '').toLowerCase();
            if (nextW && keys.has(nextW) && !STOP.has(nextW)) {
                return { i, s: 4 };
            }
            return { i, s: -1 };
        }
        let s = w.length >= 6 ? 1 : 0;
        if (/\d/.test(w)) s += 3;
        if (keys.has(w)) s += 4;
        return { i, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
    return scored.slice(0, tokens.length > 6 ? (keys.size ? 3 : 2) : (keys.size ? 2 : 1)).map(x => x.i).sort((a, b) => a - b);
}

function trackOf(tracks, type, id, name) {
    let t = tracks.find(x => x.id === id);
    if (!t) { t = { id, type, name, clips: [] }; tracks.push(t); }
    return t;
}

function templateClip(id, kind, params, { start, duration, x = 50, y = 50, widthFrac }) {
    const p = templateParams(kind, params);
    const size = templateSize(kind, p);
    return {
        id, type: 'template', name: kind,
        template: { kind, params: p },
        metadata: { resolution: { w: size.w, h: size.h } },
        start, duration, x, y,
        scale: (widthFrac || TEMPLATE_WIDTH_FRACTION[kind] || 0.5) / 0.25,
        rotation: 0, opacity: 1,
    };
}

/**
 * Apply the treatment.
 * @param {{tracks:Array, duration:number, aspectRatio?:string}} built from buildShortTimeline
 * @param {object} profile PLATFORM_PROFILES entry
 * @param {{words?:Array, events?:Array, plan?:{headline?:string, keywords?:string[], titleBrief?:string},
 *          popOut?:boolean, layers?:object}} opts words/events in SHORT time (start at 0)
 * @returns {{tracks:Array, duration:number, aspectRatio:string, applied:string[]}}
 */
export function polishShort(built, profile, opts = {}) {
    const look = POLISH_LOOK[profile?.id] || POLISH_LOOK.tiktok;
    const want = { title: true, captions: true, camera: true, numbers: true, cuts: true, popOut: !!opts.popOut, ...(opts.layers || {}) };
    const tracks = (built?.tracks || []).map(t => ({ ...t, clips: (t.clips || []).map(c => ({ ...c })) }));
    const duration = Math.max(0.5, Number(built?.duration) || 0);
    const words = Array.isArray(opts.words) ? opts.words : [];
    const moments = (opts.events || []).filter(e => MOMENT_TYPES.has(e?.eventType) && Number(e.timelineTime) >= 0 && Number(e.timelineTime) < duration);
    const applied = [];
    const topSafe = (profile?.safeZone?.top ?? 0.12) * 100;

    // 1. Hook title + underline
    if (want.title) {
        const headline = (opts.plan?.headline && String(opts.plan.headline).trim())
            || headlineFromText(words.slice(0, 18).map(wordOf).join(' '), { upper: look.upper });
        if (headline) {
            const hookDur = Math.min(Math.max(2.2, (profile?.hookSeconds || 1.5) + 1.4), Math.max(1.2, duration * 0.35));
            const titleY = topSafe + 10;
            const beats = [
                { verb: look.titleEntrance, energy: look.cameraEnergy },
                { verb: 'punch', at: Math.min(hookDur * 0.55, 1.4), energy: look.cameraEnergy * 0.8 },
                { verb: look.titleExit, energy: look.cameraEnergy },
            ];
            const { animations } = composeMotion({ beats }, { duration: hookDur, kind: 'text' });
            const titleTrack = trackOf(tracks, 'text', 'track-short-title', 'Hook');
            titleTrack.clips.push({
                id: 'short-hook-title', type: 'text', name: 'Hook',
                content: look.upper ? headline.toUpperCase() : headline,
                start: 0, duration: hookDur, x: 50, y: titleY,
                fontFamily: look.titleFont, fontSize: 78, fontWeight: 'bold', color: look.titleColor,
                stroke: { width: 3, color: '#000000' },
                textShadow: '0 6px 18px rgba(0,0,0,0.55)',
                textAlign: 'center',
                animations, animation: 'none',
            });
            const gfx = trackOf(tracks, 'overlay', 'track-short-graphics', 'Short graphics');
            gfx.clips.push(templateClip('short-hook-underline', 'underline', { color: look.accent, thickness: 16 },
                { start: 0.25, duration: Math.max(0.8, hookDur - 0.25), y: titleY + 6, widthFrac: 0.55 }));
            applied.push('hook title');
        }
    }

    // 2. Captions: platform pack, safe zone, key words
    if (want.captions && profile?.captionPack) {
        const fields = stylePackToClipFields(profile.captionPack) || {};
        let styled = 0;
        for (const t of tracks) {
            if (t.type !== 'text' || t.id === 'track-short-title') continue;
            for (const c of t.clips) {
                const isCaption = (Array.isArray(c.words) && c.words.length > 0) || String(c.clipId || c.id || '').startsWith('caption-') || c.style === 'subtitle';
                if (!isCaption) continue;
                Object.assign(c, fields, { x: 50, y: profile.captionY });
                const idx = emphasisIndices(c.content, opts.plan?.keywords);
                if (idx.length) c.emphasis = { indices: idx, source: 'auto' };
                styled += 1;
            }
        }
        if (styled) applied.push(`captions (${styled})`);
    }

    // 3. Camera: slow push per shot, punch on each moment
    if (want.camera) {
        let moved = 0;
        for (const t of tracks) {
            if (t.type !== 'video') continue;
            for (const c of t.clips) {
                if (c.type && c.type !== 'video') continue;
                const d = Number(c.duration) || 0;
                if (d < 0.8) continue;
                const beats = [{ verb: 'push-in', at: 0, duration: d, energy: look.cameraEnergy * 0.5 }];
                for (const m of moments) {
                    const at = Number(m.timelineTime) - (Number(c.start) || 0);
                    if (at >= 0.1 && at < d - 0.3) beats.push({ verb: 'punch', at, energy: look.cameraEnergy });
                }
                const { animations } = composeMotion({ beats }, { duration: d, kind: 'video' });
                if (animations.length) { c.animations = [...(c.animations || []).filter(a => a?.source !== COMPOSED), ...animations]; moved += 1; }
            }
        }
        if (moved) applied.push(`camera moves (${moments.length} punch-in${moments.length === 1 ? '' : 's'})`);
    }

    // 4. Number pops
    if (want.numbers) {
        const nums = spokenNumbers(words).filter(n => n.t > 0.3 && n.t < duration - 1);
        if (nums.length) {
            const gfx = trackOf(tracks, 'overlay', 'track-short-graphics', 'Short graphics');
            nums.forEach((n, i) => gfx.clips.push(templateClip(`short-pop-${i}`, 'price-pop', { text: n.text, color: look.accent },
                { start: Math.max(0, n.t - 0.1), duration: Math.min(1.6, duration - n.t), y: topSafe + 22 })));
            applied.push(`number pops (${nums.length})`);
        }
    }

    // 5. Transitions on real cuts
    if (want.cuts) {
        const recipe = STYLE_RECIPES[look.recipe];
        const base = tracks.find(t => t.type === 'video' && t.clips.length > 1);
        if (recipe && base) {
            const picked = pickTransitionCuts(base.clips, recipe);
            const last = base.clips.reduce((m, c) => ((Number(c.start) + Number(c.duration)) > (Number(m.start) + Number(m.duration)) ? c : m), base.clips[0]);
            let n = 0;
            picked.forEach((clipId, i) => {
                const clip = base.clips.find(c => c.id === clipId);
                if (!clip || clip === last) return;
                const tr = recipeTransitionForCut(recipe, i);
                if (tr) { clip.transition = { type: tr.type, duration: tr.duration || TRANSITION_DEFAULT_DURATION[tr.type] }; n += 1; }
            });
            if (n) applied.push(`transitions (${n})`);
        }
    }

    // 6. Speaker pop-out (needs a mask on the clip)
    if (want.popOut) {
        let popped = 0;
        for (const t of tracks) {
            if (t.type !== 'video') continue;
            for (const c of t.clips) {
                if (!(c.layerMask?.maskAssetPath || c.layerMask?.maskAssetUrl)) continue;
                c.layerTarget = 'background';
                c.layerMask = { ...c.layerMask, settings: normalizeMatte({ ...(c.layerMask.settings || {}), mode: 'dim', dim: 0.4, blur: 14, feather: 5 }) };
                popped += 1;
            }
        }
        if (popped) applied.push('speaker pop-out');
    }

    return { tracks, duration, aspectRatio: built?.aspectRatio || '9:16', applied };
}

/** Words and moment events moved into short time (0 = the short's start). */
export function shiftToShort(list, start, end, key = 'start') {
    const round4 = n => Math.round(n * 10000) / 10000;
    return (Array.isArray(list) ? list : [])
        .filter(x => Number(x?.[key]) >= start && Number(x?.[key]) < end)
        .map(x => ({
            ...x,
            [key]: round4(Number(x[key]) - start),
            ...(key === 'start' && Number.isFinite(Number(x.end)) ? { end: round4(Number(x.end) - start) } : {}),
        }));
}

export default { POLISH_LOOK, headlineFromText, spokenNumbers, emphasisIndices, polishShort, shiftToShort };
