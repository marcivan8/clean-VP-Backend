import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Sparkles, Brain, Check, X, ArrowRight, Activity, MessageSquare, Loader2, XCircle, Shield, Type } from 'lucide-react';
import useAIStore from '../../store/useAIStore';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import useJobStore, { JOB_STATES, TERMINAL_STATES } from '../../store/useJobStore';
import { analyzeFile } from '../../services/aiService';
import { parseAgentCommand } from '../../services/autoEditService';
import classNames from 'classnames';
import useUserPreferences from '../../store/useUserPreferences';
import { workflowController } from '../../agent/WorkflowController.js';
import { useBrain } from '../../hooks/useBrain.js';
import BrainPanel from '../BrainPanel.jsx';


// --- Sub-components ---

// User's own message — right-aligned accent bubble
const UserMessageItem = ({ log }) => {
    const text = log.message.replace(/^You:\s*/i, '');
    return (
        <div className="flex justify-end mb-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
            <div style={{
                background: 'color-mix(in oklch, var(--accent) 18%, rgba(255,255,255,0.08))',
                border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                borderRadius: '10px 10px 3px 10px',
                padding: '8px 12px',
                maxWidth: '88%',
                fontFamily: 'var(--f-sans)',
                fontSize: 13,
                color: 'var(--fg)',
                lineHeight: 1.55,
            }}>
                {text}
            </div>
        </div>
    );
};

const StepLogItem = ({ log }) => (
    <div className="flex items-center gap-2 py-1 animate-in fade-in slide-in-from-bottom-1 duration-200">
        {log.done
            ? <Check className="w-3 h-3 shrink-0" style={{ color: '#34d399' }} />
            : <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
        }
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: log.done ? 'var(--fg-3)' : 'var(--fg-2)', letterSpacing: '0.02em' }}>
            {log.message}
        </span>
    </div>
);

const AssistantLogItem = ({ log }) => (
    <div className="rounded-xl mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
         style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
        <div style={{ padding: '8px 12px 6px', borderBottom: '0.5px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Assistant</span>
        </div>
        <p className="whitespace-pre-wrap" style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg)', lineHeight: 1.6, padding: '10px 12px 12px', margin: 0 }}>
            {log.message}
        </p>
    </div>
);

const TaskCompletionCard = ({ log }) => {
    const [dismissed, setDismissed] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const stepsApplied   = log.data?.stepsApplied   ?? 0;
    const preTaskHistoryLen = log.data?.preTaskHistoryLen ?? 0;
    const editDescription   = log.data?.editDescription;
    const nextSuggestion    = log.data?.nextSuggestion;
    const nextSuggestionPrompt = log.data?.nextSuggestionPrompt;
    const nextSuggestionTab = log.data?.nextSuggestionTab;

    if (dismissed) return null;

    const handleAccept = () => setDismissed(true);
    const handleReject = () => {
        setRejecting(true);
        const store = useTimelineStore.getState();
        while (store.past.length > preTaskHistoryLen) {
            useTimelineStore.getState().undo();
        }
        setDismissed(true);
    };

    const handleSuggestion = () => {
        if (nextSuggestionTab) {
            useAIStore.getState().setActiveTab(nextSuggestionTab);
        } else if (nextSuggestionPrompt) {
            // Find the ReasoningPanel textarea and fill it
            const textarea = document.querySelector('textarea[placeholder]');
            if (textarea) { textarea.value = nextSuggestionPrompt; textarea.focus(); }
        }
        setDismissed(true);
    };

    return (
        <div className="rounded-xl mb-2 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300"
             style={{ background: 'rgba(52,211,153,0.05)', border: '0.5px solid rgba(52,211,153,0.2)' }}>
            {/* Part 1: Bold confirmation header */}
            <div className="px-3 py-2.5 flex items-center gap-2" style={{ borderBottom: '0.5px solid rgba(52,211,153,0.12)', background: 'rgba(52,211,153,0.07)' }}>
                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: '#34d399' }} />
                <span className="font-semibold" style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg)' }}>
                    {log.message}
                </span>
                {stepsApplied > 0 && (
                    <span className="ml-auto shrink-0" style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
                        {stepsApplied} edit{stepsApplied !== 1 ? 's' : ''}
                    </span>
                )}
            </div>

            <div className="p-3">
                {/* Part 2: Editorial description */}
                {editDescription && (
                    <p className="mb-3 leading-relaxed" style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)' }}>
                        {editDescription}
                    </p>
                )}

                {/* Details list (compound ops etc) */}
                {log.data?.details && log.data.details.length > 0 && (
                    <ul className="mb-3 space-y-1">
                        {log.data.details.map((step, i) => (
                            <li key={i} className="flex items-start gap-2"
                                style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-2)' }}>
                                <span style={{ color: step.status === 'success' ? '#34d399' : '#f87171' }}>
                                    {step.status === 'success' ? '✓' : '✗'}
                                </span>
                                <span>{step.action}{step.result?.message ? ` — ${step.result.message}` : ''}</span>
                            </li>
                        ))}
                    </ul>
                )}

                {/* Part 3: Proactive suggestion */}
                {nextSuggestion && (
                    <div className="mb-3 rounded-md px-2.5 py-2 flex items-center justify-between"
                         style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                        <span style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)' }}>
                            Next: <strong style={{ color: 'var(--fg)' }}>{nextSuggestion}</strong>
                        </span>
                        <button
                            onClick={handleSuggestion}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors hover:opacity-80 shrink-0 ml-2"
                            style={{ background: 'color-mix(in oklch, var(--accent) 18%, transparent)', border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)', color: 'var(--accent)', fontFamily: 'var(--f-mono)' }}
                        >
                            <ArrowRight className="w-2.5 h-2.5" /> Go
                        </button>
                    </div>
                )}

                {/* Accept / Reject */}
                {stepsApplied > 0 ? (
                    <div className="flex gap-2">
                        <button onClick={handleAccept}
                            className="flex-1 text-xs py-1.5 rounded-md transition-all font-medium flex items-center justify-center gap-1.5"
                            style={{ background: 'color-mix(in oklch, var(--accent) 18%, transparent)', border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)', color: 'var(--accent)' }}>
                            <Check className="w-3 h-3" /> Keep
                        </button>
                        <button onClick={handleReject} disabled={rejecting}
                            className="flex-1 text-xs py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                            style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid var(--line)', color: 'var(--fg-3)' }}>
                            <X className="w-3 h-3" /> {rejecting ? 'Undoing…' : 'Undo'}
                        </button>
                    </div>
                ) : (
                    <button onClick={handleAccept} className="text-xs px-3 py-1 rounded-md"
                        style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--fg-3)', border: '0.5px solid var(--line)' }}>
                        OK
                    </button>
                )}
            </div>
        </div>
    );
};

