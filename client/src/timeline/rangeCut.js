/**
 * rangeCut.js — cut a TIMELINE time range [a, b) out of the edit.
 *
 * Used by the transcript panel's "cut selected words": the selection is a
 * span of the edited timeline (words already mapped through the clips that
 * play them, see transcriptMap.js), so the cut is planned in timeline time.
 * The older cutSourceRange took SOURCE times and removed that span from
 * every clip regardless of which file it came from, then re-packed the whole
 * track; on a multi-file or reordered edit it cut the wrong clips.
 *
 * Pure and dependency-free. Rules (same family as rippleDelete.js):
 *  - MAIN video track: the part of each clip inside [a, b) is removed; a clip
 *    that spans the range becomes two pieces (the right piece keeps playing
 *    the same source from where it was, speed-aware). Everything after b
 *    slides left by (b - a).
 *  - TEXT tracks: caption clips (clips with `words`) lose the words spoken in
 *    the range (midpoint rule, same as transcriptMap.js) and are re-timed with
 *    the edit; a caption left with no words is removed. Plain text overlays are
 *    re-timed; one that sat entirely inside the range lands on the cut point
 *    and is kept, exactly like rippleDelete.
 *  - Every other track (b-roll video, audio, overlays) is untouched, again
 *    matching rippleDelete.
 */

import { getMainVideoTrackId } from './rippleDelete.js';

const EPS = 1e-3;
const MIN_PIECE = 0.02;      // drop main-track slivers shorter than ~1 frame
const MIN_CAPTION = 0.05;

const wordText = (w) => String(w?.text ?? w?.word ?? w?.content ?? '').trim();
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * @param {Array}  tracks  legacy tracks (store.tracks)
 * @param {number} a       range start (timeline seconds)
 * @param {number} b       range end   (timeline seconds)
 * @returns {{ mainTrackId, range, removeIds: string[],
 *             updates: Array<{id, updates}>,
 *             adds: Array<{fromId, overrides}>,
 *             wordEdits: Array<{id, words, content?}>,   // words in DISPLAYED timeline time
 *             changed: boolean }}
 */
export function computeRangeCut(tracks, a, b) {
    const list = Array.isArray(tracks) ? tracks : [];
    const A = Number(a);
    const B = Number(b);
    const empty = { mainTrackId: null, range: [A, B], removeIds: [], updates: [], adds: [], wordEdits: [], changed: false };
    if (!Number.isFinite(A) || !Number.isFinite(B) || B - A <= EPS) return empty;

    const cut = B - A;
    const mapT = (t) => (t <= A ? t : (t >= B ? t - cut : A));
    const mainTrackId = getMainVideoTrackId(list);
    const plan = { ...empty, mainTrackId };

    // A caption clip entity shared by several placements (splitPlacement
    // reuses it) must not have its words rewritten for just one of them.
    const entityUse = new Map();
    for (const t of list) for (const c of t?.clips || []) {
        if (c?.clipId) entityUse.set(c.clipId, (entityUse.get(c.clipId) || 0) + 1);
    }

    for (const track of list) {
        const isMain = track?.id === mainTrackId;
        const isText = track?.type === 'text';
        if (!isMain && !isText) continue;

        for (const clip of track.clips || []) {
            const s = Number(clip.start) || 0;
            const d = Math.max(0, Number(clip.duration) || 0);
            const e = s + d;
            const overlap = Math.min(e, B) - Math.max(s, A);

            if (e <= A + EPS) continue;                       // entirely before the cut
            if (s >= B - EPS || overlap <= EPS) {             // entirely after (or only touching)
                if (s >= B - EPS) plan.updates.push({ id: clip.id, updates: { startTime: Math.max(0, s - cut) } });
                continue;
            }

            if (isMain) {
                const speed = Number(clip.speed) > 0 ? Number(clip.speed) : 1;
                const offset = Number(clip.offset) || 0;
                const leftDur = Math.max(0, A - s);
                const rightDur = Math.max(0, e - B);
                const hasLeft = leftDur >= MIN_PIECE;
                const hasRight = rightDur >= MIN_PIECE;
                const rightPiece = { startTime: A, duration: rightDur, offset: offset + (B - s) * speed };

                if (!hasLeft && !hasRight) {
                    plan.removeIds.push(clip.id);
                } else if (hasLeft && hasRight) {
                    plan.updates.push({ id: clip.id, updates: { duration: leftDur } });
                    plan.adds.push({ fromId: clip.id, overrides: rightPiece });
                } else if (hasLeft) {
                    plan.updates.push({ id: clip.id, updates: { duration: leftDur } });
                } else {
                    plan.updates.push({ id: clip.id, updates: rightPiece });
                }
                continue;
            }

            // ── text track ──
            const words = Array.isArray(clip.words) ? clip.words : [];
            if (words.length > 0) {
                const kept = words.filter(w => {
                    const ws = Number(w?.start);
                    const we = Number.isFinite(Number(w?.end)) ? Number(w.end) : ws;
                    if (!Number.isFinite(ws)) return true;
                    const mid = (ws + we) / 2;
                    return !(mid >= A - EPS && mid < B - EPS);
                });
                const newStart = mapT(s);
                const newDur = mapT(e) - newStart;
                if (kept.length === 0 || newDur < MIN_CAPTION) {
                    plan.removeIds.push(clip.id);
                    continue;
                }
                plan.updates.push({ id: clip.id, updates: { startTime: newStart, duration: newDur } });
                // Re-time the words too: the ones after the cut slide left with
                // the audio, even when no word was removed (a cut in a pause).
                if ((entityUse.get(clip.clipId) || 0) <= 1) {
                    const newWords = kept.map(w => {
                        const ws = Number(w?.start);
                        const we = Number(w?.end);
                        return {
                            ...w,
                            start: Number.isFinite(ws) ? mapT(ws) : w?.start,
                            end: Number.isFinite(we) ? mapT(we) : w?.end,
                        };
                    });
                    const edit = { id: clip.id, words: newWords };
                    // Only rewrite the caption text when it is still exactly the
                    // spoken words (never overwrite text the user typed).
                    const spoken = norm(words.map(wordText).join(' '));
                    if (kept.length !== words.length && spoken && norm(clip.content) === spoken) {
                        edit.content = kept.map(wordText).join(' ');
                    }
                    plan.wordEdits.push(edit);
                }
                continue;
            }

            // Plain text overlay: re-time; fully inside → lands on the cut point.
            if (s >= A - EPS && e <= B + EPS) {
                plan.updates.push({ id: clip.id, updates: { startTime: A } });
            } else {
                const newStart = mapT(s);
                plan.updates.push({ id: clip.id, updates: { startTime: newStart, duration: Math.max(0.1, mapT(e) - newStart) } });
            }
        }
    }

    plan.changed = plan.removeIds.length + plan.updates.length + plan.adds.length > 0;
    return plan;
}
