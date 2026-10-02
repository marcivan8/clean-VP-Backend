/**
 * retakeDetector.js — finds retakes (a sentence started or said 2, 3, 4
 * times because the speaker was looking for the right take) and picks the
 * best take of each, in ONE video's transcript (source time).
 *
 * Why it was rebuilt (old /api/ai/detect-repeated-takes): fixed 8-second
 * windows that never lined up with sentences, a 0.88 meaning-similarity bar
 * that reworded takes never reach, pair-only comparisons (3 takes = 2
 * unrelated guesses), an AI judge that saw 200 characters without context and
 * kept the EARLIER take on a tie.
 *
 * How it works now:
 *   1. The transcript is shown to the AI as short timestamped lines (breaks at
 *      pauses / sentence ends), plus "possible restart" hints found by a cheap
 *      word-sequence scan (the same opening said again a few seconds later).
 *   2. The AI returns GROUPS of attempts at the same line (wording may differ,
 *      cut-off attempts and false starts count) and which attempt to keep:
 *      complete, fluent, fewest hesitations; the LAST good one on a tie.
 *   3. Each attempt's quoted text is aligned back onto the real words (fuzzy,
 *      near its timestamp), so cuts land exactly on word boundaries.
 *   4. A rejected attempt is cut from its first word up to where the next
 *      attempt starts (so the hesitation between them goes too). Guards: the
 *      kept take is never cut, one cut ≤ 60 s, a group spans ≤ 90 s, total
 *      cuts ≤ 60 % of the video.
 * With no AI available it falls back to exact repeats only (3+ identical
 * words restarted), never guessing at reworded takes.
 *
 * Pure except for the injected `complete(prompt)` call. CommonJS (backend).
 */

const DISCOURSE = new Set(['et', 'alors', 'donc', 'voila', 'bon', 'euh', 'hum', 'ben', 'bah', 'mais',
    'and', 'so', 'well', 'okay', 'ok', 'um', 'uh', 'like', 'now', 'right', 'y', 'pues', 'entonces']);
const STOP = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'que', 'qui', 'est', 'a', 'et',
    'the', 'a', 'an', 'of', 'to', 'is', 'it', 'in', 'on', 'and', 'that', 'this', 'i', 'you', 'je', 'tu',
    'il', 'elle', 'on', 'ce', 'cet', 'cette', 'en', 'dans', 'pour', 'pas', 'ne', 'se', 'sa', 'son']);

const MAX_CUT_SEC = 60;
const MAX_GROUP_SPAN_SEC = 90;
const MAX_TOTAL_CUT_RATIO = 0.6;
const EDGE_PAD = 0.04;