const LogItem = ({ log }) => {
    if (log.type === 'step')            return <StepLogItem log={log} />;
    if (log.type === 'assistant')       return <AssistantLogItem log={log} />;
    if (log.type === 'task_complete')   return <TaskCompletionCard log={log} />;
    if (log.type === 'caption_styles')  return <CaptionStylesCard log={log} />;
    // User's own typed command — right-aligned bubble
    if (log.id?.startsWith('user-') || log.message?.startsWith('You:'))
        return <UserMessageItem log={log} />;

    const isSuccess = log.type === 'success';
    const isWarning = log.type === 'warning';
    const isAgent   = log.id?.startsWith('agent-');

    return (
        <div className="flex gap-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300 mb-1">
            <div className="flex flex-col items-center pt-1.5 shrink-0">
                <div className={classNames(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    isSuccess ? "bg-green-400" : isWarning ? "bg-orange-400" : "bg-blue-400"
                )} />
                <div className="w-px flex-1 bg-white/10 mt-1" />
            </div>
            <div className="pb-3 w-full min-w-0">
                <div className="flex items-center gap-2 mb-1">
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)' }}>{log.timestamp}</span>
                    {isSuccess && <span style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>DETECTED</span>}
                    {isAgent && log.data?.thought && <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 700 }}>AI PLAN</span>}
                </div>
                <p style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0 }}>
                    {log.message}
                </p>

                {/* Rich Agent Data */}
                {log.data && (
                    <div className="mt-2 rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)' }}>
                        {log.data.thought && (
                            <div className="mb-2 pb-2" style={{ borderBottom: '0.5px solid rgba(255,255,255,0.07)', fontStyle: 'italic', fontSize: 11, color: '#c4b5fd', lineHeight: 1.5 }}>
                                "{log.data.thought}"
                            </div>
                        )}
                        {Array.isArray(log.data.details) && log.data.details.length > 0 && (
                            <ul className="space-y-1">
                                {log.data.details.map((active, i) => (
                                    <li key={i} className="flex items-start gap-2" style={{ fontSize: 11 }}>
                                        <span style={{ color: active.status === 'success' ? '#34d399' : '#f87171' }}>
                                            {active.status === 'success' ? '✓' : '✗'}
                                        </span>
                                        <span style={{ color: 'var(--fg-2)' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{active.action}</span>
                                            {active.result?.message && <span style={{ opacity: 0.7 }}> — {active.result.message}</span>}
                                            {active.error && <span style={{ color: '#f87171' }}> — {active.error}</span>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {log.data.issues && log.data.issues.length > 0 && (
                            <div className="mt-2 rounded-md p-2" style={{ background: 'rgba(251,146,60,0.1)', color: '#fb923c', fontSize: 11 }}>
                                <strong>⚠ Issues:</strong>
                                <ul className="list-disc list-inside mt-1" style={{ opacity: 0.85 }}>
                                    {log.data.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};


const AgentPlanCard = ({ suggestion, onAccept, onReject }) => {
    const { thought, actions } = suggestion.data;

    return (
        <div
            className="rounded-xl mb-4 overflow-hidden animate-in fade-in zoom-in-95 duration-500"
            style={{
                background: 'color-mix(in oklch, var(--violet) 8%, rgba(255,255,255,0.03))',
                border: '0.5px solid color-mix(in oklch, var(--violet) 30%, transparent)',
            }}
        >
            {/* Top accent bar */}
            <div className="h-px w-full" style={{ background: 'linear-gradient(90deg, var(--violet), var(--accent))' }} />

            <div className="p-3">
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                    <div
                        className="p-1 rounded"
                        style={{ background: 'color-mix(in oklch, var(--violet) 18%, transparent)', border: '0.5px solid color-mix(in oklch, var(--violet) 32%, transparent)' }}
                    >
                        <Brain className="w-3 h-3" style={{ color: 'var(--violet)' }} />
                    </div>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--violet)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        Agent Proposal
                    </span>
                </div>

                <div className="mb-3">
                    <div
                        className="mb-2 pl-2 text-[11px] leading-relaxed"
                        style={{ fontStyle: 'italic', color: 'var(--fg-3)', borderLeft: '1.5px solid color-mix(in oklch, var(--violet) 40%, transparent)' }}
                    >
                        "{thought}"
                    </div>
                    <div className="rounded-lg p-2 max-h-32 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.06)' }}>
                        <ul className="space-y-1">
                            {(Array.isArray(actions) ? actions : []).map((action, i) => (
                                <li key={i} className="flex items-center gap-2" style={{ fontSize: 11, color: 'var(--fg-2)' }}>
                                    <span style={{ fontFamily: 'var(--f-mono)', color: 'var(--accent)' }}>[{action.name}]</span>
                                    <span className="truncate">{JSON.stringify(action.args)}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button
                        onClick={() => onAccept(suggestion)}
                        className="flex-1 text-xs py-1.5 rounded-md transition-all font-semibold flex items-center justify-center gap-1"
                        style={{
                            background: 'linear-gradient(135deg, var(--accent), var(--violet))',
                            color: '#fff',
                            border: 'none',
                            boxShadow: '0 2px 12px color-mix(in oklch, var(--accent) 15%, transparent)',
                        }}
                    >
                        <Check className="w-3 h-3" /> Approve Plan
                    </button>
                    <button
                        onClick={() => onReject(suggestion.id)}
                        className="flex-1 text-xs py-1.5 rounded-md transition-all flex items-center justify-center gap-1"
                        style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)', color: 'var(--fg-3)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = 'var(--fg)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--fg-3)'; }}
                    >
                        <X className="w-3 h-3" /> Revise
                    </button>
                </div>
            </div>
        </div>
    );
};


const SuggestionCard = ({ suggestion, onAccept, onReject }) => {
    return (
        <div
            className="rounded-xl p-3 mb-3 animate-in fade-in zoom-in-95 duration-500"
            style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.09)' }}
        >
            <div className="flex items-center gap-2 mb-2">
                <div
                    className="p-1 rounded"
                    style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', border: '0.5px solid color-mix(in oklch, var(--accent) 28%, transparent)' }}
                >
                    <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                </div>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    {suggestion.type || 'Suggestion'}
                </span>
            </div>

            <p className="leading-relaxed mb-3" style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)' }}>
                {suggestion.message || suggestion.label || 'Apply this suggestion?'}
            </p>

            <div className="flex gap-2">
                <button
                    onClick={() => onAccept(suggestion)}
                    className="flex-1 text-xs py-1.5 rounded-md transition-all font-semibold flex items-center justify-center gap-1"
                    style={{
                        background: 'color-mix(in oklch, var(--accent) 18%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                        color: 'var(--accent)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 26%, transparent)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'color-mix(in oklch, var(--accent) 18%, transparent)'; }}
                >
                    <Check className="w-3 h-3" /> Apply
                </button>
                <button
                    onClick={() => onReject(suggestion.id)}
                    className="flex-1 text-xs py-1.5 rounded-md transition-all flex items-center justify-center gap-1"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.08)', color: 'var(--fg-3)' }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = 'var(--fg)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = 'var(--fg-3)'; }}
                >
                    <X className="w-3 h-3" /> Dismiss
                </button>
            </div>
        </div>
    );
};

// Next-action chips shown after a command completes.
// Each suggestion is a standalone button that submits itself as a command.
const NextActionsCard = ({ suggestion, onAccept, onReject }) => {
    const items = suggestion.data?.suggestions || [];
    if (items.length === 0) return null;
    return (
        <div
            className="rounded-xl p-3 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ background: 'rgba(255,255,255,0.04)', border: '0.5px solid rgba(255,255,255,0.1)' }}
        >
            <div className="flex items-center gap-1.5 mb-2.5">
                <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    What's next?
                </span>
                <button
                    onClick={() => onReject(suggestion.id)}
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-3)', padding: 2 }}
                >
                    <X style={{ width: 10, height: 10 }} />
                </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {items.map((item, i) => (
                    <button
                        key={i}
                        onClick={() => onAccept(suggestion, item)}
                        style={{
                            width: '100%', textAlign: 'left', padding: '8px 10px',
                            borderRadius: 8, cursor: 'pointer',
                            background: 'rgba(255,255,255,0.05)',
                            border: '0.5px solid rgba(255,255,255,0.08)',
                            color: 'var(--fg-2)', fontFamily: 'var(--f-sans)', fontSize: 12,
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.09)'; e.currentTarget.style.color = 'var(--fg)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.14)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                    >
                        {item}
                    </button>
                ))}
            </div>
        </div>
    );
};


// --- Main Panel ---

// --- Main Panel ---

const UPLOAD_STEPS = ['uploading', 'processing', 'ready'];
const UPLOAD_STEP_LABELS = { uploading: 'Uploading', processing: 'Processing', ready: 'Ready' };

const UploadStatusCard = ({ asset }) => {
    const phase = asset.uploadPhase || 'uploading';
    const phaseIdx = UPLOAD_STEPS.indexOf(phase);

    return (
        <div className="rounded-lg p-3 mb-3 border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between mb-2.5">
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {UPLOAD_STEP_LABELS[phase]}…
                </span>
                <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--accent)' }} />
            </div>
            {/* Step bar */}
            <div className="flex items-center gap-1 mb-2">
                {UPLOAD_STEPS.map((s, i) => (
                    <React.Fragment key={s}>
                        <div className="flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full transition-all" style={{ background: i <= phaseIdx ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }} />
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 8, color: i <= phaseIdx ? 'var(--fg-2)' : 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {UPLOAD_STEP_LABELS[s]}
                            </span>
                        </div>
                        {i < UPLOAD_STEPS.length - 1 && (
                            <div className="flex-1 h-px mx-1" style={{ background: i < phaseIdx ? 'var(--accent)' : 'rgba(255,255,255,0.1)' }} />
                        )}
                    </React.Fragment>
                ))}
            </div>
            {/* Animated progress bar */}
            <div className="h-px w-full rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                        width: phase === 'uploading' ? '35%' : phase === 'processing' ? '70%' : '100%',
                        background: 'var(--accent)',
                        boxShadow: '0 0 6px var(--accent)'
                    }}
                />
            </div>
            {/* GCS trust note */}
            <div className="flex items-center gap-1.5 mt-2">
                <Shield className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--fg-4)' }} />
                <span style={{ fontFamily: 'var(--f-sans)', fontSize: 9, color: 'var(--fg-4)' }}>
                    Securely uploaded to Google Cloud Storage
                </span>
            </div>
        </div>
    );
};

