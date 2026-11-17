/**
 * client/src/design-studio/components/DesignStudioAiDirector.jsx
 *
 * Conversational AI Layer Director ("Or just say it")
 * Bridges natural language commands to the Figma-class vector canvas,
 * with quick suggestion chips, instant execution, and feedback status.
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import { Sparkles, ArrowUp, Send, AlertCircle, CheckCircle2 } from 'lucide-react';
import { executeDesignCommand } from '../../agent/DesignStudioCommandRegistry.js';

const QUICK_SUGGESTIONS = [
    'Make the headline larger, push left',
    'Set corner radius to 24px',
    'Apply auto layout with 16px gap',
    'Union selected shapes',
    'Distribute spacing evenly',
    'Apply dark theme mode',
    'Review design for contrast and legibility',
];

export default function DesignStudioAiDirector({
    layers,
    setLayers,
    selectedLayerIds = [],
    setSelectedLayerIds,
    onDirectionApply,
}) {
    const [promptText, setPromptText] = useState('');
    const [statusMessage, setStatusMessage] = useState(null); // { type: 'success'|'error', text: string }

    const handleExecute = (customPrompt = null) => {
        const textToRun = (customPrompt || promptText).trim();
        if (!textToRun) return;

        const ctx = {
            layers,
            setLayers,
            selectedLayerIds,
            selectedLayerId: selectedLayerIds[0] || null,
            setSelectedLayerIds,
            applyDirection: onDirectionApply,
        };

        const result = executeDesignCommand(textToRun, ctx);

        if (result.success) {
            setStatusMessage({ type: 'success', text: result.message });
            setPromptText('');
        } else {
            setStatusMessage({ type: 'error', text: result.message });
        }

        setTimeout(() => {
            setStatusMessage(null);
        }, 6000);
    };

    return (
        <div style={{
            background: '#161920',
            border: '1px solid #2A2E39',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            userSelect: 'none',
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Sparkles size={16} style={{ color: '#00E5FF' }} />
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '0.2px' }}>
                        Or just say it
                    </span>
                </div>
                <span style={{ fontSize: '11px', color: '#6B7280' }}>
                    Natural language canvas control
                </span>
            </div>

            {/* Prompt Input Form */}
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    handleExecute();
                }}
                style={{ position: 'relative', display: 'flex', alignItems: 'center' }}
            >
                <input
                    type="text"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder="e.g. Make headline larger, add 4px cyan stroke, distribute spacing"
                    style={{
                        width: '100%',
                        padding: '12px 48px 12px 14px',
                        background: '#1E222B',
                        border: '1px solid #2A2E39',
                        borderRadius: '8px',
                        color: '#FFFFFF',
                        fontSize: '13px',
                        outline: 'none',
                    }}
                />
                <button
                    type="submit"
                    title="Execute design command"
                    style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        padding: '6px',
                        background: '#0B7C91',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <ArrowUp size={16} />
                </button>
            </form>

            {/* Feedback Message */}
            {statusMessage && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    background: statusMessage.type === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(11, 124, 145, 0.15)',
                    color: statusMessage.type === 'error' ? '#F87171' : '#00E5FF',
                    border: `1px solid ${statusMessage.type === 'error' ? '#DC2626' : '#0B7C91'}`,
                }}>
                    {statusMessage.type === 'error' ? <AlertCircle size={13} /> : <CheckCircle2 size={13} />}
                    <span>{statusMessage.text}</span>
                </div>
            )}

            {/* Quick Suggestion Chips */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {QUICK_SUGGESTIONS.map((sug, idx) => (
                    <button
                        key={idx}
                        type="button"
                        onClick={() => handleExecute(sug)}
                        style={{
                            padding: '4px 8px',
                            background: '#1E222B',
                            border: '1px solid #2A2E39',
                            borderRadius: '12px',
                            color: '#9CA3AF',
                            fontSize: '11px',
                            cursor: 'pointer',
                        }}
                    >
                        {sug}
                    </button>
                ))}
            </div>

            <div style={{ fontSize: '11px', color: '#6B7280' }}>
                Every AI change lands as ordinary vector layers you can drag, retype, transform, or undo.
            </div>
        </div>
    );
}
