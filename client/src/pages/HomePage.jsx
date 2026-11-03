import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import Logo from '../components/Logo';
import { openConsentSettings } from '../lib/consent';
import './landing/landing.css';
import LandingHero from './landing/Hero';
import { HowItWorks, SpeedProof, Repurpose, ScriptFlow } from './landing/Sections';
import { MidCta, CraftGrid, TrustBar, PricingV2, Faq, FinalCtaV2 } from './landing/Closing';

// ── Navigation ────────────────────────────────────────────────────────────────
const Nav = () => {
    const [scrolled, setScrolled] = useState(false);
    const [user, setUser] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
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

    // Close the mobile menu automatically once the viewport grows back past
    // the breakpoint where everything fits inline again.
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 640px)');
        const handleChange = (e) => { if (e.matches) setMenuOpen(false); };
        mq.addEventListener?.('change', handleChange);
        return () => mq.removeEventListener?.('change', handleChange);
    }, []);

    return (
        <nav style={{
            position: "fixed", top: 16, left: 0, right: 0, zIndex: 50,
            display: "flex", justifyContent: "center", pointerEvents: "none",
        }}>
            <div className={`nav-pill${menuOpen ? ' nav-pill-open' : ''}`} style={{
                pointerEvents: "auto",
                display: "flex", alignItems: "center", gap: 28,
                padding: "10px 12px 10px 22px",
                borderRadius: 999,
                maxWidth: "calc(100vw - 24px)",
                background: scrolled ? "var(--glass-2)" : "transparent",
                border: `0.5px solid ${scrolled ? "var(--glass-stroke)" : "transparent"}`,
                backdropFilter: scrolled ? "blur(20px) saturate(160%)" : "none",
                WebkitBackdropFilter: scrolled ? "blur(20px) saturate(160%)" : "none",
                transition: "all 0.3s ease",
            }}>
                <Logo />

                {/* Desktop nav links — inline from sm upward, hidden on mobile
                    (mobile gets them inside the expandable menu instead).
                    NOTE: visibility is controlled by the .nav-only-desktop
                    class in index.css, not Tailwind's hidden/sm:flex — this
                    project has no tailwind.config/postcss.config wired into
                    the Vite build, so those utility classes compile to
                    nothing and were silently no-ops. */}
                <div style={{ gap: 22, fontSize: 13.5, color: "var(--fg-2)" }} className="nav-only-desktop font-medium">
                    <a href="#how" className="hover:text-foreground transition-colors">{t('nav.how')}</a>
                    <a href="#features" className="hover:text-foreground transition-colors">{t('nav.features')}</a>
                    <a href="#pricing" className="hover:text-foreground transition-colors">{t('nav.pricing')}</a>
                </div>

                {/* Mobile-only expandable row: nav links and (when logged out)
                    the "log in" button — everything that isn't essential on
                    a phone. The language switcher stays primary/always-visible
                    (see below). Collapsed by default; the hamburger toggle
                    below expands the pill horizontally to reveal this as a
                    scrollable row. */}
                <div className={`nav-mobile-expand${menuOpen ? ' nav-mobile-expand-open' : ''}`}>
                    <a href="#how" onClick={() => setMenuOpen(false)}>{t('nav.how')}</a>
                    <a href="#features" onClick={() => setMenuOpen(false)}>{t('nav.features')}</a>
                    <a href="#pricing" onClick={() => setMenuOpen(false)}>{t('nav.pricing')}</a>
                    {user ? (
                        <span style={{
                            fontSize: 12.5, color: "var(--fg-3)", padding: "0 4px",
                            display: "flex", alignItems: "center", flexShrink: 0,
                        }}>
                            <span style={{ whiteSpace: "nowrap" }}>{user.email}</span>
                        </span>
                    ) : (
                        <button className="btn btn-ghost" style={{ height: 32, padding: "0 14px", fontSize: 13, flexShrink: 0 }} onClick={() => { setMenuOpen(false); navigate('/auth'); }}>{t('nav.logIn')}</button>
                    )}
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {/* Language switcher is a primary, always-visible element —
                        shown on mobile too, not tucked into the expand menu. */}
                    <div className="nav-only-mobile" style={{ flexShrink: 0 }}>
                        <LanguageSwitcher />
                    </div>

                    {/* Desktop-only: language switcher + secondary auth action,
                        inline from sm upward (mobile has the switcher above and
                        the auth action in the expand row). */}
                    <div className="nav-only-desktop" style={{ gap: 8, alignItems: "center" }}>
                        <LanguageSwitcher />
                        {user ? (
                            <span style={{
                                fontSize: 12.5, color: "var(--fg-3)", padding: "0 12px",
                                display: "flex", alignItems: "center",
                                maxWidth: "clamp(80px, 20vw, 200px)", overflow: "hidden",
                            }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                                    {user.email}
                                </span>
                            </span>
                        ) : (
                            <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/auth')}>{t('nav.logIn')}</button>
                        )}
                    </div>

                    {/* Mobile-only hamburger toggle for the expandable row above. */}
                    <button
                        className="nav-hamburger nav-only-mobile"
                        onClick={() => setMenuOpen(o => !o)}
                        aria-label={menuOpen ? t('nav.closeMenu', 'Close menu') : t('nav.openMenu', 'Open menu')}
                        aria-expanded={menuOpen}
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: 32, height: 32, borderRadius: "50%", border: "none",
                            background: "transparent", color: "var(--fg-2)", cursor: "pointer", flexShrink: 0,
                        }}
                    >
                        {menuOpen ? <X size={17} /> : <Menu size={17} />}
                    </button>

                    {user ? (
                        <button className="btn btn-ghost" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => navigate('/dashboard')}>{t('nav.account')}</button>
                    ) : (
                        <button className="btn btn-primary" style={{ height: 36, padding: "0 16px", fontSize: 13 }} onClick={() => window.location.href='/auth'}>{t('nav.startFree')}</button>
                    )}
                </div>
            </div>
        </nav>
    );
};

