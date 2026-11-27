/**
 * client/src/components/AgentRunCard.jsx — the shorts agent run at the top of
 * the Shorts panel (R176b): the plan to approve, progress, the keep/drop
 * summary, and how the run ended. The keep/drop buttons themselves sit on each
 * short in ShortsPanel's list.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, X, Loader2, Square, RotateCcw, AlertTriangle, CloudOff } from 'lucide-react';
import useAgentRunStore from '../store/useAgentRunStore.js';
import useTimelineStore from '../store/useTimelineStore';
import { STATUS } from '../agent/runs/runState.js';
import { PLATFORMS, MAX_SHORTS } from '../agent/runs/goalContract.js';
import { PLATFORM_PROFILES } from '../agent/PlatformProfiles.js';

const box = 'mb-3 p-2.5 rounded border border-primary/40 bg-primary/10 text-[11px] space-y-2';
const btn = 'px-2 py-1 rounded text-[11px] flex items-center gap-1 disabled:opacity-50';

function CostLine({ cost, t }) {
    if (!cost || !cost.aiCalls) return null;
    const tokens = (cost.inputTokens || 0) + (cost.outputTokens || 0);
    return (
        <p className="text-[10px] font-mono text-muted-foreground">
            {t('agentRun.cost', { calls: cost.aiCalls, tokens: tokens.toLocaleString(), defaultValue: '{{calls}} AI calls, {{tokens}} tokens' })}
        </p>
    );
}

/** What the request asked for, as the plan will be judged. */
function CriteriaList({ criteria, t }) {
    const c = criteria || {};
    const items = [
        c.count ? t('agentRun.cCount', { count: c.count, defaultValue: '{{count}} short(s)' }) : null,
        c.maxSeconds ? t('agentRun.cLength', { s: c.maxSeconds, defaultValue: 'each under {{s}} s' }) : null,
        c.captions === true ? t('agentRun.cCaptions', 'captions on') : c.captions === false ? t('agentRun.cNoCaptions', 'no captions') : null,
        c.brand ? t('agentRun.cBrand', 'brand colours') : null,
        c.platforms?.length ? c.platforms.map(p => PLATFORM_PROFILES[p]?.label || p).join(', ') : null,
    ].filter(Boolean);
    if (!items.length) return null;
    return <p className="text-[10px]"><span className="text-muted-foreground">{t('agentRun.checkedAgainst', 'Checked at the end against:')}</span> {items.join(' · ')}</p>;
}

