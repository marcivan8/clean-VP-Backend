/**
 * AutonomousEditingPanel — Phase 7
 * Floating overlay showing step-by-step autonomous editing progress.
 * Allows Continue / Edit / Skip / Abort at each step.
 * Editor remains fully interactive during autonomous mode.
 */
import React, { useState, useEffect } from 'react';
import { AutonomousEditingMode, STEP_STATE, AUTO_MODE } from '../agent/AutonomousEditingMode.js';
import { EventBus, EVENT_TYPES } from '../agent/EventBus.js';
import { Wand2, X, Clock, Zap, CheckCircle, SkipForward, AlertCircle, Play, Pencil, XCircle } from 'lucide-react';

const STEP_ICONS = { 
    [STEP_STATE.PENDING]: <Clock className="w-3.5 h-3.5" />, 
    [STEP_STATE.AWAITING]: <AlertCircle className="w-3.5 h-3.5" />, 
    [STEP_STATE.EXECUTING]: <Zap className="w-3.5 h-3.5" />, 
    [STEP_STATE.DONE]: <CheckCircle className="w-3.5 h-3.5" />, 
    [STEP_STATE.SKIPPED]: <SkipForward className="w-3.5 h-3.5" />, 
    [STEP_STATE.FAILED]: <XCircle className="w-3.5 h-3.5" /> 
};
const STEP_COLORS = { 
    [STEP_STATE.DONE]: 'text-green-500 bg-green-500/10 border-green-500/20', 
    [STEP_STATE.AWAITING]: 'text-orange-500 bg-orange-500/10 border-orange-500/20', 
    [STEP_STATE.EXECUTING]: 'text-primary bg-primary/10 border-primary/20', 
    [STEP_STATE.FAILED]: 'text-red-500 bg-red-500/10 border-red-500/20', 
    [STEP_STATE.SKIPPED]: 'text-muted-foreground bg-secondary/50 border-border', 
    [STEP_STATE.PENDING]: 'text-muted-foreground/50 bg-secondary/20 border-transparent' 
};

