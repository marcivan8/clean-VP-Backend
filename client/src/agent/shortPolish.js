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
 *   4. MOMENT GRAPHICS: spoken prices/percentages/figures, and a couple of
 *      other strong REVEAL/PUNCHLINE/EMPHASIS beats in the body of the short,
 *      get a designed StatCallout -- the SAME scene engine as the hook title
 *      (R101), not just a number template at the start.
 *   5. CUTS: transitions on scene changes and spaced jump cuts.
 *   6. SPEAKER POP-OUT (optional): background dimmed and softened behind the
 *      person, when a background mask exists for the clip.
 * Sound effects for all of this are placed by the caller (they need the
 * sound library), from agent/sfxCues.js on the polished tracks.
 */

import { composeMotion, COMPOSED } from '../motion/MotionComposer.js';
import { stylePackToClipFields, groupWordsIntoSegments } from '../motion/CaptionModel.js';
import { STYLE_RECIPES, pickTransitionCuts, recipeTransitionForCut } from '../motion/StyleRecipes.js';
import { TRANSITION_DEFAULT_DURATION } from '../motion/TransitionFX.js';
import { normalizeMatte } from '../motion/MatteSettings.js';
// R95 wiring: the hook title is now a DESIGNED graphic (R93-95's scene
// engine) instead of a hand-rolled text clip + a hardcoded underline width.
// `composeComponentScene` sizes the title from the real type scale, measures
// the underline/accent from the actual headline in the actual frame
// (`SceneLayout.computeAccentBounds`, replacing the old flat `widthFrac:
// 0.55`), and keeps the safe zone honestly rather than a guessed `topSafe`
// offset. `flattenScene` turns that design into the same clip shape this
// file always produced, so the player, export and undo are unchanged.
import { composeComponentScene } from '../motion/SceneComposer.js';
import { flattenScene } from '../motion/SceneSchema.js';
// R102 -- the full multi-beat director (R95 PHASE 4), auto-triggered here
// instead of only ever reachable through the manual "design_scene" command.
// See the "1. Hook title" and "1b. CTA outro" sections below.
import { composeSceneFromBrief } from '../motion/SceneDirector.js';

const STOP = new Set(('a an the and or but so to of in on at for with is are was were be been it this that these those i you we they he she my your our their me us them ' +
    'just really very like um uh then also do does did have has had will would can could should not no yes if about from as by here ' +
    'le la les un une des et ou mais donc de du en au aux pour avec est sont je tu il elle nous vous ils elles mon ton son ce cette ces ici').split(' '));

