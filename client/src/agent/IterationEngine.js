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
import { groupWordsIntoSegments } from '../motion/CaptionModel.js';
import { composeSceneFromBrief } from '../motion/SceneDirector.js';
import { flattenScene } from '../motion/SceneSchema.js';

const MAX_VARIATIONS = 3;

/** Long-form styles compare opening hooks; Reel compares full edit treatments. */
export function getIterationModeForStyle(styleId) {
    if (styleId === 'reel') return 'video';
    if (['vlog', 'talking_head', 'interview', 'podcast'].includes(styleId)) return 'hooks';
    return null;
}

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

const HOOK_PRESETS = [
    { id: 'hook-1', name: 'Hook 1', description: 'Transcript-led opening with a bold entrance', tone: 'viral', constraints: { pace: 'fast', hookStyle: 'action', cutDensity: 'medium', energy: 'high' }, motion: { enter: 'slam-in', emphasis: 'punch', exit: 'whip-out', energy: 0.84, anticipate: true } },
    { id: 'hook-2', name: 'Hook 2', description: 'Transcript-led opening with a clean reveal', tone: 'editorial', constraints: { pace: 'medium', hookStyle: 'question', cutDensity: 'medium', energy: 'medium' }, motion: { enter: 'rise-in', emphasis: 'pulse', exit: 'fade-out', energy: 0.58 } },
    { id: 'hook-3', name: 'Hook 3', description: 'Transcript-led opening with a measured type reveal', tone: 'warm', constraints: { pace: 'slow', hookStyle: 'statement', cutDensity: 'low', energy: 'low' }, motion: { enter: 'word-reveal', emphasis: 'pulse', exit: 'fade-out', energy: 0.48 } },
];

const HOOK_STOPWORDS = new Set('a an the and or but so to of in on at for with is are was were be this that i you we they my your le la les un une des et ou mais donc de du en au aux pour avec est sont je tu il elle nous vous ils elles mon ton ce cette ces'.split(' '));

