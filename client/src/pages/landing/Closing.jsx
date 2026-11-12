import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './LandingIcons';
import CtaObject from './CtaObject';
import { createCheckout, goToSignup } from './checkout';

/* Mid-page CTA band ------------------------------------------------------- */

export const MidCta = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-mid-cta" style={{ background: 'var(--vl-bg)' }}>
            <div className="vl-wrap" style={{ padding: 0 }}>
                <div className="vl-mid-cta-card" style={{
                    position: 'relative', overflow: 'hidden', borderRadius: 28,
                    textAlign: 'center',
                    background: 'linear-gradient(135deg, rgba(0,229,255,0.07), rgba(138,43,226,0.07))',
                    border: '1px solid rgba(255,255,255,0.12)',
                }}>
                    <CtaObject className="vl-canvas-host vl-drift" style={{
                        position: 'absolute', top: 24, left: '5%',
                        width: 140, height: 140, opacity: 0.75, pointerEvents: 'none',
                    }} />

                    <div style={{ position: 'relative', zIndex: 1 }}>
                        <h2 className="vl-h2" style={{ margin: '0 auto 14px', maxWidth: 640 }}>
                            {t('v2.midCta.title')}
                        </h2>
                        <p className="vl-lead" style={{ margin: '0 auto 30px', maxWidth: 520 }}>
                            {t('v2.midCta.body')}
                        </p>
                        <button className="vl-btn vl-btn-primary" onClick={() => goToSignup('mid')}>
                            {t('v2.cta.primary')}
                            <Icon name="arrowRight" size={16} />
                        </button>
                        <p className="vl-mono" style={{ fontSize: 12, color: 'var(--vl-ink-4)', margin: '16px 0 0' }}>
                            {t('v2.cta.microcopy')}
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};

/* Craft grid -------------------------------------------------------------- */

const CRAFT = [
    { key: 'a', icon: 'scissors' },
    { key: 'b', icon: 'captions' },
    { key: 'c', icon: 'crop' },
    { key: 'd', icon: 'sparkle' },
];

export const CraftGrid = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-sec" id="craft" style={{ background: 'var(--vl-bg-2)' }}>
            <div className="vl-wrap">
                <h2 className="vl-h2" style={{ maxWidth: 700 }}>{t('v2.craft.title')}</h2>
                <p className="vl-lead" style={{ maxWidth: 600, marginBottom: 56 }}>{t('v2.craft.lead')}</p>

                <div className="vl-craft-grid">
                    {CRAFT.map((c) => (
                        <div key={c.key} className="vl-card vl-card-hover" style={{ padding: 30, borderRadius: 18 }}>
                            <span style={{
                                width: 40, height: 40, borderRadius: 11, marginBottom: 20,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.24)',
                            }}>
                                <Icon name={c.icon} size={18} color="var(--vl-cyan-soft)" />
                            </span>
                            <h3 style={{
                                fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 18,
                                color: 'var(--vl-ink)', margin: '0 0 9px',
                            }}>{t(`v2.craft.${c.key}.title`)}</h3>
                            <p style={{ fontSize: 14.5, color: 'var(--vl-ink-3)', lineHeight: 1.6, margin: 0 }}>
                                {t(`v2.craft.${c.key}.body`)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

/* Trust bar --------------------------------------------------------------- */

const TRUST = [
    { key: 'a', icon: 'users' },
    { key: 'b', icon: 'shield' },
    { key: 'c', icon: 'checkCircle' },
    { key: 'd', icon: 'exportOut' },
];

export const TrustBar = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-trust-bar" style={{
            background: 'var(--vl-bg)', padding: '42px 80px',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
            <div className="vl-wrap" style={{
                padding: 0, display: 'flex', flexWrap: 'wrap',
                gap: 44, justifyContent: 'space-between', alignItems: 'center',
            }}>
                {TRUST.map((item) => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                        <Icon name={item.icon} size={17} color="var(--vl-ink-4)" />
                        <span style={{ fontSize: 14, color: 'var(--vl-ink-2)' }}>{t(`v2.trust.${item.key}`)}</span>
                    </div>
                ))}
            </div>
        </section>
    );
};

/* Pricing ----------------------------------------------------------------- */

const PLAN_META = [
    { key: 'free', name: 'Free', price: '€0', period: '' },
    { key: 'creator', name: 'Creator', price: '€15', period: '/ month', highlight: true },
    { key: 'pro', name: 'Pro', price: '€35', period: '/ month' },
];

