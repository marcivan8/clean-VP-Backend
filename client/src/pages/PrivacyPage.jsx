import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Scale, Mail, FileText, Database, Settings } from 'lucide-react';

const Logo = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z"
            fill="none" stroke="currentColor" strokeWidth="32"
            strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268"
            stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
    </svg>
);

const Section = ({ title, icon: Icon, children }) => (
    <div style={{ paddingBottom: 40, borderBottom: '0.5px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            {Icon && <Icon className="w-6 h-6 text-accent" />}
            <h2 style={{
                fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700,
                color: 'var(--fg)', lineHeight: 1.3, margin: 0
            }}>{title}</h2>
        </div>
        <div style={{
            fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-2)',
            lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            {children}
        </div>
    </div>
);

const PrivacyPage = () => {
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
                    }}>Legal Document</div>
                    <h1 style={{
                        fontFamily: 'var(--f-display)', fontSize: 'clamp(32px, 5vw, 48px)',
                        fontWeight: 800, lineHeight: 1.15, color: 'var(--fg)', marginBottom: 20,
                    }}>
                        Privacy Policy
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560,
                    }}>
                        Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
                    
                    <Section title="1. Identity of the Data Controller" icon={Scale}>
                        <p>
                            For the purposes of the General Data Protection Regulation (GDPR) and other applicable data protection laws, the Data Controller responsible for your personal information is:
                        </p>
                        <div style={{
                            padding: 20, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)',
                            borderRadius: 12, marginTop: 8
                        }}>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>VIBED (Vibed studio)</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                47 avenue du President Franklin Roosevelt<br/>
                                94320, THIAIS<br/>
                                France
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--accent)', marginTop: 8 }}>
                                <a href="mailto:marc@vibedstudio.com" style={{ color: 'inherit', textDecoration: 'none' }}>marc@vibedstudio.com</a>
                            </div>
                        </div>
                    </Section>

                    <Section title="2. Legal Basis for Processing" icon={FileText}>
                        <p>
                            We only process your personal data when we have a valid legal basis to do so. Our primary legal bases are:
                        </p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <li>
                                <strong style={{ color: 'var(--fg)' }}>Contractual Necessity:</strong> We process your email, authentication credentials, and video files to provide you with the Vibed editing service, manage your account, and process payments. Without this processing, we cannot provide our core service.
                            </li>
                            <li>
                                <strong style={{ color: 'var(--fg)' }}>Legitimate Interest:</strong> We process basic usage analytics (e.g., which features are used) to improve our product, ensure the security of our platform, and troubleshoot issues. This processing does not override your fundamental rights and freedoms.
                            </li>
                            <li>
                                <strong style={{ color: 'var(--fg)' }}>Consent:</strong> Where required by law, we will obtain your explicit consent before processing data for certain marketing activities or deploying non-essential cookies.
                            </li>
                        </ul>
                    </Section>

                    <Section title="3. Data Retention and Storage" icon={Database}>
                        <p>
                            We retain your personal data only for as long as necessary to fulfill the purposes outlined in this policy.
                        </p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <li><strong>Account Data:</strong> Retained for as long as your account is active. If you delete your account, this data is immediately and permanently removed.</li>
                            <li><strong>Project Files (Free Tier):</strong> Automatically deleted after 7 days of inactivity.</li>
                            <li><strong>Project Files (Creator Tier):</strong> Retained for 30 days.</li>
                            <li><strong>Project Files (Pro Tier):</strong> Retained for 90 days and persist as long as your subscription remains active.</li>
                        </ul>
                        <p style={{ marginTop: 8 }}>
                            Your data is stored securely using Google Cloud Storage (our Data Processor) in encrypted data centers.
                        </p>
                    </Section>

                    <Section title="4. Your Rights as a Data Subject" icon={Settings}>
                        <p>
                            Under the GDPR, you possess specific rights regarding your personal data:
                        </p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <li><strong style={{ color: 'var(--fg)' }}>Right to Access:</strong> You can request a copy of the personal data we hold about you.</li>
                            <li><strong style={{ color: 'var(--fg)' }}>Right to Erasure (Deletion):</strong> You can request that we delete all your personal data, project files, and account information permanently. You can also self-serve this directly from your account dashboard.</li>
                            <li><strong style={{ color: 'var(--fg)' }}>Right to Data Portability:</strong> You can request your data in a structured, commonly used, and machine-readable format. You may also export your video projects directly from the editor at any time.</li>
                            <li><strong style={{ color: 'var(--fg)' }}>Right to Rectification:</strong> You can ask us to correct inaccurate or incomplete data.</li>
                            <li><strong style={{ color: 'var(--fg)' }}>Right to Object / Restrict:</strong> You may object to or request the restriction of our processing of your data, particularly regarding analytics or direct marketing.</li>
                        </ul>
                        <p style={{ marginTop: 12 }}>
                            To exercise any of these rights, please contact us at the email address provided below. We process all requests within 30 days, free of charge.
                        </p>
                    </Section>

                    <div style={{
                        marginTop: 16, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                        borderRadius: 12, textAlign: 'center'
                    }}>
                        <p style={{
                            fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)',
                            marginBottom: 8, fontWeight: 500,
                        }}>
                            To exercise your data rights, contact us at:
                        </p>
                        <a
                            href="mailto:marc@vibedstudio.com"
                            style={{
                                fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none'
                            }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                            marc@vibedstudio.com
                        </a>
                    </div>

                </div>
            </main>
        </div>
    );
};

export default PrivacyPage;
