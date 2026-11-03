import React from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './LandingIcons';

/* Shared bits ------------------------------------------------------------- */

const SectionHead = ({ title, lead, maxWidth = 720 }) => (
    <>
        <h2 className="vl-h2" style={{ maxWidth }}>{title}</h2>
        <p className="vl-lead" style={{ maxWidth: 620, marginBottom: 56 }}>{lead}</p>
    </>
);

const Pill = ({ children, active = false }) => (
    <span style={{
        padding: '7px 13px', borderRadius: 999, fontSize: 12.5,
        background: active ? 'rgba(0,229,255,0.1)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? 'rgba(0,229,255,0.35)' : 'rgba(255,255,255,0.1)'}`,
        color: active ? 'var(--vl-cyan-soft)' : 'var(--vl-ink-2)',
        fontWeight: active ? 600 : 400,
    }}>{children}</span>
);

const Chip = ({ children }) => (
    <span className="vl-mono" style={{
        fontSize: 10.5, color: 'var(--vl-ink-3)', background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.09)', borderRadius: 999, padding: '5px 11px',
    }}>{children}</span>
);

/** A drawn video still: the character art plus burned-in product UI. */
const Frame = ({ src, aspect = '9 / 16', label, caption, progress, accent = 'var(--vl-cyan)', style = null }) => (
    <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 14,
        aspectRatio: aspect, border: '1px solid rgba(255,255,255,0.12)', ...(style || {}),
    }}>
        <img src={src} alt="" loading="lazy"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {label && (
            <div className="vl-mono" style={{
                position: 'absolute', top: 8, left: 8, fontSize: 9,
                color: 'var(--vl-ink-2)', background: 'rgba(5,7,11,0.7)',
                border: '1px solid rgba(255,255,255,0.2)', padding: '2px 7px', borderRadius: 999,
            }}>{label}</div>
        )}
        {caption && (
            <div style={{
                position: 'absolute', left: 7, right: 7, bottom: 12, textAlign: 'center',
                fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 11, lineHeight: 1.2,
                color: '#fff', textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 1px 2px rgba(0,0,0,1)',
            }}>{caption}</div>
        )}
        {typeof progress === 'number' && (
            <div style={{
                position: 'absolute', left: 8, right: 8, bottom: 6, height: 2,
                borderRadius: 2, background: 'rgba(255,255,255,0.25)',
            }}>
                <div style={{ width: `${progress}%`, height: '100%', borderRadius: 2, background: accent }} />
            </div>
        )}
    </div>
);

/* 1 — How it works -------------------------------------------------------- */

const STYLE_KEYS = ['vlog', 'talkingHead', 'interview', 'podcast', 'reel'];

export const HowItWorks = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-sec" id="how" style={{ background: 'var(--vl-bg)' }}>
            <div className="vl-wrap">
                <SectionHead title={t('v2.how.title')} lead={t('v2.how.lead')} maxWidth={700} />

                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {['1', '2', '3'].map((n, i) => (
                        <li
                            key={n}
                            className="vl-card"
                            style={{
                                flex: '1 1 300px', minWidth: 0, padding: 30,
                                ...(i === 2 ? {
                                    background: 'rgba(255,255,255,0.065)',
                                    borderColor: 'rgba(255,255,255,0.18)',
                                } : null),
                            }}
                        >
                            <div style={{
                                fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 40, lineHeight: 1,
                                color: 'var(--vl-cyan)', marginBottom: 18,
                            }}>{`0${n}`}</div>
                            <h3 style={{
                                fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 19,
                                margin: '0 0 10px', color: 'var(--vl-ink)',
                            }}>{t(`v2.how.s${n}.title`)}</h3>
                            <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--vl-ink-3)', margin: '0 0 18px' }}>
                                {t(`v2.how.s${n}.body`)}
                            </p>

                            {i === 0 && (
                                <div style={{
                                    height: 66, borderRadius: 12, display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', gap: 9,
                                    border: '1.5px dashed rgba(255,255,255,0.18)',
                                }}>
                                    <Icon name="upload" size={16} color="var(--vl-ink-4)" />
                                    <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink-4)' }}>
                                        {t('v2.how.s1.dropzone')}
                                    </span>
                                </div>
                            )}
                            {i === 1 && (
                                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                    {STYLE_KEYS.map((k, si) => (
                                        <Pill key={k} active={si === 0}>{t(`v2.styles.${k}`)}</Pill>
                                    ))}
                                </div>
                            )}
                            {i === 2 && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px',
                                    borderRadius: 12, background: 'rgba(5,7,11,0.5)',
                                    border: '1px solid rgba(255,255,255,0.14)',
                                }}>
                                    <span style={{
                                        width: 8, height: 8, borderRadius: 999, flex: 'none',
                                        background: '#28C840', boxShadow: '0 0 8px #28C840',
                                    }} />
                                    <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink-2)' }}>
                                        {t('v2.how.s3.status')}
                                    </span>
                                </div>
                            )}
                        </li>
                    ))}
                </ol>
            </div>
        </section>
    );
};

