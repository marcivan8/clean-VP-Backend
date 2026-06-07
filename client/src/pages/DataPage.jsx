import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, HardDrive, Lock, Eye, Trash2, Mail, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';

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

const FaqItem = ({ question, answer }) => {
    const [open, setOpen] = useState(false);
    return (
        <div style={{
            borderBottom: '0.5px solid var(--line-soft)',
            padding: '16px 0',
        }}>
            <button
                onClick={() => setOpen(!open)}
                style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', background: 'none', border: 'none', padding: 0,
                    cursor: 'pointer', textAlign: 'left',
                }}
            >
                <span style={{ fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>
                    {question}
                </span>
                {open ? <ChevronUp size={16} color="var(--fg-3)" /> : <ChevronDown size={16} color="var(--fg-3)" />}
            </button>
            {open && (
                <div style={{
                    marginTop: 12, fontFamily: 'var(--f-sans)', fontSize: 14.5, color: 'var(--fg-2)', lineHeight: 1.7
                }}>
                    {answer}
                </div>
            )}
        </div>
    );
};

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
                        Your data, your videos.
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560,
                    }}>
                        We built VIBED to edit your content — not to collect it.
                        Here's exactly what happens to your files, in plain language.
                    </p>
                </div>

                {/* Summary Grid */}
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16,
                    marginBottom: 56
                }}>
                    {[
                        { title: 'Storage', value: 'Google Cloud', detail: 'Encrypted at rest & in transit' },
                        { title: 'Auto-deletion', value: '30 days', detail: 'Free plan · Pro keeps files longer' },
                        { title: 'AI training', value: 'Never', detail: 'Your content stays yours' },
                        { title: 'Data sold', value: 'Never', detail: 'No third-party sharing' }
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

                    <Section title="When you upload a video">
                        <p>
                            Your file is uploaded directly to Google Cloud Storage — the same infrastructure used by millions of apps worldwide. It is encrypted in transit (TLS) and at rest (AES-256). We create a lightweight proxy version for smooth playback inside the editor. Your original file is never modified.
                        </p>
                        <p>
                            Only you can access your files. VIBED staff cannot browse your projects. No one else sees your footage.
                        </p>
                    </Section>

                    <Section title="When the AI processes your video">
                        <p>
                            When you type a command — like "remove silences" or "clean up filler words" — your video is processed on our servers using FFmpeg, an industry-standard audio and video tool. The AI interprets your instruction and tells FFmpeg what to do. That's it.
                        </p>
                        <p>
                            Your video is never sent to any AI training pipeline. It is never used to improve any model. The AI reads your command — not your footage.
                        </p>
                    </Section>

                    <Section title="When your files are deleted">
                        <p>
                            On the free plan, your project files are automatically deleted after 7 days of inactivity. We send you an email reminder 24 hours before deletion so you always have time to export first.
                        </p>
                        <p>
                            On Creator (€15/month), files are kept for 30 days. On Pro (€35/month), files are kept for 90 days and your projects persist as long as your subscription is active.
                        </p>
                        <p>
                            You can delete any project or your entire account at any time from your dashboard. Deletion is permanent and immediate.
                        </p>
                    </Section>

                    <div style={{ paddingTop: 16 }}>
                        <h2 style={{
                            fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700,
                            color: 'var(--fg)', marginBottom: 20, lineHeight: 1.3,
                        }}>Common questions</h2>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <FaqItem 
                                question="Who technically &quot;has&quot; my data?" 
                                answer="You do. VIBED (the data controller) stores your files on Google Cloud Storage (the data processor). Google cannot access your content — they only provide the infrastructure. Your files are associated with your account and inaccessible to anyone else." 
                            />
                            <FaqItem 
                                question="Does my account persist if I stop paying?" 
                                answer="Yes. Your account remains active. Your project files follow the free plan retention rules (7-day inactivity deletion) until you resubscribe or export your work. You will never lose access to your account itself." 
                            />
                            <FaqItem 
                                question="Can I export my data before deleting my account?" 
                                answer="Yes. You can export any project as a video file or as a project file for Premiere Pro, Final Cut Pro, or DaVinci Resolve at any time from the editor. Your edit history is always available while your project exists." 
                            />
                            <FaqItem 
                                question="Is VIBED GDPR compliant?" 
                                answer={
                                    <>
                                        Yes. VIBED operates under French and EU law. You have the right to access, correct, and delete your personal data at any time. To exercise these rights, contact us at the address below. Our full privacy policy is available <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>here</a>.
                                    </>
                                } 
                            />
                            <FaqItem 
                                question="What data do you collect beyond my videos?" 
                                answer="Your email address and authentication credentials (stored securely via Supabase), your project metadata (file names, durations, edit history), and basic usage analytics (which features you use, how often). We do not collect payment card details — those are handled entirely by Paddle, our payment processor." 
                            />
                        </div>
                    </div>

                    <div style={{
                        marginTop: 32, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                        borderRadius: 12, textAlign: 'center'
                    }}>
                        <p style={{
                            fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)',
                            marginBottom: 8, fontWeight: 500,
                        }}>
                            Questions about your data? We'll respond within 48 hours.
                        </p>
                        <a
                            href="mailto:mariojaris2@gmail.com"
                            style={{
                                fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none'
                            }}
                            onMouseEnter={e => e.currentTarget.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.currentTarget.style.textDecoration = 'none'}
                        >
                            mariojaris2@gmail.com
                        </a>
                    </div>

                </div>
            </main>
        </div>
    );
};

export default DataPage;
