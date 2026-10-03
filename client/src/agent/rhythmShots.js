/**
 * rhythmShots.js — what zoom rhythm sends to /api/interview/rhythm-zoom and
 * how the answer becomes scale keyframes. Pure (no store import), tested in
 * node by scripts/test_rhythm_zoom.mjs.
 *
 * Three things this fixes:
 * 1. TIME BASE. The server matches words to a shot by SOURCE time (the clip's
 *    `offset` range). The command used to send `store.captions`, which are
 *    TIMELINE time, so after any cut every shot got the wrong words and the
 *    punch-ins missed the emphasised word. Words are now the asset's
 *    source-time transcript (or captions mapped back to source time), sent
 *    per shot.
 * 2. ONE CLIP. Zoom rhythm used to need several clips ("split your clip
 *    first"). A long clip is now split into virtual shots at sentence ends
 *    and pauses: the zoom level changes there like a camera cut, and
 *    punch-ins land on emphasised words. Nothing is cut.
 * 3. ONE UNDO. Keyframes are built here per clip and written in one step.
 */

/** Clips longer than this are split into virtual shots. */
export const SPLIT_LONGER_THAN = 8;
const MIN_SHOT = 2.5;
const MAX_SHOT = 7;
const PAUSE = 0.5;
/** Duration of the zoom change between two virtual shots (reads as a cut). */
const CUT = 0.04;