/** Comparable form of a word: lower case, no accents, letters/digits only. */
function norm(word) {
    return String(word || '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function wordText(w) {
    return String(w?.word ?? w?.text ?? w?.content ?? '').trim();
}

/** Clean, ordered words with numeric times; drops empty tokens. */
function cleanWords(words) {
    return (Array.isArray(words) ? words : [])
        .map(w => ({ word: wordText(w), start: Number(w?.start), end: Number(w?.end) }))
        .filter(w => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start)
        .sort((a, b) => a.start - b.start);
}

const SENTENCE_END = /[.!?…]+["»”)]*$/;

/**
 * Short lines for the AI to read: break at a pause ≥ 0.5 s, at a sentence end
 * (incl. "..."), or every 14 words. Returns [{ from, to, start, end, text }].
 */
function buildLines(words, { pause = 0.5, maxWords = 14 } = {}) {
    const lines = [];
    let from = 0;
    for (let i = 0; i < words.length; i++) {
        const next = words[i + 1];
        const gap = next ? next.start - words[i].end : Infinity;
        const count = i - from + 1;
        if (!next || gap >= pause || SENTENCE_END.test(words[i].word) || count >= maxWords) {
            lines.push({
                from, to: i,
                start: words[from].start, end: words[i].end,
                text: words.slice(from, i + 1).map(w => w.word).join(' '),
            });
            from = i + 1;
        }
    }
    return lines;
}

const PHRASE_BREAK = /[.!?…,;:]+["»”)]*$/;

/**
 * Does a phrase begin at word k? (first word, after punctuation or a pause
 * ≥ 0.3 s, possibly behind discourse markers: "Et voilà, aujourd'hui…").
 */
function opensPhrase(words, tokens, k) {
    let b = k;
    while (b > 0 && DISCOURSE.has(tokens[b - 1])) b--;
    if (b === 0) return true;
    const prev = words[b - 1];
    return PHRASE_BREAK.test(prev.word) || (words[b].start - prev.end) >= 0.3;
}

/**
 * Cheap restart scan: a phrase opening (2+ identical words, at least one
 * meaningful) said again as another phrase opening 0.3–40 s later.
 * Returns [{ i, j, n, at, againAt }] (word indices). Hints for the AI; with
 * `minRun: 3` it is also the no-AI fallback (exact repeats only).
 */
function findRestarts(words, { minRun = 2, maxGap = 40 } = {}) {
    const tokens = words.map(w => norm(w.word));
    const out = [];
    for (let i = 0; i < words.length; i++) {
        if (!tokens[i] || DISCOURSE.has(tokens[i]) || !opensPhrase(words, tokens, i)) continue;
        for (let j = i + 1; j < words.length; j++) {
            const dt = words[j].start - words[i].start;
            if (dt > maxGap) break;
            if (dt < 0.3 || tokens[j] !== tokens[i] || !opensPhrase(words, tokens, j)) continue;
            let n = 0;
            while (i + n < j && j + n < words.length && tokens[i + n] && tokens[i + n] === tokens[j + n]) n++;
            if (n < minRun) continue;
            const run = tokens.slice(i, i + n);
            if (!run.some(t => t.length >= 4 && !STOP.has(t))) continue;
            // "…le pourquoi." then "Le pourquoi pour moi": the first run ENDS a
            // sentence, so it isn't an opening that was restarted.
            if (SENTENCE_END.test(words[i + n - 1].word) && n < 3) continue;
            out.push({ i, j, n, at: words[i].start, againAt: words[j].start });
            break; // nearest restart of this opening
        }
    }
    return out;
}

function fmt(t) { return `${Number(t).toFixed(1)}s`; }

function buildPrompt(words, { language = null } = {}) {
    const lines = buildLines(words);
    const hints = findRestarts(words).slice(0, 60)
        .map(h => `${fmt(h.at)} → ${fmt(h.againAt)} ("${words.slice(h.i, h.i + h.n).map(w => w.word).join(' ')}")`);
    const transcript = lines.map(l => `[${fmt(l.start)}] ${l.text}`).join('\n');
    return `You are a professional video editor cleaning up a talking-head recording${language ? ` (language: ${language})` : ''}.
The speaker often restarts a sentence to get a better take: they say it 2, 3 or more times in a row.
Attempts can be cut off mid-sentence ("Tony Robbins said..."), reworded, shorter or longer, or a false start of a few words.

Find every GROUP of attempts at the same sentence/idea, said close together (normally within 60 seconds).
For each group, choose the attempt to KEEP:
- complete (not cut off), fluent, fewest hesitations, clearest;
- if several are complete and equally good, keep the LAST one (speakers retake until it is right).

Do NOT group: intentional repetition (lists, emphasis, a refrain, a callback later in the video), a question then its answer, or two different sentences that merely start with the same words.

For each attempt give "start" (the timestamp in seconds where it begins, from the transcript) and "text": the EXACT words of that attempt copied from the transcript, from its first word up to where the speaker stopped (the kept attempt: up to the end of its sentence). Never invent or translate words.

Possible restarts found automatically (may include false alarms):
${hints.length ? hints.join('\n') : '(none)'}

Transcript:
${transcript}

Respond ONLY with JSON:
{"groups":[{"summary":"<what the speaker was trying to say>","attempts":[{"start":<seconds>,"text":"<exact words>"}],"keep":<index of the attempt to keep>,"reason":"<one sentence>"}]}
Return {"groups":[]} when there are no retakes.`;
}

/** Length of the longest common subsequence of two token arrays. */
function lcs(a, b) {
    const m = a.length, n = b.length;
    if (!m || !n) return 0;
    let prev = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
        const cur = new Array(n + 1).fill(0);
        for (let j = 1; j <= n; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        prev = cur;
    }
    return prev[n];
}

/**
 * Locate a quoted attempt in the words near `approxStart`.
 * @returns {{ from, to, score } | null} word indices (inclusive)
 */
function alignQuote(words, tokens, quote, approxStart, { window = 8, minScore = 0.6 } = {}) {
    const q = String(quote || '').split(/\s+/).map(norm).filter(Boolean);
    if (!q.length) return null;
    const t0 = Number(approxStart);
    let best = null;
    for (let k = 0; k < words.length; k++) {
        if (Number.isFinite(t0) && Math.abs(words[k].start - t0) > window) continue;
        if (tokens[k] !== q[0] && tokens[k + 1] !== q[0] && tokens[k] !== q[1]) continue;
        const lo = Math.max(1, q.length - 3), hi = q.length + 3;
        for (let len = lo; len <= hi && k + len <= words.length; len++) {
            const span = tokens.slice(k, k + len);
            const common = lcs(q, span);
            const score = common / Math.max(q.length, len);
            const dist = Number.isFinite(t0) ? Math.abs(words[k].start - t0) : 0;
            if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && dist < best.dist)) {
                best = { from: k, to: k + len - 1, score, dist };
            }
        }
    }
    if (!best || best.score < minScore) return null;
    return { from: best.from, to: best.to, score: best.score };
}

/**
 * Turn the AI's groups into word-accurate cuts.
 * @returns {{ cuts: [{start,end}], groups: [...], rejected: [...] }}
 */
function groupsToCuts(words, rawGroups, duration) {
    const tokens = words.map(w => norm(w.word));
    const cuts = [];
    const groups = [];
    const rejected = [];
    for (const g of Array.isArray(rawGroups) ? rawGroups : []) {
        const attempts = (Array.isArray(g?.attempts) ? g.attempts : [])
            .map((a, idx) => ({ idx, ...alignQuote(words, tokens, a?.text, a?.start) }))
            .filter(a => Number.isInteger(a.from));
        const keepIdx = Number(g?.keep);
        const kept = attempts.find(a => a.idx === keepIdx);
        if (!kept || attempts.length < 2) { rejected.push({ summary: g?.summary, why: 'attempts not found in transcript' }); continue; }
        attempts.sort((a, b) => a.from - b.from);
        // Overlapping attempts mean a misaligned quote: keep the earliest.
        const clean = [];
        for (const a of attempts) if (!clean.length || a.from > clean[clean.length - 1].to) clean.push(a);
        if (!clean.includes(kept)) { rejected.push({ summary: g?.summary, why: 'kept take overlaps another attempt' }); continue; }
        const span = words[clean[clean.length - 1].to].end - words[clean[0].from].start;
        if (span > MAX_GROUP_SPAN_SEC) { rejected.push({ summary: g?.summary, why: 'group spans too long' }); continue; }

        const groupCuts = [];
        clean.forEach((a, n) => {
            if (a === kept) return;
            const next = clean[n + 1];
            const start = words[a.from].start;
            // Up to the next attempt (removes the hesitation between takes),
            // but never into the kept take.
            const end = next ? words[next.from].start : words[a.to].end;
            if (end - start > MAX_CUT_SEC || end <= start) return;
            if (start < words[kept.to].end && end > words[kept.from].start) return;
            groupCuts.push({ start, end, text: words.slice(a.from, a.to + 1).map(w => w.word).join(' ') });
        });
        if (!groupCuts.length) { rejected.push({ summary: g?.summary, why: 'no safe cut' }); continue; }
        cuts.push(...groupCuts);
        groups.push({
            summary: String(g?.summary || '').slice(0, 160),
            reason: String(g?.reason || '').slice(0, 200),
            takes: clean.length,
            keptTake: clean.indexOf(kept) + 1,
            kept: { start: words[kept.from].start, end: words[kept.to].end, text: words.slice(kept.from, kept.to + 1).map(w => w.word).join(' ') },
            removed: groupCuts,
        });
    }
    // A cut may never touch ANY group's kept take.
    const keptSpans = groups.map(g => g.kept);
    const safe = cuts.filter(c => !keptSpans.some(k => c.start < k.end - 0.01 && c.end > k.start + 0.01));
    if (safe.length !== cuts.length) rejected.push({ why: `${cuts.length - safe.length} cut(s) overlapped a kept take` });
    cuts.length = 0; cuts.push(...safe);

    // Merge overlaps, then the global guard.
    cuts.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const c of cuts) {
        const last = merged[merged.length - 1];
        if (last && c.start <= last.end + 0.01) last.end = Math.max(last.end, c.end);
        else merged.push({ start: c.start, end: c.end });
    }
    const total = merged.reduce((s, c) => s + (c.end - c.start), 0);
    if (duration > 0 && total > duration * MAX_TOTAL_CUT_RATIO) {
        return { cuts: [], groups: [], rejected: [...rejected, { why: `would remove ${Math.round(total)}s of ${Math.round(duration)}s, refused` }] };
    }
    return { cuts: merged, groups, rejected };
}

