/**
 * IterationEngine — Viral Pilot Phase 7
 *
 * Generates up to 3 A/B timeline variations from a single prompt
 * by running the edit pipeline with systematically different constraints.
 *
 * Each variation is a full snapshot of the timeline state.
 *
 * Max variations: 3 (as per product design decision).
 */

import useEditorStore from '../store/useEditorStore.js';
import useAIStore from '../store/useAIStore.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';

const MAX_VARIATIONS = 3;

// Variation parameter presets — each generates a distinct editing style
const VARIATION_PRESETS = [
    {
        id: 'fast-energetic',
        name: '⚡ Fast & Energetic',
        description: 'Rapid cuts, high energy, perfect for TikTok/Reels',
        constraints: { pace: 'fast', hookStyle: 'action', cutDensity: 'high', energy: 'high' }
    },
    {
        id: 'balanced-storytelling',
        name: '🎬 Balanced Storytelling',
        description: 'Natural flow with clear narrative structure',
        constraints: { pace: 'medium', hookStyle: 'question', cutDensity: 'medium', energy: 'medium' }
    },
    {
        id: 'slow-cinematic',
        name: '🎥 Slow & Cinematic',
        description: 'Longer shots, emotional depth, great for YouTube',
        constraints: { pace: 'slow', hookStyle: 'statement', cutDensity: 'low', energy: 'low' }
    }
];

class IterationEngineClass {
    constructor() {
        this.variations = [];       // Array of { id, name, description, snapshot, engagementScore, constraints }
        this.isGenerating = false;
        this.activeVariationId = null;
        this._originalSnapshot = null;
    }

    /**
     * Generate up to 3 A/B variations from a base prompt.
     *
     * @param {string} basePrompt - The original user edit prompt
     * @param {number} count      - Number of variations to generate (max 3)
     * @returns {Promise<Array>}  - Array of variation objects
     */
    async generateVariations(basePrompt, count = MAX_VARIATIONS) {
        if (this.isGenerating) {
            console.warn('[IterationEngine] Already generating variations — ignoring request');
            return this.variations;
        }

        const n = Math.min(count, MAX_VARIATIONS);
        console.log(`[IterationEngine] Generating ${n} variations for prompt: "${basePrompt}"`);

        this.isGenerating = true;
        this.variations   = [];

        // Snapshot the current state as the "original" reference
        const currentState = useEditorStore.getState();
        this._originalSnapshot = this._snapshotState(currentState);

        EventBus.emit(EVENT_TYPES.ITERATION_STARTED, { count: n, prompt: basePrompt });

        useAIStore.getState().addLog({
            id: `iter-start-${Date.now()}`,
            type: 'info',
            message: `🔁 Generating ${n} A/B variations…`,
            timestamp: new Date().toLocaleTimeString()
        });

        const results = [];

        for (let i = 0; i < n; i++) {
            const preset = VARIATION_PRESETS[i];

            try {
                useAIStore.getState().addLog({
                    id: `iter-v${i + 1}-${Date.now()}`,
                    type: 'info',
                    message: `  Creating variation ${i + 1}/${n}: ${preset.name}`,
                    timestamp: new Date().toLocaleTimeString()
                });

                // Restore original state before each variation
                useEditorStore.setState({
                    tracks: JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
                    duration: this._originalSnapshot.duration,
                    aspectRatio: this._originalSnapshot.aspectRatio
                });

                // Apply variation-specific edits based on constraints
                const snapshot = await this._applyVariationConstraints(preset, basePrompt);

                // Compute a mock engagement score for the variation
                const engagementScore = this._estimateEngagementScore(preset.constraints);

                const variation = {
                    id: preset.id,
                    name: preset.name,
                    description: preset.description,
                    constraints: preset.constraints,
                    snapshot,
                    engagementScore,
                    createdAt: Date.now()
                };

                results.push(variation);

            } catch (err) {
                console.error(`[IterationEngine] Variation ${i + 1} failed:`, err);
                useAIStore.getState().addLog({
                    id: `iter-err-${Date.now()}`,
                    type: 'warning',
                    message: `  ⚠ Variation ${i + 1} failed: ${err.message}`,
                    timestamp: new Date().toLocaleTimeString()
                });
            }
        }

        // Restore original state after all variations
        if (this._originalSnapshot) {
            useEditorStore.setState({
                tracks: JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
                duration: this._originalSnapshot.duration,
                aspectRatio: this._originalSnapshot.aspectRatio
            });
        }

        this.variations   = results;
        this.isGenerating = false;

        // Persist to store
        useEditorStore.getState().setVariations(results);

        EventBus.emit(EVENT_TYPES.ITERATION_COMPLETE, { variations: results });

        useAIStore.getState().addLog({
            id: `iter-done-${Date.now()}`,
            type: 'success',
            message: `✅ ${results.length} variations ready — check the A/B panel`,
            timestamp: new Date().toLocaleTimeString()
        });

        return results;
    }

