import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ShieldCheck, Mail, Database, UserCheck, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
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

const GdprPage = () => {
    const navigate = useNavigate();
    const { t } = useTranslation(['gdpr', 'common']);

    const cards       = t('cards', { returnObjects: true });
    const rightsIcons = [Database, Trash2, UserCheck, ShieldCheck];
    const rightsItems = t('rights.items', { returnObjects: true });

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
                        <ArrowLeft size={14} /> {t('common:nav.backToVibed')}
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
                        {t('title')}
                    </h1>
                    <p style={{
                        fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)',
                        lineHeight: 1.75, maxWidth: 560,
                    }}>
                        {t('subtitle')}
                    </p>
                </div>

                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16,
                    marginBottom: 56
                }}>
                    {cards.map(card => (
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
                    <Section title={t('rights.sectionTitle')}>
                        <p>{t('rights.intro')}</p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
                            {rightsItems.map((item, idx) => {
                                const Icon = rightsIcons[idx];
                                return (
                                    <div key={idx} style={{ display: 'flex', gap: 14 }}>
                                        {Icon && <Icon className="w-5 h-5 text-accent mt-1 flex-shrink-0" />}
                                        <div>
                                            <div style={{ fontWeight: 600, color: 'var(--fg)' }}>{item.title}</div>
                                            <div style={{ fontSize: 14, color: 'var(--fg-3)', lineHeight: 1.6 }}>{item.text}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </Section>

                    <Section title={t('exercise.sectionTitle')}>
                        <p>{t('exercise.p1')}</p>
                        <div style={{
                            marginTop: 16, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                            border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                            borderRadius: 12, textAlign: 'center'
                        }}>
                            <p style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)', marginBottom: 8, fontWeight: 500 }}>
                                {t('exercise.ctaPrompt')}
                            </p>
                            <a href="mailto:marc@vibedstudio.com" style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none' }}>
                                marc@vibedstudio.com
                            </a>
                        </div>
                    </Section>
                </div>
            </main>
        </div>
    );
};

export default GdprPage;