// ── Footer ────────────────────────────────────────────────────────────────────
const Footer = () => {
    const { t } = useTranslation('common');

    const cols = [
        {
            key: 'legal',
            label: t('footer.legal'),
            items: [
                { label: t('footer.links.terms'), href: '/terms' },
                { label: t('footer.links.privacyPolicy'), href: '/privacy' },
                { label: t('footer.links.cookiePolicy'), href: '/cookie-policy' },
                { label: t('footer.links.yourData'), href: '/data' },
                { label: t('footer.links.gdpr'), href: '/gdpr' },
                { label: t('footer.links.legalNotice'), href: '/legal' },
                { label: t('footer.links.cookieSettings'), href: '#cookie-settings', onClick: openConsentSettings },
            ],
        },
    ];

    return (
        <footer style={{ borderTop: "0.5px solid var(--line)", padding: "64px 0 32px", background: "var(--bg)" }}>
            <div className="wrap landing-footer-grid">
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <Logo size={32} />
                    <p className="body" style={{ fontSize: 13.5, margin: 0, maxWidth: 280 }}>
                        {t('footer.tagline')}
                    </p>
                </div>
                {cols.map(col => (
                    <div key={col.key} className="landing-footer-legal">
                        <div className="mono" style={{ color: "var(--fg-4)" }}>{col.label.toUpperCase()}</div>
                        <div className="landing-footer-legal-links">
                            {col.items.map(item => (
                                item.onClick ? (
                                    <button key={item.href} type="button" onClick={item.onClick} style={{ font: "inherit", fontSize: 13.5, color: "var(--fg-2)", background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer" }} className="hover:text-foreground transition-colors">{item.label}</button>
                                ) : (
                                    <a key={item.href} href={item.href} style={{ fontSize: 13.5, color: "var(--fg-2)" }} className="hover:text-foreground transition-colors">{item.label}</a>
                                )
                            ))}
                        </div>
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
// Section order mirrors the landing design: the promise, how it works, the time
// it saves, what it does with one recording, how it reads a reference, a CTA at
// the midpoint, the craft details, trust, pricing, objections, and a final CTA.
const HomePage = () => {
    return (
        <div className="vibed-landing min-h-screen">
            <Nav />
            <main>
                <LandingHero />
                <HowItWorks />
                <SpeedProof />
                <Repurpose />
                <ScriptFlow />
                <MidCta />
                <CraftGrid />
                <TrustBar />
                <PricingV2 />
                <Faq />
                <FinalCtaV2 />
            </main>
            <Footer />
        </div>
    );
};

export default HomePage;
