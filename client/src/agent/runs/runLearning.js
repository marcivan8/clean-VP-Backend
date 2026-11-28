/**
 * client/src/agent/runs/runLearning.js — what earlier runs teach the next
 * shorts plan (R180). Pure: no fetch, no store.
 *
 * Two signals the user already gave:
 *   - what they KEPT or DROPPED in earlier runs (each short's length, hook
 *     type and platform are recorded when it is found: run.shortFacts);
 *   - how the shorts they POSTED performed (views from the Planner analytics,
 *     matched on the publication id the run recorded).
 *
 * It changes only what the request left open: a count or length the user
 * asked for is never overridden. It needs enough data to say anything
 * (MIN_RUNS runs and MIN_DECIDED decided shorts), and every number it uses is
 * shown in the plan, with a reset.
 */

export const MIN_RUNS = 2;
export const MIN_DECIDED = 6;
const MIN_BUCKET = 3;
const MIN_POSTED = 3;

/** Length buckets, in seconds. */
export const BUCKETS = Object.freeze([
    { id: 'xs', max: 20, label: 'under 20 s' },
    { id: 's', max: 35, label: '20-35 s' },
    { id: 'm', max: 50, label: '35-50 s' },
    { id: 'l', max: 75, label: '50-75 s' },
    { id: 'xl', max: Infinity, label: 'over 75 s' },
]);

export function bucketOf(seconds) {
    const s = Number(seconds) || 0;
    return BUCKETS.find(b => s <= b.max)?.id || 'xl';
}

/** What a run records about a short when it is found. */
export function factsOfShort(short) {
    const seconds = Math.max(0, Number(short?.end) - Number(short?.start)) || 0;
    return {
        seconds: Math.round(seconds * 10) / 10,
        platform: typeof short?.platform === 'string' ? short.platform.slice(0, 20) : null,
        hook: typeof short?.hookEvent === 'string' ? short.hookEvent.slice(0, 40) : null,
        score: Number.isFinite(Number(short?.score)) ? Math.round(Number(short.score)) : null,
    };
}

function median(a) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(a, q) {
    if (!a.length) return null;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
}

/** Keep rate smoothed toward the overall rate, so 1 of 1 is not "100%". */
function smoothed(kept, total, prior, weight = 2) {
    return (kept + prior * weight) / (total + weight);
}

/**
 * Preferences from past runs.
 * @param {Array<{decisions, shortFacts, posts}>} history  oldest first
 * @param {Array<{id, metrics}>} analyticsPosts  publications with their latest totals
 */
export function learnFromRuns(history, analyticsPosts = []) {
    const rows = [];
    const keptPerRun = [];
    let runs = 0;
    for (const run of history || []) {
        const decisions = run?.decisions || {};
        const facts = run?.shortFacts || {};
        let decidedHere = 0, keptHere = 0;
        for (const [id, d] of Object.entries(decisions)) {
            const f = facts[id];
            if (!f || (d?.decision !== 'kept' && d?.decision !== 'dropped')) continue;
            decidedHere += 1;
            if (d.decision === 'kept') keptHere += 1;
            rows.push({ ...f, bucket: bucketOf(f.seconds), kept: d.decision === 'kept' });
        }
        if (decidedHere) { runs += 1; keptPerRun.push(keptHere); }
    }
    const decided = rows.length;
    const kept = rows.filter(r => r.kept).length;
    const overall = decided ? kept / decided : 0;
    const usable = runs >= MIN_RUNS && decided >= MIN_DECIDED;

    const rate = (key) => {
        const groups = new Map();
        for (const r of rows) {
            const k = r[key];
            if (!k) continue;
            const g = groups.get(k) || { kept: 0, total: 0 };
            g.total += 1; if (r.kept) g.kept += 1;
            groups.set(k, g);
        }
        return Object.fromEntries([...groups].map(([k, g]) => [k, { ...g, rate: smoothed(g.kept, g.total, overall) }]));
    };
    const byBucket = rate('bucket');
    const byHook = rate('hook');

    // Views of posted shorts by length, from the analytics.
    const views = new Map((analyticsPosts || []).map(p => [p.id, Number(p.metrics?.views)]).filter(([, v]) => Number.isFinite(v)));
    const postedRows = [];
    for (const run of history || []) {
        for (const p of run?.posts || []) {
            const f = run.shortFacts?.[p.shortId];
            const v = views.get(p.publicationId);
            if (f && Number.isFinite(v)) postedRows.push({ bucket: bucketOf(f.seconds), views: v });
        }
    }
    const viewsByBucket = {};
    for (const b of BUCKETS) {
        const v = postedRows.filter(r => r.bucket === b.id).map(r => r.views);
        if (v.length) viewsByBucket[b.id] = { posts: v.length, medianViews: median(v) };
    }

    // The preferred length: the bucket kept most (enough samples), nudged by
    // views when enough shorts were posted.
    const candidates = BUCKETS.filter(b => (byBucket[b.id]?.total || 0) >= MIN_BUCKET);
    const bestViews = postedRows.length >= MIN_POSTED
        ? Math.max(...Object.values(viewsByBucket).map(v => v.medianViews), 0) : 0;
    const scoreBucket = (b) => (byBucket[b.id]?.rate || 0) + (bestViews ? 0.25 * ((viewsByBucket[b.id]?.medianViews || 0) / bestViews) : 0);
    const preferredBucket = candidates.length ? candidates.slice().sort((a, b) => scoreBucket(b) - scoreBucket(a))[0].id : null;

    const keptSeconds = rows.filter(r => r.kept).map(r => r.seconds).filter(s => s > 0);
    const p75 = quantile(keptSeconds, 0.75);
    const maxSeconds = usable && keptSeconds.length >= 4 && p75
        ? Math.max(15, Math.min(180, Math.ceil((p75 + 5) / 5) * 5)) : null;
    const count = usable && keptPerRun.length >= MIN_RUNS
        ? Math.max(1, Math.min(10, Math.round(median(keptPerRun)))) : null;

    return {
        usable, runs, decided, kept,
        keepRate: decided ? kept / decided : null,
        byBucket, byHook, viewsByBucket,
        posted: postedRows.length,
        preferredBucket: usable ? preferredBucket : null,
        maxSeconds, count,
    };
}

