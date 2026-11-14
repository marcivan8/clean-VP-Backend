import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Sliders,
    CircleDot,
    TrendingUp,
    Palette,
    Film,
    Activity,
    Copy,
    ClipboardCheck,
    RotateCcw,
    Eye,
    EyeOff,
    CheckCheck,
    Upload,
    Search,
    Loader2
} from 'lucide-react';
import ColorWheels from './ColorWheels.jsx';
import CurvesEditor from './CurvesEditor.jsx';
import VideoScopes from './VideoScopes.jsx';
import LUTCard from '../LUTCard.jsx';
import useTimelineStore from '../../store/useTimelineStore.js';
import { useAudioEngine } from '../../hooks/useAudioEngine.js';
import { audioEngineAPI } from '../../audio-engine/AudioEngineAPI.js';
import { lutToGrading } from '../../utils/lutGrading.js';

const TABS = [
    { key: 'tone',      label: 'Tone',      icon: Sliders    },
    { key: 'wheels',    label: 'Wheels',    icon: CircleDot  },
    { key: 'curves',    label: 'Curves',    icon: TrendingUp },
    { key: 'selective', label: 'HSL',       icon: Palette    },
    { key: 'luts',      label: 'LUTs',      icon: Film       },
];

const HSL_RANGES = [
    { key: 'reds',     label: 'Reds',     color: '#ef4444' },
    { key: 'yellows',  label: 'Yellows',  color: '#eab308' },
    { key: 'greens',   label: 'Greens',   color: '#22c55e' },
    { key: 'cyans',    label: 'Cyans',    color: '#06b6d4' },
    { key: 'blues',    label: 'Blues',    color: '#3b82f6' },
    { key: 'magentas', label: 'Magentas', color: '#d946ef' },
];

/**
 * High-end Custom Grade Slider matching professional color grading NLE styling.
 * Supports click & drag on track, scrubbing, direct numeric editing, and double-click reset.
 */
function GradeSlider({
    label,
    value = 0,
    defaultValue = 0,
    min = 0,
    max = 200,
    step = 1,
    unit = '%',
    gradient,
    onChange,
}) {
    const trackRef = useRef(null);
    const inputRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editVal, setEditVal] = useState(String(value));

    useEffect(() => {
        if (!isEditing) setEditVal(String(Math.round(value)));
    }, [value, isEditing]);

    const percentage = useMemo(() => {
        const clamped = Math.max(min, Math.min(max, value));
        return ((clamped - min) / (max - min)) * 100;
    }, [value, min, max]);

    const updateFromPointer = useCallback((clientX) => {
        if (!trackRef.current) return;
        const rect = trackRef.current.getBoundingClientRect();
        if (rect.width <= 0) return;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const raw = min + ratio * (max - min);
        const stepped = Math.round(raw / step) * step;
        const clamped = Math.max(min, Math.min(max, stepped));
        onChange?.(clamped);
    }, [min, max, step, onChange]);

    const handlePointerDown = (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setIsDragging(true);
        updateFromPointer(e.clientX);
    };

    const handlePointerMove = (e) => {
        if (!isDragging) return;
        updateFromPointer(e.clientX);
    };

    const handlePointerUp = (e) => {
        if (!isDragging) return;
        setIsDragging(false);
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch (_) {}
    };

    const handleKeyDown = (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            onChange?.(Math.max(min, value - step));
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            onChange?.(Math.min(max, value + step));
        }
    };

    const commitEdit = () => {
        setIsEditing(false);
        const parsed = parseFloat(editVal);
        if (Number.isFinite(parsed)) {
            const clamped = Math.max(min, Math.min(max, Math.round(parsed)));
            onChange?.(clamped);
        } else {
            setEditVal(String(Math.round(value)));
        }
    };

    return (
        <div className="flex items-center justify-between gap-3 py-1.5 group select-none">
            {/* Label */}
            <span
                className="text-xs text-[#94a3b8] font-medium w-24 shrink-0 truncate cursor-pointer hover:text-white transition-colors"
                title={`${label} (double-click to reset)`}
                onDoubleClick={() => onChange?.(defaultValue)}
            >
                {label}
            </span>

            {/* Slider Track with Custom Gradient */}
            <div
                ref={trackRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onDoubleClick={() => onChange?.(defaultValue)}
                className="relative flex-1 h-7 flex items-center cursor-pointer"
                role="slider"
                aria-label={label}
                aria-valuenow={Math.round(value)}
                aria-valuemin={min}
                aria-valuemax={max}
                tabIndex={0}
                onKeyDown={handleKeyDown}
            >
                {/* Background Track Bar */}
                <div className="w-full h-[5px] rounded-full relative overflow-hidden bg-[#1e232b]">
                    {/* Visual Gradient Fill */}
                    <div
                        className="absolute inset-0 rounded-full opacity-90 group-hover:opacity-100 transition-opacity"
                        style={{ background: gradient }}
                    />
                </div>

                {/* White Circular Thumb */}
                <div
                    className="absolute w-3.5 h-3.5 rounded-full bg-white shadow-[0_1px_5px_rgba(0,0,0,0.7)] border border-black/15 -translate-x-1/2 cursor-grab active:cursor-grabbing transition-transform group-hover:scale-110 active:scale-125"
                    style={{ left: `${percentage}%` }}
                />
            </div>

            {/* Value Badge Box */}
            <div
                className="h-7 min-w-[62px] px-2 rounded-lg border border-[#2d333b] bg-[#12161c] flex items-center justify-end gap-1 font-mono text-xs text-white shadow-inner focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/40 shrink-0"
                onDoubleClick={() => onChange?.(defaultValue)}
            >
                {isEditing ? (
                    <input
                        ref={inputRef}
                        type="text"
                        value={editVal}
                        onChange={(e) => setEditVal(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') {
                                setEditVal(String(Math.round(value)));
                                setIsEditing(false);
                            }
                        }}
                        className="w-8 bg-transparent text-right outline-none text-xs font-mono text-white p-0 m-0"
                        autoFocus
                    />
                ) : (
                    <span
                        onClick={() => setIsEditing(true)}
                        className="cursor-text hover:text-primary transition-colors text-right"
                        title="Click to edit value"
                    >
                        {Math.round(value)}
                    </span>
                )}
                {unit && (
                    <span className="text-[#64748b] text-[11px] select-none font-sans font-normal">
                        {unit}
                    </span>
                )}
            </div>
        </div>
    );
}

