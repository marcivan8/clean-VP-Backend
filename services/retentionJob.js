/**
 * services/retentionJob.js — deletes inactive projects and their files, as
 * the privacy policy says (client/src/locales/<lang>/privacy.json, data.json):
 *
 *   Free     a project not modified for 7 days
 *   Creator  a project not modified for 30 days
 *   Pro      kept while the subscription is active (then the Free rule)
 *
 * The owner gets ONE email at least 24 hours before anything is deleted
 * (all their projects due for deletion in that email). Nothing is deleted
 * without that notice: a project is only deleted when a notice older than
 * 24 h exists and the project has not been modified since. Notices live in
 * public.project_deletion_notices (migrations/006_retention.sql) so writing
 * them never touches projects.updated_at.
 *
 * It also removes stray files: uploads and proxies that no project uses
 * any more (an upload that was never saved into a project) and exports from
 * before exports were stored per project, once they are older than the
 * owner's retention period.
 *
 * Pure orchestration over injected clients so it can be tested without
 * Supabase or Google Cloud (scripts/test_retention_job.js).
 */
'use strict';

const { deleteProjectFiles, referencedBy } = require('./projectFiles');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTICE_MS = DAY_MS;
const RETENTION_DAYS = { free: 7, creator: 30 };
/** Safety cap: never delete more than this many files in one run. */
const MAX_FILES_PER_RUN = 5000;

/** Retention in days for a profile, or null = keep (active Pro). */
function retentionDaysFor(profile, now = Date.now()) {
    const plan = profile?.plan || 'free';
    const expires = profile?.plan_expires_at ? Date.parse(profile.plan_expires_at) : null;
    const active = !expires || expires > now;
    if (plan === 'pro' && active) return null;
    if (plan === 'creator' && active) return RETENTION_DAYS.creator;
    return RETENTION_DAYS.free;
}

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

/**
 * @param {object} deps
 * @param deps.db         supabaseAdmin
 * @param deps.bucket     GCS bucket or null
 * @param deps.sendEmail  async ({ to, projects:[{name}], deletionDate, inactiveDays, plan, firstName, locale }) => boolean
 *                        Return false (or throw) when the email was not sent:
 *                        no notice is recorded then, so nothing is deleted and
 *                        the next run tries again.
 * @param deps.getUserEmail async (userId) => string | { email, firstName?, locale? } | null
 * @param {object} [opts] { now, dryRun, log }
 */
