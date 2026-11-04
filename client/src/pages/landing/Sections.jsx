import React from 'react';
import { useTranslation } from 'react-i18next';
import Icon from './LandingIcons';
import { Reveal, Stagger, StaggerItem, GrowBar } from './motionPrimitives';
import { EASE, DUR } from './motion';
import { motion as Motion, useReducedMotion } from 'framer-motion';

/* Shared bits ------------------------------------------------------------- */

const SectionHead = ({ title, lead, maxWidth = 720 }) => (
    <Reveal>
        <h2 className="vl-h2" style={{ maxWidth }}>{title}</h2>
        <p className="vl-lead" style={{ maxWidth: 620, marginBottom: 56 }}>{lead}</p>
    </Reveal>
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
const Frame = ({
    src, aspect = '9 / 16', label, caption, progress, progressDelay,
    accent = 'var(--vl-cyan)', style = null,
}) => (
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
                {typeof progressDelay === 'number' ? (
                    <GrowBar
                        width={`${progress}%`}
                        delay={progressDelay}
                        duration={0.7}
                        style={{ height: '100%', borderRadius: 2, background: accent }}
                    />
                ) : (
                    <div style={{ width: `${progress}%`, height: '100%', borderRadius: 2, background: accent }} />
                )}
            </div>
        )}
    </div>
);

/* 1 — How it works -------------------------------------------------------- */

const STYLE_KEYS = ['vlog', 'talkingHead', 'interview', 'podcast', 'reel'];

/* The chosen style lands last, so the eye follows the selection. */
const STYLE_ORDER = [
    ...STYLE_KEYS.slice(1).map((key) => ({ key, active: false })),
    { key: STYLE_KEYS[0], active: true },
];

/** The dropzone with a file settling into it the first time it is seen. */
const DropZone = ({ label }) => {
    const still = useReducedMotion();

    return (
        <div style={{
            position: 'relative', overflow: 'hidden',
            height: 66, borderRadius: 12, display: 'flex',
            alignItems: 'center', justifyContent: 'center', gap: 9,
            border: '1.5px dashed rgba(255,255,255,0.18)',
        }}>
            <Motion.div
                style={{ display: 'flex', alignItems: 'center', gap: 9 }}
                initial={still ? false : { y: -34, opacity: 0 }}
                whileInView={still ? undefined : { y: 0, opacity: 1 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.35 }}
            >
                <Icon name="upload" size={16} color="var(--vl-ink-4)" />
                <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink-4)' }}>
                    {label}
                </span>
            </Motion.div>
        </div>
    );
};

export const HowItWorks = () => {
    const { t } = useTranslation('landing');

    return (
        <section className="vl-sec" id="how" style={{ background: 'var(--vl-bg)' }}>
            <div className="vl-wrap">
                <SectionHead title={t('v2.how.title')} lead={t('v2.how.lead')} maxWidth={700} />

                <Stagger as="ol" step={0.14} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {['1', '2', '3'].map((n, i) => (
                        <StaggerItem
                            as="li"
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

                            {i === 0 && <DropZone label={t('v2.how.s1.dropzone')} />}
                            {i === 1 && (
                                <Stagger step={0.07} delay={0.15} style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                    {STYLE_ORDER.map(({ key, active }) => (
                                        <StaggerItem key={key} y={8}>
                                            <Pill active={active}>{t(`v2.styles.${key}`)}</Pill>
                                        </StaggerItem>
                                    ))}
                                </Stagger>
                            )}
                            {i === 2 && (
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '13px 16px',
                                    borderRadius: 12, background: 'rgba(5,7,11,0.5)',
                                    border: '1px solid rgba(255,255,255,0.14)',
                                }}>
                                    <span className="vl-pulse" style={{
                                        width: 8, height: 8, borderRadius: 999, flex: 'none',
                                        background: '#28C840', boxShadow: '0 0 8px #28C840',
                                    }} />
                                    <span className="vl-mono" style={{ fontSize: 11.5, color: 'var(--vl-ink-2)' }}>
                                        {t('v2.how.s3.status')}
                                    </span>
                                </div>
                            )}
                        </StaggerItem>
                    ))}
                </Stagger>
            </div>
        </section>
    );
};

/* 2 — Speed proof --------------------------------------------------------- */

const STAT_KEYS = ['a', 'b', 'c'];