/**
 * Plan edits from what was learned, only for what the request left open.
 * @returns {{ plan, adjusted: string[] }}
 */
export function applyLearning(goal, learned) {
    const plan = { ...goal.params };
    const adjusted = [];
    if (!learned?.usable) return { plan, adjusted };
    const c = goal.criteria || {};
    if (c.count == null && learned.count && learned.count !== plan.count) { plan.count = learned.count; adjusted.push('count'); }
    if (c.maxSeconds == null && !plan.maxSeconds && learned.maxSeconds) { plan.maxSeconds = learned.maxSeconds; adjusted.push('maxSeconds'); }
    return { plan, adjusted };
}

/**
 * How much the learning favours a found short: positive for lengths and hooks
 * the user keeps more than average. 0 when nothing is learned.
 */
export function learnedBonus(facts, learned) {
    if (!learned?.usable || !facts) return 0;
    const base = learned.keepRate || 0;
    const b = learned.byBucket?.[bucketOf(facts.seconds)];
    const h = facts.hook ? learned.byHook?.[facts.hook] : null;
    return (b && b.total >= MIN_BUCKET ? b.rate - base : 0) + (h && h.total >= MIN_BUCKET ? 0.5 * (h.rate - base) : 0);
}

/**
 * The `count` shorts to keep from a larger set found, ranked by the picker's
 * own score plus the learned bonus. Returns ids in their original order.
 */
export function pickWithLearning(shorts, count, learned) {
    const ranked = (shorts || []).map((s, i) => ({ s, i, v: (Number(s.score) || 0) / 100 + learnedBonus(factsOfShort(s), learned) }))
        .sort((a, b) => b.v - a.v || a.i - b.i)
        .slice(0, Math.max(1, count));
    return ranked.sort((a, b) => a.i - b.i).map(x => x.s.id);
}

/** The learning summary a run keeps (small: it is saved with the run). */
export function learnedSummary(learned, adjusted = []) {
    if (!learned?.usable) return null;
    const bucket = BUCKETS.find(b => b.id === learned.preferredBucket);
    const b = learned.byBucket?.[learned.preferredBucket];
    return {
        runs: learned.runs, decided: learned.decided, kept: learned.kept,
        preferredBucket: learned.preferredBucket, preferredLabel: bucket?.label || null,
        preferredKept: b?.kept ?? null, preferredTotal: b?.total ?? null,
        posted: learned.posted,
        count: learned.count, maxSeconds: learned.maxSeconds,
        adjusted,
        // Kept so the find step can rank with it after a reload.
        byBucket: learned.byBucket, byHook: learned.byHook, keepRate: learned.keepRate, usable: true,
    };
}

export default { MIN_RUNS, MIN_DECIDED, BUCKETS, bucketOf, factsOfShort, learnFromRuns, applyLearning, learnedBonus, pickWithLearning, learnedSummary };