/** Select distinct, transcript-grounded opening lines for a long-form hook test. */
export function rankHookCandidates(captions, prompt = '', limit = MAX_VARIATIONS) {
    const words = (Array.isArray(captions) ? captions : [])
        .map(w => ({ ...w, word: String(w?.word ?? w?.text ?? '').trim() }))
        .filter(w => w.word && Number.isFinite(Number(w.start)));
    if (!words.length) return [];
    const promptTokens = new Set(String(prompt || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || []);
    const segments = groupWordsIntoSegments(words, 9, 0.6);
    const candidates = segments.map((segment, index) => {
        const tokens = String(segment.text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
        const meaningful = tokens.filter(token => token.length > 2 && !HOOK_STOPWORDS.has(token));
        const promptFit = meaningful.filter(token => promptTokens.has(token)).length;
        const signal = meaningful.filter(token => /\d/.test(token)).length * 4
            + tokens.filter(token => /^(why|how|what|never|secret|mistake|truth|because|but|why|comment|pourquoi|comment|jamais|secret|erreur|vérité|parce|mais)$/.test(token)).length * 2;
        const text = String(segment.text || '').trim().split(/\s+/).slice(0, 8).join(' ').replace(/[.,;:!?]+$/g, '').slice(0, 64).trim();
        return { text, start: Number(segment.start) || 0, index, score: Math.min(6, meaningful.length) + signal + promptFit * 2 };
    }).filter(candidate => candidate.text && candidate.text.split(/\s+/).length >= 3);
    const picked = [];
    for (const candidate of candidates.slice().sort((a, b) => b.score - a.score || a.start - b.start)) {
        if (picked.every(item => item.text.toLowerCase() !== candidate.text.toLowerCase())) picked.push(candidate);
        if (picked.length >= Math.min(MAX_VARIATIONS, Math.max(1, limit))) break;
    }
    return picked;
}

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
    async generateVariations(basePrompt = '', count = MAX_VARIATIONS) {
        if (this.isGenerating) {
            console.warn('[IterationEngine] Already generating variations — ignoring request');
            return this.variations;
        }

        const currentState = useTimelineStore.getState();
        const mode = getIterationModeForStyle(currentState.editingStyle);
        if (!mode) {
            useAIStore.getState().addLog({ id: `iter-style-${Date.now()}`, type: 'warning', message: 'Choose a long-form or Reel editing style to generate iterations.', timestamp: new Date().toLocaleTimeString() });
            return [];
        }
        const presets = mode === 'hooks' ? HOOK_PRESETS : VARIATION_PRESETS;
        const requestedCount = Math.min(Math.max(1, Number(count) || MAX_VARIATIONS), MAX_VARIATIONS);
        const hookCandidates = mode === 'hooks' ? rankHookCandidates(currentState.captions, basePrompt, requestedCount) : [];
        if (mode === 'hooks' && hookCandidates.length === 0) {
            useAIStore.getState().addLog({ id: `iter-transcript-${Date.now()}`, type: 'warning', message: 'Generate captions first so I can build transcript-grounded hook variations.', timestamp: new Date().toLocaleTimeString() });
            return [];
        }
        const n = Math.min(requestedCount, presets.length, mode === 'hooks' ? hookCandidates.length : presets.length);
        console.log(`[IterationEngine] Generating ${n} variations for prompt: "${basePrompt}"`);

        this.isGenerating = true;
        this.variations = [];

        this._originalSnapshot = this._snapshotState(currentState);

        EventBus.emit(EVENT_TYPES.ITERATION_STARTED, { count: n, prompt: basePrompt, mode, style: currentState.editingStyle });

        useAIStore.getState().addLog({
            id: `iter-start-${Date.now()}`,
            type: 'info',
            message: mode === 'hooks' ? `🔁 Generating ${n} opening hook variations…` : `🔁 Generating ${n} full-video variations…`,
            timestamp: new Date().toLocaleTimeString()
        });

        const results = [];

        for (let i = 0; i < n; i++) {
            const preset = presets[i];

            try {
                useAIStore.getState().addLog({
                    id: `iter-v${i + 1}-${Date.now()}`,
                    type: 'info',
                    message: `  Creating ${mode === 'hooks' ? 'hook' : 'video'} ${i + 1}/${n}: ${preset.name}`,
                    timestamp: new Date().toLocaleTimeString()
                });

                // FIX: was useEditorStore.setState(...)
                useTimelineStore.setState({
                    tracks: JSON.parse(JSON.stringify(this._originalSnapshot.tracks)),
                    duration: this._originalSnapshot.duration,
                    aspectRatio: this._originalSnapshot.aspectRatio
                });

                const snapshot = mode === 'hooks'
                    ? this._applyHookVariation(preset, hookCandidates[i], currentState, currentState.editingStyle)
                    : await this._applyVariationConstraints(preset, basePrompt);
                const engagementScore = this._estimateEngagementScore(preset.constraints);

                const variation = {
                    id: preset.id,
                    mode,
                    styleId: currentState.editingStyle,
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

        // Roadmap item 1 — this was `setVariations?.(results)`, and
        // `setVariations` did not exist on useTimelineStore at all. Optional
        // chaining turned "the store cannot accept these" into a silent
        // no-op, so the engine reported "3 variations ready" while publishing
        // them nowhere. The slice now exists on the store, and the call is
        // unguarded on purpose: if it is ever renamed again, this should
        // throw where the mistake is rather than quietly do nothing.
        const store = useTimelineStore.getState();
        if (typeof store.setVariations !== 'function') {
            throw new TypeError('useTimelineStore.setVariations is missing — A/B variations cannot be published');
        }
        store.setVariations(results);

        EventBus.emit(EVENT_TYPES.ITERATION_COMPLETE, { variations: results });

        useAIStore.getState().addLog({
            id: `iter-done-${Date.now()}`,
            type: 'success',
            message: mode === 'hooks'
                ? `✅ ${results.length} hook variations ready — check the Iterations panel`
                : `✅ ${results.length} video variations ready — check the Iterations panel`,
            timestamp: new Date().toLocaleTimeString()
        });

        return results;
    }

    async _applyVariationConstraints(preset, basePrompt) {
        // FIX: was useEditorStore.getState()
        const store = useTimelineStore.getState();
        const { pace } = preset.constraints;

        const newTracks = JSON.parse(JSON.stringify(store.tracks));

        newTracks.forEach(track => {
            if (track.type !== 'video') return;

            track.clips.forEach(clip => {
                if (pace === 'fast') clip.speed = Math.min(2.0, (clip.speed || 1.0) * 1.25);
                else if (pace === 'slow') clip.speed = Math.max(0.5, (clip.speed || 1.0) * 0.8);

            });

            const sequence = (track.clips || []).slice().sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
            sequence.slice(0, -1).forEach((clip, index) => {
                if (pace === 'fast' && index % 2 !== 0) return;
                const transition = pace === 'fast'
                    ? { type: 'whip-left', duration: 0.2 }
                    : pace === 'slow'
                        ? { type: 'dip', duration: 0.48 }
                        : { type: 'zoom-punch', duration: 0.28 };
                clip.transition = transition;
            });
        });

        // FIX: was useEditorStore.setState(...)
        useTimelineStore.setState({ tracks: newTracks });

        // FIX: was useEditorStore.getState()
        return this._snapshotState(useTimelineStore.getState());
    }

    _applyHookVariation(preset, candidate, originalState, styleId) {
        if (!candidate?.text) throw new Error('No transcript hook candidate was available.');
        const tracks = JSON.parse(JSON.stringify(originalState.tracks || []));
        const duration = Math.max(2.4, Math.min(4.5, Number(originalState.duration) || 3.5));
        const restrained = styleId === 'podcast' || styleId === 'interview';
        const motion = restrained
            ? { enter: preset.id === 'hook-1' ? 'fade-in' : 'rise-in', emphasis: 'pulse', exit: 'fade-out', energy: preset.id === 'hook-3' ? 0.32 : 0.42 }
            : preset.motion;
        const designed = composeSceneFromBrief('A restrained, readable opening hook title for a long-form video. Use only the supplied transcript words.', {
            plan: { beats: [{ kind: 'intro', text: candidate.text, motion }] },
            tone: restrained ? 'editorial' : preset.tone,
            duration,
            aspectRatio: originalState.aspectRatio || '16:9',
        });
        const placements = designed?.scene ? flattenScene(designed.scene).placements : [];
        if (!placements.length) throw new Error('The hook title could not be composed.');
        let textIndex = 0;
        for (const placement of placements) {
            const type = placement.trackType === 'text' ? 'text' : 'overlay';
            const name = type === 'text' ? 'Hook Variations' : 'Hook Graphics';
            let track = tracks.find(item => item.type === type && item.name === name);
            if (!track) {
                track = { id: `track-iteration-${type}-${preset.id}`, type, name, clips: [] };
                tracks.push(track);
            }
            track.clips.push({
                ...placement.clip,
                id: `iteration-${preset.id}-${type}-${textIndex++}`,
                name: type === 'text' ? candidate.text : (placement.clip.name || name),
                iterationKind: 'hook',
            });
        }
        return this._snapshotState({ ...originalState, tracks });
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
        // Keep the store in step: the panel renders ACTIVE, Load and Unload
        // from `activeVariationId`, and it used to be set by the panel itself
        // against the other store — so anything loading a variation outside
        // the panel (chat, a command) left the UI showing the wrong one.
        useTimelineStore.getState().setActiveVariation?.(variationId);

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
        useTimelineStore.getState().setActiveVariation?.(null);
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
        // One call that empties both the list and the active id, so the
        // panel cannot be left holding an active variation that no longer
        // exists (Clear used to reset the engine's own fields and leave the
        // store's `activeVariationId` pointing at a deleted variation).
        useTimelineStore.getState().clearVariations?.();
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
