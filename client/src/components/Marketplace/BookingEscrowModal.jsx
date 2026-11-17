/**
 * client/src/components/Marketplace/BookingEscrowModal.jsx
 *
 * Booking & Escrow checkout modal for VIBED Market Surface A.
 * Recreates screen "06 · Booking & escrow.png" with escrow progression,
 * card hold, and project attachment.
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import { X, ShieldCheck, Lock, CheckCircle2, AlertCircle, Clock, Film } from 'lucide-react';

export default function BookingEscrowModal({
    bookingData,
    onClose,
    onConfirmSuccess,
    userProjects = [],
}) {
    if (!bookingData) return null;

    const { item, totalPrice, selectedDuration, addOns } = bookingData;
    const [selectedProject, setSelectedProject] = useState(userProjects[0]?.id || 'noma-interview');
    const [shootAddress, setShootAddress] = useState('Atelier Rive Sud, 14 rue Galilée, 94200 Ivry-sur-Seine');
    const [notes, setNotes] = useState('Two-camera interview with SaaS founder. 4K ProRes delivery preferred.');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConfirmed, setIsConfirmed] = useState(false);

    const handleConfirm = () => {
        setIsSubmitting(true);
        setTimeout(() => {
            setIsSubmitting(false);
            setIsConfirmed(true);
            onConfirmSuccess?.({
                bookingId: `bk_${Math.random().toString(36).slice(2, 8)}`,
                talentName: item.name,
                totalPrice,
                date: '19 Nov 2026',
            });
        }, 1200);
    };

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            background: 'rgba(16, 21, 29, 0.55)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
        }}>
            <div style={{
                width: '100%',
                maxWidth: 580,
                background: '#FFFFFF',
                borderRadius: 20,
                border: '1px solid rgba(16, 21, 29, 0.08)',
                boxShadow: '0 24px 60px -12px rgba(16, 21, 29, 0.25)',
                overflow: 'hidden',
                position: 'relative',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid #EDF0F4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <div>
                        <span style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.08em',
                            color: '#0B7C91',
                            textTransform: 'uppercase',
                        }}>
                            SURFACE A · BOOK A SHOOT
                        </span>
                        <h2 style={{
                            fontFamily: 'var(--f-serif, "Instrument Serif", serif)',
                            fontSize: 26,
                            margin: '2px 0 0 0',
                            color: '#10151D',
                        }}>
                            Request & Escrow Hold
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: '#EDF0F4',
                            border: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#5F6876',
                            cursor: 'pointer',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: '24px 28px' }}>
                    {isConfirmed ? (
                        <div style={{ textAlign: 'center', padding: '24px 0' }}>
                            <div style={{
                                width: 56,
                                height: 56,
                                borderRadius: '50%',
                                background: '#E6F4EA',
                                color: '#0F7A52',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 16px',
                            }}>
                                <CheckCircle2 size={32} />
                            </div>
                            <h3 style={{
                                fontFamily: 'var(--f-serif, "Instrument Serif", serif)',
                                fontSize: 28,
                                color: '#10151D',
                                margin: '0 0 8px 0',
                            }}>
                                Booking Request Dispatched
                            </h3>
                            <p style={{
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 14,
                                color: '#5F6876',
                                lineHeight: 1.5,
                                margin: '0 0 24px 0',
                            }}>
                                Funds (€{totalPrice}) are placed in escrow protection. {item.name.split(' ')[0]} has 24 hours to confirm or counter. Rushes will automatically ingest into your VIBED project upon completion.
                            </p>
                            <button
                                type="button"
                                onClick={onClose}
                                style={{
                                    padding: '10px 24px',
                                    borderRadius: 10,
                                    background: '#10151D',
                                    color: '#FFFFFF',
                                    border: 'none',
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                }}
                            >
                                Back to Market
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Summary Pill Card */}
                            <div style={{
                                background: '#F6F7F9',
                                border: '1px solid #EDF0F4',
                                borderRadius: 12,
                                padding: '14px 18px',
                                marginBottom: 20,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                            }}>
                                <div>
                                    <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 14, fontWeight: 600, color: '#10151D' }}>
                                        {item.name}
                                    </div>
                                    <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 12, color: '#5F6876' }}>
                                        Thu 19 Nov 2026 · {selectedDuration === 'half' ? 'Half-day (09:30 - 13:30)' : 'Full-day (09:30 - 17:30)'}
                                    </div>
                                </div>
                                <div style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 18,
                                    fontWeight: 600,
                                    color: '#0B7C91',
                                }}>
                                    €{totalPrice}
                                </div>
                            </div>

                            {/* Project Attachment */}
                            <div style={{ marginBottom: 16 }}>
                                <label style={{
                                    display: 'block',
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 11,
                                    color: '#5F6876',
                                    textTransform: 'uppercase',
                                    marginBottom: 6,
                                }}>
                                    ATTACH VIBED PROJECT (FOR DIRECT RUSHES INGEST)
                                </label>
                                <select
                                    value={selectedProject}
                                    onChange={e => setSelectedProject(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 8,
                                        border: '1px solid #DFE6ED',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 13,
                                        color: '#10151D',
                                        background: '#FFFFFF',
                                    }}
                                >
                                    <option value="noma-interview">Noma — founder interview (4K Talking head)</option>
                                    {userProjects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Address & Logistics */}
                            <div style={{ marginBottom: 16 }}>
                                <label style={{
                                    display: 'block',
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 11,
                                    color: '#5F6876',
                                    textTransform: 'uppercase',
                                    marginBottom: 6,
                                }}>
                                    LOCATION / STUDIO ADDRESS
                                </label>
                                <input
                                    type="text"
                                    value={shootAddress}
                                    onChange={e => setShootAddress(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 8,
                                        border: '1px solid #DFE6ED',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 13,
                                        color: '#10151D',
                                    }}
                                />
                            </div>

                            {/* Notes to Specialist */}
                            <div style={{ marginBottom: 20 }}>
                                <label style={{
                                    display: 'block',
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 11,
                                    color: '#5F6876',
                                    textTransform: 'uppercase',
                                    marginBottom: 6,
                                }}>
                                    CALL SHEET NOTES & TECHNICAL SPECS
                                </label>
                                <textarea
                                    rows={2}
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        borderRadius: 8,
                                        border: '1px solid #DFE6ED',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 13,
                                        color: '#10151D',
                                        resize: 'none',
                                    }}
                                />
                            </div>

                            {/* Escrow Timeline Progression */}
                            <div style={{
                                background: '#F0F9FB',
                                border: '1px solid #D4EFF6',
                                borderRadius: 12,
                                padding: '14px 16px',
                                marginBottom: 24,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                                    <ShieldCheck size={16} color="#0B7C91" />
                                    <span style={{
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: '#0B7C91',
                                    }}>
                                        VIBED Escrow Protection Ledger
                                    </span>
                                </div>
                                <div style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 10,
                                    color: '#5F6876',
                                    marginBottom: 6,
                                }}>
                                    <span style={{ color: '#0B7C91', fontWeight: 600 }}>1. PAID (HELD)</span>
                                    <span>2. DELIVERED</span>
                                    <span>3. ACCEPTED</span>
                                    <span>4. PAID OUT</span>
                                </div>
                                <div style={{ height: 4, background: '#DFE6ED', borderRadius: 999, overflow: 'hidden' }}>
                                    <div style={{ width: '25%', height: '100%', background: '#0B7C91' }} />
                                </div>
                                <div style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 11,
                                    color: '#5F6876',
                                    marginTop: 8,
                                    lineHeight: 1.4,
                                }}>
                                    Card is captured now, funds held in escrow until you approve the rushes. 30% deposit non-refundable within 48h of call time.
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button
                                    type="button"
                                    onClick={onClose}
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        borderRadius: 10,
                                        background: '#FFFFFF',
                                        color: '#5F6876',
                                        border: '1px solid #DFE6ED',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 14,
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleConfirm}
                                    disabled={isSubmitting}
                                    style={{
                                        flex: 2,
                                        padding: '12px',
                                        borderRadius: 10,
                                        background: '#0B7C91',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 4px 14px rgba(11, 124, 145, 0.3)',
                                    }}
                                >
                                    {isSubmitting ? 'Holding Escrow...' : `Authorize & Hold €${totalPrice}`}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
