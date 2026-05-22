import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, HardDrive, Lock, Eye, Trash2, Mail, ShieldCheck } from 'lucide-react';

const Logo = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 500 500" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M310 110 L185 265 L250 245 L200 390 L325 230 L258 248 Z"
            fill="none" stroke="currentColor" strokeWidth="32"
            strokeLinejoin="round" strokeLinecap="round" />
        <line x1="248" y1="248" x2="195" y2="268"
            stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
    </svg>
);

const Section = ({ icon: Icon, label, title, children }) => (
    <div style={{ paddingBottom: 48, borderBottom: '0.5px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'color-mix(in oklch, var(--accent) 12%, transparent)',
                border: '0.5px solid color-mix(in oklch, var(--accent) 25%, transparent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
                <Icon size={14} style={{ color: 'var(--accent)' }} />
            </div>
            <span style={{
                fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)',
                textTransform: 'uppercase', letterSpacing: '0.12em',
            }}>{label}</span>
        </div>
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

const Callout = ({ children }) => (
    <div style={{
        background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
        border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
        borderRadius: 10, padding: '14px 18px',
        fontFamily: 'var(--f-sans)', fontSize: 13.5,
        color: 'var(--fg-2)', lineHeight: 1.7,
    }}>
        {children}
    </div>
);

const TechDetail = ({ label, value }) => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{
            fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)',
            textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0, minWidth: 120,
        }}>{label}</span>
        <span style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)' }}>{value}</span>
    </div>
);

