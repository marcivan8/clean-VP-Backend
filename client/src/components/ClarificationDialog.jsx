import React, { useState } from 'react';
import { useClarificationDialog } from '../hooks/useClarificationDialog';
import { HelpCircle, Check, X } from 'lucide-react';

export function ClarificationDialog() {
    const { isOpen, request, submit, cancel, isProcessing } = useClarificationDialog();
    const [answers, setAnswers] = useState({});

    if (!isOpen || !request) return null;

    const questions = request?.questions || [];

    const handleAnswer = (param, value) => {
        setAnswers(prev => ({ ...prev, [param]: value }));
    };

    const handleSubmit = () => {
        submit(answers);
        setAnswers({});
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center gap-3 bg-secondary/20">
                    <div className="bg-blue-500/20 p-2 rounded-full">
                        <HelpCircle className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-lg text-foreground">Clarification Needed</h3>
                        <p className="text-xs text-muted-foreground">The agent needs more details to proceed.</p>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                    {questions.length === 0 ? (
                        <p className="text-muted-foreground text-center italic">No questions needed.</p>
                    ) : (
                        questions.map((q, idx) => (
                            <div key={idx} className="space-y-3">
                                <p className="text-sm font-medium text-foreground">{q.question}</p>

                                {/* Render Input based on type */}
                                {q.type === 'option' || q.type === 'selection' ? (
                                    <div className="grid grid-cols-2 gap-2">
                                        {q.options.map((opt, i) => {
                                            const label = typeof opt === 'string' ? opt : opt.label;
                                            const value = typeof opt === 'string' ? opt : opt.value;
                                            const isSelected = answers[q.parameter] === value;

                                            return (
                                                <button
                                                    key={i}
                                                    onClick={() => handleAnswer(q.parameter, value)}
                                                    className={`px-3 py-2 text-xs rounded-md border transition-all text-left ${isSelected
                                                        ? 'bg-blue-500 text-white border-blue-600 shadow-sm ring-1 ring-blue-500'
                                                        : 'bg-secondary/50 border-border hover:bg-secondary hover:border-primary/30 text-muted-foreground hover:text-foreground'
                                                        }`}
                                                >
                                                    {label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <input
                                        type="text"
                                        value={answers[q.parameter] || ''}
                                        onChange={(e) => handleAnswer(q.parameter, e.target.value)}
                                        placeholder={q.placeholder || "Type your answer..."}
                                        className="w-full bg-secondary/50 border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground/50"
                                    />
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-secondary/10 flex justify-end gap-2">
                    <button
                        onClick={cancel}
                        disabled={isProcessing}
                        className="px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing || Object.keys(answers).length < questions.length}
                        className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-md flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20"
                    >
                        {isProcessing ? (
                            <>
                                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                Processing...
                            </>
                        ) : (
                            <>
                                Continue <Check className="w-3 h-3" />
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ClarificationDialog;
