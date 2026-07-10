import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function CookiePolicyPage() {
    const navigate = useNavigate();

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', padding: '80px 24px 120px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <button
                    onClick={() => navigate(-1)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 48 }}
                >
                    <ArrowLeft size={16} /> Back
                </button>

                <div className="mono" style={{ color: 'var(--fg-4)', fontSize: 11, letterSpacing: '0.1em', marginBottom: 16 }}>
                    LEGAL
                </div>
                <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                    Cookie Policy
                </h1>
                <p style={{ color: 'var(--fg-3)', fontSize: 14, margin: '0 0 48px' }}>
                    Last updated: June 2026 · Vibed Studio
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40, lineHeight: 1.75, fontSize: 15, color: 'var(--fg-2)' }}>
                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>What are cookies?</h2>
                        <p style={{ margin: 0 }}>
                            Cookies are small text files placed on your device when you visit a website. They are widely used to make
                            websites work, or work more efficiently, and to provide information to website owners.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>Cookies we use</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {[
                                {
                                    name: 'Authentication (Supabase)',
                                    type: 'Strictly necessary',
                                    purpose: 'Keeps you signed in during your session. Without this cookie you would be logged out on every page.',
                                    duration: 'Session / 1 year',
                                    canOptOut: false,
                                },
                                {
                                    name: 'Cookie consent (Iubenda)',
                                    type: 'Strictly necessary',
                                    purpose: 'Stores your cookie consent preferences so we do not show the banner on every visit.',
                                    duration: '1 year',
                                    canOptOut: false,
                                },
                                {
                                    name: 'Analytics',
                                    type: 'Optional',
                                    purpose: 'We do not currently use any third-party analytics cookies. If this changes we will update this policy and request fresh consent.',
                                    duration: 'N/A',
                                    canOptOut: true,
                                },
                            ].map(c => (
                                <div key={c.name} style={{
                                    padding: 20,
                                    borderRadius: 10,
                                    border: '0.5px solid var(--line)',
                                    background: 'var(--bg-2)',
                                    display: 'flex', flexDirection: 'column', gap: 6,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                        <span style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 14 }}>{c.name}</span>
                                        <span style={{
                                            fontSize: 11, fontWeight: 600, letterSpacing: '0.06em',
                                            padding: '2px 10px', borderRadius: 999,
                                            background: c.canOptOut ? 'var(--bg)' : 'color-mix(in srgb, var(--accent) 15%, transparent)',
                                            color: c.canOptOut ? 'var(--fg-3)' : 'var(--accent)',
                                            border: '0.5px solid var(--line)',
                                        }}>
                                            {c.type.toUpperCase()}
                                        </span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: 13.5 }}>{c.purpose}</p>
                                    <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>Duration: {c.duration}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>Managing your preferences</h2>
                        <p style={{ margin: '0 0 12px' }}>
                            You can review and change your cookie preferences at any time by clicking the cookie settings link in the
                            footer. You can also delete cookies through your browser settings — note that doing so may affect how
                            the site works.
                        </p>
                        <p style={{ margin: 0 }}>
                            For more detail on how we handle your personal data, see our{' '}
                            <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'none' }}>Privacy Policy</a>.
                        </p>
                    </section>

                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>Contact</h2>
                        <p style={{ margin: 0 }}>
                            Questions about this policy?{' '}
                            <a href="mailto:marc@vibedstudio.com" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                                marc@vibedstudio.com
                            </a>
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
