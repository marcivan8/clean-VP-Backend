import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Play, CheckCircle2, MousePointerClick, Layers, LayoutGrid, Link as LinkIcon, MessageSquare, Mic, Scissors, UserCheck, Zap } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import Logo from '../components/Logo';

async function createCheckout(plan) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = '/auth?next=/'; return; }
    const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan }),
    });
    if (!res.ok) { console.error('[checkout] failed', await res.text()); return; }
    const { url } = await res.json();
    window.location.href = url;
}

const Nav = () => {
    const [scrolled, setScrolled] = useState(false);
    const [user, setUser] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const handleScroll = () => setScrolled(window.scrollY > 24);
        handleScroll();
        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setUser(session?.user ?? null));
        return () => subscription.unsubscribe();
    }, []);

    return (
        <nav style={{
            position: "fixed", top: 16, left: 0, right: 0, zIndex: 50,
            display: "flex", justifyContent: "center", pointerEvents: "none",
        }}>
            <div style={{
                pointerEvents: "auto",
                display: "flex", alignItems: "center", gap: 28,
                padding: "10px 12px 10px 22px",
                borderRadius: 999,
                background: scrolled ? "var(--glass-2)" : "transparent",
                border: `0.5px solid ${scrolled ? "var(--glass-stroke)" : "transparent"}`,
                backdropFilter: scrolled ? "blur(20px) saturate(160%)" : "none",
                WebkitBackdropFilter: scrolled ? "blur(20px) saturate(160%)" : "none",
                transition: "all 0.3s ease",
            }}>
                <Logo />
                <div style={{ display: "flex", gap: 22, fontSize: 13.5, color: "var(--fg-2)" }} className="hidden sm:flex font-medium">
                    <a href="#product" className="hover:text-foreground transition-colors">Product</a>
                    <a href="#exports" className="hover:text-foreground transition-colors">Exports</a>
                    <a href="/about" className="hover:text-foreground transition-colors">About</a>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {user ? (
                        <>
                            <span style={{
                                fontSize: 12.5, color: "var(--fg-3)", padding: "0 12px",
                                display: "flex", alignItems: "center", gap: 6,
                            }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mint)", display: "inline-block" }} />
                                {user.email}
                            </span>
                            <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/auth')}>Account</button>
                        </>
                    ) : (
                        <>
                            <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/auth')}>Log in</button>
                            <button className="btn btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => window.location.href='/auth'}>Start free</button>
                        </>
                    )}
                </div>
            </div>
        </nav>
    );
};


const HeroFrame = () => {
    const images = [
        "/Hero Editor.png",
        "/AI commands.png",
        "/Transcript editing.png",
        "/AI edit timeline.png",
        "/NLE Export.png"
    ];
    const [activeIndex, setActiveIndex] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setActiveIndex(i => (i + 1) % images.length);
        }, 3000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div style={{
            position: "relative",
            borderRadius: 28,
            overflow: "hidden",
            border: "0.5px solid var(--glass-stroke)",
            boxShadow: "var(--shadow-card)",
            aspectRatio: "16/9",
            background: "var(--bg-2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
        }}>
            {images.map((src, i) => (
                <img
                    key={src}
                    src={src}
                    alt={`Hero sequence frame ${i}`}
                    style={{
                        position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover",
                        opacity: activeIndex === i ? 1 : 0,
                        transform: activeIndex === i ? "scale(1.05)" : "scale(1.0)",
                        transition: "opacity 1s ease-in-out, transform 4s cubic-bezier(0.25, 1, 0.5, 1)",
                        pointerEvents: "none"
                    }}
                />
            ))}
        </div>
    );
};

