// scripts/test_shorts_to_posts_r179.mjs — R179: a goal that ends with the
// shorts scheduled. Runs the REAL contract, parser, scheduling maths and run
// state machine; checks the wiring of the store, the editor and the card.
process.env.TZ = 'UTC'; // the scheduling maths uses local hours
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const C = await import('../client/src/agent/runs/goalContract.js');
const P = await import('../client/src/agent/runs/goalParser.js');
const S = await import('../client/src/agent/runs/postSchedule.js');
const R = await import('../client/src/agent/runs/runState.js');

const NOW = Date.parse('2026-11-28T10:00:00Z');
const H = 3600 * 1000, DAY = 24 * H;

console.log('\n§1 the contract');
{
    const k = C.GOAL_KINDS.SHORTS_TO_POSTS;
    const post = C.contractFor(k).steps.find(s => s.id === 'post');
    ok(post && post.effect === C.EFFECT.OUTWARD && post.approval === 'schedule', 'posting is the one outward step, and it waits for the schedule approval');
    ok(C.checkStep(k, 'post').ok && !C.checkStep(k, 'publish_now').ok, 'it may post at an approved time, never "publish now"');
    ok(!C.checkStep(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, 'post').ok && !C.checkStep(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, 'publish').ok, 'a plain shorts run still cannot post');
    ok(C.createGoal(k, {}).goal.criteria.scheduled === true && C.createGoal(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, {}).goal.criteria.scheduled === null, 'a posting goal is judged on being scheduled');
    ok(C.POST_PROVIDER.shorts === 'youtube' && C.POST_PROVIDER.reels === 'instagram' && C.POST_PROVIDER.tiktok === null, 'TikTok has no posting route yet');
}

console.log('\n§2 the sentence');
{
    const kind = (t) => P.parseShortsGoal(t, {})?.kind || null;
    ok(kind('turn this video into 3 shorts and schedule them through the week') === 'shorts_to_posts', '"...and schedule them through the week"');
    ok(kind('make 3 shorts and post one a day') === 'shorts_to_posts', '"post one a day"');
    ok(kind('fais 3 shorts et programme-les sur la semaine') === 'shorts_to_posts', 'French');
    ok(kind('make shorts I can post') === 'shorts_from_long_video', '"shorts I can post" is not a request to post');
    ok(kind('make 3 tiktoks under 60 s') === 'shorts_from_long_video', 'no posting words, no posting');
    ok(kind('schedule a meeting') === null, 'not a shorts request at all');
}