/**
 * The auto-edit bar starts at the full length of the raw footage and settles
 * back to 62%, so the dashed region that opens up is the time the pass removed.
 */
const AutoEditBar = ({ cutLabel }) => {
    const still = useReducedMotion();
    const delay = 0.85;

    return (
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, marginBottom: 12 }}>
            <Motion.div
                style={{
                    height: 38, borderRadius: 9, position: 'relative', overflow: 'hidden', flex: 'none',
                    background: 'linear-gradient(90deg, rgba(0,229,255,0.42), rgba(138,43,226,0.38))',
                }}
                initial={still ? { width: '62%' } : { width: '100%' }}
                whileInView={still ? undefined : { width: '62%' }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 1.1, ease: EASE, delay }}
            >
                {[22, 47, 71].map((left, i) => (
                    <Motion.div
                        key={left}
                        style={{
                            position: 'absolute', left: `${left}%`, top: 0, bottom: 0,
                            width: 2, background: 'rgba(5,7,11,0.65)',
                        }}
                        initial={still ? false : { opacity: 0 }}
                        whileInView={still ? undefined : { opacity: 1 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{ duration: 0.3, delay: delay + 0.35 + i * 0.12 }}
                    />
                ))}
            </Motion.div>

            <Motion.div
                style={{
                    flex: 1, minWidth: 0, height: 38, borderRadius: 9, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    border: '1px dashed rgba(255,255,255,0.18)',
                }}
                initial={still ? false : { opacity: 0 }}
                whileInView={still ? undefined : { opacity: 1 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.45, ease: EASE, delay: delay + 0.75 }}
            >
                <span className="vl-mono" style={{ fontSize: 10.5, color: 'var(--vl-ink-4)', whiteSpace: 'nowrap' }}>
                    {cutLabel}
                </span>
            </Motion.div>
        </div>
    );
};

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
                        <div style={{ height: 38, marginBottom: 30, borderRadius: 9, overflow: 'hidden' }}>
                            <GrowBar width="100%" duration={0.7} style={{
                                height: 38, borderRadius: 9,
                                background: 'repeating-linear-gradient(90deg, rgba(255,255,255,0.1) 0 22px, rgba(255,255,255,0.03) 22px 30px)',
                                backgroundAttachment: 'fixed',
                            }} />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                            <span className="vl-mono" style={{ fontSize: 11, color: '#E8EAED' }}>{t('v2.speed.editLabel')}</span>
                            <span className="vl-mono" style={{ fontSize: 11, color: '#E8EAED' }}>8:41</span>
                        </div>
                        <AutoEditBar cutLabel={t('v2.speed.cut')} />

                        <Stagger step={0.08} delay={1.5} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
                            {['c1', 'c2', 'c3', 'c4', 'c5'].map((c) => (
                                <StaggerItem key={c} y={6}>
                                    <Chip>{t(`v2.speed.${c}`)}</Chip>
                                </StaggerItem>
                            ))}
                        </Stagger>

                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 18 }}>
                            <div className="vl-mono" style={{
                                fontSize: 10.5, letterSpacing: '0.1em',
                                color: 'var(--vl-ink-4)', marginBottom: 13,
                            }}>{t('v2.speed.passTitle')}</div>
                            <Stagger step={0.11} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {['p1', 'p2', 'p3', 'p4'].map((p) => (
                                    <StaggerItem key={p} y={8} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                                        <Icon name="check" size={14} color="var(--vl-cyan)" />
                                        <span style={{ fontSize: 12.5, color: 'var(--vl-ink-2)' }}>{t(`v2.speed.${p}`)}</span>
                                    </StaggerItem>
                                ))}
                            </Stagger>
                        </div>
                    </div>

                    <Stagger step={0.12} delay={0.2} style={{ flex: '1 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {STAT_KEYS.map((k, i) => (
                            <StaggerItem
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
                            </StaggerItem>
                        ))}
                    </Stagger>
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

/* The verticals start fanning out once the source card and the arrow have settled. */
const FAN_DELAY = 0.5;

