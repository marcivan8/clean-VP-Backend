import React, { useRef } from 'react';
import { Send, ChevronUp, Loader2 } from 'lucide-react';
import useAIStore from '../store/useAIStore';
import useTimelineStore from '../store/useTimelineStore';
import { workflowController } from '../agent/WorkflowController.js';

// Log types that are worth previewing as the last AI message
const PREVIEW_TYPES = new Set(['assistant', 'success', 'step', 'warning', 'task_complete']);

/**
 * Compact AI bar — always visible on mobile, sits between the timeline and the
 * bottom toolbar. Shows the last AI message as a one-line preview, and provides
 * a text input so the user can fire commands without opening the full AI sheet.
 *
 * @param {function} onExpand   Called when the user taps the preview row or the
 *                              expand chevron — opens the full AI bottom sheet.
 */
export default function MobileAIBar({ onExpand }) {
    const inputRef      = useRef(null);
    const lastSubmitRef = useRef(0);

    const logs        = useAIStore(s => s.logs);
    const isAnalyzing = useAIStore(s => s.isAnalyzing);
    const addLog      = useAIStore(s => s.addLog);
    const setIsAnalyzing = useAIStore(s => s.setIsAnalyzing);

    // Find the most recent AI-generated message for the preview strip
    const lastAILog = [...logs].reverse().find(l => PREVIEW_TYPES.has(l.type));
    const previewText = isAnalyzing
        ? 'Agent working…'
        : lastAILog
            ? lastAILog.message.replace(/^(Agent:|Assistant:)\s*/i, '').trim()
            : null;

    const handleSubmit = async () => {
        const input = inputRef.current;
        if (!input) return;
        const command = input.value.trim();
        if (!command) return;

        const now = Date.now();
        if (now - lastSubmitRef.current < 300) return;
        lastSubmitRef.current = now;

        input.value = '';
        input.style.height = 'auto';

        addLog({
            id:        'user-' + now,
            timestamp: new Date().toLocaleTimeString(),
            type:      'info',
            message:   `You: ${command}`,
        });

        // If the agent is waiting for clarification, answer it directly
        if (workflowController.getState() === 'clarifying') {
            workflowController.submitClarification({ answer: command });
            return;
        }

        setIsAnalyzing(true);
        const { uploadedFile, tracks } = useTimelineStore.getState();
        const hasClips = tracks?.some(t => t.clips?.length > 0);

        if (!uploadedFile && !hasClips && !command.toLowerCase().includes('sample')) {
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
            workflowController.processUserPrompt(command);
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
            className="md:hidden w-full shrink-0 flex flex-col border-t"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-soft)' }}
        >
            {/* ── Preview strip — tap to expand full AI panel ── */}
            <button
                onClick={onExpand}
                className="w-full flex items-center gap-2 px-3 pt-2.5 pb-1 active:opacity-70 transition-opacity"
                style={{ color: 'var(--fg-3)' }}
            >
                {isAnalyzing ? (
                    <Loader2
                        className="w-3 h-3 shrink-0 animate-spin"
                        style={{ color: 'var(--accent)' }}
                    />
                ) : (
                    <span
                        className="w-2 h-2 shrink-0 rounded-full"
                        style={{ background: previewText ? 'var(--accent)' : 'var(--line-strong)', opacity: 0.7 }}
                    />
                )}
                <span
                    className="flex-1 text-left truncate"
                    style={{
                        fontFamily: 'var(--f-sans)',
                        fontSize:   11,
                        lineHeight: 1.4,
                        color:      previewText ? 'var(--fg-2)' : 'var(--fg-3)',
                    }}
                >
                    {previewText || 'Tap to open AI chat'}
                </span>
                <ChevronUp className="w-3.5 h-3.5 shrink-0" />
            </button>

            {/* ── Input row ── */}
            <div className="flex items-end gap-2 px-3 pb-3">
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
                    onClick={handleSubmit}
                    className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-opacity active:opacity-70"
                    style={{
                        background:  'linear-gradient(135deg, var(--accent), var(--violet))',
                        boxShadow:   '0 0 10px rgba(0,229,255,0.3)',
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
