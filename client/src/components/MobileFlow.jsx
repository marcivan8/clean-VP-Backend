import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Loader2, Share2, Sparkles, SlidersHorizontal, History, UserRound, Smartphone, Video, MonitorPlay, ArrowLeft, Minus, Zap, Type, MessageCircle, Music2, Clock, ArrowRight, Film } from 'lucide-react';
import useMobileFlowStore from '../store/useMobileFlowStore';
import useEditStepsStore from '../store/useEditStepsStore';
import { OUTCOMES, OUTCOME_BY_ID, startOutcome } from '../agent/mobileOutcomes';
import useTimelineStore from '../store/useTimelineStore';
import { editJobManager } from '../agent/EditJobManager';
import useVersionsStore from '../agent/projectVersions';
import PlanSheet from './PlanSheet.jsx';
import { EventBus, EVENT_TYPES } from '../agent/EventBus';

/* The flow covers the editor while it is open; the editor keeps running
   underneath, which is what makes "Skip" instant. */
// MobileSheet sits at 60/61 — the plan-first approval, the export sheet and the
// caption sheets all use it. The flow is the surface those open ON TOP of, so it
// sits below them. At equal z-index this was decided by DOM order, which is not
// a thing to leave to chance when the losing case hides an Apply button.
const Z = 55;

const sheet = {
    position: 'fixed', inset: 0, zIndex: Z,
    background: 'radial-gradient(100% 38% at 0% 0%, rgba(0,190,205,.09), transparent 74%), radial-gradient(80% 45% at 100% 100%, rgba(112,35,170,.13), transparent 70%), var(--bg)', color: 'var(--fg)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--f-sans)',
};

/** A bottom sheet over the editor: the short itself stays visible behind it. */
const panel = {
    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: Z,
    background: 'var(--bg)', color: 'var(--fg)',
    borderTop: '1px solid var(--line)',
    borderRadius: '20px 20px 0 0',
    padding: '20px 20px 26px',
    fontFamily: 'var(--f-sans)',
    boxShadow: '0 -24px 60px -30px rgba(0,0,0,0.9)',
};