const wordText = (w) => String(w?.word ?? w?.content ?? w?.text ?? '').trim();
const isSentenceEnd = (w) => /[.!?…]["»”']?$/.test(wordText(w));

function normWords(list) {
    return (list || [])
        .map(w => ({ word: wordText(w), start: Number(w.start), end: Number(w.end) }))
        .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
        .sort((a, b) => a.start - b.start);
}

/**
 * SOURCE-time words inside one clip.
 * @param clip      timeline clip {start, duration, offset, speed}
 * @param transcript source-time words of the clip's asset, or null
 * @param captions  store.captions (TIMELINE time), used when there is no transcript
 */
export function clipSourceWords(clip, transcript, captions) {
    const speed = Number(clip.speed) || 1;
    const offset = Number(clip.offset) || 0;
    const start = Number(clip.start) || 0;
    const dur = Number(clip.duration) || 0;
    const srcEnd = offset + dur * speed;
    if (Array.isArray(transcript) && transcript.length) {
        return normWords(transcript).filter(w => w.start >= offset - 0.05 && w.end <= srcEnd + 0.05);
    }
    // Captions are on the timeline: keep the ones inside this clip and map
    // them back to the source.
    return normWords(captions)
        .filter(w => w.start >= start - 0.05 && w.start < start + dur)
        .map(w => ({ word: w.word, start: offset + (w.start - start) * speed, end: offset + (w.end - start) * speed }));
}

/**
 * Split one clip into shots (SOURCE time). A clip up to SPLIT_LONGER_THAN
 * seconds is one shot. Longer clips break at sentence ends, else at pauses,
 * keeping every shot between MIN_SHOT and MAX_SHOT seconds where the speech
 * allows.
 * @returns [{ srcStart, srcEnd, words }]
 */
export function splitClipIntoShots(clip, words) {
    const speed = Number(clip.speed) || 1;
    const offset = Number(clip.offset) || 0;
    const srcEnd = offset + (Number(clip.duration) || 0) * speed;
    const whole = [{ srcStart: offset, srcEnd, words }];
    if ((Number(clip.duration) || 0) <= SPLIT_LONGER_THAN || words.length < 4) return whole;

    const cuts = [];
    let shotStart = offset;
    for (let i = 0; i < words.length - 1; i++) {
        const w = words[i], next = words[i + 1];
        const boundary = (w.end + next.start) / 2;
        const len = boundary - shotStart;
        const gap = next.start - w.end;
        const strong = isSentenceEnd(w) || gap >= PAUSE;
        const soft = gap >= 0.25 || /[,;:]$/.test(w.word);
        if ((strong && len >= MIN_SHOT) || (len >= MAX_SHOT && (soft || len >= MAX_SHOT * 1.5))) {
            if (srcEnd - boundary >= MIN_SHOT * 0.6) { cuts.push(boundary); shotStart = boundary; }
        }
    }
    if (!cuts.length) return whole;
    const edges = [offset, ...cuts, srcEnd];
    return edges.slice(0, -1).map((a, i) => {
        const b = edges[i + 1];
        return { srcStart: a, srcEnd: b, words: words.filter(w => w.start >= a - 0.01 && w.start < b) };
    });
}

/**
 * Build the request body's clip list.
 * @param clips     timeline clips (any video track), each with _trackId
 * @param wordsFor  (clip) => source-time words for that clip
 * @param assetName (clip) => asset name or null
 * @returns { shots: [{ id, clipId, trackId, srcStart, srcEnd, speed, clipOffset }], payloadClips, words }
 */
export function buildRhythmRequest(clips, wordsFor, assetName = () => null) {
    const shots = [];
    for (const clip of clips) {
        const words = wordsFor(clip);
        const parts = splitClipIntoShots(clip, words);
        parts.forEach((p, k) => shots.push({
            id: parts.length > 1 ? `${clip.id}::${k}` : clip.id,
            clipId: clip.id,
            trackId: clip._trackId || null,
            srcStart: p.srcStart,
            srcEnd: p.srcEnd,
            speed: Number(clip.speed) || 1,
            clipOffset: Number(clip.offset) || 0,
            words: p.words,
            assetName: assetName(clip),
        }));
    }
    const payloadClips = shots.map(s => ({
        id: s.id,
        offset: Number(s.srcStart.toFixed(3)),
        duration: Number((s.srcEnd - s.srcStart).toFixed(3)),
        assetName: s.assetName || null,
        words: s.words,
    }));
    const words = shots.flatMap(s => s.words);
    return { shots, payloadClips, words };
}

/**
 * Turn the server's per-shot motion into one scale keyframe track per clip
 * (clip-local TIMELINE seconds, what preview and export both read).
 *   static   → hold the shot's scale
 *   push_in  → from → to across the shot
 *   punch_in → hold `from`, snap to `to` on the emphasised word
 * Between two shots of one clip the zoom changes over CUT seconds, so it
 * reads as a camera cut.
 * @param shots      from buildRhythmRequest
 * @param clipZooms  server response [{ clipId: shotId, scale, motion }]
 * @param clipDur    (clipId) => clip duration on the timeline
 * @returns Map clipId → [{ time, value, easing }]
 */
export function shotsToKeyframes(shots, clipZooms, clipDur) {
    const byShot = new Map((clipZooms || []).map(z => [z.clipId, z]));
    const out = new Map();
    for (const shot of shots) {
        const z = byShot.get(shot.id);
        if (!z) continue;
        const m = z.motion || { kind: 'static', from: z.scale, to: z.scale };
        const to = Number(m.to ?? z.scale) || 1;
        const from = Number(m.from ?? to) || to;
        const dur = Number(clipDur(shot.clipId)) || 0;
        const a = Math.max(0, (shot.srcStart - shot.clipOffset) / shot.speed);
        const b = Math.min(dur, (shot.srcEnd - shot.clipOffset) / shot.speed);
        if (!(b > a)) continue;
        const kfs = out.get(shot.clipId) || [];
        const first = kfs.length === 0;
        const t0 = first ? a : Math.min(b, a + CUT);
        const push = (time, value, easing = 'linear') => kfs.push({ time: Number(time.toFixed(3)), value: Number(value.toFixed(4)), easing });
        if (m.kind === 'push_in' && b - a > 0.5) {
            push(t0, from);
            push(b, to, 'easeOutCubic');
        } else if (m.kind === 'punch_in' && Number.isFinite(Number(m.at))) {
            const at = a + Number(m.at) / shot.speed;
            const hold = Math.max(t0 + 0.01, at - 0.08);
            const snap = Math.min(b, Math.max(hold + 0.05, at + 0.06));
            push(t0, from);
            push(hold, from);
            push(snap, to, 'easeOutCubic');
            if (b - snap > 0.05) push(b, to);
        } else {
            push(t0, to);
            if (b - t0 > 0.05) push(b, to);
        }
        out.set(shot.clipId, kfs);
    }
    // Strictly increasing times (a shot boundary can coincide with the
    // previous shot's last keyframe).
    for (const [id, kfs] of out) {
        const clean = [];
        for (const k of kfs.sort((x, y) => x.time - y.time)) {
            const prev = clean[clean.length - 1];
            if (prev && k.time <= prev.time) { if (k.time === prev.time) clean[clean.length - 1] = k; continue; }
            clean.push(k);
        }
        out.set(id, clean);
    }
    return out;
}
