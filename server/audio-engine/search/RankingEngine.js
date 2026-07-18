'use strict';

/**
 * server/audio-engine/search/RankingEngine.js
 *
 * Merges multi-pass scores into a final ranked SearchResult list.
 *
 * Scoring weights:
 *   semanticSimilarity   0.30
 *   intentMatch          0.25
 *   contextScore         0.20
 *   popularityScore      0.10
 *   userPreferenceScore  0.10
 *   energyMatch          0.05
 *
 * Popularity and energy match are computed here from asset metadata.
 * User preference score is injected from UserPreferenceEngine if available.
 */

const WEIGHTS = {
    semanticSimilarity:   0.30,
    intentMatch:          0.25,
    contextScore:         0.20,
    popularityScore:      0.10,
    userPreferenceScore:  0.10,
    energyMatch:          0.05,
};

// Normalise use_count to 0–1 using a log scale (top: ~10k uses)
const MAX_USE_COUNT = 10000;

class RankingEngine {
    /**
     * Rank an array of merged asset entries into SearchResult[].
     *
     * @param {Array<{asset: Object, scores: Object, sources: Set<string>}>} entries
     * @param {import('../types').SemanticSearchQuery} query
     * @param {Object|null} userPrefs  — UserPreferenceEngine profile
     * @returns {import('../types').SearchResult[]}
     */
    rank(entries, query, userPrefs = null) {
        if (!entries?.length) return [];

        const results = entries.map(entry => {
            const scores = { ...entry.scores };

            // Populate derived scores
            scores.popularityScore    = this._popularityScore(entry.asset);
            scores.energyMatch        = this._energyMatch(entry.asset, query);
            scores.userPreferenceScore = this._userPreferenceScore(entry.asset, userPrefs);

            // Weighted sum
            const total = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => {
                return sum + (scores[key] || 0) * weight;
            }, 0);

            // Bonus for appearing in multiple passes
            const passBonus = (entry.sources?.size || 1) > 1 ? 0.05 : 0;

            const finalScore = Math.min(1.0, total + passBonus);

            return this._buildSearchResult(entry.asset, finalScore, scores, query);
        });

        // Sort descending by score
        results.sort((a, b) => b.score - a.score);
        return results;
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * Log-normalised popularity from use_count.
     * @private
     */
    _popularityScore(asset) {
        const count = asset?.use_count || asset?.useCount || 0;
        if (count <= 0) return 0;
        return Math.min(1.0, Math.log10(count + 1) / Math.log10(MAX_USE_COUNT + 1));
    }

    /**
     * Energy match score (1 - normalised distance from target energy).
     * @private
     */
    _energyMatch(asset, query) {
        const targetEnergy = query.extractedEnergy;
        if (!targetEnergy) return 0.5; // neutral when no preference

        const assetEnergy = asset?.energy_level || asset?.energyLevel || 3;
        const distance    = Math.abs(assetEnergy - targetEnergy);
        return Math.max(0, 1 - distance / 4); // max distance is 4 (1–5 scale)
    }

    /**
     * User preference score based on intent/emotion preferences.
     * @private
     */
    _userPreferenceScore(asset, userPrefs) {
        if (!userPrefs) return 0.5;

        const assetIntents  = asset?.editing_intents || asset?.editingIntents || [];
        const assetEmotions = asset?.emotion_tags    || asset?.emotionTags    || [];

        const { preferred_intents, avoided_intents, preferred_emotions, avoided_emotions } = userPrefs;

        let score = 0.5;

        // Boost for preferred intents
        if (preferred_intents?.length && assetIntents.some(i => preferred_intents.includes(i))) {
            score += 0.3;
        }
        // Boost for preferred emotions
        if (preferred_emotions?.length && assetEmotions.some(e => preferred_emotions.includes(e))) {
            score += 0.2;
        }
        // Penalty for avoided intents
        if (avoided_intents?.length && assetIntents.some(i => avoided_intents.includes(i))) {
            score -= 0.4;
        }
        // Penalty for avoided emotions
        if (avoided_emotions?.length && assetEmotions.some(e => avoided_emotions.includes(e))) {
            score -= 0.2;
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Build the placement recommendation for an asset.
     * @private
     */
    _buildPlacement(asset) {
        return {
            suggestedTime:     null,
            suggestedVolume:   asset?.recommended_volume || asset?.recommendedVolume || null,
            suggestedFadeIn:   asset?.recommended_fade_in || asset?.recommendedFadeIn || null,
            suggestedFadeOut:  asset?.recommended_fade_out || asset?.recommendedFadeOut || null,
        };
    }

    /**
     * Build the reasoning string for why this asset was surfaced.
     * @private
     */
    _buildReasoning(asset, scores, query) {
        const parts = [];

        if (scores.semanticSimilarity > 0.65) {
            parts.push(`Semantically similar to "${query.naturalLanguage?.slice(0, 40)}"`);
        }
        if (scores.intentMatch > 0.6) {
            parts.push(`Matches intent: ${query.extractedIntent || 'detected'}`);
        }
        if (scores.contextScore > 0.7) {
            parts.push(`Triggered by timeline event: ${query.contextTimelineEvent}`);
        }
        if (scores.popularityScore > 0.7) {
            parts.push('Popular in the library');
        }
        if (scores.userPreferenceScore > 0.7) {
            parts.push('Matches your editing style');
        }

        return parts.join(' · ') || 'Best match for your search';
    }

    /**
     * @private
     */
    _buildSearchResult(asset, score, scores, query) {
        return {
            asset,
            score,
            scoreBreakdown: scores,
            reasoning:  this._buildReasoning(asset, scores, query),
            placement:  this._buildPlacement(asset),
        };
    }
}

module.exports = { RankingEngine };