async function runRetention({ db, bucket, sendEmail, getUserEmail }, { now = Date.now(), dryRun = false, log = console } = {}) {
    const report = { warnedUsers: 0, warnedProjects: 0, deletedProjects: 0, filesDeleted: 0, strayFilesDeleted: 0, revivedProjects: 0, errors: [] };
    let budget = MAX_FILES_PER_RUN;

    // ── 1. Projects not modified for at least (7 days − 1 day of notice) ──
    const oldest = new Date(now - (RETENTION_DAYS.free * DAY_MS - NOTICE_MS)).toISOString();
    const { data: candidates, error: candErr } = await db
        .from('projects').select('id, user_id, name, updated_at').lt('updated_at', oldest);
    if (candErr) throw new Error(`projects query failed: ${candErr.message}`);
    const userIds = [...new Set((candidates || []).map(p => p.user_id))];

    const profiles = new Map();
    for (const ids of chunk(userIds, 200)) {
        const { data, error } = await db.from('profiles').select('id, plan, plan_expires_at').in('id', ids);
        if (error) throw new Error(`profiles query failed: ${error.message}`);
        (data || []).forEach(p => profiles.set(p.id, p));
    }

    const notices = new Map();
    for (const ids of chunk((candidates || []).map(p => p.id), 200)) {
        const { data, error } = await db.from('project_deletion_notices').select('project_id, warned_at, deadline').in('project_id', ids);
        if (error) throw new Error(`project_deletion_notices query failed (is migrations/006_retention.sql applied?): ${error.message}`);
        (data || []).forEach(n => notices.set(n.project_id, n));
    }

    // Notices of projects that were edited since (no longer candidates):
    // drop them so the project starts from a clean slate.
    try {
        const candidateIds = new Set((candidates || []).map(p => p.id));
        const { data: allNotices, error } = await db.from('project_deletion_notices').select('project_id, warned_at');
        if (error) throw new Error(error.message);
        const stale = (allNotices || []).filter(n => !candidateIds.has(n.project_id));
        for (const ids of chunk(stale.map(n => n.project_id), 200)) {
            const { data: rows, error: pErr } = await db.from('projects').select('id, updated_at').in('id', ids);
            if (pErr) throw new Error(pErr.message);
            const warnedAt = new Map(stale.map(n => [n.project_id, Date.parse(n.warned_at)]));
            for (const row of rows || []) {
                if (Date.parse(row.updated_at) > warnedAt.get(row.id)) {
                    if (!dryRun) await db.from('project_deletion_notices').delete().eq('project_id', row.id);
                    report.revivedProjects++;
                }
            }
        }
    } catch (err) {
        report.errors.push(`stale notices: ${err.message}`);
    }

    const toWarn = new Map();   // userId -> [{ id, name, deadline }]
    const toDelete = [];
    for (const p of candidates || []) {
        const days = retentionDaysFor(profiles.get(p.user_id), now);
        const updated = Date.parse(p.updated_at);
        const notice = notices.get(p.id);
        if (notice && updated > Date.parse(notice.warned_at)) {
            // Modified after the notice: the clock restarts.
            if (!dryRun) await db.from('project_deletion_notices').delete().eq('project_id', p.id);
            report.revivedProjects++;
            continue;
        }
        if (days === null) continue; // active Pro
        const deadline = updated + days * DAY_MS;
        if (notice) {
            if (now >= Date.parse(notice.deadline) && now - Date.parse(notice.warned_at) >= NOTICE_MS) toDelete.push(p);
            continue;
        }
        if (now >= deadline - NOTICE_MS) {
            const list = toWarn.get(p.user_id) || [];
            list.push({ id: p.id, name: p.name, days, deadline: Math.max(deadline, now + NOTICE_MS) });
            toWarn.set(p.user_id, list);
        }
    }

    // ── 2. One notice email per user, then record the notices ─────────────
    for (const [userId, list] of toWarn) {
        try {
            const contact = await getUserEmail(userId);
            const email = typeof contact === 'string' ? contact : contact?.email || null;
            // One date per email: every project in it is deleted no earlier
            // than the date the user was given.
            const deadlineMs = Math.max(...list.map(x => x.deadline));
            const deletionDate = new Date(deadlineMs).toISOString();
            if (email && !dryRun) {
                const sent = await sendEmail({
                    to: email,
                    projects: list.map(x => ({ name: x.name })),
                    deletionDate,
                    inactiveDays: Math.min(...list.map(x => x.days)),
                    plan: profiles.get(userId)?.plan || 'free',
                    firstName: typeof contact === 'object' ? contact?.firstName || '' : '',
                    locale: typeof contact === 'object' ? contact?.locale || null : null,
                });
                if (sent === false) throw new Error('email not sent, will retry next run');
            }
            if (!email) log.warn(`[retention] no email for user ${userId}: notice recorded without email`);
            if (!dryRun) {
                const rows = list.map(x => ({ project_id: x.id, user_id: userId, warned_at: new Date(now).toISOString(), deadline: deletionDate }));
                const { error } = await db.from('project_deletion_notices').upsert(rows, { onConflict: 'project_id' });
                if (error) throw new Error(error.message);
            }
            report.warnedUsers++;
            report.warnedProjects += list.length;
        } catch (err) {
            report.errors.push(`notice ${userId}: ${err.message}`);
        }
    }

    // ── 3. Delete projects whose notice has run out ───────────────────────
    for (const p of toDelete) {
        if (budget <= 0) { report.errors.push('file budget reached, continuing tomorrow'); break; }
        try {
            const { data: full, error } = await db.from('projects').select('id, user_id, thumbnail_url, timeline_state').eq('id', p.id).maybeSingle();
            if (error) throw new Error(error.message);
            if (!full) continue;
            const { data: others, error: oErr } = await db.from('projects').select('id, user_id, thumbnail_url, timeline_state').eq('user_id', p.user_id).neq('id', p.id);
            if (oErr) throw new Error(oErr.message);
            const r = await deleteProjectFiles(bucket, full, others || [], { userId: p.user_id, dryRun });
            budget -= r.deleted.length;
            report.filesDeleted += r.deleted.length;
            if (r.failed.length) report.errors.push(`project ${p.id}: ${r.failed.length} file(s) failed`);
            if (!dryRun) {
                const { error: dErr } = await db.from('projects').delete().eq('id', p.id);
                if (dErr) throw new Error(dErr.message);
            }
            report.deletedProjects++;
        } catch (err) {
            report.errors.push(`delete ${p.id}: ${err.message}`);
        }
    }

    // ── 4. Stray files: unused uploads/proxies, pre-folder exports ────────
    if (bucket && budget > 0) {
        try {
            const strays = await findStrayFiles({ db, bucket, now, profilesCache: profiles });
            for (const f of strays.slice(0, budget)) {
                try {
                    if (!dryRun) await f.delete({ ignoreNotFound: true });
                    report.strayFilesDeleted++;
                } catch (err) {
                    report.errors.push(`stray ${f.name}: ${err.message}`);
                }
            }
        } catch (err) {
            report.errors.push(`stray sweep: ${err.message}`);
        }
    }

    log.log(`[retention]${dryRun ? ' (dry run)' : ''} ${JSON.stringify(report)}`);
    return report;
}

