/**
 * client/src/agent/ScriptSegmenter.js
 *
 * R132 — script-to-video, Slice 1: turns a plain-text narration script into
 * an ordered list of shots, each with an estimated spoken duration and a
 * stock-search query — the piece `claude/script-to-video-scoping-R132.md`
 * flagged as genuinely missing (SceneDirector.planFromBrief is tuned for a
 * short motion-graphics brief, not a multi-paragraph script).
 *
 * Deliberately has no AI-provider dependency: pure, deterministic, and
 * independently testable without a network call or an API key. A keyword
 * extractor this simple will sometimes produce a mediocre search query for
 * an abstract sentence — acceptable for a first slice, and nothing here
 * blocks swapping in an LLM-derived query later without touching callers
 * (segmentScript's shape stays the same either way).
 */

export const WORDS_PER_MINUTE = 150;
export const MIN_SHOT_DURATION_S = 3;
export const MAX_SHOT_DURATION_S = 8;
export const MAX_STOCK_QUERY_WORDS = 4;

// Small, deliberately conservative stoplist — just enough to keep the most
// common function words out of a search query. Not meant to be exhaustive;
// a word surviving this list that shouldn't (or vice versa) just shifts
// search quality, it never breaks anything structurally.
const STOPWORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'so', 'yet', 'for', 'nor',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'do', 'does', 'did', 'have', 'has', 'had',
    'to', 'of', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'onto',
    'as', 'it', 'its', 'this', 'that', 'these', 'those',
    'i', 'you', 'we', 'they', 'he', 'she', 'them', 'us', 'our', 'your', 'my', 'his', 'her',
    'can', 'will', 'would', 'could', 'should', 'just', 'not', 'no',
    'than', 'then', 'there', 'here', 'what', 'when', 'where', 'how', 'why',
    'up', 'down', 'out', 'about', 'if', 'all', 'some', 'very', 'really',
]);

/**
 * Splits raw script text into sentences, then greedily groups consecutive
 * short sentences together so no shot is shorter than MIN_SHOT_DURATION_S
 * (a 2-word sentence on its own screen for under a second reads as a
 * flicker, not a shot) while never exceeding MAX_SHOT_DURATION_S for a
 * single group — a sentence longer than that on its own is kept whole
 * rather than being cut mid-thought; its duration is simply allowed past
 * the nominal max.
 *
 * @param {string} script
 * @returns {Array<{index:number, text:string, words:number, estimatedDuration:number, stockQuery:string}>}
 */
export function segmentScript(script, opts = {}) {
    const wpm = Number(opts.wordsPerMinute) > 0 ? Number(opts.wordsPerMinute) : WORDS_PER_MINUTE;
    const clean = String(script || '').trim();
    if (!clean) return [];

    // Split on sentence-ending punctuation, keeping the punctuation on the
    // sentence it closes. Collapses internal whitespace/newlines first so a
    // script pasted with line breaks mid-sentence doesn't fragment oddly.
    const normalized = clean.replace(/\s+/g, ' ');
    const rawSentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [normalized];
    const sentences = rawSentences.map(s => s.trim()).filter(Boolean);
    if (sentences.length === 0) return [];

    const wordCount = (s) => (s.match(/\S+/g) || []).length;
    const durationFor = (words) => (words / wpm) * 60;

    const shots = [];
    let bucket = [];
    let bucketWords = 0;

    const flush = () => {
        if (bucket.length === 0) return;
        const text = bucket.join(' ');
        const words = bucketWords;
        shots.push({
            index: shots.length,
            text,
            words,
            estimatedDuration: Math.max(MIN_SHOT_DURATION_S, durationFor(words)),
            stockQuery: extractStockQuery(text),
        });
        bucket = [];
        bucketWords = 0;
    };

    for (const sentence of sentences) {
        const words = wordCount(sentence);
        const sentenceDuration = durationFor(words);

        // A single sentence already at/over the max stands alone, whatever
        // is currently in the bucket.
        if (sentenceDuration >= MAX_SHOT_DURATION_S) {
            flush();
            bucket = [sentence];
            bucketWords = words;
            flush();
            continue;
        }

        // Adding this sentence would push the bucket past the max — close
        // the current bucket first, then start a new one with it.
        if (bucket.length > 0 && durationFor(bucketWords + words) > MAX_SHOT_DURATION_S) {
            flush();
        }

        bucket.push(sentence);
        bucketWords += words;
    }
    flush();

    return shots;
}

/**
 * Deterministic keyword extraction for a stock-search query: strips
 * stopwords and punctuation, keeps the longest remaining words (a crude but
 * effective proxy for "most distinctive"), capped to MAX_STOCK_QUERY_WORDS
 * so the query stays a short phrase rather than the whole sentence (stock
 * APIs match far better on 2-4 keywords than on full prose).
 *
 * @param {string} text
 * @returns {string}
 */
export function extractStockQuery(text) {
    const words = String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s'-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter(w => !STOPWORDS.has(w) && w.length > 1);

    if (words.length === 0) {
        return String(text || '').trim().slice(0, 40) || 'abstract concept';
    }

    // Longest-first is a simple, deterministic distinctiveness proxy, then
    // de-duplicated, then restored to the order they appeared in the
    // sentence (reads more like a coherent phrase to a search API than a
    // bag of words sorted by length).
    const uniqueByLength = [...new Set(words)].sort((a, b) => b.length - a.length);
    const chosen = new Set(uniqueByLength.slice(0, MAX_STOCK_QUERY_WORDS));
    const ordered = words.filter(w => chosen.has(w));
    const deduped = [...new Set(ordered)];

    return deduped.join(' ');
}
