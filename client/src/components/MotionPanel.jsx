/**
 * client/src/components/MotionPanel.jsx
 *
 * The Motion tab — the UI that makes the motion engine reachable.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The engine (client/src/motion/) shipped with 26 keyframe-generating presets,
 * 12 easing curves, a resolver driving both preview and export, and — until
 * this panel — five of those presets reachable by a user, via the pre-existing
 * animation dropdown in TextPanel. The other 21, and hand-authored keyframes,
 * had no caller outside the regression suite.
 *
 * That is this codebase's signature failure, documented eight times over in
 * CLAUDE.md (R33, R37, /api/brain/organize, R46, R52, R55, R55c, and
 * DirectorIntelligence — the module written to fix R52, itself unwired). This
 * panel is the caller, and §10 of scripts/test_motion_engine.js asserts it
 * stays one.
 *
 * ─── IT REUSES KeyframeEditor RATHER THAN REPLACING IT ──────────────────────
 * `components/Effects/KeyframeEditor.jsx` is a complete visual keyframe
 * timeline that has never been mounted. It speaks the effect system's data
 * shape, so `motion/KeyframeBridge.js` translates — no changes to the editor,
 * and no second keyframe UI competing with it.
 */

import React, { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { Sparkles, RotateCcw, Diamond } from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { MOTION_PRESETS, PRESET_GROUPS } from '../motion/MotionPresets.js';
import { applyPresetToClip, clipToMotionLayer } from '../motion/ClipAdapter.js';
import {
    buildEditorModel,
    applyKeyframeOp,
    MOTION_PARAM_DEFS,
    CUSTOM_ANIMATION_ID,
} from '../motion/KeyframeBridge.js';
import KeyframeEditor from './Effects/KeyframeEditor.jsx';

export default function MotionPanel() {
    const { t } = useTranslation('editor');

    const { tracks, activeClipId, currentTime, updateClip, saveToHistory } = useTimelineStore(
        useShallow(state => ({
            tracks:        state.tracks,
            activeClipId:  state.activeClipId,
            currentTime:   state.currentTime,
            updateClip:    state.updateClip,
            saveToHistory: state.saveToHistory,
        }))
    );

    // Resolve the selected clip and the track it lives on. Both are needed:
    // updateClip is keyed by (trackId, clipId).
    const { clip, trackId } = useMemo(() => {
        for (const track of (tracks || [])) {
            for (const c of (track.clips || [])) {
                if (c.id === activeClipId) return { clip: c, trackId: track.id };
            }
        }
        return { clip: null, trackId: null };
    }, [tracks, activeClipId]);

    const layer = useMemo(() => (clip ? clipToMotionLayer(clip) : null), [clip]);

    // Only offer presets that make sense for what is selected — camera moves on
    // a caption, or a typewriter on a video clip, are noise.
    const presetIds = useMemo(() => {
        if (!layer) return [];
        const out = [];
        for (const group of PRESET_GROUPS) {
            if (group.kinds.includes(layer.kind)) out.push({ group: group.group, ids: group.ids });
        }
        return out;
    }, [layer]);

    const activePresetId = useMemo(() => {
        const anims = clip?.animations;
        if (!Array.isArray(anims) || anims.length === 0) return null;
        return anims[0]?.presetId || null;
    }, [clip]);

    const isCustom = useMemo(() => {
        const anims = clip?.animations;
        return Array.isArray(anims) && anims.length === 1 && anims[0]?.id === CUSTOM_ANIMATION_ID;
    }, [clip]);

    const handleApplyPreset = useCallback((presetId) => {
        if (!clip || !trackId) return;
        try {
            const updates = applyPresetToClip(clip, presetId);
            if (!updates || Object.keys(updates).length === 0) {
                console.warn(`[MotionPanel] preset "${presetId}" produced no animation`);
                return;
            }
            saveToHistory?.();
            updateClip(trackId, clip.id, updates);
        } catch (err) {
            console.error('[MotionPanel] applyPreset failed:', err.message);
        }
    }, [clip, trackId, updateClip, saveToHistory]);

    const handleClear = useCallback(() => {
        if (!clip || !trackId) return;
        try {
            saveToHistory?.();
            // Clear BOTH representations. Leaving the legacy string behind would
            // let it re-supply an animation through LEGACY_ANIMATION_MAP, so
            // "remove animation" would visibly do nothing.
            updateClip(trackId, clip.id, { animations: [], animation: 'none' });
        } catch (err) {
            console.error('[MotionPanel] clear failed:', err.message);
        }
    }, [clip, trackId, updateClip, saveToHistory]);

    // ── Keyframe editor plumbing ────────────────────────────────────────────
    const editorModel = useMemo(() => buildEditorModel(clip), [clip]);

    const dispatchKeyframeOp = useCallback((op) => {
        if (!clip || !trackId) return;
        try {
            const updates = applyKeyframeOp(clip, op);
            if (!updates || Object.keys(updates).length === 0) return;
            saveToHistory?.();
            updateClip(trackId, clip.id, updates);
        } catch (err) {
            console.error('[MotionPanel] keyframe op failed:', err.message);
        }
    }, [clip, trackId, updateClip, saveToHistory]);

    // KeyframeEditor's callbacks are (effectId, paramName, time, value, easing).
    // The effectId is ignored — this panel owns exactly one custom animation.
    const handleAddKeyframe = useCallback((_effectId, param, time, value, easing) => {
        dispatchKeyframeOp({ kind: 'add', param, time, value, easing });
    }, [dispatchKeyframeOp]);

    const handleRemoveKeyframe = useCallback((_effectId, param, time) => {
        dispatchKeyframeOp({ kind: 'remove', param, time });
    }, [dispatchKeyframeOp]);

    // Add a keyframe at the playhead for a parameter that has none yet, using
    // its neutral value — the normal way to start animating something.
    const handleStartAnimating = useCallback((param) => {
        if (!clip) return;
        const localTime = Math.max(0, (currentTime || 0) - (clip.start || 0));
        dispatchKeyframeOp({
            kind: 'add',
            param,
            time: Math.min(localTime, Number(clip.duration) || 0),
            value: MOTION_PARAM_DEFS[param]?.neutral ?? 0,
            easing: 'easeOutCubic',
        });
    }, [clip, currentTime, dispatchKeyframeOp]);

    const unanimatedParams = useMemo(() => {
        const existing = editorModel?.effect?.keyframes || {};
        return Object.keys(MOTION_PARAM_DEFS).filter(p => !existing[p] || existing[p].length === 0);
    }, [editorModel]);

    if (!clip) {
        return (
            <section className="p-4 border-b border-border/50">
                <div className="flex items-center justify-between mb-3">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        {t('motionPanel.title')}
                    </div>
                </div>
                <div className="p-4 rounded-md border border-dashed border-border text-center">
                    <p className="text-xs text-muted-foreground">{t('motionPanel.selectClip')}</p>
                </div>
            </section>
        );
    }

    return (
        <section className="p-4 border-b border-border/50">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                    {t('motionPanel.title')}
                </div>
                <div className="text-[10px] text-green-400 font-mono">{t('ideLayout.active')}</div>
            </div>

            {/* Presets — grouped by what the selected layer actually is */}
            {presetIds.map(({ group, ids }) => (
                <div key={group} className="mb-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                        {t(`motionPanel.group.${group}`)}
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                        {ids.map(id => {
                            const active = activePresetId === id;
                            return (
                                <button
                                    key={id}
                                    onClick={() => handleApplyPreset(id)}
                                    className={`px-2 py-1.5 rounded text-[11px] text-left transition-colors border ${
                                        active
                                            ? 'bg-primary/15 border-primary/40 text-primary'
                                            : 'bg-secondary border-transparent hover:bg-white/10 text-foreground'
                                    }`}
                                >
                                    <Sparkles className="w-2.5 h-2.5 inline mr-1 opacity-70" />
                                    {MOTION_PRESETS[id]?.label || id}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {/* Status + clear */}
            <div className="flex items-center justify-between gap-2 mb-4">
                <span className="text-[10px] text-muted-foreground truncate">
                    {isCustom
                        ? t('motionPanel.customKeyframes')
                        : activePresetId
                            ? t('motionPanel.usingPreset', { name: MOTION_PRESETS[activePresetId]?.label || activePresetId })
                            : t('motionPanel.noAnimation')}
                </span>
                {(isCustom || activePresetId) && (
                    <button
                        onClick={handleClear}
                        className="shrink-0 px-2 py-1 text-[10px] bg-secondary hover:bg-white/10 rounded text-muted-foreground transition-colors flex items-center gap-1"
                    >
                        <RotateCcw className="w-2.5 h-2.5" /> {t('motionPanel.clear')}
                    </button>
                )}
            </div>

            {/* Hand-authored keyframes.
                Values are OFFSETS and MULTIPLIERS against the clip's own
                transform, because that is how the resolver composes them —
                showing an absolute that silently behaves as an offset would be
                worse than showing the truth. */}
            <div className="pt-3 border-t border-border">
                <div className="flex items-center gap-1.5 mb-2">
                    <Diamond className="w-2.5 h-2.5 text-primary" />
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('motionPanel.keyframes')}
                    </div>
                </div>

                {unanimatedParams.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                        {unanimatedParams.map(param => (
                            <button
                                key={param}
                                onClick={() => handleStartAnimating(param)}
                                className="px-1.5 py-1 text-[10px] rounded bg-secondary hover:bg-white/10 text-muted-foreground transition-colors"
                                title={t('motionPanel.startAnimating', { param: t(`motionPanel.param.${param}`) })}
                            >
                                + {t(`motionPanel.param.${param}`)}
                            </button>
                        ))}
                    </div>
                )}

                {editorModel && (
                    <KeyframeEditor
                        effect={editorModel.effect}
                        definition={editorModel.definition}
                        duration={editorModel.duration}
                        playhead={Math.max(0, (currentTime || 0) - (clip.start || 0))}
                        onAddKeyframe={handleAddKeyframe}
                        onUpdateKeyframe={handleAddKeyframe}
                        onRemoveKeyframe={handleRemoveKeyframe}
                    />
                )}
            </div>
        </section>
    );
}
