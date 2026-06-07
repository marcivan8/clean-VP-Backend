import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, CheckCircle2, Link as LinkIcon, Heart, User, MapPin } from 'lucide-react';

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

const AboutPage = () => {
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
                    }}>Our Story</div>
                    <h1 style={{
                        fontFamily: 'var(--f-display)', fontSize: 'clamp(32px, 5vw, 48px)',
                        fontWeight: 800, lineHeight: 1.15, color: 'var(--fg)', marginBottom: 20,
                    }}>
                        Built by a creator who got tired of editing the hard way.
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560,
                    }}>
                        VIBED started with a frustration. Not a business plan but a frustration. The kind that comes from spending hours in a timeline doing the same mechanical work over and over: cutting silences, trimming pauses, cleaning up speech, exporting to yet another format. Work that has nothing to do with the story you're trying to tell.
                    </p>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560, marginTop: 16,
                    }}>
                        The idea was simple: what if you could just describe the edit? Not click through menus. Not drag handles on a timeline. Just say what you want — and have it done.
                    </p>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg)', fontWeight: 500,
                        lineHeight: 1.75, maxWidth: 560, marginTop: 16,
                    }}>
                        That question became VIBED.
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

                    <Section title="The Journey">
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 8 }}>
                            {/* Timeline Item 1 */}
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', marginTop: 4 }}></div>
                                    <div style={{ flex: 1, width: 2, background: 'var(--line-soft)', marginTop: 8, marginBottom: 8 }}></div>
                                </div>
                                <div>
                                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-4)', textTransform: 'uppercase', marginBottom: 4 }}>2024 · Istanbul, Turkey</div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 16, marginBottom: 6 }}>The origin</div>
                                    <div style={{ color: 'var(--fg-2)', fontSize: 15, lineHeight: 1.6 }}>
                                        The idea for a smarter video editing workflow starts here — before there was a line of code, before there was a company name. Just an observation about how much time creators lose to mechanical editing.
                                    </div>
                                </div>
                            </div>

                            {/* Timeline Item 2 */}
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', marginTop: 4 }}></div>
                                    <div style={{ flex: 1, width: 2, background: 'var(--line-soft)', marginTop: 8, marginBottom: 8 }}></div>
                                </div>
                                <div>
                                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-4)', textTransform: 'uppercase', marginBottom: 4 }}>2025 · Paris, France — Epitech</div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 16, marginBottom: 6 }}>The build</div>
                                    <div style={{ color: 'var(--fg-2)', fontSize: 15, lineHeight: 1.6 }}>
                                        Arriving in France with one goal: learn to build what was imagined in Turkey. The technical skills come together at Epitech — one of France's leading engineering schools — where the first real versions of the product are built, broken, and rebuilt.
                                    </div>
                                </div>
                            </div>

                            {/* Timeline Item 3 */}
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', marginTop: 4 }}></div>
                                    <div style={{ flex: 1, width: 2, background: 'var(--line-soft)', marginTop: 8, marginBottom: 8 }}></div>
                                </div>
                                <div>
                                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-4)', textTransform: 'uppercase', marginBottom: 4 }}>The metamorphosis</div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 16, marginBottom: 6 }}>From analysis tool to editing IDE</div>
                                    <div style={{ color: 'var(--fg-2)', fontSize: 15, lineHeight: 1.6 }}>
                                        The project pivots. What started as a video analysis tool — something that scored footage for virality — becomes something more interesting: a conversational editing environment. An IDE for video, validated by a mentor and teacher who saw the gap in the market clearly.
                                    </div>
                                </div>
                            </div>

                            {/* Timeline Item 4 */}
                            <div style={{ display: 'flex', gap: 16 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', marginTop: 4 }}></div>
                                </div>
                                <div>
                                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-4)', textTransform: 'uppercase', marginBottom: 4 }}>2026</div>
                                    <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 16, marginBottom: 6 }}>VIBED launches</div>
                                    <div style={{ color: 'var(--fg-2)', fontSize: 15, lineHeight: 1.6 }}>
                                        The first version is live. Podcasters, YouTubers, and documentary makers can now edit by describing what they want — and export to the tools they already use.
                                    </div>
                                </div>
                            </div>
                        </div>

                    </Section>

                    <Section title="What We Believe">
                        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 16 }}>
                            <li style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                                <CheckCircle2 className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                                <div>
                                    <strong style={{ color: 'var(--fg)', display: 'block', marginBottom: 4 }}>You stay in control</strong>
                                    The AI suggests and executes. You decide. Every action is visible, named, and reversible. Nothing happens inside a black box.
                                </div>
                            </li>
                            <li style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                                <LinkIcon className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                                <div>
                                    <strong style={{ color: 'var(--fg)', display: 'block', marginBottom: 4 }}>Work in your tools</strong>
                                    You don't have to abandon Premiere, Final Cut, or DaVinci. VIBED works with the suite you already finish in — not instead of it.
                                </div>
                            </li>
                            <li style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                                <Play className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                                <div>
                                    <strong style={{ color: 'var(--fg)', display: 'block', marginBottom: 4 }}>Editing is creative work</strong>
                                    The mechanical parts — silence removal, cleanup, formatting — shouldn't take your attention. The story should. 
                                </div>
                            </li>
                            <li style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                                <Heart className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                                <div>
                                    <strong style={{ color: 'var(--fg)', display: 'block', marginBottom: 4 }}>Your footage is yours</strong>
                                    We store it, we process it, we delete it on your schedule. We never train on it, we never share it, we never monetise it.
                                </div>
                            </li>
                        </ul>
                    </Section>

                    <Section title="Who We're Building For">
                        <p>
                            VIBED is built for long-form creators who edit their own content — podcasters, YouTubers, interviewers, documentary makers. People who have a story to tell and a timeline full of raw footage standing between them and telling it.
                        </p>
                        <p>
                            Not for teams with dedicated editors. Not for short-form content factories. For the solo creator who films something real, sits down to edit it themselves, and wants the process to get out of the way of the work.
                        </p>
                    </Section>

                    <Section title="The Founder">
                        <div style={{ 
                            padding: 24, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)',
                            borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 16 
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <div style={{ 
                                    width: 64, height: 64, borderRadius: '50%', background: 'var(--accent-soft)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '2px solid color-mix(in oklch, var(--accent) 30%, transparent)',
                                    color: 'var(--accent)'
                                }}>
                                    <User size={32} />
                                </div>
                                <div>
                                    <div style={{ fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700, color: 'var(--fg)' }}>
                                        Marc NGUIDJOL
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-3)', marginTop: 4 }}>
                                        Founder & builder — VIBED Studio
                                        <span>·</span>
                                        <MapPin size={12} /> Paris, France
                                    </div>
                                </div>
                            </div>
                            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--fg-2)' }}>
                                From Istanbul to Paris. Master's student in AI at Epitech. Solo founder building VIBED — a conversational video editing IDE for long-form creators. Previously: video analysis tools, hackathons, and a lot of time spent learning what not to build.
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                                {['Epitech Master\'s AI', 'Solo founder', 'Long-form content', 'Building in public', 'Paris, France'].map(tag => (
                                    <span key={tag} style={{
                                        fontSize: 12, padding: '4px 10px', borderRadius: 999,
                                        background: 'color-mix(in oklch, var(--fg) 5%, transparent)',
                                        color: 'var(--fg-2)', border: '0.5px solid var(--line)'
                                    }}>
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        </div>
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
                            Questions, feedback, or just want to talk about the build?
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

export default AboutPage;
