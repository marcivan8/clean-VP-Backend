import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, Loader2, Share2, Sparkles, SlidersHorizontal, History, RotateCcw } from 'lucide-react';
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
    background: 'var(--bg)', color: 'var(--fg)',
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
    const close = useMobileFlowStore(s => s.close);
    const error = useMobileFlowStore(s => s.error);

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
        <div style={sheet}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '14px 12px 0' }}>
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
                            background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
                            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8,
                            fontFamily: 'var(--f-sans)',
                        }}
                    >
                        <span style={{ fontSize: 16.5, fontWeight: 600, lineHeight: 1.2 }}>
                            {t(`mobileFlow.outcome.${o.id}`, o.id)}
                        </span>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>{o.range}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

/* ── It edits ─────────────────────────────────────────────────────────────── */

function WorkingStep() {
    const { t } = useTranslation('editor');
    const steps = useEditStepsStore(s => s.steps);
    const close = useMobileFlowStore(s => s.close);
    const liveRef = useRef(null);

    // Only the finished steps carry a sentence; the running one is the heading
    // of the list, not a line in it.
    const running = steps.find(s => s.state === 'running');

    return (
        <div style={sheet}>
            <div style={{ padding: '26px 20px 0' }}>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.16em', color: 'var(--accent)' }}>
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
                                ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
                                : s.state === 'failed'
                                    ? <X size={18} style={{ color: 'var(--fg-4)' }} />
                                    : <Check size={18} style={{ color: 'var(--mint)' }} />}
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
                        <Loader2 size={18} className="animate-spin" style={{ color: 'var(--accent)' }} />
                        <span style={{ fontSize: 15.5 }}>{t('mobileFlow.starting', 'Getting started')}</span>
                    </li>
                )}
            </ol>

            <div style={{ padding: '0 20px 26px' }}>
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
        <div style={panel} role="region" aria-label={t('mobileFlow.resultTitle', 'Your short')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 16px' }} />

            {error && (
                <p role="alert" style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--coral)' }}>{error}</p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
                {outcome && <span style={chip}>{t(`mobileFlow.outcome.${outcome.id}`, outcome.id)}</span>}
                <span style={chip}>{fmt(duration)}</span>
                <span style={chip}>{aspect || '9:16'}</span>
            </div>

            <button
                type="button"
                onClick={onShare}
                style={{
                    width: '100%', minHeight: 54, borderRadius: 999, cursor: 'pointer', marginBottom: 11,
                    background: 'var(--fg)', color: 'var(--bg)', border: 'none',
                    fontSize: 16.5, fontWeight: 700, fontFamily: 'var(--f-sans)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                }}
            >
                <Share2 size={18} />
                {t('mobileFlow.share', 'Share it')}
            </button>

            {versionCount > 1 && (
                <button
                    type="button"
                    onClick={toVersions}
                    style={{ ...btn, width: '100%', marginBottom: 11, minHeight: 46, fontSize: 14 }}
                >
                    <History size={16} />
                    {t('mobileFlow.versionsCount', { count: versionCount, defaultValue: '{{count}} versions' })}
                </button>
            )}

            <div style={{ display: 'flex', gap: 11 }}>
                <button type="button" onClick={toChange} style={btn}>
                    <Sparkles size={16} />
                    {t('mobileFlow.change', 'Change something')}
                </button>
                <button type="button" onClick={close} style={btn}>
                    <SlidersHorizontal size={16} />
                    {t('mobileFlow.byHand', 'Edit by hand')}
                </button>
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
    { id: 'shorter', prompt: 'make it shorter' },
    { id: 'punchier', prompt: 'make it punchier' },
    { id: 'captions', prompt: 'make the captions bigger' },
    { id: 'moment', prompt: 'use a different moment' },
    { id: 'music', prompt: 'add music' },
    { id: 'slower', prompt: 'slow it down' },
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
        minHeight: 48, padding: '14px 15px', borderRadius: 14, cursor: 'pointer', textAlign: 'left',
        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
        fontSize: 14.5, fontWeight: 500, fontFamily: 'var(--f-sans)',
    };

    return (
        <div style={panel} role="region" aria-label={t('mobileFlow.change', 'Change something')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 16px' }} />

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{t('mobileFlow.change', 'Change something')}</h2>
                <button type="button" onClick={toResult} style={{ minHeight: 44, padding: '0 10px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14, cursor: 'pointer' }}>
                    {t('mobileFlow.back', 'Back')}
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 16 }}>
                {CHANGES.map(c => (
                    <button key={c.id} type="button" onClick={() => run(c.prompt, t(`mobileFlow.changes.${c.id}`, c.prompt))} style={chip}>
                        {t(`mobileFlow.changes.${c.id}`, c.prompt)}
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
                    <Check size={18} />
                </button>
            </form>
        </div>
    );
}


/* ── Your versions ────────────────────────────────────────────────────────── */

/* Every finished run left one. Going back is a normal undoable step, not a
   trapdoor: projectVersions.restore pushes the state being left onto the undo
   stack first. */
function VersionsStep() {
    const { t } = useTranslation('editor');
    const toResult = useMobileFlowStore(s => s.toResult);
    const versions = useVersionsStore(s => s.versions);
    const currentId = useVersionsStore(s => s.currentId);
    const restore = useVersionsStore(s => s.restore);

    const row = (isCurrent) => ({
        display: 'flex', alignItems: 'center', gap: 13, padding: '12px 13px', borderRadius: 14,
        background: isCurrent ? 'var(--accent-soft)' : 'var(--glass)',
        border: `1px solid ${isCurrent ? 'var(--accent)' : 'var(--line)'}`,
    });

    return (
        <div style={panel} role="region" aria-label={t('mobileFlow.versions', 'Your versions')}>
            <div aria-hidden="true" style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--line-strong)', margin: '-8px auto 16px' }} />

            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{t('mobileFlow.versions', 'Your versions')}</h2>
                <button type="button" onClick={toResult} style={{ minHeight: 44, padding: '0 10px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14, cursor: 'pointer' }}>
                    {t('mobileFlow.back', 'Back')}
                </button>
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--fg-2)' }}>
                {t('mobileFlow.versionsBody', 'Every change makes a new one. Nothing is lost.')}
            </p>

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 300, overflowY: 'auto' }}>
                {versions.map(v => {
                    const isCurrent = v.id === currentId;
                    return (
                        <li key={v.id} style={row(isCurrent)}>
                            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>{v.label}</span>
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)' }}>
                                    {fmt(v.duration)}
                                </span>
                            </span>
                            {isCurrent ? (
                                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--accent)' }}>
                                    {t('mobileFlow.now', 'NOW')}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { restore(v.id); toResult(); }}
                                    style={{
                                        flex: 'none', minHeight: 44, padding: '0 14px', borderRadius: 999, cursor: 'pointer',
                                        background: 'var(--glass)', border: '1px solid var(--line)', color: 'var(--fg)',
                                        fontSize: 13.5, fontWeight: 600, fontFamily: 'var(--f-sans)',
                                        display: 'flex', alignItems: 'center', gap: 7,
                                    }}
                                >
                                    <RotateCcw size={14} />
                                    {t('mobileFlow.goBack', 'Go back')}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>

            <p style={{ margin: '16px 0 0', fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-3)', textAlign: 'center' }}>
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
