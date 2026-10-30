/**
 * client/src/components/MotionPanel.jsx
 *
 * The Motion tab — the UI that makes the motion engine reachable.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The engine (client/src/motion/) has a growing library of keyframe-generating
 * presets, easing curves, and a resolver driving both preview and export. This
 * panel exposes the complete kind-specific preset groups and hand-authored
 * keyframes to the editor.
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

import React, { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

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
import { PanelSection } from './ui/PanelControls.jsx';
import TemplatePanel from './TemplatePanel.jsx';
import StyleRecipePanel from './StyleRecipePanel.jsx';
import MotionDirectorPanel from './MotionDirectorPanel.jsx';
import BackgroundPanel from './BackgroundPanel.jsx';

export default function MotionPanel() {
    const { t } = useTranslation('editor');
    const [presetSearch, setPresetSearch] = useState('');
    const presetSearchQuery = presetSearch.trim().toLowerCase();

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
    const { clip, trackId, trackType } = useMemo(() => {
        for (const track of (tracks || [])) {
            for (const c of (track.clips || [])) {
                if (c.id === activeClipId) return { clip: c, trackId: track.id, trackType: track.type };
            }
        }
        return { clip: null, trackId: null, trackType: null };
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
                <StyleRecipePanel />
                <TemplatePanel selectedClip={null} selectedTrackId={null} />
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

            <StyleRecipePanel />
            <TemplatePanel selectedClip={clip} selectedTrackId={trackId} />
            {/* R92: write the motion (AI or verb by verb) */}
            <MotionDirectorPanel clip={clip} trackId={trackId} trackType={trackType} />
            {/* R92: free background removal for video clips */}
            {trackType === 'video' && <BackgroundPanel clip={clip} trackId={trackId} />}

            {/* R118 - preset groups are collapsible sections on the shared kit
                (components/ui/PanelControls.jsx), and each is a radiogroup:
                one preset is active at a time, so a row of plain buttons
                announced nothing about which. The status line and Clear moved
                into the FIRST group's header, where the thing being cleared
                is in view. */}
            <input
                type="search"
                value={presetSearch}
                onChange={event => setPresetSearch(event.target.value)}
                placeholder={t('motionPanel.searchPresets')}
                aria-label={t('motionPanel.searchPresets')}
                style={{
                    width: '100%', height: 32, margin: '8px 0', padding: '0 9px',
                    borderRadius: 'var(--r-xs)', border: '0.5px solid var(--line)',
                    background: 'var(--glass)', color: 'var(--fg-1)',
                    fontFamily: 'var(--f-sans)', fontSize: 11,
                }}
            />
            {presetIds.map(({ group, ids }, groupIndex) => (
                <PanelSection
                    key={group}
                    title={t(`motionPanel.group.${group}`)}
                    collapsible
                    onReset={groupIndex === 0 && (isCustom || activePresetId) ? handleClear : null}
                    resetLabel={t('motionPanel.clear')}
                    right={groupIndex === 0 ? (
                        <span style={{
                            maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap', fontFamily: 'var(--f-sans)', fontSize: 10,
                            color: (isCustom || activePresetId) ? 'var(--accent)' : 'var(--fg-4)',
                        }}>
                            {isCustom
                                ? t('motionPanel.customKeyframes')
                                : activePresetId
                                    ? t('motionPanel.usingPreset', { name: MOTION_PRESETS[activePresetId]?.label || activePresetId })
                                    : t('motionPanel.noAnimation')}
                        </span>
                    ) : null}
                >
                    <div
                        role="radiogroup"
                        aria-label={t(`motionPanel.group.${group}`)}
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}
                    >
                        {ids.filter(id => !presetSearchQuery || `${MOTION_PRESETS[id]?.label || id} ${id}`.toLowerCase().includes(presetSearchQuery)).map(id => {
                            const active = activePresetId === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    role="radio"
                                    aria-checked={active}
                                    onClick={() => handleApplyPreset(id)}
                                    title={MOTION_PRESETS[id]?.label || id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 5,
                                        height: 28, padding: '0 8px', cursor: 'pointer',
                                        borderRadius: 'var(--r-xs)', textAlign: 'left',
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        fontFamily: 'var(--f-sans)', fontSize: 11,
                                        fontWeight: active ? 600 : 500,
                                        border: `0.5px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                                        background: active ? 'var(--accent-soft)' : 'var(--glass)',
                                        color: active ? 'var(--accent)' : 'var(--fg-2)',
                                        transition: 'background 0.12s, color 0.12s, border-color 0.12s',
                                    }}
                                >
                                    <Sparkles className="w-2.5 h-2.5 shrink-0" style={{ opacity: 0.7 }} />
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {MOTION_PRESETS[id]?.label || id}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </PanelSection>
            ))}

            {/* Hand-authored keyframes.
                Values are OFFSETS and MULTIPLIERS against the clip's own
                transform, because that is how the resolver composes them —
                showing an absolute that silently behaves as an offset would be
                worse than showing the truth. */}
            <PanelSection title={t('motionPanel.keyframes')} collapsible>
                {unanimatedParams.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {unanimatedParams.map(param => (
                            <button
                                key={param}
                                type="button"
                                onClick={() => handleStartAnimating(param)}
                                title={t('motionPanel.startAnimating', { param: t(`motionPanel.param.${param}`) })}
                                style={{
                                    height: 24, padding: '0 8px', cursor: 'pointer',
                                    borderRadius: 'var(--r-xs)',
                                    border: '0.5px solid var(--line)', background: 'var(--glass)',
                                    color: 'var(--fg-3)', fontFamily: 'var(--f-sans)', fontSize: 10.5,
                                }}
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
            </PanelSection>
        </section>
    );
}
