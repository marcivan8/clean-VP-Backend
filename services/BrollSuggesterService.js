'use strict';

/**
 * services/BrollSuggesterService.js
 *
 * Context-Aware Stock B-Roll Suggestion Engine for VIBED (Level 2).
 *
 * Extracts visual concepts and scene context from transcript segments and
 * generates targeted stock footage suggestions at relevant timestamps.
 *
 * Enables the creator approval workflow:
 *   - Each suggestion provides: timestamp, duration, dialogue quote, reason,
 *     primary suggested asset, and alternate candidate assets.
 *   - The creator can approve (+ cutaway on timeline), reject (dismiss),
 *     or replace (switch to alternate footage or refine query).
 */

const { pexelsService } = require('./PexelsService');
const { vecteezyService } = require('./VecteezyService');

function getActiveStockService() {
    const pref = String(process.env.STOCK_PROVIDER || '').toLowerCase().trim();
    if (pref === 'vecteezy' && vecteezyService.isConfigured()) return vecteezyService;
    if (pref === 'pexels' && pexelsService.isConfigured()) return pexelsService;
    if (vecteezyService.isConfigured()) return vecteezyService;
    if (pexelsService.isConfigured()) return pexelsService;
    return pref === 'pexels' ? pexelsService : vecteezyService;
}

// Stopwords to ignore when scanning for visual concepts
const VISUAL_STOPWORDS = new Set([
    'about', 'above', 'across', 'actually', 'after', 'again', 'against', 'almost',
    'along', 'already', 'also', 'although', 'always', 'among', 'another', 'around',
    'basically', 'because', 'been', 'before', 'behind', 'being', 'below', 'between', 'both',
    'could', 'during', 'either', 'enough', 'every', 'everyone', 'everything', 'everywhere',
    'first', 'from', 'going', 'gonna', 'have', 'having', 'inside', 'instead', 'itself', 'literally',
    'maybe', 'might', 'myself', 'never', 'nothing', 'nowhere', 'often', 'perhaps',
    'really', 'should', 'since', 'somebody', 'someone', 'something', 'sometimes', 'somewhere',
    'still', 'that', 'their', 'them', 'themselves', 'there', 'therefore', 'these', 'they',
    'theyre', 'thing', 'things', 'this', 'those', 'though', 'through', 'together',
    'toward', 'towards', 'under', 'until', 'wanna', 'welcome', 'were', 'what', 'whatever',
    'when', 'whenever', 'where', 'wherever', 'whether', 'which', 'while', 'with', 'without',
    'would', 'youre', 'weve', 'youve',
]);

// Strong visual seed categories (locations, environments, objects, actions, atmospheres)
const VISUAL_SEEDS = new Set([
    // Locations & settings
    'paris', 'tokyo', 'london', 'york', 'rome', 'city', 'street', 'downtown', 'subway',
    'airport', 'station', 'beach', 'ocean', 'mountain', 'forest', 'desert', 'studio',
    'office', 'cafe', 'coffee', 'kitchen', 'restaurant', 'gym', 'park', 'room', 'house',
    // Actions & activities
    'coding', 'typing', 'working', 'walking', 'running', 'driving', 'traveling', 'flying',
    'talking', 'laughing', 'reading', 'writing', 'filming', 'editing', 'exercising',
    // Objects & technology
    'camera', 'phone', 'smartphone', 'laptop', 'computer', 'screen', 'keyboard', 'money',
    'car', 'bicycle', 'train', 'plane', 'book', 'coffee', 'food', 'microphone',
    // Atmosphere & nature
    'night', 'sunset', 'sunrise', 'morning', 'rain', 'snow', 'sunshine', 'clouds', 'fire',
    'lights', 'neon', 'skyline', 'traffic', 'crowd',
]);

/**
 * Tokenizes text into lowercase, clean semantic keywords.
 */
