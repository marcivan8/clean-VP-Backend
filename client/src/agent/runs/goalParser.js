/**
 * client/src/agent/runs/goalParser.js — one sentence -> a goal with checkable
 * success criteria (R176b, layer 2). Pure, no model call.
 *
 * "Make three TikToks from this podcast under 60 s with captions in our brand
 * colours" becomes:
 *   { kind: 'shorts_from_long_video', params: { count: 3, platforms: ['tiktok'],
 *     maxSeconds: 60, ... }, criteria: { count: 3, maxSeconds: 60,
 *     captions: true, brand: true, platforms: ['tiktok'] } }
 *
 * Only what the sentence actually says becomes a criterion: a request that
 * names no length is not judged on length. Conservative on purpose: anything
 * that is not clearly a request for several shorts returns null and goes
 * through the normal command pipeline ("make it short" trims, "a short intro"
 * adds a title, "make a short" keeps one moment in place: R93).
 */
import { platformsFromText, shortCountFromText } from '../PlatformProfiles.js';
import { GOAL_KINDS, createGoal, MAX_SHORTS } from './goalContract.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Plural deliverables (or a platform name used as a noun), with a making verb.
const DELIVERABLE = /\b(shorts|reels|tik ?toks|clips|short videos|vertical videos|extraits|courtes videos|videos courtes)\b/;
const VERB = /\b(make|create|cut|turn|repurpose|generate|give me|get me|extract|produce|build|fais|faire|cree|creer|decoupe|decouper|genere|generer|transforme|transformer|tire|tirer)\b/;
const INTO = /\b(into|en)\s+(\d+\s+|several\s+|plusieurs\s+|des\s+)?(shorts|reels|tik ?toks|clips)\b/;

/** "under 60 s", "less than a minute", "max 45 seconds", "moins de 30 s" -> seconds, or null. */
export function maxSecondsFromText(text) {
    const s = fold(text);
    if (/\b(under|less than|below|shorter than|moins d'?une?|en dessous d'?une?)\s+(a|one|1|une)\s+min(ute)?s?\b/.test(s)) return 60;
    const unit = '(s|sec|secs|second|seconds|seconde|secondes|min|mins|minute|minutes)';
    const cap = s.match(new RegExp(`\\b(?:under|less than|below|shorter than|at most|max(?:imum)?|up to|no (?:more|longer) than|moins de|au plus|maximum|pas plus de|max)\\s*(\\d{1,3})\\s*${unit}\\b`))
        || s.match(new RegExp(`\\b(\\d{1,3})\\s*${unit}\\s*(?:max(?:imum)?|or less|tops|ou moins|maxi)\\b`));
    if (!cap) return null;
    const n = Number(cap[1]);
    const secs = /^min/.test(cap[2]) ? n * 60 : n;
    return secs >= 10 && secs <= 180 ? secs : null;
}

/** true when captions are asked for, false when refused, null when not mentioned. */
export function captionsFromText(text) {
    const s = fold(text);
    if (/\b(no|without|sans|pas de)\s+(captions?|subtitles?|sous-?titres?)\b/.test(s)) return false;
    if (/\b(captions?|subtitles?|sous-?titres?|captioned)\b/.test(s)) return true;
    return null;
}

/** "in our brand colours", "on brand", "brand kit", "couleurs de la marque". */
export function brandFromText(text) {
    const s = fold(text);
    return /\b(brand(ed)?|on-brand|our colou?rs|my colou?rs|brand colou?rs|brand kit|charte( graphique)?|couleurs de (la |ma |notre )?marque|nos couleurs|mes couleurs)\b/.test(s);
}

/**
 * Does the request also ask for the shorts to be posted? "...and schedule them
 * through the week", "post them this week", "publish one a day", "programme-les
 * sur la semaine". Conservative: posting needs a posting verb AND either "them"
 * or a time frame, so "make shorts I can post" stays a plain shorts goal.
 */
export function wantsPosting(text) {
    const s = fold(text);
    const verb = /\b(schedule|post|publish|plan|queue|programme|programmer|programmez|planifie|planifier|publie|publier|poste|poster)\b/;
    if (!verb.test(s)) return false;
    const them = /\b(schedule|post|publish|queue|plan) (them|it|those|these)\b|\b(programme|planifie|publie|poste)[sz]?-?(les|la)\b|\bles (programmer|planifier|publier|poster)\b/;
    const frame = /\b(through(out)? the week|this week|over the week|next week|one (a|per) day|daily|every day|each day|sur la semaine|cette semaine|la semaine prochaine|un par jour|chaque jour|tous les jours)\b/;
    return them.test(s) || (verb.test(s) && frame.test(s));
}

/** Is this sentence a request to turn the video into several shorts? */
export function isShortsGoalRequest(text) {
    const s = fold(text);
    if (!s.trim()) return false;
    if (INTO.test(s)) return true;
    if (!VERB.test(s)) return false;
    if (DELIVERABLE.test(s)) return true;
    // "one short for each platform" / "un short par plateforme".
    if (/\b(one|a|1|un|une)\s+(short|reel|clip|tik ?tok|video)\s+(for each|per|par|pour chaque)\b/.test(s)) return true;
    // A count with "short"/"tiktok" ("make 3 short", "3 tiktok") is plural in intent.
    return /\b(\d{1,2}|two|three|four|five|deux|trois|quatre|cinq)\s+(short|tik ?tok|reel|clip)s?\b/.test(s);
}

/**
 * Parse a request into a goal. Returns null when it is not a shorts goal.
 * @param {string} text
 * @param {{ totalDuration?: number, defaultCount?: number, finish?: object }} [ctx]
 */
export function parseShortsGoal(text, ctx = {}) {
    if (!isShortsGoalRequest(text)) return null;
    const platforms = platformsFromText(text);
    const tiktokNoun = /\btik ?toks?\b/i.test(String(text)) && !platforms.includes('tiktok') ? ['tiktok'] : [];
    const named = [...platforms, ...tiktokNoun];
    const explicitCount = shortCountFromText(text);
    const eachPlatform = /\b(one|a|1|un|une)(\s+(short|reel|clip|tik ?tok|video))?\s+(for each|per|par|pour chaque)\b/i.test(fold(text)) && named.length > 1;
    const count = Math.min(MAX_SHORTS, eachPlatform ? named.length : (explicitCount ?? ctx.defaultCount ?? 3));
    const maxSeconds = maxSecondsFromText(text);
    const captions = captionsFromText(text);
    const brand = brandFromText(text);

    const post = wantsPosting(text);
    const built = createGoal(post ? GOAL_KINDS.SHORTS_TO_POSTS : GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, {
        count,
        platforms: named,
        maxSeconds,
        finish: {
            ...(ctx.finish || {}),
            // A brand request needs the hook title on: it is the element that
            // carries the brand look. Captions follow the request when it says.
            ...(brand ? { brandTitle: true } : {}),
        },
        criteria: {
            count: explicitCount != null || eachPlatform ? count : null,
            maxSeconds,
            captions,
            brand,
            platforms: named.length ? named : null,
        },
        request: String(text).trim().slice(0, 300),
    });
    return built.ok ? built.goal : null;
}

export default { parseShortsGoal, isShortsGoalRequest, wantsPosting, maxSecondsFromText, captionsFromText, brandFromText };
