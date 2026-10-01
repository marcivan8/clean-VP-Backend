import React, { useRef, useEffect } from 'react';
import { Send, ChevronUp, ChevronDown, Loader2, Check, Undo2, Clock, Zap, Play, Pause } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import useAIStore from '../store/useAIStore';
import useTimelineStore from '../store/useTimelineStore';
import { workflowController } from '../agent/WorkflowController.js';
import { summarizeUploads } from '../utils/uploadStatus.js';
import { enqueueIfVideoNotReady, runPromptNow, drainPromptQueue, aiWaitReason } from '../agent/rokaPromptQueue.js';
import { undoTaskEdits } from '../agent/undoTask.js';
import { CaptionStyleCallout } from './MobileCaptionSheets';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';
import { getMainVideoTrackId } from '../timeline/rippleDelete.js';

function formatLength(secs) {
    const n = Math.max(0, Math.round(Number(secs) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}

/**
 * Top of the full Roka screen (mockup "Ask Roka"): the video as a strip,
 * thumbnail, name, length · format · status, and Play, so the conversation
 * gets the room the preview had.
 */
function PreviewStrip({ uploadHeadline }) {
    const { t } = useTranslation('editor');
    const { projectName, duration, aspectRatio, isPlaying, thumb, firstName } = useTimelineStore(useShallow(s => {
        const mainId = getMainVideoTrackId(s.tracks || []);
        const main = (s.tracks || []).find(tr => tr.id === mainId);
        const firstClip = main?.clips?.[0];
        const asset = firstClip ? (s.assets || []).find(a => a.id === firstClip.assetId) : null;
        return {
            projectName: s.projectName,
            duration: s.duration,
            aspectRatio: s.aspectRatio,
            isPlaying: s.isPlaying,
            thumb: asset?.thumbnail || null,
            firstName: asset?.name || firstClip?.name || '',
        };
    }));
    const status = uploadHeadline === 'failed'
        ? t('mobileRoka.stripFailed')
        : uploadHeadline === 'waiting' ? t('mobileRoka.stripPreparing') : t('mobileRoka.stripReady');
    const portrait = aspectRatio === '9:16';
    return (
        <div className="shrink-0 flex items-center gap-3 px-3" style={{ height: 96, background: '#000', borderBottom: '1px solid var(--line-soft)' }}>
            <span aria-hidden="true" style={{ width: portrait ? 44 : 112, height: portrait ? 78 : 63, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'var(--bg-3)', border: '1px solid var(--line)' }}>
                {thumb && <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </span>
            <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 600, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {projectName || firstName}
                </span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: uploadHeadline === 'failed' ? 'var(--coral)' : 'var(--fg-2)' }}>
                    {formatLength(duration)} · {aspectRatio || '16:9'} · {status}
                </span>
            </span>
            <button
                type="button"
                onClick={() => useTimelineStore.getState().togglePlay()}
                aria-label={isPlaying ? t('mobileRoka.pause') : t('mobileRoka.play')}
                className="shrink-0 rounded-full inline-flex items-center justify-center"
                style={{ width: 44, height: 44, border: 0, background: 'var(--fg)', color: 'var(--bg)' }}
            >
                {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
            </button>
        </div>
    );
}

// Inline SVG sparkles (avoids re-importing from lucide just for this)
const SparklesIcon = ({ style }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden="true">
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
);

// Log types shown in the inline chat log
const LOG_TYPES = new Set(['assistant', 'success', 'step', 'warning', 'task_complete', 'info', 'caption_styles']);

// Color per log type (non-bubble lines)
const LOG_COLOR = {
    info:    'var(--fg-3)',
    step:    'var(--fg-3)',
    success: 'var(--mint)',
    warning: 'var(--coral)',
};

const bubbleBase = { fontFamily: 'var(--f-sans)', fontSize: 14, lineHeight: 1.45, wordBreak: 'break-word', maxWidth: '86%' };

/** An applied AI edit: what changed, plus Undo / Keep (mobile). */
function AppliedCard({ log }) {
    const { t } = useTranslation('editor');
    const outcome = useAIStore(s => s.taskOutcomes[log.id]);
    const setTaskOutcome = useAIStore(s => s.setTaskOutcome);
    const steps = log.data?.stepsApplied ?? 0;
    return (
        <div className="mb-2" style={{ borderRadius: 'var(--r-sm)', border: '1px solid color-mix(in oklch, var(--mint) 35%, transparent)', background: 'color-mix(in oklch, var(--mint) 7%, transparent)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <Check size={16} style={{ color: 'var(--mint)', flexShrink: 0, marginTop: 2 }} />
                <span style={{ ...bubbleBase, maxWidth: 'none', fontWeight: 600, color: 'var(--fg)' }}>{log.message}</span>
            </div>
            {steps > 0 && !outcome && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button
                        type="button"
                        onClick={() => { undoTaskEdits(log.data?.preTaskHistoryLen); setTaskOutcome(log.id, 'undone'); }}
                        style={{ height: 40, padding: '0 14px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--f-sans)', fontSize: 13.5, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                    >
                        <Undo2 size={15} /> {t('mobileRoka.undo')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setTaskOutcome(log.id, 'kept')}
                        style={{ height: 40, padding: '0 14px', borderRadius: 10, border: 0, background: 'var(--accent-soft)', color: 'var(--accent)', fontFamily: 'var(--f-sans)', fontSize: 13.5, fontWeight: 600 }}
                    >
                        {t('mobileRoka.keep')}
                    </button>
                </div>
            )}
            {outcome && (
                <div style={{ marginTop: 6, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                    {outcome === 'undone' ? t('mobileRoka.undone') : t('mobileRoka.kept')}
                </div>
            )}
        </div>
    );
}

/** Captions for several videos: one line per video (MediaExecutionEngine progress). */
function CaptionProgressCard({ files }) {
    const { t } = useTranslation('editor');
    const done = files.filter(f => f.state === 'done').length;
    return (
        <div className="mb-2" role="status" style={{ borderRadius: 'var(--r-sm)', border: '1px solid var(--line-strong)', background: 'var(--bg-3)', padding: '10px 12px' }}>
            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                {t('mobileCaptions.progressTitle', { count: files.length })}
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {files.map(f => (
                    <li key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 26 }}>
                        {f.state === 'done' && <Check size={15} style={{ color: 'var(--mint)', flexShrink: 0 }} />}
                        {f.state === 'running' && <Loader2 size={15} className="animate-spin" style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                        {f.state === 'waiting' && <span style={{ width: 15, height: 15, borderRadius: 8, border: '2px solid var(--line-strong)', boxSizing: 'border-box', flexShrink: 0 }} />}
                        {f.state === 'failed' && <span style={{ width: 15, height: 15, borderRadius: 8, background: 'var(--coral)', flexShrink: 0 }} />}
                        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--f-mono)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: f.state === 'failed' ? 'var(--coral)' : 'var(--fg-3)' }}>
                            {t(`mobileCaptions.file_${f.state}`)}
                        </span>
                    </li>
                ))}
            </ul>
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--fg-3)' }}>{t('mobileCaptions.progressNote', { done, total: files.length })}</div>
        </div>
    );
}

/**
 * Persistent AI panel — fills all available space between the timeline and the
 * bottom toolbar on mobile. Shows an inline chat log + quick-command input.
 * Tapping the header row opens the full AI bottom sheet.
 *
 * Mobile additions (phase 3): requests sent while the video uploads are queued
 * and run once it's ready (agent/rokaPromptQueue.js); applied edits show as a
 * card with Undo / Keep; suggestion chips follow the project (useAIStore
 * quickChips); 44px send button.
 *
 * @param {function} onExpand   Opens the full Roka screen (AI tab).
 * @param {boolean}  expanded   Full Roka screen (mockup "Ask Roka"): fixed
 *                              between the header and the bottom toolbar,
 *                              video strip on top, room for the conversation.
 *                              Replaces the desktop chat panel on phones.
 * @param {function} onCollapse Back to the editor.
 */
export default function MobileAIBar({ onExpand, expanded = false, onCollapse }) {
    const { t } = useTranslation('editor');
    const inputRef      = useRef(null);
    const logEndRef     = useRef(null);
    const lastSubmitRef = useRef(0);

    const logs           = useAIStore(s => s.logs);
    const isAnalyzing    = useAIStore(s => s.isAnalyzing);
    const addLog         = useAIStore(s => s.addLog);
    const setIsAnalyzing = useAIStore(s => s.setIsAnalyzing);
    const quickChips     = useAIStore(s => s.quickChips);
    const queuedCount    = useAIStore(s => s.queuedPrompts.length);
    const captionProgress = useAIStore(s => s.captionProgress);
    const clearQueued    = useAIStore(s => s.clearQueuedPrompts);
    const aiOpsExhausted = useAIStore(s => s.aiOpsExhausted);
    // 'waiting' | 'failed' | null — a string, so progress ticks don't re-render.
    const uploadHeadline = useTimelineStore(s => summarizeUploads(s.assets, s.tracks).headline);
    const waitReason     = useTimelineStore(s => aiWaitReason(s.assets, s.tracks));

    // Filtered log entries for inline display (most recent 30)
    const visibleLogs = logs.filter(l => LOG_TYPES.has(l.type)).slice(-30);
    const isEmpty = visibleLogs.length === 0 && !isAnalyzing;

    // Auto-scroll to newest message
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs, queuedCount]);

    // Run queued requests once the video is ready and Roka is free.
    useEffect(() => {
        const run = () => { drainPromptQueue(t); };
        const offTimeline = useTimelineStore.subscribe(run);
        const offAI = useAIStore.subscribe(run);
        run();
        return () => { offTimeline(); offAI(); };
    }, [t]);

    const handleSubmit = async (command) => {
        const input = inputRef.current;
        const text  = command ?? input?.value.trim();
        if (!text) return;

        const now = Date.now();
        if (now - lastSubmitRef.current < 300) return;
        lastSubmitRef.current = now;

        if (input) {
            input.value        = '';
            input.style.height = 'auto';
        }

        addLog({
            id:        'user-' + now,
            timestamp: new Date().toLocaleTimeString(),
            type:      'info',
            message:   `You: ${text}`,
        });

        if (workflowController.getState() === 'clarifying') {
            workflowController.submitClarification({ answer: text });
            return;
        }

        const { uploadedFile, tracks } = useTimelineStore.getState();
        const hasClips = tracks?.some(tr => tr.clips?.length > 0);

        if (!uploadedFile && !hasClips && !text.toLowerCase().includes('sample')) {
            addLog({
                id:        'agent-err-' + now,
                timestamp: new Date().toLocaleTimeString(),
                type:      'warning',
                message:   t('assistant.noFileSelected'),
            });
            setIsAnalyzing(false);
            return;
        }

        // Video still uploading / preparing → wait for it instead of running now.
        if (enqueueIfVideoNotReady(text, t)) return;

        runPromptNow(text);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    const headerText = isAnalyzing
        ? t('assistant.rokaWorking')
        : uploadHeadline === 'failed'
            ? t('mobileUpload.rokaPaused')
            : uploadHeadline === 'waiting'
                ? t('mobileUpload.rokaWaiting')
                : 'ROKA';

    return (
        <div
            className={expanded
                ? "md:hidden fixed inset-x-0 z-40 flex flex-col"
                : "md:hidden w-full flex-1 flex flex-col border-t min-h-0"}
            role={expanded ? 'dialog' : undefined}
            aria-label={expanded ? t('mobileRoka.inputLabel') : undefined}
            style={{
                background:   expanded ? 'var(--bg)' : 'var(--bg-2)',
                borderColor:  'var(--line-soft)',
                touchAction:  'manipulation',
                ...(expanded ? { top: '2.75rem', bottom: 'calc(3.5rem + env(safe-area-inset-bottom))' } : {}),
            }}
        >
            {expanded && <PreviewStrip uploadHeadline={uploadHeadline} />}

            {/* ── Header row — tap to open / close the full Roka screen ── */}
            <button
                type="button"
                onClick={expanded ? onCollapse : onExpand}
                aria-expanded={expanded}
                className="w-full shrink-0 flex items-center gap-2 px-3 active:opacity-70 transition-opacity"
                style={{ borderBottom: '0.5px solid var(--line-soft)', minHeight: 36 }}
            >
                {isAnalyzing ? (
                    <Loader2
                        className="w-3 h-3 shrink-0 animate-spin"
                        style={{ color: 'var(--accent)' }}
                    />
                ) : (
                    <span
                        className="w-2 h-2 shrink-0 rounded-full"
                        style={{
                            background: uploadHeadline === 'failed' ? 'var(--coral)' : (uploadHeadline === 'waiting' || !isEmpty) ? 'var(--accent)' : 'var(--line-strong)',
                            opacity: 0.8,
                        }}
                    />
                )}
                <span
                    className="flex-1 text-left"
                    style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize:   10.5,
                        letterSpacing: '0.06em',
                        color:      'var(--fg-3)',
                        textTransform: 'uppercase',
                    }}
                >
                    {headerText}
                </span>
                {expanded
                    ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--fg-3)' }} aria-label={t('mobileRoka.collapse')} />
                    : <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--fg-3)' }} />}
            </button>

            {/* ── Chat log / empty state — fills available space ── */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
                {isEmpty && queuedCount === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-3 pb-2">
                        <SparklesIcon style={{ color: 'var(--accent)', opacity: 0.45 }} />
                        <p style={{ margin: 0, fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)', textAlign: 'center' }}>
                            {expanded && !uploadHeadline ? t('mobileRoka.readyTitle') : t('mobileRoka.emptyTitle')}
                        </p>
                        {/* Suggestion chips — follow the project (SuggestionEngine) */}
                        <div className="flex flex-wrap gap-2 justify-center">
                            {(quickChips || []).slice(0, expanded ? 6 : 4).map(s => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => handleSubmit(s)}
                                    className="rounded-full transition-opacity active:opacity-60"
                                    style={{
                                        minHeight:  36,
                                        padding:    '0 14px',
                                        border:     '1px solid var(--line-strong)',
                                        background: 'var(--bg-3)',
                                        fontFamily: 'var(--f-sans)',
                                        fontSize:   13,
                                        color:      'var(--fg)',
                                    }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                        {expanded && (
                            <p style={{ margin: '8px 0 0', fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-3)', textAlign: 'center' }}>
                                {t('mobileRoka.footnote')}
                            </p>
                        )}
                    </div>
                ) : (
                    <>
                        {visibleLogs.map(log => {
                            if (log.type === 'task_complete') return <AppliedCard key={log.id} log={log} />;
                            if (log.type === 'caption_styles') return <CaptionStyleCallout key={log.id} />;

                            const isUser = log.type === 'info' && log.message.startsWith('You:');
                            const text   = isUser
                                ? log.message.replace(/^You:\s*/, '')
                                : log.message.replace(/^(ROKA:|Agent:|Assistant:)\s*/i, '');

                            if (isUser) {
                                return (
                                    <div key={log.id} className="mb-2 flex justify-end">
                                        <span className="rounded-2xl px-3 py-2" style={{ ...bubbleBase, color: '#fff', background: 'var(--accent)', borderBottomRightRadius: 6 }}>
                                            {text}
                                        </span>
                                    </div>
                                );
                            }
                            if (log.type === 'assistant') {
                                return (
                                    <div key={log.id} className="mb-2 flex justify-start">
                                        <span className="rounded-2xl px-3 py-2" style={{ ...bubbleBase, color: 'var(--fg)', background: 'var(--bg-3)', borderBottomLeftRadius: 6 }}>
                                            {text}
                                        </span>
                                    </div>
                                );
                            }
                            // step / info / success / warning: a quiet line
                            return (
                                <div key={log.id} className="mb-1.5 flex justify-start">
                                    <span style={{ ...bubbleBase, fontSize: 12.5, color: LOG_COLOR[log.type] ?? 'var(--fg-3)' }}>
                                        {text}
                                    </span>
                                </div>
                            );
                        })}

                        {captionProgress?.files?.length > 0 && <CaptionProgressCard files={captionProgress.files} />}

                        {queuedCount > 0 && (
                            <div className="mb-2 flex items-center gap-2" style={{ padding: '6px 6px 6px 10px', borderRadius: 12, border: `1px solid ${waitReason === 'failed' ? 'var(--coral)' : 'color-mix(in oklch, var(--accent) 40%, transparent)'}`, background: 'var(--accent-soft)' }}>
                                <Clock size={14} style={{ color: waitReason === 'failed' ? 'var(--coral)' : 'var(--accent)', flexShrink: 0 }} />
                                <span style={{ flex: 1, fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg)' }}>
                                    {waitReason === 'failed'
                                        ? t('mobileRoka.queuePaused', { count: queuedCount })
                                        : t('mobileRoka.queueWaiting', { count: queuedCount })}
                                </span>
                                <button
                                    type="button"
                                    onClick={clearQueued}
                                    style={{ height: 32, padding: '0 10px', borderRadius: 8, border: 0, background: 'transparent', color: 'var(--fg-2)', fontFamily: 'var(--f-sans)', fontSize: 12.5, fontWeight: 600 }}
                                >
                                    {t('mobileRoka.cancel')}
                                </button>
                            </div>
                        )}

                        {isAnalyzing && (
                            <div className="flex justify-start mb-2">
                                <span className="rounded-2xl px-3 py-2 flex items-center gap-2" style={{ background: 'var(--bg-3)' }}>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
                                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg-3)' }}>
                                        {t('mobileRoka.thinking')}
                                    </span>
                                </span>
                            </div>
                        )}
                        <div ref={logEndRef} />
                    </>
                )}
            </div>

            {/* ── Out of AI operations: hint + plan sheet (requests still go through;
                 the server decides what counts, e.g. trims are unlimited) ── */}
            {aiOpsExhausted && (
                <div className="flex items-center gap-2 mx-3 mb-1 shrink-0" style={{ padding: '4px 4px 4px 10px', borderRadius: 12, border: '1px solid color-mix(in oklch, var(--coral) 45%, transparent)' }}>
                    <Zap size={14} style={{ color: 'var(--coral)', flexShrink: 0 }} aria-hidden="true" />
                    <span style={{ flex: 1, fontFamily: 'var(--f-sans)', fontSize: 12.5, color: 'var(--fg-2)' }}>{t('mobileRoka.outOfOps')}</span>
                    <button
                        type="button"
                        onClick={() => EventBus.emit(EVENT_TYPES.QUOTA_EXCEEDED, { reason: 'ai_ops', upgradeRequired: aiOpsExhausted.upgradeRequired })}
                        style={{ height: 32, padding: '0 10px', borderRadius: 8, border: 0, background: 'transparent', color: 'var(--accent)', fontFamily: 'var(--f-sans)', fontSize: 12.5, fontWeight: 600 }}
                    >
                        {t('mobileRoka.seePlans')}
                    </button>
                </div>
            )}

            {/* ── Input row ── */}
            <div className="flex items-end gap-2 px-3 pb-3 pt-1 shrink-0">
                <label htmlFor="mobile-roka-input" className="sr-only">{t('mobileRoka.inputLabel')}</label>
                <textarea
                    id="mobile-roka-input"
                    ref={inputRef}
                    rows={1}
                    placeholder={waitReason ? t('mobileRoka.placeholderWaiting') : t('mobileRoka.placeholder')}
                    onKeyDown={handleKeyDown}
                    onChange={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 88) + 'px';
                    }}
                    className="flex-1 resize-none outline-none"
                    style={{
                        background:  'var(--bg-3)',
                        border:      '1px solid var(--line-strong)',
                        borderRadius: 22,
                        color:       'var(--fg)',
                        fontFamily:  'var(--f-sans)',
                        // iOS Safari auto-zooms the whole page on focus for any text
                        // input/textarea whose computed font-size is below 16px.
                        // 16px is the documented Safari threshold.
                        fontSize:    16,
                        lineHeight:  1.45,
                        padding:     '10px 16px',
                        minHeight:   '44px',
                        maxHeight:   '88px',
                    }}
                />
                <button
                    type="button"
                    onClick={() => handleSubmit()}
                    aria-label={t('mobileRoka.send')}
                    className="shrink-0 rounded-full flex items-center justify-center transition-opacity active:opacity-70"
                    style={{ width: 44, height: 44, background: 'var(--accent)', color: '#fff' }}
                >
                    {isAnalyzing
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Send    className="w-4 h-4" />
                    }
                </button>
            </div>
        </div>
    );
}
