import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ShieldCheck, Mail, Database, UserCheck, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const Logo = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z"
            fill="none" stroke="currentColor" strokeWidth="32"
            strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268"
            stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
    </svg>
);

const Section = ({ title, children }) => (
    <div style={{ paddingBottom: 40, borderBottom: '0.5px solid var(--line-soft)' }}>
        <h2 style={{
            fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700,
            color: 'var(--fg)', marginBottom: 14, lineHeight: 1.3,
        }}>{title}</h2>
        <div style={{
            fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-2)',
            lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            {children}
        </div>
    </div>
);

const GdprPage = () => {
    const navigate = useNavigate();

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>
            <nav style={{
                position: 'sticky', top: 0, zIndex: 40,
                borderBottom: '0.5px solid var(--line-soft)',
                background: 'var(--glass)', backdropFilter: 'blur(20px) saturate(160%)',
                WebkitBackdropFilter: 'blur(20px) saturate(160%)',
            }}>
                <div style={{
                    maxWidth: 720, margin: '0 auto', padding: '0 24px',
                    height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <button
                        onClick={() => navigate('/')}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg-3)',
                            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                    >
                        <ArrowLeft size={14} /> Back to Vibed
                    </button>
                    <Logo size={22} />
                </div>
            </nav>

            <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px 96px' }}>
                <div style={{ marginBottom: 56 }}>
                    <div style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)',
                        textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16,
                    }}>Compliance</div>
                    <h1 style={{
                        fontFamily: 'var(--f-display)', fontSize: 'clamp(32px, 5vw, 48px)',
                        fontWeight: 800, lineHeight: 1.15, color: 'var(--fg)', marginBottom: 20,
                    }}>
                        GDPR & EU Rights
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560,
                    }}>
                        VIBED respects your privacy and complies strictly with the General Data Protection Regulation (GDPR). Here is how you can exercise your EU data rights.
                    </p>
                </div>

                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16,
                    marginBottom: 56
                }}>
                    {[
                        { title: 'Data Controller', value: 'Vibed SAS', detail: 'Determines the purposes of processing' },
                        { title: 'Data Processor', value: 'Google Cloud Storage', detail: 'Provides secure hosting infrastructure' },
                        { title: 'Data Location', value: 'us-central1', detail: 'With valid transfer mechanisms (SCCs)' },
                    ].map(card => (
                        <div key={card.title} style={{
                            padding: 20, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)',
                            borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 6
                        }}>
                            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase' }}>{card.title}</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{card.value}</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg-3)' }}>{card.detail}</div>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                    <Section title="Your Rights Under GDPR">
                        <p>Under the General Data Protection Regulation (GDPR), you possess specific fundamental rights regarding your personal data:</p>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
                            <div style={{ display: 'flex', gap: 14 }}>
                                <Database className="w-5 h-5 text-accent mt-1 flex-shrink-0" />
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)' }}>Right to Access</div>
                                    <div style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.6 }}>You can request a complete copy of the personal data we hold about you.</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 14 }}>
                                <Trash2 className="w-5 h-5 text-accent mt-1 flex-shrink-0" />
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)' }}>Right to Erasure (Right to be Forgotten)</div>
                                    <div style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.6 }}>You can ask us to delete all your personal data, project files, and account information permanently.</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 14 }}>
                                <UserCheck className="w-5 h-5 text-accent mt-1 flex-shrink-0" />
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)' }}>Right to Rectification</div>
                                    <div style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.6 }}>You have the right to request that we correct any inaccurate or incomplete personal data.</div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 14 }}>
                                <ShieldCheck className="w-5 h-5 text-accent mt-1 flex-shrink-0" />
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)' }}>Right to Object & Restrict Processing</div>
                                    <div style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.6 }}>You can object to our processing of your data, including processing for direct marketing or analytics.</div>
                                </div>
                            </div>
                        </div>
                    </Section>

                    <Section title="How to Exercise Your Rights">
                        <p>To exercise any of these rights, simply email us from the address associated with your VIBED account. We process all Data Subject Access Requests (DSARs) within 30 days, entirely free of charge.</p>
                        <div style={{
                            marginTop: 16, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                            border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                            borderRadius: 12, textAlign: 'center'
                        }}>
                            <p style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)', marginBottom: 8, fontWeight: 500 }}>
                                Submit a GDPR Data Request
                            </p>
                            <a href="mailto:mariojaris2@gmail.com" style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>
                                mariojaris2@gmail.com
                            </a>
                        </div>
                    </Section>
                </div>
            </main>
        </div>
    );
};

export default GdprPage;
