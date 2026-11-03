import React from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './LandingIcons';
import HeroObject from './HeroObject';
import { goToSignup } from './checkout';


/** One result line in the preview card: icon + what the pass did. */
const ResultRow = ({ icon, label }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name={icon} size={15} color="var(--vl-cyan)" />
        <span style={{ fontSize: 12.5, color: 'var(--vl-ink-2)' }}>{label}</span>
    </div>
);

/**
 * The product preview card. It reads as a short story — the file, what the
 * creator asked for, and what came back — rather than a screenshot of chrome.
 */
const PreviewCard = () => {
    const { t } = useTranslation('landing');

    return (
        <div style={{ flex: '1 1 440px', minWidth: 0, position: 'relative', padding: '40px 10px 10px 40px', zIndex: 2 }}>
            <div
                className="vl-tilt"
                style={{
                    position: 'absolute', top: 2, left: 2, zIndex: 3,
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '9px 14px', borderRadius: 13,
                    background: 'rgba(13,16,22,0.94)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow: '0 22px 44px rgba(0,0,0,0.6)',
                    transform: 'perspective(900px) rotateX(4deg) rotateY(-4deg)',
                }}
            >
                <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink-4)' }}>14:02</span>
                <Icon name="arrowRight" size={13} color="var(--vl-cyan)" />
                <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink)', fontWeight: 600 }}>1:05</span>
            </div>

            <div
                className="vl-tilt"
                style={{
                    transform: 'perspective(1500px) rotateY(-6deg) rotateX(2.5deg)',
                    transformStyle: 'preserve-3d',
                    background: 'rgba(9,12,18,0.74)',
                    border: '1px solid rgba(255,255,255,0.13)',
                    borderRadius: 20,
                    backdropFilter: 'blur(20px)',
                    boxShadow: '0 50px 90px -20px rgba(0,0,0,0.7), 0 10px 30px rgba(0,229,255,0.06)',
                    overflow: 'hidden', position: 'relative', zIndex: 2,
                }}
            >
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                        <span style={{
                            width: 24, height: 24, borderRadius: 8, flex: 'none',
                            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <Icon name="play" size={11} color="var(--vl-ink-2)" />
                        </span>
                        <span className="vl-mono" style={{
                            fontSize: 12, color: 'var(--vl-ink-2)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>podcast_ep12.mp4</span>
                        <span className="vl-mono" style={{ fontSize: 12, color: 'var(--vl-ink-4)', flex: 'none' }}>14:02</span>
                    </div>
                    <span className="vl-mono" style={{
                        fontSize: 10, letterSpacing: '0.09em', color: 'var(--vl-ink-2)',
                        background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.13)',
                        padding: '4px 9px', borderRadius: 999, flex: 'none',
                    }}>{t('v2.card.autoMode')}</span>
                </div>

                <div style={{ padding: '16px 16px 0', display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{
                        background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                        borderRadius: '14px 14px 4px 14px', padding: '10px 15px',
                        fontSize: 13.5, color: '#EDF1F5', maxWidth: 260,
                    }}>{t('v2.card.prompt')}</div>
                </div>

                <div style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: 999, flex: 'none',
                            background: '#28C840', boxShadow: '0 0 8px #28C840',
                        }} />
                        <span style={{
                            fontFamily: 'var(--vl-display)', fontWeight: 800,
                            fontSize: 14, color: 'var(--vl-ink)',
                        }}>{t('v2.card.status')}</span>
                    </div>

                    <div className="vl-panel-row" style={{ display: 'flex', gap: 13 }}>
                        <div className="vl-panel-thumb" style={{
                            flex: '0 0 112px', aspectRatio: '9 / 16', borderRadius: 12,
                            position: 'relative', overflow: 'hidden',
                            border: '1px solid rgba(255,255,255,0.12)',
                        }}>
                            <img
                                src="/landing/shot-talk-cool.png"
                                alt=""
                                loading="lazy"
                                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                            <div className="vl-mono" style={{
                                position: 'absolute', top: 7, left: 7, fontSize: 8.5, letterSpacing: '0.06em',
                                color: '#05070B', background: '#F7F9FC', padding: '2px 6px',
                                borderRadius: 4, fontWeight: 600,
                            }}>9:16</div>
                            <div style={{
                                position: 'absolute', left: 7, right: 7, bottom: 12, textAlign: 'center',
                                fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 12, lineHeight: 1.2,
                                color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)',
                            }}>{t('v2.card.caption')}</div>
                        </div>

                        <div style={{
                            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
                            gap: 11, justifyContent: 'center',
                        }}>
                            <ResultRow icon="scissors" label={t('v2.card.r1')} />
                            <ResultRow icon="check" label={t('v2.card.r2')} />
                            <ResultRow icon="captions" label={t('v2.card.r3')} />
                            <ResultRow icon="crop" label={t('v2.card.r4')} />
                        </div>
                    </div>

                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 9, marginTop: 15,
                        paddingTop: 13, borderTop: '1px solid rgba(255,255,255,0.08)',
                    }}>
                        <Icon name="exportOut" size={14} color="var(--vl-ink-4)" />
                        <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink-3)' }}>
                            {t('v2.card.output')}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};

