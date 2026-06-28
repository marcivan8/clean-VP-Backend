import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo.jsx';

const Section = ({ title, children }) => (
    <div style={{ paddingBottom: 40, borderBottom: '0.5px solid var(--line-soft)' }}>
        <h2 style={{ fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700, color: 'var(--fg)', marginBottom: 14, lineHeight: 1.3 }}>{title}</h2>
        <div style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-2)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {children}
        </div>
    </div>
);

export default function CookiePolicyPage() {
    const navigate = useNavigate();
    const { t } = useTranslation('cookies');

    const cookieItems = t('cookiesWeUse.items', { returnObjects: true });

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
                        <ArrowLeft size={14} /> {t('back')}
                    </button>
                    <Logo size={22} />
                </div>
            </nav>

            <main style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px 96px' }}>
                <div style={{ marginBottom: 56 }}>
                    <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>
                        {t('eyebrow')}
                    </div>
                    <h1 style={{ fontFamily: 'var(--f-display)', fontSize: 'clamp(32px, 5vw, 48px)', fontWeight: 800, lineHeight: 1.15, color: 'var(--fg)', marginBottom: 20 }}>
                        {t('title')}
                    </h1>
                    <p style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-3)', lineHeight: 1.75 }}>
                        {t('lastUpdated')}
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

                    <Section title={t('whatAreCookies.title')}>
                        <p>{t('whatAreCookies.body')}</p>
                    </Section>

                    <Section title={t('cookiesWeUse.title')}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
                            {cookieItems.map(c => (
                                <div key={c.name} style={{
                                    padding: 20, borderRadius: 12,
                                    border: '0.5px solid var(--line-soft)',
                                    background: 'var(--bg-2)',
                                    display: 'flex', flexDirection: 'column', gap: 8,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                        <span style={{ fontFamily: 'var(--f-sans)', fontWeight: 600, color: 'var(--fg)', fontSize: 14 }}>{c.name}</span>
                                        <span style={{
                                            fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
                                            padding: '3px 10px', borderRadius: 999,
                                            background: c.canOptOut ? 'var(--bg)' : 'color-mix(in oklch, var(--accent) 15%, transparent)',
                                            color: c.canOptOut ? 'var(--fg-3)' : 'var(--accent)',
                                            border: '0.5px solid var(--line-soft)',
                                        }}>
                                            {c.type.toUpperCase()}
                                        </span>
                                    </div>
                                    <p style={{ margin: 0, fontFamily: 'var(--f-sans)', fontSize: 13.5, color: 'var(--fg-2)', lineHeight: 1.6 }}>{c.purpose}</p>
                                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-4)' }}>
                                        {t('cookiesWeUse.duration', { value: c.duration })}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </Section>

                    <Section title={t('managing.title')}>
                        <p>{t('managing.p1')}</p>
                        <p>
                            {t('managing.p2Prefix')}
                            <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>
                                {t('managing.p2Link')}
                            </a>
                            {t('managing.p2Suffix')}
                        </p>
                    </Section>

                    <div style={{
                        marginTop: 16, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                        borderRadius: 12, textAlign: 'center'
                    }}>
                        <p style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)', marginBottom: 8, fontWeight: 500 }}>
                            {t('contact.body')}
                        </p>
                        <a
                            href="mailto:marc@vibedstudio.com"
                            style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}
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
}
