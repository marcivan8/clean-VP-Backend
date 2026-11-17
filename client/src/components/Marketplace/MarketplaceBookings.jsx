/**
 * client/src/components/Marketplace/MarketplaceBookings.jsx
 *
 * Board 08: Bookings Dashboard
 * Complete operational overview for buyers and studios:
 * - Metrics header (Needs you, Held in escrow, Next shoot, Rushes waiting)
 * - Status filter tabs
 * - Actionable bookings table
 * - "Do these first" task queue
 * - "Rushes in the editor" direct VIBED project bridge
 * - Monthly spend chart
 *
 * Strictly zero emojis. Plus Jakarta Sans typography.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Clock, Calendar, ShieldCheck, CheckCircle2, AlertCircle,
    ArrowRight, Check, X, FileText, Film, ChevronRight, TrendingUp
} from 'lucide-react';
import useMarketplaceStore from '../../store/useMarketplaceStore.js';

export default function MarketplaceBookings() {
    const navigate = useNavigate();
    const {
        bookings,
        metrics,
        actionQueue,
        setActiveTab,
        setSelectedBookingId,
        acceptQuote,
        ingestRushesToVibed,
    } = useMarketplaceStore();

    const [filterTab, setFilterTab] = useState('all'); // 'all' | 'needs_you' | 'upcoming' | 'in_prod' | 'closed'
    const [ingestNotice, setIngestNotice] = useState(false);

    // Filter bookings based on selected status tab
    const filteredBookings = bookings.filter(b => {
        if (filterTab === 'all') return true;
        if (filterTab === 'needs_you') return b.status === 'Quote sent' || b.status === 'Your review';
        if (filterTab === 'upcoming') return b.status === 'Confirmed';
        if (filterTab === 'in_prod') return b.status === 'In production' || b.status === 'Your review';
        if (filterTab === 'closed') return b.status === 'Released' || b.status === 'Partial refund';
        return true;
    });

    const handleNextAction = (booking) => {
        setSelectedBookingId(booking.id);
        if (booking.nextAction === 'callsheet') {
            setActiveTab('callsheet');
        } else if (booking.nextAction === 'review_quote') {
            setActiveTab('messages');
        } else if (booking.nextAction === 'open_room') {
            setActiveTab('assetroom');
        } else {
            setActiveTab('callsheet');
        }
    };

    const handleOpenInEditor = () => {
        ingestRushesToVibed();
        setIngestNotice(true);
        setTimeout(() => setIngestNotice(false), 4000);
    };

    return (
        <div style={{ padding: '24px 0 64px 0', maxWidth: 1240, margin: '0 auto' }}>
            {/* Notification Toast for VIBED Ingest */}
            {ingestNotice && (
                <div style={{
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    zIndex: 9999,
                    background: '#1A1C22',
                    color: '#FFFFFF',
                    borderRadius: 12,
                    padding: '14px 20px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.25)',
                    border: '1px solid rgba(0, 229, 255, 0.3)',
                }}>
                    <CheckCircle2 size={18} color="#00E5FF" />
                    <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Rushes Linked to VIBED Project</div>
                        <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.7)' }}>
                            142 video files ready in timeline overlay track
                        </div>
                    </div>
                </div>
            )}

            {/* Top Header */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 28,
            }}>
                <div>
                    <span style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 11,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(26, 28, 34, 0.5)',
                    }}>
                        08 · DASHBOARD
                    </span>
                    <h1 style={{
                        margin: '4px 0 0 0',
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 32,
                        fontWeight: 800,
                        letterSpacing: '-0.025em',
                        color: '#1A1C22',
                    }}>
                        Bookings
                    </h1>
                </div>

                <button
                    onClick={() => setActiveTab('discover')}
                    style={{
                        background: '#0B7C91',
                        color: '#FFFFFF',
                        border: 'none',
                        borderRadius: 999,
                        padding: '10px 22px',
                        fontSize: 13.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 2px 8px rgba(11, 124, 145, 0.25)',
                        transition: 'opacity 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.92'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                    Book something
                </button>
            </div>

            {/* 4 Metrics Cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 16,
                marginBottom: 32,
            }}>
                {/* 1. Needs you */}
                <div style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    borderRadius: 14,
                    padding: '20px 22px',
                    boxShadow: '0 2px 8px rgba(26, 28, 34, 0.04)',
                }}>
                    <span style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(26, 28, 34, 0.5)',
                        display: 'block',
                        marginBottom: 8,
                    }}>
                        NEEDS YOU
                    </span>
                    <div style={{
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 32,
                        fontWeight: 800,
                        color: '#B45309',
                        lineHeight: 1.1,
                        marginBottom: 6,
                    }}>
                        {metrics.needsYou}
                    </div>
                    <span style={{ fontSize: 12.5, color: 'rgba(26, 28, 34, 0.65)' }}>
                        a quote and a delivery
                    </span>
                </div>

                {/* 2. Held in escrow */}
                <div style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    borderRadius: 14,
                    padding: '20px 22px',
                    boxShadow: '0 2px 8px rgba(26, 28, 34, 0.04)',
                }}>
                    <span style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(26, 28, 34, 0.5)',
                        display: 'block',
                        marginBottom: 8,
                    }}>
                        HELD IN ESCROW
                    </span>
                    <div style={{
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 32,
                        fontWeight: 800,
                        color: '#1A1C22',
                        lineHeight: 1.1,
                        marginBottom: 6,
                    }}>
                        €{metrics.heldInEscrow.toLocaleString()}
                    </div>
                    <span style={{ fontSize: 12.5, color: 'rgba(26, 28, 34, 0.65)' }}>
                        across 3 bookings
                    </span>
                </div>

                {/* 3. Next shoot */}
                <div style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    borderRadius: 14,
                    padding: '20px 22px',
                    boxShadow: '0 2px 8px rgba(26, 28, 34, 0.04)',
                }}>
                    <span style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(26, 28, 34, 0.5)',
                        display: 'block',
                        marginBottom: 8,
                    }}>
                        NEXT SHOOT
                    </span>
                    <div style={{
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 32,
                        fontWeight: 800,
                        color: '#1A1C22',
                        lineHeight: 1.1,
                        marginBottom: 6,
                    }}>
                        {metrics.nextShootDate}
                    </div>
                    <span style={{ fontSize: 12.5, color: 'rgba(26, 28, 34, 0.65)' }}>
                        in 8 days · {metrics.nextShootLocation}
                    </span>
                </div>

                {/* 4. Rushes waiting */}
                <div style={{
                    background: '#FFFFFF',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    borderRadius: 14,
                    padding: '20px 22px',
                    boxShadow: '0 2px 8px rgba(26, 28, 34, 0.04)',
                }}>
                    <span style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(26, 28, 34, 0.5)',
                        display: 'block',
                        marginBottom: 8,
                    }}>
                        RUSHES WAITING
                    </span>
                    <div style={{
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 32,
                        fontWeight: 800,
                        color: '#0B7C91',
                        lineHeight: 1.1,
                        marginBottom: 6,
                    }}>
                        {metrics.rushesWaiting}
                    </div>
                    <span style={{ fontSize: 12.5, color: 'rgba(26, 28, 34, 0.65)' }}>
                        ready to open in the editor
                    </span>
                </div>
            </div>

            {/* Main Content Layout (Table on left, Action cards on right) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
                {/* Left Column: Filter Tabs + Table */}
                <div>
                    {/* Status filter tabs */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 18,
                        marginBottom: 16,
                        borderBottom: '1px solid rgba(26, 28, 34, 0.08)',
                        paddingBottom: 10,
                    }}>
                        {[
                            { id: 'all', label: 'All · 9' },
                            { id: 'needs_you', label: 'Needs you · 2' },
                            { id: 'upcoming', label: 'Upcoming · 3' },
                            { id: 'in_prod', label: 'In production · 1' },
                            { id: 'closed', label: 'Closed · 3' },
                        ].map(tab => {
                            const isSel = filterTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setFilterTab(tab.id)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontFamily: 'var(--f-sans, "Plus Jakarta Sans", sans-serif)',
                                        fontSize: 13,
                                        fontWeight: isSel ? 700 : 500,
                                        color: isSel ? '#1A1C22' : 'rgba(26, 28, 34, 0.55)',
                                        padding: '4px 0',
                                        position: 'relative',
                                    }}
                                >
                                    {tab.label}
                                    {isSel && (
                                        <div style={{
                                            position: 'absolute',
                                            bottom: -11,
                                            left: 0,
                                            right: 0,
                                            height: 2,
                                            background: '#1A1C22',
                                            borderRadius: 2,
                                        }} />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Bookings Table Card */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        overflow: 'hidden',
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        {/* Table Header */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '2.5fr 1.2fr 1.2fr 1.1fr 1.4fr',
                            padding: '12px 20px',
                            background: '#F9F8F6',
                            borderBottom: '1px solid rgba(26, 28, 34, 0.06)',
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                        }}>
                            <div>JOB</div>
                            <div>DATE</div>
                            <div>STATUS</div>
                            <div>MONEY</div>
                            <div style={{ textAlign: 'right' }}>NEXT</div>
                        </div>

                        {/* Table Rows */}
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {filteredBookings.map((b, idx) => {
                                const isLast = idx === filteredBookings.length - 1;
                                return (
                                    <div
                                        key={b.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '2.5fr 1.2fr 1.2fr 1.1fr 1.4fr',
                                            alignItems: 'center',
                                            padding: '16px 20px',
                                            borderBottom: isLast ? 'none' : '1px solid rgba(26, 28, 34, 0.06)',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#FAF9F6'}
                                        onMouseLeave={e => e.currentTarget.style.background = '#FFFFFF'}
                                    >
                                        {/* Job Title & Subtitle */}
                                        <div>
                                            <div style={{
                                                fontFamily: 'var(--f-sans, "Plus Jakarta Sans", sans-serif)',
                                                fontSize: 14,
                                                fontWeight: 700,
                                                color: '#1A1C22',
                                                marginBottom: 2,
                                            }}>
                                                {b.title}
                                            </div>
                                            <div style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.55)' }}>
                                                {b.talentName}
                                            </div>
                                        </div>

                                        {/* Date */}
                                        <div style={{ fontSize: 12.5, color: '#1A1C22' }}>
                                            <div>{b.date}</div>
                                            <div style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.5)' }}>{b.time}</div>
                                        </div>

                                        {/* Status Pill */}
                                        <div>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '3px 10px',
                                                borderRadius: 999,
                                                fontSize: 11.5,
                                                fontWeight: 600,
                                                background:
                                                    b.statusType === 'confirmed' ? 'rgba(11, 124, 145, 0.10)' :
                                                    b.statusType === 'quote' ? 'rgba(180, 83, 9, 0.10)' :
                                                    b.statusType === 'review' ? 'rgba(217, 119, 6, 0.12)' :
                                                    b.statusType === 'released' ? 'rgba(16, 185, 129, 0.12)' :
                                                    'rgba(239, 68, 68, 0.10)',
                                                color:
                                                    b.statusType === 'confirmed' ? '#0B7C91' :
                                                    b.statusType === 'quote' ? '#B45309' :
                                                    b.statusType === 'review' ? '#D97706' :
                                                    b.statusType === 'released' ? '#059669' :
                                                    '#DC2626',
                                            }}>
                                                {b.status}
                                            </span>
                                        </div>

                                        {/* Money */}
                                        <div>
                                            <div style={{
                                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                fontSize: 13,
                                                fontWeight: 600,
                                                color: '#1A1C22',
                                            }}>
                                                {b.amountLabel}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.5)' }}>
                                                {b.moneyState}
                                            </div>
                                        </div>

                                        {/* Next Action Button */}
                                        <div style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleNextAction(b)}
                                                style={{
                                                    background: b.nextAction === 'callsheet' || b.nextAction === 'open_room' || b.nextAction === 'review_quote'
                                                        ? '#0B7C91' : '#FFFFFF',
                                                    color: b.nextAction === 'callsheet' || b.nextAction === 'open_room' || b.nextAction === 'review_quote'
                                                        ? '#FFFFFF' : '#1A1C22',
                                                    border: b.nextAction === 'callsheet' || b.nextAction === 'open_room' || b.nextAction === 'review_quote'
                                                        ? 'none' : '1px solid rgba(26, 28, 34, 0.16)',
                                                    borderRadius: 8,
                                                    padding: '6px 14px',
                                                    fontSize: 12.5,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    transition: 'opacity 0.15s',
                                                }}
                                                onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                                                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                                            >
                                                {b.nextActionLabel}
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Spend bottom caption */}
                    <div style={{ marginTop: 24, paddingLeft: 4 }}>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                            display: 'block',
                            marginBottom: 2,
                        }}>
                            THIS MONTH
                        </span>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#1A1C22' }}>
                            €{metrics.thisMonthSpent.toLocaleString()}
                        </div>
                        <div style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.6)' }}>
                            spent across {metrics.thisMonthBookings} bookings
                        </div>
                    </div>
                </div>

                {/* Right Column: "Do these first", Rushes in Editor, Spend Chart */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* DO THESE FIRST Task Queue */}
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
                            color: '#B45309',
                            marginBottom: 12,
                        }}>
                            DO THESE FIRST
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {actionQueue.map(item => (
                                <div
                                    key={item.id}
                                    style={{
                                        background: '#FAF9F6',
                                        border: '1px solid rgba(26, 28, 34, 0.06)',
                                        borderRadius: 12,
                                        padding: 14,
                                    }}
                                >
                                    <div style={{
                                        fontFamily: 'var(--f-sans, "Plus Jakarta Sans", sans-serif)',
                                        fontSize: 13.5,
                                        fontWeight: 700,
                                        color: '#1A1C22',
                                        marginBottom: 4,
                                    }}>
                                        {item.title}
                                    </div>
                                    <p style={{ margin: '0 0 12px 0', fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.45 }}>
                                        {item.subtitle}
                                    </p>

                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {item.actions.includes('accept') && (
                                            <button
                                                onClick={() => acceptQuote(item.bookingId)}
                                                style={{
                                                    flex: 1,
                                                    background: '#0B7C91',
                                                    color: '#FFFFFF',
                                                    border: 'none',
                                                    borderRadius: 6,
                                                    padding: '7px 0',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                Accept
                                            </button>
                                        )}
                                        {item.actions.includes('counter') && (
                                            <button
                                                onClick={() => {
                                                    setSelectedBookingId(item.bookingId);
                                                    setActiveTab('messages');
                                                }}
                                                style={{
                                                    flex: 1,
                                                    background: '#FFFFFF',
                                                    color: '#1A1C22',
                                                    border: '1px solid rgba(26, 28, 34, 0.16)',
                                                    borderRadius: 6,
                                                    padding: '7px 0',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                Counter
                                            </button>
                                        )}
                                        {item.actions.includes('review') && (
                                            <button
                                                onClick={() => {
                                                    setSelectedBookingId(item.bookingId);
                                                    setActiveTab('assetroom');
                                                }}
                                                style={{
                                                    flex: 1,
                                                    background: '#0B7C91',
                                                    color: '#FFFFFF',
                                                    border: 'none',
                                                    borderRadius: 6,
                                                    padding: '7px 0',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                Review
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* RUSHES IN THE EDITOR Direct Bridge */}
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
                            RUSHES IN THE EDITOR
                        </div>

                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            background: '#FAF9F6',
                            borderRadius: 12,
                            padding: 12,
                            marginBottom: 14,
                        }}>
                            <div style={{
                                width: 44,
                                height: 44,
                                borderRadius: 8,
                                background: 'rgba(11, 124, 145, 0.12)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#0B7C91',
                                flexShrink: 0,
                            }}>
                                <Film size={20} />
                            </div>
                            <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1C22' }}>
                                    Brand photos · 142 files
                                </div>
                                <div style={{ fontSize: 11.5, color: 'rgba(26, 28, 34, 0.55)' }}>
                                    Ingested 28 Oct · untouched
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleOpenInEditor}
                            style={{
                                width: '100%',
                                background: '#FFFFFF',
                                color: '#1A1C22',
                                border: '1px solid rgba(26, 28, 34, 0.16)',
                                borderRadius: 8,
                                padding: '9px 0',
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.borderColor = '#0B7C91';
                                e.currentTarget.style.color = '#0B7C91';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.borderColor = 'rgba(26, 28, 34, 0.16)';
                                e.currentTarget.style.color = '#1A1C22';
                            }}
                        >
                            Open project
                        </button>
                    </div>

                    {/* SPEND Mini Bar Chart */}
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
                            marginBottom: 16,
                        }}>
                            SPEND
                        </div>

                        <div style={{
                            display: 'flex',
                            alignItems: 'flex-end',
                            justifyContent: 'space-between',
                            height: 64,
                            padding: '0 8px',
                            gap: 8,
                        }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: '100%', height: 20, background: '#EAE7E1', borderRadius: 4 }} />
                                <span style={{ fontSize: 10, color: 'rgba(26, 28, 34, 0.45)' }}>JUL</span>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: '100%', height: 32, background: '#EAE7E1', borderRadius: 4 }} />
                                <span style={{ fontSize: 10, color: 'rgba(26, 28, 34, 0.45)' }}>AUG</span>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: '100%', height: 16, background: '#EAE7E1', borderRadius: 4 }} />
                                <span style={{ fontSize: 10, color: 'rgba(26, 28, 34, 0.45)' }}>SEP</span>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: '100%', height: 28, background: '#EAE7E1', borderRadius: 4 }} />
                                <span style={{ fontSize: 10, color: 'rgba(26, 28, 34, 0.45)' }}>OCT</span>
                            </div>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                <div style={{ width: '100%', height: 56, background: '#0B7C91', borderRadius: 4 }} />
                                <span style={{ fontSize: 10, fontWeight: 700, color: '#0B7C91' }}>NOV</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