console.log('\n§3 the times');
{
    const mk = (provider, hour, daysAgo, views) => ({ provider, publishedAt: new Date(NOW - daysAgo * DAY).toISOString().slice(0, 11) + `${String(hour).padStart(2, '0')}:10:00Z`, metrics: { views } });
    const yt = [mk('youtube', 12, 10, 100), mk('youtube', 12, 9, 120), mk('youtube', 20, 8, 900), mk('youtube', 20, 7, 50), mk('youtube', 20, 6, 800), mk('youtube', 9, 1, 99999)];
    const b = S.bestHours(yt, 'youtube', { now: NOW });
    ok(b.fromData && b.hours[0] === 20 && b.sample === 5, 'the hour with the best median views wins; a post from yesterday is not counted');
    const thin = S.bestHours(yt.slice(0, 3), 'youtube', { now: NOW });
    ok(!thin.fromData && thin.hours[0] === S.FALLBACK_HOUR, 'too few posts: 18:00, and it says so');
    const one = S.bestHours([...yt, mk('youtube', 7, 5, 100000)], 'youtube', { now: NOW });
    ok(one.hours[0] === 7, 'a single post decides only when it is the only one at its hour (median of one)');

    const slots = S.planSlots([{ key: 'a', provider: 'youtube' }, { key: 'b', provider: 'youtube' }, { key: 'c', provider: 'instagram' }], { youtube: [20, 12], instagram: [18] }, { now: NOW });
    ok(slots[0].scheduledAt === '2026-11-28T20:00:00.000Z' && slots[1].scheduledAt === '2026-11-29T20:00:00.000Z', 'one a day per platform at the best hour, from today when it is still ahead');
    ok(slots[2].scheduledAt === '2026-11-28T18:00:00.000Z', 'each platform has its own days');
    const late = S.planSlots([{ key: 'a', provider: 'youtube' }], { youtube: [10] }, { now: NOW });
    ok(late[0].scheduledAt === '2026-11-29T10:00:00.000Z', 'a slot less than 30 minutes away moves to the next day');
    const many = S.planSlots(Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, provider: 'youtube' })), { youtube: [20, 12] }, { now: NOW });
    const times = many.map(p => p.scheduledAt).filter(Boolean);
    ok(times.length === 9 && new Set(times).size === 9 && times.every(t => Date.parse(t) <= NOW + C.POST_MAX_AHEAD_MS), 'past the window\'s last day, extra posts take the next-best hour; all inside 6.4 days');
    const full = S.planSlots(Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, provider: 'youtube' })), { youtube: [20] }, { now: NOW });
    ok(full.filter(p => p.problem === 'no_slot').length > 0, 'with one hour and too many posts, the rest are marked as having no slot');

    const dest = [{ id: 'youtube', connection: { handle: '@me', needsReconnect: false } }, { id: 'instagram', connection: null }];
    const shorts = [{ id: 's1', platform: 'shorts', title: 'Hook' }, { id: 's2', platform: 'reels', title: 'Two' }, { id: 's3', platform: 'tiktok', title: 'Three' }];
    const d = S.draftSchedule(shorts, dest, yt, { now: NOW });
    ok(d.posts[0].provider === 'youtube' && !d.posts[0].problem && d.posts[0].timeFromData, 'YouTube connected: ready, at the best hour from data');
    ok(d.posts[1].problem === 'not_connected' && d.posts[2].problem === 'unsupported' && d.posts[2].skip, 'Instagram not connected; TikTok left out and said why');
    const fixed = S.refreshProblems(d.posts, [dest[0], { id: 'instagram', connection: { needsReconnect: false } }]);
    ok(!fixed[1].problem && fixed[2].problem === 'unsupported', 'connecting the account clears its problem, nothing else');
}