const TRIAD = [
    { icon: 'checkCircle', key: 'a' },
    { icon: 'bolt', key: 'b' },
    { icon: 'clock', key: 'c' },
];

const Hero = () => {
    const { t } = useTranslation('landing');

    return (
        <section
            className="vl-sec"
            style={{
                paddingTop: 104,
                paddingBottom: 0,
                overflow: 'hidden',
                background:
                    'radial-gradient(ellipse 900px 620px at 14% -8%, rgba(0,229,255,0.15), transparent 60%),' +
                    'radial-gradient(ellipse 820px 680px at 88% 2%, rgba(138,43,226,0.18), transparent 60%),' +
                    'var(--vl-bg)',
            }}
        >
            <HeroObject
                className="vl-hero-3d vl-drift"
                style={{
                    position: 'absolute', top: -250, right: -60,
                    width: 620, height: 660, zIndex: 0,
                }}
            />

            <div className="vl-wrap" style={{
                display: 'flex', gap: 64, flexWrap: 'wrap', alignItems: 'center',
                position: 'relative', zIndex: 1,
            }}>
                <div style={{ flex: '1 1 520px', minWidth: 0 }}>
                    <h1 className="vl-h1">
                        {t('v2.hero.headline').split('\n').map((line, i, arr) => (
                            <React.Fragment key={line}>
                                {line}
                                {i < arr.length - 1 && <br />}
                            </React.Fragment>
                        ))}
                    </h1>
                    <p style={{
                        fontSize: 18, lineHeight: 1.6, color: '#AEB9C6',
                        maxWidth: 490, margin: '0 0 32px',
                    }}>{t('v2.hero.body')}</p>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
                        <button
                            type="button"
                            className="vl-btn vl-btn-primary"
                            onClick={() => goToSignup('hero')}
                        >
                            {t('v2.cta.primary')}
                            <Icon name="arrowRight" size={16} color="#05070B" />
                        </button>
                    </div>

                    <p className="vl-mono" style={{ fontSize: 12, color: 'var(--vl-ink-4)', margin: '0 0 10px' }}>
                        {t('v2.cta.microcopy')}
                    </p>
                    <p style={{ fontSize: 13.5, color: 'var(--vl-ink-3)', margin: 0 }}>
                        {t('v2.hero.proofLead')}{' '}
                        <span style={{ color: 'var(--vl-ink)', fontWeight: 600 }}>{t('v2.hero.proofHighlight')}</span>
                        {t('v2.hero.proofTail')}
                    </p>
                </div>

                <PreviewCard />
            </div>

            <div className="vl-wrap" style={{
                marginTop: 72, display: 'flex', flexWrap: 'wrap',
                borderTop: '1px solid var(--vl-line)', position: 'relative', zIndex: 1,
            }}>
                {TRIAD.map((item, i) => (
                    <div
                        key={item.key}
                        className="vl-triad"
                        style={{
                            flex: '1 1 280px', minWidth: 0,
                            padding: i === 0 ? '30px 34px 34px 0' : (i === 2 ? '30px 0 34px 34px' : '30px 34px 34px'),
                            borderLeft: i === 0 ? 'none' : '1px solid var(--vl-line)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <Icon name={item.icon} size={19} color="var(--vl-cyan)" />
                            <span style={{
                                fontFamily: 'var(--vl-display)', fontWeight: 800,
                                fontSize: 17, color: 'var(--vl-ink)',
                            }}>{t(`v2.triad.${item.key}.title`)}</span>
                        </div>
                        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--vl-ink-3)', margin: 0 }}>
                            {t(`v2.triad.${item.key}.body`)}
                        </p>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default Hero;
