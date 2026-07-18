import React, { useState } from 'react';
import { useClarificationDialog } from '../hooks/useClarificationDialog';
import { HelpCircle, Check, Loader2 } from 'lucide-react';

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
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
            onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
        >
            <div
                className="relative w-full max-w-lg rounded-2xl overflow-hidden animate-in zoom-in-95 duration-200"
                style={{ background: 'var(--bg-2)', border: '0.5px solid var(--line-strong)' }}
            >
                {/* Top accent bar */}
                <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, var(--accent), var(--violet))' }} />

                {/* Header */}
                <div
                    className="p-4 flex items-center gap-3"
                    style={{ borderBottom: '0.5px solid var(--line-soft)', background: 'rgba(255,255,255,0.03)' }}
                >
                    <div
                        className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center"
                        style={{
                            background: 'color-mix(in oklch, var(--accent) 14%, transparent)',
                            border: '0.5px solid color-mix(in oklch, var(--accent) 28%, transparent)',
                        }}
                    >
                        <HelpCircle className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    </div>
                    <div>
                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 2 }}>
                            Clarification needed
                        </div>
                        <h3 style={{ fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 700, color: 'var(--fg)', margin: 0, lineHeight: 1.2 }}>
                            A few quick questions
                        </h3>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                    {questions.length === 0 ? (
                        <p style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg-3)', textAlign: 'center', fontStyle: 'italic' }}>
                            No questions needed.
                        </p>
                    ) : (
                        questions.map((q, idx) => (
                            <div key={idx} className="space-y-3">
                                <p style={{ fontFamily: 'var(--f-sans)', fontSize: 13, fontWeight: 500, color: 'var(--fg)', margin: 0 }}>
                                    {q.question}
                                </p>

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
                                                    className="px-3 py-2 text-left transition-all"
                                                    style={{
                                                        borderRadius: 8,
                                                        fontFamily: 'var(--f-sans)',
                                                        fontSize: 12,
                                                        fontWeight: isSelected ? 600 : 400,
                                                        background: isSelected
                                                            ? 'linear-gradient(135deg, var(--accent), var(--violet))'
                                                            : 'rgba(255,255,255,0.05)',
                                                        border: isSelected
                                                            ? 'none'
                                                            : '0.5px solid rgba(255,255,255,0.1)',
                                                        color: isSelected ? '#fff' : 'var(--fg-2)',
                                                        boxShadow: isSelected
                                                            ? '0 2px 12px color-mix(in oklch, var(--accent) 20%, transparent)'
                                                            : 'none',
                                                        cursor: 'pointer',
                                                    }}
                                                    onMouseEnter={e => {
                                                        if (!isSelected) {
                                                            e.currentTarget.style.background = 'rgba(255,255,255,0.09)';
                                                            e.currentTarget.style.color = 'var(--fg)';
                                                        }
                                                    }}
                                                    onMouseLeave={e => {
                                                        if (!isSelected) {
                                                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                                            e.currentTarget.style.color = 'var(--fg-2)';
                                                        }
                                                    }}
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
                                        placeholder={q.placeholder || 'Type your answer…'}
                                        className="w-full outline-none transition-all"
                                        style={{
                                            background: 'rgba(0,0,0,0.35)',
                                            border: '0.5px solid var(--line)',
                                            borderRadius: 8,
                                            padding: '10px 12px',
                                            fontFamily: 'var(--f-sans)',
                                            fontSize: 13,
                                            color: 'var(--fg)',
                                        }}
                                        onFocus={e => { e.currentTarget.style.border = '0.5px solid var(--accent)'; }}
                                        onBlur={e => { e.currentTarget.style.border = '0.5px solid var(--line)'; }}
                                    />
                                )}
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div
                    className="p-4 flex justify-end gap-2"
                    style={{ borderTop: '0.5px solid var(--line-soft)', background: 'rgba(255,255,255,0.02)' }}
                >
                    <button
                        onClick={cancel}
                        disabled={isProcessing}
                        className="px-4 py-2 transition-colors disabled:opacity-50"
                        style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-3)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6 }}
                        onMouseEnter={e => { e.currentTarget.style.color = 'var(--fg)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-3)'; }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isProcessing || Object.keys(answers).length < questions.length}
                        className="px-4 py-2 flex items-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            fontFamily: 'var(--f-sans)',
                            fontSize: 12,
                            fontWeight: 700,
                            background: 'linear-gradient(135deg, var(--accent), var(--violet))',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 8,
                            cursor: 'pointer',
                            boxShadow: '0 2px 12px color-mix(in oklch, var(--accent) 20%, transparent)',
                        }}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                Processing…
                            </>
                        ) : (
                            <>
                                <Check className="w-3 h-3" />
                                Continue
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ClarificationDialog;
