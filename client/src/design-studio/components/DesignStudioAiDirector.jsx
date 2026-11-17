/**
 * client/src/design-studio/components/DesignStudioAiDirector.jsx
 *
 * Floating Collapsible AI Copilot Drawer (Directly inspired by Image 1):
 * - Clean light card styling with soft drop shadow
 * - Interactive conversation history of design edits
 * - Contextual quick action pills
 * - Multi-action natural language input bar
 * - Expand / Minimize floating toggle
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    Sparkles, ArrowUp, CheckCircle2, AlertCircle,
    ChevronDown, ChevronUp, Bot, CornerDownLeft, Plus
} from 'lucide-react';
import { executeDesignCommand } from '../../agent/DesignStudioCommandRegistry.js';

const QUICK_SUGGESTIONS = [
    'Make headline larger, push left',
    'Set corner radius to 24px',
    'Apply auto layout with 16px gap',
    'Union selected shapes',
    'Distribute spacing evenly',
    'Apply dark theme mode',
    'Review design for contrast',
];

export default function DesignStudioAiDirector({
    layers,
    setLayers,
    selectedLayerIds = [],
    setSelectedLayerIds,
    onDirectionApply,
}) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [promptText, setPromptText] = useState('');
    const [history, setHistory] = useState([
        {
            role: 'assistant',
            text: 'I can help you build, transform, and arrange vector layers, auto layout, and typography. Type a command or pick a suggestion.',
        },
    ]);
    const [statusMessage, setStatusMessage] = useState(null);

    const handleExecute = (customPrompt = null) => {
        const textToRun = (customPrompt || promptText).trim();
        if (!textToRun) return;

        // Add user prompt to history
        setHistory(prev => [...prev, { role: 'user', text: textToRun }]);

        const ctx = {
            layers,
            setLayers,
            selectedLayerIds,
            selectedLayerId: selectedLayerIds[0] || null,
            setSelectedLayerIds,
            applyDirection: onDirectionApply,
        };

        const result = executeDesignCommand(textToRun, ctx);

        // Add assistant response to history
        setHistory(prev => [
            ...prev,
            {
                role: 'assistant',
                text: result.message,
                success: result.success,
            },
        ]);

        if (result.success) {
            setStatusMessage({ type: 'success', text: result.message });
            setPromptText('');
        } else {
            setStatusMessage({ type: 'error', text: result.message });
        }

        setTimeout(() => setStatusMessage(null), 5000);
    };

    if (!isExpanded) {
        return (
            <div style={{
                position: 'absolute',
                bottom: '44px',
                right: '16px',
                zIndex: 60,
            }}>
                <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    style={{
                        padding: '8px 14px',
                        background: '#0B7C91',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: '999px',
                        boxShadow: '0 8px 24px rgba(11, 124, 145, 0.35)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: 700,
                        fontSize: '12.5px',
                        transition: 'transform 0.15s ease',
                    }}
                >
                    <Sparkles size={15} />
                    <span>AI Copilot</span>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                </button>
            </div>
        );
    }

    return (
        <div style={{
            position: 'absolute',
            bottom: '44px',
            right: '16px',
            width: '360px',
            maxWidth: 'calc(100% - 32px)',
            background: '#FFFFFF',
            border: '1px solid #E2E8F0',
            borderRadius: '16px',
            boxShadow: '0 16px 40px -8px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(15, 23, 42, 0.08)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
            zIndex: 60,
        }}>
            {/* Header (Image 1 Inspiration) */}
            <div style={{
                padding: '12px 16px',
                background: '#F8FAFC',
                borderBottom: '1px solid #F1F5F9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        background: '#F0F9FB',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#0B7C91',
                    }}>
                        <Sparkles size={14} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>
                            VIBED AI Copilot
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10B981' }} />
                        <span style={{ fontSize: '10px', color: '#64748B', fontWeight: 600 }}>Active</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsExpanded(false)}
                        title="Minimize"
                        style={{ background: 'transparent', border: 'none', color: '#94A3B8', cursor: 'pointer', padding: '2px' }}
                    >
                        <ChevronDown size={16} />
                    </button>
                </div>
            </div>

            {/* Message Stream */}
            <div style={{
                maxHeight: '140px',
                overflowY: 'auto',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '12px',
                background: '#FFFFFF',
            }}>
                {history.map((msg, i) => (
                    <div
                        key={i}
                        style={{
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            maxWidth: '90%',
                            padding: '8px 12px',
                            borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                            background: msg.role === 'user' ? '#0B7C91' : '#F1F5F9',
                            color: msg.role === 'user' ? '#FFFFFF' : '#1E293B',
                            lineHeight: 1.4,
                        }}
                    >
                        {msg.text}
                    </div>
                ))}
            </div>

            {/* Quick Prompt Suggestions */}
            <div style={{
                padding: '6px 14px',
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                background: '#FAFAFA',
                borderTop: '1px solid #F1F5F9',
            }}>
                {QUICK_SUGGESTIONS.map((sug, i) => (
                    <button
                        key={i}
                        type="button"
                        onClick={() => handleExecute(sug)}
                        style={{
                            padding: '4px 8px',
                            background: '#FFFFFF',
                            border: '1px solid #E2E8F0',
                            borderRadius: '999px',
                            fontSize: '11px',
                            color: '#64748B',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                        }}
                    >
                        {sug}
                    </button>
                ))}
            </div>

            {/* Input Bar (Image 1 Inspiration) */}
            <div style={{ padding: '10px 14px 12px', background: '#FFFFFF', borderTop: '1px solid #F1F5F9' }}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleExecute();
                    }}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: '#F8FAFC',
                        border: '1px solid #E2E8F0',
                        borderRadius: '10px',
                        padding: '4px 6px 4px 12px',
                    }}
                >
                    <input
                        type="text"
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        placeholder="Type / for quick access or describe changes..."
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: '12.5px',
                            color: '#0F172A',
                        }}
                    />
                    <button
                        type="submit"
                        style={{
                            padding: '6px 10px',
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
                        <ArrowUp size={14} />
                    </button>
                </form>
            </div>
        </div>
    );
}
