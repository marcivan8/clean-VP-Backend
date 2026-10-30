/**
 * client/src/components/TransformPanel.jsx
 *
 * Streamlined, Professional Transform & Keyframe Inspector.
 *
 * ─── KEY HIGHLIGHTS ──────────────────────────────────────────────────────────
 * 1. Clean, uncluttered layout:
 *    - Compact paired controls (X & Y, Scale & Rotation) like Figma/After Effects.
 *    - Reduces vertical density by >60% while retaining full functionality.
 *
 * 2. Dual-Mode Input (Scrubbing + Typing):
 *    - Drag left/right on any value/label to scrub numbers smoothly (with Shift for 5x, Alt for 0.2x).
 *    - Click directly to type an exact numeric value; commits on Enter/blur.
 *    - Integrated mini slider track for instant full-range scrubbing.
 *
 * 3. Precision Keyframing (NLE Stopwatch / Diamond):
 *    - Diamond button (◆) next to each property.
 *    - Golden highlight when playhead sits on a keyframe; steppers (◀ ▶) to jump between keyframes.
 *
 * 4. Lightweight Spatial Align & Depth:
 *    - Compact 9-point anchor widget + quick roles (Center, Lower-Third, PiP).
 *    - 1-click Depth Sandwiching toggle ("Behind Subject" via SAM2 segmentation).
 *
 * 5. Collapsible Advanced Drawers:
 *    - "Motion Presets" (1-click animations like Pop, Slam, Float, Bounce).
 *    - "Keyframe Curves" (visual timeline for curve & timing editing).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import {
    Diamond,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
    Layers,
    Move,
    Clock
} from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import {
    buildEditorModel,
    applyKeyframeOp,
    animationsToParamTracks,
    MOTION_PARAM_DEFS
} from '../motion/KeyframeBridge.js';
import {
    applyPresetToClip,
    clipToMotionLayer
} from '../motion/ClipAdapter.js';
import {
    MOTION_PRESETS,
    presetsForKind
} from '../motion/MotionPresets.js';
import KeyframeEditor from './Effects/KeyframeEditor.jsx';
import LayoutPresetPicker from './LayoutPresetPicker.jsx';
import { PanelSection, NumberField, TrackSlider, Segmented } from './ui/PanelControls.jsx';
import { clampTo } from './ui/panelControls.js';

/**
 * Scrubbable & Directly-Typed Number Input
 * - Drag left/right to scrub smoothly.
 * - Click to type exact number.
 * - Mini track slider below for broad scrubbing.
 */
/**
 * One ◀ / ▶ keyframe stepper. Disabled, not hidden, so the row never reflows
 * as keyframes are added and removed.
 *
 * The icon is chosen from `dir` rather than passed in: this project's eslint
 * has no `react/jsx-uses-vars`, so a component ARRIVING as a prop and rendered
 * as JSX is reported as an unused variable. Picking it here keeps the lint
 * honest instead of silencing it.
 */
function StepperBtn({ to, onJump, title, dir }) {
    return (
        <button
            type="button"
            disabled={!to}
            onClick={() => onJump(to)}
            title={title}
            aria-label={title}
            style={{
                display: 'flex', padding: 1, border: 0, background: 'none',
                cursor: to ? 'pointer' : 'default',
                color: 'var(--fg-3)', opacity: to ? 1 : 0.2,
            }}
        >
            {dir === 'prev' ? <ChevronLeft className="w-2.5 h-2.5" /> : <ChevronRight className="w-2.5 h-2.5" />}
        </button>
    );
}

/**
 * One transform property: keyframe diamond, label, scrubbable value, track.
 *
 * R118 — rebuilt on the shared panel kit (components/ui/PanelControls.jsx).
 * What this component used to own and now gets from the kit: the number box,
 * the drag-to-scrub behaviour (moved INTO `NumberField`, so every numeric
 * control in the app has it now, not just this panel), the track, and the
 * label row.
 *
 * What stays here, because nothing else in the app has it: the keyframe
 * diamond and the ◀ ▶ steppers. They are about TIME, not value — the one
 * piece of state that explains why a property changes mid-clip — so they sit
 * beside the label rather than being folded into a generic control.
 */