/** No-AI fallback: exact restarts only (3+ identical words said again within 40 s). */
function fallbackGroups(words) {
    const restarts = findRestarts(words, { minRun: 3, maxGap: 40 });
    // Chain restarts of the same opening: i → j → k … ; keep the last.
    const groups = [];
    const used = new Set();
    for (const r of restarts) {
        if (used.has(r.i)) continue;
        const chain = [r.i];
        let cur = r;
        while (cur) {
            chain.push(cur.j);
            used.add(cur.i);
            cur = restarts.find(x => x.i === cur.j && x.n >= 3);
        }
        groups.push({
            summary: words.slice(r.i, r.i + r.n).map(w => w.word).join(' '),
            attempts: chain.map((wi, n) => {
                let to;
                if (n < chain.length - 1) to = chain[n + 1];
                else { // kept take: up to the end of its sentence (max 40 words)
                    to = wi + r.n;
                    while (to < words.length && to < wi + 40 && !SENTENCE_END.test(words[to - 1].word)) to++;
                }
                return { start: words[wi].start, text: words.slice(wi, to).map(w => w.word).join(' ') };
            }),
            keep: chain.length - 1,
            reason: 'Exact repeat (no AI available): kept the last take',
        });
    }
    return groups;
}

/** Inverse of the cuts over [0, duration], with a tiny edge pad. */
function activeSegmentsFromCuts(cuts, duration) {
    const segs = [];
    let cursor = 0;
    for (const c of cuts) {
        if (c.start > cursor + 0.01) {
            const s = Math.max(0, cursor === 0 ? 0 : cursor - EDGE_PAD);
            const e = Math.min(duration, c.start + EDGE_PAD);
            segs.push({ start: s, end: e, duration: e - s });
        }
        cursor = Math.max(cursor, c.end);
    }
    if (cursor < duration - 0.01) {
        const s = Math.max(0, cursor - EDGE_PAD);
        segs.push({ start: s, end: duration, duration: duration - s });
    }
    return segs;
}

