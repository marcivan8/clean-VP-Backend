import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Scale, Mail, FileText, Database, Settings } from 'lucide-react';
import { Logo } from '../components/Logo.jsx';

const Section = ({ title, icon: Icon, children }) => (
    <div style={{ paddingBottom: 40, borderBottom: '0.5px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            {Icon && <Icon className="w-6 h-6 text-accent" />}
            <h2 style={{
                fontFamily: 'var(--f-sans)', fontSize: 20, fontWeight: 700,
                color: 'var(--fg)', lineHeight: 1.3, margin: 0
            }}>{title}</h2>
        </div>
        <div style={{
            fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg-2)',
            lineHeight: 1.8, display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            {children}
        </div>
    </div>
);

const PrivacyPage = () => {
    const navigate = useNavigate();
    const { t, i18n } = useTranslation(['privacy', 'common']);

    const localeTag  = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-US';
    const lastUpdated = new Date().toLocaleDateString(localeTag, { month: 'long', day: 'numeric', year: 'numeric' });

    const s1Address    = t('section1.addressLines', { returnObjects: true });
    const s2Items      = t('section2.items', { returnObjects: true });
    const s3Items      = t('section3.items', { returnObjects: true });
    const s4Items      = t('section4.items', { returnObjects: true });

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
                        {t('lastUpdated', { date: lastUpdated })}
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

                    <Section title={t('section1.title')} icon={Scale}>
                        <p>{t('section1.p1')}</p>
                        <div style={{
                            padding: 20, background: 'var(--bg-2)', border: '0.5px solid var(--line-soft)',
                            borderRadius: 12, marginTop: 8
                        }}>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 16, fontWeight: 600, color: 'var(--fg)', marginBottom: 4 }}>{t('section1.companyName')}</div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}>
                                {s1Address.map((line, idx) => (
                                    <React.Fragment key={idx}>
                                        {line}
                                        {idx < s1Address.length - 1 && <br />}
                                    </React.Fragment>
                                ))}
                            </div>
                            <div style={{ fontFamily: 'var(--f-sans)', fontSize: 14, color: 'var(--accent)', marginTop: 8 }}>
                                <a href="mailto:marc@vibedstudio.com" style={{ color: 'inherit', textDecoration: 'none' }}>marc@vibedstudio.com</a>
                            </div>
                        </div>
                    </Section>

                    <Section title={t('section2.title')} icon={FileText}>
                        <p>{t('section2.p1')}</p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {s2Items.map((item, idx) => (
                                <li key={idx}>
                                    <strong style={{ color: 'var(--fg)' }}>{item.label}</strong> {item.text}
                                </li>
                            ))}
                        </ul>
                    </Section>

                    <Section title={t('section3.title')} icon={Database}>
                        <p>{t('section3.p1')}</p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {s3Items.map((item, idx) => (
                                <li key={idx}><strong>{item.label}</strong> {item.text}</li>
                            ))}
                        </ul>
                        <p style={{ marginTop: 8 }}>{t('section3.p2')}</p>
                    </Section>

                    <Section title={t('section4.title')} icon={Settings}>
                        <p>{t('section4.p1')}</p>
                        <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {s4Items.map((item, idx) => (
                                <li key={idx}><strong style={{ color: 'var(--fg)' }}>{item.label}</strong> {item.text}</li>
                            ))}
                        </ul>
                        <p style={{ marginTop: 12 }}>{t('section4.p2')}</p>
                    </Section>

                    <div style={{
                        marginTop: 16, padding: 24, background: 'color-mix(in oklch, var(--accent) 8%, transparent)',
                        border: '0.5px solid color-mix(in oklch, var(--accent) 20%, transparent)',
                        borderRadius: 12, textAlign: 'center'
                    }}>
                        <p style={{
                            fontFamily: 'var(--f-sans)', fontSize: 15, color: 'var(--fg)',
                            marginBottom: 8, fontWeight: 500,
                        }}>
                            {t('cta.prompt')}
                        </p>
                        <a
                            href="mailto:marc@vibedstudio.com"
                            style={{
                                fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--accent)', textDecoration: 'none'
                            }}
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
