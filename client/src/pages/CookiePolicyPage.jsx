import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function CookiePolicyPage() {
    const navigate = useNavigate();
    const { t } = useTranslation(['cookies', 'common']);

    const cookieItems = t('section2.items', { returnObjects: true });

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', padding: '80px 24px 120px' }}>
            <div style={{ maxWidth: 720, margin: '0 auto' }}>
                <button
                    onClick={() => navigate(-1)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: 'var(--fg-3)', cursor: 'pointer', fontSize: 14, padding: 0, marginBottom: 48 }}
                >
                    <ArrowLeft size={16} /> {t('common:nav.back')}
                </button>

                <div className="mono" style={{ color: 'var(--fg-4)', fontSize: 11, letterSpacing: '0.1em', marginBottom: 16 }}>
                    {t('eyebrow')}
                </div>
                <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--fg-3)', fontSize: 14, margin: '0 0 48px' }}>
                    {t('lastUpdated')}
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40, lineHeight: 1.75, fontSize: 15, color: 'var(--fg-2)' }}>
                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>{t('section1.title')}</h2>
                        <p style={{ margin: 0 }}>
                            {t('section1.body')}
                        </p>
                    </section>

                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>{t('section2.title')}</h2>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {cookieItems.map(c => (
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
                                            background: c.type === 'Optional' || c.type === 'Optionnel' ? 'var(--bg)' : 'color-mix(in srgb, var(--accent) 15%, transparent)',
                                            color: c.type === 'Optional' || c.type === 'Optionnel' ? 'var(--fg-3)' : 'var(--accent)',
                                            border: '0.5px solid var(--line)',
                                        }}>
                                            {c.type.toUpperCase()}
                                        </span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: 13.5 }}>{c.purpose}</p>
                                    <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>{t('section2.durationLabel')} {c.duration}</span>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>{t('section3.title')}</h2>
                        <p style={{ margin: '0 0 12px' }}>
                            {t('section3.p1')}
                        </p>
                        <p style={{ margin: 0 }}>
                            {t('section3.p2Pre')}
                            <a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{t('section3.p2LinkText')}</a>
                            {t('section3.p2Post')}
                        </p>
                    </section>

                    <section>
                        <h2 style={{ color: 'var(--fg)', fontWeight: 600, fontSize: 18, margin: '0 0 12px' }}>{t('section4.title')}</h2>
                        <p style={{ margin: 0 }}>
                            {t('section4.p1Pre')}
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