console.log('\n§4 the run');
{
    const goal = C.createGoal(C.GOAL_KINDS.SHORTS_TO_POSTS, { count: 2, platforms: ['shorts', 'reels'] }).goal;
    let run = R.createRun(goal, { id: 'r1', now: NOW });
    const step = (ev, t = NOW) => { const r = R.applyRunEvent(run, ev, t); if (r.ok) run = r.run; return r; };
    step({ type: 'approve_plan' });
    step({ type: 'shorts_found', shortIds: ['s1', 's2'] });
    step({ type: 'decide_short', shortId: 's1', decision: 'kept' });
    step({ type: 'decide_short', shortId: 's2', decision: 'kept' });
    step({ type: 'start_finish' });
    step({ type: 'short_finished', shortId: 's1', applied: [] });
    step({ type: 'short_finished', shortId: 's2', applied: [] });
    step({ type: 'finish_done', verification: { met: true, checks: [{ id: 'count', ok: true, detail: '2 shorts' }] } });
    ok(run.status === R.STATUS.PREPARING_POSTS && run.steps.some(s => s.id === 'prepare_posts' && s.status === 'running'), 'after finishing and checking, it prepares the posts instead of ending');
    ok(R.RUNNING.includes(R.STATUS.PREPARING_POSTS) && R.RUNNING.includes(R.STATUS.POSTING), 'both new working states are resumed after a reload');

    const at = (h) => new Date(NOW + h * H).toISOString();
    step({ type: 'posts_prepared', posts: [
        { key: 's1:youtube', shortId: 's1', platform: 'shorts', provider: 'youtube', title: 'Hook', caption: 'c1', scheduledAt: at(10) },
        { key: 's2:instagram', shortId: 's2', platform: 'reels', provider: 'instagram', title: '', caption: 'c2', scheduledAt: at(8), problem: 'not_connected' },
    ] });
    ok(run.status === R.STATUS.AWAITING_SCHEDULE && run.posts.length === 2, 'then it waits for the schedule to be approved');
    const blocked = R.applyRunEvent(run, { type: 'approve_schedule', posts: run.posts }, NOW);
    ok(!blocked.ok && /not connected/.test(blocked.error), 'approving is refused while an account included is not connected');
    const noTitle = R.applyRunEvent(run, { type: 'approve_schedule', posts: [{ ...run.posts[0], title: '' }, { ...run.posts[1], skip: true }] }, NOW);
    ok(!noTitle.ok && /title/.test(noTitle.error), 'YouTube without a title is refused');
    const past = R.applyRunEvent(run, { type: 'approve_schedule', posts: [{ ...run.posts[0], scheduledAt: at(-1) }, { ...run.posts[1], skip: true }] }, NOW);
    ok(!past.ok && /time/.test(past.error), 'a time in the past is refused');
    const tooFar = R.applyRunEvent(run, { type: 'approve_schedule', posts: [{ ...run.posts[0], scheduledAt: at(24 * 8) }, { ...run.posts[1], skip: true }] }, NOW);
    ok(!tooFar.ok, 'a time past the scheduling window is refused');
    const none = R.applyRunEvent(run, { type: 'approve_schedule', posts: run.posts.map(p => ({ ...p, skip: true })) }, NOW);
    ok(!none.ok && /Cancel/.test(none.error), 'unticking everything is not an approval');
    ok(!R.applyRunEvent(run, { type: 'post_result', key: 's1:youtube', publicationId: 'x' }, NOW).ok, 'nothing can be posted before the approval');

    step({ type: 'update_posts', posts: [{ key: 's2:instagram', problem: null }] });
    ok(run.posts[1].problem === null && run.posts[1].shortId === 's2' && run.posts[1].caption === 'c2' && run.posts[1].scheduledAt === at(8), 'connecting the account clears its problem and keeps the drafted time and copy');
    const r = step({ type: 'approve_schedule', posts: [{ ...run.posts[0], caption: 'edited', key: 's1:youtube' }, run.posts[1], { key: 'intruder', provider: 'youtube', title: 'x', scheduledAt: at(5) }] });
    ok(r.ok && run.status === R.STATUS.POSTING && run.posts[0].caption === 'edited' && run.posts.length === 2, 'approved with the edits kept; a post the run did not draft is ignored');
    const approval = run.approvals.find(a => a.kind === 'schedule');
    ok(approval?.posts?.length === 2 && approval.posts.every(p => p.scheduledAt), 'the approval records what was approved: each post and its time');

    // A reload mid-posting resumes with only what is still owed.
    step({ type: 'post_result', key: 's1:youtube', publicationId: 'pub-1' });
    step({ type: 'interrupt' });
    ok(run.status === R.STATUS.INTERRUPTED && run.resumeFrom === 'post', 'a reload while posting is interrupted at the post step');
    step({ type: 'resume' });
    ok(run.status === R.STATUS.POSTING && R.pendingPosts(run).map(p => p.key).join() === 's2:instagram', 'resuming posts only what was not scheduled yet');
    ok(!R.applyRunEvent(run, { type: 'post_result', key: 's1:youtube', publicationId: 'pub-again' }, NOW).ok, 'a post already scheduled is never scheduled twice');
    step({ type: 'post_result', key: 's2:instagram', error: 'QUEUE_UNAVAILABLE' });
    step({ type: 'posting_done' });
    ok(run.status === R.STATUS.DONE && run.verification.met === false && run.verification.checks.some(c => c.id === 'scheduled' && !c.ok && /1 of 2/.test(c.detail)), 'one of two failed: the run ends and says what was not scheduled');

    // Nothing could be scheduled: failed, not done.
    let r2 = R.createRun(goal, { id: 'r2', now: NOW });
    const s2 = (ev) => { const x = R.applyRunEvent(r2, ev, NOW); if (x.ok) r2 = x.run; };
    ['approve_plan'].forEach(type => s2({ type }));
    s2({ type: 'shorts_found', shortIds: ['a'] }); s2({ type: 'decide_short', shortId: 'a', decision: 'kept' }); s2({ type: 'start_finish' });
    s2({ type: 'short_finished', shortId: 'a', applied: [] }); s2({ type: 'finish_done' });
    s2({ type: 'posts_prepared', posts: [{ key: 'a:youtube', shortId: 'a', provider: 'youtube', title: 'T', scheduledAt: at(5) }] });
    const rejected = R.applyRunEvent(r2, { type: 'reject_schedule', reason: 'not now' }, NOW);
    ok(rejected.ok && rejected.run.status === R.STATUS.STOPPED && /shorts stay/.test(rejected.run.stopReason), 'declining the schedule stops the run; the finished shorts stay');
    s2({ type: 'approve_schedule', posts: r2.posts });
    s2({ type: 'post_result', key: 'a:youtube', error: 'boom' });
    s2({ type: 'posting_done' });
    ok(r2.status === R.STATUS.FAILED, 'no post scheduled at all: the run failed');

    // A plain shorts run is unchanged.
    let r3 = R.createRun(C.createGoal(C.GOAL_KINDS.SHORTS_FROM_LONG_VIDEO, { count: 1 }).goal, { now: NOW });
    const s3 = (ev) => { const x = R.applyRunEvent(r3, ev, NOW); if (x.ok) r3 = x.run; };
    s3({ type: 'approve_plan' }); s3({ type: 'shorts_found', shortIds: ['a'] }); s3({ type: 'decide_short', shortId: 'a', decision: 'kept' });
    s3({ type: 'start_finish' }); s3({ type: 'short_finished', shortId: 'a', applied: [] }); s3({ type: 'finish_done' });
    ok(r3.status === R.STATUS.DONE, 'a plain shorts run still ends with the shorts finished');
    ok(R.cleanPost({ key: 'k', caption: 'x'.repeat(9000), title: 'y'.repeat(300), provider: 'tiktok' }).caption.length === C.POST_CAPTION_MAX && R.cleanPost({ key: 'k', provider: 'tiktok' }).provider === null, 'post fields are clamped and unknown providers dropped');
}

