/**
 * client/src/components/AgentRunCard.jsx — the shorts agent run at the top of
 * the Shorts panel (R176b): the plan to approve, progress, the keep/drop
 * summary, and how the run ended. The keep/drop buttons themselves sit on each
 * short in ShortsPanel's list.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, X, Loader2, Square, RotateCcw, AlertTriangle, CloudOff, CalendarClock, RefreshCw, Link2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { connectDestination } from '../lib/socialDestinations.js';
import { postProblem, approvedPosts } from '../agent/runs/runState.js';
import { POST_TITLE_MAX, POST_CAPTION_MAX } from '../agent/runs/goalContract.js';
import useAgentRunStore from '../store/useAgentRunStore.js';
import useTimelineStore from '../store/useTimelineStore';
import { STATUS } from '../agent/runs/runState.js';
import { PLATFORMS, MAX_SHORTS } from '../agent/runs/goalContract.js';
import { PLATFORM_PROFILES } from '../agent/PlatformProfiles.js';

const box = 'mb-3 p-2.5 rounded border border-primary/40 bg-primary/10 text-[11px] space-y-2';
const btn = 'px-2 py-1 rounded text-[11px] flex items-center gap-1 disabled:opacity-50';

function CostLine({ cost, budget, t }) {
    if (!cost || !cost.aiCalls) return null;
    const tokens = (cost.inputTokens || 0) + (cost.outputTokens || 0);
    return (
        <p className="text-[10px] font-mono text-muted-foreground">
            {t('agentRun.cost', { calls: cost.aiCalls, tokens: tokens.toLocaleString(), defaultValue: '{{calls}} AI calls, {{tokens}} tokens' })}
            {budget?.maxAiCalls ? ` · ${t('agentRun.budgetOf', { max: budget.maxAiCalls, defaultValue: 'budget {{max}}' })}` : ''}
        </p>
    );
}

/** R180: the budget a run works within, shown before it starts. */
function BudgetLine({ budget, t }) {
    if (!budget?.maxAiCalls) return null;
    return (
        <p className="text-[10px] text-muted-foreground">
            {t('agentRun.budget', {
                calls: budget.maxAiCalls, minutes: budget.maxExportMinutes, used: budget.usedThisMonth || 0, monthly: budget.monthlyAiCalls,
                defaultValue: 'Budget: up to {{calls}} AI calls and {{minutes}} min of exported video for this run ({{used}} of {{monthly}} AI calls used by runs this month). It stops and tells you if it would go past.',
            })}
        </p>
    );
}

