import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, HardDrive, Lock, Eye, Trash2, Mail, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
        <h2 style={{ fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700, color: 'var(--fg)', marginBottom: 14, lineHeight: 1.3 }}>{title}</h2>
        <div style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-2)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {children}
        </div>
    </div>
);

const FaqItem = ({ question, answer }) => {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ borderBottom: '0.5px solid var(--line-soft)', padding: '16px 0' }}>
            <button
                onClick={() => setOpen(!open)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
            >
                <span style={{ fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{question}</span>
                {open ? <ChevronUp size={16} color="var(--fg-3)" /> : <ChevronDown size={16} color="var(--fg-3)" />}
            </button>
            {open && (
                <div style={{ marginTop: 12, fontFamily: 'var(--f-sans)', fontSize: 14.5, color: 'var(--fg-2)', lineHeight: 1.7 }}>
                    {answer}
                </div>
            )}
        </div>
    );
};

const DataPage = () => {
    const navigate = useNavigate();
    const { t } = useTranslation('data');

    const cards   = t('cards',     { returnObjects: true });
    const faqItems = t('faq.items', { returnObjects: true });

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
                    <p style={{ fontFamily: 'var(--f-sans)', fontSize: 17, color: 'var(--fg-3)', lineHeight: 1.75, maxWidth: 560 }}>
                        {t('subtitle')}
                    </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 56 }}>
                    {cards.map(card => (
                        <div key={card.title} style={{ padding: 20, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)', textTransform: 'uppercase' }}>{card.title}</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, color: 'var(--fg)' }}>{card.value}</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 13, color: 'var(--fg-3)' }}>{card.detail}</div>
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

                    <Section title={t('sections.upload.title')}>
                        <p>{t('sections.upload.p1')}</p>
                        <p>{t('sections.upload.p2')}</p>
                    </Section>

                    <Section title={t('sections.ai.title')}>
                        <p>{t('sections.ai.p1')}</p>
                        <p>{t('sections.ai.p2')}</p>
                    </Section>

                    <Section title={t('sections.deletion.title')}>
                        <p>{t('sections.deletion.p1')}</p>
                        <p>{t('sections.deletion.p2')}</p>
                        <p>{t('sections.deletion.p3')}</p>
                    </Section>

                    <div style={{ paddingTop: 16 }}>
                        <h2 style={{ fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700, color: 'var(--fg)', marginBottom: 20, lineHeight: 1.3 }}>
                            {t('faq.title')}
                        </h2>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            {faqItems.map((item, i) => (
                                <FaqItem
                                    key={i}
                                    question={item.question}
                                    answer={
                                        item.answerPrefix
                                            ? <>{item.answerPrefix}<a href="/privacy" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>{item.answerLinkText}</a>{item.answerSuffix}</>
                                            : item.answer
                                    }
                                />
                            ))}
                        </div>
                    </div>

                    <div style={{
                        marginTop: 32, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
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

export default DataPage;
