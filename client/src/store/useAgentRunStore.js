/**
 * client/src/store/useAgentRunStore.js — runs a goal ("turn this video into
 * shorts") step by step in the browser, with the user's approvals, and saves
 * every change of state (R176b).
 *
 * The rules (what may happen, when, and in what order) live in the pure
 * agent/runs/runState.js and goalContract.js. This store only does the work
 * each step names, using the existing pipeline unchanged:
 *   find   -> the repurpose_shorts command (MediaExecutionEngine), the same
 *             one the "Find shorts" button and the chat use;
 *   finish -> shortFinisher.finishShort for each kept short, cached in
 *             finishedShortCache so Preview and Export reuse it.
 * The main edit is never changed; dropped shorts are removed from the list.
 *
 * R179, shorts_to_posts runs continue after the verify step:
 *   prepare_posts -> a post per finished short (draftSchedule: platform,
 *                    best hour, problems) with copy from /api/social/copy/generate;
 *   (the user approves the whole schedule once)
 *   post          -> the Shorts panel's export (registered by IDELayout in
 *                    runs/shortExporter.js), then POST /api/social/publications.
 */
import { create } from 'zustand';
import useTimelineStore from './useTimelineStore';
import { GOAL_KINDS, createGoal, postsAfterFinish, POST_PROVIDER } from '../agent/runs/goalContract.js';
import { STATUS, RUNNING, TERMINAL, createRun, applyRunEvent, pendingFinish, pendingPosts, overBudget } from '../agent/runs/runState.js';
import { createRunRemote, saveRunRemote, latestRunRemote, runHistoryRemote, resetLearningRemote } from '../agent/runs/runsApi.js';
import { learnFromRuns, applyLearning, learnedSummary, pickWithLearning, factsOfShort } from '../agent/runs/runLearning.js';
import { enterAgentStep, leaveAgentStep } from '../agent/runs/agentRunContext.js';
import { putFinishedShort, getFinishedShort } from '../agent/finishedShortCache.js';
import { verifyShorts, shortFacts } from '../agent/runs/goalVerify.js';
import { draftSchedule, refreshProblems, inPostWindow } from '../agent/runs/postSchedule.js';
import { getShortExporter } from '../agent/runs/shortExporter.js';
import { authFetch } from '../utils/authFetch.js';
import { fetchDestinations } from '../lib/socialDestinations.js';
import { isPostableExport } from '../lib/socialFormat.js';
import { PLATFORM_PROFILES } from '../agent/PlatformProfiles.js';

const REMOVED_NOTE = 'removed from the list before it was finished';
/** Extra candidates asked for when learning can choose between them (R180). */
const LEARNING_EXTRA = 2;

/** The finishing options a run applies (also what a later export must rebuild with). */
function finishOptsFor(run, tlState) {
    const brandKit = run.criteria?.brand ? (tlState.brandKit || null) : null;
    const { brandTitle, ...finishOpts } = run.plan.finish || {};
    return {
        brandKit,
        opts: {
            ...finishOpts,
            ...(brandKit ? { brand: brandKit } : {}),
            // The goal's own wishes override the defaults: a brand request
            // turns the hook title on (it carries the brand look), and
            // "no captions" turns captions off. Undefined keeps the defaults.
            ...((brandTitle && brandKit) || run.criteria?.captions === false ? {
                layers: {
                    title: !!(brandTitle && brandKit), cta: false, captions: run.criteria?.captions !== false,
                    camera: true, numbers: false, graphics: false, cuts: false,
                },
            } : {}),
        },
    };
}

/** What is said in a short, for writing its post copy. */
function shortTranscript(state, short) {
    const caps = (state.captions || []).filter(c => Number(c.end) > short.start && Number(c.start) < short.end);
    const said = caps.map(c => String(c.text || '').trim()).filter(Boolean).join(' ');
    return (said || short.text || '').slice(0, 4000);
}

function copyLanguage() {
    try { return /^fr/i.test(localStorage.getItem('vibed_lang') || navigator.language || '') ? 'French' : 'English'; }
    catch { return 'English'; }
}

