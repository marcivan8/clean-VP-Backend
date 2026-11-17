/**
 * client/src/components/Marketplace/MarketplaceThread.jsx
 *
 * Board 09: Negotiation Thread & Structured Cards
 * Real-time client-talent collaboration:
 * - Thread list with unread markers
 * - Structured scope change cards with live escrow updates
 * - Document release cards
 * - Suggested quick-reply chips
 * - Direct Call Sheet and Asset Room links
 * - Safety notice and file attachments
 *
 * Strictly zero emojis. Plus Jakarta Sans typography.
 */

import React, { useState } from 'react';
import {
    Send, Plus, FileText, CheckCircle2, AlertCircle,
    ShieldCheck, ArrowRight, Download, Paperclip, ChevronRight
} from 'lucide-react';
import useMarketplaceStore from '../../store/useMarketplaceStore.js';

export default function MarketplaceThread() {
    const {
        threads,
        activeThreadId,
        setActiveThreadId,
        acceptScopeChange,
        declineScopeChange,
        sendMessage,
        setActiveTab,
    } = useMarketplaceStore();

    const activeThread = threads.find(t => t.id === activeThreadId) || threads[0];
    const [inputText, setInputText] = useState('');

    const handleSend = (e) => {
        e?.preventDefault();
        if (inputText.trim()) {
            sendMessage(inputText);
            setInputText('');
        }
    };

    const handleSuggestedClick = (text) => {
        setInputText(text);
    };

    return (
        <div style={{ padding: '24px 0 64px 0', maxWidth: 1240, margin: '0 auto' }}>
            {/* Top Eyebrow */}
            <div style={{ marginBottom: 20 }}>
                <span style={{
                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'rgba(26, 28, 34, 0.5)',
                }}>
                    09 · THREAD
                </span>
                <h1 style={{
                    margin: '4px 0 0 0',
                    fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                    fontSize: 30,
                    fontWeight: 800,
                    letterSpacing: '-0.025em',
                    color: '#1A1C22',
                }}>
                    Messages & Negotiation
                </h1>
            </div>

            {/* 3-Column Layout: Threads (240px) | Stream (1fr) | Context (280px) */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '240px 1fr 280px',
                gap: 20,
                alignItems: 'start',
            }}>
                {/* 1. Threads Rail */}
                <div style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    borderRadius: 16,
                    padding: 16,
                    boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 14,
                        padding: '0 4px',
                    }}>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                        }}>
                            THREADS
                        </span>
                        <span style={{
                            background: 'rgba(11, 124, 145, 0.12)',
                            color: '#0B7C91',
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 999,
                        }}>
                            3 new
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {threads.map(th => {
                            const isSel = th.id === activeThread.id;
                            return (
                                <div
                                    key={th.id}
                                    onClick={() => setActiveThreadId(th.id)}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 10,
                                        padding: '10px 12px',
                                        borderRadius: 12,
                                        background: isSel ? '#FAF9F6' : '#FFFFFF',
                                        border: isSel ? '1px solid rgba(11, 124, 145, 0.3)' : '1px solid transparent',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    <div style={{
                                        width: 32,
                                        height: 32,
                                        borderRadius: '50%',
                                        background: th.avatarBg,
                                        color: '#FFFFFF',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0,
                                    }}>
                                        {th.avatar}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                            <span style={{
                                                fontSize: 13,
                                                fontWeight: isSel ? 700 : 600,
                                                color: '#1A1C22',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}>
                                                {th.talentName}
                                            </span>
                                            <span style={{ fontSize: 10.5, color: 'rgba(26, 28, 34, 0.45)' }}>
                                                {th.time}
                                            </span>
                                        </div>
                                        <div style={{
                                            fontSize: 11.5,
                                            color: 'rgba(26, 28, 34, 0.55)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            marginTop: 2,
                                        }}>
                                            {th.talentSubtitle}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 2. Active Message Stream */}
                <div style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    borderRadius: 16,
                    overflow: 'hidden',
                    boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 640,
                }}>
                    {/* Stream Header */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        borderBottom: '1px solid rgba(26, 28, 34, 0.08)',
                        background: '#FAF9F6',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div style={{
                                width: 36,
                                height: 36,
                                borderRadius: '50%',
                                background: activeThread.avatarBg,
                                color: '#FFFFFF',
                                fontSize: 12,
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                {activeThread.avatar}
                            </div>
                            <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1C22' }}>
                                    {activeThread.talentName}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'rgba(26, 28, 34, 0.55)' }}>
                                    {activeThread.bookingTitle}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{
                                background: 'rgba(11, 124, 145, 0.10)',
                                color: '#0B7C91',
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 11.5,
                                fontWeight: 700,
                                padding: '4px 10px',
                                borderRadius: 999,
                            }}>
                                {activeThread.heldAmount}
                            </span>
                            <button
                                onClick={() => setActiveTab('callsheet')}
                                style={{
                                    background: '#FFFFFF',
                                    border: '1px solid rgba(26, 28, 34, 0.14)',
                                    borderRadius: 6,
                                    padding: '6px 12px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#1A1C22',
                                    cursor: 'pointer',
                                }}
                            >
                                Call sheet
                            </button>
                        </div>
                    </div>

                    {/* Booking Status Timeline Beat */}
                    <div style={{
                        textAlign: 'center',
                        padding: '14px 0',
                        borderBottom: '1px solid rgba(26, 28, 34, 0.04)',
                    }}>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.45)',
                        }}>
                            BOOKING ACCEPTED · FUNDS HELD · 06 NOV
                        </span>
                    </div>

                    {/* Messages Body */}
                    <div style={{
                        flex: 1,
                        padding: '20px 24px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 18,
                        overflowY: 'auto',
                    }}>
                        {activeThread.messages.map(msg => {
                            if (msg.type === 'scope_card') {
                                return (
                                    <div
                                        key={msg.id}
                                        style={{
                                            border: '1px solid rgba(180, 83, 9, 0.25)',
                                            borderRadius: 14,
                                            padding: 18,
                                            background: '#FAF9F6',
                                            maxWidth: 520,
                                        }}
                                    >
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            marginBottom: 6,
                                        }}>
                                            <span style={{
                                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                fontSize: 10,
                                                letterSpacing: '0.12em',
                                                textTransform: 'uppercase',
                                                color: '#B45309',
                                                fontWeight: 700,
                                            }}>
                                                SCOPE CHANGE · AWAITING YOU
                                            </span>
                                            <span style={{
                                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                                fontSize: 18,
                                                fontWeight: 800,
                                                color: '#1A1C22',
                                            }}>
                                                +€{msg.amountDelta}
                                            </span>
                                        </div>

                                        <div style={{
                                            fontFamily: 'var(--f-sans, "Plus Jakarta Sans", sans-serif)',
                                            fontSize: 14,
                                            fontWeight: 700,
                                            color: '#1A1C22',
                                            marginBottom: 4,
                                        }}>
                                            {msg.title}
                                        </div>
                                        <p style={{ margin: '0 0 14px 0', fontSize: 12.5, color: 'rgba(26, 28, 34, 0.7)', lineHeight: 1.45 }}>
                                            {msg.description}
                                        </p>

                                        {msg.status === 'accepted' ? (
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                color: '#059669',
                                                fontSize: 12.5,
                                                fontWeight: 600,
                                            }}>
                                                <CheckCircle2 size={16} />
                                                Accepted · Escrow updated to €{msg.totalAmount.toFixed(2)}
                                            </div>
                                        ) : msg.status === 'declined' ? (
                                            <div style={{ fontSize: 12.5, color: '#DC2626', fontWeight: 600 }}>
                                                Declined · Scope unchanged
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', gap: 10 }}>
                                                <button
                                                    onClick={() => acceptScopeChange(msg.id)}
                                                    style={{
                                                        background: '#0B7C91',
                                                        color: '#FFFFFF',
                                                        border: 'none',
                                                        borderRadius: 6,
                                                        padding: '8px 16px',
                                                        fontSize: 12.5,
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Accept and top up escrow
                                                </button>
                                                <button
                                                    onClick={() => setInputText('Can we adjust the scope to 30 min instead?')}
                                                    style={{
                                                        background: '#FFFFFF',
                                                        color: '#1A1C22',
                                                        border: '1px solid rgba(26, 28, 34, 0.16)',
                                                        borderRadius: 6,
                                                        padding: '8px 14px',
                                                        fontSize: 12.5,
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Counter
                                                </button>
                                                <button
                                                    onClick={() => declineScopeChange(msg.id)}
                                                    style={{
                                                        background: 'none',
                                                        color: 'rgba(26, 28, 34, 0.55)',
                                                        border: 'none',
                                                        fontSize: 12.5,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    Decline
                                                </button>
                                            </div>
                                        )}

                                        <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(26, 28, 34, 0.45)' }}>
                                            {msg.expires}
                                        </div>
                                    </div>
                                );
                            }

                            if (msg.type === 'doc_card') {
                                return (
                                    <div
                                        key={msg.id}
                                        style={{
                                            border: '1px solid rgba(26, 28, 34, 0.08)',
                                            borderRadius: 12,
                                            padding: '12px 16px',
                                            background: '#FFFFFF',
                                            maxWidth: 460,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 12,
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <div style={{
                                                width: 36,
                                                height: 36,
                                                borderRadius: 8,
                                                background: '#FAF9F6',
                                                border: '1px solid rgba(26, 28, 34, 0.08)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#0B7C91',
                                            }}>
                                                <FileText size={18} />
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1C22' }}>
                                                    {msg.name}
                                                </div>
                                                <div style={{ fontSize: 11.5, color: 'rgba(26, 28, 34, 0.55)' }}>
                                                    {msg.description}
                                                </div>
                                            </div>
                                        </div>

                                        <span style={{
                                            border: '1px solid #059669',
                                            color: '#059669',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            padding: '2px 8px',
                                            borderRadius: 999,
                                        }}>
                                            {msg.status}
                                        </span>
                                    </div>
                                );
                            }

                            return (
                                <div
                                    key={msg.id}
                                    style={{
                                        alignSelf: msg.isUser ? 'flex-end' : 'flex-start',
                                        maxWidth: 500,
                                    }}
                                >
                                    <div style={{
                                        background: msg.isUser ? '#0B7C91' : '#FAF9F6',
                                        color: msg.isUser ? '#FFFFFF' : '#1A1C22',
                                        borderRadius: 14,
                                        padding: '12px 16px',
                                        fontSize: 13,
                                        lineHeight: 1.5,
                                        border: msg.isUser ? 'none' : '1px solid rgba(26, 28, 34, 0.06)',
                                    }}>
                                        {msg.text}
                                    </div>
                                    <div style={{
                                        fontSize: 10.5,
                                        color: 'rgba(26, 28, 34, 0.45)',
                                        marginTop: 4,
                                        textAlign: msg.isUser ? 'right' : 'left',
                                        padding: '0 4px',
                                    }}>
                                        {msg.time} {msg.isUser && '· read'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Bottom Evidence Notice */}
                    <div style={{
                        textAlign: 'center',
                        padding: '8px 0',
                        borderTop: '1px solid rgba(26, 28, 34, 0.04)',
                        background: '#FAF9F6',
                    }}>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 9.5,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.4)',
                        }}>
                            EVERY QUOTE, CHANGE AND FILE IN THIS THREAD IS EVIDENCE IF SOMETHING GOES WRONG
                        </span>
                    </div>

                    {/* Suggested Replies Chips */}
                    {activeThread.suggestedReplies && (
                        <div style={{
                            padding: '10px 20px',
                            display: 'flex',
                            gap: 8,
                            flexWrap: 'wrap',
                            background: '#FFFFFF',
                            borderTop: '1px solid rgba(26, 28, 34, 0.06)',
                        }}>
                            {activeThread.suggestedReplies.map((reply, rIdx) => (
                                <button
                                    key={rIdx}
                                    onClick={() => handleSuggestedClick(reply)}
                                    style={{
                                        background: '#FAF9F6',
                                        border: '1px solid rgba(26, 28, 34, 0.12)',
                                        borderRadius: 999,
                                        padding: '5px 12px',
                                        fontSize: 12,
                                        color: '#1A1C22',
                                        cursor: 'pointer',
                                    }}
                                >
                                    "{reply}"
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Message Input Box */}
                    <form
                        onSubmit={handleSend}
                        style={{
                            padding: '14px 20px',
                            borderTop: '1px solid rgba(26, 28, 34, 0.08)',
                            background: '#FFFFFF',
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            background: '#FAF9F6',
                            border: '1px solid rgba(26, 28, 34, 0.12)',
                            borderRadius: 10,
                            padding: '4px 8px 4px 14px',
                        }}>
                            <input
                                type="text"
                                value={inputText}
                                onChange={e => setInputText(e.target.value)}
                                placeholder="Write a message or change proposal..."
                                style={{
                                    flex: 1,
                                    border: 'none',
                                    background: 'none',
                                    outline: 'none',
                                    fontSize: 13,
                                    color: '#1A1C22',
                                }}
                            />

                            <button
                                type="button"
                                onClick={() => setInputText('Send updated quote: ')}
                                style={{
                                    background: '#FFFFFF',
                                    border: '1px solid rgba(26, 28, 34, 0.14)',
                                    borderRadius: 6,
                                    padding: '6px 10px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#1A1C22',
                                    cursor: 'pointer',
                                }}
                            >
                                Send a quote
                            </button>

                            <button
                                type="submit"
                                style={{
                                    background: '#0B7C91',
                                    border: 'none',
                                    borderRadius: 6,
                                    padding: '6px 14px',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: '#FFFFFF',
                                    cursor: 'pointer',
                                }}
                            >
                                Send
                            </button>
                        </div>

                        <div style={{ marginTop: 8, fontSize: 10.5, color: 'rgba(26, 28, 34, 0.45)' }}>
                            Drafts are suggested from the thread and never sent on their own. Phone numbers and off-platform payment links are flagged.
                        </div>
                    </form>
                </div>

                {/* 3. Context & Files Sidebar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* THIS BOOKING summary card */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 18,
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                            marginBottom: 14,
                        }}>
                            THIS BOOKING
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.55)' }}>Date</span>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>{activeThread.bookingDate}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.55)' }}>Where</span>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>{activeThread.location}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.55)' }}>Held</span>
                                <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontWeight: 700, color: '#0B7C91' }}>
                                    {activeThread.heldAmount}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.55)' }}>Deliverables</span>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>{activeThread.deliverables}</span>
                            </div>
                        </div>
                    </div>

                    {/* FILES IN THIS THREAD */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 18,
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                            marginBottom: 12,
                        }}>
                            FILES IN THIS THREAD
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {activeThread.files.map((file, fIdx) => (
                                <div
                                    key={fIdx}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        fontSize: 12,
                                        padding: '4px 0',
                                    }}
                                >
                                    <span style={{ color: '#1A1C22' }}>{file.name}</span>
                                    <span style={{
                                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                        fontSize: 10,
                                        color: 'rgba(26, 28, 34, 0.45)',
                                    }}>
                                        {file.type}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* SAFETY CARD */}
                    <div style={{
                        background: '#FAF9F6',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 18,
                    }}>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: '#B45309',
                            marginBottom: 8,
                        }}>
                            SAFETY
                        </div>

                        <p style={{ margin: '0 0 14px 0', fontSize: 11.5, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.45 }}>
                            Keep it here. A booking taken off-platform has no escrow, no release form, no proof of work and no recourse.
                        </p>

                        <button
                            onClick={() => alert('Conversation flagged to VIBED Trust & Safety desk.')}
                            style={{
                                width: '100%',
                                background: '#FFFFFF',
                                border: '1px solid rgba(26, 28, 34, 0.16)',
                                borderRadius: 8,
                                padding: '7px 0',
                                fontSize: 12,
                                fontWeight: 600,
                                color: '#1A1C22',
                                cursor: 'pointer',
                            }}
                        >
                            Report this conversation
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