function parseJson(text) {
    if (text && typeof text === 'object') return text;
    const s = String(text || '');
    try { return JSON.parse(s); } catch { /* try the first {...} block */ }
    const m = s.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
    return null;
}

/**
 * @param {Array} words source-time words of ONE video
 * @param {{ complete?: (prompt) => Promise<string|object>, duration?: number, language?: string, chunkWords?: number }} opts
 */
async function detectRetakes(words, opts = {}) {
    const w = cleanWords(words);
    const duration = Number(opts.duration) > 0 ? Number(opts.duration) : (w[w.length - 1]?.end || 0);
    if (w.length < 4) return { method: 'none', groups: [], cuts: [], activeSegments: [{ start: 0, end: duration, duration }], rejected: [] };

    let rawGroups = [];
    let method = 'fallback-exact';
    if (typeof opts.complete === 'function') {
        try {
            // Long videos: overlapping chunks so a group is never split.
            const size = opts.chunkWords || 700;
            const overlap = 120;
            for (let from = 0; from < w.length; from += size - overlap) {
                const chunk = w.slice(from, from + size);
                const reply = parseJson(await opts.complete(buildPrompt(chunk, { language: opts.language })));
                if (!reply || !Array.isArray(reply.groups)) throw new Error('AI reply was not valid JSON');
                rawGroups.push(...reply.groups);
                if (from + size >= w.length) break;
            }
            method = 'ai';
        } catch (err) {
            rawGroups = fallbackGroups(w);
            method = `fallback-exact (${String(err.message || err).slice(0, 80)})`;
        }
    } else {
        rawGroups = fallbackGroups(w);
    }

    // Chunk overlap can report one group twice: dedupe on the kept attempt time.
    const seen = new Set();
    rawGroups = rawGroups.filter(g => {
        const k = g?.attempts?.[g.keep]?.start;
        const key = Number.isFinite(Number(k)) ? Number(k).toFixed(1) : JSON.stringify(g?.attempts || []);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const { cuts, groups, rejected } = groupsToCuts(w, rawGroups, duration);
    return { method, groups, cuts, activeSegments: activeSegmentsFromCuts(cuts, duration), rejected };
}

module.exports = {
    detectRetakes,
    // exported for tests
    norm, cleanWords, buildLines, findRestarts, buildPrompt, alignQuote, groupsToCuts, fallbackGroups, activeSegmentsFromCuts, parseJson,
};
