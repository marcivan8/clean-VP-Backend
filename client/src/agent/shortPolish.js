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
import { iconFromText } from '../motion/IconLibrary.js';
import { VECTOR_ILLUSTRATIONS } from '../motion/VectorIllustrationLibrary.js';
import { templateSize } from '../motion/TemplateGraphics.js';
import { applyPresetToClip } from '../motion/ClipAdapter.js';
import { buildStyleReferencePlan } from '../motion/StyleReferenceAdapter.js';

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

/**
 * Primary local scene plan for Pro Finish. It grounds structure, timing and
 * motion in the transcript, semantic events, uploaded-asset visual profiles,
 * editing style and the executable Motion Knowledge Base.
 */
export function fallbackShortScenePlan(words, {
    headline = '', duration = 0, techniques = [], visualContext = [], events = [],
    platform = '', editingStyle = '', referenceStyle = null,
} = {}) {
    const cleanText = value => String(value || '')
        .replace(/#[\p{L}\p{N}_]+/gu, '')
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
        .replace(/[.,;:!?]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .slice(0, 7)
        .join(' ')
        .slice(0, 70);
    const timedWords = (Array.isArray(words) ? words : [])
        .map(w => ({
            word: wordOf(w),
            start: Number(w?.start),
            end: Number(w?.end),
        }))
        .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
    const segments = groupWordsIntoSegments(timedWords, 8, 0.55)
        .map(s => ({ ...s, text: cleanText(s.text) }))
        .filter(s => s.text.split(/\s+/).filter(Boolean).length >= 2);
    const title = cleanText(headline)
        || headlineFromText(timedWords.slice(0, 18).map(w => w.word).join(' '), { maxWords: 6, upper: false });
    if (!title) return null;
    const referencePlan = buildStyleReferencePlan(referenceStyle);

    const transcript = timedWords.map(w => w.word).join(' ').toLowerCase();
    // A reference clip supplies design evidence only; its subject/content must
    // never be mistaken for source footage or drive content-matched cutaways.
    const sourceVisualContext = (Array.isArray(visualContext) ? visualContext : [])
        .filter(item => !item?.isReference);
    const visualLanguage = sourceVisualContext
        .flatMap(item => [item?.sceneType, item?.locationType, item?.emotionalTone, item?.contentDescription].filter(Boolean))
        .join(' ').toLowerCase();
    const inferredTone = /\b(step|steps|lesson|lessons|why|how|explained|tutorial|first|second|étape|étapes|leçon|leçons|pourquoi|comment|expliqué|tutoriel|premier|première|deuxième)\b/.test(transcript)
        ? 'editorial'
        : /\b(i|me|my|mine|story|felt|remember|experience|je|moi|mon|ma|histoire|ressenti|souviens|expérience)\b/.test(transcript)
            ? 'warm'
            : /\b(product|app|software|technology|platform|feature|tool|produit|application|logiciel|technologie|plateforme|fonctionnalité|outil)\b/.test(`${transcript} ${visualLanguage}`)
                ? 'technology'
                : /\b(warm|cozy|intimate|personnel|chaleureux|émotion|emotion|portrait|interview)\b/.test(visualLanguage)
                        ? 'warm'
                        : /\b(premium|luxury|studio|cinematic|luxe|studio|cinématique)\b/.test(visualLanguage)
                            ? 'premium' : 'viral';
    const styleTones = { vlog: 'warm', talking_head: 'editorial', interview: 'warm', podcast: 'warm', reel: 'viral' };
    const platformTones = { tiktok: 'viral', reels: 'premium', shorts: 'technology' };
    const tone = referencePlan?.visualTone || styleTones[editingStyle] || (inferredTone === 'viral' ? (platformTones[platform] || inferredTone) : inferredTone);
    const calmStyle = editingStyle === 'podcast' || editingStyle === 'interview';
    const restrainedMotion = calmStyle || editingStyle === 'talking_head'
        || referencePlan?.motionEnergy === 'low' || ['warm', 'editorial', 'cinematic'].includes(referencePlan?.visualTone);
    const wordsOf = value => value.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    const titleWords = new Set(wordsOf(title));
    const pointSegment = segments.find(segment => {
        if (segment.text.toLowerCase() === title.toLowerCase()) return false;
        const tokens = wordsOf(segment.text);
        const overlap = tokens.filter(token => titleWords.has(token)).length;
        return tokens.length >= 3 && overlap / tokens.length < 0.6 && segment.start >= 2;
    });

    const usableTechniques = Array.isArray(techniques) ? techniques.filter(t => t?.name) : [];
    const visuals = sourceVisualContext
        .filter(item => item && (item.isBroll || item.sceneType || item.contentDescription || item.suggestedLabel))
        .slice(0, 80);
    const tokensOf = value => (String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || [])
        .filter(token => token.length > 3 && !STOP.has(token));
    const visualTokens = new Set(visuals.flatMap(item => tokensOf([
        item.contentDescription, item.suggestedLabel, item.sceneType, item.locationType, item.emotionalTone,
    ].filter(Boolean).join(' '))));
    const chosenTechniques = new Set();
    const chooseTechnique = (kind, text, excluded = []) => {
        const compatible = usableTechniques.filter(t => !Array.isArray(t.beatKinds) || t.beatKinds.includes(kind));
        const distinct = compatible.filter(t => !excluded.includes(t.name) && !chosenTechniques.has(t.name));
        const candidates = distinct.length ? distinct : compatible;
        if (!candidates.length) return null;
        const speech = new Set(tokensOf(text));
        const score = t => {
            const terms = tokensOf([
                t.name, t.displayName, t.description, t.mood, t.category,
                ...(Array.isArray(t.searchKeywords) ? t.searchKeywords : []),
                ...(Array.isArray(t.bestUseCases) ? t.bestUseCases : []),
            ].filter(Boolean).join(' '));
            const unique = [...new Set(terms)];
            const speechFit = unique.reduce((n, token) => n + (speech.has(token) ? 4 : 0), 0);
            const visualFit = unique.reduce((n, token) => n + (visualTokens.has(token) ? 1 : 0), 0);
            const toneFit = Array.isArray(t.tones) && t.tones.includes(tone) ? 2 : 0;
            return speechFit + visualFit + toneFit;
        };
        const picked = candidates.slice().sort((a, b) => score(b) - score(a) || String(a.name).localeCompare(String(b.name)))[0];
        if (picked?.name) chosenTechniques.add(picked.name);
        return picked;
    };
    const introTechnique = chooseTechnique('intro', title);
    const pointTechnique = chooseTechnique('point', pointSegment?.text || '', [introTechnique?.name]);
    const fallbackMotion = kind => restrainedMotion ? ({
        intro: { enter: 'rise-in', emphasis: 'nod', exit: 'fade-out', energy: 0.34 },
        point: { enter: 'fade-in', emphasis: 'nod', exit: 'fade-out', energy: 0.28 },
        stat: { enter: 'pop-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.4 },
        quote: { enter: 'fade-in', emphasis: 'nod', exit: 'fade-out', energy: 0.28 },
        cta: { enter: 'fade-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.32 },
    }[kind] || { enter: 'fade-in', emphasis: 'nod', exit: 'fade-out', energy: 0.3 }) : ({
        intro: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.82, anticipate: true },
        point: { enter: 'rise-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.62 },
        stat: { enter: 'pop-in', emphasis: 'punch', exit: 'shrink-out', energy: 0.78 },
        quote: { enter: 'fade-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.48 },
        cta: { enter: 'slide-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.58 },
    }[kind] || { enter: 'rise-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.55 });
    const motionFor = (technique, kind) => {
        const motion = technique?.motion || fallbackMotion(kind);
        if (!restrainedMotion) return motion;
        const maxEnergy = calmStyle ? 0.38 : 0.58;
        return {
            ...motion,
            enter: ['fade-in', 'rise-in', 'word-reveal', 'blur-in'].includes(motion.enter) ? motion.enter : 'rise-in',
            emphasis: ['nod', 'pulse'].includes(motion.emphasis) ? motion.emphasis : 'nod',
            exit: 'fade-out',
            energy: Math.min(maxEnergy, (Number(motion.energy) || maxEnergy) * (Number(referencePlan?.motionScale) || 1)),
            anticipate: false,
        };
    };
    const beat = (kind, text, kicker, technique) => ({
        kind,
        text,
        ...(kicker ? { kicker } : {}),
        ...(technique?.name ? { technique: technique.name } : {}),
        motion: motionFor(technique, kind),
    });
    const beats = [beat('intro', title, null, introTechnique)];
    // Only fold a point into the opening sequence if it is spoken near the
    // opening. Later transcript beats stay at their real timeline position.
    if (pointSegment && Number(duration) >= 8 && Number(pointSegment.start) <= Math.min(4, Number(duration) * 0.22)) {
        beats.push(beat('point', pointSegment.text, '01', pointTechnique));
    }

    // A few timed supporting scenes use the speaker's real words at their
    // transcript positions. Numbers already have their own StatCallout path;
    // these scenes focus on contrast, reveal, process, and personal insight.
    const cues = [
        { kind: 'quote', pattern: /\b(i|we|they|je|nous|on)\s+(learned|realized|remember|found out|used to|had to|compris|découvert|retenu|appris)\b|\bje me suis rendu compte\b/ },
        { kind: 'point', pattern: /\b(but|because|instead|the reason|the truth|the key|the lesson|step|first|finally|changed|mais|parce que|plutôt|la raison|la vérité|la clé|la leçon|étape|d'abord|enfin|changé)\b/ },
        { kind: 'point', pattern: /\b(works|failed|mistake|difference|result|secret|important|marche|fonctionne|échoué|erreur|différence|résultat|secret|important)\b/ },
    ];
    const timedMoments = [];
    const maxTimedMoments = Math.max(1, Math.min(5, Math.floor((Number(duration) || 0) / 7)));
    for (const cue of cues) {
        if (timedMoments.length >= maxTimedMoments) break;
        const candidate = segments.find(segment => segment.start > 2
            && segment.start < Number(duration) - 1.5
            && cue.pattern.test(segment.text.toLowerCase())
            && !timedMoments.some(moment => Math.abs(moment.start - segment.start) < 2.5)
            && !segment.text.toLowerCase().includes(title.toLowerCase()));
        if (!candidate) continue;
        const technique = chooseTechnique(cue.kind, candidate.text, [introTechnique?.name, pointTechnique?.name]);
        timedMoments.push({
            kind: cue.kind,
            text: candidate.text,
            start: Math.max(0, Number(candidate.start) || 0),
            end: Math.min(Number(duration) || Number(candidate.end), Number(candidate.end) || 0),
            ...(technique?.name ? { technique: technique.name } : {}),
            motion: motionFor(technique, cue.kind),
        });
    }
    if (pointSegment && Number(pointSegment.start) > Math.min(4, Number(duration) * 0.22)
        && pointSegment.start < Number(duration) - 1.5
        && timedMoments.length < maxTimedMoments
        && !timedMoments.some(moment => Math.abs(moment.start - pointSegment.start) < 2.5)) {
        timedMoments.push({
            kind: 'point',
            text: pointSegment.text,
            start: Math.max(0, Number(pointSegment.start) || 0),
            end: Math.min(Number(duration) || Number(pointSegment.end), Number(pointSegment.end) || 0),
            ...(pointTechnique?.name ? { technique: pointTechnique.name } : {}),
            motion: motionFor(pointTechnique, 'point'),
        });
    }

    // Semantic events add visual evidence from the footage analysis to the
    // transcript-driven story. Match each event to the nearest spoken phrase
    // and retain the real event time even when a phrase falls back to words.
    const eventKinds = { REVEAL: 'point', PUNCHLINE_DETECTED: 'quote', EMPHASIS_MOMENT: 'point' };
    const semanticEvents = (Array.isArray(events) ? events : [])
        .filter(event => MOMENT_TYPES.has(event?.eventType))
        .map(event => {
            const at = Number(event.timelineTime ?? event.start ?? event.time);
            if (!Number.isFinite(at) || at < 2 || at >= Number(duration) - 1.5) return null;
            const nearest = segments
                .map(segment => ({ segment, distance: Math.abs(Number(segment.start) - at) }))
                .sort((a, b) => a.distance - b.distance)[0];
            if (nearest && nearest.distance <= 2.4) return { event, at, text: nearest.segment.text };
            const phrase = phraseFromWords(timedWords, at, { upper: false, span: 1.2, maxWords: 7 });
            return phrase ? { event, at, text: cleanText(phrase) } : null;
        })
        .filter(Boolean)
        .sort((a, b) => (Number(b.event.confidence) || 0) - (Number(a.event.confidence) || 0) || a.at - b.at);
    for (const candidate of semanticEvents) {
        if (timedMoments.some(moment => Math.abs(moment.start - candidate.at) < 2.5)) continue;
        if (candidate.text.toLowerCase().includes(title.toLowerCase())) continue;
        if (timedMoments.length >= maxTimedMoments) {
            // A high-confidence visual event carries evidence about the
            // footage. Let it replace a generic transcript pick, while
            // retaining explicit phrase matches and their real speech times.
            const replaceIndex = timedMoments.findIndex(moment => !moment.sourceEvent);
            if (replaceIndex < 0) break;
            timedMoments.splice(replaceIndex, 1);
        }
        const kind = /\d/.test(candidate.text) ? 'stat' : eventKinds[candidate.event.eventType] || 'point';
        const technique = chooseTechnique(kind, candidate.text, [introTechnique?.name, pointTechnique?.name]);
        timedMoments.push({
            kind, text: candidate.text, start: candidate.at,
            end: Math.min(Number(duration), candidate.at + 1.8),
            ...(technique?.name ? { technique: technique.name } : {}),
            motion: motionFor(technique, kind),
            sourceEvent: candidate.event.eventType,
        });
    }

    // Fill remaining scene slots from the strongest transcript segments:
    // figures, story turns, and phrases that add new meaning beyond the hook.
    // Timing stays tied to speech and the scene count scales with duration.
    const rankedSegments = segments
        .filter(segment => segment.start > 2 && segment.start < Number(duration) - 1.5)
        .filter(segment => !timedMoments.some(moment => Math.abs(moment.start - segment.start) < 2.5))
        .map(segment => {
            const text = segment.text.toLowerCase();
            const tokens = wordsOf(text);
            const hasNumber = /\b\d+(?:[.,]\d+)?\s*(?:%|percent|pour cent|euros?|dollars?|€|\$)?\b/i.test(text);
            const hasStoryCue = /\b(why|how|because|but|so|then|finally|realized|learned|changed|result|mistake|lesson|pourquoi|comment|parce que|mais|donc|ensuite|enfin|compris|appris|changé|résultat|erreur|leçon)\b/i.test(text);
            const novelty = tokens.filter(token => !titleWords.has(token) && !STOP.has(token)).length;
            return { segment, kind: hasNumber ? 'stat' : /\b(i|we|je|nous|on)\b/i.test(text) ? 'quote' : 'point', score: (hasNumber ? 5 : 0) + (hasStoryCue ? 3 : 0) + Math.min(4, novelty) };
        })
        .sort((a, b) => b.score - a.score || a.segment.start - b.segment.start);
    for (const candidate of rankedSegments) {
        if (timedMoments.length >= maxTimedMoments) break;
        if (candidate.score < 2) continue;
        const segment = candidate.segment;
        const technique = chooseTechnique(candidate.kind, segment.text, [introTechnique?.name, pointTechnique?.name]);
        timedMoments.push({
            kind: candidate.kind,
            text: segment.text,
            start: Math.max(0, Number(segment.start) || 0),
            end: Math.min(Number(duration) || Number(segment.end), Number(segment.end) || 0),
            ...(technique?.name ? { technique: technique.name } : {}),
            motion: motionFor(technique, candidate.kind),
        });
    }
    timedMoments.sort((a, b) => a.start - b.start);

    // Only create a closing card when the speaker actually says a CTA.
    const close = segments.slice().reverse().find(segment =>
        /\b(follow|subscribe|share|comment|download|sign up|book|buy|try it|learn more|abonnez-vous|abonne-toi|partagez|partage|commentez|commente|téléchargez|télécharge|inscrivez-vous|inscris-toi|achetez|achète|essayez|essaie|découvrez|découvre|lien en bio)\b/i.test(segment.text)
    );
    if (close && Number(duration) >= 8) {
        const ctaText = close.text.length <= 48 ? close.text : cleanText(close.text.split(/\b(?:and|because|but)\b/i)[0]);
        beats.push(beat('cta', ctaText, null, chooseTechnique('cta', ctaText, [introTechnique?.name, pointTechnique?.name])));
    }
    // Keep these cues semantic and sparse. The caller resolves them to actual
    // licensed library sounds and applies the editing style's volume limits.
    const sfxCues = [];
    if (!calmStyle && beats.length && Number(duration) > 1) sfxCues.push({ t: 0.08, kind: (introTechnique?.motion || fallbackMotion('intro')).enter === 'slam-in' ? 'impact' : 'whoosh', sourceId: 'fallback-intro' });
    for (const moment of timedMoments) {
        if (calmStyle) break;
        const kind = moment.kind === 'stat' ? 'pop' : moment.kind === 'quote' ? 'whoosh' : 'pop';
        if (!sfxCues.some(cue => Math.abs(cue.t - moment.start) < 0.65)) sfxCues.push({ t: Math.max(0, moment.start - 0.03), kind, sourceId: `fallback-${moment.kind}` });
    }
    if (!calmStyle && close && Number(duration) >= 8 && !sfxCues.some(cue => Math.abs(cue.t - Number(close.start)) < 0.65)) {
        sfxCues.push({ t: Math.max(0, Number(duration) - 1.8), kind: 'whoosh', sourceId: 'fallback-cta' });
    }
    const brollMoments = timedMoments
        .filter(moment => moment.kind !== 'quote' && wordsOf(moment.text).length >= 3)
        .slice(0, 2)
        .map(moment => {
            const queryTokens = new Set(tokensOf(moment.text));
            const matches = visuals.filter(item => item.isBroll && !item.hasMainSpeaker).map(item => {
                const profileTokens = tokensOf([item.contentDescription, item.suggestedLabel, item.sceneType, item.locationType].filter(Boolean).join(' '));
                const overlap = profileTokens.filter(token => queryTokens.has(token)).length;
                return { item, overlap };
            }).filter(match => match.overlap > 0).sort((a, b) => b.overlap - a.overlap);
            return {
                start: moment.start,
                end: moment.end,
                query: moment.text,
                kind: moment.kind,
                ...(matches.length ? { assetIds: matches.slice(0, 3).map(match => match.item.assetId).filter(Boolean) } : {}),
            };
        });
    const visualSummary = [...new Set(visuals.flatMap(item => [item.sceneType, item.locationType, item.emotionalTone].filter(Boolean)))].slice(0, 8);
    return {
        tone, beats, timedMoments, sfxCues, brollMoments,
        ...(referencePlan ? { referenceStyleApplied: {
            motionEnergy: referencePlan.motionEnergy,
            visualTone: referencePlan.visualTone,
            transitionPacing: referencePlan.transitionPacing,
        } } : {}),
        ...(visualSummary.length ? { visualSummary } : {}),
        source: 'local-fallback',
    };
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
 *          `scenePlan` is the local transcript/visual/Motion-KB result used by
 *          Pro Finish. It can also accept a caller-supplied directed plan.
 * @returns {{tracks:Array, duration:number, aspectRatio:string, applied:string[]}}
 */
export function polishShort(built, profile, opts = {}) {
    const baseLook = POLISH_LOOK[profile?.id] || POLISH_LOOK.tiktok;
    const referenceStyle = buildStyleReferencePlan(opts.referenceStyleProfile);
    const look = referenceStyle ? {
        ...baseLook,
        ...(referenceStyle.recipe ? { recipe: referenceStyle.recipe } : {}),
        ...(referenceStyle.titleComponent ? { titleComponent: referenceStyle.titleComponent } : {}),
        ...(referenceStyle.titlePreset ? { titlePreset: referenceStyle.titlePreset } : {}),
        ...(referenceStyle.accent ? { accent: referenceStyle.accent } : {}),
        ...(referenceStyle.textColor ? { titleColor: referenceStyle.textColor } : {}),
        cameraEnergy: Math.max(0.2, Math.min(0.9, baseLook.cameraEnergy * referenceStyle.motionScale)),
    } : baseLook;
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
    // The hook's ACTUAL on-screen span. `hookDur` above is the budget for ONE
    // title, which is what the hook has always been; a directed sequence of
    // two beats needs more room, and the sections below (captions, moment
    // graphics, the CTA collision check) must all key off what the hook really
    // occupies rather than recomputing the single-title formula -- otherwise a
    // stretched hook silently overlaps the captions again.
    let hookSpan = hookDur;
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
        // rule -- "never invent claims". Pro Finish callers provide a local
        // transcript-grounded plan when AI is unavailable, so this same
        // composition path can still produce measured motion beats without
        // making up on-screen copy.
        const scenePlan = opts.scenePlan && typeof opts.scenePlan === 'object' ? opts.scenePlan : null;

        // R103 -- PASS THE PLAN'S OWN BEATS THROUGH, do not rebuild them.
        //
        // This block used to synthesise its own beats from `scenePlan.title`
        // and `scenePlan.points[0]`, which silently discarded every other
        // field the beat carried -- including `motion`, which is where a
        // knowledge-base technique's verbs live after the route resolved them
        // (motionRoutes.cleanBeat). The result looked completely correct in
        // review and in every unit test: a designed multi-beat hook appeared,
        // the plan was consulted, nothing errored. But `beat.motion` was never
        // set, so SceneComposer.resolveLook fell back to the look's own motion
        // every single time, and the entire technique library was inert on the
        // one path that matters. Caught by test_pro_finish_chain.mjs asserting
        // the verb on the CLIP (`composed:slam-in`) rather than anywhere
        // upstream of it.
        //
        // So: when the plan has beats, those beats ARE the hook. Only the
        // closing beats are held back, because section 1b places those at the
        // end of the short rather than inside the hook window.
        const planBeats = Array.isArray(scenePlan?.beats) ? scenePlan.beats : [];
        const usable = (b) => !!(b && (
            (typeof b.text === 'string' && b.text.trim())
            || (b.kind === 'stat' && typeof b.value === 'string' && b.value.trim())
        ));
        const openingBeats = planBeats.filter(b => b.kind !== 'cta' && b.kind !== 'outro').filter(usable);
        // Fall back to the flat title/points shape for a plan that has no
        // beats array (an older response, or the rules path).
        const flatBeats = scenePlan && openingBeats.length === 0 ? [
            { kind: 'intro', text: (scenePlan.title && String(scenePlan.title).trim()) || null },
            ...(scenePlan.points?.[0] ? [{ kind: 'point', text: String(scenePlan.points[0]).trim(), kicker: '01' }] : []),
        ].filter(usable) : [];
        // One beat unless the hook budget can actually hold two: beats share
        // `hookDur` between them, so a second beat halves the time the first
        // one is readable.
        // Two beats when the plan has two and the short can afford them.
        //
        // This used to gate on `hookDur > 3.2`, which looked reasonable and was
        // unreachable: `hookDur` tops out at `hookSeconds + 1.4`, so the
        // ceiling is 2.9s on TikTok and 2.4s on Shorts. The second beat could
        // therefore only ever appear on Reels -- a dead path on two of three
        // platforms, which is the failure class CLAUDE.md keeps counting.
        //
        // Squeezing two beats into the one-title budget is the wrong fix: at
        // ~1.2s each neither is readable. So the window stretches instead,
        // bounded so the hook can never eat half the short.
        const offered = openingBeats.length > 0 ? openingBeats : flatBeats;
        const roomForTwo = offered.length > 1 && duration >= 8;
        const introBeats = offered.slice(0, roomForTwo ? 2 : 1).map(beat => ({
            ...beat,
            // The designed-scene path must keep the same per-platform title
            // casing as the legacy title component: TikTok/Shorts are set in
            // uppercase, while Reels keeps sentence case.
            ...(look.upper && scenePlan?.source === 'local-fallback' && typeof beat.text === 'string'
                ? { text: beat.text.toUpperCase() }
                : {}),
        }));
        if (introBeats.length > 1) hookSpan = Math.min(duration * 0.45, hookDur * 1.8);

        let hookApplied = false;
        if (introBeats.length) {
            const designed = composeSceneFromBrief(
                'A punchy short-form hook: open strong and surface the single most important point.',
                {
                    plan: { beats: introBeats },
                    tone: scenePlan?.tone || 'viral',
                    duration: hookSpan,
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
                    const direction = scenePlan?.source === 'local-fallback' ? 'local scene planner' : 'AI-directed';
                    applied.push(`hook sequence (${introBeats.length} beat${introBeats.length > 1 ? 's' : ''}, ${direction})`);
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
    // of the short, when the local scene plan finds one in the transcript.
    // Nothing filled this
    // gap before: the hook title and the moment graphics in section 4 never
    // covered the close of a short. Skipped outright when the short is too
    // short to fit both the hook and a CTA without them overlapping.
    // Prefer the planner's closing beat, with its selected motion technique,
    // over a beat synthesised from `scenePlan.cta`.
    const planCtaBeat = (Array.isArray(opts.scenePlan?.beats) ? opts.scenePlan.beats : [])
        .find(b => (b?.kind === 'cta' || b?.kind === 'outro') && typeof b.text === 'string' && b.text.trim());
    const ctaBeat = planCtaBeat
        || (opts.scenePlan?.cta ? { kind: 'cta', text: String(opts.scenePlan.cta).trim() } : null);
    if (want.title && ctaBeat) {
        const ctaDur = Math.max(1.2, Math.min(2.2, duration * 0.12));
        const ctaStart = Math.max(0, duration - ctaDur);
        if (ctaStart > hookSpan + 0.2) {
            const designed = composeSceneFromBrief(
                'A short, direct call to action to close a short-form video.',
                {
                    plan: { beats: [ctaBeat] },
                    tone: opts.scenePlan?.tone || 'viral',
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
    const captionPack = referenceStyle?.captionPack || profile?.captionPack;
    if (want.captions && captionPack) {
        const baseFields = stylePackToClipFields(captionPack) || {};
        const fields = referenceStyle ? {
            ...baseFields,
            ...(referenceStyle.textColor ? { color: referenceStyle.textColor } : {}),
            captionStyle: {
                ...(baseFields.captionStyle || {}),
                wordHighlight: {
                    ...(baseFields.captionStyle?.wordHighlight || {}),
                    ...(referenceStyle.accent ? { color: referenceStyle.accent } : {}),
                },
            },
        } : baseFields;
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
        // hookSpan, not a third copy of the budget formula: a directed
        // two-beat hook runs longer than one title, and a caption keyed off
        // the old formula would start overlapping it partway through.
        const hookDurForCaptions = want.title ? hookSpan : 0;
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
        const hookEnd = want.title ? hookSpan : 0;
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

    // The local planner schedules transcript-led scenes
    // across the body of the short. Keep them tied to their spoken words,
    // avoid number/reveal callouts already placed above, and use the same
    // scene director so each beat gets coordinated text, graphic accents,
    // safe placement, and motion.
    if (want.title && Array.isArray(opts.scenePlan?.timedMoments)) {
        let textN = 0, gfxN = 0, count = 0;
        const naturalSceneCap = Math.max(1, Math.min(5, Math.floor(duration / 7)));
        const maxTimedScenes = referenceStyle
            ? Math.min(naturalSceneCap, referenceStyle.graphicsMax)
            : naturalSceneCap;
        const timed = opts.scenePlan.timedMoments
            .filter(m => m && typeof m.text === 'string' && m.text.trim())
            .filter(m => Number(m.start) >= (want.title ? hookSpan : 0) + 0.4 && Number(m.start) < duration - 1)
            .filter(m => !spokenNumbers(words).some(n => Math.abs(n.t - Number(m.start)) < 2.2))
            .filter(m => !moments.some(event => Math.abs(Number(event.timelineTime) - Number(m.start)) < 1.8))
            .sort((a, b) => Number(a.start) - Number(b.start))
            .slice(0, maxTimedScenes);
        for (const moment of timed) {
            const at = Math.max(0, Math.min(duration - 0.5, Number(moment.start) || 0));
            const sceneDuration = Math.max(0.8, Math.min(1.8, duration - at));
            const designed = composeSceneFromBrief('A concise transcript-grounded supporting graphic for a short-form video.', {
                plan: { beats: [{
                    kind: moment.kind === 'quote' ? 'quote' : 'point',
                    text: moment.text,
                    ...(moment.kicker ? { kicker: moment.kicker } : {}),
                    ...(moment.technique ? { technique: moment.technique } : {}),
                    ...(moment.motion ? { motion: moment.motion } : {}),
                }] },
                tone: opts.scenePlan?.tone || 'viral',
                duration: sceneDuration,
                aspectRatio: built?.aspectRatio || '9:16',
                safeZone: profile?.safeZone,
                subject: SYNTHETIC_SPEAKER_SUBJECT,
                palette: { accent: look.accent, text: look.titleColor },
            });
            if (!designed?.scene) continue;
            const { placements } = flattenScene(designed.scene, { startOffset: at });
            for (const p of placements) {
                const isText = p.trackType === 'text';
                const t = trackOf(tracks, isText ? 'text' : 'overlay', isText ? 'track-short-moments' : 'track-short-graphics', isText ? 'Moments' : 'Short graphics');
                const id = isText ? `short-timed-text-${textN++}` : `short-timed-gfx-${gfxN++}`;
                t.clips.push({ ...p.clip, id });
            }
            if (placements.length) count += 1;
        }
        if (count) applied.push(`timed story graphics (${count})`);
    }

    // 4b. Contextual vector illustrations. Only add an icon when the scene
    // text names a subject supported by the vector library; avoid generic
    // decorative icons that would add noise without explaining the beat.
    if (want.title && Array.isArray(opts.scenePlan?.timedMoments)) {
        const treatment = profile?.id === 'tiktok' ? 'burst' : 'badge';
        const background = treatment === 'burst' ? 'radial-burst' : 'gradient-orb';
        const accent = look.accent;
        const picks = [];
        for (const moment of opts.scenePlan.timedMoments) {
            const at = Number(moment?.start);
            if (!Number.isFinite(at) || at < hookSpan + 0.4 || at >= duration - 0.8) continue;
            const icon = iconFromText(moment.text);
            if (!icon || picks.some(item => item.icon === icon || Math.abs(item.start - at) < 5)) continue;
            if (!VECTOR_ILLUSTRATIONS.some(item => item.icon === icon && item.treatment === treatment)) continue;
            picks.push({ icon, start: at });
            if (picks.length >= 3) break;
        }
        if (picks.length) {
            const track = trackOf(tracks, 'overlay', 'track-short-illustrations', 'Illustrations');
            picks.forEach((item, index) => {
                const params = { icon: item.icon, treatment, background, accent };
                const size = templateSize('icon', params);
                const clip = {
                    id: `short-illustration-${index}`,
                    type: 'template', name: `${item.icon} illustration`,
                    template: { kind: 'icon', params },
                    metadata: { resolution: { w: size.w, h: size.h } },
                    start: item.start, duration: Math.min(2.2, duration - item.start),
                    x: index % 2 ? 18 : 82, y: 24, scale: 1, rotation: 0, opacity: 1,
                };
                Object.assign(clip, applyPresetToClip(clip, 'stkr-float-up', { intensity: 0.42 }));
                track.clips.push(clip);
            });
            applied.push(`contextual vector illustrations (${picks.length})`);
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
                // A successful mask file can still contain no detected
                // person. Do not call that a speaker pop-out or dim the
                // entire frame in that case.
                if (Array.isArray(c.layerMask.bboxTrack) && c.layerMask.bboxTrack.length === 0) continue;
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

export default { POLISH_LOOK, headlineFromText, fallbackShortScenePlan, spokenNumbers, emphasisIndices, phraseFromWords, polishShort, shiftToShort };
