import React, { useState, useCallback, useMemo } from 'react';
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
import { PanelSection, ControlRow, TrackSlider } from '../ui/PanelControls.jsx';
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
    { key: 'scopes',    label: 'Scopes',    icon: Activity   },
];

const HSL_RANGES = [
    { key: 'reds',     label: 'Reds',     color: '#ef4444' },
    { key: 'yellows',  label: 'Yellows',  color: '#eab308' },
    { key: 'greens',   label: 'Greens',   color: '#22c55e' },
    { key: 'cyans',    label: 'Cyans',    color: '#06b6d4' },
    { key: 'blues',    label: 'Blues',    color: '#3b82f6' },
    { key: 'magentas', label: 'Magentas', color: '#d946ef' },
];

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
        <section className="flex flex-col h-full overflow-hidden text-foreground">
            {/* Header / Active Clip Status */}
            <div className="p-3 border-b border-border/40 bg-background/50 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                            {t('ideLayout.colorGrading.title', 'Color Grading')}
                        </span>
                        {activeClip && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-mono border border-green-500/20">
                                {t('ideLayout.active', 'ACTIVE')}
                            </span>
                        )}
                    </div>

                    {/* Toolbar Actions: Bypass, Copy/Paste, Apply to all, Reset */}
                    {activeClip && (
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                onClick={handleToggleBypass}
                                className={`p-1.5 rounded-md transition-colors ${
                                    isBypassed
                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                        : 'text-muted-foreground hover:text-foreground hover:bg-white/10'
                                }`}
                                title={isBypassed ? "Unbypass color grade" : "A/B Bypass grade"}
                            >
                                {isBypassed ? <EyeOff size={13} /> : <Eye size={13} />}
                            </button>

                            <button
                                type="button"
                                onClick={handleCopyGrade}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors relative"
                                title="Copy grade"
                            >
                                {showCopyFeedback ? <ClipboardCheck size={13} className="text-primary" /> : <Copy size={13} />}
                            </button>

                            {copiedGrade && (
                                <button
                                    type="button"
                                    onClick={handlePasteGrade}
                                    className="px-2 py-1 text-[10px] font-medium rounded-md bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors"
                                    title="Paste grade to active clip"
                                >
                                    Paste
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={handleApplyToAllClips}
                                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                                title="Apply grade to all video clips"
                            >
                                <CheckCheck size={13} className={appliedAllFeedback ? "text-primary" : ""} />
                            </button>

                            {isNonDefault && (
                                <button
                                    type="button"
                                    onClick={onGradingReset}
                                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                                    title={t('ideLayout.colorGrading.reset', 'Reset Color')}
                                >
                                    <RotateCcw size={13} />
                                </button>
                            )}
                        </div>
                    )}
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

                {/* Sub-Tabs Navigation */}
                <div className="flex items-center gap-1 mt-2.5 bg-black/40 p-0.5 rounded-lg border border-white/5 overflow-x-auto no-scrollbar">
                    {TABS.map(tab => {
                        const Icon = tab.icon;
                        const isActive = subTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setSubTab(tab.key)}
                                className={`flex-1 py-1 px-2 text-[11px] font-medium rounded-md transition-all flex items-center justify-center gap-1 shrink-0 ${
                                    isActive
                                        ? 'bg-white/10 text-white shadow-sm'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <Icon size={12} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {!activeClip ? (
                    <div className="p-6 rounded-lg border border-dashed border-border/60 text-center my-4">
                        <Palette size={24} className="mx-auto mb-2 text-muted-foreground/60" />
                        <p className="text-xs text-muted-foreground">
                            {t('ideLayout.colorGrading.selectClip', 'Select a clip to adjust color.')}
                        </p>
                    </div>
                ) : (
                    <>
                        {/* 1. PRIMARY TONE & BALANCE */}
                        {subTab === 'tone' && (
                            <div className="space-y-4">
                                <PanelSection
                                    title="White Balance & Exposure"
                                    onReset={isNonDefault ? onGradingReset : null}
                                    resetLabel="Reset"
                                >
                                    <ControlRow label="Temp" labelWidth={64}>
                                        <TrackSlider
                                            ariaLabel="Temperature"
                                            value={currentGrading.temperature ?? 0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            tint={['#38bdf8', '#fb923c']}
                                            scrub
                                            onChange={(v) => handleSliderChange('temperature', v)}
                                        />
                                    </ControlRow>
                                    <ControlRow label="Tint" labelWidth={64}>
                                        <TrackSlider
                                            ariaLabel="Tint"
                                            value={currentGrading.tint ?? 0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            tint={['#4ade80', '#e879f9']}
                                            scrub
                                            onChange={(v) => handleSliderChange('tint', v)}
                                        />
                                    </ControlRow>
                                    <ControlRow label="Exposure" labelWidth={64}>
                                        <TrackSlider
                                            ariaLabel="Exposure"
                                            value={currentGrading.exposure ?? 0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            tint={['#0f172a', '#f8fafc']}
                                            scrub
                                            onChange={(v) => handleSliderChange('exposure', v)}
                                        />
                                    </ControlRow>
                                </PanelSection>

                                <PanelSection
                                    title={t('ideLayout.colorGrading.tone', 'Tone & colour')}
                                    onReset={isNonDefault ? onGradingReset : null}
                                    resetLabel={t('ideLayout.colorGrading.reset', 'Reset')}
                                >
                                    {[
                                        { key: 'contrast',   label: t('ideLayout.colorGrading.contrast', 'Contrast'),     min: 0, max: 200, unit: '%', tint: null },
                                        { key: 'highlights', label: 'Highlights',                                         min: -100, max: 100, unit: '', tint: ['#64748b', '#f8fafc'] },
                                        { key: 'shadows',    label: 'Shadows',                                            min: -100, max: 100, unit: '', tint: ['#0f172a', '#94a3b8'] },
                                        { key: 'brightness', label: t('ideLayout.colorGrading.brightness', 'Brightness'), min: 0, max: 200, unit: '%', tint: ['#1b1b1b', '#f5f5f5'] },
                                        { key: 'saturate',   label: t('ideLayout.colorGrading.saturation', 'Saturation'), min: 0, max: 200, unit: '%', tint: ['#9E9E9E', '#FF4081'] },
                                        { key: 'vibrance',   label: 'Vibrance',                                           min: -100, max: 100, unit: '', tint: ['#94a3b8', '#a855f7'] },
                                        { key: 'hueRotate',  label: t('ideLayout.colorGrading.hueRotate', 'Hue Rotate'),  min: -180, max: 180, unit: '°', tint: ['#FF5252', '#FFD740', '#69F0AE', '#40C4FF', '#7C4DFF', '#FF5252'] },
                                    ].map(({ key, label, min, max, unit, tint }) => (
                                        <ControlRow key={key} label={label} labelWidth={64}>
                                            <TrackSlider
                                                ariaLabel={label}
                                                value={currentGrading[key] ?? (key === 'hueRotate' || key === 'highlights' || key === 'shadows' || key === 'vibrance' ? 0 : 100)}
                                                min={min}
                                                max={max}
                                                step={1}
                                                unit={unit}
                                                tint={tint}
                                                scrub
                                                onChange={(v) => handleSliderChange(key, v)}
                                            />
                                        </ControlRow>
                                    ))}
                                </PanelSection>
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
                                            <span className="text-[9px] text-muted-foreground font-medium">
                                                {range.label.slice(0, 3)}
                                            </span>
                                        </button>
                                    ))}
                                </div>

                                <PanelSection
                                    title={`Selective — ${activeHslRange.toUpperCase()}`}
                                    onReset={() => {
                                        handleSelectiveChange('hue', 0);
                                        handleSelectiveChange('sat', 0);
                                        handleSelectiveChange('lum', 0);
                                    }}
                                    resetLabel="Reset"
                                >
                                    <ControlRow label="Hue" labelWidth={54}>
                                        <TrackSlider
                                            ariaLabel="Hue Shift"
                                            value={currentGrading.selective?.[activeHslRange]?.hue ?? 0}
                                            min={-180}
                                            max={180}
                                            step={1}
                                            unit="°"
                                            tint={['#FF5252', '#FFD740', '#69F0AE', '#40C4FF', '#7C4DFF', '#FF5252']}
                                            scrub
                                            onChange={(v) => handleSelectiveChange('hue', v)}
                                        />
                                    </ControlRow>
                                    <ControlRow label="Sat" labelWidth={54}>
                                        <TrackSlider
                                            ariaLabel="Saturation Shift"
                                            value={currentGrading.selective?.[activeHslRange]?.sat ?? 0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            tint={['#94a3b8', '#ec4899']}
                                            scrub
                                            onChange={(v) => handleSelectiveChange('sat', v)}
                                        />
                                    </ControlRow>
                                    <ControlRow label="Light" labelWidth={54}>
                                        <TrackSlider
                                            ariaLabel="Lightness Shift"
                                            value={currentGrading.selective?.[activeHslRange]?.lum ?? 0}
                                            min={-100}
                                            max={100}
                                            step={1}
                                            unit=""
                                            tint={['#0f172a', '#f8fafc']}
                                            scrub
                                            onChange={(v) => handleSelectiveChange('lum', v)}
                                        />
                                    </ControlRow>
                                </PanelSection>
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

                        {/* 6. VIDEO SCOPES */}
                        {subTab === 'scopes' && (
                            <div className="space-y-3">
                                <VideoScopes />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Persistent Mini Scope preview at bottom when not in scopes tab */}
            {activeClip && subTab !== 'scopes' && (
                <div className="p-3 border-t border-border/40 bg-background/50">
                    <VideoScopes className="!p-2" />
                </div>
            )}
        </section>
    );
}
