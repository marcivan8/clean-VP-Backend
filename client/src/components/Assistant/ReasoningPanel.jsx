import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Sparkles, Brain, Check, X, ArrowRight, Activity, MessageSquare, Loader2, XCircle, Shield } from 'lucide-react';
import useAIStore from '../../store/useAIStore';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import useJobStore, { JOB_STATES, TERMINAL_STATES } from '../../store/useJobStore';
import { analyzeFile } from '../../services/aiService';
import { parseAgentCommand } from '../../services/autoEditService';
import classNames from 'classnames';
import useUserPreferences from '../../store/useUserPreferences';
import { workflowController } from '../../agent/WorkflowController.js';


// --- Sub-components ---

const StepLogItem = ({ log }) => (
    <div className="flex items-center gap-2 py-1.5 animate-in fade-in slide-in-from-bottom-1 duration-200">
        <Loader2 className="w-3 h-3 shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)', letterSpacing: '0.04em' }}>
            {log.message}
        </span>
    </div>
);

const AssistantLogItem = ({ log }) => (
    <div className="rounded-lg p-3 mb-1 animate-in fade-in slide-in-from-bottom-2 duration-300" style={{ background: 'rgba(0,0,0,0.25)', border: '0.5px solid var(--line)' }}>
        <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Assistant</span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed" style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)' }}>
            {log.message}
        </p>
    </div>
);

const TaskCompletionCard = ({ log }) => {
    const [dismissed, setDismissed] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const stepsApplied = log.data?.stepsApplied ?? 0;
    const preTaskHistoryLen = log.data?.preTaskHistoryLen ?? 0;

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

    return (
        <div className="rounded-lg p-3 mb-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
             style={{ background: 'rgba(0,0,0,0.25)', border: '0.5px solid var(--line)' }}>
            <div className="flex items-center gap-1.5 mb-2">
                <Check className="w-3 h-3" style={{ color: 'var(--mint, #34d399)' }} />
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Terminé
                </span>
                {stepsApplied > 0 && (
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', marginLeft: 'auto' }}>
                        {stepsApplied} modification{stepsApplied !== 1 ? 's' : ''}
                    </span>
                )}
            </div>
            <p className="mb-3 leading-relaxed whitespace-pre-wrap"
               style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)' }}>
                {log.message}
            </p>
            {log.data?.details && log.data.details.length > 0 && (
                <ul className="mb-3 space-y-1">
                    {log.data.details.map((step, i) => (
                        <li key={i} className="flex items-start gap-2"
                            style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-3)' }}>
                            <span style={{ color: step.status === 'success' ? 'var(--mint, #34d399)' : 'var(--coral, #f87171)' }}>
                                {step.status === 'success' ? '✓' : '✗'}
                            </span>
                            <span>{step.action}{step.result?.message ? ` — ${step.result.message}` : ''}</span>
                        </li>
                    ))}
                </ul>
            )}
            {stepsApplied > 0 ? (
                <div className="flex gap-2">
                    <button
                        onClick={handleAccept}
                        className="flex-1 text-xs py-1.5 rounded-md transition-all font-medium flex items-center justify-center gap-1.5"
                        style={{
                            background: 'color-mix(in oklch, var(--accent) 18%, transparent)',
                            border: '0.5px solid color-mix(in oklch, var(--accent) 35%, transparent)',
                            color: 'var(--accent)',
                        }}
                    >
                        <Check className="w-3 h-3" /> Accepter
                    </button>
                    <button
                        onClick={handleReject}
                        disabled={rejecting}
                        className="flex-1 text-xs py-1.5 rounded-md transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                        style={{
                            background: 'rgba(255,255,255,0.04)',
                            border: '0.5px solid var(--line)',
                            color: 'var(--fg-3)',
                        }}
                    >
                        <X className="w-3 h-3" /> {rejecting ? 'Annulation…' : 'Rejeter'}
                    </button>
                </div>
            ) : (
                <button
                    onClick={handleAccept}
                    className="text-xs px-3 py-1 rounded-md"
                    style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--fg-3)', border: '0.5px solid var(--line)' }}
                >
                    OK
                </button>
            )}
        </div>
    );
};

