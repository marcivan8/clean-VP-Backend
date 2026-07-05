import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight, Play, CheckCircle2, MousePointerClick, Layers, LayoutGrid, Link as LinkIcon, MessageSquare, Mic, Scissors, UserCheck, Zap } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import Logo from '../components/Logo';

const renderHighlightedText = (text, accent, bold, mint, boldFg) => {
    if (!text) return null;
    let parts = [text];
    if (accent) parts = parts.flatMap((p, idx) => typeof p === 'string' ? p.split(accent).reduce((acc, val, i, arr) => i < arr.length - 1 ? acc.concat(val, <A key={`a-${idx}-${i}`}>{accent}</A>) : acc.concat(val), []) : [p]);
    if (bold) parts = parts.flatMap((p, idx) => typeof p === 'string' ? p.split(bold).reduce((acc, val, i, arr) => i < arr.length - 1 ? acc.concat(val, <W key={`w-${idx}-${i}`}>{bold}</W>) : acc.concat(val), []) : [p]);
    if (mint) parts = parts.flatMap((p, idx) => typeof p === 'string' ? p.split(mint).reduce((acc, val, i, arr) => i < arr.length - 1 ? acc.concat(val, <G key={`g-${idx}-${i}`}>{mint}</G>) : acc.concat(val), []) : [p]);
    if (boldFg) parts = parts.flatMap((p, idx) => typeof p === 'string' ? p.split(boldFg).reduce((acc, val, i, arr) => i < arr.length - 1 ? acc.concat(val, <span key={`bf-${idx}-${i}`} style={{ color: "var(--fg)", fontWeight: 600 }}>{boldFg}</span>) : acc.concat(val), []) : [p]);
    return parts;
};

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

// ── Scroll-triggered reveal hook ──────────────────────────────────────────────
const useReveal = (threshold = 0.15) => {
    const ref = useRef(null);
    const [visible, setVisible] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const obs = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
            { threshold }
        );
        obs.observe(el);
        return () => obs.disconnect();
    }, [threshold]);
    return [ref, visible];
};