/**
 * Files older than their owner's retention period that no project uses:
 * raw/<uid>/<file>, proxies/<uid>/<name>/..., and exports/<uid>/<file>
 * (exports from before the per-project folder). Owners on active Pro keep
 * everything. Files of deleted accounts count as Free.
 */
async function findStrayFiles({ db, bucket, now, profilesCache = new Map() }) {
    const byUser = new Map();
    for (const prefix of ['raw/', 'proxies/', 'exports/']) {
        const [files] = await bucket.getFiles({ prefix });
        for (const f of files) {
            const parts = f.name.split('/');
            const uid = parts[1];
            if (!uid) continue;
            if (prefix === 'exports/' && parts.length !== 3) continue; // per-project exports go with their project
            const created = Date.parse(f.metadata?.timeCreated || f.metadata?.updated || '') || now;
            const list = byUser.get(uid) || [];
            list.push({ file: f, created });
            byUser.set(uid, list);
        }
    }
    const strays = [];
    for (const [uid, files] of byUser) {
        let profile = profilesCache.get(uid);
        if (profile === undefined) {
            const { data, error } = await db.from('profiles').select('id, plan, plan_expires_at').eq('id', uid).maybeSingle();
            if (error) continue; // unknown plan: never guess, skip this user
            profile = data || null;
            profilesCache.set(uid, profile);
        }
        const days = retentionDaysFor(profile, now);
        if (days === null) continue;
        const old = files.filter(x => now - x.created > days * DAY_MS);
        if (old.length === 0) continue;
        const { data: projects, error: pErr } = await db.from('projects').select('id, user_id, thumbnail_url, timeline_state').eq('user_id', uid);
        if (pErr) continue; // cannot tell what is in use: delete nothing for this user
        const keep = referencedBy(projects || [], uid);
        for (const { file } of old) {
            const n = file.name;
            if (keep.exact.has(n) || [...keep.prefixes].some(p => n.startsWith(p))) continue;
            strays.push(file);
        }
    }
    return strays;
}

module.exports = { runRetention, retentionDaysFor, findStrayFiles, RETENTION_DAYS, MAX_FILES_PER_RUN };
