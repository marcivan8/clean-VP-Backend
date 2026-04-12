import React, { useRef, useEffect, useState } from 'react';
import { Sparkles, Brain, Check, X, ArrowRight, Activity, MessageSquare, Loader2, XCircle } from 'lucide-react';
import useAIStore from '../../store/useAIStore';
import useTimelineStore from '../../store/useTimelineStore';
import useJobStore, { JOB_STATES, TERMINAL_STATES } from '../../store/useJobStore';
import { analyzeFile } from '../../services/aiService';
import { parseAgentCommand } from '../../services/autoEditService';
import classNames from 'classnames';
import useUserPreferences from '../../store/useUserPreferences';
import { workflowController } from '../../agent/WorkflowController.js';


// --- Sub-components ---

const LogItem = ({ log }) => {
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

const ReasoningPanel = () => {
    const { logs, suggestions, isAnalyzing, setIsAnalyzing, addLog, addSuggestion, removeSuggestion, clearSession } = useAIStore();
    const { uploadedFile, performAction } = useTimelineStore();
    const { recordDecision } = useUserPreferences(); // Connect to Memory
    const scrollRef = useRef(null);

    // Subscribe to job store for progress display
    const activeJob = useJobStore(state => state.getActiveJob());
    const jobProgress = activeJob?.progress || 0;
    const jobState = activeJob?.state || 'IDLE';

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

    const processCommand = async () => {
        const input = inputRef.current;
        if (!input) return;

        const command = input.value;
        if (!command.trim()) return;

        input.value = '';
        console.log("DEBUG: Processing command:", command);

        addLog({
            id: 'user-' + Date.now(),
            timestamp: new Date().toLocaleTimeString(),
            type: 'info',
            message: `You: ${command}`
        });

        setIsAnalyzing(true);
        const { uploadedFile, tracks } = useTimelineStore.getState();
        const hasClips = tracks?.some(t => t.clips?.length > 0);

        // 🚨 Validation
        if (!uploadedFile && !hasClips && !command.toLowerCase().includes('sample')) {
            addLog({
                id: 'agent-err-' + Date.now(),
                timestamp: new Date().toLocaleTimeString(),
                type: 'warning',
                message: `Agent: No file selected. Please import a file first.`
            });
            setIsAnalyzing(false);
            return;
        }

        const filename = uploadedFile ? uploadedFile.name : 'sample.mp4';
        console.log("🤖 Agent Command:", command, "for file:", filename);

        try {
            // Delegate to WorkflowController (V2 pipeline)
            // The controller handles: intent parsing → plan generation → compile → execute → validate
            workflowController.processUserPrompt(command);

        } catch (err) {
            setIsAnalyzing(false);
            console.error(err);
            addLog({
                id: 'agent-crash-' + Date.now(),
                timestamp: new Date().toLocaleTimeString(),
                type: 'warning',
                message: `Agent Error: ${err.message}`
            });
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            processCommand();
        }
    };

    return (
        <aside className="w-full h-full border-l border-border bg-card flex flex-col shadow-[-4px_0_15px_-3px_rgba(0,0,0,0.1)]">
            {/* Header */}
            <div className="p-4 border-b border-border flex items-center justify-between bg-card z-10">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-purple-500" />
                    <span className="text-sm font-semibold">AI Assistant</span>
                </div>
                <div className="flex items-center gap-2">
                    {isAnalyzing && <Activity className="w-3 h-3 text-purple-400 animate-pulse" />}
                    <div className={classNames(
                        "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                        isAnalyzing ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-secondary text-muted-foreground border-border"
                    )}>
                        {isAnalyzing ? "Agent Working..." : "Ready"}
                    </div>
                </div>
            </div>

            {/* Scrollable Content */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 relative scroll-smooth">
                {/* ... existing logs rendering ... */}
                {logs.length === 0 && suggestions.length === 0 && !isAnalyzing && (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-50 p-4">
                        <Brain className="w-12 h-12 text-muted-foreground mb-3" />
                        <p className="text-sm text-muted-foreground">Detailed Agent Mode</p>
                        <p className="text-xs text-muted-foreground/50 mt-1">Try: "Remove silence" or "Cut the gaps"</p>
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
                        <SuggestionCard // Legacy/Other suggestions
                            key={suggestion.id}
                            suggestion={suggestion}
                            onAccept={handleAccept}
                            onReject={removeSuggestion}
                        />
                    )
                ))}

                {isAnalyzing && (
                    <div className="flex gap-3 text-xs animate-pulse">
                        <div className="flex flex-col items-center pt-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0"></div>
                            <div className="w-px h-full bg-gradient-to-b from-purple-500 via-transparent to-transparent my-1 h-8"></div>
                        </div>
                        <span className="text-purple-400/80 italic">Agent is processing edits...</span>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-border bg-card">
                <div className="relative group">
                    <input
                        ref={inputRef}
                        type="text"
                        disabled={isAnalyzing}
                        onKeyDown={handleKeyDown}
                        placeholder={isAnalyzing ? "Agent is working..." : "Tell the agent what to do..."}
                        className="w-full bg-secondary/50 border border-border rounded-md pl-3 pr-10 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all placeholder:text-muted-foreground/50 disabled:opacity-50"
                    />
                    <button
                        onClick={processCommand}
                        disabled={isAnalyzing}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                        <ArrowRight className="w-3 h-3" />
                    </button>
                </div>
            </div>
        </aside>
    );
};

export default ReasoningPanel;