const fmt = (secs) => {
    const s = Math.max(0, Math.round(Number(secs) || 0));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/* ── What are you making? ─────────────────────────────────────────────────── */

function OutcomeStep() {
    const { t } = useTranslation('editor');
    const choose = useMobileFlowStore(s => s.choose);
    const toChange = useMobileFlowStore(s => s.toChange);
    const close = useMobileFlowStore(s => s.close);
    const error = useMobileFlowStore(s => s.error);
    const assets = useTimelineStore(s => s.assets) || [];
    const uploading = assets.find(asset => asset.uploadPhase && asset.uploadPhase !== 'complete' && asset.uploadPhase !== 'ready');

    const pick = (id) => {
        choose(id);
        // The run is fired and watched here rather than in the store: a store
        // that starts work is a store you cannot reason about in a test.
        startOutcome(id)
            .then(() => {
                // A version per finished run is what makes "go back" possible
                // without asking a beginner to count undo steps.
                useVersionsStore.getState().capture(t(`mobileFlow.outcome.${id}`, id));
                useMobileFlowStore.getState().finished();
            })
            .catch((err) => useMobileFlowStore.getState().failed(err?.message));
    };

    return (
        <div style={{ ...sheet, overflowY: 'auto', paddingBottom: 'calc(190px + env(safe-area-inset-bottom))' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px 0' }}>
                <button type="button" onClick={close} style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 42, padding: 0, border: 0, background: 'transparent', color: 'var(--fg-3)', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '.16em' }}><ArrowLeft size={17} /> {t('mobileFlow.newShortEyebrow', 'NEW SHORT')}</button>
                <button
                    type="button"
                    onClick={close}
                    style={{ minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14.5, cursor: 'pointer' }}
                >
                    {t('mobileFlow.skip', 'Skip')}
                </button>
            </div>

            <div style={{ padding: '6px 20px 0' }}>
                <h1 style={{ margin: '0 0 8px', fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                    {t('mobileFlow.title', 'What are you making?')}
                </h1>
                <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5, color: 'var(--fg-2)' }}>
                    {t('mobileFlow.subtitle', 'This sets the pacing, how it cuts, and how long it runs.')}
                </p>
                {error && (
                    <p role="alert" style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--coral)' }}>{error}</p>
                )}
            </div>

            <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                {OUTCOMES.map(o => (
                    <button
                        key={o.id}
                        type="button"
                        onClick={() => pick(o.id)}
                        style={{
                            minHeight: 112, padding: 18, borderRadius: 18, cursor: 'pointer', textAlign: 'left',
                            background: 'linear-gradient(145deg, rgba(255,255,255,.035), rgba(255,255,255,.015))', border: '1px solid var(--line)', color: 'var(--fg)',
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8,
                            fontFamily: 'var(--f-sans)',
                        }}
                    >
                        <span aria-hidden="true" style={{ color: '#61e8f1', marginBottom: 2 }}>{o.id === 'talking_head' ? <UserRound size={19} /> : o.id === 'reel' ? <Smartphone size={19} /> : o.id === 'vlog' ? <Video size={19} /> : <MonitorPlay size={19} />}</span>
                        <span style={{ fontSize: 16.5, fontWeight: 650, lineHeight: 1.2 }}>
                            {t(`mobileFlow.outcome.${o.id}`, o.id)}
                        </span>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: '#67e5ed' }}>{o.range}</span>
                    </button>
                ))}
            </div>
            <button type="button" onClick={toChange} style={{ margin: '-7px 20px 0', minHeight: 60, padding: '0 16px', borderRadius: 16, border: '1px dashed var(--line-strong)', background: 'linear-gradient(110deg,rgba(0,190,205,.05),rgba(122,42,190,.08))', color: 'var(--fg-2)', textAlign: 'left', fontSize: 14, fontFamily: 'var(--f-sans)' }}>
                {t('mobileFlow.somethingElse', 'Something else — describe it')}
            </button>
            {uploading && <div style={{ margin: 'auto 20px 18px', padding: 15, border: '1px solid var(--line)', borderRadius: 15, background: 'var(--bg-2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--fg-2)' }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploading.name || t('mobileFlow.uploading', 'Uploading your video')}</span><span style={{ color: '#6ee5eb' }}>{Math.round(uploading.uploadProgress || 0)}%</span></div>
                <div style={{ height: 4, margin: '9px 0 10px', background: 'var(--line)', borderRadius: 8 }}><div style={{ width: `${Math.max(0, Math.min(100, uploading.uploadProgress || 0))}%`, height: '100%', borderRadius: 8, background: 'linear-gradient(90deg,#09d6e6,#8529df)' }} /></div>
                <p style={{ margin: 0, color: 'var(--fg-3)', fontSize: 12.5 }}>{t('mobileFlow.uploadNote', 'Pick a style now. Your short starts as soon as the upload finishes.')}</p>
            </div>}
        </div>
    );
}

/* ── It edits ─────────────────────────────────────────────────────────────── */

