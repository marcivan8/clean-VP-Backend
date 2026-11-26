/**
 * client/src/lib/socialCalendar.js — date logic for the posting planner (R172).
 * Pure: no React, no fetch. Everything is in the viewer's LOCAL time, since a
 * post scheduled "Tuesday 18:00" means the user's Tuesday.
 */

// Mirrors services/social/scheduleMedia.js: one minute to six and a half days
// out (the signed media link a post carries lives at most seven days).
export const MIN_LEAD_MS = 60_000;
export const MAX_LEAD_MS = 6 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of a date in local time. */
export function dayKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A Date at local midnight for a 'YYYY-MM-DD' key. */
export function dateFromKey(key) {
    const [y, m, d] = String(key).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * The 6-week grid for a month, weeks starting Monday.
 * @returns {{ key:string, date:Date, inMonth:boolean }[]} 42 days
 */
export function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7; // Monday = 0
    const start = new Date(year, month, 1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        return { key: dayKey(date), date, inMonth: date.getMonth() === month };
    });
}

/** The [from, to) range the grid covers, as ISO strings for GET /calendar. */
export function gridRange(year, month) {
    const grid = monthGrid(year, month);
    const from = grid[0].date;
    const last = grid[grid.length - 1].date;
    const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
}

/** The time a post is shown at: when it went out if published, else when it is planned. */
export function postTime(post) {
    return post?.status === 'published' && post.publishedAt ? post.publishedAt : post?.scheduledAt;
}

/** Posts grouped by local day, each day sorted by time. */
export function groupByDay(posts) {
    const byDay = new Map();
    for (const post of posts || []) {
        const key = dayKey(postTime(post));
        if (!key) continue;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(post);
    }
    for (const list of byDay.values()) list.sort((a, b) => Date.parse(postTime(a)) - Date.parse(postTime(b)));
    return byDay;
}

/** Same local time of day, moved to another day (drag a post onto a day). */
export function moveToDay(isoTime, targetKey) {
    const from = new Date(isoTime);
    const day = dateFromKey(targetKey);
    if (Number.isNaN(from.getTime())) return null;
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.getHours(), from.getMinutes()).toISOString();
}

/** True when the server would accept this as a new publication time. */
export function canScheduleAt(isoTime, now = Date.now()) {
    const t = Date.parse(isoTime);
    return Number.isFinite(t) && t >= now + MIN_LEAD_MS && t <= now + MAX_LEAD_MS;
}

/** What the user can do with a post right now. */
export function postActions(post, { isPro = false } = {}) {
    const status = post?.status;
    return {
        reschedule: status === 'scheduled' && isPro,
        cancel: status === 'scheduled',
        markPosted: status === 'manual_reminder' || status === 'failed',
    };
}

/** 'YYYY-MM-DDTHH:mm' for a datetime-local input, in local time. */
export function localInputValue(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default { dayKey, dateFromKey, monthGrid, gridRange, groupByDay, moveToDay, canScheduleAt, postActions, localInputValue, postTime };
