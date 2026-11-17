/**
 * client/src/components/Marketplace/MarketplaceLedgerModal.jsx
 *
 * Board 15: Financial Ledger & Escrow Breakdown
 * Complete transparency view:
 * - End-to-end fee distribution visualizer (Buyer pays, VAT, Platform, Talent receives)
 * - Event-driven append-only ledger log
 * - Payout rules schedule
 * - 5-step dispute escalation protocol
 *
 * Strictly zero emojis. Plus Jakarta Sans typography.
 */

import React from 'react';
import {
    ShieldCheck, CheckCircle2, AlertCircle, FileText,
    ArrowRight, X, TrendingUp, DollarSign
} from 'lucide-react';
import useMarketplaceStore from '../../store/useMarketplaceStore.js';

export default function MarketplaceLedgerModal({ isOpen, onClose }) {
    const { ledger } = useMarketplaceStore();

    if (!isOpen) return null;

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(0, 0, 0, 0.65)',
                backdropFilter: 'blur(6px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: '#FFFFFF',
                    borderRadius: 20,
                    maxWidth: 960,
                    width: '100%',
                    maxHeight: '90vh',
                    overflowY: 'auto',
                    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.3)',
                    border: '1px solid rgba(26, 28, 34, 0.08)',
                    padding: 32,
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: 24,
                    borderBottom: '1px solid rgba(26, 28, 34, 0.08)',
                    paddingBottom: 20,
                }}>
                    <div>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10.5,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                        }}>
                            15 · MONEY & DISPUTES
                        </span>
                        <h2 style={{
                            margin: '4px 0 6px 0',
                            fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                            fontSize: 26,
                            fontWeight: 800,
                            letterSpacing: '-0.025em',
                            color: '#1A1C22',
                        }}>
                            Who holds it, who gets it, when
                        </h2>
                        <p style={{ margin: 0, fontSize: 13, color: 'rgba(26, 28, 34, 0.65)', maxWidth: 640 }}>
                            A marketplace is a promise that the money will behave. Every number below is visible to both sides before anyone commits, and the ledger is append-only.
                        </p>
                    </div>

                    <button
                        onClick={onClose}
                        style={{
                            background: '#FAF9F6',
                            border: '1px solid rgba(26, 28, 34, 0.12)',
                            borderRadius: '50%',
                            width: 32,
                            height: 32,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#1A1C22',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Top Section: End to end breakdown bars */}
                <div style={{
                    background: '#FAF9F6',
                    border: '1px solid rgba(26, 28, 34, 0.06)',
                    borderRadius: 16,
                    padding: 20,
                    marginBottom: 24,
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: 16,
                    }}>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                        }}>
                            ONE BOOKING, END TO END
                        </span>
                        <span style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.6)' }}>
                            Nour Benali · half-day + second camera + first cut
                        </span>
                    </div>

                    {/* Bars visualizer */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1C22' }}>Buyer pays</span>
                            <div style={{ height: 10, background: '#0B7C91', borderRadius: 999 }} />
                            <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12.5, fontWeight: 700, color: '#1A1C22', textAlign: 'right' }}>
                                €{ledger.buyerPays.toFixed(2)}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)' }}>VAT to the state</span>
                            <div style={{ width: '22%', height: 8, background: '#94A3B8', borderRadius: 999 }} />
                            <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', textAlign: 'right' }}>
                                -€{ledger.vatToState.toFixed(2)}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)' }}>Buyer service fee 5%</span>
                            <div style={{ width: '6%', height: 8, background: '#0B7C91', opacity: 0.6, borderRadius: 999 }} />
                            <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', textAlign: 'right' }}>
                                €{ledger.buyerServiceFee.toFixed(2)}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)' }}>Platform rate · Pro 9%</span>
                            <div style={{ width: '10%', height: 8, background: '#0B7C91', opacity: 0.8, borderRadius: 999 }} />
                            <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', textAlign: 'right' }}>
                                €{ledger.platformRate.toFixed(2)}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px', alignItems: 'center', gap: 14 }}>
                            <span style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)' }}>Card processing</span>
                            <div style={{ width: '4%', height: 8, background: '#94A3B8', borderRadius: 999 }} />
                            <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', textAlign: 'right' }}>
                                -€{ledger.cardProcessing.toFixed(2)}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 90px', alignItems: 'center', gap: 14, paddingTop: 4 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 700, color: '#059669' }}>Nour receives</span>
                            <div style={{ width: '74%', height: 10, background: '#059669', borderRadius: 999 }} />
                            <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12.5, fontWeight: 700, color: '#059669', textAlign: 'right' }}>
                                €{ledger.talentReceives.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Ledger Log + Payout Rules Split */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, marginBottom: 24 }}>
                    {/* Event-driven Ledger */}
                    <div>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                            marginBottom: 12,
                        }}>
                            THE LEDGER BEHIND IT
                        </div>

                        <div style={{
                            border: '1px solid rgba(26, 28, 34, 0.08)',
                            borderRadius: 12,
                            overflow: 'hidden',
                        }}>
                            {ledger.events.map((ev, eIdx) => (
                                <div
                                    key={eIdx}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: '64px 1.4fr 1fr 70px',
                                        alignItems: 'center',
                                        padding: '10px 14px',
                                        background: eIdx % 2 === 0 ? '#FFFFFF' : '#FAF9F6',
                                        fontSize: 12,
                                        borderBottom: eIdx === ledger.events.length - 1 ? 'none' : '1px solid rgba(26, 28, 34, 0.04)',
                                    }}
                                >
                                    <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', color: 'rgba(26, 28, 34, 0.5)', fontSize: 11 }}>
                                        {ev.date}
                                    </span>
                                    <span style={{ fontWeight: 600, color: '#1A1C22' }}>{ev.event}</span>
                                    <span style={{ color: 'rgba(26, 28, 34, 0.6)' }}>{ev.entry}</span>
                                    <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontWeight: 600, color: '#1A1C22', textAlign: 'right' }}>
                                        {ev.amount}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Payout Rules */}
                    <div>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                            marginBottom: 12,
                        }}>
                            PAYOUT RULES
                        </div>

                        <div style={{
                            background: '#FAF9F6',
                            border: '1px solid rgba(26, 28, 34, 0.08)',
                            borderRadius: 12,
                            padding: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                            fontSize: 12.5,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#1A1C22' }}>Standard</span>
                                <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontWeight: 700, color: '#1A1C22' }}>7 days</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#1A1C22' }}>Pro and Elite</span>
                                <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontWeight: 700, color: '#0B7C91' }}>2 days</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#1A1C22' }}>Instant</span>
                                <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontWeight: 700, color: '#1A1C22' }}>1% fee</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#1A1C22' }}>First job of a new account</span>
                                <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontWeight: 700, color: '#B45309' }}>+5 days</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 5-Step Dispute Protocol */}
                <div>
                    <div style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: '#B45309',
                        marginBottom: 12,
                    }}>
                        WHEN IT GOES WRONG (5-STEP PROTOCOL)
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        gap: 12,
                    }}>
                        {ledger.disputeSteps.map((ds, sIdx) => (
                            <div
                                key={sIdx}
                                style={{
                                    background: '#FAF9F6',
                                    border: '1px solid rgba(26, 28, 34, 0.08)',
                                    borderRadius: 12,
                                    padding: '12px 14px',
                                }}
                            >
                                <span style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: '#B45309',
                                    display: 'block',
                                    marginBottom: 4,
                                }}>
                                    {ds.step} · {ds.title}
                                </span>
                                <p style={{ margin: 0, fontSize: 11, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.4 }}>
                                    {ds.desc}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
