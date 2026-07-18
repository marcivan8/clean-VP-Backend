/**
 * client/src/components/BrainPanel.jsx
 *
 * Editorial Brain suggestions panel.
 * Renders below the ReasoningPanel in the right AI sidebar.
 *
 * Props:
 *   brainOutput   — the latest BrainOutput object from useBrain
 *   isProcessing  — boolean, shows loading indicator
 *   onSendCommand — (text: string) => void, called when a suggestion chip is tapped
 *   onSendFeedback— (type: string, accepted: boolean) => void
 *
 * Design rules (Vibed design system):
 *   - Glassmorphic surface: rgba(255,255,255,0.04), border 0.5px rgba(255,255,255,0.09)
 *   - Accent: var(--accent) = #00E5FF  |  Violet: var(--violet) = #8A2BE2
 *   - Badge tint: color-mix(in oklch, var(--accent) 14%, transparent)
 *   - Typography: var(--f-mono) for labels/eyebrows, var(--f-sans) for body
 *   - Priority colors: critical=#f87171, high=var(--accent), medium=var(--violet), low=var(--fg-3)
 */

import React, { useState } from 'react';
import { Sparkles, AlertTriangle, Info, X, ChevronRight, Loader2, Lightbulb } from 'lucide-react';
import classNames from 'classnames';

// ── Priority color tokens ─────────────────────────────────────────────────────
const PRIORITY_COLORS = {
    critical: { bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.25)', text: '#f87171', glow: '#f87171' },
    high:     { bg: 'color-mix(in oklch, var(--accent) 10%, transparent)', border: 'color-mix(in oklch, var(--accent) 25%, transparent)', text: 'var(--accent)', glow: 'var(--accent)' },
    medium:   { bg: 'color-mix(in oklch, var(--violet) 10%, transparent)', border: 'color-mix(in oklch, var(--violet) 25%, transparent)', text: 'var(--violet)', glow: 'var(--violet)' },
    low:      { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)', text: 'var(--fg-3)', glow: 'transparent' },
};

function getPriority(suggestion) {
    return suggestion?.priority || 'low';
}

// ── SuggestionChip ────────────────────────────────────────────────────────────

const SuggestionChip = ({ suggestion, onAccept, onDismiss }) => {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const priority = getPriority(suggestion);
    const colors   = PRIORITY_COLORS[priority] || PRIORITY_COLORS.low;
    const label    = suggestion?.label || suggestion?.type || 'Suggestion';
    const reason   = suggestion?.reason || suggestion?.description || null;

    const handleAccept = () => {
        onAccept?.(suggestion);
        setDismissed(true);
    };

    const handleDismiss = (e) => {
        e.stopPropagation();
        onDismiss?.(suggestion);
        setDismissed(true);
    };

    return (
        <div
            className="group flex items-start gap-2 rounded-lg p-2.5 cursor-pointer transition-all duration-150"
            style={{
                background: colors.bg,
                border: `0.5px solid ${colors.border}`,
                marginBottom: 6,
            }}
            onClick={handleAccept}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.9'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
            {/* Priority dot */}
            <span
                className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: colors.text, boxShadow: priority !== 'low' ? `0 0 5px ${colors.glow}` : 'none' }}
            />

            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                    <span
                        style={{
                            fontFamily:    'var(--f-sans)',
                            fontSize:      12,
                            color:         'var(--fg)',
                            fontWeight:    500,
                            lineHeight:    1.35,
                        }}
                    >
                        {label}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                        <ChevronRight
                            className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity"
                            style={{ color: colors.text }}
                        />
                        <button
                            title="Dismiss"
                            onClick={handleDismiss}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10"
                            style={{ color: 'var(--fg-4)' }}
                        >
                            <X className="w-2.5 h-2.5" />
                        </button>
                    </div>
                </div>

                {reason && (
                    <p
                        className="mt-0.5"
                        style={{
                            fontFamily: 'var(--f-sans)',
                            fontSize:   11,
                            color:      'var(--fg-3)',
                            lineHeight: 1.45,
                        }}
                    >
                        {reason}
                    </p>
                )}
            </div>
        </div>
    );
};

// ── WarningBanner ─────────────────────────────────────────────────────────────

const WarningBanner = ({ warning }) => {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const severity = warning?.severity || 'medium';
    const isHigh   = severity === 'high' || severity === 'critical';

    return (
        <div
            className="flex items-start gap-2 rounded-lg p-2.5 mb-2"
            style={{
                background: isHigh ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.05)',
                border:     `0.5px solid ${isHigh ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.10)'}`,
            }}
        >
            <AlertTriangle
                className="w-3 h-3 shrink-0 mt-0.5"
                style={{ color: isHigh ? '#fbbf24' : 'var(--fg-3)' }}
            />
            <p style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.45, flex: 1 }}>
                {warning?.message || warning?.text || String(warning)}
            </p>
            <button
                onClick={() => setDismissed(true)}
                className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
                style={{ color: 'var(--fg-4)' }}
            >
                <X className="w-2.5 h-2.5" />
            </button>
        </div>
    );
};

// ── InsightCard ───────────────────────────────────────────────────────────────