export const PricingV2 = () => {
    const { t } = useTranslation('landing');
    const [loading, setLoading] = useState(null);

    const plans = t('pricing.plans', { returnObjects: true }) || {};

    const handleUpgrade = async (plan) => {
        if (plan === 'free') { goToSignup('pricing_free'); return; }
        setLoading(plan);
        await createCheckout(plan);
        setLoading(null);
    };

    return (
        <section className="vl-sec" id="pricing" style={{ background: 'var(--vl-bg-2)' }}>
            <div className="vl-wrap">
                <h2 className="vl-h2" style={{ maxWidth: 640 }}>{t('pricing.headline')}</h2>
                <p className="vl-lead" style={{ maxWidth: 540, marginBottom: 56 }}>{t('pricing.subtitle')}</p>

                <div className="vl-price-grid" style={{
                    display: 'grid', gap: 20,
                }}>
                    {PLAN_META.map((meta) => {
                        const data = plans[meta.key] || {};
                        const features = data.features || [];
                        const locked = data.locked || [];
                        // R163 — features that are PUBLISHED but NOT BUILT get their
                        // own list and their own label, because `locked` already
                        // means something else: "this plan does not include it".
                        // Rendering an unbuilt feature as either a check (included)
                        // or a greyed check (not in this plan) was the same claim
                        // the Oct GDPR audit flagged on Pro's seats and queue, and
                        // R162 decided a plan matrix should say "not built yet" in
                        // plain sight instead.
                        const soon = data.soon || [];

                        return (
                            <div
                                key={meta.key}
                                className="vl-card vl-price-card"
                                style={{
                                    position: 'relative',
                                    ...(meta.highlight ? {
                                        background: 'rgba(255,255,255,0.07)',
                                        borderColor: 'rgba(255,255,255,0.22)',
                                        boxShadow: '0 36px 60px -24px rgba(0,0,0,0.6)',
                                    } : null),
                                }}
                            >
                                {meta.highlight && (
                                    <span className="vl-mono" style={{
                                        position: 'absolute', top: -11, left: 30,
                                        fontSize: 10, letterSpacing: '0.12em',
                                        padding: '4px 12px', borderRadius: 999,
                                        background: 'var(--vl-ink)', color: 'var(--vl-bg)', fontWeight: 600,
                                    }}>{t('v2.pricing.popular')}</span>
                                )}

                                <div className="vl-mono" style={{
                                    fontSize: 11, letterSpacing: '0.12em',
                                    color: 'var(--vl-ink-4)', marginBottom: 12,
                                }}>{meta.name.toUpperCase()}</div>

                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginBottom: 10 }}>
                                    <span style={{
                                        fontFamily: 'var(--vl-display)', fontWeight: 800,
                                        fontSize: 42, letterSpacing: '-0.02em', color: 'var(--vl-ink)',
                                    }}>{meta.price}</span>
                                    {meta.period && (
                                        <span style={{ fontSize: 14, color: 'var(--vl-ink-4)' }}>{meta.period}</span>
                                    )}
                                </div>

                                <p style={{
                                    fontSize: 14, color: 'var(--vl-ink-3)', lineHeight: 1.55, margin: '0 0 24px',
                                }}>{data.tagline}</p>

                                <button
                                    className={`vl-btn ${meta.highlight ? 'vl-btn-primary' : 'vl-btn-ghost'}`}
                                    style={{ width: '100%', marginBottom: 26 }}
                                    onClick={() => handleUpgrade(meta.key)}
                                    disabled={loading === meta.key}
                                >
                                    {loading === meta.key ? t('v2.pricing.redirecting') : data.cta}
                                </button>

                                <ul style={{
                                    listStyle: 'none', margin: 0, padding: 0,
                                    display: 'flex', flexDirection: 'column', gap: 11,
                                }}>
                                    {features.map((f) => (
                                        <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13.5 }}>
                                            <span style={{ flex: 'none', marginTop: 2 }}>
                                                <Icon name="check" size={14} color="var(--vl-cyan)" />
                                            </span>
                                            <span style={{ color: 'var(--vl-ink-2)', lineHeight: 1.5 }}>{f}</span>
                                        </li>
                                    ))}
                                    {locked.map((f) => (
                                        <li key={f} style={{
                                            display: 'flex', alignItems: 'flex-start', gap: 10,
                                            fontSize: 13.5, opacity: 0.38,
                                        }}>
                                            <span style={{ flex: 'none', marginTop: 2 }}>
                                                <Icon name="check" size={14} color="var(--vl-ink-4)" />
                                            </span>
                                            <span style={{ color: 'var(--vl-ink-3)', lineHeight: 1.5 }}>{f}</span>
                                        </li>
                                    ))}
                                </ul>

                                {soon.length > 0 && (
                                    <div style={{
                                        marginTop: 22, paddingTop: 16,
                                        borderTop: '1px solid var(--vl-line)',
                                    }}>
                                        <div className="vl-mono" style={{
                                            fontSize: 10, letterSpacing: '0.12em',
                                            color: 'var(--vl-ink-4)', marginBottom: 10,
                                            textTransform: 'uppercase',
                                        }}>{t('v2.pricing.soonLabel')}</div>
                                        <ul style={{
                                            listStyle: 'none', margin: 0, padding: 0,
                                            display: 'flex', flexDirection: 'column', gap: 9,
                                        }}>
                                            {soon.map((f) => (
                                                <li key={f} style={{
                                                    display: 'flex', alignItems: 'flex-start', gap: 10,
                                                    fontSize: 13,
                                                }}>
                                                    <span style={{ flex: 'none', marginTop: 2 }}>
                                                        <Icon name="clock" size={13} color="var(--vl-ink-4)" />
                                                    </span>
                                                    <span style={{ color: 'var(--vl-ink-4)', lineHeight: 1.5 }}>{f}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <p style={{ fontSize: 13, color: 'var(--vl-ink-4)', margin: '32px 0 0' }}>
                    {t('v2.pricing.footnote')}
                </p>
            </div>
        </section>
    );
};

/* FAQ --------------------------------------------------------------------- */

const FAQ_KEYS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'];

export const Faq = () => {
    const { t } = useTranslation('landing');
    const [open, setOpen] = useState('q1');

    return (
        <section className="vl-sec" id="faq" style={{ background: 'var(--vl-bg)' }}>
            <div className="vl-wrap">
                <h2 className="vl-h2" style={{ maxWidth: 560, marginBottom: 44 }}>{t('v2.faq.title')}</h2>

                <div style={{ maxWidth: 820 }}>
                    {FAQ_KEYS.map((k) => {
                        const isOpen = open === k;
                        return (
                            <div key={k} style={{ borderTop: '1px solid rgba(255,255,255,0.09)' }}>
                                <button
                                    type="button"
                                    onClick={() => setOpen(isOpen ? null : k)}
                                    aria-expanded={isOpen}
                                    style={{
                                        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                                        padding: '22px 0', display: 'flex', alignItems: 'center',
                                        justifyContent: 'space-between', gap: 20, textAlign: 'left',
                                        font: 'inherit', color: 'var(--vl-ink)',
                                    }}
                                >
                                    <span style={{ fontWeight: 700, fontSize: 16 }}>{t(`v2.faq.${k}.q`)}</span>
                                    <span style={{
                                        flex: 'none', transition: 'transform 180ms ease',
                                        transform: isOpen ? 'rotate(45deg)' : 'none',
                                    }}>
                                        <Icon name="plus" size={16} color="var(--vl-ink-4)" />
                                    </span>
                                </button>
                                {isOpen && (
                                    <p style={{
                                        fontSize: 15, lineHeight: 1.65, color: 'var(--vl-ink-3)',
                                        margin: '0 0 24px', maxWidth: 660,
                                    }}>{t(`v2.faq.${k}.a`)}</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
};

/* Final CTA --------------------------------------------------------------- */

export const FinalCtaV2 = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-final-cta" style={{
            position: 'relative', overflow: 'hidden',
            background: 'var(--vl-bg-2)', textAlign: 'center',
        }}>
            <CtaObject className="vl-canvas-host vl-drift" style={{
                position: 'absolute', bottom: 40, right: '7%',
                width: 124, height: 124, opacity: 0.6, pointerEvents: 'none',
            }} />

            <div className="vl-wrap" style={{ padding: 0, position: 'relative', zIndex: 1 }}>
                <h2 className="vl-h1" style={{ margin: '0 auto 18px', maxWidth: 760, whiteSpace: 'pre-line' }}>
                    {t('v2.finalCta.title')}
                </h2>
                <p className="vl-lead" style={{ margin: '0 auto 34px', maxWidth: 540 }}>
                    {t('v2.finalCta.body')}
                </p>
                <button className="vl-btn vl-btn-primary" onClick={() => goToSignup('footer')}>
                    {t('v2.cta.primary')}
                    <Icon name="arrowRight" size={16} />
                </button>
                <p className="vl-mono" style={{ fontSize: 12, color: 'var(--vl-ink-4)', margin: '18px 0 0' }}>
                    {t('v2.cta.microcopy')}
                </p>
            </div>
        </section>
    );
};