    /**
     * Apply variation-specific constraints to the current timeline.
     * Returns a snapshot of the modified state.
     */
    async _applyVariationConstraints(preset, basePrompt) {
        const store   = useEditorStore.getState();
        const { pace, cutDensity } = preset.constraints;

        const newTracks = JSON.parse(JSON.stringify(store.tracks));

        newTracks.forEach(track => {
            if (track.type !== 'video') return;

            track.clips.forEach(clip => {
                // Apply speed based on pace
                if      (pace === 'fast')   clip.speed = Math.min(2.0, (clip.speed || 1.0) * 1.25);
                else if (pace === 'slow')   clip.speed = Math.max(0.5, (clip.speed || 1.0) * 0.8);

                // Apply volume boost for high energy
                if (preset.constraints.energy === 'high') {
                    clip.volume = Math.min(1.5, (clip.volume || 1.0) * 1.1);
                }

                // Trim clips more aggressively for high cut density
                if (cutDensity === 'high' && clip.duration > 5) {
                    clip.duration = clip.duration * 0.75;
                }
            });
        });

        // Apply the modified tracks
        useEditorStore.setState({ tracks: newTracks });

        return this._snapshotState(useEditorStore.getState());
    }

    /**
     * Estimate an engagement score based on constraints (heuristic).
     */
    _estimateEngagementScore(constraints) {
        const { pace, hookStyle, cutDensity, energy } = constraints;
        let score = 60;

        if (pace === 'fast')         score += 10;
        else if (pace === 'slow')    score -= 5;

        if (hookStyle === 'action')  score += 8;
        else if (hookStyle === 'question') score += 5;

        if (cutDensity === 'high')   score += 7;
        if (energy === 'high')       score += 5;

        return Math.min(100, Math.max(0, score));
    }

    /**
     * Load a variation into the active timeline.
     * @param {string} variationId
     */
    loadVariation(variationId) {
        const variation = this.variations.find(v => v.id === variationId);
        if (!variation) {
            console.warn(`[IterationEngine] Variation not found: ${variationId}`);
            return false;
        }

        // Save current state to history before switching
        useEditorStore.getState().saveToHistory();

        useEditorStore.setState({
            tracks:      JSON.parse(JSON.stringify(variation.snapshot.tracks)),
            duration:    variation.snapshot.duration,
            aspectRatio: variation.snapshot.aspectRatio
        });

        this.activeVariationId = variationId;

        useAIStore.getState().addLog({
            id: `iter-load-${Date.now()}`,
            type: 'success',
            message: `🎬 Loaded variation: ${variation.name}`,
            timestamp: new Date().toLocaleTimeString()
        });

        EventBus.emit(EVENT_TYPES.VARIATION_LOADED, { variationId, name: variation.name });
        return true;
    }

    /**
     * Restore the original timeline before any variations.
     */
    restoreOriginal() {
        if (!this._originalSnapshot) return false;

        useEditorStore.getState().saveToHistory();
        useEditorStore.setState({
            tracks:      JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
            duration:    this._originalSnapshot.duration,
            aspectRatio: this._originalSnapshot.aspectRatio
        });

        this.activeVariationId = null;
        return true;
    }

    /**
     * Compare two variations and return metric deltas.
     * @param {string} idA
     * @param {string} idB
     */
    compareVariations(idA, idB) {
        const varA = this.variations.find(v => v.id === idA);
        const varB = this.variations.find(v => v.id === idB);

        if (!varA || !varB) return null;

        return {
            engagementDelta: varB.engagementScore - varA.engagementScore,
            clipCountA:      this._countClips(varA.snapshot),
            clipCountB:      this._countClips(varB.snapshot),
            durationA:       varA.snapshot.duration,
            durationB:       varB.snapshot.duration,
            winner:          varA.engagementScore >= varB.engagementScore ? idA : idB
        };
    }

    /**
     * Get current variations list.
     */
    getVariations() {
        return this.variations;
    }

    /**
     * Clear all variations and restore original.
     */
    clear() {
        this.restoreOriginal();
        this.variations = [];
        this._originalSnapshot = null;
        this.activeVariationId = null;
        useEditorStore.getState().setVariations([]);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    _snapshotState(state) {
        return {
            tracks:      JSON.parse(JSON.stringify(state.tracks)),
            duration:    state.duration,
            aspectRatio: state.aspectRatio,
            timestamp:   Date.now()
        };
    }

    _countClips(snapshot) {
        return snapshot.tracks.reduce((sum, t) => sum + (t.clips?.length || 0), 0);
    }
}

export const IterationEngine = new IterationEngineClass();
export default IterationEngine;