const InsightCard = ({ insight }) => {
    if (!insight) return null;

    const text    = typeof insight === 'string' ? insight : (insight?.text || insight?.message || null);
    const metric  = typeof insight === 'object' ? insight?.metric : null;

    if (!text) return null;

    return (
        <div
            className="rounded-lg p-2.5 mb-2 flex items-start gap-2"
            style={{
                background: 'color-mix(in oklch, var(--violet) 8%, transparent)',
                border:     '0.5px solid color-mix(in oklch, var(--violet) 20%, transparent)',
            }}
        >
            <Lightbulb className="w-3 h-3 shrink-0 mt-0.5" style={{ color: 'var(--violet)' }} />
            <div style={{ flex: 1 }}>
                {metric && (
                    <div
                        style={{
                            fontFamily:    'var(--f-mono)',
                            fontSize:      9,
                            color:         'var(--violet)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                            marginBottom:  3,
                        }}
                    >
                        {metric}
                    </div>
                )}
                <p style={{ fontFamily: 'var(--f-sans)', fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.45 }}>
                    {text}
                </p>
            </div>
        </div>
    );
};

// ── BrainResponseMessage ──────────────────────────────────────────────────────

const BrainResponseMessage = ({ message }) => {
    if (!message) return null;
    return (
        <div
            className="rounded-lg mb-3"
            style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '0.5px solid rgba(255,255,255,0.09)',
            }}
        >
            {/* Eyebrow */}
            <div
                className="flex items-center gap-1.5 px-3 py-2"
                style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}
            >
                <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                <span style={{
                    fontFamily:    'var(--f-mono)',
                    fontSize:      9,
                    color:         'var(--accent)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.12em',
                }}>
                    Brain
                </span>
            </div>
            {/* Body */}
            <p
                className="whitespace-pre-wrap"
                style={{
                    fontFamily: 'var(--f-sans)',
                    fontSize:   12,
                    color:      'var(--fg-2)',
                    lineHeight: 1.6,
                    padding:    '10px 12px 12px',
                    margin:     0,
                }}
            >
                {message}
            </p>
        </div>
    );
};

// ── BrainPanel (main export) ──────────────────────────────────────────────────

/**
 * @param {{
 *   brainOutput:    import('../hooks/useBrain').BrainOutput | null,
 *   isProcessing:   boolean,
 *   onSendCommand:  (text: string) => void,
 *   onSendFeedback: (type: string, accepted: boolean) => void,
 * }} props
 */
const BrainPanel = ({ brainOutput, isProcessing, onSendCommand, onSendFeedback }) => {
    const response    = brainOutput?.response || null;
    const message     = response?.message     || null;
    const suggestions = response?.suggestions || [];
    const warnings    = response?.warnings    || [];
    const insight     = response?.insight     || null;

    const hasContent = !!(message || suggestions.length || warnings.length || insight);

    // Nothing to show (and not loading) — render nothing to avoid empty chrome
    if (!hasContent && !isProcessing) return null;

    const handleAccept = (suggestion) => {
        const commandText = suggestion?.command || suggestion?.label || suggestion?.type;
        if (commandText) {
            onSendCommand?.(commandText);
        }
        onSendFeedback?.(suggestion?.type, true);
    };

    const handleDismiss = (suggestion) => {
        onSendFeedback?.(suggestion?.type, false);
    };

    return (
        <div
            style={{
                borderTop: '0.5px solid rgba(255,255,255,0.07)',
                padding:   '10px 12px 12px',
            }}
        >
            {/* Section header */}
            <div
                className="flex items-center gap-1.5 mb-3"
                style={{
                    // Top accent bar — brain identity marker
                    paddingTop: 8,
                }}
            >
                <div
                    style={{
                        height:     '1px',
                        width:      20,
                        background: 'linear-gradient(90deg, var(--accent), var(--violet))',
                        borderRadius: 2,
                        flexShrink: 0,
                    }}
                />
                <span
                    style={{
                        fontFamily:    'var(--f-mono)',
                        fontSize:      9,
                        color:         'var(--fg-3)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.10em',
                    }}
                >
                    Editorial Brain
                </span>

                {isProcessing && (
                    <Loader2
                        className="w-2.5 h-2.5 ml-auto animate-spin"
                        style={{ color: 'var(--accent)' }}
                    />
                )}
            </div>

            {/* Warnings — always first (most urgent) */}
            {warnings.map((w, i) => (
                <WarningBanner key={i} warning={w} />
            ))}

            {/* Brain response message */}
            <BrainResponseMessage message={message} />

            {/* Insight */}
            <InsightCard insight={insight} />

            {/* Suggestion chips */}
            {suggestions.length > 0 && (
                <div>
                    <div
                        style={{
                            fontFamily:    'var(--f-mono)',
                            fontSize:      9,
                            color:         'var(--fg-4)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.09em',
                            marginBottom:  6,
                        }}
                    >
                        Next steps
                    </div>
                    {suggestions.map((s, i) => (
                        <SuggestionChip
                            key={s?.type || i}
                            suggestion={s}
                            onAccept={handleAccept}
                            onDismiss={handleDismiss}
                        />
                    ))}
                </div>
            )}

            {/* Loading placeholder */}
            {isProcessing && !hasContent && (
                <div
                    className="rounded-lg p-3 flex items-center gap-2"
                    style={{
                        background: 'rgba(255,255,255,0.03)',
                        border:     '0.5px solid rgba(255,255,255,0.07)',
                    }}
                >
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 12, color: 'var(--fg-3)' }}>
                        Analysing your project…
                    </span>
                </div>
            )}
        </div>
    );
};

export default BrainPanel;
