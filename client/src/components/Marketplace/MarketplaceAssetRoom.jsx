/**
 * client/src/components/Marketplace/MarketplaceAssetRoom.jsx
 *
 * Board 22: Asset Room & Handover
 * Secure delivery pipeline directly bridging to VIBED Editor:
 * - 5-stage pipeline stepper (Capture, Ingest, Review, Handover, Archive)
 * - Category filter tabs (Rushes, Selects, Deliverables, Documents, Project)
 * - File table with watermarked preview states
 * - Role permission matrix (Before vs After release)
 * - "Open in VIBED" direct project ingest button
 * - Download receipts and outward sharing controls
 *
 * Strictly zero emojis. Plus Jakarta Sans typography.
 */

import React, { useState } from 'react';
import {
    Play, Download, Upload, FileText, CheckCircle2, ShieldCheck,
    Lock, Unlock, Film, ArrowRight, Eye, RefreshCw, AlertCircle, X
} from 'lucide-react';
import useMarketplaceStore from '../../store/useMarketplaceStore.js';

export default function MarketplaceAssetRoom() {
    const {
        assetRoom,
        ingestRushesToVibed,
        setActiveTab,
    } = useMarketplaceStore();

    const [activeCat, setActiveCat] = useState('all');
    const [previewingFile, setPreviewingFile] = useState(null);
    const [ingestSuccess, setIngestSuccess] = useState(false);
    const [releaseUnlocked, setReleaseUnlocked] = useState(false);

    const filteredFiles = assetRoom.files.filter(f => {
        if (activeCat === 'all') return true;
        return f.category === activeCat;
    });

    const handleIngest = () => {
        ingestRushesToVibed();
        setIngestSuccess(true);
        setTimeout(() => setIngestSuccess(false), 4000);
    };

    return (
        <div style={{ padding: '24px 0 64px 0', maxWidth: 1240, margin: '0 auto' }}>
            {/* Ingest Notification Toast */}
            {ingestSuccess && (
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
                        <div style={{ fontWeight: 600, fontSize: 13 }}>Rushes Ingested into VIBED</div>
                        <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.7)' }}>
                            Active project updated with linked master footage
                        </div>
                    </div>
                </div>
            )}

            {/* Top Header */}
            <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: 24,
            }}>
                <div>
                    <span style={{
                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        fontSize: 11,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'rgba(26, 28, 34, 0.5)',
                    }}>
                        22 · FILES, END TO END
                    </span>
                    <h1 style={{
                        margin: '4px 0 6px 0',
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 32,
                        fontWeight: 800,
                        letterSpacing: '-0.025em',
                        color: '#1A1C22',
                    }}>
                        {assetRoom.bookingTitle}
                    </h1>
                    <div style={{ fontSize: 13, color: 'rgba(26, 28, 34, 0.65)' }}>
                        {assetRoom.subtitle}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                        background: '#FAF9F6',
                        border: '1px solid rgba(26, 28, 34, 0.12)',
                        color: '#B45309',
                        padding: '6px 12px',
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 600,
                    }}>
                        {releaseUnlocked ? 'Originals unlocked' : 'Originals locked until release'}
                    </span>
                    <button
                        onClick={handleIngest}
                        style={{
                            background: '#0B7C91',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: 8,
                            padding: '9px 18px',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(11, 124, 145, 0.25)',
                        }}
                    >
                        Open project in VIBED
                    </button>
                </div>
            </div>

            {/* 5-Step Pipeline Stepper */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 12,
                marginBottom: 32,
            }}>
                {assetRoom.stepper.map((st, idx) => {
                    const isNow = st.state === 'now';
                    const isDone = st.state === 'done';
                    return (
                        <div
                            key={idx}
                            style={{
                                background: '#FFFFFF',
                                border: isNow ? '1.5px solid #0B7C91' : '1px solid rgba(26, 28, 34, 0.08)',
                                borderRadius: 14,
                                padding: '14px 16px',
                                boxShadow: isNow ? '0 4px 12px rgba(11, 124, 145, 0.12)' : '0 2px 6px rgba(26, 28, 34, 0.04)',
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
                                    color: 'rgba(26, 28, 34, 0.5)',
                                }}>
                                    {st.step}
                                </span>
                                <span style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 9.5,
                                    fontWeight: 700,
                                    letterSpacing: '0.08em',
                                    color: isDone ? '#059669' : isNow ? '#0B7C91' : 'rgba(26, 28, 34, 0.4)',
                                    textTransform: 'uppercase',
                                }}>
                                    {st.state}
                                </span>
                            </div>

                            <div style={{
                                fontFamily: 'var(--f-sans, "Plus Jakarta Sans", sans-serif)',
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: '#1A1C22',
                                marginBottom: 4,
                            }}>
                                {st.title}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.55)', lineHeight: 1.35 }}>
                                {st.subtitle}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Main Content Layout (Explorer on Left, Permissions & Handover on Right) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}>
                {/* Left Column: Categories + File Explorer */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Categories Pills */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 14,
                        padding: '8px 14px',
                    }}>
                        {[
                            { id: 'all', label: 'All files', count: 69 },
                            { id: 'rushes', label: '01 Rushes', count: 61 },
                            { id: 'selects', label: '02 Selects', count: 14 },
                            { id: 'deliverables', label: '03 Deliverables', count: 3 },
                            { id: 'documents', label: '04 Documents', count: 4 },
                        ].map(cat => {
                            const isSel = activeCat === cat.id;
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveCat(cat.id)}
                                    style={{
                                        background: isSel ? '#0B7C91' : 'none',
                                        color: isSel ? '#FFFFFF' : '#1A1C22',
                                        border: 'none',
                                        borderRadius: 8,
                                        padding: '6px 12px',
                                        fontSize: 12.5,
                                        fontWeight: isSel ? 700 : 500,
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {cat.label} ({cat.count})
                                </button>
                            );
                        })}
                    </div>

                    {/* Files Table Card */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        overflow: 'hidden',
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '2.5fr 1fr 1fr 1.2fr 60px',
                            padding: '12px 20px',
                            background: '#FAF9F6',
                            borderBottom: '1px solid rgba(26, 28, 34, 0.06)',
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            color: 'rgba(26, 28, 34, 0.5)',
                        }}>
                            <div>FILE</div>
                            <div>SIZE</div>
                            <div>FROM</div>
                            <div>STATE</div>
                            <div style={{ textAlign: 'center' }}>GET</div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {filteredFiles.map((file, idx) => {
                                const isLast = idx === filteredFiles.length - 1;
                                return (
                                    <div
                                        key={file.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '2.5fr 1fr 1fr 1.2fr 60px',
                                            alignItems: 'center',
                                            padding: '14px 20px',
                                            borderBottom: isLast ? 'none' : '1px solid rgba(26, 28, 34, 0.06)',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.background = '#FAF9F6'}
                                        onMouseLeave={e => e.currentTarget.style.background = '#FFFFFF'}
                                    >
                                        <div>
                                            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#1A1C22', marginBottom: 2 }}>
                                                {file.name}
                                            </div>
                                            <div style={{ fontSize: 11.5, color: 'rgba(26, 28, 34, 0.55)' }}>
                                                {file.meta}
                                            </div>
                                        </div>

                                        <div style={{
                                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                            fontSize: 12,
                                            color: '#1A1C22',
                                        }}>
                                            {file.size}
                                        </div>

                                        <div style={{ fontSize: 12.5, color: 'rgba(26, 28, 34, 0.65)' }}>
                                            {file.from}
                                        </div>

                                        <div>
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '3px 10px',
                                                borderRadius: 999,
                                                fontSize: 11,
                                                fontWeight: 600,
                                                background:
                                                    file.stateType === 'watermarked' ? 'rgba(180, 83, 9, 0.10)' :
                                                    file.stateType === 'uploading' ? 'rgba(11, 124, 145, 0.10)' :
                                                    'rgba(16, 185, 129, 0.12)',
                                                color:
                                                    file.stateType === 'watermarked' ? '#B45309' :
                                                    file.stateType === 'uploading' ? '#0B7C91' :
                                                    '#059669',
                                            }}>
                                                {file.state}
                                            </span>
                                        </div>

                                        <div style={{ textAlign: 'center' }}>
                                            {file.previewUrl ? (
                                                <button
                                                    onClick={() => setPreviewingFile(file)}
                                                    style={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: '50%',
                                                        background: '#FAF9F6',
                                                        border: '1px solid rgba(26, 28, 34, 0.14)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        cursor: 'pointer',
                                                        color: '#1A1C22',
                                                    }}
                                                >
                                                    <Play size={12} />
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => alert(`Downloading ${file.name}`)}
                                                    style={{
                                                        width: 28,
                                                        height: 28,
                                                        borderRadius: '50%',
                                                        background: '#FAF9F6',
                                                        border: '1px solid rgba(26, 28, 34, 0.14)',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        cursor: 'pointer',
                                                        color: '#1A1C22',
                                                    }}
                                                >
                                                    <Download size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Drag and Drop Card Upload Area */}
                    <div style={{
                        background: '#FAF9F6',
                        border: '1.5px dashed rgba(26, 28, 34, 0.16)',
                        borderRadius: 16,
                        padding: '24px 28px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 20,
                    }}>
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#1A1C22', marginBottom: 4 }}>
                                Drop files, or upload a whole card
                            </div>
                            <p style={{ margin: 0, fontSize: 12, color: 'rgba(26, 28, 34, 0.6)', lineHeight: 1.45, maxWidth: 480 }}>
                                Resumable in 8 MB parts, checksum verified, carries on if the browser closes. Proxies appear in about a minute; the original can still be climbing.
                            </p>
                        </div>

                        <button
                            onClick={() => alert('File picker initialized.')}
                            style={{
                                background: '#FFFFFF',
                                border: '1px solid rgba(26, 28, 34, 0.16)',
                                borderRadius: 8,
                                padding: '9px 18px',
                                fontSize: 13,
                                fontWeight: 600,
                                color: '#1A1C22',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Choose files
                        </button>
                    </div>

                    {/* Download Receipts */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 20,
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 14,
                        }}>
                            <span style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                color: 'rgba(26, 28, 34, 0.5)',
                            }}>
                                DOWNLOAD RECEIPTS
                            </span>
                            <span style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.45)' }}>
                                Visible to both sides
                            </span>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                            {assetRoom.receipts.map((rc, rIdx) => (
                                <div key={rIdx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                                    <span style={{ color: '#1A1C22' }}>{rc.title}</span>
                                    <span style={{ color: 'rgba(26, 28, 34, 0.45)' }}>{rc.time}</span>
                                </div>
                            ))}
                        </div>

                        <div style={{ fontSize: 11, color: 'rgba(26, 28, 34, 0.5)', lineHeight: 1.45 }}>
                            Who took what, and when. It settles the "I never got the files" argument before it becomes a dispute.
                        </div>
                    </div>
                </div>

                {/* Right Column: Permission Matrix + Handover Policy + Outward Sharing */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* WHO CAN DO WHAT Matrix */}
                    <div style={{
                        background: '#FFFFFF',
                        border: '1px solid rgba(26, 28, 34, 0.08)',
                        borderRadius: 16,
                        padding: 18,
                        boxShadow: '0 2px 10px rgba(26, 28, 34, 0.04)',
                    }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 12,
                        }}>
                            <span style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 10,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                color: 'rgba(26, 28, 34, 0.5)',
                            }}>
                                WHO CAN DO WHAT
                            </span>
                            <div style={{ display: 'flex', gap: 6, fontSize: 10 }}>
                                <span style={{
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: !releaseUnlocked ? 'rgba(11, 124, 145, 0.12)' : 'none',
                                    color: !releaseUnlocked ? '#0B7C91' : 'rgba(26, 28, 34, 0.5)',
                                    fontWeight: 700,
                                }}>
                                    Before release
                                </span>
                                <span style={{
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    background: releaseUnlocked ? 'rgba(11, 124, 145, 0.12)' : 'none',
                                    color: releaseUnlocked ? '#0B7C91' : 'rgba(26, 28, 34, 0.5)',
                                    fontWeight: 700,
                                }}>
                                    After
                                </span>
                            </div>
                        </div>

                        {/* Permission Table */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
                            fontSize: 11,
                            paddingBottom: 6,
                            borderBottom: '1px solid rgba(26, 28, 34, 0.06)',
                            color: 'rgba(26, 28, 34, 0.5)',
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                        }}>
                            <div>ROLE</div>
                            <div>VIEW</div>
                            <div>PROXY</div>
                            <div>ORIGINAL</div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, fontSize: 12 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr' }}>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>Buyer</span>
                                <span style={{ color: '#059669' }}>yes</span>
                                <span style={{ color: '#059669' }}>yes</span>
                                <span style={{ color: releaseUnlocked ? '#059669' : '#DC2626' }}>
                                    {releaseUnlocked ? 'yes' : 'no'}
                                </span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr' }}>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>Talent</span>
                                <span style={{ color: '#059669' }}>yes</span>
                                <span style={{ color: '#059669' }}>yes</span>
                                <span style={{ color: '#059669' }}>yes</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr' }}>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>Studio host</span>
                                <span style={{ color: 'rgba(26, 28, 34, 0.4)' }}>no</span>
                                <span style={{ color: 'rgba(26, 28, 34, 0.4)' }}>no</span>
                                <span style={{ color: 'rgba(26, 28, 34, 0.4)' }}>no</span>
                            </div>
                        </div>

                        <p style={{ margin: '14px 0 0 0', fontSize: 11, color: 'rgba(26, 28, 34, 0.6)', lineHeight: 1.45 }}>
                            On release the buyer row turns to yes across the board and watermarks drop. That gate is what makes escrow mean something.
                        </p>
                    </div>

                    {/* HANDOVER, ON RELEASE */}
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
                            color: '#0B7C91',
                            marginBottom: 8,
                        }}>
                            HANDOVER, ON RELEASE
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(26, 28, 34, 0.7)', lineHeight: 1.45 }}>
                            <div>Originals unlock and a ZIP manifest is generated with checksums.</div>
                            <div>The VIBED project transfers to your workspace, editable with rushes linked.</div>
                            <div>The licence PDF issues and rights window starts.</div>
                        </div>

                        <button
                            onClick={() => setReleaseUnlocked(!releaseUnlocked)}
                            style={{
                                width: '100%',
                                marginTop: 14,
                                background: '#FAF9F6',
                                border: '1px solid rgba(26, 28, 34, 0.16)',
                                borderRadius: 8,
                                padding: '8px 0',
                                fontSize: 12.5,
                                fontWeight: 600,
                                color: '#1A1C22',
                                cursor: 'pointer',
                            }}
                        >
                            {releaseUnlocked ? 'Lock originals' : 'Simulate Release & Handover'}
                        </button>
                    </div>

                    {/* SHARING OUTWARD */}
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
                            color: 'rgba(26, 28, 34, 0.5)',
                            marginBottom: 10,
                        }}>
                            SHARING OUTWARD
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.6)' }}>Link expiry</span>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>7 days</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.6)' }}>Password</span>
                                <span style={{ fontWeight: 600, color: '#059669' }}>on</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: 'rgba(26, 28, 34, 0.6)' }}>Downloads allowed</span>
                                <span style={{ fontWeight: 600, color: '#1A1C22' }}>proxy only</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Video Preview Modal */}
            {previewingFile && (
                <div
                    onClick={() => setPreviewingFile(null)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 9999,
                        background: 'rgba(0, 0, 0, 0.85)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 24,
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: '#1A1C22',
                            borderRadius: 16,
                            overflow: 'hidden',
                            maxWidth: 720,
                            width: '100%',
                            boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '14px 20px',
                            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#FFFFFF',
                        }}>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{previewingFile.name}</div>
                            <button
                                onClick={() => setPreviewingFile(null)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'rgba(255, 255, 255, 0.6)',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: 4,
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div style={{ position: 'relative', background: '#000000', aspectRatio: '16/9' }}>
                            <video
                                src={previewingFile.previewUrl}
                                controls
                                autoPlay
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                            {!releaseUnlocked && (
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    pointerEvents: 'none',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    opacity: 0.25,
                                    transform: 'rotate(-20deg)',
                                    fontSize: 48,
                                    fontWeight: 900,
                                    color: '#FFFFFF',
                                    letterSpacing: '0.1em',
                                    textTransform: 'uppercase',
                                    userSelect: 'none',
                                }}>
                                    WATERMARKED PROXY
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