/** R180: what earlier runs taught this plan, with a way to forget it. */
function LearnedBox({ learned, t, busy, onReset }) {
    if (!learned) return null;
    const parts = [
        learned.preferredLabel && learned.preferredTotal
            ? t('agentRun.learnedLength', { label: t(`agentRun.bucket_${learned.preferredBucket}`, learned.preferredLabel), kept: learned.preferredKept, total: learned.preferredTotal, defaultValue: 'you keep {{label}} shorts most ({{kept}} of {{total}})' })
            : null,
        learned.adjusted?.includes('count') ? t('agentRun.learnedCount', { count: learned.count, defaultValue: 'so {{count}} shorts' }) : null,
        learned.adjusted?.includes('maxSeconds') ? t('agentRun.learnedMax', { s: learned.maxSeconds, defaultValue: 'up to {{s}} s each' }) : null,
        learned.posted ? t('agentRun.learnedPosted', { count: learned.posted, defaultValue: 'and how {{count}} posted shorts performed' }) : null,
    ].filter(Boolean);
    return (
        <div className="rounded border border-border bg-background/60 p-1.5 text-[10px] space-y-1">
            <p>
                <span className="text-muted-foreground">{t('agentRun.learnedFrom', { runs: learned.runs, decided: learned.decided, defaultValue: 'Learned from your last {{runs}} runs ({{decided}} shorts kept or dropped):' })}</span>{' '}
                {parts.join(', ') || t('agentRun.learnedRanking', 'it ranks the shorts it finds by what you kept')}.
            </p>
            <button type="button" disabled={busy} onClick={onReset} className="text-primary underline disabled:opacity-50">{t('agentRun.learnedReset', 'Forget this and use the defaults')}</button>
        </div>
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

const PROVIDER_LABEL = { youtube: 'YouTube Shorts', instagram: 'Instagram Reels' };

/** ISO -> the value a datetime-local input shows (local time). */
function toLocalInput(iso) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value) {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * The one approval of a shorts_to_posts run (R179): every post with its
 * platform, time, title and caption, editable, and what blocks it. Nothing is
 * exported or scheduled until "Approve and schedule".
 */
function ScheduleApproval({ run, t, busy, act }) {
    const store = useAgentRunStore.getState();
    const shorts = useTimelineStore(s => s.shorts) || [];
    const [posts, setPosts] = useState(run.posts);
    // New problems from "Check accounts again" replace the local copy's, keeping edits.
    useEffect(() => {
        setPosts(local => run.posts.map((p) => {
            const mine = local.find(x => x.key === p.key);
            return mine ? { ...mine, problem: p.problem } : p;
        }));
    }, [run.posts]);
    const edit = (key, patch) => setPosts(list => list.map(p => (p.key === key ? { ...p, ...patch } : p)));
    const going = posts.filter(p => !p.skip);
    const blocked = going.some(p => postProblem(p));
    const timingNote = run.steps.find(st => st.id === 'prepare_posts' && st.status === 'done')?.note;
    const problemText = (p) => {
        if (p.problem === 'unsupported') return t('agentRun.postUnsupported', 'Posting to this platform is not supported yet, so this short is left out. Export it from the list below.');
        if (p.problem === 'not_connected') return t('agentRun.postNotConnected', 'Connect this account first.');
        if (p.problem === 'reconnect') return t('agentRun.postReconnect', 'This account needs to be reconnected.');
        return postProblem(p);
    };
    return (
        <>
            <p>{t('agentRun.scheduleIntro', 'Check the schedule. Nothing is exported or posted until you approve it, and every post can still be cancelled in the Planner before it goes out.')}</p>
            {timingNote && <p className="text-[10px] text-muted-foreground">{timingNote}</p>}
            <ul className="space-y-2">
                {posts.map((p) => {
                    const short = shorts.find(s => s.id === p.shortId);
                    const why = !p.skip ? problemText(p) : (p.problem === 'unsupported' ? problemText(p) : null);
                    return (
                        <li key={p.key} className={`rounded border p-2 space-y-1.5 ${p.skip ? 'border-border opacity-60' : 'border-primary/30 bg-background/60'}`}>
                            <div className="flex items-center gap-1.5">
                                <input type="checkbox" checked={!p.skip} disabled={p.problem === 'unsupported'} aria-label={t('agentRun.postInclude', 'Schedule this post')}
                                    onChange={e => edit(p.key, { skip: !e.target.checked })} />
                                <span className="font-semibold flex-1 truncate">{PROVIDER_LABEL[p.provider] || PLATFORM_PROFILES[p.platform]?.label || p.platform}{short?.title ? ` · ${short.title}` : ''}</span>
                                {p.publicationId && <Check className="w-3 h-3 text-emerald-400" />}
                            </div>
                            {why && (
                                <p className="flex items-start gap-1 text-[10px] text-amber-400"><AlertTriangle className="w-3 h-3 shrink-0 mt-px" /><span className="flex-1">{why}</span>
                                    {(p.problem === 'not_connected' || p.problem === 'reconnect') && p.provider && (
                                        <button type="button" disabled={busy} onClick={() => connectDestination(p.provider, window.location.pathname)}
                                            className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-primary"><Link2 className="w-3 h-3" /> {t('agentRun.connect', 'Connect')}</button>
                                    )}
                                </p>
                            )}
                            {!p.skip && p.provider && (
                                <>
                                    <label className="flex items-center justify-between gap-2 text-[10px]">
                                        <span className="text-muted-foreground">{p.timeFromData ? t('agentRun.postTimeBest', 'Time (your best hour)') : t('agentRun.postTimeDefault', 'Time')}</span>
                                        <input type="datetime-local" value={toLocalInput(p.scheduledAt)} onChange={e => edit(p.key, { scheduledAt: fromLocalInput(e.target.value) })}
                                            className="bg-background border border-border rounded px-1 py-0.5" />
                                    </label>
                                    {p.provider === 'youtube' && (
                                        <input value={p.title} maxLength={POST_TITLE_MAX} onChange={e => edit(p.key, { title: e.target.value })}
                                            placeholder={t('agentRun.postTitle', 'YouTube title')} className="w-full bg-background border border-border rounded px-1.5 py-1" />
                                    )}
                                    <textarea value={p.caption} maxLength={POST_CAPTION_MAX} rows={3} onChange={e => edit(p.key, { caption: e.target.value })}
                                        placeholder={p.provider === 'youtube' ? t('agentRun.postDescription', 'Description') : t('agentRun.postCaption', 'Reel caption')}
                                        className="w-full resize-y bg-background border border-border rounded px-1.5 py-1" />
                                    {!p.copyFromAI && <p className="text-[10px] text-muted-foreground">{t('agentRun.postNoAiCopy', 'The copy could not be written automatically; write it here.')}</p>}
                                </>
                            )}
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-wrap gap-1.5">
                <button type="button" disabled={busy || !going.length || blocked} onClick={() => act(() => store.approveSchedule(posts))}
                    className={`${btn} bg-primary text-primary-foreground`}>
                    <CalendarClock className="w-3 h-3" /> {t('agentRun.approveSchedule', { count: going.length, defaultValue: 'Approve and schedule {{count}}' })}
                </button>
                <button type="button" disabled={busy} onClick={() => act(() => store.refreshAccounts())} className={`${btn} bg-secondary`}>
                    <RefreshCw className="w-3 h-3" /> {t('agentRun.recheckAccounts', 'Check accounts again')}
                </button>
                <button type="button" disabled={busy} onClick={() => act(() => store.rejectSchedule(t('agentRun.scheduleDeclined', 'Schedule declined')))} className={`${btn} bg-secondary`}>
                    <X className="w-3 h-3" /> {t('agentRun.dontSchedule', "Don't schedule")}
                </button>
            </div>
        </>
    );
}

/** What the post step did, once the run ended. */
function PostedList({ run, t }) {
    const navigate = useNavigate();
    const posts = approvedPosts(run);
    if (!posts.length) return null;
    return (
        <div className="space-y-0.5">
            <ul className="space-y-0.5">
                {posts.map(p => (
                    <li key={p.key} className={`flex items-start gap-1 text-[10px] ${p.publicationId ? 'text-foreground/80' : 'text-amber-300'}`}>
                        {p.publicationId ? <Check className="w-3 h-3 shrink-0 mt-px text-emerald-400" /> : <X className="w-3 h-3 shrink-0 mt-px" />}
                        <span>{PROVIDER_LABEL[p.provider] || p.provider}: {p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : ''}{p.error ? `. ${p.error}` : ''}</span>
                    </li>
                ))}
            </ul>
            <button type="button" onClick={() => navigate('/planner')} className="text-[10px] text-primary underline">{t('agentRun.openPlanner', 'Open the Planner')}</button>
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

    // The learning (or its reset) changes the proposed plan too (R180).
    const planKey = run?.status === STATUS.AWAITING_PLAN ? `${run.id || run.createdAt}:${run.learned ? 'learned' : 'default'}` : null;
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
    const posting = run.goal?.kind === 'shorts_to_posts';
    const scheduledCount = (run.posts || []).filter(p => p.publicationId).length;

    return (
        <div className={box} data-testid="agent-run-card">
            <div className="flex items-center gap-1.5 font-semibold text-foreground">
                <Bot className="w-3.5 h-3.5 text-primary" />
                <span className="flex-1">{posting ? t('agentRun.titlePosts', 'Shorts and posting run') : t('agentRun.title', 'Shorts run')}</span>
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
                    <LearnedBox learned={run.learned} t={t} busy={busy} onReset={() => act(() => store.resetLearning())} />
                    <BudgetLine budget={run.budget} t={t} />
                    {run.criteria?.brand && !hasBrandKit && (
                        <p className="flex items-start gap-1 text-[10px] text-amber-400"><AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                            {t('agentRun.noBrandKit', "This project has no brand kit yet, so the brand colours can't be applied. Set one first (for example: \"set our brand colours to #FF3B5C and #111111\") or the check will fail.")}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground">{posting
                        ? t('agentRun.planStepsPosts', 'Then: find the strongest passages, you keep or drop each one, the kept ones are finished, and you get the whole schedule (times from your best hours, copy written for each platform) to approve once. Only then are they exported and scheduled.')
                        : t('agentRun.planSteps', 'Then: find the strongest passages, you keep or drop each one, and the kept ones are finished (framing, captions, motion, sound). It stops there: exporting and posting stay with you.')}</p>
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

            {run.status === STATUS.PREPARING_POSTS && (
                <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="flex-1">{t('agentRun.preparingPosts', 'Writing the copy and picking the times…')}</span>
                    <button type="button" onClick={() => store.stop()} className={`${btn} bg-secondary`}><Square className="w-3 h-3" /> {t('agentRun.stop', 'Stop')}</button>
                </div>
            )}

            {run.status === STATUS.AWAITING_SCHEDULE && (
                <>
                    <Verdict verification={run.verification} t={t} />
                    <ScheduleApproval run={run} t={t} busy={busy} act={act} />
                </>
            )}

            {run.status === STATUS.POSTING && (
                <div className="flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    <span className="flex-1">{t('agentRun.posting', { done: scheduledCount, total: approvedPosts(run).length, defaultValue: 'Exporting and scheduling: {{done}} of {{total}}… Keep this tab open.' })}</span>
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
                    <p>{posting
                        ? t('agentRun.donePosts', { count: scheduledCount, defaultValue: '{{count}} post(s) scheduled. You can move or cancel them in the Planner.' })
                        : t('agentRun.done', { count: finishedCount, defaultValue: '{{count}} short(s) finished. Preview, export or post them below.' })}</p>
                    <Verdict verification={run.verification} t={t} />
                    {posting && <PostedList run={run} t={t} />}
                    <CostLine cost={run.cost} budget={run.budget} t={t} />
                    <button type="button" onClick={() => store.dismiss()} className={`${btn} bg-secondary`}>{t('agentRun.dismiss', 'Dismiss')}</button>
                </>
            )}

            {(run.status === STATUS.STOPPED || run.status === STATUS.FAILED) && (
                <>
                    <p className={run.status === STATUS.FAILED ? 'text-amber-400' : 'text-muted-foreground'}>
                        {run.status === STATUS.FAILED ? t('agentRun.failed', 'The run failed:') : t('agentRun.stopped', 'The run stopped:')} {run.stopReason}
                    </p>
                    {posting && <PostedList run={run} t={t} />}
                    <CostLine cost={run.cost} budget={run.budget} t={t} />
                    <button type="button" onClick={() => store.dismiss()} className={`${btn} bg-secondary`}>{t('agentRun.dismiss', 'Dismiss')}</button>
                </>
            )}

            {error && <p className="text-[10px] text-amber-400">{error}</p>}
        </div>
    );
}
