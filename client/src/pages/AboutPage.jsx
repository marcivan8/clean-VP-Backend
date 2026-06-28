import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, CheckCircle2, Link as LinkIcon, Heart, User, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo.jsx';

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

const beliefIcons = [CheckCircle2, LinkIcon, Play, Heart];

const AboutPage = () => {
    const navigate = useNavigate();
    const { t } = useTranslation('about');

    const journeyItems = t('journey.items', { returnObjects: true });
    const beliefItems  = t('beliefs.items',  { returnObjects: true });
    const founderTags  = t('founder.tags',   { returnObjects: true });

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
                    <div style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)',
                        textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16,
                    }}>{t('eyebrow')}</div>
                    <h1 style={{
                        fontFamily: 'var(--f-display)', fontSize: 'clamp(32px, 5vw, 48px)',
                        fontWeight: 800, lineHeight: 1.15, color: 'var(--fg)', marginBottom: 20,
                    }}>
                        {t('headline')}
                    </h1>
                    <p style={{ fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)', lineHeight: 1.75, maxWidth: 560 }}>
                        {t('intro1')}
                    </p>
                    <p style={{ fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)', lineHeight: 1.75, maxWidth: 560, marginTop: 16 }}>
                        {t('intro2')}
                    </p>
                    <p style={{ fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg)', fontWeight: 500, lineHeight: 1.75, maxWidth: 560, marginTop: 16 }}>
                        {t('intro3')}
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

                    <Section title={t('journey.title')}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 8 }}>
                            {journeyItems.map((item, i) => (
                                <div key={i} style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                        <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'var(--accent)', marginTop: 4 }} />
                                        {i < journeyItems.length - 1 && (
                                            <div style={{ flex: 1, width: 2, background: 'var(--line-soft)', marginTop: 8, marginBottom: 8 }} />
                                        )}
                                    </div>
                                    <div>
                                        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--fg-4)', textTransform: 'uppercase', marginBottom: 4 }}>{item.date}</div>
                                        <div style={{ fontWeight: 600, color: 'var(--fg)', fontSize: 16, marginBottom: 6 }}>{item.title}</div>
                                        <div style={{ color: 'var(--fg-2)', fontSize: 15, lineHeight: 1.6 }}>{item.body}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    <Section title={t('beliefs.title')}>
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {beliefItems.map((item, i) => {
                                const Icon = beliefIcons[i];
                                return (
                                    <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                                        <Icon className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                                        <div>
                                            <strong style={{ color: 'var(--fg)', display: 'block', marginBottom: 4 }}>{item.title}</strong>
                                            {item.body}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </Section>

                    <Section title={t('audience.title')}>
                        <p>{t('audience.p1')}</p>
                        <p>{t('audience.p2')}</p>
                    </Section>

                    <Section title={t('founder.title')}>
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
                                        {t('founder.role')}
                                        <span>·</span>
                                        <MapPin size={12} /> {t('founder.location')}
                                    </div>
                                </div>
                            </div>
                            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--fg-2)' }}>
                                {t('founder.bio')}
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                                {founderTags.map(tag => (
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
                        <p style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)', marginBottom: 8, fontWeight: 500 }}>
                            {t('contact.prompt')}
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
};

export default AboutPage;