/** The verify step's result. */
function Verdict({ verification, t }) {
    if (!verification?.checks?.length) return null;
    return (
        <div className="space-y-0.5">
            <p className={verification.met ? 'text-emerald-400' : 'text-amber-400'}>
                {verification.met ? t('agentRun.met', 'Everything you asked for is met.') : t('agentRun.notMet', 'Not everything you asked for is met:')}
            </p>
            <ul className="space-y-0.5">
                {verification.checks.map((c, i) => (
                    <li key={`${c.id}-${i}`} className={`flex items-start gap-1 text-[10px] ${c.ok ? 'text-foreground/80' : 'text-amber-300'}`}>
                        {c.ok ? <Check className="w-3 h-3 shrink-0 mt-px text-emerald-400" /> : <X className="w-3 h-3 shrink-0 mt-px" />}
                        <span>{c.detail}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function AgentRunCard() {
    const { t } = useTranslation('editor');
    const run = useAgentRunStore(s => s.run);
    const saved = useAgentRunStore(s => s.saved);
    const saveError = useAgentRunStore(s => s.saveError);
    const error = useAgentRunStore(s => s.error);
    const [count, setCount] = useState(3);
    const [platforms, setPlatforms] = useState([...PLATFORMS]);
    const [maxSeconds, setMaxSeconds] = useState('');
    const hasBrandKit = useTimelineStore(s => !!s.brandKit);
    const [busy, setBusy] = useState(false);

    const planKey = run?.status === STATUS.AWAITING_PLAN ? run.id || run.createdAt : null;
    // A new plan to approve: start the editors from what was proposed.
    useEffect(() => {
        if (!planKey) return;
        setCount(run.plan.count);
        setPlatforms(run.plan.platforms);
        setMaxSeconds(run.plan.maxSeconds ? String(run.plan.maxSeconds) : '');
        // Only when a new plan appears.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [planKey]);

    if (!run) return error ? <p className="mb-2 text-[10px] text-amber-400">{error}</p> : null;

    const store = useAgentRunStore.getState();
    const act = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
    const decided = run.shortIds.filter(id => run.decisions[id]).length;
    const kept = run.shortIds.filter(id => run.decisions[id]?.decision === 'kept').length;
    const finishedCount = Object.keys(run.finished || {}).length;

    return (
        <div className={box} data-testid="agent-run-card">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <Bot className="w-3.5 h-3.5 text-primary" />
                <span className="flex-1">{t('agentRun.title', 'Shorts run')}</span>
                {!saved && (
                    <span className="flex items-center gap-1 text-[10px] font-normal text-amber-400" title={saveError || ''}>
                        <CloudOff className="w-3 h-3" /> {t('agentRun.notSaved', 'Not saved')}
                    </span>
                )}
            </div>

            {run.status === STATUS.AWAITING_PLAN && (
                <>
                    {run.goal?.request && <p className="italic text-foreground/80">“{run.goal.request}”</p>}
                    <p className="text-muted-foreground">{t('agentRun.planIntro', 'Check the plan. Nothing happens until you approve it, and your main edit is never changed.')}</p>
                    <label className="flex items-center justify-between gap-2">
                        <span>{t('agentRun.count', 'Number of shorts')}</span>
                        <input type="number" min={1} max={MAX_SHORTS} value={count}
                            onChange={e => setCount(Math.max(1, Math.min(MAX_SHORTS, Number(e.target.value) || 1)))}
                            className="w-14 bg-background border border-border rounded px-1 py-0.5 text-right" />
                    </label>
                    <label className="flex items-center justify-between gap-2">
                        <span>{t('agentRun.maxLength', 'Longest a short may be (s)')}</span>
                        <input type="number" min={10} max={180} placeholder={t('agentRun.noLimit', 'auto')} value={maxSeconds}
                            onChange={e => setMaxSeconds(e.target.value)}
                            className="w-14 bg-background border border-border rounded px-1 py-0.5 text-right" />
                    </label>
                    <div className="flex flex-wrap gap-1">
                        {PLATFORMS.map(id => {
                            const on = platforms.includes(id);
                            return (
                                <button key={id} type="button" aria-pressed={on}
                                    onClick={() => setPlatforms(p => (on ? (p.length > 1 ? p.filter(x => x !== id) : p) : [...p, id]))}
                                    className={`px-2 py-0.5 rounded border text-[10px] ${on ? 'border-primary/60 bg-primary/20 text-primary' : 'border-border text-muted-foreground'}`}>
                                    {PLATFORM_PROFILES[id]?.label || id}
                                </button>
                            );
                        })}
                    </div>
                    <CriteriaList criteria={run.criteria} t={t} />
                    {run.criteria?.brand && !hasBrandKit && (
                        <p className="flex items-start gap-1 text-[10px] text-amber-400"><AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                            {t('agentRun.noBrandKit', "This project has no brand kit yet, so the brand colours can't be applied. Set one first (for example: \"set our brand colours to #FF3B5C and #111111\") or the check will fail.")}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">{t('agentRun.planSteps', 'Then: find the strongest passages, you keep or drop each one, and the kept ones are finished (framing, captions, motion, sound). It stops there: exporting and posting stay with you.')}</p>
                    <div className="flex gap-1.5">
                        <button type="button" disabled={busy} onClick={() => act(() => store.approvePlan({ count, platforms, maxSeconds: Number(maxSeconds) >= 10 ? Number(maxSeconds) : null }))}
                            className={`${btn} bg-primary text-primary-foreground`}>
                            <Check className="w-3 h-3" /> {t('agentRun.approvePlan', 'Approve and find')}
                        </button>
                        <button type="button" disabled={busy} onClick={() => act(() => store.rejectPlan(t('agentRun.declined', 'Plan declined')))}
                            className={`${btn} bg-secondary`}>
                            <X className="w-3 h-3" /> {t('agentRun.cancel', 'Cancel')}
                        </button>
                    </div>
                </>
            )}

            {run.status === STATUS.FINDING && (
                <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="flex-1">{t('agentRun.finding', 'Finding the strongest passages…')}</span>
                    <button type="button" onClick={() => store.stop()} className={`${btn} bg-secondary`}><Square className="w-3 h-3" /> {t('agentRun.stop', 'Stop')}</button>
                </div>
            )}

            {run.status === STATUS.AWAITING_REVIEW && (
                <>
                    <p>{t('agentRun.review', { decided, total: run.shortIds.length, defaultValue: 'Keep or drop each short below ({{decided}} of {{total}} decided).' })}</p>
                    <div className="flex gap-1.5">
                        <button type="button" disabled={busy || decided < run.shortIds.length} onClick={() => act(() => store.finishKept())}
                            className={`${btn} bg-primary text-primary-foreground`}>
                            <Check className="w-3 h-3" /> {kept
                                ? t('agentRun.finishKept', { count: kept, defaultValue: 'Finish {{count}} kept' })
                                : t('agentRun.dropAll', 'Drop all and stop')}
                        </button>
                        <button type="button" disabled={busy} onClick={() => store.stop()} className={`${btn} bg-secondary`}><Square className="w-3 h-3" /> {t('agentRun.stop', 'Stop')}</button>
                    </div>
                </>
            )}

            {run.status === STATUS.FINISHING && (
                <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="flex-1">{t('agentRun.finishing', { done: finishedCount, total: kept, defaultValue: 'Finishing shorts: {{done}} of {{total}}…' })}</span>
                    <button type="button" onClick={() => store.stop()} className={`${btn} bg-secondary`}><Square className="w-3 h-3" /> {t('agentRun.stop', 'Stop')}</button>
                </div>
            )}

            {run.status === STATUS.INTERRUPTED && (
                <>
                    <p className="flex items-start gap-1 text-amber-400"><AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                        {t('agentRun.interrupted', 'The page closed while this run was working. Resume to pick up where it stopped.')}</p>
                    <div className="flex gap-1.5">
                        <button type="button" disabled={busy} onClick={() => act(() => store.resume())} className={`${btn} bg-primary text-primary-foreground`}>
                            <RotateCcw className="w-3 h-3" /> {t('agentRun.resume', 'Resume')}
                        </button>
                        <button type="button" disabled={busy} onClick={() => store.stop()} className={`${btn} bg-secondary`}><Square className="w-3 h-3" /> {t('agentRun.stop', 'Stop')}</button>
                    </div>
                </>
            )}

            {run.status === STATUS.DONE && (
                <>
                    <p>{t('agentRun.done', { count: finishedCount, defaultValue: '{{count}} short(s) finished. Preview, export or post them below.' })}</p>
                    <Verdict verification={run.verification} t={t} />
                    <CostLine cost={run.cost} t={t} />
                    <button type="button" onClick={() => store.dismiss()} className={`${btn} bg-secondary`}>{t('agentRun.dismiss', 'Dismiss')}</button>
                </>
            )}

            {(run.status === STATUS.STOPPED || run.status === STATUS.FAILED) && (
                <>
                    <p className={run.status === STATUS.FAILED ? 'text-amber-400' : 'text-muted-foreground'}>
                        {run.status === STATUS.FAILED ? t('agentRun.failed', 'The run failed:') : t('agentRun.stopped', 'The run stopped:')} {run.stopReason}
                    </p>
                    <CostLine cost={run.cost} t={t} />
                    <button type="button" onClick={() => store.dismiss()} className={`${btn} bg-secondary`}>{t('agentRun.dismiss', 'Dismiss')}</button>
                </>
            )}

            {error && <p className="text-[10px] text-amber-400">{error}</p>}
        </div>
    );
}
