/**
 * client/src/design-studio/components/DesignStudioAiDirector.jsx
 *
 * Premium Glassmorphic AI Copilot Dock:
 * - Frosted blur with subtle cyan (#00E5FF) accent glow
 * - Conversation stream with smooth message bubbles
 * - Contextual quick-action recommendation pills
 * - Premium command input bar with animated submit button
 * - Seamless expand / minimize floating capsule
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    Sparkles, ArrowUp, CheckCircle2, AlertCircle,
    ChevronDown, ChevronUp, Bot, CornerDownLeft, Plus, Loader2
} from 'lucide-react';
import { executeDesignCommand } from '../../agent/DesignStudioCommandRegistry.js';
import { authFetch } from '../../utils/authFetch.js';

const QUICK_SUGGESTIONS = [
    'Remove the background',
    'Animate this design',
    'Make headline larger, push left',
    'Set corner radius to 24px',
    'Union selected shapes',
    'Distribute spacing evenly',
    'Review design for contrast',
];

export default function DesignStudioAiDirector({
    layers,
    setLayers,
    selectedLayerIds = [],
    setSelectedLayerIds,
    onDirectionApply,
    onRemoveBackground,
    onSaveAsMotionScene,
    setDirections,
    directions,
    selectedFormat,
    setSelectedFormat,
    setShowVariationsTray,
    setBriefText,
    showToast,
    pushUndo,
}) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [promptText, setPromptText] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [history, setHistory] = useState([
        {
            role: 'assistant',
            text: 'I can help you build, transform, and arrange vector layers, auto layout, and typography. Type a command or pick a suggestion.',
        },
    ]);
    const [statusMessage, setStatusMessage] = useState(null);

    const handleExecute = async (customPrompt = null) => {
        const textToRun = (customPrompt || promptText).trim();
        if (!textToRun || isExecuting) return;

        if (typeof pushUndo === 'function') {
            pushUndo();
        }

        // Add user prompt to history
        setHistory(prev => [...prev, { role: 'user', text: textToRun }]);
        setPromptText('');

        const ctx = {
            layers,
            setLayers,
            selectedLayerIds,
            selectedLayerId: selectedLayerIds[0] || null,
            setSelectedLayerIds,
            applyDirection: onDirectionApply,
            onRemoveBackground,
            handleSaveAsMotionScene: onSaveAsMotionScene,
            setDirections,
            directions,
            selectedFormat,
            setSelectedFormat,
            setShowVariationsTray,
            setBriefText,
            showToast,
        };

        // Tier 1: Fast local parser execution (0ms)
        const localResult = executeDesignCommand(textToRun, ctx);
        const hasUnrecognized = Array.isArray(localResult.results) && localResult.results.some(r => !r.success || /unrecognized/i.test(r.message || ''));

        if (localResult.success && !hasUnrecognized) {
            setHistory(prev => [
                ...prev,
                {
                    role: 'assistant',
                    text: localResult.message,
                    success: true,
                },
            ]);
            setStatusMessage({ type: 'success', text: localResult.message });
            setTimeout(() => setStatusMessage(null), 5000);
            return;
        }

        // Tier 2: AI / LLM Design Copilot Fallback (supports complex & creative instructions)
        setIsExecuting(true);
        setStatusMessage({ type: 'info', text: 'AI is designing...' });

        try {
            const res = await authFetch('/api/ai/design-copilot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: textToRun,
                    layers: Array.isArray(layers) ? layers : [],
                    selectedLayerId: selectedLayerIds[0] || null,
                    format: selectedFormat || { w: 1280, h: 720 },
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                const fallbackMsg = data?.error || localResult.message || 'Could not understand command.';
                setHistory(prev => [...prev, { role: 'assistant', text: fallbackMsg, success: false }]);
                setStatusMessage({ type: 'error', text: fallbackMsg });
                return;
            }

            // Apply operations returned by LLM
            if (Array.isArray(data.operations) && data.operations.length > 0 && typeof setLayers === 'function') {
                setLayers(prev => {
                    let updated = [...(Array.isArray(prev) ? prev : [])];
                    for (const op of data.operations) {
                        if (op.op === 'add_layer' && op.layer) {
                            const newId = op.layer.id || `layer_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
                            updated = [...updated, { ...op.layer, id: newId }];
                            if (typeof setSelectedLayerIds === 'function') {
                                setSelectedLayerIds([newId]);
                            }
                        } else if (op.op === 'update_layer' && (op.layerId || op.layer?.id)) {
                            const targetId = op.layerId || op.layer?.id;
                            const patch = op.patch || op.layer || {};
                            updated = updated.map(l => l.id === targetId ? { ...l, ...patch } : l);
                        } else if (op.op === 'delete_layer' && (op.layerId || op.layer?.id)) {
                            const targetId = op.layerId || op.layer?.id;
                            updated = updated.filter(l => l.id !== targetId);
                        }
                    }
                    return updated;
                });
            }

            const replyMessage = data.message || 'Updated canvas layout.';
            setHistory(prev => [...prev, { role: 'assistant', text: replyMessage, success: true }]);
            setStatusMessage({ type: 'success', text: replyMessage });
            if (typeof showToast === 'function') {
                showToast(replyMessage);
            }
        } catch (err) {
            console.error('[DesignStudioAiDirector] AI fallback error:', err.message);
            const fallbackMsg = localResult.message || 'Could not execute design instruction.';
            setHistory(prev => [...prev, { role: 'assistant', text: fallbackMsg, success: false }]);
            setStatusMessage({ type: 'error', text: fallbackMsg });
        } finally {
            setIsExecuting(false);
            setTimeout(() => setStatusMessage(null), 5000);
        }
    };

    if (!isExpanded) {
        return (
            <div style={{
                position: 'absolute',
                bottom: '44px',
                right: '20px',
                zIndex: 60,
            }}>
                <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    style={{
                        padding: '10px 18px',
                        background: 'rgba(15, 23, 42, 0.92)',
                        backdropFilter: 'blur(16px)',
                        color: '#FFFFFF',
                        border: '1px solid rgba(0, 229, 255, 0.4)',
                        borderRadius: '999px',
                        boxShadow: '0 10px 30px rgba(0, 229, 255, 0.25), 0 0 20px rgba(0, 229, 255, 0.15)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontWeight: 700,
                        fontSize: '12.5px',
                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                    }}
                >
                    <Sparkles size={15} color="#00E5FF" />
                    <span>AI Copilot</span>
                    <span style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#10B981',
                        display: 'inline-block',
                        boxShadow: '0 0 8px #10B981',
                    }} />
                </button>
            </div>
        );
    }

    return (
        <div style={{
            position: 'absolute',
            bottom: '44px',
            right: '20px',
            width: '380px',
            maxWidth: 'calc(100% - 40px)',
            background: 'rgba(255, 255, 255, 0.90)',
            backdropFilter: 'blur(24px) saturate(190%)',
            border: '1px solid rgba(0, 229, 255, 0.35)',
            borderRadius: '20px',
            boxShadow: '0 24px 50px -10px rgba(15, 23, 42, 0.25), 0 0 28px -4px rgba(0, 229, 255, 0.18)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            userSelect: 'none',
            zIndex: 60,
        }}>
            {/* Elevated Header */}
            <div style={{
                padding: '12px 16px',
                background: 'rgba(248, 250, 252, 0.85)',
                borderBottom: '1px solid rgba(226, 232, 240, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        width: '26px',
                        height: '26px',
                        borderRadius: '8px',
                        background: 'linear-gradient(135deg, #0B7C91 0%, #00E5FF 100%)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#FFFFFF',
                        boxShadow: '0 2px 8px rgba(0, 229, 255, 0.3)',
                    }}>
                        <Sparkles size={14} />
                    </div>
                    <div>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.01em' }}>
                            VIBED AI Copilot
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '3px 8px',
                        background: isExecuting ? 'rgba(0, 229, 255, 0.12)' : 'rgba(240, 249, 251, 0.9)',
                        borderRadius: '999px',
                        border: isExecuting ? '1px solid rgba(0, 229, 255, 0.4)' : '1px solid rgba(11, 124, 145, 0.2)',
                    }}>
                        <div style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: isExecuting ? '#00E5FF' : '#10B981',
                            boxShadow: isExecuting ? '0 0 8px #00E5FF' : '0 0 6px #10B981',
                        }} />
                        <span style={{ fontSize: '10px', color: isExecuting ? '#00B4D8' : '#0B7C91', fontWeight: 700, letterSpacing: '0.04em' }}>
                            {isExecuting ? 'THINKING' : 'READY'}
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setIsExpanded(false)}
                        title="Minimize"
                        style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                    >
                        <ChevronDown size={16} />
                    </button>
                </div>
            </div>

            {/* Message Stream */}
            <div style={{
                maxHeight: '160px',
                overflowY: 'auto',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '12px',
                background: 'transparent',
            }}>
                {history.map((msg, i) => (
                    <div
                        key={i}
                        style={{
                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                            maxWidth: '90%',
                            padding: '8px 12px',
                            borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                            background: msg.role === 'user' ? 'linear-gradient(135deg, #0B7C91 0%, #086374 100%)' : 'rgba(255, 255, 255, 0.95)',
                            color: msg.role === 'user' ? '#FFFFFF' : '#1E293B',
                            border: msg.role === 'user' ? 'none' : '1px solid #E2E8F0',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                            lineHeight: 1.45,
                        }}
                    >
                        {msg.text}
                    </div>
                ))}
            </div>

            {/* Quick Prompt Suggestions */}
            <div style={{
                padding: '8px 14px',
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                background: 'rgba(248, 250, 252, 0.7)',
                borderTop: '1px solid rgba(226, 232, 240, 0.6)',
            }}>
                {QUICK_SUGGESTIONS.map((sug, i) => (
                    <button
                        key={i}
                        type="button"
                        onClick={() => handleExecute(sug)}
                        style={{
                            padding: '4px 10px',
                            background: '#FFFFFF',
                            border: '1px solid rgba(11, 124, 145, 0.25)',
                            borderRadius: '999px',
                            fontSize: '11px',
                            fontWeight: 500,
                            color: '#0B7C91',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                            transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#00E5FF';
                            e.currentTarget.style.boxShadow = '0 0 8px rgba(0, 229, 255, 0.3)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'rgba(11, 124, 145, 0.25)';
                            e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.02)';
                        }}
                    >
                        {sug}
                    </button>
                ))}
            </div>

            {/* Premium Command Input Bar */}
            <div style={{ padding: '10px 14px 12px', background: 'rgba(255, 255, 255, 0.95)', borderTop: '1px solid rgba(226, 232, 240, 0.6)' }}>
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
                        borderRadius: '12px',
                        padding: '4px 6px 4px 12px',
                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)',
                    }}
                >
                    <input
                        type="text"
                        value={promptText}
                        onChange={(e) => setPromptText(e.target.value)}
                        placeholder="Ask AI or describe layout changes..."
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
                        disabled={isExecuting}
                        style={{
                            padding: '7px 12px',
                            background: isExecuting ? '#94A3B8' : 'linear-gradient(135deg, #0B7C91 0%, #00E5FF 100%)',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: isExecuting ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: isExecuting ? 'none' : '0 2px 8px rgba(0, 229, 255, 0.3)',
                            transition: 'all 0.2s ease',
                        }}
                    >
                        {isExecuting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowUp size={14} />}
                    </button>
                </form>
            </div>
        </div>
    );
}