const Nav = () => {
    const [scrolled, setScrolled] = useState(false);
    const [user, setUser] = useState(null);
    const navigate = useNavigate();
    const { t } = useTranslation('common');

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
                    <a href="#product" className="hover:text-foreground transition-colors">{t('nav.product')}</a>
                    <a href="#exports" className="hover:text-foreground transition-colors">{t('nav.exports')}</a>
                    <a href="/about" className="hover:text-foreground transition-colors">{t('nav.about')}</a>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <LanguageSwitcher />
                    {user ? (
                        <>
                            <span style={{
                                fontSize: 12.5, color: "var(--fg-3)", padding: "0 12px",
                                display: "flex", alignItems: "center", gap: 6,
                            }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--mint)", display: "inline-block" }} />
                                {user.email}
                            </span>
                            <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/dashboard')}>{t('nav.account')}</button>
                        </>
                    ) : (
                        <>
                            <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/auth')}>{t('nav.logIn')}</button>
                            <button className="btn btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => window.location.href='/auth'}>{t('nav.startFree')}</button>
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
    const { t } = useTranslation('landing');
    return (
        <section style={{ paddingTop: 140, paddingBottom: 40, position: "relative", overflow: "hidden" }}>
            <div className="aurora" />
            <div className="wrap" style={{ position: "relative", zIndex: 2 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 28 }}>
                    <div className="tag fade-up">
                        <span className="dot" />
                        <span>{t('hero.badge')}</span>
                        <span style={{ color: "var(--fg-4)" }}>—</span>
                        <span>{t('hero.version')}</span>
                    </div>
                    <h1 className="display fade-up fade-up-d1" style={{ whiteSpace: "pre-line" }}>
                        {t('hero.headline').split('\n').map((line, i, arr) => (
                            <React.Fragment key={i}>
                                {i === arr.length - 1 ? <em>{line}</em> : line}
                                {i < arr.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </h1>
                    <p className="body-lg fade-up fade-up-d2" style={{ maxWidth: 620, margin: 0, fontSize: 19 }}>
                        {t('hero.body')}
                    </p>
                    <div className="fade-up fade-up-d3" style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
                        <button onClick={() => window.location.href='#pricing'} className="btn btn-primary">{t('hero.cta')} <ArrowRight className="w-4 h-4 ml-1" /></button>
                    </div>
                    <div className="fade-up fade-up-d4 caption" style={{ marginTop: 8 }}>
                        {t('hero.caption')}
                    </div>
                </div>
                <div className="fade-up fade-up-d4" style={{ marginTop: 72 }}>
                    <HeroFrame />
                </div>
            </div>
        </section>
    );
};

// ── Inline emphasis helpers (module-level to avoid "component created during render") ──
const A = ({ children }) => <span style={{ color: "var(--accent)", fontWeight: 600 }}>{children}</span>;
const G = ({ children }) => <span style={{ color: "var(--mint)", fontWeight: 600 }}>{children}</span>;
const W = ({ children }) => <span style={{ color: "var(--fg)", fontWeight: 600 }}>{children}</span>;

// ── Problem Section ───────────────────────────────────────────────────────────
const ProblemSection = () => {
    const { t } = useTranslation('landing');
    const [ref, visible] = useReveal();

    const pains = t('problem.pains', { returnObjects: true });

    return (
        <section style={{
            padding: "100px 0",
            background: "var(--bg-2)",
            borderTop: "0.5px solid var(--line)",
            borderBottom: "0.5px solid var(--line)",
        }}>
            <div className="wrap">
                <div style={{ textAlign: "center", marginBottom: 72 }}>
                    <span className="eyebrow">{t('problem.eyebrow')}</span>
                    <h2 className="h-section" style={{ marginTop: 16, maxWidth: 600, marginInline: "auto" }}>
                        {t('problem.headline')}
                    </h2>
                </div>

                <div ref={ref} style={{ display: "flex", flexDirection: "column" }}>
                    {pains.map((p, i) => (
                        <div key={i} style={{
                            display: "grid",
                            gridTemplateColumns: "72px 1fr",
                            gap: 36,
                            padding: "40px 0",
                            borderTop: "0.5px solid var(--line)",
                            opacity: visible ? 1 : 0,
                            transform: visible ? "translateY(0)" : "translateY(20px)",
                            transition: `opacity 0.65s ease ${i * 0.13}s, transform 0.65s ease ${i * 0.13}s`,
                        }}>
                            <div className="mono" style={{
                                fontSize: 12, fontWeight: 600, letterSpacing: "0.12em",
                                color: "var(--fg-4)", paddingTop: 5,
                            }}>
                                {p.num}
                            </div>
                            <div>
                                <h3 style={{
                                    fontSize: "clamp(19px, 2vw, 22px)", fontWeight: 600,
                                    letterSpacing: "-0.01em", marginBottom: 10, lineHeight: 1.3,
                                }}>
                                    {p.headline}
                                </h3>
                                <p style={{
                                    fontSize: 15.5, color: "var(--fg-2)", lineHeight: 1.7,
                                    margin: 0, maxWidth: 680,
                                }}>
                                    {renderHighlightedText(p.body, p.bodyAccent, p.bodyBold)}
                                </p>
                            </div>
                        </div>
                    ))}

                    {/* Kicker */}
                    <div style={{
                        borderTop: "0.5px solid var(--line)",
                        paddingTop: 52,
                        textAlign: "center",
                        opacity: visible ? 1 : 0,
                        transform: visible ? "translateY(0)" : "translateY(16px)",
                        transition: "opacity 0.65s ease 0.42s, transform 0.65s ease 0.42s",
                    }}>
                        <p style={{
                            fontSize: "clamp(18px, 2.2vw, 25px)",
                            fontWeight: 500,
                            fontStyle: "italic",
                            color: "var(--fg-2)",
                            maxWidth: 700,
                            margin: "0 auto",
                            lineHeight: 1.55,
                            letterSpacing: "-0.01em",
                        }}>
                            {renderHighlightedText(t('problem.kicker'), t('problem.kickerAccent'), null, null, t('problem.kickerBoldFg'))}
                            {t('problem.kickerBoldFg2') && <span style={{ color: "var(--fg)", fontWeight: 600 }}> {t('problem.kickerBoldFg2')}</span>}
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};

// ── Feature Moments ───────────────────────────────────────────────────────────
const FeatureMoments = () => {
    const { t } = useTranslation('landing');
    const translatedMoments = t('workflow.moments', { returnObjects: true });

    const moments = [
        {
            title: translatedMoments[0]?.title || "Conversational Editing",
            copy: translatedMoments[0]?.copy || "Tell the AI what to do, and watch the timeline update.",
            img: "/AI commands.png",
            icon: MessageSquare
        },
        {
            title: translatedMoments[1]?.title || "Your transcript is your timeline",
            copy: translatedMoments[1]?.copy || "Click a sentence, the playhead is already there.",
            img: "/Transcript editing.png",
            icon: Layers
        },
        {
            title: translatedMoments[2]?.title || "Type what you want to cut",
            copy: translatedMoments[2]?.copy || "Show 'cut from so anyway to let's move on' → the cut appears.",
            img: "/AI edit timeline.png",
            icon: Scissors
        },
        {
            title: translatedMoments[3]?.title || "Speaker-scoped commands",
            copy: translatedMoments[3]?.copy || "Cut all of Marc's stumbles — VIBED highlights segments and removes them.",
            img: "/AI acceptreject.png",
            icon: UserCheck
        }
    ];

    return (
        <section id="product" style={{ paddingTop: 80, paddingBottom: 80 }}>
            <div className="wrap">
                <div className="section-head text-center" style={{ marginBottom: 60, alignItems: "center" }}>
                    <span className="eyebrow">{t('workflow.eyebrow')}</span>
                    <h2 className="h-section">
                        {t('workflow.headline').split('with').map((part, i, arr) => (
                            <React.Fragment key={i}>
                                {part}
                                {i < arr.length - 1 && <em>with</em>}
                            </React.Fragment>
                        ))}
                    </h2>
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

// ── Before / After Section ────────────────────────────────────────────────────
const BeforeAfterSection = () => {
    const { t } = useTranslation('landing');
    const [ref, visible] = useReveal(0.1);

    const rows = t('beforeAfter.rows', { returnObjects: true }) || [];

    return (
        <section style={{ padding: "100px 0" }}>
            <div className="wrap">
                <div style={{ textAlign: "center", marginBottom: 64 }}>
                    <span className="eyebrow">{t('beforeAfter.eyebrow')}</span>
                    <h2 className="h-section" style={{ marginTop: 16 }}>
                        {t('beforeAfter.headline').split('\n').map((line, i, arr) => (
                            <React.Fragment key={i}>
                                {i === arr.length - 1 ? <em>{line}</em> : line}
                                {i < arr.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </h2>
                    <p className="body-lg" style={{ color: "var(--fg-2)", maxWidth: 480, margin: "20px auto 0" }}>
                        {t('beforeAfter.subtitle')}
                    </p>
                </div>

                <div ref={ref} style={{ borderRadius: 16, overflow: "hidden", border: "0.5px solid var(--line)" }}>
                    {/* Header row */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--bg-2)" }}>
                        <div style={{ padding: "18px 28px", borderRight: "0.5px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#EF4444", flexShrink: 0 }} />
                            <span className="mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "var(--fg-3)" }}>{t('beforeAfter.withoutHeader')}</span>
                        </div>
                        <div style={{ padding: "18px 28px", display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--mint)", flexShrink: 0 }} />
                            <span className="mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "var(--accent)" }}>{t('beforeAfter.withHeader')}</span>
                        </div>
                    </div>

                    {/* Data rows */}
                    {rows.map((row, i) => (
                        <div key={i} style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            borderTop: "0.5px solid var(--line)",
                            opacity: visible ? 1 : 0,
                            transform: visible ? "translateX(0)" : "translateX(-12px)",
                            transition: `opacity 0.55s ease ${i * 0.07}s, transform 0.55s ease ${i * 0.07}s`,
                        }}>
                            <div style={{
                                padding: "20px 28px", borderRight: "0.5px solid var(--line)",
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                background: "rgba(239, 68, 68, 0.025)",
                            }}>
                                <span style={{ fontSize: 14, color: "var(--fg-2)", lineHeight: 1.4 }}>{row.without}</span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: "#EF4444", flexShrink: 0, marginLeft: 20 }}>{row.withoutTime}</span>
                            </div>
                            <div style={{
                                padding: "20px 28px",
                                display: "flex", justifyContent: "space-between", alignItems: "center",
                                background: "rgba(16, 185, 129, 0.025)",
                            }}>
                                <span style={{ fontSize: 14, color: "var(--fg-2)", lineHeight: 1.4 }}>{row.with}</span>
                                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--mint)", flexShrink: 0, marginLeft: 20 }}>{row.withTime}</span>
                            </div>
                        </div>
                    ))}

                    {/* Total row */}
                    <div style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        borderTop: "0.5px solid var(--line)",
                        background: "var(--bg-2)",
                    }}>
                        <div style={{
                            padding: "28px 28px", borderRight: "0.5px solid var(--line)",
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>{t('beforeAfter.totalLabel')}</span>
                            <span style={{ fontSize: 22, fontWeight: 700, color: "#EF4444", letterSpacing: "-0.02em" }}>{t('beforeAfter.totalWithout')}</span>
                        </div>
                        <div style={{
                            padding: "28px 28px",
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                        }}>
                            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--fg)" }}>{t('beforeAfter.totalLabel')}</span>
                            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--mint)", letterSpacing: "-0.02em" }}>{t('beforeAfter.totalWith')}</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

// ── Who It's For ──────────────────────────────────────────────────────────────
const PersonasSection = () => {
    const { t } = useTranslation('landing');
    const [ref, visible] = useReveal(0.1);

    const translatedPersonas = t('personas.list', { returnObjects: true }) || [];

    const personas = [
        { Icon: Mic, ...translatedPersonas[0] },
        { Icon: Layers, ...translatedPersonas[1] },
        { Icon: UserCheck, ...translatedPersonas[2] },
    ];

    return (
        <section style={{
            padding: "100px 0",
            background: "var(--bg-2)",
            borderTop: "0.5px solid var(--line)",
            borderBottom: "0.5px solid var(--line)",
        }}>
            <div className="wrap">
                <div style={{ textAlign: "center", marginBottom: 64 }}>
                    <span className="eyebrow">{t('personas.eyebrow')}</span>
                    <h2 className="h-section" style={{ marginTop: 16, maxWidth: 560, marginInline: "auto" }}>
                        {t('personas.headline').split('\n').map((line, i, arr) => (
                            <React.Fragment key={i}>
                                {line}
                                {i < arr.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </h2>
                </div>

                <div ref={ref} style={{ display: "grid", gap: 20 }} className="grid-cols-1 md:grid-cols-3">
                    {personas.map((p, i) => (
                        <div key={i} className="card" style={{
                            padding: "32px 28px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 24,
                            opacity: visible ? 1 : 0,
                            transform: visible ? "translateY(0)" : "translateY(28px)",
                            transition: `opacity 0.65s ease ${i * 0.14}s, transform 0.65s ease ${i * 0.14}s`,
                        }}>
                            <div style={{
                                width: 48, height: 48, borderRadius: 12,
                                background: "var(--bg-3)", border: "0.5px solid var(--line)",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                color: "var(--accent)",
                            }}>
                                {p.Icon && <p.Icon size={20} strokeWidth={1.6} />}
                            </div>

                            <div>
                                <div className="mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--fg-4)", marginBottom: 8 }}>
                                    {t('personas.personaLabel')}
                                </div>
                                <h3 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 8, lineHeight: 1.3 }}>
                                    {p.role}
                                </h3>
                                <p style={{ fontSize: 13.5, color: "var(--fg-3)", lineHeight: 1.6, margin: 0 }}>
                                    {p.description}
                                </p>
                            </div>

                            <div style={{ borderTop: "0.5px solid var(--line)", paddingTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                                    <div style={{
                                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                                        background: "rgba(239,68,68,0.1)", border: "0.5px solid rgba(239,68,68,0.25)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <div style={{ width: 7, height: 1.5, background: "#EF4444", borderRadius: 1 }} />
                                    </div>
                                    <p style={{ fontSize: 13.5, color: "var(--fg-3)", lineHeight: 1.55, margin: 0 }}>
                                        {renderHighlightedText(p.before, p.beforeAccent)}
                                    </p>
                                </div>
                                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                                    <div style={{
                                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1,
                                        background: "rgba(16,185,129,0.1)", border: "0.5px solid rgba(16,185,129,0.25)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                    }}>
                                        <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                                            <path d="M1 3.5l2.3 2.3 4.4-4.6" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                        </svg>
                                    </div>
                                    <p style={{ fontSize: 13.5, color: "var(--fg)", lineHeight: 1.55, margin: 0 }}>
                                        {renderHighlightedText(p.after, null, p.afterBold, p.afterMint)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

// ── ROI Statement ─────────────────────────────────────────────────────────────
const AntiDescript = () => {
    const { t } = useTranslation('landing');
    return (
        <section style={{ padding: "80px 0", background: "var(--bg-2)", borderTop: "0.5px solid var(--line)", borderBottom: "0.5px solid var(--line)" }}>
            <div className="wrap">
                <div style={{ maxWidth: 800, margin: "0 auto", textAlign: "center" }}>
                    <p style={{ fontSize: "clamp(24px, 3vw, 32px)", lineHeight: 1.4, fontWeight: 500, margin: 0, letterSpacing: "-0.01em" }}>
                        {renderHighlightedText(t('roi.body'), t('roi.accentPart'), null, null, t('roi.boldPart'))}
                    </p>
                </div>
            </div>
        </section>
    );
};

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
    const { t } = useTranslation('landing');
    const translatedTools = t('exports.tools', { returnObjects: true }) || {};

    const tools = [
        { key: "premiere", name: translatedTools.premiere?.name || "Premiere Pro",    fmt: translatedTools.premiere?.fmt || "XML · MOGRT" },
        { key: "resolve",  name: translatedTools.resolve?.name  || "DaVinci Resolve", fmt: translatedTools.resolve?.fmt  || "DRP · OFX" },
        { key: "finalcut", name: translatedTools.finalcut?.name || "Final Cut Pro",   fmt: translatedTools.finalcut?.fmt || "FCPXML · iCloud" },
        { key: "otio",     name: translatedTools.otio?.name     || "OpenTimelineIO",  fmt: translatedTools.otio?.fmt     || "Open standard" },
    ];
    return (
        <section id="exports" style={{ padding: "100px 0" }}>
            <div className="wrap">
                <div style={{ display: "grid", gap: 80, alignItems: "center" }} className="grid-cols-1 md:grid-cols-2">
                    <div className="section-head" style={{ marginBottom: 0 }}>
                        <span className="eyebrow">{t('exports.eyebrow')}</span>
                        <h2 className="h-section">
                            {t('exports.headline').split('already').map((part, i, arr) => (
                                <React.Fragment key={`en-${i}`}>
                                    {part.split('déjà').map((subPart, j, subArr) => (
                                        <React.Fragment key={`fr-${j}`}>
                                            {subPart}
                                            {j < subArr.length - 1 && <em>déjà</em>}
                                        </React.Fragment>
                                    ))}
                                    {i < arr.length - 1 && <em>already</em>}
                                </React.Fragment>
                            ))}
                        </h2>
                        <p className="body-lg">{t('exports.body1')}</p>
                        <p className="body-lg" style={{ marginTop: 16, fontWeight: 500 }}>
                            {t('exports.body2')}
                        </p>
                        <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
                            <span className="tag"><span className="dot" />{t('exports.formatTag')}</span>
                            <span className="tag">{t('exports.metadataTag')}</span>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                        {tools.map((tool) => {
                            const Icon = ExportIcon[tool.key];
                            return (
                                <div key={tool.key} className="card" style={{ padding: 20, display: "flex", alignItems: "center", gap: 14 }}>
                                    <div style={{
                                        width: 48, height: 48, borderRadius: 12, background: "var(--bg-3)",
                                        border: "0.5px solid var(--line)", color: "var(--fg)",
                                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                                    }}>
                                        <Icon />
                                    </div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 500 }}>{tool.name}</div>
                                        <div className="mono" style={{ color: "var(--fg-3)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tool.fmt}</div>
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


const Pricing = () => {
    const { t } = useTranslation('landing');
    const navigate = useNavigate();
    const [loading, setLoading] = useState(null);

    const translatedPlans = t('pricing.plans', { returnObjects: true }) || {};

    const PLANS = [
        {
            key:     'free',
            name:    'Free',
            price:   '€0',
            period:  '',
            tagline: translatedPlans.free?.tagline,
            cta:     translatedPlans.free?.cta,
            ctaStyle: 'btn-ghost',
            features: translatedPlans.free?.features || [],
            locked: translatedPlans.free?.locked || [],
        },
        {
            key:     'creator',
            name:    'Creator',
            price:   '€15',
            period:  '/ month',
            tagline: translatedPlans.creator?.tagline,
            cta:     translatedPlans.creator?.cta,
            ctaStyle: 'btn-primary',
            highlight: true,
            features: translatedPlans.creator?.features || [],
            locked: translatedPlans.creator?.locked || [],
        },
        {
            key:     'pro',
            name:    'Pro',
            price:   '€35',
            period:  '/ month',
            tagline: translatedPlans.pro?.tagline,
            cta:     translatedPlans.pro?.cta,
            ctaStyle: 'btn-ghost',
            features: translatedPlans.pro?.features || [],
            locked: translatedPlans.pro?.locked || [],
        },
    ];

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
                        <span>{t('pricing.eyebrow')}</span>
                    </div>
                    <h2 className="display" style={{ fontSize: 'clamp(36px, 5vw, 64px)', margin: '0 0 16px' }}>
                        {t('pricing.headline')}
                    </h2>
                    <p className="body-lg" style={{ margin: 0, color: 'var(--fg-2)', maxWidth: 520, marginInline: 'auto' }}>
                        {t('pricing.subtitle')}
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
    const { t } = useTranslation('landing');
    const quotes = t('socialProof.quotes', { returnObjects: true }) || [];

    return (
        <section style={{ padding: "80px 0", background: "var(--bg-2)" }}>
            <div className="wrap">
                <div style={{ display: "grid", gap: 32 }} className="grid-cols-1 md:grid-cols-2">
                    {quotes.map((q, i) => (
                        <div key={i} className="card" style={{ padding: 40, border: "0.5px solid var(--line)" }}>
                            <div style={{ color: "var(--accent)", marginBottom: 20 }}>
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/>
                                </svg>
                            </div>
                            <p style={{ fontSize: 20, fontStyle: "italic", lineHeight: 1.5, marginBottom: 24 }}>
                                "{q.text}"
                            </p>
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--line)", flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 15 }}>{q.author}</div>
                                    <div style={{ color: "var(--fg-3)", fontSize: 14 }}>{q.role}</div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

const FinalCTA = () => {
    const { t } = useTranslation('landing');
    return (
        <section style={{ position: "relative", overflow: "hidden", paddingTop: 140, paddingBottom: 140 }}>
            <div className="aurora" />
            <div className="wrap" style={{ position: "relative", zIndex: 2, textAlign: "center", display: "flex", flexDirection: "column", gap: 28, alignItems: "center" }}>
                <h2 className="display" style={{ fontSize: "clamp(48px, 6.4vw, 96px)" }}>
                    {t('finalCta.headline').split('\n').map((line, i, arr) => (
                        <React.Fragment key={i}>
                            {i === arr.length - 1 ? <em>{line}</em> : line}
                            {i < arr.length - 1 && <br />}
                        </React.Fragment>
                    ))}
                </h2>
                <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
                    <button onClick={() => window.location.href='#pricing'} className="btn btn-primary" style={{ padding: "0 32px", height: 48, fontSize: 16 }}>
                        {t('finalCta.cta')} <ArrowRight className="w-5 h-5 ml-1" />
                    </button>
                </div>
                <div className="caption" style={{ marginTop: 8 }}>
                    {t('finalCta.caption')}
                </div>
            </div>
        </section>
    );
};

const Footer = () => {
    const { t } = useTranslation('common');

    const cols = [
        {
            key: 'company',
            label: t('footer.company'),
            items: [{ label: t('footer.links.about'), href: '/about' }],
        },
        {
            key: 'legal',
            label: t('footer.legal'),
            items: [
                { label: t('footer.links.privacyPolicy'), href: '/privacy' },
                { label: t('footer.links.cookiePolicy'), href: '/cookie-policy' },
                { label: t('footer.links.yourData'), href: '/data' },
            ],
        },
    ];

    return (
        <footer style={{ borderTop: "0.5px solid var(--line)", padding: "64px 0 32px", background: "var(--bg)" }}>
            <div className="wrap grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr_1fr]" style={{ display: "grid", gap: 56 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Logo size={32} />
                    <p className="body" style={{ fontSize: 13.5, margin: 0, maxWidth: 280 }}>
                        {t('footer.tagline')}
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
                        <div style={{ display: "flex" }}>
                            <a href="/gdpr" style={{ textDecoration: 'none' }}>
                                <span className="tag" style={{ border: "0.5px solid var(--line-strong)", background: "var(--bg-2)", cursor: "pointer" }}>{t('footer.gdpr')}</span>
                            </a>
                        </div>
                    </div>
                </div>
                {cols.map(col => (
                    <div key={col.key} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div className="mono" style={{ color: "var(--fg-4)" }}>{col.label.toUpperCase()}</div>
                        {col.items.map(item => (
                            <a key={item.href} href={item.href} style={{ fontSize: 13.5, color: "var(--fg-2)" }} className="hover:text-foreground transition-colors">{item.label}</a>
                        ))}
                    </div>
                ))}
            </div>
            <div className="wrap" style={{ marginTop: 56, paddingTop: 24, borderTop: "0.5px solid var(--line-soft)",
                display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                <span className="caption">{t('footer.copyright')}</span>
                <span className="caption">{t('footer.madeWith')}</span>
            </div>
        </footer>
    );
};

// ── Page composition ──────────────────────────────────────────────────────────
const HomePage = () => {
    return (
        <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)] font-sans selection:bg-accent selection:text-white">
            <Nav />
            <main>
                <Hero />
                <ProblemSection />
                <FeatureMoments />
                <BeforeAfterSection />
                <PersonasSection />
                <Exports />
                <AntiDescript />
                <Pricing />
                <SocialProof />
                <FinalCTA />
            </main>
            <Footer />
        </div>
    );
};

export default HomePage;
