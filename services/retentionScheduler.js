// services/retentionScheduler.js
// Wires services/retentionJob.js to production: Supabase, GCS, the
// send-email function, a daily schedule and a Redis lock so only one
// instance runs it when several web replicas are up.
//
// Env:
//   RETENTION_JOB=off       disable the schedule (manual runs still work)
//   RETENTION_CRON          override the schedule (default 03:20 UTC daily)

'use strict';

const crypto = require('crypto');
const { runRetention } = require('./retentionJob');
const { sendTransactionalEmail } = require('./emailClient');

const LOCK_KEY = 'vibed:retention:lock';
const LOCK_TTL_S = 60 * 60;
const DEFAULT_CRON = '20 3 * * *';

let running = false;

function deps() {
    const { supabaseAdmin } = require('../config/database');
    const { bucket } = require('../config/storage');
    const publicUrl = process.env.PUBLIC_URL || 'https://www.viralpilot.fr';

    return {
        db: supabaseAdmin,
        bucket: bucket || null,
        getUserEmail: async (userId) => {
            const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
            if (error || !data?.user?.email) return null;
            const meta = data.user.user_metadata || {};
            const fullName = typeof meta.full_name === 'string' ? meta.full_name : '';
            const lang = String(meta.locale || meta.language || '').slice(0, 2).toLowerCase();
            return {
                email: data.user.email,
                firstName: fullName.split(' ')[0] || '',
                locale: lang === 'fr' || lang === 'en' ? lang : null,
            };
        },
        sendEmail: ({ to, projects, deletionDate, inactiveDays, firstName, locale }) =>
            sendTransactionalEmail('deletion_warning', to, {
                first_name: firstName || '',
                projects,
                deletion_date: deletionDate,
                inactive_days: inactiveDays,
                locale: locale || undefined,
                cta_url: `${publicUrl}/dashboard`,
                account_url: `${publicUrl}/account`,
            }),
    };
}

/** Run once now. Used by the schedule and by POST /api/admin/retention/run. */
async function runRetentionNow({ dryRun = false } = {}) {
    if (running) throw new Error('retention job already running in this process');
    running = true;
    try {
        const d = deps();
        const report = await runRetention(d, { dryRun });
        if (!dryRun) {
            // Uploaded analyses expire after 30 days (models/VideoAnalysis.js);
            // this cleanup existed but nothing called it.
            try {
                report.expiredAnalysesDeleted = await require('./StorageService').cleanupExpiredVideos();
            } catch (err) {
                report.errors.push(`video_analyses cleanup: ${err.message}`);
            }
            // Anonymous sessions live 48 hours; drop the rows 30 days later.
            try {
                const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const { error } = await d.db.from('anonymous_sessions').delete().lt('expires_at', cutoff);
                if (error) throw new Error(error.message);
            } catch (err) {
                report.errors.push(`anonymous_sessions cleanup: ${err.message}`);
            }
        }
        return report;
    } finally {
        running = false;
    }
}

async function withLock(fn) {
    let redis;
    try {
        ({ connection: redis } = require('../queue/connection'));
    } catch (err) {
        console.warn('[retention] Redis unavailable, skipping scheduled run:', err.message);
        return null;
    }
    const token = crypto.randomUUID();
    let acquired = false;
    try {
        acquired = (await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_S, 'NX')) === 'OK';
    } catch (err) {
        console.warn('[retention] could not take the lock, skipping this run:', err.message);
        return null;
    }
    if (!acquired) {
        console.log('[retention] another instance holds the lock, skipping');
        return null;
    }
    try {
        return await fn();
    } finally {
        try {
            if ((await redis.get(LOCK_KEY)) === token) await redis.del(LOCK_KEY);
        } catch { /* lock expires on its own */ }
    }
}

function startRetentionSchedule() {
    if (process.env.NODE_ENV !== 'production') return false;
    if (String(process.env.RETENTION_JOB || '').toLowerCase() === 'off') {
        console.log('[retention] schedule disabled (RETENTION_JOB=off)');
        return false;
    }
    let cron;
    try {
        cron = require('node-cron');
    } catch (err) {
        console.error('[retention] node-cron missing, schedule not started:', err.message);
        return false;
    }
    const expr = process.env.RETENTION_CRON || DEFAULT_CRON;
    if (!cron.validate(expr)) {
        console.error(`[retention] invalid RETENTION_CRON "${expr}", schedule not started`);
        return false;
    }
    cron.schedule(expr, () => {
        withLock(() => runRetentionNow())
            .catch(err => console.error('[retention] run failed:', err.message));
    }, { timezone: 'Etc/UTC' });
    console.log(`[retention] scheduled (${expr} UTC)`);
    return true;
}

module.exports = { startRetentionSchedule, runRetentionNow };
