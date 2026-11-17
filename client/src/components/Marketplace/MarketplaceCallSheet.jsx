/**
 * client/src/components/Marketplace/MarketplaceCallSheet.jsx
 *
 * Board 07: Call Sheet
 * Complete production-day run of show:
 * - Day schedule timeline with active beats
 * - Shot list synced from project (interactive checks + add item)
 * - Who is on it (direct thread links)
 * - Kit & responsibilities matrix
 * - Location, live door codes, and directions
 * - Signed legal documents
 * - Date change protocol
 *
 * Strictly zero emojis. Plus Jakarta Sans typography.
 */

import React, { useState } from 'react';
import {
    Calendar, Clock, MapPin, CheckCircle2, ShieldCheck,
    FileText, MessageSquare, Plus, Check, ArrowRight, Share2, ExternalLink
} from 'lucide-react';
import useMarketplaceStore from '../../store/useMarketplaceStore.js';

export default function MarketplaceCallSheet() {
    const {
        callSheet,
        toggleShotItem,
        addShotItem,
        setActiveTab,
        setActiveThreadId,
        ingestRushesToVibed,
    } = useMarketplaceStore();

    const [newShotText, setNewShotText] = useState('');
    const [calendarAdded, setCalendarAdded] = useState(false);
    const [shareCopied, setShareCopied] = useState(false);
    const [rescheduleModal, setRescheduleModal] = useState(false);
    const [ingestNotice, setIngestNotice] = useState(false);

    const handleAddShot = (e) => {
        e.preventDefault();
        if (newShotText.trim()) {
            addShotItem(newShotText);
            setNewShotText('');
        }
    };

    const handleMessageCrew = (threadId) => {
        if (threadId) {
            setActiveThreadId(threadId);
            setActiveTab('messages');
        }
    };

    const handleShare = () => {
        navigator.clipboard?.writeText(window.location.href);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
    };

    const handleAddToCal = () => {
        setCalendarAdded(true);
        setTimeout(() => setCalendarAdded(false), 3000);
    };

    const handleOpenVibedProject = () => {
        ingestRushesToVibed();
        setIngestNotice(true);
        setTimeout(() => setIngestNotice(false), 4000);
    };

    return (
        <div style={{ padding: '24px 0 64px 0', maxWidth: 1240, margin: '0 auto' }}>
            {/* Ingest Notification Toast */}
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
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Project Linked</div>
                        <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.7)' }}>
                            Ingest complete: rushes ready in VIBED Editor
                        </div>
                    </div>
                </div>
            )}

            {/* Header badges & Title */}
            <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <span style={{
                        background: 'rgba(11, 124, 145, 0.12)',
                        color: '#0B7C91',
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                    }}>
                        {callSheet.status}
                    </span>
                    <span style={{
                        background: 'rgba(11, 124, 145, 0.12)',
                        color: '#0B7C91',
                        padding: '4px 10px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                    }}>
                        {callSheet.heldAmount}
                    </span>
                    {callSheet.releaseSigned && (
                        <span style={{
                            background: '#FAF9F6',
                            border: '1px solid rgba(26, 28, 34, 0.12)',
                            color: 'rgba(26, 28, 34, 0.7)',
                            padding: '4px 10px',
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 500,
                        }}>
                            Release form signed
                        </span>
                    )}
                </div>

                <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 24,
                }}>
                    <div>
                        <h1 style={{
                            margin: '0 0 6px 0',
                            fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                            fontSize: 34,
                            fontWeight: 800,
                            letterSpacing: '-0.025em',
                            color: '#1A1C22',
                        }}>
                            {callSheet.title}
                        </h1>
                        <p style={{ margin: 0, fontSize: 14, color: 'rgba(26, 28, 34, 0.65)' }}>
                            {callSheet.dateStr} · {callSheet.callStr}
                        </p>
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
                        <button
                            onClick={handleAddToCal}
                            style={{
                                background: '#FFFFFF',
                                border: '1px solid rgba(26, 28, 34, 0.14)',
                                borderRadius: 8,
                                padding: '9px 16px',
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#1A1C22',
                                cursor: 'pointer',
                            }}
                        >
                            {calendarAdded ? 'Added to iCal' : 'Add to calendar'}
                        </button>
                        <button
                            onClick={handleShare}
                            style={{
                                background: '#FFFFFF',
                                border: '1px solid rgba(26, 28, 34, 0.14)',
                                borderRadius: 8,
                                padding: '9px 16px',
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#1A1C22',
                                cursor: 'pointer',
                            }}
                        >
                            {shareCopied ? 'Link copied' : 'Share call sheet'}
                        </button>
                        <button
                            onClick={handleOpenVibedProject}
                            style={{
                                background: '#0B7C91',
                                border: 'none',
                                borderRadius: 8,
                                padding: '9px 18px',
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#FFFFFF',
                                cursor: 'pointer',
                                boxShadow: '0 2px 8px rgba(11, 124, 145, 0.25)',
                            }}
                        >
                            Open project in VIBED
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Grid: Schedule and lists on left, location/docs on right */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
                {/* Left Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    {/* THE DAY Schedule */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 24,
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                            marginBottom: 20,
                        }}>
                            THE DAY
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                            {callSheet.schedule.map((item, idx) => {
                                const isLast = idx === callSheet.schedule.length - 1;
                                return (
                                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '70px 24px 1fr', alignItems: 'flex-start', gap: 12 }}>
                                        <div style={{
                                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                            fontSize: 12.5,
                                            fontWeight: 600,
                                            color: '#1A1C22',
                                            paddingTop: 1,
                                        }}>
                                            {item.time}
                                        </div>

                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 5 }}>
                                            <div style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                background: item.active ? '#0B7C91' : '#CBD5E1',
                                                boxShadow: item.active ? '0 0 8px rgba(11, 124, 145, 0.6)' : 'none',
                                            }} />
                                            {!isLast && (
                                                <div style={{ width: 1, height: 38, background: 'rgba(26, 28, 34, 0.1)', marginTop: 4 }} />
                                            )}
                                        </div>

                                        <div>
                                            <div style={{
                                                fontFamily: 'var(--f-sans, "Plus Jakarta Sans", sans-serif)',
                                                fontSize: 13.5,
                                                fontWeight: 700,
                                                color: '#1A1C22',
                                                marginBottom: 2,
                                            }}>
                                                {item.title}
                                            </div>
                                            <div style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.6)', lineHeight: 1.4 }}>
                                                {item.subtitle}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Split Card: Shot List + Who is on it */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>
                        {/* SHOT LIST */}
                        <div style={{
                            background: '#FFFFFF',
                            border: '1px solid rgba(26, 28, 34, 0.08)',
                            borderRadius: 16,
                            padding: 20,
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
                                SHOT LIST · FROM THE PROJECT
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                                {callSheet.shotList.map((shot, sIdx) => (
                                    <div
                                        key={shot.id}
                                        onClick={() => toggleShotItem(shot.id)}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: 10,
                                            cursor: 'pointer',
                                            padding: '4px 0',
                                        }}
                                    >
                                        <span style={{
                                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                            fontSize: 11,
                                            color: '#0B7C91',
                                            fontWeight: 600,
                                            paddingTop: 1,
                                        }}>
                                            {String(sIdx + 1).padStart(2, '0')}
                                        </span>
                                        <span style={{
                                            fontSize: 13,
                                            color: shot.done ? 'rgba(26, 28, 34, 0.4)' : '#1A1C22',
                                            textDecoration: shot.done ? 'line-through' : 'none',
                                            flex: 1,
                                            lineHeight: 1.4,
                                        }}>
                                            {shot.text}
                                        </span>
                                        <div style={{
                                            width: 16,
                                            height: 16,
                                            borderRadius: 4,
                                            border: shot.done ? '1px solid #0B7C91' : '1px solid rgba(26, 28, 34, 0.2)',
                                            background: shot.done ? '#0B7C91' : '#FFFFFF',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexShrink: 0,
                                            marginTop: 2,
                                        }}>
                                            {shot.done && <Check size={11} color="#FFFFFF" />}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <form onSubmit={handleAddShot} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                <input
                                    type="text"
                                    value={newShotText}
                                    onChange={e => setNewShotText(e.target.value)}
                                    placeholder="Add required shot..."
                                    style={{
                                        flex: 1,
                                        background: '#FAF9F6',
                                        border: '1px solid rgba(26, 28, 34, 0.12)',
                                        borderRadius: 6,
                                        padding: '6px 10px',
                                        fontSize: 12,
                                        color: '#1A1C22',
                                        outline: 'none',
                                    }}
                                />
                                <button
                                    type="submit"
                                    style={{
                                        background: '#0B7C91',
                                        border: 'none',
                                        borderRadius: 6,
                                        padding: '0 10px',
                                        color: '#FFFFFF',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <Plus size={14} />
                                </button>
                            </form>

                            <div style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.45)' }}>
                                Editable by both sides until the call
                            </div>
                        </div>

                        {/* WHO IS ON IT */}
                        <div style={{
                            background: '#FFFFFF',
                            border: '1px solid rgba(26, 28, 34, 0.08)',
                            borderRadius: 16,
                            padding: 20,
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
                                WHO IS ON IT
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                {callSheet.crew.map((member, mIdx) => (
                                    <div key={mIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                            <div style={{
                                                width: 32,
                                                height: 32,
                                                borderRadius: '50%',
                                                background: member.bg,
                                                color: '#FFFFFF',
                                                fontSize: 11,
                                                fontWeight: 700,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                {member.initials}
                                            </div>
                                            <div>
                                                <div style={{ fontSize: 13, fontWeight: 700, color: '#1A1C22' }}>
                                                    {member.name}
                                                </div>
                                                <div style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.55)' }}>
                                                    {member.role}
                                                </div>
                                            </div>
                                        </div>

                                        {member.threadId && (
                                            <button
                                                onClick={() => handleMessageCrew(member.threadId)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    cursor: 'pointer',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: '#0B7C91',
                                                    padding: 0,
                                                }}
                                            >
                                                Message
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* KIT & RESPONSIBILITIES */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 20,
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
                            KIT & RESPONSIBILITIES
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                            <div>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1C22', marginBottom: 4 }}>
                                    {callSheet.responsibilities.talent.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.45 }}>
                                    {callSheet.responsibilities.talent.items}
                                </div>
                            </div>

                            <div>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1C22', marginBottom: 4 }}>
                                    {callSheet.responsibilities.studio.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.45 }}>
                                    {callSheet.responsibilities.studio.items}
                                </div>
                            </div>

                            <div>
                                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1A1C22', marginBottom: 4 }}>
                                    {callSheet.responsibilities.buyer.name}
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.45 }}>
                                    {callSheet.responsibilities.buyer.items}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Location, Docs, Changes */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Location Card */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        overflow: 'hidden',
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        {/* Radar Graphic */}
                        <div style={{
                            height: 120,
                            background: '#EAE7E1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                        }}>
                            <div style={{
                                width: 80,
                                height: 80,
                                borderRadius: '50%',
                                border: '1px dashed rgba(11, 124, 145, 0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}>
                                <div style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: '50%',
                                    background: '#0B7C91',
                                    boxShadow: '0 0 10px rgba(11, 124, 145, 0.8)',
                                }} />
                            </div>
                        </div>

                        <div style={{ padding: 18 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1C22', marginBottom: 4 }}>
                                {callSheet.location.address}
                            </div>
                            <div style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 11,
                                letterSpacing: '0.06em',
                                color: '#0B7C91',
                                fontWeight: 700,
                                marginBottom: 6,
                            }}>
                                {callSheet.location.doorCode} · {callSheet.location.floor}
                            </div>
                            <p style={{ margin: '0 0 14px 0', fontSize: 11.5, color: 'rgba(26, 28, 34, 0.6)', lineHeight: 1.4 }}>
                                {callSheet.location.details}
                            </p>

                            <button
                                onClick={() => window.open(`https://maps.google.com/?q=${encodeURIComponent(callSheet.location.address)}`, '_blank')}
                                style={{
                                    width: '100%',
                                    background: '#FAF9F6',
                                    border: '1px solid rgba(26, 28, 34, 0.12)',
                                    borderRadius: 8,
                                    padding: '8px 0',
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    color: '#1A1C22',
                                    cursor: 'pointer',
                                }}
                            >
                                Directions
                            </button>
                        </div>
                    </div>

                    {/* DOCUMENTS */}
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
                            DOCUMENTS
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {callSheet.documents.map((doc, dIdx) => (
                                <div key={dIdx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5 }}>
                                    <span style={{ color: '#1A1C22' }}>{doc.name}</span>
                                    <span style={{
                                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        color: doc.status === 'SIGNED' ? '#059669' : 'rgba(26, 28, 34, 0.45)',
                                    }}>
                                        {doc.status}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* CHANGES FROM HERE */}
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
                            CHANGES FROM HERE
                        </div>

                        <p style={{ margin: '0 0 14px 0', fontSize: 12, color: 'rgba(26, 28, 34, 0.65)', lineHeight: 1.45 }}>
                            Moving the date is free until 12 Nov and goes to Nour as a request, not a notification. After that it is a cancellation with a new booking.
                        </p>

                        <button
                            onClick={() => {
                                setActiveThreadId('thread-nour');
                                setActiveTab('messages');
                            }}
                            style={{
                                width: '100%',
                                background: '#FFFFFF',
                                border: '1px solid rgba(26, 28, 34, 0.16)',
                                borderRadius: 8,
                                padding: '8px 0',
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: '#1A1C22',
                                cursor: 'pointer',
                            }}
                        >
                            Propose a new date
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