const Hero = () => {
    return (
        <section style={{ paddingTop: 140, paddingBottom: 40, position: "relative", overflow: "hidden" }}>
            <div className="aurora" />
            <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 28 }}>
                    <div className="tag fade-up">
                        <span className="dot" />
                        <span>Vibed Studio</span>
                        <span style={{ color: "var(--fg-4)" }}>—</span>
                        <span>v0.6 "Cinema"</span>
                    </div>
                    <h1 className="display fade-up fade-up-d1">
                        Create at the<br />
                        <em>speed of thought.</em>
                    </h1>
                    <p className="body-lg fade-up fade-up-d2" style={{ maxWidth: 620, margin: 0, fontSize: 19 }}>
                        Vibed is the creative operating system for storytellers and editors.
                        Edit, organize and refine your footage in conversation with an assistant that
                        respects your taste. Every edit lands as a named, reversible action.
                    </p>
                    <div className="fade-up fade-up-d3" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
                        <button onClick={() => window.location.href='#pricing'} className="btn btn-primary">See plans <ArrowRight className="w-4 h-4 ml-1" /></button>
                    </div>
                    <div className="fade-up fade-up-d4 caption" style={{ marginTop: 8 }}>
                        No credit card required. Bring your own clips.
                    </div>
                </div>
                <div className="fade-up fade-up-d4" style={{ marginTop: 72 }}>
                    <HeroFrame />
                </div>
            </div>
        </section>
    );
};

const FeatureMoments = () => {
    const moments = [
        {
            title: "Conversational Editing",
            copy: "Tell the AI what to do, and watch the timeline update.",
            img: "/AI commands.png",
            icon: MessageSquare
        },
        {
            title: "Your transcript is your timeline",
            copy: "Click a sentence, the playhead is already there.",
            img: "/Transcript editing.png",
            icon: Layers
        },
        {
            title: "Type what you want to cut",
            copy: "Show 'cut from so anyway to let's move on' → the cut appears.",
            img: "/AI edit timeline.png",
            icon: Scissors
        },
        {
            title: "Speaker-scoped commands",
            copy: "Cut all of Marc's stumbles — VIBED highlights segments and removes them.",
            img: "/AI acceptreject.png",
            icon: UserCheck
        }
    ];

    return (
        <section id="product" style={{ paddingTop: 80, paddingBottom: 80 }}>
            <div className="wrap">
                <div className="section-head text-center" style={{ marginBottom: 60, alignItems: "center" }}>
                    <span className="eyebrow">The workflow</span>
                    <h2 className="h-section">AI that works <em>with</em> your creativity.</h2>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 64 }}>
                    {moments.map((m, i) => (
                        <div key={i} style={{
                            display: "grid",
                            gridTemplateColumns: i % 2 === 0 ? "1fr 1.2fr" : "1.2fr 1fr",
                            gap: 48,
                            alignItems: "center"
                        }} className="md:grid-cols-[1fr_1fr] grid-cols-1">
                            <div style={{ order: i % 2 === 0 ? 1 : 2 }} className="md:order-none order-2">
                                <div style={{
                                    width: 48, height: 48, borderRadius: 12, background: "var(--bg-2)", border: "0.5px solid var(--line)",
                                    display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)",
                                    marginBottom: 20
                                }}>
                                    <m.icon className="w-6 h-6" />
                                </div>
                                <h3 className="h-section" style={{ fontSize: 32, marginBottom: 12 }}>{m.title}</h3>
                                <p className="body-lg" style={{ color: "var(--fg-2)" }}>{m.copy}</p>
                            </div>
                            <div style={{ order: i % 2 === 0 ? 2 : 1 }} className="md:order-none order-1">
                                <div style={{
                                    borderRadius: 16, border: "0.5px solid var(--line)", background: "var(--bg-2)",
                                    aspectRatio: "16/9", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
                                    boxShadow: "var(--shadow-card)"
                                }}>
                                    <img
                                        src={m.img}
                                        alt={m.title}
                                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'block';
                                        }}
                                    />
                                    <div style={{ color: "var(--fg-4)", fontSize: 13, display: "none" }}>
                                        [ {m.title} Visual ]
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

