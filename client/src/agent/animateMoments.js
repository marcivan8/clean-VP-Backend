/**
 * animateMoments.js — which detected moments the "animate" command acts on.
 * Pure; tested by scripts/test_animate_command.mjs.
 *
 * The detector can return many moments (every loud spot, every caption with a
 * reveal word). Animating all of them makes a video jittery and stacks a
 * sound effect on each. Events within CLUSTER_S form one moment; the strongest moments are kept,
 * at least MIN_GAP_S apart, at most one per SECONDS_PER_MOMENT of video
 * (never fewer than MIN_MOMENTS). Every plan item of a kept moment is kept
 * (its overlay reactions included).
 */
export const MIN_GAP_S = 3;
export const SECONDS_PER_MOMENT = 6;
export const MIN_MOMENTS = 3;
export const CLUSTER_S = 1.0;

export function selectAnimateMoments(plan, totalDuration) {
    const items = (Array.isArray(plan) ? plan : [])
        .filter(p => p && Number.isFinite(Number(p.timelineTime)))
        .sort((a, b) => Number(a.timelineTime) - Number(b.timelineTime));
    if (items.length === 0) return [];
    const score = (it) => (Number.isFinite(Number(it.intensity)) ? Number(it.intensity) : 0.5);

    // One moment = events within CLUSTER_S of its first one (a caption with a
    // reveal word and the loud word half a second later animate TOGETHER).
    const moments = [];
    for (const it of items) {
        const t = Number(it.timelineTime);
        const last = moments[moments.length - 1];
        if (last && t - last.t <= CLUSTER_S) { last.items.push(it); last.score = Math.max(last.score, score(it)); }
        else moments.push({ t, items: [it], score: score(it) });
    }

    const cap = Math.max(MIN_MOMENTS, Math.ceil((Number(totalDuration) || 0) / SECONDS_PER_MOMENT));
    const kept = [];
    for (const m of [...moments].sort((a, b) => b.score - a.score || a.t - b.t)) {
        if (kept.length >= cap) break;
        if (kept.every(x => Math.abs(x.t - m.t) >= MIN_GAP_S)) kept.push(m);
    }
    const keep = new Set(kept.flatMap(m => m.items));
    return items.filter(it => keep.has(it));
}

/** Number of distinct moments (CLUSTER_S groups) in a selected plan. */
export function countMoments(plan) {
    const ts = (Array.isArray(plan) ? plan : []).map(p => Number(p?.timelineTime)).filter(Number.isFinite).sort((a, b) => a - b);
    let n = 0, start = -Infinity;
    for (const t of ts) if (t - start > CLUSTER_S) { n++; start = t; }
    return n;
}

/** A playable URL for a sound-effect row (same fields the SFX panel uses), or null. */
export function sfxPlayableUrl(sfx) {
    const url = sfx?.preview_url || sfx?.previewUrl || sfx?.asset_url || sfx?.file_url || sfx?.url || null;
    return typeof url === 'string' && /^(https?:\/\/|\/)/.test(url) ? url : null;
}