// Caption style presets for TASK 3
const CAPTION_STYLES = [
    {
        id: 'bold-impact',  name: 'Bold Impact',  font: 'Anton',            weight: 900,
        fontLabel: 'Anton',             tag: 'TikTok / viral',
        color: '#FACC15',   stroke: { width: 2, color: '#000000' },
        textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000',
        transform: 'uppercase', sample: 'AHA',
    },
    {
        id: 'clean-modern', name: 'Clean Modern', font: 'Montserrat',       weight: 800,
        fontLabel: 'Montserrat 800',    tag: 'Universal',
        color: '#FFFFFF',   stroke: null, textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        transform: 'uppercase', sample: 'Aha',
    },
    {
        id: 'soft-rounded', name: 'Soft Rounded', font: 'Nunito',           weight: 700,
        fontLabel: 'Nunito Bold',       tag: 'Lifestyle',
        color: '#FFFFFF',   stroke: null, textShadow: '0 2px 12px rgba(0,0,0,0.5)',
        transform: 'none',  sample: 'Aha',
    },
    {
        id: 'cinematic',    name: 'Cinematic',    font: 'Playfair Display', weight: 700,
        fontLabel: 'Playfair Italic',   tag: 'Documentary',
        style: 'italic',    color: '#F5E6C8', stroke: null,
        textShadow: '0 2px 16px rgba(0,0,0,0.8)', transform: 'none', sample: 'Aha',
    },
    {
        id: 'handwritten',  name: 'Handwritten',  font: 'Caveat',           weight: 700,
        fontLabel: 'Caveat Bold',       tag: 'Authentic',
        color: '#FFFFFF',   stroke: null, textShadow: '0 2px 6px rgba(0,0,0,0.4)',
        transform: 'none',  sample: 'Aha',
    },
    {
        id: 'motivational', name: 'Motivational', font: 'Oswald',           weight: 700,
        fontLabel: 'Oswald Bold',       tag: 'Coaching',
        color: '#FFFFFF',   stroke: { width: 1.5, color: '#000000' },
        textShadow: '0 2px 8px rgba(0,0,0,0.6)', transform: 'uppercase', sample: 'AHA',
    },
    {
        id: 'modern-tech',  name: 'Modern Tech',  font: 'Inter',            weight: 800,
        fontLabel: 'Inter ExtraBold',   tag: 'Tech / Media',
        color: '#FFFFFF',   stroke: null,
        textShadow: '0 2px 12px rgba(0,0,0,0.8)', transform: 'none', sample: 'Aha',
    },
    {
        id: 'extended-bold', name: 'Extended Bold', font: 'Unbounded',      weight: 900,
        fontLabel: 'Unbounded Black',   tag: 'Brand / Logo',
        color: '#FFFFFF',   stroke: null,
        textShadow: 'none', transform: 'uppercase', sample: 'DO',
    },
    {
        id: 'platform-sans', name: 'Platform Sans', font: 'DM Sans',        weight: 600,
        fontLabel: 'DM Sans SemiBold',  tag: 'App / Native',
        color: '#FFFFFF',   stroke: null,
        textShadow: '0 1px 6px rgba(0,0,0,0.6)', transform: 'none', sample: 'Aha',
    },
    {
        id: 'editorial',    name: 'Editorial',    font: 'Cormorant Garamond', weight: 700,
        fontLabel: 'Cormorant Bold Italic', tag: 'Editorial / Luxury',
        style: 'italic',    color: '#F5E6D3', stroke: null,
        textShadow: '0 2px 16px rgba(0,0,0,0.85)', transform: 'none', sample: 'grace',
    },
];