const AntiDescript = () => (
    <section style={{ padding: "80px 0", background: "var(--bg-2)", borderTop: "0.5px solid var(--line)", borderBottom: "0.5px solid var(--line)" }}>
        <div className="wrap">
            <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
                <p style={{ fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.4, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
                    Descript invented transcript editing. It's genuinely great — until you need to finish in Premiere or Final Cut, at which point you're stuck. <span style={{ color: "var(--accent)" }}>VIBED does the same thing and hands you a real FCPXML or Premiere XML at the end.</span> That combination doesn't exist anywhere else.
                </p>
            </div>
        </div>
    </section>
);
  
const ExportIcon = {
    premiere: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="6" width="26" height="20" rx="2" />
        <path d="M3 11h26M3 21h26" />
        <path d="M7 6v-2M11 6v-2M15 6v-2M19 6v-2M23 6v-2M27 6v-2" />
        <path d="M7 28v-2M11 28v-2M15 28v-2M19 28v-2M23 28v-2M27 28v-2" />
        <path d="M13 14l6 2-6 2v-4z" fill="currentColor" stroke="none" />
      </svg>
    ),
    resolve: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="16" cy="16" r="10" />
        <circle cx="16" cy="16" r="3" />
        <path d="M16 6v4M16 22v4M6 16h4M22 16h4M9 9l2.8 2.8M20.2 20.2L23 23M9 23l2.8-2.8M20.2 11.8L23 9" strokeLinecap="round" />
      </svg>
    ),
    finalcut: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
        <rect x="4" y="4" width="24" height="24" rx="5" />
        <path d="M12 11v10l9-5-9-5z" fill="currentColor" stroke="none" />
      </svg>
    ),
    otio: () => (
      <svg viewBox="0 0 32 32" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="7" cy="9" r="2.5" />
        <circle cx="25" cy="9" r="2.5" />
        <circle cx="16" cy="23" r="2.5" />
        <path d="M9 10.5l5.5 10M23 10.5l-5.5 10M9.5 9h13" strokeLinecap="round" />
      </svg>
    ),
};
  