const LogItem = ({ log }) => {
    if (log.type === 'step')          return <StepLogItem log={log} />;
    if (log.type === 'assistant')     return <AssistantLogItem log={log} />;
    if (log.type === 'task_complete') return <TaskCompletionCard log={log} />;

    const isSuccess = log.type === 'success';
    const isWarning = log.type === 'warning';
    const isAgent = log.id.startsWith('agent-');

    return (
        <div className="flex gap-3 text-xs animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex flex-col items-center pt-1">
                <div className={classNames(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    isSuccess ? "bg-green-500" : isWarning ? "bg-orange-500" : "bg-blue-500"
                )}></div>
                <div className="w-px h-full bg-border my-1"></div>
            </div>
            <div className="pb-4 w-full">
                <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[10px] text-muted-foreground">{log.timestamp}</span>
                    {isSuccess && <span className="text-[10px] text-green-400 font-medium">DETECTED</span>}
                    {isAgent && log.data?.thought && <span className="text-[10px] text-purple-400 font-bold uppercase">AI Plan</span>}
                </div>
                <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {log.message}
                </p>

                {/* Rich Agent Data */}
                {log.data && (
                    <div className="mt-2 bg-black/20 rounded p-2 border border-white/5">
                        {log.data.thought && (
                            <div className="mb-2 italic text-purple-300/80 border-b border-white/5 pb-2">
                                " {log.data.thought} "
                            </div>
                        )}
                        {log.data.details && (
                            <ul className="space-y-1">
                                {log.data.details.map((active, i) => (
                                    <li key={i} className="flex items-start gap-2 text-[10px]">
                                        <span className={active.status === 'success' ? "text-green-500" : "text-red-500"}>
                                            {active.status === 'success' ? "✓" : "✗"}
                                        </span>
                                        <span className="text-muted-foreground">
                                            <span className="font-semibold text-foreground/80">{active.action}</span>
                                            {active.result?.message && <span className="ml-1 opacity-70">- {active.result.message}</span>}
                                            {active.error && <span className="ml-1 text-red-400">- {active.error}</span>}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        {log.data.issues && log.data.issues.length > 0 && (
                            <div className="mt-2 text-orange-400 bg-orange-500/10 p-1.5 rounded">
                                <strong>⚠️ Verification Issues:</strong>
                                <ul className="list-disc list-inside mt-1 opacity-80">
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
        <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-lg p-3 border border-purple-500/30 shadow-md relative overflow-hidden mb-4 opacity-0 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex items-center gap-2 mb-2 relative z-10">
                <div className="bg-purple-500/20 p-1 rounded">
                    <Brain className="w-3 h-3 text-purple-400" />
                </div>
                <span className="text-xs font-bold text-purple-300 uppercase tracking-wider">
                    Agent Proposal
                </span>
            </div>

            <div className="mb-3">
                <div className="mb-2 italic text-purple-300/80 text-[11px] leading-relaxed border-l-2 border-purple-500/30 pl-2">
                    "{thought}"
                </div>
                <div className="bg-black/20 rounded p-2 max-h-32 overflow-y-auto">
                    <ul className="space-y-1">
                        {actions.map((action, i) => (
                            <li key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                <span className="font-mono text-purple-400">[{action.name}]</span>
                                <span className="truncate">{JSON.stringify(action.args)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            <div className="flex gap-2 relative z-10">
                <button
                    onClick={() => onAccept(suggestion)}
                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs py-1.5 rounded-md transition-colors font-medium shadow-lg shadow-purple-900/20 flex items-center justify-center gap-1"
                >
                    <Check className="w-3 h-3" /> Approve Plan
                </button>
                <button
                    onClick={() => onReject(suggestion.id)}
                    className="flex-1 bg-secondary hover:bg-secondary/80 text-xs py-1.5 rounded-md transition-colors border border-white/5 flex items-center justify-center gap-1"
                >
                    <X className="w-3 h-3" /> Resize
                </button>
            </div>
        </div>
    );
};


const SuggestionCard = ({ suggestion, onAccept, onReject }) => {
    return (
        <div className="bg-secondary/50 rounded-lg p-3 border border-border shadow-sm mb-3 opacity-0 animate-in fade-in zoom-in-95 duration-500">
            <div className="flex items-center gap-2 mb-2">
                <div className="bg-blue-500/20 p-1 rounded">
                    <Sparkles className="w-3 h-3 text-blue-400" />
                </div>
                <span className="text-xs font-semibold text-foreground/80 capitalize">
                    {suggestion.type || 'Suggestion'}
                </span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                {suggestion.message || suggestion.label || 'Apply this suggestion?'}
            </p>

            <div className="flex gap-2">
                <button
                    onClick={() => onAccept(suggestion)}
                    className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground text-xs py-1.5 rounded-md transition-colors font-medium flex items-center justify-center gap-1"
                >
                    <Check className="w-3 h-3" /> Apply
                </button>
                <button
                    onClick={() => onReject(suggestion.id)}
                    className="flex-1 bg-secondary hover:bg-secondary/80 text-xs py-1.5 rounded-md transition-colors border border-white/5 flex items-center justify-center gap-1"
                >
                    <X className="w-3 h-3" /> Dismiss
                </button>
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

const ReasoningPanel = () => {
    const { logs, suggestions, isAnalyzing, setIsAnalyzing, addLog, removeSuggestion, contextualSuggestion, quickChips } = useAIStore();
    const { uploadedFile, performAction, assets } = useTimelineStore(useShallow(state => ({
        uploadedFile:  state.uploadedFile,
        performAction: state.performAction,
        assets:        state.assets,
    })));
    const { recordDecision } = useUserPreferences();
    const scrollRef = useRef(null);

    const proxying = assets.filter(a => a.isProxying);
    const isEmpty = logs.length === 0 && suggestions.length === 0 && !isAnalyzing;

    const handleAccept = async (suggestion) => {
        console.log("Accepted suggestion:", suggestion);

        if (suggestion.type === 'agent_plan') {
            // V2: Plans auto-execute, but legacy approval still supported
            console.log('[ReasoningPanel] Legacy plan approval - V2 auto-executes');
            removeSuggestion(suggestion.id);
            return;
        }

        // 🧠 Memory: Record Decision
        if (suggestion.type === 'silence') recordDecision('silence', true);
        if (suggestion.type === 'music') recordDecision('music', true, suggestion.data);
        if (suggestion.type === 'captions') recordDecision('captions', true);

        if (suggestion.executionData) {
            const success = performAction(suggestion.executionData);
            if (success) {
                // Log success?
            }
        }

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
                    <span className="studio-mono-label" style={{ color: "var(--fg-4)" }}>AI</span>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)", animation: "pulse-soft 2s infinite" }} />
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", letterSpacing: "0.04em" }}>Assistant</span>
                </div>
                <div className="flex items-center gap-2">
                    {isAnalyzing && <Activity className="w-3 h-3 text-purple-400 animate-pulse" />}
                    <div className={classNames(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                        isAnalyzing ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-black/40 text-muted-foreground border-white/10"
                    )}>
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
                            <div className="rounded-lg p-3 border" style={{ background: 'rgba(0,0,0,0.25)', borderColor: 'var(--line)' }}>
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Try this</span>
                                </div>
                                <button
                                    onClick={() => { if (inputRef.current) { inputRef.current.value = contextualSuggestion; inputRef.current.focus(); } }}
                                    className="text-left w-full"
                                    style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-2)', lineHeight: 1.5 }}
                                >
                                    "{contextualSuggestion}"
                                </button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-2 py-6 opacity-40">
                                <Brain className="w-8 h-8" style={{ color: 'var(--fg-4)' }} />
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assistant</span>
                            </div>
                        )}
                        {/* Quick chips */}
                        <div>
                            <span className="block mb-2" style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Quick actions</span>
                            <div className="flex flex-wrap gap-1.5">
                                {quickChips.map(chip => (
                                    <button
                                        key={chip}
                                        onClick={() => { if (inputRef.current) { inputRef.current.value = chip; inputRef.current.focus(); } }}
                                        className="px-2.5 py-1 rounded-full text-[10px] transition-colors"
                                        style={{ background: 'var(--glass-2)', border: '0.5px solid var(--glass-stroke)', color: 'var(--fg-3)', fontFamily: 'var(--f-sans)' }}
                                        onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                                        onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                                    >
                                        {chip}
                                    </button>
                                ))}
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
                        <p className="text-[10px] leading-relaxed" style={{ color: 'var(--fg-4)', fontFamily: 'var(--f-sans)' }}>
                            Steps appear above as they complete. This can take 10–30 s for longer videos.
                        </p>
                    </div>
                )}
            </div>

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
