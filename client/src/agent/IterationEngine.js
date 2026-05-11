/**
 * IterationEngine — Viral Pilot Phase 7
 *
 * Generates up to 3 A/B timeline variations from a single prompt
 * by running the edit pipeline with systematically different constraints.
 *
 * FIX: Was importing from `useEditorStore` which is a separate, legacy store.
 *      The production app uses `useTimelineStore` as the single source of truth.
 *      `useEditorStore.getState().setVariations` did not exist in production,
 *      causing all A/B variation operations to silently fail.
 */

// FIX: was `import useEditorStore from '../store/useEditorStore.js'`
import useTimelineStore from '../store/useTimelineStore.js';
import useAIStore from '../store/useAIStore.js';
import { EventBus, EVENT_TYPES } from './EventBus.js';

const MAX_VARIATIONS = 3;

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
        this.variations = [];
        this.isGenerating = false;
        this.activeVariationId = null;
        this._originalSnapshot = null;
    }

    /**
     * Generate up to 3 A/B variations from a base prompt.
     */
    async generateVariations(basePrompt, count = MAX_VARIATIONS) {
        if (this.isGenerating) {
            console.warn('[IterationEngine] Already generating variations — ignoring request');
            return this.variations;
        }

        const n = Math.min(count, MAX_VARIATIONS);
        console.log(`[IterationEngine] Generating ${n} variations for prompt: "${basePrompt}"`);

        this.isGenerating = true;
        this.variations = [];

        // FIX: was useEditorStore.getState()
        const currentState = useTimelineStore.getState();
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

                // FIX: was useEditorStore.setState(...)
                useTimelineStore.setState({
                    tracks: JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
                    duration: this._originalSnapshot.duration,
                    aspectRatio: this._originalSnapshot.aspectRatio
                });

                const snapshot = await this._applyVariationConstraints(preset, basePrompt);
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
            // FIX: was useEditorStore.setState(...)
            useTimelineStore.setState({
                tracks: JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
                duration: this._originalSnapshot.duration,
                aspectRatio: this._originalSnapshot.aspectRatio
            });
        }

        this.variations = results;
        this.isGenerating = false;

        // FIX: was useEditorStore.getState().setVariations(results)
        useTimelineStore.getState().setVariations?.(results);

        EventBus.emit(EVENT_TYPES.ITERATION_COMPLETE, { variations: results });

        useAIStore.getState().addLog({
            id: `iter-done-${Date.now()}`,
            type: 'success',
            message: `✅ ${results.length} variations ready — check the A/B panel`,
            timestamp: new Date().toLocaleTimeString()
        });

        return results;
    }

    async _applyVariationConstraints(preset, basePrompt) {
        // FIX: was useEditorStore.getState()
        const store = useTimelineStore.getState();
        const { pace, cutDensity } = preset.constraints;

        const newTracks = JSON.parse(JSON.stringify(store.tracks));

        newTracks.forEach(track => {
            if (track.type !== 'video') return;

            track.clips.forEach(clip => {
                if (pace === 'fast') clip.speed = Math.min(2.0, (clip.speed || 1.0) * 1.25);
                else if (pace === 'slow') clip.speed = Math.max(0.5, (clip.speed || 1.0) * 0.8);

                if (preset.constraints.energy === 'high') {
                    clip.volume = Math.min(1.5, (clip.volume || 1.0) * 1.1);
                }

                if (cutDensity === 'high' && clip.duration > 5) {
                    clip.duration = clip.duration * 0.75;
                }
            });
        });

        // FIX: was useEditorStore.setState(...)
        useTimelineStore.setState({ tracks: newTracks });

        // FIX: was useEditorStore.getState()
        return this._snapshotState(useTimelineStore.getState());
    }

    _estimateEngagementScore(constraints) {
        const { pace, hookStyle, cutDensity, energy } = constraints;
        let score = 60;

        if (pace === 'fast') score += 10;
        else if (pace === 'slow') score -= 5;

        if (hookStyle === 'action') score += 8;
        else if (hookStyle === 'question') score += 5;

        if (cutDensity === 'high') score += 7;
        if (energy === 'high') score += 5;

        return Math.min(100, Math.max(0, score));
    }

    loadVariation(variationId) {
        const variation = this.variations.find(v => v.id === variationId);
        if (!variation) {
            console.warn(`[IterationEngine] Variation not found: ${variationId}`);
            return false;
        }

        // FIX: was useEditorStore.getState().saveToHistory()
        useTimelineStore.getState().saveToHistory?.();

        // FIX: was useEditorStore.setState(...)
        useTimelineStore.setState({
            tracks: JSON.parse(JSON.stringify(variation.snapshot.tracks)),
            duration: variation.snapshot.duration,
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

    restoreOriginal() {
        if (!this._originalSnapshot) return false;

        // FIX: was useEditorStore.getState().saveToHistory()
        useTimelineStore.getState().saveToHistory?.();

        // FIX: was useEditorStore.setState(...)
        useTimelineStore.setState({
            tracks: JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
            duration: this._originalSnapshot.duration,
            aspectRatio: this._originalSnapshot.aspectRatio
        });

        this.activeVariationId = null;
        return true;
    }

    compareVariations(idA, idB) {
        const varA = this.variations.find(v => v.id === idA);
        const varB = this.variations.find(v => v.id === idB);

        if (!varA || !varB) return null;

        return {
            engagementDelta: varB.engagementScore - varA.engagementScore,
            clipCountA: this._countClips(varA.snapshot),
            clipCountB: this._countClips(varB.snapshot),
            durationA: varA.snapshot.duration,
            durationB: varB.snapshot.duration,
            winner: varA.engagementScore >= varB.engagementScore ? idA : idB
        };
    }

    getVariations() {
        return this.variations;
    }

    clear() {
        this.restoreOriginal();
        this.variations = [];
        this._originalSnapshot = null;
        this.activeVariationId = null;
        // FIX: was useEditorStore.getState().setVariations([])
        useTimelineStore.getState().setVariations?.([]);
    }

    _snapshotState(state) {
        return {
            tracks: JSON.parse(JSON.stringify(state.tracks)),
            duration: state.duration,
            aspectRatio: state.aspectRatio,
            timestamp: Date.now()
        };
    }

    _countClips(snapshot) {
        return snapshot.tracks.reduce((sum, t) => sum + (t.clips?.length || 0), 0);
    }
}

export const IterationEngine = new IterationEngineClass();
export default IterationEngine;