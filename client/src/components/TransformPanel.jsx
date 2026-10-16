/**
 * client/src/components/TransformPanel.jsx
 *
 * Professional Transform & Keyframe Control Panel.
 *
 * ─── FEATURES ───────────────────────────────────────────────────────────────
 * 1. Granular Transform Controls:
 *    - Scale, Position X, Position Y, Rotation, and Opacity.
 *    - Live numeric inputs + responsive range sliders.
 *    - Scale resolution quality indicator (Sharp, Zoomed In, Extreme Zoom).
 *
 * 2. Per-Property Keyframing (NLE Stopwatch / Diamond):
 *    - Interactive diamond button (◆) on every animatable parameter.
 *    - Active highlight when a keyframe exists at the exact playhead position.
 *    - ◀ and ▶ keyframe stepper buttons to jump between keyframes instantly.
 *    - Adding a keyframe captures the current slider value at the playhead.
 *
 * 3. Scene Positions & Spatial Presets:
 *    - 9-Point Spatial Alignment Grid (Top-Left, Center, Bottom-Right, etc.).
 *    - Quick Scene Roles: Lower Third, Upper Headline, PiP, Side Card, Fullscreen.
 *    - Layer Depth Sandwiching: Toggle between Foreground and Behind Subject (SAM2 depth).
 *    - Safe Zone Snapping to preserve TikTok/Reels 9:16 & 16:9 UI boundaries.
 *
 * 4. Important Animations & Quick Motion Presets:
 *    - 1-click Entrance / Loop / Exit motion presets (Kinetic Slam, Elastic Snap,
 *      3D Flip, Pop In, Slide Up, Float, Pulse, etc.).
 *    - Real-time preset badge & 1-click Clear Animation button.
 *
 * 5. Expandable Visual Keyframe Timeline:
 *    - Integrated KeyframeEditor with draggable diamonds, easing curves,
 *      and parameter curve inspection directly inside the Transform tab.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import {
    Diamond,
    ChevronLeft,
    ChevronRight,
    RotateCcw,
    Sparkles,
    ChevronDown,
    Layers,
    Move,
    Maximize2,
    Shield,
    Clock,
    Eye
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

// 9-point grid positions (percentages 0-100)
const GRID_POINTS = [
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

// Common scene roles / positions
const SCENE_ROLES = [
    { id: 'lower_third', label: 'Lower Third', x: 50, y: 82, scale: null },
    { id: 'headline',    label: 'Headline',    x: 50, y: 18, scale: null },
    { id: 'pip',         label: 'PiP',         x: 82, y: 22, scale: 0.35 },
    { id: 'side_card',   label: 'Side Card',   x: 75, y: 50, scale: 0.80 },
    { id: 'reset_center',label: 'Full Center', x: 50, y: 50, scale: 1.00 },
];

export default function TransformPanel() {
    const { t } = useTranslation('editor');
    const [showKeyframeTimeline, setShowKeyframeTimeline] = useState(false);
    const [showPresets, setShowPresets] = useState(false);

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

    // Find selected clip and track
    const { clip, trackId, trackType } = useMemo(() => {
        for (const track of (tracks || [])) {
            for (const c of (track.clips || [])) {
                if (c.id === activeClipId) return { clip: c, trackId: track.id, trackType: track.type };
            }
        }
        return { clip: null, trackId: null, trackType: null };
    }, [tracks, activeClipId]);

    const layer = useMemo(() => (clip ? clipToMotionLayer(clip) : null), [clip]);

    // Local clip playhead time (seconds from clip start)
    const clipStart = Number(clip?.start) || 0;
    const clipDuration = Math.max(0.01, Number(clip?.duration) || 1);
    const localPlayhead = Math.max(0, Math.min(clipDuration, (currentTime || 0) - clipStart));

    // Param tracks for keyframes
    const paramTracks = useMemo(() => {
        if (!clip) return {};
        return animationsToParamTracks(clip.animations, clipDuration);
    }, [clip, clipDuration]);

    // Check keyframe state for a property at current playhead
    const getKeyframeState = useCallback((param) => {
        const list = paramTracks[param] || [];
        if (list.length === 0) return { hasAny: false, atPlayhead: null, prev: null, next: null };

        const threshold = 0.05; // 50ms tolerance
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

    // Toggle or Add keyframe at playhead for parameter
    const handleToggleKeyframe = useCallback((param, currentValue) => {
        if (!clip || !trackId) return;
        saveToHistory?.();

        const { atPlayhead } = getKeyframeState(param);
        if (atPlayhead) {
            // Remove keyframe at current playhead
            const updates = applyKeyframeOp(clip, {
                kind: 'remove',
                param,
                time: atPlayhead.time,
            });
            if (updates && Object.keys(updates).length > 0) {
                updateClip(trackId, clip.id, updates);
            }
        } else {
            // Add keyframe at current playhead with current value
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

    // Jump playhead to previous / next keyframe
    const handleJumpKeyframe = useCallback((targetKf) => {
        if (!targetKf || typeof seek !== 'function') return;
        const targetWorldTime = clipStart + targetKf.time;
        seek(targetWorldTime);
    }, [clipStart, seek]);

    // Dispatch direct clip transform update
    const handleValueChange = useCallback((key, value, commit = false) => {
        if (!clip || !trackId) return;
        if (commit) saveToHistory?.();
        updateClip(trackId, clip.id, { [key]: value }, { skipHistory: !commit });
    }, [clip, trackId, saveToHistory, updateClip]);

    // Apply scene alignment / position
    const handleApplyPosition = useCallback((newX, newY, newScale = null) => {
        if (!clip || !trackId) return;
        saveToHistory?.();
        const updates = { x: newX, y: newY };
        if (Number.isFinite(newScale)) updates.scale = newScale;
        updateClip(trackId, clip.id, updates);
    }, [clip, trackId, saveToHistory, updateClip]);

    // Toggle layer depth placement (behind speaker vs foreground)
    const handleToggleDepthPlacement = useCallback(() => {
        if (!clip || !trackId) return;
        saveToHistory?.();
        const current = clip.placement === 'behind_subject' ? 'foreground' : 'behind_subject';
        updateClip(trackId, clip.id, { placement: current });
    }, [clip, trackId, saveToHistory, updateClip]);

    // Reset all transforms to default
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

    // Keyframe editor bridge
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

    // Motion presets
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
                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">
                        {t('ideLayout.transform.title')}
                    </div>
                </div>
                <div className="p-6 rounded-lg border border-dashed border-border text-center bg-secondary/10">
                    <Move className="w-6 h-6 mx-auto mb-2 text-muted-foreground opacity-40" />
                    <p className="text-xs text-muted-foreground">{t('ideLayout.transform.selectClip')}</p>
                </div>
            </section>
        );
    }

    // Current property values
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

    // Properties list for rendering sliders + keyframe buttons
    const transformProperties = [
        {
            key: 'scale',
            label: t('ideLayout.transform.scale'),
            param: 'scale',
            min: 0.1,
            max: 3.0,
            step: 0.01,
            value: scaleVal,
            displayValue: `${displayScale}%`,
            quality: scaleQuality,
            fromInput: v => parseFloat(v) / 100,
        },
        {
            key: 'x',
            label: t('ideLayout.transform.positionX'),
            param: 'x',
            min: trackType === 'video' ? -1920 : -100,
            max: trackType === 'video' ? 1920 : 200,
            step: trackType === 'video' ? 1 : 0.5,
            value: xVal,
            displayValue: `${Math.round(xVal)}${trackType === 'video' ? 'px' : '%'}`,
            fromInput: v => parseFloat(v),
        },
        {
            key: 'y',
            label: t('ideLayout.transform.positionY'),
            param: 'y',
            min: trackType === 'video' ? -1080 : -100,
            max: trackType === 'video' ? 1080 : 200,
            step: trackType === 'video' ? 1 : 0.5,
            value: yVal,
            displayValue: `${Math.round(yVal)}${trackType === 'video' ? 'px' : '%'}`,
            fromInput: v => parseFloat(v),
        },
        {
            key: 'rotation',
            label: t('ideLayout.transform.rotation'),
            param: 'rotation',
            min: -180,
            max: 180,
            step: 1,
            value: rotationVal,
            displayValue: `${Math.round(rotationVal)}°`,
            fromInput: v => parseFloat(v),
        },
        {
            key: 'opacity',
            label: 'Opacity',
            param: 'opacity',
            min: 0,
            max: 1,
            step: 0.01,
            value: opacityVal,
            displayValue: `${Math.round(opacityVal * 100)}%`,
            fromInput: v => parseFloat(v) / 100,
        },
    ];

    return (
        <section className="p-4 border-b border-border/50 space-y-5">
            {/* Header / Active Indicator */}
            <div className="flex items-center justify-between pb-2 border-b border-border/40">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground font-semibold uppercase tracking-wider">
                        {t('ideLayout.transform.title')}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-mono uppercase">
                        {clip.type || trackType || 'clip'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground font-mono flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {localPlayhead.toFixed(2)}s / {clipDuration.toFixed(2)}s
                    </span>
                    <button
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
                <div className="pb-3 border-b border-border/40">
                    <LayoutPresetPicker trackId={trackId} clip={clip} />
                </div>
            )}

            {/* ─── SCENE POSITIONS & SPATIAL ANCHORS ─── */}
            <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                        <Move className="w-3.5 h-3.5 text-primary" />
                        Scene Position & Alignment
                    </span>
                    <button
                        onClick={handleToggleDepthPlacement}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1 border ${
                            isBehindSubject
                                ? 'bg-primary/20 border-primary text-primary'
                                : 'bg-secondary/60 border-border text-muted-foreground hover:text-foreground'
                        }`}
                        title="Render behind the subject using AI depth segmentation (SAM2)"
                    >
                        <Layers className="w-2.5 h-2.5" />
                        {isBehindSubject ? 'Behind Subject' : 'Foreground'}
                    </button>
                </div>

                {/* 9-Point Spatial Grid + Scene Roles */}
                <div className="grid grid-cols-12 gap-2 bg-secondary/30 p-2.5 rounded-lg border border-border/40">
                    {/* 3x3 Grid Buttons */}
                    <div className="col-span-5 grid grid-cols-3 gap-1 bg-black/20 p-1.5 rounded-md border border-border/50">
                        {GRID_POINTS.map(pt => {
                            const isSelected = Math.abs(xVal - pt.x) < 4 && Math.abs(yVal - pt.y) < 4;
                            return (
                                <button
                                    key={pt.id}
                                    onClick={() => handleApplyPosition(pt.x, pt.y)}
                                    title={pt.title}
                                    className={`h-7 rounded flex items-center justify-center text-[10px] font-mono transition-all ${
                                        isSelected
                                            ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                                            : 'bg-secondary/60 text-muted-foreground hover:bg-white/10 hover:text-foreground'
                                    }`}
                                >
                                    {pt.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Quick Scene Roles */}
                    <div className="col-span-7 flex flex-col justify-between gap-1">
                        {SCENE_ROLES.map(role => (
                            <button
                                key={role.id}
                                onClick={() => handleApplyPosition(role.x, role.y, role.scale)}
                                className="px-2 py-1 rounded bg-secondary/60 hover:bg-white/10 text-[11px] text-left text-foreground flex items-center justify-between border border-transparent hover:border-border transition-colors"
                            >
                                <span>{role.label}</span>
                                <span className="text-[9px] text-muted-foreground font-mono">
                                    {role.x}%, {role.y}%
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ─── GRANULAR TRANSFORM CONTROLS WITH KEYFRAME BUTTONS ─── */}
            <div className="space-y-3.5 pt-2 border-t border-border/40">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                        <Maximize2 className="w-3.5 h-3.5 text-primary" />
                        Transform & Keyframing
                    </span>
                    <button
                        onClick={() => setShowKeyframeTimeline(!showKeyframeTimeline)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-1"
                    >
                        <Diamond className="w-2.5 h-2.5" />
                        {showKeyframeTimeline ? 'Hide Curves' : 'Visual Timeline'}
                    </button>
                </div>

                {transformProperties.map(prop => {
                    const kfState = getKeyframeState(prop.param);
                    const isKeyframedAtPlayhead = !!kfState.atPlayhead;
                    const hasAnyKeyframes = kfState.hasAny;

                    return (
                        <div key={prop.key} className="space-y-1.5 bg-secondary/20 p-2 rounded-lg border border-border/30">
                            {/* Property Label + Keyframe Toolbar */}
                            <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5">
                                    {/* Keyframe Stopwatch / Diamond Toggle */}
                                    <button
                                        onClick={() => handleToggleKeyframe(prop.param, prop.value)}
                                        title={
                                            isKeyframedAtPlayhead
                                                ? `Remove keyframe at ${localPlayhead.toFixed(2)}s`
                                                : `Add keyframe at ${localPlayhead.toFixed(2)}s`
                                        }
                                        className={`p-1 rounded transition-all ${
                                            isKeyframedAtPlayhead
                                                ? 'bg-primary text-primary-foreground shadow-sm scale-110'
                                                : hasAnyKeyframes
                                                    ? 'bg-primary/20 text-primary hover:bg-primary/30'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                                        }`}
                                    >
                                        <Diamond className="w-3 h-3 fill-current" />
                                    </button>

                                    {/* Stepper buttons (prev / next) */}
                                    {hasAnyKeyframes && (
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                disabled={!kfState.prev}
                                                onClick={() => handleJumpKeyframe(kfState.prev)}
                                                title={kfState.prev ? `Jump to previous keyframe (${kfState.prev.time.toFixed(2)}s)` : 'No previous keyframe'}
                                                className={`p-0.5 rounded text-[10px] ${
                                                    kfState.prev ? 'text-muted-foreground hover:text-foreground hover:bg-secondary' : 'opacity-20 cursor-not-allowed'
                                                }`}
                                            >
                                                <ChevronLeft className="w-3 h-3" />
                                            </button>
                                            <button
                                                disabled={!kfState.next}
                                                onClick={() => handleJumpKeyframe(kfState.next)}
                                                title={kfState.next ? `Jump to next keyframe (${kfState.next.time.toFixed(2)}s)` : 'No next keyframe'}
                                                className={`p-0.5 rounded text-[10px] ${
                                                    kfState.next ? 'text-muted-foreground hover:text-foreground hover:bg-secondary' : 'opacity-20 cursor-not-allowed'
                                                }`}
                                            >
                                                <ChevronRight className="w-3 h-3" />
                                            </button>
                                        </div>
                                    )}

                                    <span className="font-medium text-foreground">{prop.label}</span>
                                </div>

                                <div className="flex items-center gap-2">
                                    {prop.quality && (
                                        <span className="flex items-center gap-1">
                                            <span
                                                className="w-1.5 h-1.5 rounded-full inline-block"
                                                style={{ background: prop.quality.color, boxShadow: `0 0 4px ${prop.quality.color}` }}
                                            />
                                            <span className="text-[10px]" style={{ color: prop.quality.color }}>
                                                {prop.quality.label}
                                            </span>
                                        </span>
                                    )}
                                    <span className="text-muted-foreground font-mono text-[11px]">
                                        {prop.displayValue}
                                    </span>
                                </div>
                            </div>

                            {/* Range slider */}
                            <input
                                type="range"
                                min={prop.min}
                                max={prop.max}
                                step={prop.step}
                                value={prop.value}
                                onChange={(e) => handleValueChange(prop.key, parseFloat(e.target.value), false)}
                                onPointerUp={(e) => handleValueChange(prop.key, parseFloat(e.target.value), true)}
                                className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer"
                            />
                        </div>
                    );
                })}
            </div>

            {/* ─── VISUAL KEYFRAME TIMELINE & CURVES (Expandable) ─── */}
            {showKeyframeTimeline && (
                <div className="pt-3 border-t border-border/40 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground flex items-center gap-1.5">
                            <Diamond className="w-3.5 h-3.5 text-primary" />
                            Keyframe Editor & Easing Curves
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                            Drag markers to retime
                        </span>
                    </div>

                    {editorModel && (
                        <div className="bg-black/30 p-2 rounded-lg border border-border/50">
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
                </div>
            )}

            {/* ─── IMPORTANT ANIMATIONS & MOTION PRESETS ─── */}
            <div className="pt-3 border-t border-border/40 space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-primary" />
                        Important Animations
                    </span>
                    <button
                        onClick={() => setShowPresets(!showPresets)}
                        className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                    >
                        {showPresets ? 'Less' : 'More Presets'}
                        <ChevronDown className={`w-3 h-3 transition-transform ${showPresets ? 'rotate-180' : ''}`} />
                    </button>
                </div>

                {/* Status + Clear */}
                <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-secondary/30 border border-border/30 text-[11px]">
                    <span className="text-muted-foreground truncate">
                        {activePresetId
                            ? `Active: ${MOTION_PRESETS[activePresetId]?.label || activePresetId}`
                            : (clip.animations?.length > 0)
                                ? 'Custom Keyframes'
                                : 'No animation applied'}
                    </span>
                    {(activePresetId || clip.animations?.length > 0) && (
                        <button
                            onClick={handleClearAnimations}
                            className="px-1.5 py-0.5 text-[10px] rounded bg-secondary hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                        >
                            <RotateCcw className="w-2.5 h-2.5" /> Clear
                        </button>
                    )}
                </div>

                {/* Quick Presets Grid */}
                <div className="grid grid-cols-2 gap-1.5">
                    {(showPresets ? availablePresets : availablePresets.slice(0, 6)).map(presetId => {
                        const preset = MOTION_PRESETS[presetId];
                        const isActive = activePresetId === presetId;
                        return (
                            <button
                                key={presetId}
                                onClick={() => handleApplyPreset(presetId)}
                                className={`px-2 py-1.5 rounded text-[11px] text-left transition-all border flex items-center justify-between ${
                                    isActive
                                        ? 'bg-primary/20 border-primary text-primary font-semibold shadow-sm'
                                        : 'bg-secondary/60 border-transparent hover:bg-white/10 text-foreground'
                                }`}
                            >
                                <span className="truncate">{preset?.label || presetId}</span>
                                <Sparkles className={`w-2.5 h-2.5 shrink-0 ml-1 ${isActive ? 'text-primary' : 'opacity-40'}`} />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Quality Note */}
            <p className="text-[10px] leading-relaxed pt-1 text-muted-foreground" style={{ fontFamily: 'var(--f-sans)' }}>
                {t('ideLayout.transform.qualityNote')}
            </p>
        </section>
    );
}