/** Per-platform look of the treatment. */
export const POLISH_LOOK = Object.freeze({
    // `titleComponent`/`titlePreset` pick the closest designed look
    // (motion/SceneComposer.js's `LOOKS`) to what this platform always had:
    // tiktok's slam-in/whip-out IS KineticTitle's "punchy" preset; shorts'
    // pop-in/shrink-out is closest to "creator" (which adds a mid-beat wobble
    // punch); reels' calmer blur/fade has no kinetic-title match, so it uses
    // TitleSequence's "minimal" fade-in/fade-out instead. `titleColor`/
    // `accent` still override the preset's own palette per platform.
    tiktok: { recipe: 'punchy', titleFont: 'Anton', titleColor: '#FFFFFF', accent: '#FFE500', titleComponent: 'KineticTitle', titlePreset: 'punchy', cameraEnergy: 0.7, upper: true },
    reels:  { recipe: 'travel', titleFont: 'Montserrat', titleColor: '#FFFFFF', accent: '#FF3B5C', titleComponent: 'TitleSequence', titlePreset: 'minimal', cameraEnergy: 0.45, upper: false },
    shorts: { recipe: 'punchy', titleFont: 'Anton', titleColor: '#FFFFFF', accent: '#00E5FF', titleComponent: 'KineticTitle', titlePreset: 'creator', cameraEnergy: 0.6, upper: true },
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

/** A short badge label for a mid-short moment callout that has no spoken number to show instead. */
const MOMENT_LABEL = { REVEAL: 'JUST REVEALED', PUNCHLINE_DETECTED: 'THE PUNCHLINE', EMPHASIS_MOMENT: 'KEY MOMENT' };
function momentLabel(eventType, upper) {
    const raw = MOMENT_LABEL[eventType] || 'KEY MOMENT';
    return upper ? raw : raw.charAt(0) + raw.slice(1).toLowerCase();
}

/**
 * A short (up to 4-word) phrase from the words spoken around timeline time
 * `t`, for a mid-short moment callout with no spoken number to show instead.
 * Trims a bare connector/stop word off either edge so the snippet reads as
 * its own beat rather than half a sentence. Null when nothing usable is near.
 */
export function phraseFromWords(words, t, { upper = true, span = 1.1, maxWords = 4 } = {}) {
    const near = (words || [])
        .filter(w => Number(w?.start) <= t + span && Number(w?.end) >= t - span)
        .sort((a, b) => Number(a.start) - Number(b.start));
    if (near.length === 0) return null;
    let picked = near.slice(0, maxWords).map(w => clean(wordOf(w))).filter(Boolean);
    while (picked.length > 1 && STOP.has(picked[0].toLowerCase())) picked.shift();
    while (picked.length > 1 && STOP.has(picked[picked.length - 1].toLowerCase())) picked.pop();
    if (picked.length === 0) return null;
    const out = picked.join(' ');
    return upper ? out.toUpperCase() : out.charAt(0).toUpperCase() + out.slice(1);
}

function trackOf(tracks, type, id, name) {
    let t = tracks.find(x => x.id === id);
    if (!t) { t = { id, type, name, clips: [] }; tracks.push(t); }
    return t;
}

/**
 * Apply the treatment.
 * @param {{tracks:Array, duration:number, aspectRatio?:string}} built from buildShortTimeline
 * @param {object} profile PLATFORM_PROFILES entry
 * @param {{words?:Array, events?:Array, plan?:{headline?:string, keywords?:string[], titleBrief?:string},
 *          scenePlan?:{title?:string, points?:string[], cta?:string, tone?:string, beats?:Array}|null,
 *          popOut?:boolean, layers?:object}} opts words/events in SHORT time (start at 0).
 *          `scenePlan` is the AI's full SceneDirector plan for this short
 *          (shortFinisher.fetchScenePlan / POST /api/motion/scene-plan),
 *          grounded in the short's own transcript. Optional and additive:
 *          when it is null or empty (no AI configured, request failed, the
 *          model had nothing to say), the hook falls back to exactly the
 *          single static title this function always produced.
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

    // 1. Hook title: a designed graphic (kicker/headline + a measured
    // accent), composed for the real frame and safe zone rather than a flat
    // text clip over a hardcoded-width underline.
    const hookDur = Math.min(Math.max(2.2, (profile?.hookSeconds || 1.5) + 1.4), Math.max(1.2, duration * 0.35));
    // composeSceneFromBrief places every beat via SceneDirector's own
    // placementAvoiding(subject, frame, safeZone), which defaults to dead
    // centre with no subject -- unlike the single-title path above (and
    // every moment-graphics call in section 4), which always anchored
    // 'top'. A centred hook/CTA would land in the same vertical band as
    // captions (see the "two independently-designed... layers" note just
    // below), reproducing the overlap that note already fixed once. There
    // is no real subject tracking available here (this function stays pure
    // -- no frame analysis), so a synthetic "speaker, roughly centred and
    // lower in frame" box is enough for placementAvoiding's own geometry to
    // resolve to 'top', matching every other designed graphic in this file.
    const SYNTHETIC_SPEAKER_SUBJECT = { cx: 0.5, cy: 0.62, w: 0.5, h: 0.6 };
    if (want.title) {
        // R102 -- when the AI returned a real structured plan for this short
        // (opts.scenePlan, grounded in its own transcript), the hook becomes
        // the full SceneDirector's own intro beat (plus its first point/stat
        // beat, if the hook budget has room for a second beat) instead of
        // always a single static title. SceneDirector documents its own
        // rule -- "never invent claims" -- so this path is only taken when
        // there is real AI-written text to put on screen; with no plan (no
        // AI configured, the request failed, the model had nothing to add)
        // it falls straight through to the original single-title treatment,
        // unchanged below.
        const scenePlan = opts.scenePlan && typeof opts.scenePlan === 'object' ? opts.scenePlan : null;
        const introBeats = scenePlan ? [
            { kind: 'intro', text: (scenePlan.title && String(scenePlan.title).trim()) || null },
            ...((scenePlan.points?.[0] && hookDur > 3.2) ? [{ kind: 'point', text: String(scenePlan.points[0]).trim(), kicker: '01' }] : []),
        ].filter(b => b.text) : [];

        let hookApplied = false;
        if (introBeats.length) {
            const designed = composeSceneFromBrief(
                'A punchy short-form hook: open strong and surface the single most important point.',
                {
                    plan: { beats: introBeats },
                    tone: 'viral',
                    duration: hookDur,
                    aspectRatio: built?.aspectRatio || '9:16',
                    safeZone: profile?.safeZone,
                    subject: SYNTHETIC_SPEAKER_SUBJECT,
                    palette: { accent: look.accent, text: look.titleColor },
                },
            );
            if (designed?.scene) {
                const { placements } = flattenScene(designed.scene);
                // `short-` prefixed ids (as the old hand-rolled clips always
                // had) are how `polish_short` finds and replaces this layer
                // on a re-run instead of stacking a second one - see
                // MediaExecutionEngine.js's `isFinishLayer`.
                let textN = 0, gfxN = 0;
                for (const p of placements) {
                    const isText = p.trackType === 'text';
                    const t = trackOf(tracks, isText ? 'text' : 'overlay', isText ? 'track-short-title' : 'track-short-graphics', isText ? 'Hook' : 'Short graphics');
                    const id = isText ? `short-hook-text-${textN++}` : `short-hook-gfx-${gfxN++}`;
                    t.clips.push({ ...p.clip, id });
                }
                if (placements.length) {
                    applied.push(`hook sequence (${introBeats.length} beat${introBeats.length > 1 ? 's' : ''}, AI-directed)`);
                    hookApplied = true;
                }
            }
        }

        if (!hookApplied) {
            const headline = (opts.plan?.headline && String(opts.plan.headline).trim())
                || headlineFromText(words.slice(0, 18).map(wordOf).join(' '), { upper: look.upper });
            if (headline) {
                const scene = composeComponentScene(look.titleComponent, look.titlePreset, {
                    title: look.upper ? headline.toUpperCase() : headline,
                    color: look.titleColor,
                    accentColor: look.accent,
                    fontFamily: look.titleFont,
                    duration: hookDur,
                    anchor: 'top',
                }, { aspectRatio: built?.aspectRatio || '9:16', safeZone: profile?.safeZone });
                if (scene) {
                    const { placements } = flattenScene(scene);
                    let textN = 0, gfxN = 0;
                    for (const p of placements) {
                        const isText = p.trackType === 'text';
                        const t = trackOf(tracks, isText ? 'text' : 'overlay', isText ? 'track-short-title' : 'track-short-graphics', isText ? 'Hook' : 'Short graphics');
                        const id = isText ? `short-hook-text-${textN++}` : `short-hook-gfx-${gfxN++}`;
                        t.clips.push({ ...p.clip, id });
                    }
                    if (placements.length) applied.push('hook title');
                }
            }
        }
    }

    // 1b. CTA outro: a brief, designed call-to-action beat at the very end
    // of the short, when the AI's scene plan supplied one (from the
    // transcript or an explicit ask -- never invented). Nothing filled this
    // gap before: the hook title and the moment graphics in section 4 never
    // covered the close of a short. Skipped outright when the short is too
    // short to fit both the hook and a CTA without them overlapping.
    if (want.title && opts.scenePlan?.cta) {
        const ctaDur = Math.max(1.2, Math.min(2.2, duration * 0.12));
        const ctaStart = Math.max(0, duration - ctaDur);
        if (ctaStart > hookDur + 0.2) {
            const designed = composeSceneFromBrief(
                'A short, direct call to action to close a short-form video.',
                {
                    plan: { beats: [{ kind: 'cta', text: String(opts.scenePlan.cta).trim() }] },
                    tone: 'viral',
                    duration: ctaDur,
                    aspectRatio: built?.aspectRatio || '9:16',
                    safeZone: profile?.safeZone,
                    subject: SYNTHETIC_SPEAKER_SUBJECT,
                    palette: { accent: look.accent, text: look.titleColor },
                },
            );
            if (designed?.scene) {
                const { placements } = flattenScene(designed.scene, { startOffset: ctaStart });
                let textN = 0, gfxN = 0;
                for (const p of placements) {
                    const isText = p.trackType === 'text';
                    const t = trackOf(tracks, isText ? 'text' : 'overlay', isText ? 'track-short-cta' : 'track-short-graphics', isText ? 'CTA' : 'Short graphics');
                    const id = isText ? `short-cta-text-${textN++}` : `short-cta-gfx-${gfxN++}`;
                    t.clips.push({ ...p.clip, id });
                }
                if (placements.length) applied.push('cta outro');
            }
        }
    }

    // 2. Captions: platform pack, safe zone, key words.
    // If the main edit was never captioned first (the common case for a
    // short pulled straight from raw footage), there is nothing here to
    // restyle -- this used to silently do nothing, which is the "captions
    // aren't allowed" symptom. Generate lines from the word-level transcript
    // (the same grouping the main editor's "Add captions" command uses,
    // motion/CaptionModel.js's groupWordsIntoSegments) before styling, so a
    // short always gets captions when a transcript is available, and only
    // stays silent when there is truly no speech to caption.
    if (want.captions && profile?.captionPack) {
        const fields = stylePackToClipFields(profile.captionPack) || {};
        const captionClips = [];
        for (const t of tracks) {
            if (t.type !== 'text' || t.id === 'track-short-title') continue;
            for (const c of t.clips) {
                const isCaption = (Array.isArray(c.words) && c.words.length > 0) || String(c.clipId || c.id || '').startsWith('caption-') || c.style === 'subtitle';
                if (isCaption) captionClips.push(c);
            }
        }

        let generated = 0;
        if (captionClips.length === 0 && words.length > 0) {
            const segments = groupWordsIntoSegments(words, 6, 0.4).filter(seg => (seg.start || 0) < duration);
            if (segments.length) {
                // `short-` prefixed, like the hook title, so a re-run of
                // polish_short on the main edit replaces this batch instead
                // of stacking a second one (MediaExecutionEngine's
                // isFinishLayer).
                const capTrack = trackOf(tracks, 'text', 'track-short-captions', 'Captions');
                segments.forEach((seg, i) => {
                    const nextStart = segments[i + 1]?.start;
                    const clampedEnd = nextStart != null ? Math.min(seg.end || 0, nextStart) : (seg.end || 0);
                    const segDuration = Math.max(0.3, Math.min(duration - (seg.start || 0), clampedEnd - (seg.start || 0)));
                    if (segDuration <= 0) return;
                    const clip = {
                        id: `short-caption-${i}`,
                        clipId: `short-caption-${i}`,
                        type: 'text',
                        name: seg.text,
                        content: seg.text,
                        position: 'bottom',
                        style: 'subtitle',
                        textAlign: 'center',
                        animation: 'none',
                        words: seg.words,
                        start: seg.start || 0,
                        duration: segDuration,
                        sourceDuration: segDuration,
                    };
                    capTrack.clips.push(clip);
                    captionClips.push(clip);
                    generated += 1;
                });
            }
        }

        // The hook title (section 1) and these captions are two
        // independently-designed full-screen text layers with no shared
        // layout pass between them. When a caption's time range falls inside
        // the hook's, keep it clear of the hook's vertical space instead of
        // both landing in the same region of the frame -- this is what
        // produced visibly overlapping text (hook headline + word-highlight
        // caption stacked on screen) for the opening seconds of a short.
        const hookDurForCaptions = want.title
            ? Math.min(Math.max(2.2, (profile?.hookSeconds || 1.5) + 1.4), Math.max(1.2, duration * 0.35))
            : 0;
        // Below the safe-zone top margin the hook occupies, clamped so it
        // never pushes past the bottom safe zone either.
        const belowHookY = Math.min(100 - (profile?.safeZone?.bottom || 0.3) * 100, Math.max(profile.captionY, 38));

        let styled = 0;
        for (const c of captionClips) {
            const overlapsHook = hookDurForCaptions > 0 && (Number(c.start) || 0) < hookDurForCaptions;
            Object.assign(c, fields, { x: 50, y: overlapsHook ? belowHookY : profile.captionY });
            // A caption running long (more than ~4 words) renders as 2+ lines
            // at the pack's base size and can grow tall enough to reach back
            // up into the hook's space even after the Y offset above -- scale
            // the font down a bit for those instead of just moving the anchor.
            const wordCount = String(c.content || '').trim().split(/\s+/).filter(Boolean).length;
            if (wordCount > 4 && Number.isFinite(Number(fields.fontSize))) {
                c.fontSize = Math.round(Number(fields.fontSize) * (wordCount > 7 ? 0.72 : 0.85));
            }
            const idx = emphasisIndices(c.content, opts.plan?.keywords);
            if (idx.length) c.emphasis = { indices: idx, source: 'auto' };
            styled += 1;
        }
        if (styled) applied.push(generated ? `captions (${styled}, generated from the transcript)` : `captions (${styled})`);
    }

    // 3. Camera: slow push per shot, punch on each moment
    if (want.camera) {
        let moved = 0;
        for (const t of tracks) {
            if (t.type !== 'video') continue;
            for (const c of t.clips) {
                if (c.type && c.type !== 'video') continue;
                const d = Number(c.duration) || 0;
                // Was a 0.8s floor: a Reel's own pacing (EditingStyles.js
                // 'reel': minSilence 0.3, padding 0.05) routinely produces
                // jump-cut clips well under 0.8s, so most of a tightly-cut
                // short got NO camera movement at all. 0.3s still reads as
                // motion on screen; energy is scaled down further for very
                // short clips so the push doesn't feel like a jolt.
                if (d < 0.3) continue;
                const shortClipScale = d < 0.8 ? Math.max(0.35, d / 0.8) : 1;
                const beats = [{ verb: 'push-in', at: 0, duration: d, energy: look.cameraEnergy * 0.5 * shortClipScale }];
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

    // 4. Moment graphics: a spoken number, or another strong beat in the
    // body of the short, gets a designed StatCallout -- the SAME scene
    // engine (R93-95, composeComponentScene + flattenScene) the hook title
    // above already uses, instead of a flat hand-rolled TemplateGraphics
    // node. Before R101 only spoken numbers got a graphic at all, and the
    // hook title was the ONLY place the designed scene engine showed up in a
    // short; Marc asked for the engine to carry the whole short, not just
    // its opening couple of seconds.
    if (want.numbers) {
        const hookEnd = want.title
            ? Math.min(Math.max(2.2, (profile?.hookSeconds || 1.5) + 1.4), Math.max(1.2, duration * 0.35))
            : 0;
        const nums = spokenNumbers(words).filter(n => n.t > 0.3 && n.t < duration - 1);
        let momentTextN = 0, momentGfxN = 0, momentsCount = 0;
        const pushCallout = (scene, atStart) => {
            if (!scene) return;
            const { placements } = flattenScene(scene, { startOffset: atStart });
            if (!placements.length) return;
            for (const p of placements) {
                const isText = p.trackType === 'text';
                const t = trackOf(tracks, isText ? 'text' : 'overlay', isText ? 'track-short-moments' : 'track-short-graphics', isText ? 'Moments' : 'Short graphics');
                const id = isText ? `short-moment-text-${momentTextN++}` : `short-moment-gfx-${momentGfxN++}`;
                t.clips.push({ ...p.clip, id });
            }
            momentsCount += 1;
        };
        nums.forEach(n => {
            const scene = composeComponentScene('StatCallout', 'metric-callout', {
                value: n.text, label: look.upper ? 'JUST SAID' : 'just said', color: look.accent,
                duration: Math.min(1.6, duration - n.t),
            }, { aspectRatio: built?.aspectRatio || '9:16', safeZone: profile?.safeZone });
            pushCallout(scene, Math.max(0, n.t - 0.1));
        });
        // The body of the short still deserves its own graphic beats, not
        // only the hook: up to two more REVEAL/PUNCHLINE/EMPHASIS moments
        // (clear of the hook, and clear of a number already shown) get a
        // short phrase callout.
        const phraseMoments = moments.filter(m => {
            const t = Number(m.timelineTime);
            if (!(t > hookEnd + 0.4 && t < duration - 1)) return false;
            return !nums.some(n => Math.abs(n.t - t) < 2.5);
        });
        phraseMoments.slice(0, 2).forEach(m => {
            const t = Number(m.timelineTime);
            const phrase = phraseFromWords(words, t, { upper: look.upper });
            if (!phrase) return;
            const scene = composeComponentScene('StatCallout', 'metric-callout', {
                value: phrase, label: momentLabel(m.eventType, look.upper), color: look.accent,
                duration: Math.max(0.5, Math.min(1.6, duration - t - 0.1)),
            }, { aspectRatio: built?.aspectRatio || '9:16', safeZone: profile?.safeZone });
            pushCallout(scene, Math.max(0, t - 0.3));
        });
        if (momentsCount) applied.push(`moment graphics (${momentsCount})`);
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

export default { POLISH_LOOK, headlineFromText, spokenNumbers, emphasisIndices, phraseFromWords, polishShort, shiftToShort };
