import React, { useRef, useEffect } from 'react';
import { Send, ChevronUp, Loader2 } from 'lucide-react';
import useAIStore from '../store/useAIStore';
import useTimelineStore from '../store/useTimelineStore';
import { workflowController } from '../agent/WorkflowController.js';

// Inline SVG sparkles (avoids re-importing from lucide just for this)
const SparklesIcon = ({ style }) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={style}>
        <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
    </svg>
);

// Log types shown in the inline chat log
const LOG_TYPES = new Set(['assistant', 'success', 'step', 'warning', 'task_complete', 'info']);

// Suggestion chips shown in the empty state
const SUGGESTIONS = ['Add captions', 'Color grade', 'Trim silence', 'Add music'];

// Color per log type
const LOG_COLOR = {
    info:          'var(--fg-3)',
    step:          'var(--fg-2)',
    assistant:     'var(--fg)',
    success:       '#4ade80',
    warning:       '#fb923c',
    task_complete: 'var(--accent)',
};

/**
 * Persistent AI panel — fills all available space between the timeline and the
 * bottom toolbar on mobile. Shows an inline chat log + quick-command input.
 * Tapping the header row opens the full AI bottom sheet.
 *
 * @param {function} onExpand   Opens the full AI bottom sheet.
 */
export default function MobileAIBar({ onExpand }) {
    const inputRef      = useRef(null);
    const logEndRef     = useRef(null);
    const lastSubmitRef = useRef(0);

    const logs           = useAIStore(s => s.logs);
    const isAnalyzing    = useAIStore(s => s.isAnalyzing);
    const addLog         = useAIStore(s => s.addLog);
    const setIsAnalyzing = useAIStore(s => s.setIsAnalyzing);

    // Filtered log entries for inline display (most recent 30)
    const visibleLogs = logs.filter(l => LOG_TYPES.has(l.type)).slice(-30);
    const isEmpty = visibleLogs.length === 0 && !isAnalyzing;

    // Auto-scroll to newest message
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

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

        setIsAnalyzing(true);
        const { uploadedFile, tracks } = useTimelineStore.getState();
        const hasClips = tracks?.some(t => t.clips?.length > 0);

        if (!uploadedFile && !hasClips && !text.toLowerCase().includes('sample')) {
            addLog({
                id:        'agent-err-' + now,
                timestamp: new Date().toLocaleTimeString(),
                type:      'warning',
                message:   'Agent: No file selected. Please import a file first.',
            });
            setIsAnalyzing(false);
            return;
        }

        try {
            workflowController.processUserPrompt(text);
        } catch (err) {
            setIsAnalyzing(false);
            addLog({
                id:        'agent-crash-' + now,
                timestamp: new Date().toLocaleTimeString(),
                type:      'warning',
                message:   `Agent Error: ${err.message}`,
            });
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
        }
    };

    return (
        <div
            className="md:hidden w-full flex-1 flex flex-col border-t min-h-0"
            style={{
                background:   'var(--bg-2)',
                borderColor:  'var(--line-soft)',
                touchAction:  'manipulation',
            }}
        >
            {/* ── Header row — tap to open full panel ── */}
            <button
                onClick={onExpand}
                className="w-full shrink-0 flex items-center gap-2 px-3 py-2 active:opacity-70 transition-opacity"
                style={{ borderBottom: '0.5px solid var(--line-soft)' }}
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
                            background: isEmpty ? 'var(--line-strong)' : 'var(--accent)',
                            opacity: 0.8,
                        }}
                    />
                )}
                <span
                    className="flex-1 text-left"
                    style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize:   10,
                        letterSpacing: '0.06em',
                        color:      'var(--fg-3)',
                        textTransform: 'uppercase',
                    }}
                >
                    {isAnalyzing ? 'Agent working…' : 'AI Chat'}
                </span>
                <ChevronUp className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--fg-3)' }} />
            </button>

            {/* ── Chat log / empty state — fills available space ── */}
            <div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
                {isEmpty ? (
                    /* Empty state */
                    <div className="h-full flex flex-col items-center justify-center gap-3 pb-2">
                        <SparklesIcon style={{ color: 'var(--accent)', opacity: 0.35 }} />
                        <p style={{
                            fontFamily: 'var(--f-sans)',
                            fontSize:   12,
                            color:      'var(--fg-3)',
                            textAlign:  'center',
                        }}>
                            Ask AI to edit your video
                        </p>
                        {/* Suggestion chips */}
                        <div className="flex flex-wrap gap-2 justify-center">
                            {SUGGESTIONS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => handleSubmit(s)}
                                    className="px-3 py-1 rounded-full transition-opacity active:opacity-60"
                                    style={{
                                        border:     '0.5px solid var(--line-strong)',
                                        background: 'rgba(255,255,255,0.04)',
                                        fontFamily: 'var(--f-sans)',
                                        fontSize:   11,
                                        color:      'var(--fg-2)',
                                    }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    /* Message list */
                    <>
                        {visibleLogs.map(log => {
                            const isUser = log.type === 'info' && log.message.startsWith('You:');
                            const text   = isUser
                                ? log.message.replace(/^You:\s*/, '')
                                : log.message.replace(/^(Agent:|Assistant:)\s*/i, '');

                            return (
                                <div
                                    key={log.id}
                                    className={`mb-2 flex ${isUser ? 'justify-end' : 'justify-start'}`}
                                >
                                    <span
                                        className="rounded-xl px-2.5 py-1.5 max-w-[85%]"
                                        style={{
                                            fontFamily: 'var(--f-sans)',
                                            fontSize:   11.5,
                                            lineHeight: 1.45,
                                            color:      isUser ? '#000' : LOG_COLOR[log.type] ?? 'var(--fg-2)',
                                            background: isUser
                                                ? 'linear-gradient(135deg, var(--accent), var(--violet))'
                                                : 'rgba(255,255,255,0.06)',
                                            wordBreak: 'break-word',
                                        }}
                                    >
                                        {text}
                                    </span>
                                </div>
                            );
                        })}
                        {isAnalyzing && (
                            <div className="flex justify-start mb-2">
                                <span
                                    className="rounded-xl px-2.5 py-1.5 flex items-center gap-1.5"
                                    style={{ background: 'rgba(255,255,255,0.06)' }}
                                >
                                    <Loader2
                                        className="w-3 h-3 animate-spin"
                                        style={{ color: 'var(--accent)' }}
                                    />
                                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-3)' }}>
                                        thinking…
                                    </span>
                                </span>
                            </div>
                        )}
                        <div ref={logEndRef} />
                    </>
                )}
            </div>

            {/* ── Input row ── */}
            <div className="flex items-end gap-2 px-3 pb-3 pt-1 shrink-0">
                <textarea
                    ref={inputRef}
                    rows={1}
                    placeholder="Ask AI anything…"
                    onKeyDown={handleKeyDown}
                    onChange={(e) => {
                        e.target.style.height = 'auto';
                        e.target.style.height = Math.min(e.target.scrollHeight, 80) + 'px';
                    }}
                    className="flex-1 resize-none rounded-xl outline-none"
                    style={{
                        background:  'rgba(255,255,255,0.07)',
                        border:      '0.5px solid var(--line-strong)',
                        color:       'var(--fg)',
                        fontFamily:  'var(--f-sans)',
                        fontSize:    13,
                        lineHeight:  1.45,
                        padding:     '8px 12px',
                        minHeight:   '36px',
                        maxHeight:   '80px',
                    }}
                />
                <button
                    onClick={() => handleSubmit()}
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity active:opacity-70"
                    style={{
                        background: 'linear-gradient(135deg, var(--accent), var(--violet))',
                        boxShadow:  '0 0 10px rgba(0,229,255,0.3)',
                    }}
                >
                    {isAnalyzing
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#000' }} />
                        : <Send    className="w-3.5 h-3.5"              style={{ color: '#000' }} />
                    }
                </button>
            </div>
        </div>
    );
}