function ScrubbableField({
    label,
    value,
    min = -Infinity,
    max = Infinity,
    step = 1,
    unit = '',
    displayFactor = 1,
    precision = 0,
    onChange,
    kfState,
    onToggleKf,
    onJumpKf,
    qualityBadge,
}) {
    const { t } = useTranslation('editor');
    const isKfAtPlayhead = !!kfState?.atPlayhead;
    const hasAnyKf = !!kfState?.hasAny;
    const hasRange = Number.isFinite(min) && Number.isFinite(max) && max > min;

    // The store keeps raw values (scale 0..5); the panel shows them in the
    // unit a person thinks in (100%). The kit works in DISPLAY units, so the
    // conversion happens at this boundary and nowhere else.
    const shown = Number.isFinite(value) ? value * displayFactor : 0;
    const toRaw = (v) => clampTo(v / displayFactor, min, max);
    const dStep = step * displayFactor;
    const dMin = hasRange ? min * displayFactor : -Infinity;
    const dMax = hasRange ? max * displayFactor : Infinity;

    return (
        <div style={{ display: 'grid', gap: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 16 }}>
                {onToggleKf && (
                    <button
                        type="button"
                        onClick={onToggleKf}
                        aria-pressed={isKfAtPlayhead}
                        title={isKfAtPlayhead ? t('transform.kfRemove', 'Remove keyframe') : t('transform.kfAdd', 'Add keyframe at playhead')}
                        aria-label={isKfAtPlayhead ? t('transform.kfRemove', 'Remove keyframe') : t('transform.kfAdd', 'Add keyframe at playhead')}
                        style={{
                            display: 'flex', padding: 1, border: 0, background: 'none', cursor: 'pointer',
                            color: isKfAtPlayhead ? 'var(--accent)' : hasAnyKf ? 'var(--fg-2)' : 'var(--fg-4)',
                            transform: isKfAtPlayhead ? 'scale(1.15)' : 'none',
                            transition: 'color 0.12s, transform 0.12s',
                        }}
                    >
                        <Diamond className="w-2.5 h-2.5" fill="currentColor" />
                    </button>
                )}
                {hasAnyKf && onJumpKf && (
                    <span style={{ display: 'flex' }}>
                        <StepperBtn
                            to={kfState.prev}
                            onJump={onJumpKf}
                            title={t('transform.kfPrev', 'Previous keyframe')}
                            dir="prev"
                        />
                        <StepperBtn
                            to={kfState.next}
                            onJump={onJumpKf}
                            title={t('transform.kfNext', 'Next keyframe')}
                            dir="next"
                        />
                    </span>
                )}
                <span style={{
                    flex: 1, minWidth: 0, fontFamily: 'var(--f-sans)', fontSize: 11,
                    color: 'var(--fg-3)', userSelect: 'none',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {label}
                </span>
                {qualityBadge && (
                    <span
                        title={qualityBadge.label}
                        style={{
                            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                            background: qualityBadge.color,
                            boxShadow: `0 0 3px ${qualityBadge.color}`,
                        }}
                    />
                )}
            </div>

            {/* The box sits ABOVE the track, not beside it. Four of these share
                two columns in a ~320px panel: side by side, the slider gets
                about 85px and stops being draggable with any precision, which
                is the whole point of having one. Stacked, both are full width. */}
            <NumberField
                ariaLabel={label}
                value={shown}
                min={dMin}
                max={dMax}
                step={dStep}
                unit={unit}
                decimals={precision}
                scrub
                onChange={(v) => onChange(toRaw(v), false)}
                onCommit={() => onChange(value, true)}
            />
            {hasRange && (
                <TrackSlider
                    ariaLabel={label}
                    value={shown}
                    min={dMin}
                    max={dMax}
                    step={dStep}
                    box={false}
                    onChange={(v) => onChange(toRaw(v), false)}
                    onCommit={(v) => onChange(v === undefined ? value : toRaw(v), true)}
                />
            )}
        </div>
    );
}

const QUICK_ALIGN_POINTS = [
    { id: 'tl', label: 'TL', x: 15, y: 15, title: 'Top Left' },
    { id: 'tc', label: 'TC', x: 50, y: 15, title: 'Top Center' },
    { id: 'tr', label: 'TR', x: 85, y: 15, title: 'Top Right' },
    { id: 'ml', label: 'ML', x: 15, y: 50, title: 'Middle Left' },
    { id: 'c',  label: 'C',  x: 50, y: 50, title: 'Center' },
    { id: 'mr', label: 'MR', x: 85, y: 50, title: 'Middle Right' },
    { id: 'bl', label: 'BL', x: 15, y: 85, title: 'Bottom Left' },
    { id: 'bc', label: 'BC', x: 50, y: 85, title: 'Bottom Center' },
    { id: 'br', label: 'BR', x: 85, y: 85, title: 'Bottom Right' },
];

export default function TransformPanel() {
    const { t } = useTranslation('editor');
    const [presetSearch, setPresetSearch] = useState('');
    const presetSearchQuery = presetSearch.trim().toLowerCase();

    const {
        tracks,
        activeClipId,
        currentTime,
        updateClip,
        saveToHistory,
        seek
    } = useTimelineStore(
        useShallow(state => ({
            tracks:        state.tracks,
            activeClipId:  state.activeClipId,
            currentTime:   state.currentTime,
            updateClip:    state.updateClip,
            saveToHistory: state.saveToHistory,
            seek:          state.seek,
        }))
    );

    // Resolve selected clip and track
    const { clip, trackId, trackType } = useMemo(() => {
        for (const track of (tracks || [])) {
            for (const c of (track.clips || [])) {
                if (c.id === activeClipId) return { clip: c, trackId: track.id, trackType: track.type };
            }
        }
        return { clip: null, trackId: null, trackType: null };
    }, [tracks, activeClipId]);

    const layer = useMemo(() => (clip ? clipToMotionLayer(clip) : null), [clip]);

    // Local playhead time
    const clipStart = Number(clip?.start) || 0;
    const clipDuration = Math.max(0.01, Number(clip?.duration) || 1);
    const localPlayhead = Math.max(0, Math.min(clipDuration, (currentTime || 0) - clipStart));

    // Param tracks for keyframes
    const paramTracks = useMemo(() => {
        if (!clip) return {};
        return animationsToParamTracks(clip.animations, clipDuration);
    }, [clip, clipDuration]);

    // Check keyframe state for a parameter
    const getKeyframeState = useCallback((param) => {
        const list = paramTracks[param] || [];
        if (list.length === 0) return { hasAny: false, atPlayhead: null, prev: null, next: null };

        const threshold = 0.05;
        let atPlayhead = null;
        let prev = null;
        let next = null;

        for (const kf of list) {
            if (Math.abs(kf.time - localPlayhead) <= threshold) {
                atPlayhead = kf;
            } else if (kf.time < localPlayhead - threshold) {
                if (!prev || kf.time > prev.time) prev = kf;
            } else if (kf.time > localPlayhead + threshold) {
                if (!next || kf.time < next.time) next = kf;
            }
        }

        return { hasAny: true, atPlayhead, prev, next, count: list.length };
    }, [paramTracks, localPlayhead]);

    // Toggle keyframe at playhead
    const handleToggleKeyframe = useCallback((param, currentValue) => {
        if (!clip || !trackId) return;
        saveToHistory?.();

        const { atPlayhead } = getKeyframeState(param);
        if (atPlayhead) {
            const updates = applyKeyframeOp(clip, {
                kind: 'remove',
                param,
                time: atPlayhead.time,
            });
            if (updates && Object.keys(updates).length > 0) {
                updateClip(trackId, clip.id, updates);
            }
        } else {
            const def = MOTION_PARAM_DEFS[param];
            const rawVal = Number.isFinite(currentValue) ? currentValue : (def?.neutral ?? 0);
            const updates = applyKeyframeOp(clip, {
                kind: 'add',
                param,
                time: localPlayhead,
                value: rawVal,
                easing: 'easeOutCubic',
            });
            if (updates && Object.keys(updates).length > 0) {
                updateClip(trackId, clip.id, updates);
            }
        }
    }, [clip, trackId, getKeyframeState, localPlayhead, saveToHistory, updateClip]);

    // Jump playhead to keyframe
    const handleJumpKeyframe = useCallback((targetKf) => {
        if (!targetKf || typeof seek !== 'function') return;
        seek(clipStart + targetKf.time);
    }, [clipStart, seek]);

    // Dispatch clip transform update
    const handleValueChange = useCallback((key, val, commit = false) => {
        if (!clip || !trackId) return;
        if (commit) saveToHistory?.();
        updateClip(trackId, clip.id, { [key]: val }, { skipHistory: !commit });
    }, [clip, trackId, saveToHistory, updateClip]);

    // Scene positioning
    const handleApplyPosition = useCallback((newX, newY, newScale = null) => {
        if (!clip || !trackId) return;
        saveToHistory?.();
        const updates = { x: newX, y: newY };
        if (Number.isFinite(newScale)) updates.scale = newScale;
        updateClip(trackId, clip.id, updates);
    }, [clip, trackId, saveToHistory, updateClip]);

    // Depth placement
    const handleToggleDepthPlacement = useCallback(() => {
        if (!clip || !trackId) return;
        saveToHistory?.();
        const current = clip.placement === 'behind_subject' ? 'foreground' : 'behind_subject';
        updateClip(trackId, clip.id, { placement: current });
    }, [clip, trackId, saveToHistory, updateClip]);

    // Reset all transforms
    const handleResetAll = useCallback(() => {
        if (!clip || !trackId) return;
        saveToHistory?.();
        updateClip(trackId, clip.id, {
            scale: 1,
            x: trackType === 'video' ? 0 : 50,
            y: trackType === 'video' ? 0 : 50,
            rotation: 0,
            opacity: 1,
            animations: [],
            animation: 'none',
            placement: 'foreground',
        });
    }, [clip, trackId, trackType, saveToHistory, updateClip]);

    // Keyframe editor callbacks
    const editorModel = useMemo(() => buildEditorModel(clip), [clip]);

    const handleKeyframeEditorAdd = useCallback((_effectId, param, time, value, easing) => {
        if (!clip || !trackId) return;
        const updates = applyKeyframeOp(clip, { kind: 'add', param, time, value, easing });
        if (updates && Object.keys(updates).length > 0) {
            saveToHistory?.();
            updateClip(trackId, clip.id, updates);
        }
    }, [clip, trackId, saveToHistory, updateClip]);

    const handleKeyframeEditorRemove = useCallback((_effectId, param, time) => {
        if (!clip || !trackId) return;
        const updates = applyKeyframeOp(clip, { kind: 'remove', param, time });
        if (updates && Object.keys(updates).length > 0) {
            saveToHistory?.();
            updateClip(trackId, clip.id, updates);
        }
    }, [clip, trackId, saveToHistory, updateClip]);

    // Presets
    const availablePresets = useMemo(() => {
        if (!layer) return [];
        return presetsForKind(layer.kind);
    }, [layer]);

    const activePresetId = useMemo(() => {
        const anims = clip?.animations;
        if (!Array.isArray(anims) || anims.length === 0) return null;
        return anims[0]?.presetId || null;
    }, [clip]);

    const handleApplyPreset = useCallback((presetId) => {
        if (!clip || !trackId) return;
        try {
            const updates = applyPresetToClip(clip, presetId);
            if (!updates || Object.keys(updates).length === 0) return;
            saveToHistory?.();
            updateClip(trackId, clip.id, updates);
        } catch (err) {
            console.error('[TransformPanel] applyPreset failed:', err.message);
        }
    }, [clip, trackId, saveToHistory, updateClip]);

    const handleClearAnimations = useCallback(() => {
        if (!clip || !trackId) return;
        saveToHistory?.();
        updateClip(trackId, clip.id, { animations: [], animation: 'none' });
    }, [clip, trackId, saveToHistory, updateClip]);

    if (!clip) {
        return (
            <section className="p-4 border-b border-border/50">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        {t('ideLayout.transform.title')}
                    </span>
                </div>
                <div className="p-6 rounded-lg border border-dashed border-border text-center bg-secondary/10">
                    <Move className="w-5 h-5 mx-auto mb-1.5 text-muted-foreground opacity-40" />
                    <p className="text-xs text-muted-foreground">{t('ideLayout.transform.selectClip')}</p>
                </div>
            </section>
        );
    }

    // Property values
    const scaleVal = clip.scale ?? 1;
    const xVal = clip.x ?? (trackType === 'video' ? 0 : 50);
    const yVal = clip.y ?? (trackType === 'video' ? 0 : 50);
    const rotationVal = clip.rotation ?? 0;
    const opacityVal = clip.opacity ?? 1;
    const isBehindSubject = clip.placement === 'behind_subject';

    // Scale quality badge
    const displayScale = Math.round(scaleVal * 100);
    const scaleQuality = displayScale <= 150
        ? { color: '#34d399', label: t('ideLayout.transform.qualitySharp') }
        : displayScale <= 250
            ? { color: '#fbbf24', label: t('ideLayout.transform.qualityZoomedIn') }
            : { color: '#f87171', label: t('ideLayout.transform.qualityExtremeZoom') };

    const isVideo = trackType === 'video';

    return (
        <section className="p-3.5 border-b border-border/50 space-y-3.5">
            {/* Header: Title, Type badge, Timing, and Reset */}
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-foreground font-semibold uppercase tracking-wider">
                        {t('ideLayout.transform.title')}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-primary/15 text-primary font-mono uppercase">
                        {clip.type || trackType || 'clip'}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-0.5" title="Clip playhead position">
                        <Clock className="w-2.5 h-2.5" />
                        {localPlayhead.toFixed(2)}s
                    </span>
                    <button
                        type="button"
                        onClick={handleResetAll}
                        title={t('ideLayout.transform.reset')}
                        className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <RotateCcw className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Layout Preset Picker for overlay tracks */}
            {trackType === 'overlay' && (clip.type === 'video' || clip.type === 'image') && (
                <div className="pb-2 border-b border-border/40">
                    <LayoutPresetPicker trackId={trackId} clip={clip} />
                </div>
            )}

            {/* ─── COMPACT PAIRED TRANSFORM GRID ─── */}
            <div className="space-y-2">
                {/* Row 1: Position X and Position Y side by side */}
                <div className="grid grid-cols-2 gap-2">
                    <ScrubbableField
                        label="Position X"
                        value={xVal}
                        min={isVideo ? -1920 : -100}
                        max={isVideo ? 1920 : 200}
                        step={isVideo ? 1 : 0.5}
                        unit={isVideo ? 'px' : '%'}
                        onChange={(v, c) => handleValueChange('x', v, c)}
                        kfState={getKeyframeState('x')}
                        onToggleKf={() => handleToggleKeyframe('x', xVal)}
                        onJumpKf={handleJumpKeyframe}
                    />

                    <ScrubbableField
                        label="Position Y"
                        value={yVal}
                        min={isVideo ? -1080 : -100}
                        max={isVideo ? 1080 : 200}
                        step={isVideo ? 1 : 0.5}
                        unit={isVideo ? 'px' : '%'}
                        onChange={(v, c) => handleValueChange('y', v, c)}
                        kfState={getKeyframeState('y')}
                        onToggleKf={() => handleToggleKeyframe('y', yVal)}
                        onJumpKf={handleJumpKeyframe}
                    />
                </div>

                {/* Row 2: Scale and Rotation side by side */}
                <div className="grid grid-cols-2 gap-2">
                    <ScrubbableField
                        label={t('ideLayout.transform.scale')}
                        value={scaleVal}
                        min={0.1}
                        max={3.0}
                        step={0.01}
                        displayFactor={100}
                        unit="%"
                        qualityBadge={scaleQuality}
                        onChange={(v, c) => handleValueChange('scale', v, c)}
                        kfState={getKeyframeState('scale')}
                        onToggleKf={() => handleToggleKeyframe('scale', scaleVal)}
                        onJumpKf={handleJumpKeyframe}
                    />

                    <ScrubbableField
                        label={t('ideLayout.transform.rotation')}
                        value={rotationVal}
                        min={-180}
                        max={180}
                        step={1}
                        unit="°"
                        onChange={(v, c) => handleValueChange('rotation', v, c)}
                        kfState={getKeyframeState('rotation')}
                        onToggleKf={() => handleToggleKeyframe('rotation', rotationVal)}
                        onJumpKf={handleJumpKeyframe}
                    />
                </div>

                {/* Row 3: Opacity full width */}
                <ScrubbableField
                    label="Opacity"
                    value={opacityVal}
                    min={0}
                    max={1}
                    step={0.01}
                    displayFactor={100}
                    unit="%"
                    onChange={(v, c) => handleValueChange('opacity', v, c)}
                    kfState={getKeyframeState('opacity')}
                    onToggleKf={() => handleToggleKeyframe('opacity', opacityVal)}
                    onJumpKf={handleJumpKeyframe}
                />
            </div>

            {/* ─── ALIGN & DEPTH ─── */}
            <PanelSection
                title={t('transform.alignDepth', 'Align & Depth')}
                collapsible
                defaultOpen={false}
                right={(
                    <button
                        type="button"
                        onClick={handleToggleDepthPlacement}
                        aria-pressed={isBehindSubject}
                        title={t('transform.depthHint', 'Render behind the speaker (SAM2 segmentation)')}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            height: 20, padding: '0 7px', borderRadius: 'var(--r-xs)',
                            cursor: 'pointer', fontFamily: 'var(--f-sans)', fontSize: 10,
                            border: `0.5px solid ${isBehindSubject ? 'var(--accent)' : 'var(--line)'}`,
                            background: isBehindSubject ? 'var(--accent-soft)' : 'var(--glass)',
                            color: isBehindSubject ? 'var(--accent)' : 'var(--fg-3)',
                        }}
                    >
                        <Layers className="w-2.5 h-2.5" />
                        {isBehindSubject
                            ? t('transform.behindSubject', 'Behind Subject')
                            : t('transform.foreground', 'Foreground')}
                    </button>
                )}
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {/* 9-point anchor. A real radiogroup: one tab stop, arrows
                        inside it, and the selected anchor announced. */}
                    <div
                        role="radiogroup"
                        aria-label={t('transform.anchor', 'Anchor')}
                        style={{
                            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2,
                            padding: 3, flexShrink: 0, borderRadius: 'var(--r-xs)',
                            background: 'var(--glass)', border: '0.5px solid var(--line)',
                        }}
                    >
                        {QUICK_ALIGN_POINTS.map(pt => {
                            const isSelected = Math.abs(xVal - pt.x) < 4 && Math.abs(yVal - pt.y) < 4;
                            return (
                                <button
                                    key={pt.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    onClick={() => handleApplyPosition(pt.x, pt.y)}
                                    title={pt.title}
                                    style={{
                                        width: 20, height: 20, border: 0, cursor: 'pointer',
                                        borderRadius: 'calc(var(--r-xs) - 2px)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontFamily: 'var(--f-mono)', fontSize: 8,
                                        fontWeight: isSelected ? 700 : 500,
                                        background: isSelected ? 'var(--accent)' : 'transparent',
                                        color: isSelected ? '#fff' : 'var(--fg-3)',
                                        transition: 'background 0.12s, color 0.12s',
                                    }}
                                >
                                    {pt.label}
                                </button>
                            );
                        })}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1 }}>
                        {[
                            { key: 'center',   label: t('transform.roleCenter', 'Center'),     x: 50, y: 50, scale: 1 },
                            { key: 'lower3rd', label: t('transform.roleLower3rd', 'Lower 3rd'), x: 50, y: 82, scale: null },
                            { key: 'headline', label: t('transform.roleHeadline', 'Headline'),  x: 50, y: 18, scale: null },
                            { key: 'pip',      label: t('transform.rolePip', 'PiP'),            x: 82, y: 22, scale: 0.35 },
                        ].map(role => (
                            <button
                                key={role.key}
                                type="button"
                                onClick={() => handleApplyPosition(role.x, role.y, role.scale)}
                                style={{
                                    height: 26, borderRadius: 'var(--r-xs)', cursor: 'pointer',
                                    border: '0.5px solid var(--line)', background: 'var(--glass)',
                                    color: 'var(--fg-2)', fontFamily: 'var(--f-sans)', fontSize: 10.5,
                                }}
                            >
                                {role.label}
                            </button>
                        ))}
                    </div>
                </div>
            </PanelSection>

            {/* ─── MOTION PRESETS ─── */}
            <PanelSection
                title={t('transform.motionPresets', 'Motion Presets')}
                collapsible
                defaultOpen={false}
                onReset={activePresetId ? handleClearAnimations : null}
                resetLabel={t('transform.clearAnimation', 'Clear')}
                right={activePresetId ? (
                    <span style={{
                        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap', fontFamily: 'var(--f-sans)', fontSize: 10,
                        color: 'var(--accent)',
                    }}>
                        {MOTION_PRESETS[activePresetId]?.label || activePresetId}
                    </span>
                ) : null}
            >
                <input
                    type="search"
                    value={presetSearch}
                    onChange={event => setPresetSearch(event.target.value)}
                    placeholder={t('motionPanel.searchPresets')}
                    aria-label={t('motionPanel.searchPresets')}
                    style={{
                        width: '100%', height: 30, marginBottom: 6, padding: '0 8px',
                        borderRadius: 'var(--r-xs)', border: '0.5px solid var(--line)',
                        background: 'var(--glass)', color: 'var(--fg-1)',
                        fontFamily: 'var(--f-sans)', fontSize: 10.5,
                    }}
                />
                <div
                    role="radiogroup"
                    aria-label={t('transform.motionPresets', 'Motion Presets')}
                    style={{
                        display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 4,
                        maxHeight: 216, overflowY: 'auto', paddingRight: 2,
                    }}
                >
                    {availablePresets.filter(presetId => !presetSearchQuery || `${MOTION_PRESETS[presetId]?.label || presetId} ${presetId}`.toLowerCase().includes(presetSearchQuery)).map(presetId => {
                        const preset = MOTION_PRESETS[presetId];
                        const isActive = activePresetId === presetId;
                        return (
                            <button
                                key={presetId}
                                type="button"
                                role="radio"
                                aria-checked={isActive}
                                onClick={() => handleApplyPreset(presetId)}
                                title={preset?.label || presetId}
                                style={{
                                    height: 28, padding: '0 6px', cursor: 'pointer',
                                    borderRadius: 'var(--r-xs)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    fontFamily: 'var(--f-sans)', fontSize: 10.5,
                                    fontWeight: isActive ? 600 : 500,
                                    border: `0.5px solid ${isActive ? 'var(--accent)' : 'var(--line)'}`,
                                    background: isActive ? 'var(--accent-soft)' : 'var(--glass)',
                                    color: isActive ? 'var(--accent)' : 'var(--fg-2)',
                                    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
                                }}
                            >
                                {preset?.label || presetId}
                            </button>
                        );
                    })}
                </div>
            </PanelSection>

            {/* ─── KEYFRAME CURVES ─── */}
            <PanelSection
                title={t('transform.keyframeCurves', 'Keyframe Curves & Timeline')}
                collapsible
                defaultOpen={false}
            >
                {editorModel && (
                    <div style={{
                        padding: 8, borderRadius: 'var(--r-sm)',
                        background: 'var(--glass)', border: '0.5px solid var(--line)',
                    }}>
                        <KeyframeEditor
                            effect={editorModel.effect}
                            definition={editorModel.definition}
                            duration={editorModel.duration}
                            playhead={localPlayhead}
                            onAddKeyframe={handleKeyframeEditorAdd}
                            onUpdateKeyframe={handleKeyframeEditorAdd}
                            onRemoveKeyframe={handleKeyframeEditorRemove}
                        />
                    </div>
                )}
            </PanelSection>
        </section>
    );
}