export function AutonomousEditingPanel({ defaultPrompt = '' }) {
    const [isOpen, setIsOpen] = useState(false);
    const [prompt, setPrompt] = useState(defaultPrompt);
    const [mode, setMode] = useState(AUTO_MODE.STEP_BY_STEP);
    const [status, setStatus] = useState(null);
    const [steps, setSteps] = useState([]);
    const [currentStep, setCurrentStep] = useState(null);
    const [editingStep, setEditingStep] = useState(null);  // step being edited
    const [editedParams, setEditedParams] = useState({});
    const [isRunning, setIsRunning] = useState(false);
    const [logMessages, setLogMessages] = useState([]);

    useEffect(() => {
        const unsubs = [
            EventBus.on(EVENT_TYPES.AUTONOMOUS_PLAN_READY, ({ steps: s }) => { setSteps(s); setIsRunning(true); }),
            EventBus.on(EVENT_TYPES.AUTONOMOUS_STEP_READY, ({ step }) => { setCurrentStep(step); }),
            EventBus.on(EVENT_TYPES.AUTONOMOUS_STEPS_UPDATED, ({ steps: s }) => setSteps([...s])),
            EventBus.on(EVENT_TYPES.AUTONOMOUS_STATUS, ({ message, status: st }) => {
                setStatus(st);
                setLogMessages(prev => [...prev.slice(-19), { message, time: new Date().toLocaleTimeString() }]);
            }),
            EventBus.on(EVENT_TYPES.AUTONOMOUS_SESSION_ENDED, () => { setIsRunning(false); setCurrentStep(null); })
        ];
        return () => unsubs.forEach(u => u());
    }, []);

    const handleStart = () => {
        if (!prompt.trim()) return;
        setLogMessages([]);
        setSteps([]);
        AutonomousEditingMode.setMode(mode);
        AutonomousEditingMode.start(prompt, mode);
    };

    const handleContinue = () => {
        const params = editingStep ? editedParams : null;
        setEditingStep(null);
        setEditedParams({});
        AutonomousEditingMode.continueStep(params);
    };

    const handleSkip = () => {
        setEditingStep(null);
        AutonomousEditingMode.skipStep();
    };

    const handleAbort = () => {
        AutonomousEditingMode.abort();
        setIsRunning(false);
    };

    const openEditStep = (step) => {
        setEditingStep(step);
        setEditedParams({ ...step });
    };

    const done  = steps.filter(s => s.state === STEP_STATE.DONE).length;
    const total = steps.length;
    const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    const awaitingApproval = currentStep?.state === STEP_STATE.AWAITING && mode === AUTO_MODE.STEP_BY_STEP;

    return (
        <>
            {/* Floating toggle button */}
            <button id="autonomous-toggle-btn" onClick={() => setIsOpen(!isOpen)}
                className={`fixed bottom-20 right-6 z-[9000] w-12 h-12 rounded-full border-none cursor-pointer flex items-center justify-center transition-all shadow-xl ${isRunning ? 'bg-primary text-primary-foreground shadow-primary/30' : 'bg-secondary text-foreground hover:bg-secondary/80 border border-border'}`}>
                <Wand2 className="w-5 h-5" />
            </button>

            {/* Panel */}
            {isOpen && (
                <div id="autonomous-editing-panel" className="fixed bottom-36 right-6 z-[9001] w-[340px] max-h-[70vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl font-sans text-foreground overflow-hidden">

                    {/* Header */}
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-card">
                        <div className="flex items-center gap-2">
                            <Wand2 className="w-4 h-4 text-primary" />
                            <span className="text-sm font-semibold">Autonomous Mode</span>
                            {isRunning && <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-bold uppercase tracking-wider">Live</span>}
                        </div>
                        <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors"><X className="w-4 h-4" /></button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {/* Mode + Prompt */}
                        {!isRunning && (
                            <div className="p-4">
                                <div className="flex gap-2 mb-3">
                                    {[AUTO_MODE.STEP_BY_STEP, AUTO_MODE.FULL_AUTO].map(m => (
                                        <button key={m} onClick={() => setMode(m)}
                                            className={`flex-1 py-1.5 rounded-md border text-xs font-medium transition-colors ${mode === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}>
                                            {m === AUTO_MODE.STEP_BY_STEP ? 'Step-by-Step' : 'Full Auto'}
                                        </button>
                                    ))}
                                </div>
                                <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Describe the full edit to perform autonomously…"
                                    className="w-full box-border px-3 py-2 rounded-md border border-border bg-background text-foreground text-xs resize-none h-16 outline-none font-sans focus:border-primary transition-colors mb-2" />
                                <button id="autonomous-start-btn" onClick={handleStart} disabled={!prompt.trim()}
                                    className="w-full py-2 rounded-md border-none bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                                    Start Autonomous Edit
                                </button>
                            </div>
                        )}

                        {/* Progress bar */}
                        {isRunning && total > 0 && (
                            <div className="px-4 pt-3">
                                <div className="flex justify-between text-[10px] text-muted-foreground mb-1.5">
                                    <span>Step {done}/{total}</span><span>{pct}%</span>
                                </div>
                                <div className="h-1 bg-secondary rounded-full overflow-hidden">
                                    <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                                </div>
                            </div>
                        )}

                        {/* Steps list */}
                        {steps.length > 0 && (
                            <div className="p-4 space-y-2">
                                {steps.map((step, i) => {
                                    const stClass = STEP_COLORS[step.state] || STEP_COLORS[STEP_STATE.PENDING];
                                    return (
                                        <div key={i} className={`flex items-start gap-2.5 p-2.5 rounded-lg border ${stClass}`}>
                                            <div className="mt-0.5">{STEP_ICONS[step.state]}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] font-semibold tracking-wide capitalize truncate">{step.action?.replace(/_/g,' ') || `Step ${i+1}`}</div>
                                                {step.error && <div className="text-[10px] text-red-400 mt-1 truncate">{step.error}</div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Approval card */}
                        {awaitingApproval && currentStep && (
                            <div className="mx-4 mb-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                                <p className="m-0 mb-1 text-[11px] font-bold text-orange-500 uppercase tracking-wider">Awaiting approval</p>
                                <p className="m-0 mb-3 text-xs text-foreground/80 capitalize">{currentStep.action?.replace(/_/g,' ') || 'Next step'}</p>
                                {editingStep ? (
                                    <div className="mb-3 space-y-2">
                                        <p className="m-0 text-[10px] text-muted-foreground">Editing parameters:</p>
                                        {Object.entries(editedParams).filter(([k]) => !['index','state','step_id','action','error','result'].includes(k)).map(([k,v]) => (
                                            <div key={k} className="flex gap-2 items-center">
                                                <label className="text-[10px] text-muted-foreground min-w-[60px] truncate">{k}</label>
                                                <input value={String(v)} onChange={e => setEditedParams(p => ({ ...p, [k]:e.target.value }))}
                                                    className="flex-1 px-2 py-1 rounded bg-background border border-border text-[10px] text-foreground outline-none focus:border-primary" />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <button onClick={() => openEditStep(currentStep)} className="w-full mb-2 py-1.5 rounded border border-border bg-transparent text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors flex justify-center items-center gap-1.5"><Pencil className="w-3 h-3" /> Edit Parameters</button>
                                )}
                                <div className="flex gap-2">
                                    <button onClick={handleSkip} className="flex-1 py-1.5 rounded border border-border bg-transparent hover:bg-secondary text-muted-foreground hover:text-foreground text-[10px] font-medium transition-colors flex justify-center items-center gap-1">Skip</button>
                                    <button onClick={handleContinue} className="flex-[2] py-1.5 rounded border-none bg-primary hover:bg-primary/90 text-primary-foreground text-[10px] font-medium transition-colors flex justify-center items-center gap-1"><Play className="w-3 h-3" /> Continue</button>
                                </div>
                            </div>
                        )}

                        {/* Abort button */}
                        {isRunning && (
                            <div className="px-4 pb-3">
                                <button onClick={handleAbort} className="w-full py-1.5 rounded-md border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition-colors flex justify-center items-center gap-1.5"><XCircle className="w-3.5 h-3.5" /> Abort Session</button>
                            </div>
                        )}

                        {/* Log */}
                        {logMessages.length > 0 && (
                            <div className="mx-4 mb-4 p-2.5 bg-black/20 rounded-lg max-h-[100px] overflow-y-auto space-y-1 border border-white/5">
                                {logMessages.map((l, i) => (
                                    <div key={i} className="text-[9px] text-muted-foreground flex gap-1.5">
                                        <span className="text-muted-foreground/40 shrink-0">{l.time}</span>
                                        <span className="truncate">{l.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

export default AutonomousEditingPanel;