console.log('\n§5 server and wiring');
{
    const stub = (rel, exports) => { const p = require.resolve(rel); require.cache[p] = { id: p, filename: p, loaded: true, exports }; };
    stub('../config/database.js', { supabaseAdmin: { from: () => ({}) } });
    stub('../middleware/auth.js', { authenticateUser: (req, res, next) => next() });
    const routes = require('../routes/agentRunRoutes.js');
    ok(routes.GOAL_KINDS.includes('shorts_to_posts') && Object.values(R.STATUS).every(s => routes.STATUSES.includes(s)), 'the server accepts the new kind and statuses');
    const mig = read('supabase/migrations/20240015_agent_run_posting.sql');
    ok(Object.values(R.STATUS).every(s => mig.includes(`'${s}'`)), 'the database accepts every status');
    const ide = read('client/src/layouts/IDELayout.jsx');
    ok(/setShortExporter\(\(settings, override\) => shortExportRef\.current\(settings, override\)\)/.test(ide), 'the editor registers the same export the Shorts panel uses');
    const store = read('client/src/store/useAgentRunStore.js');
    ok(/getShortExporter\(\)/.test(store) && /'\/api\/social\/publications', \{\s*method: 'POST'/.test(store) && /scheduledAt: post\.scheduledAt/.test(store), 'the post step exports, then schedules at the approved time');
    ok(!/publishNow/.test(store), 'the run never publishes immediately');
    ok(/p\.shortId === post\.shortId && p\.provider === post\.provider/.test(store), 'before posting it checks for a post already made for that short (after a reload)');
    ok(/\/api\/social\/copy\/generate/.test(store) && /\/api\/social\/analytics/.test(store), 'copy is written per post, times come from the analytics');
    const wf = read('client/src/agent/WorkflowController.js');
    ok(/goal\.kind === 'shorts_to_posts' && \(await getUserPlanDirect\(\)\) !== 'pro'/.test(wf) && /feature: 'social'/.test(wf), 'posting goals are Pro only, with the social upgrade prompt');
    const card = read('client/src/components/AgentRunCard.jsx');
    ok(/store\.approveSchedule\(posts\)/.test(card) && /connectDestination\(p\.provider/.test(card) && /store\.rejectSchedule/.test(card), 'the card approves the schedule once, can connect an account, or decline');
    for (const l of ['en', 'fr']) {
        const a = JSON.parse(read(`client/src/locales/${l}/editor.json`)).agentRun;
        ok(['scheduleIntro', 'approveSchedule', 'posting', 'donePosts', 'postUnsupported'].every(k => a[k]), `${l}: the schedule copy exists`);
    }
}

console.log(`\n${'─'.repeat(60)}\nShorts to posts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