function tokenizeWords(text) {
    if (!text || typeof text !== 'string') return [];
    const folded = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return folded
        .split(/[^a-z0-9']+/)
        .map(w => w.trim())
        .filter(w => w.length > 3 && !VISUAL_STOPWORDS.has(w));
}

/**
 * Evaluates visual score for a keyword.
 */
function scoreKeyword(word) {
    if (VISUAL_SEEDS.has(word)) return 3.0;
    if (word.length >= 6) return 1.5;
    return 1.0;
}

/**
 * Clusters transcript words into distinct semantic windows and identifies
 * moments with high visual storytelling potential.
 *
 * @param {Array<{start:number, end?:number, word?:string, text?:string}>} words
 * @param {Array<number>} [chapterBoundaries=[]]
 * @param {object} [options={}]
 * @returns {Array<{timelineTime:number, duration:number, snippet:string, query:string, keywords:string[], reason:string}>}
 */
function extractVisualMoments(words = [], chapterBoundaries = [], options = {}) {
    if (!Array.isArray(words) || words.length === 0) return [];

    const windowSeconds = options.windowSeconds || 6.0;
    const minSpacing = options.minSpacing || 8.0;
    const maxMoments = options.maxMoments || 5;
    const boundaries = Array.isArray(chapterBoundaries) ? chapterBoundaries : [];

    const moments = [];
    let lastMomentEnd = -Infinity;

    let i = 0;
    while (i < words.length) {
        const windowStart = words[i]?.start ?? 0;
        let j = i;
        const windowEntries = [];
        while (j < words.length && (words[j]?.start ?? 0) < windowStart + windowSeconds) {
            windowEntries.push(words[j]);
            j++;
        }

        if (windowEntries.length === 0) {
            i = j + 1;
            continue;
        }

        const rawSnippet = windowEntries
            .map(w => w.word || w.text || '')
            .join(' ')
            .trim();

        if (windowStart >= lastMomentEnd + minSpacing) {
            const tokens = tokenizeWords(rawSnippet);

            if (tokens.length >= 1) {
                // Score tokens and pick top 2-3 visual keywords
                const scored = tokens.map(t => ({ token: t, score: scoreKeyword(t) }));
                scored.sort((a, b) => b.score - a.score);

                const topTokens = scored.slice(0, 3).map(s => s.token);
                const hasStrongSeed = topTokens.some(t => VISUAL_SEEDS.has(t));
                const isNearChapter = boundaries.some(b => Math.abs(windowStart - b) <= 4.0);

                // We require either a strong visual seed or proximity to chapter transition or at least 2 distinctive tokens
                if (hasStrongSeed || isNearChapter || topTokens.length >= 2) {
                    const query = topTokens.join(' ');
                    let reason = 'Visual context in dialogue';
                    if (isNearChapter) {
                        reason = 'Chapter transition visual beat';
                    } else if (topTokens.some(t => ['paris', 'tokyo', 'london', 'city', 'street', 'beach', 'mountain', 'office'].includes(t))) {
                        const loc = topTokens.find(t => ['paris', 'tokyo', 'london', 'city', 'street', 'beach', 'mountain', 'office'].includes(t));
                        const locCap = loc ? loc.charAt(0).toUpperCase() + loc.slice(1) : 'Location';
                        reason = `Scene location reference ("${locCap}")`;
                    } else if (topTokens.some(t => ['night', 'sunset', 'morning', 'rain', 'lights'].includes(t))) {
                        reason = `Atmospheric storytelling moment`;
                    }

                    const duration = isNearChapter ? 4.5 : 3.5;
                    moments.push({
                        timelineTime: Math.max(0, Math.round(windowStart * 10) / 10),
                        duration,
                        snippet: `"...${rawSnippet}..."`,
                        query,
                        keywords: topTokens,
                        reason,
                    });

                    lastMomentEnd = windowStart + duration;
                    if (moments.length >= maxMoments) break;
                }
            }
        }

        i = j;
    }

    return moments;
}

class BrollSuggesterService {
    /**
     * Analyzes transcript and fetches stock footage suggestions via Pexels.
     *
     * @param {object} params
     * @param {Array} params.words Transcript words ({ start, end, word/text })
     * @param {Array} [params.chapters] Chapter boundary timestamps
     * @param {number} [params.maxSuggestions=4]
     * @returns {Promise<{ suggestions: Array }>}
     */
    async suggestBroll({ words = [], chapters = [], maxSuggestions = 4 } = {}) {
        const activeService = getActiveStockService();
        if (!activeService.isConfigured() && !pexelsService.isConfigured()) {
            const err = new Error('Stock media service is not configured.');
            err.code = 'NOT_CONFIGURED';
            err.status = 503;
            throw err;
        }

        if (!Array.isArray(words) || words.length === 0) {
            return { suggestions: [], message: 'No transcript words provided.' };
        }

        const moments = extractVisualMoments(words, chapters, {
            maxMoments: Math.min(8, Math.max(1, maxSuggestions)),
            minSpacing: 6.0,
        });

        if (moments.length === 0) {
            return { suggestions: [], message: 'No strong visual moments identified in transcript.' };
        }

        const suggestions = [];

        for (let idx = 0; idx < moments.length; idx++) {
            const moment = moments[idx];
            try {
                // Query active stock provider (Vecteezy or Pexels) for top 3 video candidates
                const searchRes = await activeService.searchVideos(moment.query, {
                    perPage: 3,
                    orientation: 'landscape',
                });

                const results = searchRes?.results || [];
                if (results.length > 0) {
                    const primaryAsset = results[0];
                    const alternativeAssets = results.slice(1);

                    suggestions.push({
                        id: `sugg_broll_${Math.round(moment.timelineTime)}_${idx}`,
                        timelineTime: moment.timelineTime,
                        duration: moment.duration,
                        query: moment.query,
                        reason: moment.reason,
                        snippet: moment.snippet,
                        matchedKeywords: moment.keywords,
                        asset: primaryAsset,
                        alternatives: alternativeAssets,
                        speakerLayout: 'full_cutaway',
                        treatment: 'footage',
                        transitions: {
                            inTransition: { type: 'zoom_cut', duration: 0.3 },
                            outTransition: { type: 'cross_dissolve', duration: 0.35 },
                        },
                        status: 'pending', // 'pending' | 'approved' | 'rejected'
                    });
                }
            } catch (err) {
                console.warn(`[BrollSuggesterService] Search failed for query "${moment.query}":`, err.message);
                // Continue with other moments
            }
        }

        return {
            suggestions,
            totalFound: suggestions.length,
            provider: activeService.providerName || 'vecteezy',
        };
    }
}

const brollSuggesterService = new BrollSuggesterService();

module.exports = {
    BrollSuggesterService,
    brollSuggesterService,
    extractVisualMoments,
    tokenizeWords,
    scoreKeyword,
};
