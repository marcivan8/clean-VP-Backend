/**
 * InterviewEditPanel.jsx
 *
 * "Fake multi-camera" zoom rhythm for single-camera talking-head / interview /
 * podcast videos.
 *
 * Correct approach — works with the EDITED timeline, not the source video:
 *
 *   Each clip on the video track already IS a camera shot (it was created by
 *   silence removal or manual cutting). We assign each clip a static zoom level
 *   (wide / medium / close) based on the words that survived inside it.
 *
 *   One keyframe at t=0 per clip — the player holds that scale for the entire
 *   clip duration. The cut between clips IS the camera switch. Short clips are
 *   fine because the scale never animates mid-clip.
 *
 * Requirements:
 *   ✅ 2+ video clips on the timeline (run Silence Removal first)
 *   ✅ Existing transcript in the store (run Auto-Captions first)
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../store/useTimelineStore';
import { authFetch }    from '../utils/authFetch.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const STYLES = [
    {
        id:    'subtle',
        labelKey: 'interviewPanel.styleSubtle',
        desc:  'Wide ×1.00 · Med ×1.06 · Close ×1.12',
        icon:  '🟢',
        noteKey: 'interviewPanel.styleSubtleNote',
    },
    {
        id:    'dynamic',
        labelKey: 'interviewPanel.styleDynamic',
        desc:  'Wide ×1.00 · Med ×1.10 · Close ×1.20',
        icon:  '🟡',
        noteKey: 'interviewPanel.styleDynamicNote',
    },
    {
        id:    'cinematic',
        labelKey: 'interviewPanel.styleCinematic',
        desc:  'Wide ×1.00 · Med ×1.12 · Close ×1.26',
        icon:  '🔴',
        noteKey: 'interviewPanel.styleCinematicNote',
    },
];

const TYPE_COLOR = {
    wide:   '#6b7280', // gray
    medium: '#6366f1', // indigo
    close:  '#f59e0b', // amber
};
const TYPE_LABEL = { wide: 'W', medium: 'M', close: 'C' };

// ── Shot-sequence strip ───────────────────────────────────────────────────────
// Shows each clip as a coloured block — W/M/C — so the user can see the
// camera-angle rhythm before applying.
function ShotStrip({ clipZooms, clips }) {
    const { t } = useTranslation('editor');
    if (!clipZooms?.length) return null;

    // Total timeline duration for proportional widths
    const totalDur = clips.reduce((s, c) => s + (c.duration ?? 1), 0) || 1;

    return (
        <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                {t('interviewPanel.shotSequencePreview')}
            </div>
            <div className="flex w-full h-7 rounded overflow-hidden gap-px" style={{ background: 'var(--secondary)' }}>
                {clipZooms.map((cz, i) => {
                    const dur   = clips[i]?.duration ?? 1;
                    const pct   = (dur / totalDur) * 100;
                    const color = TYPE_COLOR[cz.type] || '#6b7280';
                    return (
                        <div
                            key={cz.clipId}
                            className="flex items-center justify-center text-[8px] font-bold text-white/80 overflow-hidden shrink-0"
                            style={{
                                width:      `${Math.max(0.5, pct)}%`,
                                background: color,
                                opacity:    cz.type === 'wide' ? 0.5 : 1,
                            }}
                            title={t('interviewPanel.clipTitle', { n: i + 1, type: cz.type, scale: cz.scale, duration: dur.toFixed(1) })}
                        >
                            {pct > 2 ? TYPE_LABEL[cz.type] : ''}
                        </div>
                    );
                })}
            </div>
            <div className="flex gap-3 mt-1">
                {Object.entries(TYPE_COLOR).map(([type, color]) => (
                    <div key={type} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                        {t(`interviewPanel.shotType.${type}`, type)}
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function InterviewEditPanel() {
    const { t } = useTranslation('editor');
    const [style,   setStyle]   = useState('dynamic');
    const [phase,   setPhase]   = useState('idle');   // idle | loading | done | error | applying
    const [msg,     setMsg]     = useState('');
    const [result,  setResult]  = useState(null);
    const [applied, setApplied] = useState(false);

    // ── Read live state from store ────────────────────────────────────────────
    const videoClips = useTimelineStore(s =>
        s.tracks?.find(t => t.type === 'video')?.clips ?? []
    );
    const captions = useTimelineStore(s => s.captions ?? []);

    // Compact clip descriptors for the API (no sensitive data)
    const clipDescriptors = useMemo(() =>
        videoClips.map(c => ({
            id:       c.id,
            offset:   c.offset ?? 0,
            duration: c.duration ?? 0,
        })),
    [videoClips]);

    // ── Pre-flight checks ─────────────────────────────────────────────────────
    const noClips      = clipDescriptors.length < 2;
    const noCaptions   = captions.length === 0;
    const canGenerate  = !noClips && !noCaptions && phase !== 'loading';

    // ── Generate ──────────────────────────────────────────────────────────────
    const handleGenerate = async () => {
        setPhase('loading');
        setMsg(t('interviewPanel.scoringClips'));
        setResult(null);
        setApplied(false);

        try {
            const res = await authFetch('/api/interview/rhythm-zoom', {
                method: 'POST',
                body:   JSON.stringify({
                    clips: clipDescriptors,
                    words: captions,
                    style,
                }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `Server error ${res.status}`);
            }

            setResult(data);
            setPhase('done');
            setMsg('');
        } catch (err) {
            setPhase('error');
            setMsg(err.message || t('interviewPanel.analysisFailed'));
        }
    };

    // ── Apply — one static keyframe per clip ──────────────────────────────────
    const handleApply = () => {
        if (!result?.clipZooms?.length) return;
        setPhase('applying');

        setTimeout(() => {
            try {
                const store = useTimelineStore.getState();

                // Clear existing scale keyframes first
                const videoTrack = store.tracks?.find(t => t.type === 'video');
                videoTrack?.clips?.forEach(clip => {
                    if (clip.keyframes?.scale?.length) {
                        store.updateClip(videoTrack.id, clip.id, {
                            keyframes: { ...(clip.keyframes || {}), scale: [] },
                        });
                    }
                });

                // Apply one keyframe at t=0 per clip — holds for the entire clip
                result.clipZooms.forEach(({ clipId, scale }) => {
                    store.addTransformKeyframe(clipId, 'scale', 0, scale, 'linear');
                });

                setApplied(true);
                setPhase('done');
            } catch (e) {
                setPhase('error');
                setMsg(t('interviewPanel.failedToApply', { message: e.message }));
            }
        }, 40);
    };

    // ── Clear ─────────────────────────────────────────────────────────────────
    const handleClear = () => {
        const store      = useTimelineStore.getState();
        const videoTrack = store.tracks?.find(t => t.type === 'video');
        videoTrack?.clips?.forEach(clip => {
            if (clip.keyframes?.scale?.length) {
                store.updateClip(videoTrack.id, clip.id, {
                    keyframes: { ...(clip.keyframes || {}), scale: [] },
                });
            }
        });
        setApplied(false);
    };

    // ── Render ────────────────────────────────────────────────────────────────
    const { clipZooms, summary } = result || {};

    return (
        <div className="p-4 space-y-4 overflow-y-auto">

            {/* Header */}
            <div>
                <div className="studio-mono-label mb-1">{t('interviewPanel.smartZoomRhythm')}</div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                    {t('interviewPanel.smartZoomRhythmDesc')}
                </p>
            </div>

            {/* Pre-flight warnings */}
            {noClips && (
                <div className="text-[11px] rounded-md px-3 py-2.5 leading-snug"
                     style={{ background: 'rgb(239 68 68 / 0.1)', color: '#f87171', border: '1px solid rgb(239 68 68 / 0.3)' }}>
                    <strong>{t('interviewPanel.noSegmentsFound')}</strong> {t('interviewPanel.runSilenceRemovalHint')}
                    <div className="mt-1 text-[10px] opacity-70">
                        {clipDescriptors.length === 1 ? t('interviewPanel.oneClipFoundNeedTwo') : t('interviewPanel.noVideoClipsOnTimeline')}
                    </div>
                </div>
            )}

            {!noClips && noCaptions && (
                <div className="text-[11px] rounded-md px-3 py-2.5 leading-snug"
                     style={{ background: 'rgb(245 158 11 / 0.1)', color: '#fbbf24', border: '1px solid rgb(245 158 11 / 0.3)' }}>
                    <strong>{t('interviewPanel.noTranscriptFound')}</strong> {t('interviewPanel.runAutoCaptionsHint2')}
                </div>
            )}

            {/* Clips summary */}
            {!noClips && !noCaptions && (
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span>🎬 <strong className="text-foreground">{clipDescriptors.length}</strong> {t('interviewPanel.shots')}</span>
                    <span>📝 <strong className="text-foreground">{captions.length}</strong> {t('interviewPanel.words')}</span>
                </div>
            )}

            {/* Style selector */}
            <div className="space-y-1.5">
                <div className="studio-mono-label">{t('interviewPanel.cameraStyle')}</div>
                {STYLES.map(s => (
                    <button
                        key={s.id}
                        onClick={() => setStyle(s.id)}
                        disabled={phase === 'loading'}
                        className="w-full flex items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors"
                        style={{
                            border:     style === s.id
                                ? '1px solid var(--primary)'
                                : '1px solid var(--line-soft)',
                            background: style === s.id
                                ? 'rgb(99 102 241 / 0.08)'
                                : 'transparent',
                        }}
                    >
                        <span className="mt-0.5 text-sm">{s.icon}</span>
                        <div>
                            <div className="text-xs font-semibold leading-tight">{t(s.labelKey)}</div>
                            <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{s.desc}</div>
                            <div className="text-[10px] text-muted-foreground/70 mt-0.5">{t(s.noteKey)}</div>
                        </div>
                    </button>
                ))}
            </div>

            {/* Generate button */}
            {(phase === 'idle' || phase === 'error') && (
                <button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className="w-full py-2.5 rounded-md text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                    🎥 {t('interviewPanel.assignCameraShots')}
                </button>
            )}

            {phase === 'loading' && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-1">
                    <span className="animate-spin">⏳</span>
                    <span>{msg || t('interviewPanel.gptScoringEachShot')}</span>
                </div>
            )}

            {phase === 'applying' && (
                <div className="text-center text-[11px] text-muted-foreground py-2">
                    {t('interviewPanel.applyingZoomKeyframes')}
                </div>
            )}

            {/* Error */}
            {phase === 'error' && (
                <div className="text-[11px] text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                    {msg}
                </div>
            )}

            {/* Results */}
            {phase === 'done' && clipZooms && (
                <div className="space-y-3">
                    {/* Stat row */}
                    {summary && (
                        <div className="grid grid-cols-3 gap-2 text-center">
                            {[
                                { label: t('interviewPanel.wide'), val: summary.counts?.wide  ?? 0, color: TYPE_COLOR.wide },
                                { label: t('interviewPanel.med'),  val: summary.counts?.medium ?? 0, color: TYPE_COLOR.medium },
                                { label: t('interviewPanel.close'),val: summary.counts?.close  ?? 0, color: TYPE_COLOR.close },
                            ].map(({ label, val, color }) => (
                                <div key={label} className="rounded-lg px-2 py-1.5"
                                     style={{ background: `${color}18`, border: `1px solid ${color}40` }}>
                                    <div className="text-base font-bold tabular-nums" style={{ color }}>{val}</div>
                                    <div className="text-[10px] text-muted-foreground">{label}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Shot-sequence strip */}
                    <ShotStrip clipZooms={clipZooms} clips={clipDescriptors} />

                    {/* Apply / clear / re-generate */}
                    {applied ? (
                        <div className="space-y-2">
                            <div className="text-center text-xs text-green-400 font-semibold py-1">
                                ✅ {t('interviewPanel.appliedPreviewHint')}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleClear}
                                    className="flex-1 py-2 rounded-md text-xs font-medium"
                                    style={{ background: 'var(--secondary)' }}>
                                    🗑 {t('interviewPanel.clearZoom')}
                                </button>
                                <button onClick={() => { setPhase('idle'); setResult(null); setApplied(false); }}
                                    className="flex-1 py-2 rounded-md text-xs font-medium"
                                    style={{ background: 'var(--secondary)' }}>
                                    {t('interviewPanel.regenerate')}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <button onClick={handleApply}
                                className="w-full py-2.5 rounded-md text-sm font-semibold"
                                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
                                ✨ {t('interviewPanel.applyToTimeline')}
                            </button>
                            <button onClick={() => { setPhase('idle'); setResult(null); }}
                                className="w-full py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground"
                                style={{ background: 'var(--secondary)' }}>
                                {t('interviewPanel.regenerate')}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* How it works (idle only) */}
            {phase === 'idle' && (
                <div className="border-t border-border/40 pt-3 space-y-1.5">
                    <div className="studio-mono-label">{t('interviewPanel.howItWorks')}</div>
                    {[
                        ['✂️', t('interviewPanel.howItWorks1')],
                        ['📝', t('interviewPanel.howItWorks2')],
                        ['🎯', t('interviewPanel.howItWorks3')],
                        ['⚡', t('interviewPanel.howItWorks4')],
                        ['🎬', t('interviewPanel.howItWorks5')],
                    ].map(([icon, text]) => (
                        <div key={text} className="flex gap-2 text-[10px] text-muted-foreground">
                            <span>{icon}</span><span>{text}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