const Exports = () => {
    const tools = [
      { key: "premiere", name: "Premiere Pro",     fmt: "XML · MOGRT" },
      { key: "resolve",  name: "DaVinci Resolve",  fmt: "DRP · OFX" },
      { key: "finalcut", name: "Final Cut Pro",    fmt: "FCPXML · iCloud" },
      { key: "otio",     name: "OpenTimelineIO",   fmt: "Open standard" },
    ];
    return (
      <section id="exports" style={{ padding: "100px 0" }}>
        <div className="wrap">
          <div style={{ display: "grid", gap: 80, alignItems: "center" }} className="grid-cols-1 md:grid-cols-2">
            <div className="section-head" style={{ marginBottom: 0 }}>
              <span className="eyebrow">Roundtrip-ready</span>
              <h2 className="h-section">Works with the suite you <em>already</em> finish in.</h2>
              <p className="body-lg">Vibed isn’t the last app you’ll ever open — it’s the first.
                Hand off cleanly to professional editing tools the moment you’re ready to polish.</p>
              <p className="body-lg" style={{ marginTop: 16, fontWeight: 500 }}>
                The transcript edit happens in VIBED. The finishing happens where you've always finished.
              </p>
              <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
                <span className="tag"><span className="dot" />XML · FCPXML · EDL · OTIO</span>
                <span className="tag">Bin metadata preserved</span>
              </div>
            </div>
  
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {tools.map((t) => {
                const Icon = ExportIcon[t.key];
                return (
                  <div key={t.key} className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{
                      width: 48, height: 48, borderRadius: 12, background: "var(--bg-3)",
                      border: "0.5px solid var(--line)", color: "var(--fg)",
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <Icon />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</div>
                      <div className="mono" style={{ color: "var(--fg-3)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.fmt}</div>
                    </div>
                    <div style={{ marginLeft: "auto", color: "var(--fg-4)" }}><ArrowRight className="w-4 h-4" /></div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    );
};
  
const PLANS = [
    {
        key:     'free',
        name:    'Free',
        price:   '€0',
        period:  '',
        tagline: 'Edit your first project. Feel what conversational editing is.',
        cta:     'Start free',
        ctaStyle: 'btn-ghost',
        features: [
            '2 active projects',
            'Videos up to 20 minutes',
            '7-day storage',
            '10 AI operations / month',
            'Silence removal & trim — unlimited',
            'MP4 export — no watermark',
        ],
        locked: ['NLE export', 'Transcript intelligence'],
    },
    {
        key:     'creator',
        name:    'Creator',
        price:   '€15',
        period:  '/ month',
        tagline: 'Edit every week. Export to any tool you already use.',
        cta:     'Get Creator',
        ctaStyle: 'btn-primary',
        highlight: true,
        features: [
            'Unlimited projects',
            'Videos up to 90 minutes',
            '30-day storage',
            '100 AI operations / month',
            'All AI commands — filler, captions, best moments',
            'Full transcript + content intelligence',
            'MP4 export',
            'NLE export — Premiere, Final Cut, DaVinci, OTIO',
        ],
        locked: [],
    },
    {
        key:     'pro',
        name:    'Pro',
        price:   '€35',
        period:  '/ month',
        tagline: 'Edit without limits. Bring your team.',
        cta:     'Get Pro',
        ctaStyle: 'btn-ghost',
        features: [
            'Everything in Creator',
            'Videos up to 4 hours',
            '90-day storage',
            'Unlimited AI operations',
            'Priority processing queue',
            '2 team seats',
            'Virality scoring + performance analysis',
            'Early access to new features',
        ],
        locked: [],
    },
];

const Pricing = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(null);

    const handleUpgrade = async (plan) => {
        if (plan === 'free') { navigate('/dashboard'); return; }
        setLoading(plan);
        await createCheckout(plan);
        setLoading(null);
    };

    return (
        <section id="pricing" style={{ padding: '120px 0 80px', background: 'var(--bg)' }}>
            <div className="wrap">
                <div style={{ textAlign: 'center', marginBottom: 64 }}>
                    <div className="tag" style={{ display: 'inline-flex', marginBottom: 20 }}>
                        <Zap className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                        <span>Simple pricing</span>
                    </div>
                    <h2 className="display" style={{ fontSize: 'clamp(36px, 5vw, 64px)', margin: '0 0 16px' }}>
                        One tool. Three speeds.
                    </h2>
                    <p className="body-lg" style={{ margin: 0, color: 'var(--fg-2)', maxWidth: 520, marginInline: 'auto' }}>
                        Start free. Upgrade when the product earns it.
                    </p>
                </div>

                <div style={{ display: 'grid', gap: 20 }} className="grid-cols-1 md:grid-cols-3">
                    {PLANS.map(plan => (
                        <div key={plan.key} style={{
                            padding: 32,
                            borderRadius: 16,
                            border: plan.highlight
                                ? '1px solid var(--accent)'
                                : '0.5px solid var(--line)',
                            background: plan.highlight ? 'var(--bg-2)' : 'var(--bg)',
                            display: 'flex', flexDirection: 'column', gap: 24,
                            position: 'relative',
                        }}>
                            {plan.highlight && (
                                <div style={{
                                    position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                                    background: 'var(--accent)', color: '#fff',
                                    fontSize: 11, fontWeight: 600, letterSpacing: '0.08em',
                                    padding: '3px 14px', borderRadius: 999, whiteSpace: 'nowrap',
                                }}>
                                    MOST POPULAR
                                </div>
                            )}

                            <div>
                                <div className="mono" style={{ color: 'var(--fg-4)', fontSize: 11, letterSpacing: '0.1em', marginBottom: 8 }}>
                                    {plan.name.toUpperCase()}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                                    <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}>{plan.price}</span>
                                    {plan.period && <span style={{ color: 'var(--fg-3)', fontSize: 14 }}>{plan.period}</span>}
                                </div>
                                <p style={{ margin: '10px 0 0', fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.5 }}>
                                    {plan.tagline}
                                </p>
                            </div>

                            <button
                                className={`btn ${plan.ctaStyle}`}
                                style={{ width: '100%', height: 44, fontSize: 14 }}
                                onClick={() => handleUpgrade(plan.key)}
                                disabled={loading === plan.key}
                            >
                                {loading === plan.key ? 'Redirecting…' : plan.cta}
                            </button>

                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {plan.features.map(f => (
                                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                                        <CheckCircle2 size={15} strokeWidth={2} style={{ color: 'var(--mint)', flexShrink: 0, marginTop: 2 }} />
                                        <span>{f}</span>
                                    </li>
                                ))}
                                {plan.locked.map(f => (
                                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5, opacity: 0.35 }}>
                                        <CheckCircle2 size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 2 }} />
                                        <span>{f}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

const SocialProof = () => {
    return (
        <section style={{ padding: "80px 0", background: "var(--bg-2)" }}>
            <div className="wrap">
                <div style={{ display: "grid", gap: 32 }} className="grid-cols-1 md:grid-cols-2">
                    <div className="card" style={{ padding: 40, border: "0.5px solid var(--line)" }}>
                        <div style={{ color: "var(--accent)", marginBottom: 20 }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                            </svg>
                        </div>
                        <p style={{ fontSize: 20, fontStyle: "italic", lineHeight: 1.5, marginBottom: 24 }}>
                            "Finally, an AI editor that knows when to get out of the way. It lets me work at the speed of thought without messing up my timeline."
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--line)", flexShrink: 0 }} />
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 15 }}>Alex</div>
                                <div style={{ color: "var(--fg-3)", fontSize: 14 }}>Senior Video Editor</div>
                            </div>
                        </div>
                    </div>
                    <div className="card" style={{ padding: 40, border: "0.5px solid var(--line)" }}>
                        <div style={{ color: "var(--accent)", marginBottom: 20 }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                            </svg>
                        </div>
                        <p style={{ fontSize: 20, fontStyle: "italic", lineHeight: 1.5, marginBottom: 24 }}>
                            "The fact that I can dump it straight into Resolve when the rough cut is done is a complete game-changer for my agency workflow."
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--line)", flexShrink: 0 }} />
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 15 }}>Sarah</div>
                                <div style={{ color: "var(--fg-3)", fontSize: 14 }}>Creative Director</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

const FinalCTA = () => (
    <section style={{ position: "relative", overflow: "hidden", paddingTop: 140, paddingBottom: 140 }}>
      <div className="aurora" />
      <div className="wrap" style={{ position: "relative", zIndex: 2, textAlign: "center", display: "flex", flexDirection: "column", gap: 28, alignItems: "center" }}>
        <h2 className="display" style={{ fontSize: "clamp(48px, 6.4vw, 96px)" }}>
          The future of editing<br /><em>is collaborative.</em>
        </h2>
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={() => window.location.href='#pricing'} className="btn btn-primary" style={{ padding: "0 32px", height: 48, fontSize: 16 }}>
            See plans <ArrowRight className="w-5 h-5 ml-1" />
          </button>
        </div>
        <div className="caption" style={{ marginTop: 8 }}>
          Start free. No credit card. Bring your own clips.
        </div>
      </div>
    </section>
);
  
const Footer = () => {
    const cols = {
      "Company": ["About"],
      "Legal": ["Privacy Policy", "Cookie Policy", "Your data"],
    };
    return (
      <footer style={{ borderTop: "0.5px solid var(--line)", padding: "64px 0 32px", background: "var(--bg)" }}>
        <div className="wrap grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]" style={{ display: "grid", gap: 56 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Logo size={32} />
            <p className="body" style={{ fontSize: 13.5, margin: 0, maxWidth: 280 }}>
              The creative operating system for modern storytellers, editors and studios.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <div style={{ display: "flex" }}>
                <a href="/gdpr" style={{ textDecoration: 'none' }}>
                  <span className="tag" style={{ border: "0.5px solid var(--line-strong)", background: "var(--bg-2)", cursor: "pointer" }}>GDPR Compliant · GCS Data Processor · 30-Day Retention</span>
                </a>
              </div>
            </div>
          </div>
          {Object.entries(cols).map(([k, items]) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="mono" style={{ color: "var(--fg-4)" }}>{k.toUpperCase()}</div>
              {items.map(it => {
                  let href = '#';
                  if (it === 'Your data') href = '/data';
                  if (it === 'Privacy Policy') href = '/privacy';
                  if (it === 'Cookie Policy') href = '/cookie-policy';
                  if (it === 'About') href = '/about';
                  return (
                    <a key={it} href={href} style={{ fontSize: 13.5, color: "var(--fg-2)" }} className="hover:text-foreground transition-colors">{it}</a>
                  )
              })}
            </div>
          ))}
        </div>
        <div className="wrap" style={{ marginTop: 56, paddingTop: 24, borderTop: "0.5px solid var(--line-soft)",
          display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <span className="caption">© 2026 Vibed Studios</span>
          <span className="caption">Made with care, for makers.</span>
        </div>
      </footer>
    );
};

const HomePage = () => {
    return (
        <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans selection:bg-accent selection:text-white">
            <Nav />
            <main>
                <Hero />
                <FeatureMoments />
                <AntiDescript />
                <Exports />
                <Pricing />
                <SocialProof />
                <FinalCTA />
            </main>
            <Footer />
        </div>
    );
};

export default HomePage;