/* 2 — Speed proof --------------------------------------------------------- */

const STAT_KEYS = ['a', 'b', 'c'];

export const SpeedProof = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-sec" id="speed" style={{ background: 'var(--vl-bg-2)' }}>
            <div className="vl-wrap">
                <SectionHead title={t('v2.speed.title')} lead={t('v2.speed.lead')} />

                <div style={{ display: 'flex', gap: 48, flexWrap: 'wrap', alignItems: 'stretch' }}>
                    <div className="vl-card" style={{ flex: '1 1 480px', minWidth: 0, padding: 30, borderRadius: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <span className="vl-mono" style={{ fontSize: 11, color: 'var(--vl-ink-4)' }}>{t('v2.speed.rawLabel')}</span>
                            <span className="vl-mono" style={{ fontSize: 11, color: 'var(--vl-ink-4)' }}>14:02</span>
                        </div>
                        <div style={{
                            height: 38, borderRadius: 9, marginBottom: 30,
                            background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.1) 0 22px, rgba(255,255,255,0.03) 22px 30px)',
                        }} />

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <span className="vl-mono" style={{ fontSize: 11, color: '#E8EAED' }}>{t('v2.speed.editLabel')}</span>
                            <span className="vl-mono" style={{ fontSize: 11, color: '#E8EAED' }}>8:41</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginBottom: 12 }}>
                            <div style={{
                                width: '62%', height: 38, borderRadius: 9, position: 'relative', overflow: 'hidden',
                                background: 'linear-gradient(90deg, rgba(0,229,255,0.42), rgba(138,43,226,0.38))',
                            }}>
                                {[22, 47, 71].map((left) => (
                                    <div key={left} style={{
                                        position: 'absolute', left: `${left}%`, top: 0, bottom: 0,
                                        width: 2, background: 'rgba(5,7,11,0.65)',
                                    }} />
                                ))}
                            </div>
                            <div style={{
                                flex: 1, height: 38, borderRadius: 9, display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                border: '1px dashed rgba(255,255,255,0.18)',
                            }}>
                                <span className="vl-mono" style={{ fontSize: 10.5, color: 'var(--vl-ink-4)' }}>
                                    {t('v2.speed.cut')}
                                </span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
                            {['c1', 'c2', 'c3', 'c4', 'c5'].map((c) => (
                                <Chip key={c}>{t(`v2.speed.${c}`)}</Chip>
                            ))}
                        </div>

                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 18 }}>
                            <div className="vl-mono" style={{
                                fontSize: 10.5, letterSpacing: '0.1em',
                                color: 'var(--vl-ink-4)', marginBottom: 13,
                            }}>{t('v2.speed.passTitle')}</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {['p1', 'p2', 'p3', 'p4'].map((p) => (
                                    <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                        <Icon name="check" size={14} color="var(--vl-cyan)" />
                                        <span style={{ fontSize: 12.5, color: 'var(--vl-ink-2)' }}>{t(`v2.speed.${p}`)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {STAT_KEYS.map((k, i) => (
                            <div
                                key={k}
                                className="vl-card"
                                style={{
                                    flex: 1, padding: '26px 28px',
                                    ...(i === 0 ? {
                                        background: 'rgba(255,255,255,0.065)',
                                        borderColor: 'rgba(255,255,255,0.18)',
                                    } : null),
                                }}
                            >
                                <div style={{
                                    fontFamily: 'var(--vl-display)', fontWeight: 800, fontSize: 38,
                                    lineHeight: 1, color: 'var(--vl-ink)', marginBottom: 8,
                                }}>{t(`v2.speed.stat.${k}.value`)}</div>
                                <div style={{ fontSize: 14.5, color: 'var(--vl-ink-3)', lineHeight: 1.55 }}>
                                    {t(`v2.speed.stat.${k}.label`)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
};

/* 3 — Repurpose ----------------------------------------------------------- */

const SHORTS = [
    { key: 'tiktok', src: '/landing/shot-talk-cool.png', width: 132, progress: 42, accent: 'var(--vl-cyan)', lift: 0, rotate: 10 },
    { key: 'reels', src: '/landing/shot-talk-violet.png', width: 148, progress: 64, accent: '#E8EAED', lift: -16, rotate: 0 },
    { key: 'shorts', src: '/landing/shot-vlog-outdoor.png', width: 132, progress: 28, accent: 'var(--vl-violet-soft)', lift: 0, rotate: -10 },
];

export const Repurpose = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-sec" id="features" style={{ background: 'var(--vl-bg)' }}>
            <div className="vl-wrap">
                <SectionHead title={t('v2.repurpose.title')} lead={t('v2.repurpose.lead')} />

                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 44, flexWrap: 'wrap', marginBottom: 56, padding: '24px 0',
                }}>
                    <div className="vl-tilt" style={{
                        position: 'relative', width: 240, height: 144, borderRadius: 14, overflow: 'hidden',
                        border: '1px solid rgba(255,255,255,0.12)',
                        boxShadow: '0 30px 50px -16px rgba(0,0,0,0.65)',
                        transform: 'perspective(1200px) rotateY(8deg) rotateX(2deg)',
                    }}>
                        <img src="/landing/shot-podcast-duo.png" alt="" loading="lazy"
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{
                                width: 40, height: 40, borderRadius: 999, display: 'flex',
                                alignItems: 'center', justifyContent: 'center',
                                background: 'rgba(10,14,20,0.6)', border: '1px solid rgba(255,255,255,0.25)',
                                backdropFilter: 'blur(4px)',
                            }}>
                                <Icon name="play" size={15} color="#fff" />
                            </span>
                        </div>
                        <div style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 10px',
                            background: 'linear-gradient(180deg, transparent, rgba(5,7,11,0.9))',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <span className="vl-mono" style={{ fontSize: 10.5, color: '#DDE2E8' }}>podcast_ep12.mp4</span>
                            <span className="vl-mono" style={{ fontSize: 10.5, color: 'var(--vl-ink-3)' }}>14:02</span>
                        </div>
                    </div>

                    <Icon name="arrowRight" size={24} color="var(--vl-ink-4)" />

                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end' }}>
                        {SHORTS.map((s) => (
                            <div
                                key={s.key}
                                className="vl-tilt"
                                style={{
                                    width: s.width,
                                    transform: `translateY(${s.lift}px) perspective(1200px) rotateY(${s.rotate}deg)`,
                                    boxShadow: '0 28px 50px -14px rgba(0,0,0,0.65)',
                                }}
                            >
                                <Frame
                                    src={s.src}
                                    label={t(`v2.repurpose.${s.key}.label`)}
                                    caption={t(`v2.repurpose.${s.key}.caption`)}
                                    progress={s.progress}
                                    accent={s.accent}
                                    style={{ borderRadius: 16 }}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {['a', 'b', 'c'].map((k) => (
                        <div key={k} className="vl-card vl-card-hover" style={{ flex: '1 1 280px', minWidth: 0, padding: 26, borderRadius: 16 }}>
                            <h3 style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--vl-ink)', margin: '0 0 8px' }}>
                                {t(`v2.repurpose.card.${k}.title`)}
                            </h3>
                            <p style={{ fontSize: 14, color: 'var(--vl-ink-3)', lineHeight: 1.55, margin: 0 }}>
                                {t(`v2.repurpose.card.${k}.body`)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

/* 4 — References, brief, script -------------------------------------------- */

const OUT_FRAMES = [
    { src: '/landing/shot-talk-cool.png', key: 'o1' },
    { src: '/landing/shot-vlog-outdoor.png', key: 'o2' },
    { src: '/landing/shot-talk-violet.png', key: 'o3' },
    { src: '/landing/shot-podcast-duo.png', key: 'o4' },
];

export const ScriptFlow = () => {
    const { t } = useTranslation('landing');

    const inputCard = {
        flex: '1 1 210px', minWidth: 0, padding: 22, borderRadius: 16,
        display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
        boxSizing: 'border-box',
    };
    const stepLabel = {
        fontSize: 11, letterSpacing: '0.1em', color: 'var(--vl-ink-4)', marginBottom: 16,
    };
    const footnote = { fontSize: 13, color: 'var(--vl-ink-3)', lineHeight: 1.5, margin: 'auto 0 0' };

    return (
        <section className="vl-sec" id="script" style={{ background: 'var(--vl-bg-2)' }}>
            <div className="vl-wrap">
                <SectionHead title={t('v2.script.title')} lead={t('v2.script.lead')} maxWidth={800} />

                <div style={{ display: 'flex', alignItems: 'stretch', gap: 14, flexWrap: 'wrap', marginBottom: 20 }}>
                    <div style={inputCard}>
                        <div className="vl-mono" style={stepLabel}>{t('v2.script.step1')}</div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                            <Frame src="/landing/shot-vlog-outdoor.png" aspect="1 / 1" style={{ flex: 1, borderRadius: 8 }} />
                            <Frame src="/landing/shot-talk-cool.png" aspect="1 / 1" style={{ flex: 1, borderRadius: 8 }} />
                            <div style={{
                                flex: 1, aspectRatio: '1 / 1', borderRadius: 8,
                                border: '1.5px dashed rgba(255,255,255,0.22)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Icon name="plus" size={15} color="var(--vl-ink-4)" />
                            </div>
                        </div>
                        <p style={footnote}>{t('v2.script.note1')}</p>
                    </div>

                    <div style={inputCard}>
                        <div className="vl-mono" style={stepLabel}>{t('v2.script.step2')}</div>
                        <p className="vl-mono" style={{
                            fontSize: 12.5, lineHeight: 1.7, color: 'var(--vl-ink-2)',
                            fontStyle: 'italic', margin: '0 0 14px',
                        }}>{t('v2.script.brief')}</p>
                        <p style={footnote}>{t('v2.script.note2')}</p>
                    </div>

                    <div style={inputCard}>
                        <div className="vl-mono" style={stepLabel}>{t('v2.script.step3')}</div>
                        <p className="vl-mono" style={{
                            fontSize: 12.5, lineHeight: 1.9, color: 'var(--vl-ink-2)',
                            margin: '0 0 14px', whiteSpace: 'pre-line',
                        }}>{t('v2.script.scriptLines')}</p>
                        <p style={footnote}>{t('v2.script.note3')}</p>
                    </div>

                    <div style={{
                        ...inputCard,
                        flex: '1.4 1 280px',
                        background: 'rgba(255,255,255,0.065)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        boxShadow: '0 30px 50px -18px rgba(0,0,0,0.55)',
                    }}>
                        <div className="vl-mono" style={{ ...stepLabel, color: 'var(--vl-ink-2)' }}>
                            {t('v2.script.output')}
                        </div>
                        <div style={{ display: 'flex', gap: 7, marginBottom: 14 }}>
                            {OUT_FRAMES.map((f) => (
                                <Frame
                                    key={f.key}
                                    src={f.src}
                                    caption={t(`v2.script.${f.key}`)}
                                    style={{ flex: 1, borderRadius: 7 }}
                                />
                            ))}
                        </div>
                        <p style={{ ...footnote, color: 'var(--vl-ink-2)' }}>{t('v2.script.note4')}</p>
                    </div>
                </div>

                <p style={{ fontSize: 13, color: 'var(--vl-ink-4)', margin: 0 }}>{t('v2.script.shipping')}</p>
            </div>
        </section>
    );
};