const DataPage = () => {
    const navigate = useNavigate();

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)' }}>

            {/* Nav */}
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

            {/* Content */}
            <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px 96px' }}>

                {/* Header */}
                <div style={{ marginBottom: 56 }}>
                    <div style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)',
                        textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16,
                    }}>Your data</div>
                    <h1 style={{
                        fontFamily: 'var(--f-display)', fontSize: 'clamp(32px, 5vw, 48px)',
                        fontWeight: 800, lineHeight: 1.15, color: 'var(--fg)', marginBottom: 20,
                    }}>
                        Plain English.<br />No fine print.
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560,
                    }}>
                        Here is exactly what happens to your videos and projects when you use Vibed.
                        No vague promises — specific systems, specific timelines, specific rights.
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 48 }}>

                    {/* Storage */}
                    <Section icon={HardDrive} label="Storage" title="Where your files live">
                        <p>
                            When you upload a video, it goes to <strong style={{ color: 'var(--fg)' }}>Google Cloud Storage</strong> — the same
                            infrastructure used by YouTube, Spotify, and most major software companies.
                            Your files are stored in the <strong style={{ color: 'var(--fg)' }}>us-central1</strong> region (Iowa).
                        </p>
                        <p>
                            We also create a lightweight proxy version of your video — a smaller copy
                            optimised for fast playback in the editor. Both your original file and
                            the proxy live in GCS, in a private bucket only your account can access.
                        </p>
                        <Callout>
                            <strong>Where exactly:</strong> Google Cloud Storage, bucket{' '}
                            <code style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--accent)' }}>
                                vibed-uploads
                            </code>{' '}
                            / us-central1. Your files are stored under a path that includes your
                            user or session ID — no other user's code can reach them.
                        </Callout>
                    </Section>

                    {/* Encryption */}
                    <Section icon={Lock} label="Encryption" title="How your files are protected">
                        <p>
                            Your files are protected in two states:
                        </p>
                        <div style={{
                            display: 'flex', flexDirection: 'column', gap: 10,
                            background: 'rgba(0,0,0,0.2)', border: '0.5px solid var(--line)',
                            borderRadius: 10, padding: '16px 20px',
                        }}>
                            <TechDetail label="At rest" value="AES-256 encryption, managed by Google Cloud KMS. This is the same standard used by banks." />
                            <div style={{ height: '0.5px', background: 'var(--line-soft)' }} />
                            <TechDetail label="In transit" value="TLS 1.3 for all connections between your browser, our servers, and Google Cloud. Nothing moves in plaintext." />
                            <div style={{ height: '0.5px', background: 'var(--line-soft)' }} />
                            <TechDetail label="Proxy creation" value="Your video is processed on our servers during the brief proxy generation step, then the original is not touched again." />
                        </div>
                        <p>
                            The encryption is not optional and not something you need to set up — it
                            is on by default for every file, every upload, every session.
                        </p>
                    </Section>

                    {/* Usage */}
                    <Section icon={Eye} label="Usage" title="What we do with your files">
                        <p>
                            Your videos are used for <strong style={{ color: 'var(--fg)' }}>one thing only</strong>: processing the edits
                            you ask for. When you ask the AI to remove silences, we send the audio
                            to our silence detection service. When you export, we compile your
                            timeline. That's it.
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {[
                                ['Never sold', 'We do not sell your files or project data to anyone, ever.'],
                                ['Never used to train models', 'Your footage, audio, and edits are not used to train AI models — ours or anyone else\'s. The AI features in Vibed run on general-purpose models (OpenAI, Google) that are not trained on your content.'],
                                ['Never shared', 'Your files are not accessible to other users, not indexed by search engines, and not viewable by Vibed employees except when you explicitly request support and grant temporary access.'],
                            ].map(([title, body]) => (
                                <div key={title} style={{
                                    display: 'flex', gap: 14,
                                    padding: '14px 18px',
                                    background: 'rgba(0,0,0,0.15)',
                                    border: '0.5px solid var(--line-soft)',
                                    borderRadius: 8,
                                }}>
                                    <ShieldCheck size={15} style={{ color: 'var(--accent)', marginTop: 3, flexShrink: 0 }} />
                                    <div>
                                        <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>
                                            {title}
                                        </div>
                                        <div style={{ fontFamily: 'var(--f-sans)', fontSize: 13.5, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                                            {body}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* Retention */}
                    <Section icon={Trash2} label="Retention" title="How long we keep your files">
                        <p>
                            Files don't live on our servers forever by default. Here's the timeline:
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            {[
                                {
                                    when: 'Immediately',
                                    what: 'When you delete a project or click "Delete my files," both your original upload and the proxy are permanently removed from GCS. This is irreversible.',
                                },
                                {
                                    when: 'After 30 days',
                                    what: 'If a file has not been accessed and is not attached to an active project, it is automatically deleted. You will receive an email reminder 7 days before this happens.',
                                },
                                {
                                    when: 'Anonymous sessions',
                                    what: 'If you edit without creating an account, your files and session are deleted after 48 hours. Creating a free account resets this to the standard 30-day policy.',
                                },
                                {
                                    when: 'Account deletion',
                                    what: 'When you delete your Vibed account, all associated files, projects, and session data are deleted within 24 hours.',
                                },
                            ].map((row, i, arr) => (
                                <div key={row.when} style={{
                                    display: 'grid', gridTemplateColumns: '140px 1fr',
                                    gap: 20, padding: '16px 0',
                                    borderBottom: i < arr.length - 1 ? '0.5px solid var(--line-soft)' : 'none',
                                    alignItems: 'start',
                                }}>
                                    <span style={{
                                        fontFamily: 'var(--f-mono)', fontSize: 11,
                                        color: 'var(--accent)', letterSpacing: '0.04em',
                                    }}>{row.when}</span>
                                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.65 }}>
                                        {row.what}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* Rights */}
                    <Section icon={Mail} label="Your rights" title="What you can ask us to do">
                        <p>
                            You can request any of the following at any time by emailing{' '}
                            <a
                                href="mailto:privacy@vibed.studio"
                                style={{ color: 'var(--accent)', textDecoration: 'none' }}
                                onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                                onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                            >
                                privacy@vibed.studio
                            </a>:
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {[
                                'Delete all my files and project data',
                                'Send me a copy of everything you have on me',
                                "Tell me exactly what data you're storing and where",
                                'Remove my account completely',
                            ].map(item => (
                                <div key={item} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                    <div style={{
                                        width: 5, height: 5, borderRadius: '50%',
                                        background: 'var(--accent)', flexShrink: 0,
                                    }} />
                                    <span style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)' }}>
                                        {item}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <Callout>
                            We respond to all data requests within <strong>48 hours</strong> on business days.
                            If you're in the EU, you have additional rights under GDPR — we honour
                            those for everyone, not just EU residents.
                        </Callout>
                    </Section>

                    {/* Footer note */}
                    <div style={{ paddingTop: 8 }}>
                        <p style={{
                            fontFamily: 'var(--f-sans)', fontSize: 13.5, color: 'var(--fg-4)',
                            lineHeight: 1.75,
                        }}>
                            This page is written for humans, not lawyers. It reflects our actual practices.
                            If something here is unclear or you think we've missed something, email us at{' '}
                            <a href="mailto:privacy@vibed.studio" style={{ color: 'var(--fg-3)' }}>
                                privacy@vibed.studio
                            </a>{' '}
                            and we'll update it.{' '}
                            Last updated: May 2026.
                        </p>
                    </div>

                </div>
            </main>
        </div>
    );
};

export default DataPage;