export const Repurpose = () => {
    const { t } = useTranslation('landing');
    const still = useReducedMotion();

    return (
        <section className="vl-sec" id="features" style={{ background: 'var(--vl-bg)' }}>
            <div className="vl-wrap">
                <SectionHead title={t('v2.repurpose.title')} lead={t('v2.repurpose.lead')} />

                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    gap: 44, flexWrap: 'wrap', marginBottom: 56, padding: '24px 0',
                }}>
                    <Motion.div
                        className="vl-tilt"
                        style={{
                            position: 'relative', width: 240, height: 144, borderRadius: 14, overflow: 'hidden',
                            border: '1px solid rgba(255,255,255,0.12)',
                            boxShadow: '0 30px 50px -16px rgba(0,0,0,0.65)',
                            transformPerspective: 1200,
                        }}
                        initial={still ? false : { opacity: 0, scale: 0.92, rotateY: 8, rotateX: 2 }}
                        whileInView={still ? undefined : { opacity: 1, scale: 1, rotateY: 8, rotateX: 2 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{ duration: 0.6, ease: EASE }}
                    >
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
                    </Motion.div>

                    <Motion.div
                        initial={still ? false : { opacity: 0, x: -10 }}
                        whileInView={still ? undefined : { opacity: 1, x: 0 }}
                        viewport={{ once: true, amount: 0.4 }}
                        transition={{ duration: 0.4, ease: EASE, delay: 0.35 }}
                        style={{ display: 'flex' }}
                    >
                        <Icon name="arrowRight" size={24} color="var(--vl-ink-4)" />
                    </Motion.div>

                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-end' }}>
                        {SHORTS.map((short, i) => {
                            const land = FAN_DELAY + i * 0.13;
                            return (
                                <Motion.div
                                    key={short.key}
                                    className="vl-tilt"
                                    style={{
                                        width: short.width,
                                        transformPerspective: 1200,
                                        boxShadow: '0 28px 50px -14px rgba(0,0,0,0.65)',
                                    }}
                                    initial={still ? false : { opacity: 0, x: -64, y: 0, rotateY: 0, scale: 0.82 }}
                                    whileInView={still ? undefined : {
                                        opacity: 1, x: 0, y: short.lift, rotateY: short.rotate, scale: 1,
                                    }}
                                    viewport={{ once: true, amount: 0.3 }}
                                    transition={{ duration: 0.7, ease: EASE, delay: land }}
                                >
                                    <Frame
                                        src={short.src}
                                        label={t(`v2.repurpose.${short.key}.label`)}
                                        caption={t(`v2.repurpose.${short.key}.caption`)}
                                        progress={short.progress}
                                        progressDelay={land + 0.5}
                                        accent={short.accent}
                                        style={{ borderRadius: 16 }}
                                    />
                                </Motion.div>
                            );
                        })}
                    </div>
                </div>

                <Stagger step={0.1} style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                    {['a', 'b', 'c'].map((k) => (
                        <StaggerItem key={k} className="vl-card vl-card-hover" style={{ flex: '1 1 280px', minWidth: 0, padding: 26, borderRadius: 16 }}>
                            <h3 style={{ fontWeight: 700, fontSize: 15.5, color: 'var(--vl-ink)', margin: '0 0 8px' }}>
                                {t(`v2.repurpose.card.${k}.title`)}
                            </h3>
                            <p style={{ fontSize: 14, color: 'var(--vl-ink-3)', lineHeight: 1.55, margin: 0 }}>
                                {t(`v2.repurpose.card.${k}.body`)}
                            </p>
                        </StaggerItem>
                    ))}
                </Stagger>
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

/* The section plays as one sentence: the three inputs arrive, the script beats
   land one by one, and the output frames land in the same order right after,
   so the eye connects each script line to the cut it produced. */
const SF = {
    card: [0, 0.12, 0.24, 0.42],   // references, brief, script, output
    tile: 0.25,                    // the two reference stills
    plus: 0.47,                    // the dashed "add another"
    brief: 0.4,
    line: 0.52,                    // first script beat; +0.15 each
    frame: 0.95,                   // first output frame; +0.13 each
    note: 1.5,
};

/** One of the four cards, arriving on its own beat. */
const FlowCard = ({ delay, style, children }) => {
    const still = useReducedMotion();

    return (
        <Motion.div
            style={style}
            initial={still ? false : { opacity: 0, y: 22 }}
            whileInView={still ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: DUR, ease: EASE, delay }}
        >
            {children}
        </Motion.div>
    );
};