async function readJson(res) {
    return res.json().catch(() => ({}));
}

/** The Planner analytics posts (Pro), or [] when they cannot be read. */
async function fetchAnalyticsPosts() {
    try {
        const res = await authFetch('/api/social/analytics');
        if (!res.ok) return [];
        return (await readJson(res)).posts || [];
    } catch (err) {
        console.warn('[agentRun] analytics unavailable:', err?.message);
        return [];
    }
}

/** The main edit, even while a short is being previewed. */
function mainEditState() {
    const st = useTimelineStore.getState();
    return st.shortPreview ? { ...st, ...st.shortPreview.saved } : st;
}

const useAgentRunStore = create((set, get) => ({
    run: null,
    saved: true,       // false when the last save to the server failed
    saveError: null,
    error: null,       // last refused action or failed step, in words
    loadedFor: null,   // projectId the latest run was loaded for

    /** Apply an event, keep the result and save it. Returns { ok, error }. */
    _apply: async (event) => {
        const current = get().run;
        const res = applyRunEvent(current, event);
        if (!res.ok) { set({ error: res.error }); return res; }
        set({ run: res.run, error: null });
        await get()._save();
        return res;
    },

    _save: async () => {
        const run = get().run;
        if (!run?.id) { set({ saved: false }); return; }
        const res = await saveRunRemote(run);
        if (res.ok) {
            // The server adds cost (AI calls, tokens) it counted for this run.
            set(s => ({ saved: true, saveError: null, run: s.run?.id === run.id && res.run ? { ...s.run, cost: res.run.cost } : s.run }));
        } else {
            set({ saved: false, saveError: res.error });
        }
    },

    /** The latest run of this project, for showing it and resuming after a reload. */
    loadLatest: async (projectId) => {
        if (!projectId || get().loadedFor === projectId) return;
        set({ loadedFor: projectId });
        if (get().run?.projectId === projectId) return;
        const res = await latestRunRemote(projectId);
        if (!res.ok || !res.run || get().run) return;
        let run = res.run;
        // A step that was running when the page closed did not finish.
        if (RUNNING.includes(run.status)) {
            const r = applyRunEvent(run, { type: 'interrupt' });
            if (r.ok) run = r.run;
            set({ run });
            await get()._save();
            return;
        }
        set({ run });
    },

    /**
     * Propose a plan. Nothing happens until it is approved.
     * Pass a ready goal (from goalParser, i.e. a typed request) or plain params.
     */
    start: async ({ goal = null, count, platforms, finish } = {}) => {
        const existing = get().run;
        if (existing && !TERMINAL.includes(existing.status)) {
            set({ error: 'A run is already in progress. Stop it first.' });
            return { ok: false };
        }
        const built = goal ? { ok: true, goal } : createGoal(GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, { count, platforms, finish });
        if (!built.ok) { set({ error: built.error }); return { ok: false }; }
        // A posting goal that names no platform targets the accounts that are
        // connected (both supported platforms when none is, so the schedule
        // card can ask to connect them).
        if (postsAfterFinish(built.goal.kind) && !built.goal.criteria?.platforms) {
            const destinations = await fetchDestinations();
            const connected = Object.entries(POST_PROVIDER)
                .filter(([, provider]) => provider && destinations?.some(d => d.id === provider && d.connection && !d.connection.needsReconnect))
                .map(([platform]) => platform);
            const targets = connected.length ? connected : Object.keys(POST_PROVIDER).filter(p => POST_PROVIDER[p]);
            built.goal = { ...built.goal, params: { ...built.goal.params, platforms: targets } };
        }
        const projectId = useTimelineStore.getState().projectId || null;
        let run = createRun(built.goal, { projectId });
        // R180: what earlier runs taught, for what this request left open.
        try {
            const [history, analytics] = await Promise.all([runHistoryRemote(), fetchAnalyticsPosts()]);
            const learned = learnFromRuns(history.runs, analytics);
            const { plan, adjusted } = applyLearning(built.goal, learned);
            const summary = learnedSummary(learned, adjusted);
            if (summary) {
                const r = applyRunEvent(run, { type: 'apply_learning', learned: summary, plan });
                if (r.ok) run = r.run;
            }
        } catch (err) {
            console.warn('[agentRun] learning skipped:', err?.message);
        }
        const res = projectId ? await createRunRemote(run) : { ok: false, error: 'Save the project first to keep this run.' };
        if (!res.ok && res.code === 'AGENT_MONTHLY_BUDGET') {
            set({ run: null, error: res.error });
            return { ok: false };
        }
        set({ run, error: null, saved: false });
        if (res.ok && res.run?.id) {
            run = { ...run, id: res.run.id };
            if (res.budget) {
                const r = applyRunEvent(run, { type: 'set_budget', budget: res.budget });
                if (r.ok) run = r.run;
            }
            set({ run, saved: true, saveError: null });
            if (res.budget) await get()._save();
        } else {
            set({ saveError: res.error });
        }
        return { ok: true };
    },

    approvePlan: async (edits = {}, reason = '') => {
        const res = await get()._apply({ type: 'approve_plan', plan: edits, reason });
        if (res.ok) await get()._runFind();
        return res;
    },

    rejectPlan: (reason = '') => get()._apply({ type: 'reject_plan', reason }),

    /** R180: forget what earlier runs taught, and put the plan back to the request's defaults. */
    resetLearning: async () => {
        const run = get().run;
        const res = await resetLearningRemote();
        if (!res.ok) { set({ error: 'What the runs learned could not be reset. Try again.' }); return res; }
        if (run?.status === STATUS.AWAITING_PLAN) return get()._apply({ type: 'apply_learning', learned: null, plan: run.goal.params });
        return { ok: true };
    },

    /** Stop the run because a budget would be passed. Returns true when it stopped. */
    _stopIfOverBudget: async (opts) => {
        const why = overBudget(get().run, opts);
        if (!why) return false;
        await get()._apply({ type: 'stop', reason: `${why} It stopped here; nothing past this point was done.` });
        return true;
    },

    stop: (reason = '') => get()._apply({ type: 'stop', reason: reason || 'Stopped by you' }),

    decide: (shortId, decision, reason = '') => get()._apply({ type: 'decide_short', shortId, decision, reason }),

    /** Every short decided: remove the dropped ones and finish the kept ones. */
    finishKept: async () => {
        const res = await get()._apply({ type: 'start_finish' });
        if (!res.ok) return res;
        const run = get().run;
        const tl = useTimelineStore.getState();
        for (const id of run.shortIds) {
            if (run.decisions[id]?.decision === 'dropped') tl.removeShort?.(id);
        }
        if (run.status === STATUS.FINISHING) await get()._runFinish();
        if (get().run?.status === STATUS.PREPARING_POSTS) await get()._runPreparePosts();
        return res;
    },

    /** Re-read the accounts (after connecting one) while the schedule waits. */
    refreshAccounts: async () => {
        const run = get().run;
        if (run?.status !== STATUS.AWAITING_SCHEDULE) return { ok: false };
        const destinations = await fetchDestinations();
        if (!destinations) { set({ error: 'The connected accounts could not be read. Try again.' }); return { ok: false }; }
        return get()._apply({ type: 'update_posts', posts: refreshProblems(run.posts, destinations) });
    },

    /** The one approval of the whole schedule: every post, its time and copy. */
    approveSchedule: async (posts, reason = '') => {
        const res = await get()._apply({ type: 'approve_schedule', posts, reason });
        if (res.ok) await get()._runPost();
        return res;
    },

    rejectSchedule: (reason = '') => get()._apply({ type: 'reject_schedule', reason: reason || 'Schedule declined' }),

    resume: async () => {
        const res = await get()._apply({ type: 'resume' });
        if (!res.ok) return res;
        if (get().run.status === STATUS.FINDING) await get()._runFind();
        else if (get().run.status === STATUS.FINISHING) await get()._runFinish();
        else if (get().run.status === STATUS.PREPARING_POSTS) await get()._runPreparePosts();
        else if (get().run.status === STATUS.POSTING) await get()._runPost();
        if (get().run?.status === STATUS.PREPARING_POSTS) await get()._runPreparePosts();
        return res;
    },

    dismiss: () => {
        const run = get().run;
        if (run && !TERMINAL.includes(run.status)) return;
        set({ run: null, error: null });
    },

    _runFind: async () => {
        const run = get().run;
        enterAgentStep(run.id, 'find');
        try {
            const { mediaExecutionEngine } = await import('../agent/MediaExecutionEngine.js');
            const execution = await mediaExecutionEngine.execute([{
                engine: 'STORE',
                action: 'repurpose_shorts',
                args: { count: run.plan.count + (run.learned?.usable ? LEARNING_EXTRA : 0), platforms: run.plan.platforms, maxSeconds: run.plan.maxSeconds || null, brief: run.goal.request || '' },
                meta: { source_step_id: 'find', description: 'Find shorts for an agent run' },
            }]);
            if (get().run?.status !== STATUS.FINDING) return; // stopped meanwhile
            const result = execution?.results?.[0]?.result || execution?.results?.[0] || {};
            if (!execution?.success || result.success === false) {
                await get()._apply({ type: 'step_failed', error: result.message || execution?.error || 'No shorts could be found.' });
                return;
            }
            let shorts = useTimelineStore.getState().shorts || [];
            const tl = useTimelineStore.getState();
            // R180: with learning, a couple of extra candidates were found;
            // keep the planned number, ranked by the picker plus what you keep.
            let note = String(result.message || '').slice(0, 300);
            if (run.learned?.usable && shorts.length > run.plan.count) {
                const keep = new Set(pickWithLearning(shorts, run.plan.count, run.learned));
                for (const sh of shorts) if (!keep.has(sh.id)) tl.removeShort?.(sh.id);
                note = `${note} Picked ${keep.size} of ${shorts.length} with what you kept before.`.trim();
                shorts = shorts.filter(sh => keep.has(sh.id));
            }
            for (const sh of shorts) tl.updateShort?.(sh.id, { runId: run.id });
            const facts = Object.fromEntries(shorts.map(sh => [sh.id, factsOfShort(sh)]));
            await get()._apply({ type: 'shorts_found', shortIds: shorts.map(sh => sh.id), facts, note });
        } catch (err) {
            console.error('[agentRun] find failed:', err);
            await get()._apply({ type: 'step_failed', error: err?.message || 'Finding shorts failed.' });
        } finally {
            leaveAgentStep();
        }
    },

    _runFinish: async () => {
        const run = get().run;
        const { brandKit, opts } = finishOptsFor(run, useTimelineStore.getState());
        const facts = [];
        enterAgentStep(run.id, 'finish');
        try {
            const { finishShort } = await import('../agent/shortFinisher.js');
            for (const id of pendingFinish(run)) {
                if (get().run?.status !== STATUS.FINISHING) return; // stopped meanwhile
                if (await get()._stopIfOverBudget()) return;
                const short = (useTimelineStore.getState().shorts || []).find(s => s.id === id);
                if (!short) {
                    // Removed from the panel during the run: nothing left to finish.
                    await get()._apply({ type: 'short_finished', shortId: id, applied: [REMOVED_NOTE] });
                    continue;
                }
                if (opts.popOut) {
                    const { ensureMattesFor } = await import('../agent/shortMattes.js');
                    await ensureMattesFor(short);
                }
                const built = await finishShort(mainEditState(), short, opts);
                putFinishedShort(short, opts, built);
                facts.push({ shortId: id, platform: short.platform, facts: shortFacts(built, brandKit) });
                useTimelineStore.getState().updateShort?.(id, { finishedAt: Date.now(), finishedWith: built.applied || [] });
                await get()._apply({ type: 'short_finished', shortId: id, applied: built.applied || [] });
            }
            if (get().run?.status !== STATUS.FINISHING) return;
            // Shorts finished in an earlier attempt (before a reload) are judged
            // from what was recorded for them; their timelines are not kept.
            const finishedCount = Object.values(get().run.finished).filter(f => !(f.applied || []).includes(REMOVED_NOTE)).length;
            const verification = verifyShorts(get().run.criteria || {}, facts, { hasBrandKit: !!brandKit, finishedCount });
            const earlier = Object.entries(get().run.finished).filter(([id, f]) => !facts.some(x => x.shortId === id) && !(f.applied || []).includes(REMOVED_NOTE));
            if (earlier.length) verification.checks.push({ id: 'resumed', ok: true, detail: `${earlier.length} short(s) finished before the reload were not re-checked` });
            await get()._apply({ type: 'finish_done', verification });
        } catch (err) {
            console.error('[agentRun] finish failed:', err);
            if (get().run?.status === STATUS.FINISHING) await get()._apply({ type: 'step_failed', error: err?.message || 'Finishing a short failed.' });
        } finally {
            leaveAgentStep();
        }
    },

    /**
     * prepare_posts: one post per finished short, on the platform it was made
     * for, at the user's best hour, with copy written from what is said in it.
     * Reads only; nothing leaves the app until the schedule is approved.
     */
    _runPreparePosts: async () => {
        const run = get().run;
        enterAgentStep(run.id, 'prepare_posts');
        try {
            const main = mainEditState();
            const shorts = (useTimelineStore.getState().shorts || []);
            const finishedShorts = run.shortIds
                .filter(id => run.finished?.[id] && !(run.finished[id].applied || []).includes(REMOVED_NOTE))
                .map(id => shorts.find(s => s.id === id))
                .filter(Boolean);
            const destinations = await fetchDestinations();
            const analytics = await fetchAnalyticsPosts();
            const { posts, timing } = draftSchedule(finishedShorts, destinations || [], analytics);
            const language = copyLanguage();
            const withCopy = [];
            for (const post of posts) {
                if (get().run?.status !== STATUS.PREPARING_POSTS) return; // stopped meanwhile
                if (await get()._stopIfOverBudget()) return;
                const short = finishedShorts.find(s => s.id === post.shortId);
                if (!post.provider || !short) { withCopy.push(post); continue; }
                try {
                    const res = await authFetch('/api/social/copy/generate', {
                        method: 'POST',
                        body: JSON.stringify({ provider: post.provider, title: post.title, context: shortTranscript(main, short), language }),
                    });
                    const body = await readJson(res);
                    if (!res.ok) throw new Error(body?.error || `copy ${res.status}`);
                    withCopy.push({ ...post, title: String(body.title || post.title).slice(0, 100), caption: String(body.caption || ''), copyFromAI: true });
                } catch (err) {
                    console.warn('[agentRun] copy generation failed for', post.key, err?.message);
                    withCopy.push(post);
                }
            }
            const timingNote = Object.entries(timing).map(([p, v]) => `${p} ${String(v.hour).padStart(2, '0')}:00 (${v.fromData ? `best hour from ${v.sample} posts` : 'default, not enough posts yet'})`).join('; ');
            await get()._apply({ type: 'posts_prepared', posts: withCopy, note: `${withCopy.length} post(s) drafted${timingNote ? `. ${timingNote}` : ''}` });
        } catch (err) {
            console.error('[agentRun] prepare posts failed:', err);
            if (get().run?.status === STATUS.PREPARING_POSTS) await get()._apply({ type: 'step_failed', error: err?.message || 'Preparing the posts failed.' });
        } finally {
            leaveAgentStep();
        }
    },

    /**
     * post: after the schedule was approved, export each approved short (the
     * same export as the Shorts panel's button) and schedule it. A post that
     * already exists for that short and platform (from before a reload) is
     * recorded, not created again.
     */
    _runPost: async () => {
        const run = get().run;
        const exporter = getShortExporter();
        enterAgentStep(run.id, 'post');
        try {
            if (!exporter) throw new Error('Open the editor to export and schedule the shorts.');
            let existing = [];
            try {
                const res = await authFetch('/api/social/publications');
                if (res.ok) existing = (await readJson(res)).publications || [];
            } catch (err) { console.warn('[agentRun] could not read existing publications:', err?.message); }
            const { opts } = finishOptsFor(run, useTimelineStore.getState());
            for (const post of pendingPosts(run)) {
                if (get().run?.status !== STATUS.POSTING) return; // stopped meanwhile
                const already = existing.find(p => p.shortId === post.shortId && p.provider === post.provider && ['scheduled', 'publishing', 'published'].includes(p.status));
                if (already) { await get()._apply({ type: 'post_result', key: post.key, publicationId: already.id }); continue; }
                const fail = (error) => get()._apply({ type: 'post_result', key: post.key, error });
                if (!inPostWindow(post.scheduledAt)) { await fail('Its time passed before it could be scheduled. Schedule it from the Shorts panel.'); continue; }
                const short = (useTimelineStore.getState().shorts || []).find(s => s.id === post.shortId);
                if (!short) { await fail('The short was removed from the list.'); continue; }
                try {
                    let mediaUrl = isPostableExport(short.exportUrl) ? short.exportUrl : null;
                    const seconds = Math.max(0, Number(short.end) - Number(short.start)) || 0;
                    if (!mediaUrl && await get()._stopIfOverBudget({ nextExportSeconds: seconds })) return;
                    let exportedSeconds = 0;
                    if (!mediaUrl) {
                        let built = getFinishedShort(short, opts);
                        if (!built) {
                            const { finishShort } = await import('../agent/shortFinisher.js');
                            built = await finishShort(mainEditState(), short, opts);
                        }
                        const profile = PLATFORM_PROFILES[short.platform] || PLATFORM_PROFILES.shorts;
                        const result = await exporter(
                            { platform: profile.exportPreset, quality: 'high', resolution: '1080p', fps: profile.fps },
                            { tracks: built.tracks, duration: built.duration, aspectRatio: built.aspectRatio, assets: mainEditState().assets || [], onProgress: () => {} },
                        );
                        useTimelineStore.getState().updateShort?.(short.id, { exportUrl: result?.url || null, exportedAt: Date.now() });
                        if (!isPostableExport(result?.url)) { await fail('The export is not in cloud storage, so it cannot be posted.'); continue; }
                        mediaUrl = result.url;
                        exportedSeconds = seconds;
                    }
                    const res = await authFetch('/api/social/publications', {
                        method: 'POST',
                        body: JSON.stringify({
                            provider: post.provider, mediaUrl, scheduledAt: post.scheduledAt,
                            title: post.title, caption: post.caption, shortId: short.id,
                            editContext: {
                                durationSeconds: Math.max(0, Number(short.end) - Number(short.start)),
                                pickerScore: short.score, hookEvent: short.hookEvent,
                                captionsEnabled: run.criteria?.captions !== false,
                                polishEnabled: opts.polish !== false, soundEffectsEnabled: opts.sfx !== false,
                                speakerPopOutEnabled: !!opts.popOut,
                                agentRunId: run.id || undefined,
                            },
                        }),
                    });
                    const body = await readJson(res);
                    if (!res.ok || !body?.publication?.id) { await get()._apply({ type: 'post_result', key: post.key, exportedSeconds, error: body?.message || body?.error || `Scheduling failed (${res.status}).` }); continue; }
                    await get()._apply({ type: 'post_result', key: post.key, publicationId: body.publication.id, exportedSeconds });
                } catch (err) {
                    console.error('[agentRun] posting failed for', post.key, err);
                    await fail(err?.message || 'Exporting or scheduling failed.');
                }
            }
            if (get().run?.status === STATUS.POSTING) await get()._apply({ type: 'posting_done' });
        } catch (err) {
            console.error('[agentRun] post step failed:', err);
            if (get().run?.status === STATUS.POSTING) await get()._apply({ type: 'step_failed', error: err?.message || 'Scheduling the posts failed.' });
        } finally {
            leaveAgentStep();
        }
    },
}));

export default useAgentRunStore;
