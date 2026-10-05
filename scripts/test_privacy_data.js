/**
 * scripts/test_privacy_data.js
 *
 *   node scripts/test_privacy_data.js
 *
 * Pins the behaviour the privacy pages promise (RGPD round, 2026-10):
 *   - media files are only readable by their owner (services/mediaAccess.js)
 *   - deleting a project deletes its files, but not files another project
 *     of the same user still uses (services/projectFiles.js)
 *   - retention: one email at least 24 h before deletion, nothing deleted
 *     without that notice, editing revives a project, active Pro is kept,
 *     a failed email means no notice and no deletion (services/retentionJob.js)
 *   - unsubscribe links are signed (services/unsubscribeToken.js)
 * Runs against in-memory fakes of Supabase and Google Cloud Storage.
 */
'use strict';

process.env.NODE_ENV = 'test';
process.env.MEDIA_COOKIE_SECRET = 'test-media-secret';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) console.log(`  ✓ ${name}`);
    else { failures++; console.log(`  ✗ ${name}${detail !== undefined ? `  → ${JSON.stringify(detail)}` : ''}`); }
};

// ── In-memory Supabase ───────────────────────────────────────────────────────
function makeDb(tables) {
    const rows = (t) => (tables[t] = tables[t] || []);
    function query(table) {
        const filters = [];
        let op = 'select';
        let payload = null;
        let single = false;
        const q = {
            select() { return q; },
            lt(c, v) { filters.push(r => r[c] < v); return q; },
            eq(c, v) { filters.push(r => r[c] === v); return q; },
            neq(c, v) { filters.push(r => r[c] !== v); return q; },
            in(c, vs) { filters.push(r => vs.includes(r[c])); return q; },
            delete() { op = 'delete'; return q; },
            update(v) { op = 'update'; payload = v; return q; },
            upsert(v, opts) { op = 'upsert'; payload = { v, key: opts?.onConflict || 'id' }; return q; },
            maybeSingle() { single = true; return q; },
            then(resolve, reject) {
                try {
                    const all = rows(table);
                    const match = all.filter(r => filters.every(f => f(r)));
                    if (op === 'delete') {
                        tables[table] = all.filter(r => !match.includes(r));
                        return resolve({ data: null, error: null });
                    }
                    if (op === 'update') { match.forEach(r => Object.assign(r, payload)); return resolve({ data: null, error: null }); }
                    if (op === 'upsert') {
                        for (const row of payload.v) {
                            const i = all.findIndex(r => r[payload.key] === row[payload.key]);
                            if (i >= 0) all[i] = { ...all[i], ...row }; else all.push({ ...row });
                        }
                        return resolve({ data: null, error: null });
                    }
                    const data = match.map(r => ({ ...r }));
                    return resolve({ data: single ? (data[0] || null) : data, error: null });
                } catch (err) { return reject(err); }
            },
        };
        return q;
    }
    return { from: query, tables };
}

// ── In-memory GCS bucket ─────────────────────────────────────────────────────
function makeBucket(names, createdAt) {
    const files = new Map(names.map(n => [n, { timeCreated: createdAt }]));
    const fileObj = (name) => ({
        name,
        metadata: files.get(name) || {},
        delete: async () => { files.delete(name); },
    });
    return {
        files,
        file: fileObj,
        getFiles: async ({ prefix }) => [[...files.keys()].filter(n => n.startsWith(prefix)).map(fileObj)],
    };
}

