/**
 * client/src/components/BrollSuggestionCard.jsx
 *
 * Interactive Context-Aware B-Roll Suggestion Card (Level 2).
 *
 * Displays:
 *   - Dialogue quote and detected visual context
 *   - Target timestamp on the timeline with 1-click playhead seek
 *   - Video thumbnail, resolution, duration, photographer attribution
 *   - Alternatives selector (Option 1, 2, 3)
 *   - Creator Actions: Approve (+ Cutaway), Reject (Dismiss), Replace (Search)
 */

import React, { useState } from 'react';
import { Check, X, Search, Clock, Film, ExternalLink, Play } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore.js';

export function BrollSuggestionCard({
    suggestion,
    onApprove,
    onReject,
    onReplace,
}) {
    const {
        id,
        timelineTime = 0,
        duration = 3.5,
        reason = 'Visual context in dialogue',
        snippet = '',
        query = '',
        asset,
        alternatives = [],
    } = suggestion;

    // All available candidate assets (primary + alternatives)
    const candidates = [asset, ...alternatives].filter(Boolean);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const activeAsset = candidates[selectedIndex] || asset;

    const formatTime = (secs) => {
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    const handleSeek = () => {
        const store = useTimelineStore.getState();
        if (typeof store.setCurrentTime === 'function') {
            store.setCurrentTime(timelineTime);
        } else if (typeof store.seek === 'function') {
            store.seek(timelineTime);
        }
    };

    const handleApprove = () => {
        if (onApprove && activeAsset) {
            onApprove(suggestion, activeAsset);
        }
    };

    const handleReject = () => {
        if (onReject) {
            onReject(id);
        }
    };

    const handleReplace = () => {
        if (onReplace) {
            onReplace(suggestion);
        }
    };

    return (
        <div
            style={{
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                transition: 'border-color 0.15s ease',
            }}
        >
            {/* Header: Timestamp pill + Seek + Reason badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <button
                    type="button"
                    onClick={handleSeek}
                    title="Jump playhead to timestamp"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 6px',
                        borderRadius: 4,
                        background: 'rgba(0, 229, 255, 0.12)',
                        border: '1px solid rgba(0, 229, 255, 0.25)',
                        color: 'var(--accent)',
                        fontSize: 10,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'var(--f-mono)',
                    }}
                >
                    <Clock size={10} />
                    <span>{formatTime(timelineTime)} – {formatTime(timelineTime + duration)}</span>
                    <Play size={8} style={{ marginLeft: 2 }} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {suggestion.transitions?.inTransition?.type && (
                        <span
                            style={{
                                fontSize: 8.5,
                                padding: '1px 4px',
                                borderRadius: 3,
                                background: 'rgba(255, 255, 255, 0.06)',
                                color: 'var(--fg-3)',
                                textTransform: 'capitalize',
                            }}
                        >
                            {suggestion.transitions.inTransition.type.replace('_', ' ')}
                        </span>
                    )}
                    <div
                        style={{
                            fontSize: 9.5,
                            color: 'var(--fg-3)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {reason}
                    </div>
                </div>
            </div>

            {/* Spoken dialogue quote */}
            {snippet && (
                <div
                    style={{
                        fontSize: 10.5,
                        fontStyle: 'italic',
                        color: 'var(--fg-2)',
                        lineHeight: 1.35,
                        borderLeft: '2px solid rgba(0, 229, 255, 0.4)',
                        paddingLeft: 6,
                    }}
                >
                    {snippet}
                </div>
            )}

            {/* Asset preview & details */}
            {activeAsset && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div
                        style={{
                            width: 80,
                            height: 48,
                            borderRadius: 4,
                            overflow: 'hidden',
                            position: 'relative',
                            background: '#000',
                            flexShrink: 0,
                        }}
                    >
                        {activeAsset.thumbnail ? (
                            <img
                                src={activeAsset.thumbnail}
                                alt={activeAsset.name}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Film size={16} color="var(--fg-4)" />
                            </div>
                        )}
                        {activeAsset.duration > 0 && (
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: 2,
                                    right: 2,
                                    padding: '1px 3px',
                                    borderRadius: 2,
                                    background: 'rgba(0,0,0,0.7)',
                                    fontSize: 8.5,
                                    color: '#fff',
                                }}
                            >
                                {Math.round(activeAsset.duration)}s
                            </div>
                        )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div
                            style={{
                                fontSize: 11,
                                fontWeight: 500,
                                color: 'var(--fg)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                            title={activeAsset.name}
                        >
                            {activeAsset.name}
                        </div>

                        {/* Attribution */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--fg-3)' }}>
                            <span>by</span>
                            {activeAsset.attribution?.photographerUrl ? (
                                <a
                                    href={activeAsset.attribution.photographerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: 'var(--fg-2)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 2 }}
                                >
                                    <span style={{ textDecoration: 'underline' }}>{activeAsset.attribution.photographer}</span>
                                    <ExternalLink size={7} />
                                </a>
                            ) : (
                                <span>{activeAsset.attribution?.photographer || 'Pexels Creator'}</span>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Alternatives pill selector (if > 1 candidate available) */}
            {candidates.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 9, color: 'var(--fg-4)' }}>Pick:</span>
                    {candidates.map((cand, idx) => (
                        <button
                            key={cand.id || idx}
                            type="button"
                            onClick={() => setSelectedIndex(idx)}
                            style={{
                                padding: '2px 5px',
                                borderRadius: 3,
                                fontSize: 9,
                                border: 'none',
                                cursor: 'pointer',
                                background: selectedIndex === idx ? 'rgba(0, 229, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                color: selectedIndex === idx ? 'var(--accent)' : 'var(--fg-3)',
                                fontWeight: selectedIndex === idx ? 600 : 400,
                            }}
                        >
                            #{idx + 1}
                        </button>
                    ))}
                </div>
            )}

            {/* Action buttons: Approve / Reject / Replace */}
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                <button
                    type="button"
                    onClick={handleApprove}
                    style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        padding: '5px 8px',
                        borderRadius: 4,
                        background: '#05a081',
                        color: '#fff',
                        fontSize: 10.5,
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                    }}
                >
                    <Check size={11} />
                    <span>Approve Cutaway</span>
                </button>

                <button
                    type="button"
                    onClick={handleReplace}
                    title="Search alternative clips"
                    style={{
                        padding: '5px 8px',
                        borderRadius: 4,
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: 'var(--fg-2)',
                        fontSize: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        cursor: 'pointer',
                    }}
                >
                    <Search size={10} />
                    <span>Replace</span>
                </button>

                <button
                    type="button"
                    onClick={handleReject}
                    title="Dismiss this suggestion"
                    style={{
                        padding: '5px 7px',
                        borderRadius: 4,
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        color: 'var(--fg-3)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                    }}
                >
                    <X size={11} />
                </button>
            </div>
        </div>
    );
}

export default BrollSuggestionCard;