export default function ColorGradePanel({
    activeClip,
    activeTrackId,
    onGradingChange,
    onSelectiveGradingChange,
    onGradingReset,
    onBatchGradingChange,
}) {
    const { t } = useTranslation('editor');
    const [subTab, setSubTab] = useState('tone');
    const [activeHslRange, setActiveHslRange] = useState('reds');
    const [isBypassed, setIsBypassed] = useState(false);
    const [copiedGrade, setCopiedGrade] = useState(null);
    const [showCopyFeedback, setShowCopyFeedback] = useState(false);
    const [appliedAllFeedback, setAppliedAllFeedback] = useState(false);
    const [showScopes, setShowScopes] = useState(false);

    // Audio Engine for LUTs
    const {
        lutResults,
        loading: lutsLoading,
        searchLUTs,
        applyLUT,
        clearLUT,
    } = useAudioEngine();

    const [lutSearchQuery, setLutSearchQuery] = useState('');
    const [lutUploading, setLutUploading] = useState(false);
    const [lutUploadMsg, setLutUploadMsg] = useState(null);

    const projectLUTId = useTimelineStore(s => s.projectLUTId);
    const tracks = useTimelineStore(s => s.tracks) || [];
    const updateClip = useTimelineStore(s => s.updateClip);

    const currentGrading = useMemo(() => {
        return activeClip?.grading || {};
    }, [activeClip?.grading]);

    // Handle Tone slider change
    const handleSliderChange = (key, val) => {
        if (isBypassed) setIsBypassed(false);
        onGradingChange?.(key, Math.round(val));
    };

    // Handle 3-way color wheels change
    const handleWheelsChange = (wheels) => {
        if (!activeClip || !activeTrackId) return;
        if (isBypassed) setIsBypassed(false);
        const newGrading = {
            ...currentGrading,
            wheels,
            _manuallyAdjusted: true,
        };
        onBatchGradingChange?.(newGrading);
    };

    // Handle Curves change
    const handleCurvesChange = (curves) => {
        if (!activeClip || !activeTrackId) return;
        if (isBypassed) setIsBypassed(false);
        const newGrading = {
            ...currentGrading,
            curves,
            _manuallyAdjusted: true,
        };
        onBatchGradingChange?.(newGrading);
    };

    // Handle HSL Selective change
    const handleSelectiveChange = (key, val) => {
        if (isBypassed) setIsBypassed(false);
        onSelectiveGradingChange?.(activeHslRange, key, Math.round(val));
    };

    // A/B Bypass toggle
    const handleToggleBypass = () => {
        if (!activeClip || !activeTrackId) return;
        const nextBypass = !isBypassed;
        setIsBypassed(nextBypass);
        if (nextBypass) {
            // Apply neutral preview
            onBatchGradingChange?.({
                brightness: 100, contrast: 100, saturate: 100, hueRotate: 0,
                temperature: 0, tint: 0, exposure: 0, highlights: 0, shadows: 0, vibrance: 0,
                _bypassedGrade: currentGrading,
            });
        } else if (currentGrading._bypassedGrade) {
            onBatchGradingChange?.(currentGrading._bypassedGrade);
        }
    };

    // Copy grade to clipboard state
    const handleCopyGrade = () => {
        if (!activeClip?.grading) return;
        const { _bypassedGrade, ...gradeToCopy } = activeClip.grading;
        setCopiedGrade(gradeToCopy);
        setShowCopyFeedback(true);
        setTimeout(() => setShowCopyFeedback(false), 2000);
    };

    // Paste grade onto active clip
    const handlePasteGrade = () => {
        if (!activeClip || !activeTrackId || !copiedGrade) return;
        onBatchGradingChange?.({
            ...copiedGrade,
            _manuallyAdjusted: true,
        });
    };

    // Apply grade to all video clips in project
    const handleApplyToAllClips = () => {
        if (!activeClip?.grading) return;
        const gradeToApply = { ...activeClip.grading, _manuallyAdjusted: true };

        tracks.forEach(track => {
            if (track.type !== 'video') return;
            (track.clips || []).forEach(clip => {
                updateClip?.(track.id, clip.id, {
                    grading: { ...gradeToApply },
                    filter: `brightness(${gradeToApply.brightness || 100}%) contrast(${gradeToApply.contrast || 100}%) saturate(${gradeToApply.saturate || 100}%) hue-rotate(${gradeToApply.hueRotate || 0}deg)`,
                });
            });
        });

        setAppliedAllFeedback(true);
        setTimeout(() => setAppliedAllFeedback(false), 2500);
    };

    // Reset Tone section
    const handleResetTone = () => {
        if (!activeClip || !activeTrackId) return;
        onBatchGradingChange?.({
            ...currentGrading,
            brightness: 100,
            contrast: 100,
            saturate: 100,
            hueRotate: 0,
            _manuallyAdjusted: true,
        });
    };

    // Reset White Balance section
    const handleResetWhiteBalance = () => {
        if (!activeClip || !activeTrackId) return;
        onBatchGradingChange?.({
            ...currentGrading,
            temperature: 0,
            tint: 0,
            exposure: 0,
            _manuallyAdjusted: true,
        });
    };

    // Reset Dynamic Range section
    const handleResetDynamicRange = () => {
        if (!activeClip || !activeTrackId) return;
        onBatchGradingChange?.({
            ...currentGrading,
            highlights: 0,
            shadows: 0,
            vibrance: 0,
            _manuallyAdjusted: true,
        });
    };

    // LUT search & apply
    const handleLutSearch = (e) => {
        e.preventDefault();
        searchLUTs(lutSearchQuery);
    };

    const handleApplyLut = async (lut) => {
        if (!lut) return;
        const clearing = projectLUTId === lut.id;
        const grading = clearing ? null : lutToGrading(lut);

        // Grade video clips
        for (const track of tracks) {
            if (track.type !== 'video') continue;
            for (const clip of (track.clips || [])) {
                if (clip.grading?._manuallyAdjusted) continue;
                updateClip?.(track.id, clip.id, { grading });
            }
        }

        if (clearing) clearLUT();
        else await applyLUT(lut.id);
    };

    // Custom .cube upload
    const handleLutFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setLutUploading(true);
        setLutUploadMsg(null);
        try {
            const result = await audioEngineAPI.uploadLUT(file);
            setLutUploadMsg(`✓ Uploaded "${result.lut?.name || file.name}"`);
            searchLUTs('');
        } catch (err) {
            setLutUploadMsg(`✗ ${err.message || 'Upload failed'}`);
        } finally {
            setLutUploading(false);
            e.target.value = '';
        }
    };

    const isNonDefault = useMemo(() => {
        const g = currentGrading;
        return (g.brightness != null && g.brightness !== 100) ||
            (g.contrast != null && g.contrast !== 100) ||
            (g.saturate != null && g.saturate !== 100) ||
            (g.hueRotate != null && g.hueRotate !== 0) ||
            (g.temperature != null && g.temperature !== 0) ||
            (g.tint != null && g.tint !== 0) ||
            (g.exposure != null && g.exposure !== 0) ||
            (g.highlights != null && g.highlights !== 0) ||
            (g.shadows != null && g.shadows !== 0) ||
            (g.vibrance != null && g.vibrance !== 0) ||
            Boolean(g.wheels) ||
            Boolean(g.curves) ||
            Boolean(g.selective);
    }, [currentGrading]);

    return (
        <section className="flex flex-col h-full overflow-hidden bg-[#0c0f14] text-foreground">
            {/* Header matching Image 2 */}
            <div className="px-4 py-3 border-b border-[#1f242d] bg-[#0c0f14]/80 backdrop-blur-md">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#e2e8f0]">
                        {t('ideLayout.colorGrading.title', 'Color Grading')}
                    </span>

                    {/* Right side utilities & ACTIVE status */}
                    <div className="flex items-center gap-1.5">
                        {activeClip && (
                            <>
                                {/* Video Scope Toggle */}
                                <button
                                    type="button"
                                    onClick={() => setShowScopes(s => !s)}
                                    className={`p-1.5 rounded-md transition-colors ${
                                        showScopes
                                            ? 'bg-primary/20 text-primary border border-primary/30'
                                            : 'text-[#94a3b8] hover:text-white hover:bg-white/5'
                                    }`}
                                    title={showScopes ? "Hide video scopes" : "Show video scopes"}
                                >
                                    <Activity size={13} />
                                </button>

                                {/* A/B Bypass */}
                                <button
                                    type="button"
                                    onClick={handleToggleBypass}
                                    className={`p-1.5 rounded-md transition-colors ${
                                        isBypassed
                                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                            : 'text-[#94a3b8] hover:text-white hover:bg-white/5'
                                    }`}
                                    title={isBypassed ? "Unbypass color grade" : "A/B Bypass grade"}
                                >
                                    {isBypassed ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>

                                {/* Copy Grade */}
                                <button
                                    type="button"
                                    onClick={handleCopyGrade}
                                    className="p-1.5 rounded-md text-[#94a3b8] hover:text-white hover:bg-white/5 transition-colors relative"
                                    title="Copy grade"
                                >
                                    {showCopyFeedback ? <ClipboardCheck size={13} className="text-primary" /> : <Copy size={13} />}
                                </button>

                                {/* Paste Grade */}
                                {copiedGrade && (
                                    <button
                                        type="button"
                                        onClick={handlePasteGrade}
                                        className="px-2 py-0.5 text-[10px] font-medium rounded-md bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
                                        title="Paste grade to active clip"
                                    >
                                        Paste
                                    </button>
                                )}

                                {/* Apply to All Clips */}
                                <button
                                    type="button"
                                    onClick={handleApplyToAllClips}
                                    className="p-1.5 rounded-md text-[#94a3b8] hover:text-white hover:bg-white/5 transition-colors"
                                    title="Apply grade to all video clips"
                                >
                                    <CheckCheck size={13} className={appliedAllFeedback ? "text-primary" : ""} />
                                </button>

                                {/* Reset All */}
                                {isNonDefault && (
                                    <button
                                        type="button"
                                        onClick={onGradingReset}
                                        className="p-1.5 rounded-md text-[#94a3b8] hover:text-white hover:bg-white/5 transition-colors"
                                        title={t('ideLayout.colorGrading.reset', 'Reset Color')}
                                    >
                                        <RotateCcw size={13} />
                                    </button>
                                )}

                                {/* Clean ACTIVE indicator text */}
                                <span className="text-[11px] font-semibold text-emerald-400 font-mono tracking-wider ml-1 select-none">
                                    {t('ideLayout.active', 'ACTIVE')}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {/* LUT Attribution Badge */}
                {activeClip?.grading?._lutId && (
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 mt-2 rounded-md bg-primary/10 border border-primary/20">
                        <span className="text-[11px] text-primary truncate font-medium">
                            {t('ideLayout.colorGrading.basedOnLut', {
                                name: activeClip.grading._lutName || t('ideLayout.colorGrading.customLut', 'Custom LUT')
                            })}
                        </span>
                        {activeClip.grading._manuallyAdjusted && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                                {t('ideLayout.colorGrading.adjusted', 'adjusted')}
                            </span>
                        )}
                    </div>
                )}

                {/* Minimalist Sub-Tabs Navigation */}
                <div className="flex items-center gap-1 mt-2.5 bg-black/40 p-0.5 rounded-lg border border-white/5">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = subTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setSubTab(tab.key)}
                                className={`flex-1 py-1 px-2 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1.5 shrink-0 ${
                                    isActive
                                        ? 'bg-[#1e232b] text-white shadow-sm'
                                        : 'text-[#94a3b8] hover:text-white hover:bg-white/5'
                                }`}
                            >
                                <Icon size={12} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Collapsible Video Scopes Drawer */}
            {activeClip && showScopes && (
                <div className="p-3 border-b border-[#1f242d] bg-[#080b0f] animate-in fade-in slide-in-from-top-2 duration-150">
                    <VideoScopes className="!p-1.5" />
                </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                {!activeClip ? (
                    <div className="p-8 rounded-xl border border-dashed border-[#1f242d] text-center my-6">
                        <Palette size={26} className="mx-auto mb-2.5 text-[#64748b]" />
                        <p className="text-xs text-[#94a3b8]">
                            {t('ideLayout.colorGrading.selectClip', 'Select a clip to adjust color.')}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* 1. TONE & COLOUR TAB — Continuous Image 2 Styling */}
                        {subTab === 'tone' && (
                            <div className="space-y-4">
                                {/* Section 1: TONE & COLOUR */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-[10px] text-[#94a3b8] uppercase tracking-widest font-semibold select-none">
                                            {t('ideLayout.colorGrading.tone', 'TONE & COLOUR')}
                                        </h4>
                                        <button
                                            type="button"
                                            onClick={handleResetTone}
                                            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
                                        >
                                            Reset
                                        </button>
                                    </div>

                                    <div className="space-y-0.5">
                                        <GradeSlider
                                            label={t('ideLayout.colorGrading.brightness', 'Brightness')}
                                            value={currentGrading.brightness ?? 100}
                                            defaultValue={100}
                                            min={0}
                                            max={200}
                                            step={1}
                                            unit="%"
                                            gradient="linear-gradient(to right, #2b3038 0%, #6b7280 50%, #ffffff 100%)"
                                            onChange={(v) => handleSliderChange('brightness', v)}
                                        />
                                        <GradeSlider
                                            label={t('ideLayout.colorGrading.contrast', 'Contrast')}
                                            value={currentGrading.contrast ?? 100}
                                            defaultValue={100}
                                            min={0}
                                            max={200}
                                            step={1}
                                            unit="%"
                                            gradient="linear-gradient(to right, #8b5cf6 0%, #a855f7 50%, #2e1065 100%)"
                                            onChange={(v) => handleSliderChange('contrast', v)}
                                        />
                                        <GradeSlider
                                            label={t('ideLayout.colorGrading.saturation', 'Saturation')}
                                            value={currentGrading.saturate ?? 100}
                                            defaultValue={100}
                                            min={0}
                                            max={200}
                                            step={1}
                                            unit="%"
                                            gradient="linear-gradient(to right, #fda4af 0%, #f43f5e 50%, #e11d48 100%)"
                                            onChange={(v) => handleSliderChange('saturate', v)}
                                        />
                                        <GradeSlider
                                            label={t('ideLayout.colorGrading.hueRotate', 'Hue Rotate')}
                                            value={currentGrading.hueRotate ?? 0}
                                            defaultValue={0}
                                            min={-180}
                                            max={180}
                                            step={1}
                                            unit="°"
                                            gradient="linear-gradient(to right, #ef4444 0%, #eab308 17%, #22c55e 33%, #06b6d4 50%, #3b82f6 67%, #a855f7 83%, #ef4444 100%)"
                                            onChange={(v) => handleSliderChange('hueRotate', v)}
                                        />
                                    </div>
                                </div>

                                <div className="h-px bg-[#1f242d] w-full" />

                                {/* Section 2: WHITE BALANCE & EXPOSURE */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-[10px] text-[#94a3b8] uppercase tracking-widest font-semibold select-none">
                                            WHITE BALANCE & EXPOSURE
                                        </h4>
                                        <button
                                            type="button"
                                            onClick={handleResetWhiteBalance}
                                            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
                                        >
                                            Reset
                                        </button>
                                    </div>

                                    <div className="space-y-0.5">
                                        <GradeSlider
                                            label="Temperature"
                                            value={currentGrading.temperature ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #38bdf8 0%, #94a3b8 50%, #f97316 100%)"
                                            onChange={(v) => handleSliderChange('temperature', v)}
                                        />
                                        <GradeSlider
                                            label="Tint"
                                            value={currentGrading.tint ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #4ade80 0%, #94a3b8 50%, #e879f9 100%)"
                                            onChange={(v) => handleSliderChange('tint', v)}
                                        />
                                        <GradeSlider
                                            label="Exposure"
                                            value={currentGrading.exposure ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #090d16 0%, #64748b 50%, #f8fafc 100%)"
                                            onChange={(v) => handleSliderChange('exposure', v)}
                                        />
                                    </div>
                                </div>

                                <div className="h-px bg-[#1f242d] w-full" />

                                {/* Section 3: DYNAMIC RANGE */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-[10px] text-[#94a3b8] uppercase tracking-widest font-semibold select-none">
                                            DYNAMIC RANGE
                                        </h4>
                                        <button
                                            type="button"
                                            onClick={handleResetDynamicRange}
                                            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
                                        >
                                            Reset
                                        </button>
                                    </div>

                                    <div className="space-y-0.5">
                                        <GradeSlider
                                            label="Highlights"
                                            value={currentGrading.highlights ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #334155 0%, #94a3b8 50%, #ffffff 100%)"
                                            onChange={(v) => handleSliderChange('highlights', v)}
                                        />
                                        <GradeSlider
                                            label="Shadows"
                                            value={currentGrading.shadows ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #020617 0%, #475569 50%, #cbd5e1 100%)"
                                            onChange={(v) => handleSliderChange('shadows', v)}
                                        />
                                        <GradeSlider
                                            label="Vibrance"
                                            value={currentGrading.vibrance ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #64748b 0%, #a855f7 50%, #c084fc 100%)"
                                            onChange={(v) => handleSliderChange('vibrance', v)}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 2. 3-WAY COLOR WHEELS */}
                        {subTab === 'wheels' && (
                            <div className="space-y-3">
                                <ColorWheels
                                    wheels={currentGrading.wheels}
                                    onChange={handleWheelsChange}
                                />
                            </div>
                        )}

                        {/* 3. CURVES EDITOR */}
                        {subTab === 'curves' && (
                            <div className="space-y-3">
                                <CurvesEditor
                                    curves={currentGrading.curves}
                                    onChange={handleCurvesChange}
                                />
                            </div>
                        )}

                        {/* 4. HSL / SELECTIVE COLOR */}
                        {subTab === 'selective' && (
                            <div className="space-y-4">
                                {/* Color Swatch Range Selector */}
                                <div className="flex items-center justify-between gap-1 p-1 bg-black/40 rounded-lg border border-white/5">
                                    {HSL_RANGES.map(range => (
                                        <button
                                            key={range.key}
                                            type="button"
                                            onClick={() => setActiveHslRange(range.key)}
                                            className={`flex-1 py-1.5 rounded-md flex flex-col items-center gap-1 transition-all ${
                                                activeHslRange === range.key
                                                    ? 'bg-white/15 shadow-sm'
                                                    : 'hover:bg-white/5'
                                            }`}
                                        >
                                            <span
                                                className="w-3.5 h-3.5 rounded-full shadow-sm"
                                                style={{ backgroundColor: range.color }}
                                            />
                                            <span className="text-[9px] text-[#94a3b8] font-medium">
                                                {range.label.slice(0, 3)}
                                            </span>
                                        </button>
                                    ))}
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-[10px] text-[#94a3b8] uppercase tracking-widest font-semibold select-none">
                                            SELECTIVE — {activeHslRange.toUpperCase()}
                                        </h4>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                handleSelectiveChange('hue', 0);
                                                handleSelectiveChange('sat', 0);
                                                handleSelectiveChange('lum', 0);
                                            }}
                                            className="text-[10px] text-[#64748b] hover:text-[#94a3b8] transition-colors"
                                        >
                                            Reset
                                        </button>
                                    </div>

                                    <div className="space-y-0.5">
                                        <GradeSlider
                                            label="Hue"
                                            value={currentGrading.selective?.[activeHslRange]?.hue ?? 0}
                                            defaultValue={0}
                                            min={-180}
                                            max={180}
                                            step={1}
                                            unit="°"
                                            gradient="linear-gradient(to right, #ef4444 0%, #eab308 17%, #22c55e 33%, #06b6d4 50%, #3b82f6 67%, #a855f7 83%, #ef4444 100%)"
                                            onChange={(v) => handleSelectiveChange('hue', v)}
                                        />
                                        <GradeSlider
                                            label="Saturation"
                                            value={currentGrading.selective?.[activeHslRange]?.sat ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #64748b, #ec4899)"
                                            onChange={(v) => handleSelectiveChange('sat', v)}
                                        />
                                        <GradeSlider
                                            label="Luminance"
                                            value={currentGrading.selective?.[activeHslRange]?.lum ?? 0}
                                            defaultValue={0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            gradient="linear-gradient(to right, #0f172a, #f8fafc)"
                                            onChange={(v) => handleSelectiveChange('lum', v)}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 5. LUTS & FILM LOOKS */}
                        {subTab === 'luts' && (
                            <div className="space-y-3">
                                {/* Search Bar */}
                                <form onSubmit={handleLutSearch} className="flex gap-1.5">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            value={lutSearchQuery}
                                            onChange={(e) => setLutSearchQuery(e.target.value)}
                                            placeholder="Search LUTs & styles..."
                                            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-black/40 border border-white/10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                                        />
                                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    </div>
                                    <button
                                        type="submit"
                                        className="px-3 py-1.5 text-xs rounded-lg bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 font-medium transition-colors"
                                    >
                                        Search
                                    </button>
                                </form>

                                {/* Custom .cube Import */}
                                <div>
                                    <label className="flex items-center justify-center gap-2 p-2 rounded-lg border border-dashed border-white/15 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
                                        <Upload size={13} />
                                        <span>{lutUploading ? 'Importing .cube...' : 'Import .cube LUT'}</span>
                                        <input
                                            type="file"
                                            accept=".cube"
                                            className="hidden"
                                            onChange={handleLutFileUpload}
                                            disabled={lutUploading}
                                        />
                                    </label>
                                    {lutUploadMsg && (
                                        <p className="text-[10px] mt-1 text-center font-mono text-muted-foreground">
                                            {lutUploadMsg}
                                        </p>
                                    )}
                                </div>

                                {/* LUT Card Grid */}
                                {lutsLoading ? (
                                    <div className="flex items-center justify-center py-8 text-muted-foreground">
                                        <Loader2 size={18} className="animate-spin" />
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 pt-1">
                                        {lutResults.length === 0 && (
                                            <div className="col-span-2 text-center py-6 text-xs text-muted-foreground">
                                                No LUTs found.
                                            </div>
                                        )}
                                        {lutResults.map((r, i) => {
                                            const lut = r.asset || r;
                                            return (
                                                <LUTCard
                                                    key={lut.id || i}
                                                    lut={lut}
                                                    applied={projectLUTId === lut.id}
                                                    onApply={handleApplyLut}
                                                />
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}