function WorkingStep() {
    const { t } = useTranslation('editor');
    const steps = useEditStepsStore(s => s.steps);
    const close = useMobileFlowStore(s => s.close);
    const liveRef = useRef(null);
    const startedAt = useEditStepsStore(s => s.startedAt);
    const total = useEditStepsStore(s => s.total);
    const doneCount = steps.filter(s => s.state === 'done').length;
    const progress = Math.min(96, Math.round((doneCount / Math.max(total || 6, 6)) * 100));

    // Only the finished steps carry a sentence; the running one is the heading
    // of the list, not a line in it.
    const running = steps.find(s => s.state === 'running');

    return (
        <div style={sheet}>
            <div style={{ padding: '26px 20px 0' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.16em', color: '#62e5ed' }}>
                    {t('mobileFlow.workingEyebrow', 'WORKING')}
                </span>
                <h1 style={{ margin: '12px 0 0', fontSize: 27, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
                    {t('mobileFlow.working', 'Making your short')}
                </h1>
            </div>

            <ol
                ref={liveRef}
                aria-live="polite"
                style={{ listStyle: 'none', margin: 0, padding: '24px 20px 0', flex: 1, minHeight: 0, overflowY: 'auto' }}
            >
                {steps.map(s => (
                    <li key={s.index} style={{ display: 'flex', gap: 13, padding: '11px 0', alignItems: 'flex-start' }}>
                        <span aria-hidden="true" style={{ flex: 'none', marginTop: 2 }}>
                            {s.state === 'running'
                                ? <Loader2 size={18} className="animate-spin" style={{ color: '#62e5ed' }} />
                                : s.state === 'failed'
                                    ? <X size={18} style={{ color: 'var(--fg-4)' }} />
                                    : <span style={{ width: 26, height: 26, border: '1px solid rgba(0,215,225,.7)', background: 'rgba(0,215,225,.1)', color: '#62e5ed', borderRadius: 999, display: 'grid', placeItems: 'center' }}><Check size={14} /></span>}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                            <span style={{ fontSize: 15.5, color: s.state === 'running' ? 'var(--fg)' : 'var(--fg-2)', fontWeight: s.state === 'running' ? 600 : 400 }}>
                                {s.label}
                            </span>
                            {/* the handler's own sentence — this is where the numbers are */}
                            {s.message && s.state !== 'running' && (
                                <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--fg-3)' }}>{s.message}</span>
                            )}
                        </span>
                    </li>
                ))}

                {!steps.length && (
                    <li style={{ display: 'flex', gap: 13, padding: '11px 0', alignItems: 'center', color: 'var(--fg-3)' }}>
                            <Loader2 size={18} className="animate-spin" style={{ color: '#62e5ed' }} />
                        <span style={{ fontSize: 15.5 }}>{t('mobileFlow.starting', 'Getting started')}</span>
                    </li>
                )}
            </ol>

            <div style={{ padding: '0 20px 26px' }}>
                <div aria-label={`${progress}%`} style={{ height: 4, marginBottom: 10, background: 'var(--line)', borderRadius: 8, overflow: 'hidden' }}><div style={{ width: `${progress}%`, height: '100%', background: 'linear-gradient(90deg,#05d8e7,#872de3)', transition: 'width .35s ease' }} /></div>
                <p style={{ margin: '0 0 14px', color: 'var(--fg-3)', fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>{startedAt ? t('mobileFlow.timeLeft', { count: Math.max(1, 8 - Math.floor((Date.now() - startedAt) / 1000)), defaultValue: 'About {{count}} seconds left' }) : t('mobileFlow.starting', 'Getting started')}</p>
                <button
                    type="button"
                    onClick={close}
                    style={{ width: '100%', minHeight: 48, background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14.5, cursor: 'pointer', fontFamily: 'var(--f-sans)' }}
                >
                    {running
                        ? t('mobileFlow.editWhileWaiting', 'Edit while it works')
                        : t('mobileFlow.openEditor', 'Open the editor')}
                </button>
            </div>
        </div>
    );
}


/* ── The finished short ───────────────────────────────────────────────────── */

/* The editor's own preview is behind this sheet, already showing the result, so
   the player is not rebuilt here — it would mean duplicating the derived project
   and variables IDELayout computes for it. */
function ResultStep({ onShare }) {
    const { t } = useTranslation('editor');
    const close = useMobileFlowStore(s => s.close);
    const toChange = useMobileFlowStore(s => s.toChange);
    const outcomeId = useMobileFlowStore(s => s.outcomeId);
    const error = useMobileFlowStore(s => s.error);
    const duration = useTimelineStore(s => s.duration);
    const aspect = useTimelineStore(s => s.aspectRatio);
    const toVersions = useMobileFlowStore(s => s.toVersions);
    const versionCount = useVersionsStore(s => s.versions.length);

    const outcome = OUTCOME_BY_ID[outcomeId];
    const chip = {
        fontFamily: 'var(--f-mono)', fontSize: 11.5, padding: '6px 11px', borderRadius: 999,
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg-2)',
    };
    const btn = {
        flex: 1, minHeight: 50, borderRadius: 999, cursor: 'pointer',
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
        fontSize: 14.5, fontWeight: 600, fontFamily: 'var(--f-sans)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: Z, pointerEvents: 'none' }}>
            <button type="button" onClick={close} aria-label={t('mobileFlow.back', 'Back')} style={{ pointerEvents: 'auto', position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', left: 14, width: 42, height: 42, display: 'grid', placeItems: 'center', border: '1px solid rgba(255,255,255,.18)', borderRadius: 999, background: 'rgba(5,7,11,.72)', color: 'white', backdropFilter: 'blur(10px)' }}><ArrowLeft size={19} /></button>
            <span style={{ position: 'absolute', top: 'calc(18px + env(safe-area-inset-top))', right: 14, padding: '8px 12px', borderRadius: 99, border: '1px solid rgba(255,255,255,.2)', background: 'rgba(5,7,11,.72)', color: 'white', fontFamily: 'var(--f-mono)', fontSize: 11, pointerEvents: 'none' }}>{fmt(duration)}</span>
            <div style={{ ...panel, pointerEvents: 'auto', zIndex: Z + 1, maxHeight: '53dvh', overflowY: 'auto', borderRadius: '20px 20px 0 0', paddingBottom: 'calc(22px + env(safe-area-inset-bottom))' }} role="region" aria-label={t('mobileFlow.resultTitle', 'Your short')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 16px' }} />

            {error && (
                <p role="alert" style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--coral)' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {outcome && <span style={chip}>{t(`mobileFlow.outcome.${outcome.id}`, outcome.id)}</span>}
                <span style={chip}>{fmt(duration)}</span>
                <span style={chip}>{aspect || '9:16'}</span>
            </div>

            <button type="button" onClick={onShare} style={{ width: '100%', minHeight: 54, marginBottom: 11, borderRadius: 999, cursor: 'pointer', background: '#f7f8fb', color: '#080a0e', border: 'none', fontSize: 16, fontWeight: 700, fontFamily: 'var(--f-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Share2 size={17} /> {t('mobileFlow.share', 'Share it')}
            </button>

            <div style={{ display: 'flex', gap: 10, marginBottom: versionCount > 1 ? 10 : 0 }}>
                <button type="button" onClick={toChange} style={btn}><Sparkles size={15} />{t('mobileFlow.change', 'Change something')}</button>
                <button type="button" onClick={close} style={btn}><SlidersHorizontal size={15} />{t('mobileFlow.byHand', 'Edit by hand')}</button>
            </div>

            {versionCount > 1 && (
                <button
                    type="button"
                    onClick={toVersions}
                    style={{ ...btn, width: '100%', marginTop: 0, minHeight: 46, fontSize: 14, borderRadius: 14, background: 'linear-gradient(110deg,rgba(0,190,205,.08),rgba(122,42,190,.12))', borderColor: 'rgba(0,190,205,.38)' }}
                >
                    <History size={16} />
                    {t('mobileFlow.versionsCount', { count: versionCount, defaultValue: '{{count}} versions' })}
                </button>
            )}

            </div>
        </div>
    );
}

/* ── Change something ─────────────────────────────────────────────────────── */

/* Each chip is a plain request through the normal pipeline — NOT auto-approved,
   so the plan-first gate (planFirst.js) still shows its Apply step for anything
   that removes content. That was a deliberate decision and the flow does not
   get to skip it. */
const CHANGES = [
    { id: 'shorter', prompt: 'make it shorter', icon: Minus },
    { id: 'punchier', prompt: 'make it punchier', icon: Zap },
    { id: 'captions', prompt: 'make the captions bigger', icon: Type },
    { id: 'moment', prompt: 'use a different moment', icon: MessageCircle },
    { id: 'music', prompt: 'add music', icon: Music2 },
    { id: 'slower', prompt: 'slow it down', icon: Clock },
];

function ChangeStep() {
    const { t } = useTranslation('editor');
    const toResult = useMobileFlowStore(s => s.toResult);
    const choose = useMobileFlowStore(s => s.choose);
    const outcomeId = useMobileFlowStore(s => s.outcomeId);
    const [typed, setTyped] = React.useState('');

    const run = (prompt, label) => {
        const text = String(prompt || '').trim();
        if (!text) return;
        // Back to the working screen so the change is narrated like the first run.
        choose(outcomeId, text);
        editJobManager.processEditRequest(text)
            .then(() => {
                useVersionsStore.getState().capture(label || text);
                useMobileFlowStore.getState().finished();
            })
            .catch((err) => useMobileFlowStore.getState().failed(err?.message));
    };

    const chip = {
        minHeight: 76, padding: '12px 14px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
        fontSize: 14, fontWeight: 600, fontFamily: 'var(--f-sans)', display: 'flex', alignItems: 'center', gap: 12,
    };

    return (
        <>
        <button type="button" tabIndex={-1} aria-label={t('mobileFlow.back', 'Back')} onClick={toResult} style={{ position: 'fixed', inset: 0, zIndex: Z, border: 0, background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(3px)' }} />
        <div style={{ ...panel, zIndex: Z + 1, bottom: 'calc(clamp(154px, 22dvh, 190px) + env(safe-area-inset-bottom))', maxHeight: 'calc(100dvh - clamp(154px, 22dvh, 190px) - env(safe-area-inset-bottom))', overflowY: 'auto', paddingBottom: 20 }} role="region" aria-label={t('mobileFlow.change', 'Change something')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 18px' }} />

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 23, fontWeight: 750, letterSpacing: '-.03em' }}>{t('mobileFlow.change', 'Change something')}</h2>
                <button type="button" onClick={toResult} style={{ minHeight: 44, padding: '0 10px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14, cursor: 'pointer' }}>
                    {t('mobileFlow.back', 'Back')}
                </button>
            </div>

            <p style={{ margin: '-8px 0 18px', color: 'var(--fg-2)', fontSize: 13.5 }}>{t('mobileFlow.changeSubtitle', 'Tap one. It redoes the edit and keeps everything else.')}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
                {CHANGES.map(c => (
                    <button key={c.id} type="button" onClick={() => run(c.prompt, t(`mobileFlow.changes.${c.id}`, c.prompt))} style={chip}>
                        <c.icon size={17} color="#71e6ed" /> {t(`mobileFlow.changes.${c.id}`, c.prompt)}
                    </button>
                ))}
            </div>

            <label htmlFor="flow-ask" style={{ display: 'block', fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.14em', color: 'var(--fg-3)', marginBottom: 9 }}>
                {t('mobileFlow.orSay', 'OR SAY IT IN YOUR OWN WORDS')}
            </label>
            <form
                onSubmit={(e) => { e.preventDefault(); run(typed); setTyped(''); }}
                style={{ display: 'flex', gap: 9, alignItems: 'center' }}
            >
                <input
                    id="flow-ask"
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={t('mobileFlow.askPlaceholder', 'Keep only the part about pricing')}
                    style={{
                        flex: 1, minWidth: 0, minHeight: 48, padding: '0 16px', borderRadius: 999,
                        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
                        fontSize: 14.5, fontFamily: 'var(--f-sans)', outline: 'none',
                    }}
                />
                <button
                    type="submit"
                    disabled={!typed.trim()}
                    aria-label={t('mobileFlow.send', 'Send')}
                    style={{
                        width: 48, height: 48, flex: 'none', borderRadius: 999, cursor: 'pointer',
                        background: 'var(--fg)', color: 'var(--bg)', border: 'none',
                        opacity: typed.trim() ? 1 : 0.4,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                >
                        <ArrowRight size={18} />
                </button>
            </form>
            <p style={{ margin: '16px 0 0', textAlign: 'center', fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--fg-3)' }}>{t('mobileFlow.changeCost', 'Each change uses one AI edit')}</p>
        </div>
        </>
    );
}


/* ── Your versions ────────────────────────────────────────────────────────── */

/* Every finished run left one. Going back is a normal undoable step, not a
   trapdoor: projectVersions.restore pushes the state being left onto the undo
   stack first. */
function VersionsStep() {
    const { t } = useTranslation('editor');
    const toResult = useMobileFlowStore(s => s.toResult);
    const toChange = useMobileFlowStore(s => s.toChange);
    const versions = useVersionsStore(s => s.versions);
    const currentId = useVersionsStore(s => s.currentId);
    const restore = useVersionsStore(s => s.restore);
    const returnToEditor = useMobileFlowStore(s => s.returnToEditor);
    const close = useMobileFlowStore(s => s.close);
    const projectName = useTimelineStore(s => s.projectName);
    const assets = useTimelineStore(s => s.assets) || [];
    const thumb = assets.find(a => a.thumbnailUrl || a.thumbnail_url)?.thumbnailUrl || assets.find(a => a.thumbnailUrl || a.thumbnail_url)?.thumbnail_url;

    const row = (isCurrent) => ({
        display: 'flex', alignItems: 'center', gap: 13, padding: '12px 13px', borderRadius: 14,
        background: isCurrent ? 'rgba(0,205,220,.10)' : 'var(--glass)',
        border: `1px solid ${isCurrent ? 'rgba(0,205,220,.7)' : 'var(--line)'}`,
    });

    return (
        <div style={{ ...sheet, padding: 'max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))', background: 'radial-gradient(90% 40% at 100% 100%,rgba(112,35,170,.15),transparent 75%),radial-gradient(90% 40% at 0% 0%,rgba(0,190,205,.08),transparent 75%),var(--bg)' }} role="region" aria-label={t('mobileFlow.versions', 'Your versions')}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, marginBottom: 18 }}>
                <button type="button" onClick={returnToEditor ? close : toResult} aria-label={returnToEditor ? t('mobileFlow.editTimeline', 'Edit on timeline') : t('mobileFlow.back', 'Back')} style={{ display: 'grid', placeItems: 'center', width: 34, height: 40, padding: 0, border: 0, background: 'transparent', color: 'var(--fg-2)' }}><ArrowLeft size={19} /></button>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.16em', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName || t('mobileFlow.newShortEyebrow', 'NEW SHORT')}</span>
            </header>
            <h1 style={{ margin: '0 0 7px', fontSize: 28, lineHeight: 1.12, letterSpacing: '-.04em', fontWeight: 750 }}>{t('mobileFlow.versions', 'Your versions')}</h1>
            <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.45, color: 'var(--fg-2)' }}>{t('mobileFlow.versionsBody', 'Every change makes a new one. Go back to any of them.')}</p>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9, flex: 1, minHeight: 0, overflowY: 'auto' }}>
                {versions.map(v => {
                    const isCurrent = v.id === currentId;
                    return (
                        <li key={v.id} style={{ ...row(isCurrent), minHeight: 92, padding: '10px 12px', borderRadius: 16, background: isCurrent ? 'rgba(0,205,220,.08)' : 'linear-gradient(100deg,var(--glass),rgba(112,35,170,.035))' }}>
                            <span style={{ width: 55, height: 70, flex: 'none', overflow: 'hidden', borderRadius: 10, display: 'grid', placeItems: 'center', background: '#111820', color: '#72e5ec' }}>{thumb ? <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Film size={21} />}</span>
                            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--fg)' }}>{v.label}</span>
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>
                                    {fmt(v.duration)} · {v.createdAt ? (Date.now() - v.createdAt < 60_000 ? t('mobileFlow.justNow', 'just now') : t('mobileFlow.minutesAgo', { count: Math.max(1, Math.floor((Date.now() - v.createdAt) / 60_000)), defaultValue: '{{count}} min ago' })) : ''}
                                </span>
                            </span>
                            {isCurrent ? (
                                <span style={{ padding: '6px 9px', borderRadius: 99, background: '#08d7e7', color: '#031014', fontFamily: 'var(--f-mono)', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em' }}>
                                    {t('mobileFlow.now', 'NOW')}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { restore(v.id); toResult(); }}
                                    style={{
                                        flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
                                        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
                                        fontSize: 12.5, fontWeight: 650, fontFamily: 'var(--f-sans)',
                                        display: 'flex', alignItems: 'center', gap: 7,
                                    }}
                                >
                                    {t('mobileFlow.goBack', 'Go back')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            <button type="button" onClick={toChange} style={{ width: '100%', minHeight: 54, marginTop: 14, border: 0, borderRadius: 999, background: '#f7f8fb', color: '#080a0e', fontSize: 15.5, fontWeight: 700, fontFamily: 'var(--f-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><Sparkles size={16} /> {t('mobileFlow.tryAnotherChange', 'Try another change')}</button>
            <p style={{ margin: '12px 0 0', fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--fg-3)', textAlign: 'center' }}>
                {t('mobileFlow.versionsFree', 'Going back is free. Only a new edit costs one.')}
            </p>
        </div>
    );
}

/* ── Out of free Auto edits ───────────────────────────────────────────────── */

/* Deliberately not a hand-rolled screen. PlanSheet is already the mobile
   plan-limit sheet, already wired to the same Polar checkout the pricing page
   uses, and already shows the target plan's real price and features. A second
   upgrade surface would drift from it within a release. It rides on
   MobileSheet (z 60/61), so it sits above the flow and whatever the user
   already had stays behind it.

   What is behind it is chosen by whether anything exists to go back to: a
   saved version means a real short, so the result screen; nothing means the
   run was refused before it made anything, so the question. */
function LimitStep({ onShare }) {
    const limitInfo = useMobileFlowStore(s => s.limitInfo);
    const toResult = useMobileFlowStore(s => s.toResult);
    const close = useMobileFlowStore(s => s.close);
    const hasSomething = useVersionsStore(s => s.versions.length) > 0;

    return (
        <>
            {hasSomething ? <ResultStep onShare={onShare} /> : <OutcomeStep />}
            <PlanSheet
                open
                reason={limitInfo?.reason || 'ai_ops'}
                upgradeTo={limitInfo?.upgradeRequired || 'creator'}
                onClose={() => (hasSomething ? toResult() : close())}
            />
        </>
    );
}

/* ── The flow ─────────────────────────────────────────────────────────────── */

export default function MobileFlow({ onShare }) {
    const active = useMobileFlowStore(s => s.active);
    const step = useMobileFlowStore(s => s.step);
    const limited = useMobileFlowStore(s => s.limited);

    // A 402 from the usage gate arrives on the shared QUOTA_EXCEEDED channel,
    // the same one the editor listens to. While the flow is open the refusal
    // becomes a step of the flow rather than a sheet thrown over it, and
    // IDELayout stands down so there is one prompt and not two. R148.
    React.useEffect(() => {
        if (!active) return undefined;
        return EventBus.on(EVENT_TYPES.QUOTA_EXCEEDED, (payload) => limited(payload || {}));
    }, [active, limited]);

    if (!active) return null;
    if (step === 'outcome') return <OutcomeStep />;
    if (step === 'working') return <WorkingStep />;
    if (step === 'change') return <ChangeStep />;
    if (step === 'versions') return <VersionsStep />;
    if (step === 'limit') return <LimitStep onShare={onShare} />;
    return <ResultStep onShare={onShare} />;
}
