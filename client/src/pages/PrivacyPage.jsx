import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Scale, Mail, FileText, Database, Settings } from 'lucide-react';
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

const Section = ({ title, icon: Icon, children }) => (
    <div style={{ paddingBottom: 40, borderBottom: '0.5px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            {Icon && <Icon className="w-6 h-6 text-accent" />}
            <h2 style={{ fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700, color: 'var(--fg)', lineHeight: 1.3, margin: 0 }}>{title}</h2>
        </div>
        <div style={{ fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-2)', lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {children}
        </div>
    </div>
);

const PrivacyPage = () => {
    const navigate = useNavigate();
    const { t } = useTranslation('privacy');

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
                        {t('lastUpdated')} {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

                    <Section title={t('sections.controller.title')} icon={Scale}>
                        <p>{t('sections.controller.intro')}</p>
                        <div style={{ padding: 20, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)', borderRadius: 12, marginTop: 8 }}>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>VIBED (Vibed studio)</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                47 avenue du President Franklin Roosevelt<br/>
                                94320, THIAIS<br/>
                                France
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--accent)', marginTop: 8 }}>
                                <a href="mailto:marc@vibedstudio.com" style={{ color: 'inherit', textDecoration: 'none' }}>marc@vibedstudio.com</a>
                            </div>
                        </div>
                    </Section>

                    <Section title={t('sections.legalBasis.title')} icon={FileText}>
                        <p>{t('sections.legalBasis.intro')}</p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.legalBasis.contractual.label')}</strong> {t('sections.legalBasis.contractual.body')}</li>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.legalBasis.legitimate.label')}</strong> {t('sections.legalBasis.legitimate.body')}</li>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.legalBasis.consent.label')}</strong> {t('sections.legalBasis.consent.body')}</li>
                        </ul>
                    </Section>

                    <Section title={t('sections.retention.title')} icon={Database}>
                        <p>{t('sections.retention.intro')}</p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <li><strong>{t('sections.retention.account.label')}</strong> {t('sections.retention.account.body')}</li>
                            <li><strong>{t('sections.retention.free.label')}</strong> {t('sections.retention.free.body')}</li>
                            <li><strong>{t('sections.retention.creator.label')}</strong> {t('sections.retention.creator.body')}</li>
                            <li><strong>{t('sections.retention.pro.label')}</strong> {t('sections.retention.pro.body')}</li>
                        </ul>
                        <p style={{ marginTop: 8 }}>{t('sections.retention.storage')}</p>
                    </Section>

                    <Section title={t('sections.rights.title')} icon={Settings}>
                        <p>{t('sections.rights.intro')}</p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.rights.access.label')}</strong> {t('sections.rights.access.body')}</li>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.rights.erasure.label')}</strong> {t('sections.rights.erasure.body')}</li>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.rights.portability.label')}</strong> {t('sections.rights.portability.body')}</li>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.rights.rectification.label')}</strong> {t('sections.rights.rectification.body')}</li>
                            <li><strong style={{ color: 'var(--fg)' }}>{t('sections.rights.object.label')}</strong> {t('sections.rights.object.body')}</li>
                        </ul>
                        <p style={{ marginTop: 12 }}>{t('sections.rights.footer')}</p>
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

export default PrivacyPage;
