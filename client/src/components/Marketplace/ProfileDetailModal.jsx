/**
 * client/src/components/Marketplace/ProfileDetailModal.jsx
 *
 * Full-screen modal / view for Talent & Studio Profiles in VIBED Market.
 * Recreates screen "04 · Talent profile.png" and "05 · Studio listing.png".
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    ArrowLeft, ShieldCheck, Check, Clock, Star, MapPin, CheckCircle2,
    Calendar, Video, FileText, Lock, ChevronRight, X, Play
} from 'lucide-react';

export default function ProfileDetailModal({
    item,
    onClose,
    onRequestBooking,
    onMessage,
}) {
    if (!item) return null;

    const [proofTab, setProofTab] = useState('verified'); // 'verified' | 'uploaded'
    const [selectedDuration, setSelectedDuration] = useState('half'); // 'half' | 'full'
    const [selectedDate, setSelectedDate] = useState('19'); // Nov 19
    const [addOns, setAddOns] = useState({
        secondCamera: false,
        extraHour: false,
        editInVibed: false,
    });

    const isStudio = item.type === 'studio';
    const proofs = item.proofs || [];
    const filteredProofs = proofs.filter(p => proofTab === 'verified' ? p.verified : !p.verified);

    // Calculate totals
    const basePrice = selectedDuration === 'half' ? (item.priceHalfDayBase || item.priceHalfDay) : item.priceFullDay;
    const secondCameraPrice = addOns.secondCamera ? (item.secondCameraRate || 90) : 0;
    const extraHourPrice = addOns.extraHour ? (item.extraHourRate || 130) : 0;
    const editInVibedPrice = addOns.editInVibed ? (item.editInVibedRate || 220) : 0;
    const subtotal = basePrice + secondCameraPrice + extraHourPrice + editInVibedPrice;
    const serviceFee = Math.round(subtotal * 0.05);
    const totalPrice = subtotal + serviceFee;

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            background: 'rgba(16, 21, 29, 0.45)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            justifyContent: 'center',
            overflowY: 'auto',
            padding: '24px 16px',
        }}>
            <div style={{
                width: '100%',
                maxWidth: 1180,
                background: '#FFFFFF',
                borderRadius: 20,
                border: '1px solid rgba(16, 21, 29, 0.08)',
                boxShadow: '0 24px 60px -12px rgba(16, 21, 29, 0.25)',
                margin: 'auto',
                overflow: 'hidden',
                position: 'relative',
                animation: 'modalSlideUp 0.24s cubic-bezier(0.16, 1, 0.3, 1)',
            }}>
                {/* Header navigation bar */}
                <div style={{
                    padding: '20px 32px 16px',
                    borderBottom: '1px solid #EDF0F4',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: '#FFFFFF',
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                }}>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            background: 'none',
                            border: 'none',
                            color: '#5F6876',
                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: 'pointer',
                            padding: 0,
                        }}
                    >
                        <ArrowLeft size={16} />
                        Back to results
                    </button>

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

                {/* Profile Container */}
                <div style={{ padding: '32px 32px 48px' }}>
                    {/* Top Identity Block */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, marginBottom: 28 }}>
                        {/* Avatar */}
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                            <div style={{
                                width: 72,
                                height: 72,
                                borderRadius: '50%',
                                background: '#E3E7EC',
                                border: '2.5px solid #0B7C91',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 24,
                                fontWeight: 600,
                                color: '#10151D',
                            }}>
                                {item.initials || item.name.slice(0, 2).toUpperCase()}
                            </div>
                            <div style={{
                                position: 'absolute',
                                bottom: 2,
                                right: 2,
                                width: 14,
                                height: 14,
                                borderRadius: '50%',
                                background: item.availableOnRequestedDate ? '#0F7A52' : '#A35A00',
                                border: '2.5px solid #FFFFFF',
                            }} />
                        </div>

                        {/* Title & Badges */}
                        <div style={{ flex: 1 }}>
                            <h1 style={{
                                fontFamily: 'var(--f-serif, "Instrument Serif", serif)',
                                fontSize: 38,
                                fontWeight: 400,
                                color: '#10151D',
                                margin: '0 0 6px 0',
                                letterSpacing: '-0.02em',
                                lineHeight: 1.15,
                            }}>
                                {item.name}
                            </h1>
                            <p style={{
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontSize: 15,
                                color: '#5F6876',
                                margin: '0 0 14px 0',
                            }}>
                                {item.subtitle || `${item.kind} · ${item.location} · travels 40 km`}
                            </p>

                            {/* Trust & Verification Badges */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {(item.badges || []).map((b, i) => (
                                    <span
                                        key={i}
                                        style={{
                                            padding: '3px 10px',
                                            borderRadius: 999,
                                            background: b === 'Pro' ? '#EDF0F4' : b.includes('verified') || b.includes('certified') ? '#E6F4EA' : '#F6F7F9',
                                            color: b === 'Pro' ? '#10151D' : b.includes('verified') || b.includes('certified') ? '#0F7A52' : '#5F6876',
                                            border: '1px solid rgba(16, 21, 29, 0.08)',
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 12,
                                            fontWeight: 500,
                                        }}
                                    >
                                        {b}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Four Key Metrics Row */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 16,
                        padding: '18px 24px',
                        background: '#F6F7F9',
                        borderRadius: 14,
                        border: '1px solid #EDF0F4',
                        marginBottom: 36,
                    }}>
                        <div>
                            <div style={{ fontFamily: 'var(--f-serif, "Instrument Serif", serif)', fontSize: 28, color: '#10151D' }}>
                                {item.rating.toFixed(2)}
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 12, color: '#5F6876' }}>
                                {item.jobsCount} jobs rated
                            </div>
                        </div>
                        <div>
                            <div style={{ fontFamily: 'var(--f-serif, "Instrument Serif", serif)', fontSize: 28, color: '#10151D' }}>
                                {item.onTimePct || 100}%
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 12, color: '#5F6876' }}>
                                on time
                            </div>
                        </div>
                        <div>
                            <div style={{ fontFamily: 'var(--f-serif, "Instrument Serif", serif)', fontSize: 28, color: '#10151D' }}>
                                {item.replyTime ? item.replyTime.replace('replies in ', '') : '40 min'}
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 12, color: '#5F6876' }}>
                                median reply
                            </div>
                        </div>
                        <div>
                            <div style={{ fontFamily: 'var(--f-serif, "Instrument Serif", serif)', fontSize: 28, color: '#10151D' }}>
                                {item.repeatClients || 11}
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 12, color: '#5F6876' }}>
                                repeat clients
                            </div>
                        </div>
                    </div>

                    {/* Main Content Layout: 2 Columns */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 36, alignItems: 'start' }}>
                        {/* Left Column: Proof of work, Certifications, Kit, Reviews */}
                        <div>
                            {/* PROOF OF WORK */}
                            <div style={{ marginBottom: 36 }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                    <h3 style={{
                                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        letterSpacing: '0.08em',
                                        textTransform: 'uppercase',
                                        color: '#5F6876',
                                        margin: 0,
                                    }}>
                                        PROOF OF WORK
                                    </h3>
                                </div>
                                <p style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 13,
                                    color: '#5F6876',
                                    margin: '0 0 16px 0',
                                }}>
                                    Nine of these were shot on a VIBED booking and cut in the editor. The manifest under each one is the receipt: project, source clips, render date.
                                </p>

                                {/* Tabs: Verified vs Uploaded */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                                    <button
                                        type="button"
                                        onClick={() => setProofTab('verified')}
                                        style={{
                                            padding: '6px 14px',
                                            borderRadius: 999,
                                            background: proofTab === 'verified' ? '#10151D' : '#F6F7F9',
                                            color: proofTab === 'verified' ? '#FFFFFF' : '#5F6876',
                                            border: '1px solid rgba(16, 21, 29, 0.08)',
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 12,
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Verified 9
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setProofTab('uploaded')}
                                        style={{
                                            padding: '6px 14px',
                                            borderRadius: 999,
                                            background: proofTab === 'uploaded' ? '#10151D' : '#F6F7F9',
                                            color: proofTab === 'uploaded' ? '#FFFFFF' : '#5F6876',
                                            border: '1px solid rgba(16, 21, 29, 0.08)',
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 12,
                                            fontWeight: 500,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Uploaded 4
                                    </button>
                                </div>

                                {/* Proof Cards Grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                                    {filteredProofs.map((p, idx) => (
                                        <div
                                            key={p.id || idx}
                                            style={{
                                                background: '#FFFFFF',
                                                border: '1px solid #EDF0F4',
                                                borderRadius: 14,
                                                overflow: 'hidden',
                                                boxShadow: '0 2px 8px rgba(16, 21, 29, 0.04)',
                                            }}
                                        >
                                            {/* Preview Placeholder */}
                                            <div style={{
                                                height: 130,
                                                background: '#E9EFF5',
                                                position: 'relative',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                <Play size={24} color="#5F6876" style={{ opacity: 0.6 }} />
                                                <span style={{
                                                    position: 'absolute',
                                                    top: 10,
                                                    left: 10,
                                                    padding: '2px 8px',
                                                    borderRadius: 999,
                                                    background: p.verified ? 'rgba(15, 122, 82, 0.9)' : 'rgba(95, 104, 118, 0.85)',
                                                    color: '#FFFFFF',
                                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                    fontSize: 11,
                                                    fontWeight: 500,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                }}>
                                                    {p.verified ? <Check size={11} strokeWidth={2.5} /> : null}
                                                    {p.verified ? 'Verified' : 'Uploaded'}
                                                </span>
                                                <span style={{
                                                    position: 'absolute',
                                                    bottom: 8,
                                                    right: 10,
                                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                    fontSize: 11,
                                                    color: '#5F6876',
                                                }}>
                                                    {p.duration}
                                                </span>
                                            </div>

                                            {/* Card Details */}
                                            <div style={{ padding: '14px 16px' }}>
                                                <h4 style={{
                                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                    fontSize: 14,
                                                    fontWeight: 600,
                                                    color: '#10151D',
                                                    margin: '0 0 4px 0',
                                                }}>
                                                    {p.title}
                                                </h4>
                                                <p style={{
                                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                    fontSize: 12,
                                                    color: '#5F6876',
                                                    margin: '0 0 10px 0',
                                                    lineHeight: 1.4,
                                                }}>
                                                    {p.type}
                                                </p>
                                                <div style={{
                                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                    fontSize: 11,
                                                    color: '#0B7C91',
                                                    background: '#F0F9FB',
                                                    padding: '4px 8px',
                                                    borderRadius: 6,
                                                    display: 'inline-block',
                                                }}>
                                                    {p.manifest}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* CERTIFICATIONS */}
                            <div style={{
                                background: '#F6F7F9',
                                border: '1px solid #EDF0F4',
                                borderRadius: 14,
                                padding: 20,
                                marginBottom: 28,
                            }}>
                                <h3 style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    color: '#5F6876',
                                    margin: '0 0 14px 0',
                                }}>
                                    CERTIFICATIONS
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {(item.certifications || [
                                        { name: 'Interview & talking head', status: 'PASSED', date: 'Jun 2026' },
                                        { name: 'Location sound', status: 'PASSED', date: 'Jun 2026' },
                                        { name: 'Vertical / short form', status: 'IN REVIEW', date: '' },
                                        { name: 'Multi-cam live', status: 'NOT TAKEN', date: '' },
                                    ]).map((c, idx) => (
                                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 13, color: '#10151D' }}>
                                                {c.name}
                                            </span>
                                            <span style={{
                                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                fontSize: 11,
                                                fontWeight: 600,
                                                color: c.status === 'PASSED' ? '#0F7A52' : c.status === 'IN REVIEW' ? '#A35A00' : '#8C96A5',
                                            }}>
                                                {c.status} {c.date && `· ${c.date}`}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <p style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 11,
                                    color: '#8C96A5',
                                    margin: '14px 0 0 0',
                                }}>
                                    A certification is a timed practical, marked against a rubric, re-sat every 24 months. It is never bought.
                                </p>
                            </div>

                            {/* KIT & CONDITIONS */}
                            <div style={{
                                background: '#FFFFFF',
                                border: '1px solid #EDF0F4',
                                borderRadius: 14,
                                padding: 20,
                                marginBottom: 28,
                            }}>
                                <h3 style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    color: '#5F6876',
                                    margin: '0 0 14px 0',
                                }}>
                                    KIT & CONDITIONS
                                </h3>
                                {/* Kit Tags */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                                    {(item.kit || item.gearIncluded || []).map((k, idx) => (
                                        <span key={idx} style={{
                                            padding: '4px 10px',
                                            borderRadius: 6,
                                            background: '#EDF0F4',
                                            color: '#10151D',
                                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                            fontSize: 12,
                                        }}>
                                            {k}
                                        </span>
                                    ))}
                                </div>
                                {/* Conditions list */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {(item.conditions || item.features || []).map((cond, idx) => (
                                        <div key={idx} style={{
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 13,
                                            color: '#5F6876',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                        }}>
                                            <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#0B7C91' }} />
                                            {cond}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* REVIEWS */}
                            <div>
                                <h3 style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 12,
                                    fontWeight: 600,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    color: '#5F6876',
                                    margin: '0 0 14px 0',
                                }}>
                                    REVIEWS FROM BUYERS
                                </h3>
                                {/* Dimensions Bar */}
                                {item.ratingsBreakdown && (
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(4, 1fr)',
                                        gap: 12,
                                        marginBottom: 20,
                                    }}>
                                        {Object.entries(item.ratingsBreakdown).map(([key, val]) => (
                                            <div key={key}>
                                                <div style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 11, color: '#5F6876', textTransform: 'capitalize' }}>
                                                    {key}
                                                </div>
                                                <div style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 15, fontWeight: 600, color: '#10151D' }}>
                                                    {val.toFixed(2)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {/* Quotes */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    {(item.reviews || []).map((rev, idx) => (
                                        <div key={idx} style={{
                                            padding: '14px 16px',
                                            background: '#F6F7F9',
                                            borderRadius: 10,
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 13, fontWeight: 600, color: '#10151D' }}>
                                                    {rev.author} · {rev.project}
                                                </span>
                                                <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 11, color: '#5F6876' }}>
                                                    {rev.date}
                                                </span>
                                            </div>
                                            <p style={{
                                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                                fontSize: 13,
                                                color: '#5F6876',
                                                margin: 0,
                                                lineHeight: 1.45,
                                            }}>
                                                "{rev.text}"
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Right Sticky Booking & Scout Sidebar */}
                        <div style={{ position: 'sticky', top: 90, display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {/* Booking Card */}
                            <div style={{
                                background: '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                borderRadius: 16,
                                padding: 24,
                                boxShadow: '0 8px 30px -6px rgba(16, 21, 29, 0.08)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
                                    <div>
                                        <span style={{
                                            fontFamily: 'var(--f-serif, "Instrument Serif", serif)',
                                            fontSize: 42,
                                            color: '#10151D',
                                            lineHeight: 1,
                                        }}>
                                            €{basePrice}
                                        </span>
                                    </div>
                                    <span style={{
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 13,
                                        color: '#5F6876',
                                    }}>
                                        {selectedDuration === 'half' ? 'half-day · 4 h' : 'full day · 8 h'}
                                    </span>
                                </div>

                                {/* Half / Full day toggles */}
                                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDuration('half')}
                                        style={{
                                            flex: 1,
                                            padding: '8px',
                                            borderRadius: 8,
                                            background: selectedDuration === 'half' ? '#EDF0F4' : '#FFFFFF',
                                            border: '1px solid #DFE6ED',
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color: '#10151D',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Half day (4h)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedDuration('full')}
                                        style={{
                                            flex: 1,
                                            padding: '8px',
                                            borderRadius: 8,
                                            background: selectedDuration === 'full' ? '#EDF0F4' : '#FFFFFF',
                                            border: '1px solid #DFE6ED',
                                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                            fontSize: 12,
                                            fontWeight: 500,
                                            color: '#10151D',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        Full day (8h)
                                    </button>
                                </div>

                                {/* Add-ons */}
                                <div style={{ borderTop: '1px solid #EDF0F4', paddingTop: 14, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                checked={addOns.secondCamera}
                                                onChange={e => setAddOns(a => ({ ...a, secondCamera: e.target.checked }))}
                                            />
                                            <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 13, color: '#10151D' }}>
                                                Second camera
                                            </span>
                                        </div>
                                        <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: '#5F6876' }}>
                                            +€90
                                        </span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                checked={addOns.extraHour}
                                                onChange={e => setAddOns(a => ({ ...a, extraHour: e.target.checked }))}
                                            />
                                            <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 13, color: '#10151D' }}>
                                                Extra hour
                                            </span>
                                        </div>
                                        <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: '#5F6876' }}>
                                            +€130
                                        </span>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input
                                                type="checkbox"
                                                checked={addOns.editInVibed}
                                                onChange={e => setAddOns(a => ({ ...a, editInVibed: e.target.checked }))}
                                            />
                                            <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 13, color: '#10151D' }}>
                                                Edit in VIBED, first cut
                                            </span>
                                        </div>
                                        <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: '#5F6876' }}>
                                            +€220
                                        </span>
                                    </label>
                                </div>

                                {/* Fees */}
                                <div style={{ borderTop: '1px solid #EDF0F4', paddingTop: 12, marginBottom: 18 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                        <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 12, color: '#5F6876' }}>
                                            Pro Service fee (5%)
                                        </span>
                                        <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, color: '#5F6876' }}>
                                            €{serviceFee}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                                        <span style={{ fontFamily: 'var(--f-sans, "Geist", sans-serif)', fontSize: 13, color: '#10151D' }}>
                                            Total held in escrow
                                        </span>
                                        <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 14, color: '#0B7C91' }}>
                                            €{totalPrice}
                                        </span>
                                    </div>
                                </div>

                                {/* Primary Actions */}
                                <button
                                    type="button"
                                    onClick={() => onRequestBooking({ item, totalPrice, selectedDuration, addOns })}
                                    style={{
                                        width: '100%',
                                        padding: '12px 18px',
                                        borderRadius: 10,
                                        background: '#0B7C91',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        marginBottom: 10,
                                        boxShadow: '0 4px 14px rgba(11, 124, 145, 0.3)',
                                    }}
                                >
                                    Request 19 Nov
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onMessage(item)}
                                    style={{
                                        width: '100%',
                                        padding: '10px 18px',
                                        borderRadius: 10,
                                        background: '#FFFFFF',
                                        color: '#10151D',
                                        border: '1px solid #DFE6ED',
                                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                        fontSize: 13,
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Message {item.name.split(' ')[0]}
                                </button>

                                <p style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 11,
                                    color: '#8C96A5',
                                    textAlign: 'center',
                                    margin: '14px 0 0 0',
                                    lineHeight: 1.4,
                                }}>
                                    You are not charged until {item.name.split(' ')[0]} accepts. Funds are then held in escrow until you accept the work.
                                </p>
                            </div>

                            {/* Calendar Widget */}
                            <div style={{
                                background: '#FFFFFF',
                                border: '1px solid #EDF0F4',
                                borderRadius: 16,
                                padding: 20,
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <span style={{ fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)', fontSize: 12, fontWeight: 600, color: '#10151D' }}>
                                        NOVEMBER
                                    </span>
                                    <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#5F6876' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0F7A52' }} /> free
                                        </span>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DFE6ED' }} /> booked
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center', fontSize: 11, color: '#5F6876', marginBottom: 8 }}>
                                    <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, textAlign: 'center' }}>
                                    {['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'].map(d => {
                                        const isSelected = selectedDate === d;
                                        const isFree = ['12', '13', '18', '19', '20', '25', '26', '27'].includes(d);
                                        return (
                                            <button
                                                key={d}
                                                type="button"
                                                onClick={() => setSelectedDate(d)}
                                                style={{
                                                    padding: '6px 0',
                                                    borderRadius: 6,
                                                    background: isSelected ? '#0B7C91' : isFree ? '#F0F9FB' : 'transparent',
                                                    color: isSelected ? '#FFFFFF' : isFree ? '#0B7C91' : '#8C96A5',
                                                    border: isSelected ? '1px solid #0B7C91' : 'none',
                                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                                    fontSize: 11,
                                                    fontWeight: isSelected ? 600 : 400,
                                                    cursor: isFree ? 'pointer' : 'default',
                                                }}
                                            >
                                                {d}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 11,
                                    color: '#8C96A5',
                                    margin: '12px 0 0 0',
                                    lineHeight: 1.35,
                                }}>
                                    Synced from calendar. Weekends are off by default, not unavailable.
                                </p>
                            </div>

                            {/* SCOUT Box */}
                            <div style={{
                                background: '#F0F9FB',
                                border: '1px solid #D4EFF6',
                                borderRadius: 16,
                                padding: 20,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                    <span style={{
                                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                        fontSize: 11,
                                        fontWeight: 600,
                                        letterSpacing: '0.08em',
                                        color: '#0B7C91',
                                        textTransform: 'uppercase',
                                    }}>
                                        SCOUT · {item.scoutScore || 91} FOR YOUR PROJECT
                                    </span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: '#10151D', lineHeight: 1.4 }}>
                                    <div>
                                        <strong style={{ color: '#0B7C91' }}>Style fit 28/30</strong> — nine verified interview cuts with the same two-camera rhythm.
                                    </div>
                                    <div>
                                        <strong style={{ color: '#0B7C91' }}>Reliability 15/15</strong> — 38 jobs, nothing late, no dispute.
                                    </div>
                                    <div>
                                        <strong style={{ color: '#0B7C91' }}>Availability 13/15</strong> — free on your date, 8.1 km away.
                                    </div>
                                    <div style={{ color: '#A35A00' }}>
                                        <strong>Risk</strong> — €528 all in sits above the €450 you usually spend on a half-day.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