const FONT_STACK = (font) =>
    font === 'Caveat' ? `"${font}", cursive`
    : (font === 'Playfair Display' || font === 'Cormorant Garamond') ? `"${font}", serif`
    : `"${font}", sans-serif`;

const CaptionStylesCard = ({ log }) => {
    const [applied, setApplied] = useState(null);
    const applyStyle = (style) => {
        const { tracks, updateClip } = useTimelineStore.getState();
        const textTrack = tracks.find(t => t.type === 'text');
        if (!textTrack) return;
        const updates = {
            fontFamily: style.font,
            fontWeight: style.weight,
            color: style.color,
            stroke: style.stroke || null,
            textShadow: style.textShadow || null,
            fontStyle: style.style || 'normal',
        };
        textTrack.clips.forEach(clip => updateClip(textTrack.id, clip.id, updates));
        setApplied(style.id);
        useAIStore.getState().setActiveTab('captions');
    };

    return (
        <div
            className="rounded-xl p-3 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
            style={{ background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.07)' }}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <div style={{
                    width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #00E5FF 0%, #8A2BE2 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Type style={{ color: '#fff', width: 9, height: 9 }} />
                </div>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                    Caption Style
                </span>
            </div>

            {/* Style cards */}
            <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {CAPTION_STYLES.map(style => {
                    const isActive = applied === style.id;
                    return (
                        <button
                            key={style.id}
                            onClick={() => applyStyle(style)}
                            className="flex-shrink-0 transition-all"
                            style={{
                                minWidth: 82,
                                borderRadius: 10,
                                padding: 0,
                                border: 'none',
                                cursor: 'pointer',
                                background: isActive
                                    ? 'linear-gradient(135deg, #00E5FF 0%, #8A2BE2 100%)'
                                    : 'rgba(255,255,255,0.06)',
                                boxShadow: isActive ? '0 0 12px rgba(0,229,255,0.2)' : 'none',
                                transform: isActive ? 'scale(1.04)' : 'scale(1)',
                                transition: 'all 0.2s cubic-bezier(.22,.61,.36,1)',
                            }}
                        >
                            {/* Inner card */}
                            <div style={{
                                margin: isActive ? 1.5 : 1,
                                borderRadius: isActive ? 8.5 : 9,
                                background: isActive ? '#0a0a0c' : '#111114',
                                border: isActive ? 'none' : '0.5px solid rgba(255,255,255,0.08)',
                                overflow: 'hidden',
                                textAlign: 'center',
                            }}>
                                {/* Video-like preview area */}
                                <div style={{
                                    height: 52,
                                    background: 'linear-gradient(160deg, #1a1a2e 0%, #0d0d1a 100%)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '0 6px',
                                    position: 'relative',
                                    overflow: 'hidden',
                                }}>
                                    {/* Subtle video scanline texture */}
                                    <div style={{
                                        position: 'absolute', inset: 0,
                                        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)',
                                        pointerEvents: 'none',
                                    }} />
                                    <span style={{
                                        fontFamily: FONT_STACK(style.font),
                                        fontWeight: style.weight,
                                        fontStyle:  style.style || 'normal',
                                        fontSize:   style.id === 'handwritten' ? 22 : 20,
                                        color:      style.color,
                                        textShadow: style.textShadow || 'none',
                                        WebkitTextStroke: style.stroke ? `${style.stroke.width}px ${style.stroke.color}` : 'none',
                                        textTransform: style.transform || 'none',
                                        letterSpacing: style.id === 'bold-impact' || style.id === 'motivational' ? '0.04em' : 'normal',
                                        lineHeight: 1,
                                        position: 'relative',
                                        zIndex: 1,
                                    }}>
                                        {style.sample}
                                    </span>
                                </div>
                                {/* Style name + font label + tag */}
                                <div style={{ padding: '4px 4px 5px', textAlign: 'center' }}>
                                    <div style={{
                                        fontFamily: 'var(--f-mono)',
                                        fontSize:   7.5,
                                        color:      isActive ? '#00E5FF' : 'var(--fg-3)',
                                        letterSpacing: '0.07em',
                                        textTransform: 'uppercase',
                                        lineHeight: 1.3,
                                        transition: 'color 0.2s',
                                    }}>
                                        {style.name}
                                    </div>
                                    <div style={{
                                        fontFamily: FONT_STACK(style.font),
                                        fontWeight: style.weight,
                                        fontStyle:  style.style || 'normal',
                                        fontSize:   7,
                                        color:      isActive ? 'rgba(0,229,255,0.7)' : 'rgba(255,255,255,0.35)',
                                        lineHeight: 1.4,
                                        transition: 'color 0.2s',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>
                                        {style.fontLabel}
                                    </div>
                                    <div style={{
                                        fontFamily: 'var(--f-mono)',
                                        fontSize:   6,
                                        color:      isActive ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.2)',
                                        letterSpacing: '0.05em',
                                        lineHeight: 1.4,
                                        transition: 'color 0.2s',
                                    }}>
                                        {style.tag}
                                    </div>
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const ReasoningPanel = () => {
    const { logs, suggestions, isAnalyzing, setIsAnalyzing, addLog, removeSuggestion, contextualSuggestion, quickChips, setActiveTab } = useAIStore();
    const { uploadedFile, performAction, assets, tracks } = useTimelineStore(useShallow(state => ({
        uploadedFile:  state.uploadedFile,
        performAction: state.performAction,
        assets:        state.assets,
        tracks:        state.tracks,
    })));

    // Detect if any caption/text clips exist on the timeline
    const hasCaptionClips = tracks?.some(t => t.clips?.some(c => c.type === 'text' || c.type === 'caption'));
    const { recordDecision } = useUserPreferences();
    const scrollRef = useRef(null);

    // Auto-scroll to bottom whenever logs change (so new cards like caption_styles are always visible)
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, [logs]);

    const proxying = assets.filter(a => a.isProxying);
    const isEmpty = logs.length === 0 && suggestions.length === 0 && !isAnalyzing;

    const handleAccept = async (suggestion, commandText = null) => {
        if (suggestion.type === 'agent_plan') {
            // V2: Plans auto-execute, but legacy approval still supported
            removeSuggestion(suggestion.id);
            return;
        }

        // next_actions: user clicked a specific suggestion chip — submit it as a command
        if (suggestion.type === 'next_actions') {
            removeSuggestion(suggestion.id);
            if (commandText && inputRef.current) {
                inputRef.current.value = commandText;
                await processCommand();
            }
            return;
        }

        // 🧠 Memory: Record Decision
        if (suggestion.type === 'silence') recordDecision('silence', true);
        if (suggestion.type === 'music') recordDecision('music', true, suggestion.data);
        if (suggestion.type === 'captions') recordDecision('captions', true);

        if (suggestion.executionData) performAction(suggestion.executionData);

        removeSuggestion(suggestion.id);
    };

    const handleReject = (id) => {
        const suggestion = suggestions.find(s => s.id === id);
        if (suggestion) {
            // 🧠 Memory: Record Rejection
            if (suggestion.type === 'silence') recordDecision('silence', false);
            if (suggestion.type === 'music') recordDecision('music', false);
            if (suggestion.type === 'captions') recordDecision('captions', false);
        }
        removeSuggestion(id);
    };

    // ... imports
    // ... imports removed


    // ... (existing helper components)

    // --- Editorial Brain (parallel layer, non-blocking) ---
    const {
        sendCommand:    brainSendCommand,
        sendFeedback:   brainSendFeedback,
        isProcessing:   brainIsProcessing,
        lastResponse:   brainLastResponse,
    } = useBrain();

    // --- Command Handling Logic ---
    const inputRef = useRef(null);
    const lastSubmitRef = useRef(0);

    const processCommand = async () => {
        const input = inputRef.current;
        if (!input) return;
        const command = input.value.trim();
        if (!command) return;

        // Dedup guard: ignore if same message submitted < 300 ms ago
        const now = Date.now();
        if (now - lastSubmitRef.current < 300) return;
        lastSubmitRef.current = now;

        input.value = '';

        addLog({
            id: 'user-' + now,
            timestamp: new Date().toLocaleTimeString(),
            type: 'info',
            message: `You: ${command}`
        });

        // If the agent is waiting for clarification, answer it directly.
        // This prevents the "please clarify → please clarify" loop where each
        // follow-up was starting a new job instead of resolving the pending one.
        const wfState = workflowController.getState();
        if (wfState === 'clarifying') {
            workflowController.submitClarification({ answer: command });
            return;
        }

        setIsAnalyzing(true);
        const { uploadedFile, tracks } = useTimelineStore.getState();
        const hasClips = tracks?.some(t => t.clips?.length > 0);

        if (!uploadedFile && !hasClips && !command.toLowerCase().includes('sample')) {
            addLog({
                id: 'agent-err-' + now,
                timestamp: new Date().toLocaleTimeString(),
                type: 'warning',
                message: `Agent: No file selected. Please import a file first.`
            });
            setIsAnalyzing(false);
            return;
        }

        try {
            workflowController.processUserPrompt(command);
            // Fire brain in parallel — does NOT block or affect the existing pipeline.
            // brainSendCommand is safe to call without await here; it handles its own errors.
            brainSendCommand(command);
        } catch (err) {
            setIsAnalyzing(false);
            console.error(err);
            addLog({
                id: 'agent-crash-' + now,
                timestamp: new Date().toLocaleTimeString(),
                type: 'warning',
                message: `Agent Error: ${err.message}`
            });
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            processCommand();
        }
    };

    const handleInput = (e) => {
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    };

    return (
        <aside className="w-full h-full border-l border-border bg-card flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.1)]">
            {/* Header */}
            <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: "var(--line-soft)", background: "var(--glass)" }}>
                <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", animation: "pulse-soft 2s infinite" }} />
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg)", letterSpacing: "0.08em", fontWeight: 600 }}>ROKA</span>
                </div>
                <div className="flex items-center gap-2">
                    {isAnalyzing && <Activity className="w-3 h-3 text-purple-400 animate-pulse" />}
                    <div className={classNames(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                        isAnalyzing ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "border-white/10"
                    )}
                    style={isAnalyzing ? {} : { background: 'rgba(255,255,255,0.06)', color: 'var(--fg-2)' }}>
                        {isAnalyzing ? "Agent Working..." : "Ready"}
                    </div>
                </div>
            </div>

            {/* Scrollable Content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 relative scroll-smooth">
                {/* Upload progress cards */}
                {proxying.map(asset => (
                    <UploadStatusCard key={asset.id} asset={asset} />
                ))}

                {/* Empty state with contextual suggestion + quick chips */}
                {isEmpty && proxying.length === 0 && (
                    <div className="flex flex-col gap-4 pt-4 pb-2">
                        {contextualSuggestion ? (
                            <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Try this</span>
                                </div>
                                <button
                                    onClick={() => { if (inputRef.current) { inputRef.current.value = contextualSuggestion; inputRef.current.focus(); } }}
                                    className="text-left w-full"
                                    style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg)', lineHeight: 1.55 }}
                                >
                                    "{contextualSuggestion}"
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2 py-6 opacity-50">
                                <Brain className="w-8 h-8" style={{ color: 'var(--fg-3)' }} />
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ready</span>
                            </div>
                        )}
                        {/* Quick chips */}
                        <div>
                            <span className="block mb-2" style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Quick actions</span>
                            <div className="flex flex-wrap gap-1.5">
                                {quickChips.map(chip => (
                                    <button
                                        key={chip}
                                        onClick={() => { if (inputRef.current) { inputRef.current.value = chip; inputRef.current.focus(); } }}
                                        className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
                                        style={{ background: 'rgba(255,255,255,0.07)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'var(--fg-2)', fontFamily: 'var(--f-sans)' }}
                                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--fg)'; e.currentTarget.style.background = 'rgba(255,255,255,0.11)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-2)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
                                    >
                                        {chip}
                                    </button>
                                ))}
                                {hasCaptionClips && (
                                    <button
                                        onClick={() => setActiveTab('captions')}
                                        className="px-2.5 py-1 rounded-full text-[10px] transition-colors flex items-center gap-1"
                                        style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)', border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)', color: 'var(--accent)', fontFamily: 'var(--f-sans)' }}
                                    >
                                        <Type className="w-2.5 h-2.5" /> Edit captions
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Logs Stream */}
                {logs.map(log => (
                    <LogItem key={log.id} log={log} />
                ))}

                {/* Active Suggestions */}
                {suggestions.map(suggestion => (
                    suggestion.type === 'agent_plan' ? (
                        <AgentPlanCard
                            key={suggestion.id}
                            suggestion={suggestion}
                            onAccept={handleAccept}
                            onReject={removeSuggestion}
                        />
                    ) : suggestion.type === 'next_actions' ? (
                        <NextActionsCard
                            key={suggestion.id}
                            suggestion={suggestion}
                            onAccept={handleAccept}
                            onReject={removeSuggestion}
                        />
                    ) : (
                        <SuggestionCard
                            key={suggestion.id}
                            suggestion={suggestion}
                            onAccept={handleAccept}
                            onReject={removeSuggestion}
                        />
                    )
                ))}

                {isAnalyzing && (
                    <div className="sticky bottom-0 rounded-lg p-3 mt-2 border animate-in fade-in duration-300" style={{ background: 'rgba(0,0,0,0.6)', borderColor: 'var(--line)', backdropFilter: 'blur(12px)' }}>
                        <div className="flex items-center gap-2 mb-2">
                            <div className="relative w-4 h-4 shrink-0">
                                <Loader2 className="w-4 h-4 animate-spin absolute inset-0" style={{ color: 'var(--accent)' }} />
                            </div>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                Agent working
                            </span>
                            <button
                                onClick={() => {
                                    workflowController.cancelCurrentJob();
                                    setIsAnalyzing(false);
                                    addLog({
                                        id: 'cancelled-' + Date.now(),
                                        type: 'info',
                                        message: 'Operation cancelled.',
                                        timestamp: new Date().toLocaleTimeString()
                                    });
                                }}
                                className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors hover:opacity-80"
                                style={{ background: 'rgba(255,255,255,0.07)', color: 'var(--fg-3)', fontFamily: 'var(--f-mono)', border: '0.5px solid var(--line)' }}
                                title="Cancel this operation"
                            >
                                <XCircle className="w-3 h-3" />
                                Cancel
                            </button>
                        </div>
                        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--fg-3)', fontFamily: 'var(--f-sans)' }}>
                            Steps appear above as they complete. This can take 10–30 s for longer videos.
                        </p>
                    </div>
                )}

                {/* Editorial Brain — rendered inside the scroll container so it
                    flows naturally as part of the conversation, not as a fixed
                    section below the input. */}
                <BrainPanel
                    brainOutput={brainLastResponse}
                    isProcessing={brainIsProcessing}
                    onSendCommand={(text) => {
                        if (inputRef.current) {
                            inputRef.current.value = text;
                            inputRef.current.focus();
                        }
                        brainSendCommand(text);
                    }}
                    onSendFeedback={brainSendFeedback}
                />
            </div>

            {/* Persistent Edit Captions chip — visible whenever captions exist */}
            {hasCaptionClips && (
                <div className="px-4 pt-2 pb-0 flex" style={{ borderTop: '0.5px solid var(--line-soft)' }}>
                    <button
                        onClick={() => setActiveTab('captions')}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] transition-colors"
                        style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)', border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)', color: 'var(--accent)', fontFamily: 'var(--f-sans)' }}
                    >
                        <Type className="w-2.5 h-2.5" /> Edit captions
                    </button>
                </div>
            )}

            {/* Input Area */}
            <div className="p-4 border-t" style={{ borderColor: 'var(--line-soft)', background: 'var(--glass)' }}>
                <div className="relative group rounded-lg overflow-hidden transition-all"
                    style={{ border: '1px solid var(--line)', background: 'rgba(0,0,0,0.35)' }}
                    onFocusCapture={e => e.currentTarget.style.border = '1px solid var(--accent)'}
                    onBlurCapture={e => e.currentTarget.style.border = '1px solid var(--line)'}
                >
                    <textarea
                        ref={inputRef}
                        rows={3}
                        disabled={isAnalyzing}
                        onKeyDown={handleKeyDown}
                        onInput={handleInput}
                        placeholder={isAnalyzing ? "Agent is working…" : contextualSuggestion ? `Try: ${contextualSuggestion}` : "Tell the agent what to do…"}
                        className="w-full resize-none px-4 pt-3 pb-10 text-sm focus:outline-none transition-all disabled:opacity-50 placeholder:opacity-40"
                        style={{ background: 'transparent', color: 'var(--fg)', fontFamily: 'var(--f-sans)', lineHeight: '1.5', minHeight: '88px', maxHeight: '160px' }}
                    />
                    <div className="absolute bottom-2.5 right-2.5 flex items-center gap-2">
                        <span className="text-[10px] opacity-30" style={{ color: 'var(--fg)', fontFamily: 'var(--f-mono)' }}>⇧↵ newline</span>
                        <button
                            onClick={processCommand}
                            disabled={isAnalyzing}
                            className="p-1.5 rounded-md transition-all disabled:opacity-40 hover:opacity-90"
                            style={{ background: 'var(--accent)' }}
                        >
                            <ArrowRight className="w-3.5 h-3.5 text-white" />
                        </button>
                    </div>
                </div>
            </div>

        </aside>
    );
};

export default ReasoningPanel;