(async () => {
    // ── mediaAccess ──────────────────────────────────────────────────────────
    console.log('mediaAccess');
    const ma = require('../services/mediaAccess');
    const tok = ma.issueToken('u1');
    check('token verifies to its user', ma.verifyToken(tok) === 'u1');
    check('tampered token is rejected', ma.verifyToken(tok.slice(0, -2) + 'xx') === null);
    check('expired token is rejected', ma.verifyToken(ma.issueToken('u1', 1, Date.now() - 10_000)) === null);
    check('owner can read raw file', ma.canReadObject('raw/u1/a.mov', 'u1').allowed);
    check('other user cannot', !ma.canReadObject('raw/u1/a.mov', 'u2').allowed);
    check('anonymous cannot', ma.canReadObject('exports/u1/p/x.mp4', null).reason === 'no_identity');
    check('path traversal refused', ma.canReadObject('raw/u1/../u2/a.mov', 'u1').reason === 'bad_path');
    check('public library is open', ma.canReadObject('sticker-library/a.png', null).allowed);
    check('unknown prefix denied', !ma.canReadObject('secret/x', 'u1').allowed);

    // Guard: enforced in production
    process.env.NODE_ENV = 'production';
    const guard = ma.requireMediaAccess(req => req.path);
    const run = (path, cookie) => new Promise(resolve => {
        const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
        guard({ path, headers: { cookie } }, res, () => resolve(200));
    });
    check('prod: owner with cookie gets 200', await run('raw/u1/a.mov', `${ma.COOKIE_NAME}=${tok}`) === 200);
    check('prod: no cookie gets 401', await run('raw/u1/a.mov', '') === 401);
    check("prod: someone else's file gets 403", await run('raw/u2/a.mov', `${ma.COOKIE_NAME}=${tok}`) === 403);
    process.env.NODE_ENV = 'test';

    // ── projectFiles ─────────────────────────────────────────────────────────
    console.log('projectFiles');
    const pf = require('../services/projectFiles');
    const pA = {
        id: 'pA', user_id: 'u1', thumbnail_url: null,
        timeline_state: { assets: [
            { id: 'a1', gcsPath: 'raw/u1/shared.mov', proxyUrl: '/api/proxy/gcs-media/proxies/u1/shared/proxy.mp4' },
            { id: 'a2', sourceUrl: 'https://storage.googleapis.com/bkt/raw/u1/onlyA.mov' },
            { id: 'evil', gcsPath: 'raw/u2/notmine.mov' },
        ] },
    };
    const pB = { id: 'pB', user_id: 'u1', timeline_state: { assets: [{ id: 'b1', gcsPath: 'raw/u1/shared.mov' }] } };
    const f = pf.filesForProject(pA, 'u1');
    check('finds raw uploads by path and URL', f.exact.has('raw/u1/shared.mov') && f.exact.has('raw/u1/onlyA.mov'));
    check('never lists another user file', !f.exact.has('raw/u2/notmine.mov'));
    check('includes proxy folder and exports folder', f.prefixes.has('proxies/u1/shared/') && f.prefixes.has('exports/u1/pA/'));
    const bucket = makeBucket([
        'raw/u1/shared.mov', 'raw/u1/onlyA.mov', 'raw/u2/notmine.mov',
        'proxies/u1/shared/proxy.mp4', 'exports/u1/pA/final.mp4', 'thumbnails/u1/pA.jpg', 'waveforms/u1/a2.json',
    ], new Date().toISOString());
    const rep = await pf.deleteProjectFiles(bucket, pA, [pB], { userId: 'u1' });
    check('deletes files only project A uses', !bucket.files.has('raw/u1/onlyA.mov') && !bucket.files.has('exports/u1/pA/final.mp4') && !bucket.files.has('thumbnails/u1/pA.jpg'));
    check('keeps the upload project B still uses', bucket.files.has('raw/u1/shared.mov') && rep.kept.includes('raw/u1/shared.mov'));
    check("never touches another user's file", bucket.files.has('raw/u2/notmine.mov'));

    // ── retentionJob ─────────────────────────────────────────────────────────
    console.log('retentionJob');
    const { runRetention, retentionDaysFor } = require('../services/retentionJob');
    const DAY = 86400000;
    const now = Date.parse('2026-10-10T03:20:00Z');
    const iso = (ms) => new Date(ms).toISOString();
    check('free = 7 days', retentionDaysFor({ plan: 'free' }, now) === 7);
    check('creator = 30 days', retentionDaysFor({ plan: 'creator' }, now) === 30);
    check('active pro = kept', retentionDaysFor({ plan: 'pro', plan_expires_at: iso(now + DAY) }, now) === null);
    check('expired pro = free rule', retentionDaysFor({ plan: 'pro', plan_expires_at: iso(now - DAY) }, now) === 7);

    const tables = {
        profiles: [
            { id: 'free1', plan: 'free' },
            { id: 'pro1', plan: 'pro', plan_expires_at: iso(now + 30 * DAY) },
            { id: 'cr1', plan: 'creator' },
        ],
        projects: [
            { id: 'f-old', user_id: 'free1', name: 'Old vlog', updated_at: iso(now - 7 * DAY), timeline_state: {} },
            { id: 'f-new', user_id: 'free1', name: 'Fresh', updated_at: iso(now - 1 * DAY), timeline_state: {} },
            { id: 'p-old', user_id: 'pro1', name: 'Pro project', updated_at: iso(now - 200 * DAY), timeline_state: {} },
            { id: 'c-mid', user_id: 'cr1', name: 'Creator project', updated_at: iso(now - 10 * DAY), timeline_state: {} },
        ],
        project_deletion_notices: [],
    };
    const db = makeDb(tables);
    const emails = [];
    const deps = {
        db,
        bucket: null,
        getUserEmail: async (id) => ({ email: `${id}@example.com`, firstName: 'Sam', locale: 'fr' }),
        sendEmail: async (m) => { emails.push(m); return true; },
    };
    const quiet = { log() {}, warn() {} };

    let r = await runRetention(deps, { now, log: quiet });
    check('warns the free user once', emails.length === 1 && emails[0].to === 'free1@example.com', emails.map(e => e.to));
    check('email lists only the due project', emails[0]?.projects.length === 1 && emails[0].projects[0].name === 'Old vlog');
    check('email date is at least 24 h away', Date.parse(emails[0]?.deletionDate) >= now + DAY);
    check('nothing deleted on the warning run', tables.projects.length === 4 && r.deletedProjects === 0);
    check('pro and recent projects untouched', !tables.project_deletion_notices.some(n => ['p-old', 'f-new', 'c-mid'].includes(n.project_id)));

    r = await runRetention(deps, { now: now + 12 * 3600000, log: quiet });
    check('no second email, no deletion before the date', emails.length === 1 && r.deletedProjects === 0);

    r = await runRetention(deps, { now: now + DAY + 60000, log: quiet });
    check('deleted after the notice ran out', r.deletedProjects === 1 && !tables.projects.some(p => p.id === 'f-old'));

    // Revive: a project edited after its notice is kept and its notice dropped.
    tables.projects.push({ id: 'f-rev', user_id: 'free1', name: 'Revived', updated_at: iso(now - 8 * DAY), timeline_state: {} });
    await runRetention(deps, { now, log: quiet });
    const p = tables.projects.find(x => x.id === 'f-rev');
    p.updated_at = iso(now + 3600000);
    r = await runRetention(deps, { now: now + DAY + 60000, log: quiet });
    check('editing after the notice revives the project', r.revivedProjects === 1 && tables.projects.some(x => x.id === 'f-rev'));
    check('revived project has no notice left', !tables.project_deletion_notices.some(n => n.project_id === 'f-rev'));

    // Failed email: no notice recorded, so nothing can be deleted later.
    const t2 = { profiles: [{ id: 'u9', plan: 'free' }], projects: [{ id: 'x', user_id: 'u9', name: 'X', updated_at: iso(now - 9 * DAY), timeline_state: {} }], project_deletion_notices: [] };
    const deps2 = { ...deps, db: makeDb(t2), sendEmail: async () => false };
    r = await runRetention(deps2, { now, log: quiet });
    check('failed email records no notice', t2.project_deletion_notices.length === 0 && r.errors.length === 1);
    r = await runRetention(deps2, { now: now + 2 * DAY, log: quiet });
    check('and never deletes without a notice', t2.projects.length === 1 && r.deletedProjects === 0);

    // Dry run changes nothing.
    const t3 = { profiles: [{ id: 'u8', plan: 'free' }], projects: [{ id: 'y', user_id: 'u8', name: 'Y', updated_at: iso(now - 9 * DAY), timeline_state: {} }], project_deletion_notices: [] };
    const sent3 = [];
    r = await runRetention({ ...deps, db: makeDb(t3), sendEmail: async (m) => { sent3.push(m); return true; } }, { now, dryRun: true, log: quiet });
    check('dry run sends nothing and records nothing', sent3.length === 0 && t3.project_deletion_notices.length === 0 && r.warnedProjects === 1);

    // ── unsubscribe tokens ───────────────────────────────────────────────────
    console.log('unsubscribeToken');
    const ut = require('../services/unsubscribeToken');
    const uid = '123e4567-e89b-12d3-a456-426614174000';
    const sig = ut.signUnsubscribe(uid);
    check('valid signature accepted', ut.verifyUnsubscribe(uid, sig));
    check('signature for another user rejected', !ut.verifyUnsubscribe('123e4567-e89b-12d3-a456-426614174001', sig));
    check('malformed input rejected', !ut.verifyUnsubscribe(uid, 'abc') && !ut.verifyUnsubscribe('x', sig));

    console.log(failures ? `\n${failures} check(s) failed` : '\nAll privacy data checks passed');
    process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