/** Fades a single piece of card content in on its own beat. */
const Beat = ({ delay, y = 6, style, className, children }) => {
    const still = useReducedMotion();

    return (
        <Motion.div
            className={className}
            style={style}
            initial={still ? false : { opacity: 0, y }}
            whileInView={still ? undefined : { opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.45, ease: EASE, delay }}
        >
            {children}
        </Motion.div>
    );
};

export const ScriptFlow = () => {
    const { t } = useTranslation('landing');
    const still = useReducedMotion();
    const scriptLines = t('v2.script.scriptLines').split('\n');

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
                    <FlowCard delay={SF.card[0]} style={inputCard}>
                        <div className="vl-mono" style={stepLabel}>{t('v2.script.step1')}</div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                            <Beat delay={SF.tile} style={{ flex: 1 }}>
                                <Frame src="/landing/shot-vlog-outdoor.png" aspect="1 / 1" style={{ borderRadius: 8 }} />
                            </Beat>
                            <Beat delay={SF.tile + 0.1} style={{ flex: 1 }}>
                                <Frame src="/landing/shot-talk-cool.png" aspect="1 / 1" style={{ borderRadius: 8 }} />
                            </Beat>
                            <Beat delay={SF.plus} style={{
                                flex: 1, aspectRatio: '1 / 1', borderRadius: 8,
                                border: '1.5px dashed rgba(255,255,255,0.22)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Icon name="plus" size={15} color="var(--vl-ink-4)" />
                            </Beat>
                        </div>
                        <p style={footnote}>{t('v2.script.note1')}</p>
                    </FlowCard>

                    <FlowCard delay={SF.card[1]} style={inputCard}>
                        <div className="vl-mono" style={stepLabel}>{t('v2.script.step2')}</div>
                        <Beat delay={SF.brief}>
                            <p className="vl-mono" style={{
                                fontSize: 12.5, lineHeight: 1.7, color: 'var(--vl-ink-2)',
                                fontStyle: 'italic', margin: '0 0 14px',
                            }}>{t('v2.script.brief')}</p>
                        </Beat>
                        <p style={footnote}>{t('v2.script.note2')}</p>
                    </FlowCard>

                    <FlowCard delay={SF.card[2]} style={inputCard}>
                        <div className="vl-mono" style={stepLabel}>{t('v2.script.step3')}</div>
                        <div className="vl-mono" style={{
                            fontSize: 12.5, lineHeight: 1.9, color: 'var(--vl-ink-2)', marginBottom: 14,
                        }}>
                            {scriptLines.map((line, i) => (
                                <Motion.div
                                    key={line}
                                    initial={still ? false : { opacity: 0, x: -8 }}
                                    whileInView={still ? undefined : { opacity: 1, x: 0 }}
                                    viewport={{ once: true, amount: 0.25 }}
                                    transition={{ duration: 0.4, ease: EASE, delay: SF.line + i * 0.15 }}
                                >
                                    {line}
                                </Motion.div>
                            ))}
                        </div>
                        <p style={footnote}>{t('v2.script.note3')}</p>
                    </FlowCard>

                    <FlowCard delay={SF.card[3]} style={{
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
                            {OUT_FRAMES.map((f, i) => (
                                <Motion.div
                                    key={f.key}
                                    style={{ flex: 1, minWidth: 0 }}
                                    initial={still ? false : { opacity: 0, y: 14, scale: 0.92 }}
                                    whileInView={still ? undefined : { opacity: 1, y: 0, scale: 1 }}
                                    viewport={{ once: true, amount: 0.25 }}
                                    transition={{ duration: 0.5, ease: EASE, delay: SF.frame + i * 0.13 }}
                                >
                                    <Frame
                                        src={f.src}
                                        caption={t(`v2.script.${f.key}`)}
                                        style={{ borderRadius: 7 }}
                                    />
                                </Motion.div>
                            ))}
                        </div>
                        <Beat delay={SF.note} style={{ marginTop: 'auto' }}>
                            <p style={{ ...footnote, color: 'var(--vl-ink-2)' }}>{t('v2.script.note4')}</p>
                        </Beat>
                    </FlowCard>
                </div>

                <Beat delay={SF.note + 0.15}>
                    <p style={{ fontSize: 13, color: 'var(--vl-ink-4)', margin: 0 }}>{t('v2.script.shipping')}</p>
                </Beat>
            </div>
        </section>
    );
};
