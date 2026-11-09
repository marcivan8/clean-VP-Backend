/**
 * scripts/test_short_picking.mjs
 *
 * Pins short SELECTION QUALITY — which moment gets picked — not just the
 * mechanics of the window.
 *
 * The existing suites cover mechanics well (sentence alignment, no connector
 * opener, duration inside the slot, non-overlapping, a slot skipped rather
 * than forced) and there is one pick assertion in test_editing_styles.mjs
 * ("picks the hook window with the events"). What nothing covered, and what
 * R158 found by measurement:
 *
 *  1. THE STRAY-PEAK HIJACK. A bare audio peak near a window start was worth
 *     +4 while an explicit verbal hook was worth +1, so a single
 *     EMPHASIS_MOMENT in a video's outro scored 4.50 and took the pick off a
 *     verbally-hooked passage scoring 3.42. A cough could choose the short.
 *  2. NO QUALITY FLOOR. findShortCandidates returned the best non-overlapping
 *     window per slot however bad it was: a talk with one strong passage still
 *     produced three shorts, at 13.37, 2.41 and 2.39, all presented alike.
 *  3. The no-events path was never tested at all, although it is the common
 *     case whenever waveform peaks or placed captions are missing.
 *
 * Fixtures are synthetic but realistic: ~2.6 words/s, sentence-punctuated,
 * with one section that is obviously the money moment. shortPicker.js is pure
 * with no imports, so this needs no harness.
 *
 * Run: node scripts/test_short_picking.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const P = await import('../client/src/agent/shortPicker.js');

let passed = 0, failed = 0;
const check = (name, fn) => {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`      ${e.message}`); }
};
const section = (t) => console.log(`\n${t}`);

// ── fixture ──────────────────────────────────────────────────────────────────
const FILLER = 'we also looked at the numbers again last quarter and they were broadly similar'.split(' ');

/** Build a transcript from labelled sections, tracking where each one sits. */
function talk(spec) {
    let t = 0;
    const words = [];
    const sections = {};
    const say = (sentence) => {
        for (const tok of sentence.split(' ')) { words.push({ word: tok, start: t, end: t + 0.30 }); t += 0.38; }
        t += 0.85;
    };
    for (const sec of spec) {
        const start = t;
        say(sec.opener);
        for (let i = 0; i < (sec.body ?? 7); i++) say(FILLER.slice(0, 7 + (i % 4)).join(' ') + '.');
        sections[sec.label] = { start, end: t };
    }
    return { words, sections, duration: t };
}

const GOLD_OPENER = "Here's the secret nobody tells you about pricing your work.";

const ONE_GOOD_MOMENT = talk([
    { label: 'intro',  opener: 'Okay so today I want to talk about pricing.' },
    { label: 'setup',  opener: 'And you know a lot of people ask me about this.' },
    { label: 'GOLD',   opener: GOLD_OPENER },
    { label: 'tangent', opener: 'And then we can talk about the details later.' },
    { label: 'outro',  opener: 'So in conclusion that is roughly all I had.' },
]);

const spans = (fix, win) => Object.entries(fix.sections)
    .filter(([, s]) => s.start < win.end && s.end > win.start).map(([k]) => k);
const opensOn = (fix, win, label) => {
    const s = fix.sections[label];
    return win.start <= s.start + 2 && win.end >= s.start + 10;
};

// ── 1. The stray-peak hijack must not recur ──────────────────────────────────
section('1. A bare audio peak cannot steal the pick');

const outroPeak = (fix) => [{ eventType: 'EMPHASIS_MOMENT', timelineTime: fix.sections.outro.start + 2 }];
const goldReveal = (fix) => [{ eventType: 'REVEAL', timelineTime: fix.sections.GOLD.start + 1 }];

check('with no events at all, the verbally-hooked passage wins', () => {
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: [], target: 60, min: 15, max: 60 });
    assert.ok(w, 'a window was found');
    assert.ok(opensOn(ONE_GOOD_MOMENT, w, 'GOLD'),
        `picked ${w.start.toFixed(0)}-${w.end.toFixed(0)}s [${spans(ONE_GOOD_MOMENT, w)}] — "${w.text.slice(0, 50)}"`);
});

check('one stray EMPHASIS in the outro does NOT move the pick (the R158 bug)', () => {
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words,
        { events: outroPeak(ONE_GOOD_MOMENT), target: 60, min: 15, max: 60 });
    assert.ok(opensOn(ONE_GOOD_MOMENT, w, 'GOLD'),
        `a loud noise in the outro chose the short: ${w.start.toFixed(0)}-${w.end.toFixed(0)}s [${spans(ONE_GOOD_MOMENT, w)}]`);
});

check('…even with three stray peaks clustered in the outro', () => {
    const base = ONE_GOOD_MOMENT.sections.outro.start;
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words, {
        events: [1, 3, 5].map(d => ({ eventType: 'EMPHASIS_MOMENT', timelineTime: base + d })),
        target: 60, min: 15, max: 60,
    });
    assert.ok(opensOn(ONE_GOOD_MOMENT, w, 'GOLD'),
        `picked [${spans(ONE_GOOD_MOMENT, w)}] — the event cap should stop a peak cluster running away`);
});

check('a REVEAL on the gold moment reinforces rather than changes the pick', () => {
    const plain = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: [], target: 60, min: 15, max: 60 });
    const withEv = P.findBestShortWindow(ONE_GOOD_MOMENT.words,
        { events: goldReveal(ONE_GOOD_MOMENT), target: 60, min: 15, max: 60 });
    assert.equal(withEv.start, plain.start, 'the window should be the same one');
    assert.ok(withEv.score > plain.score, 'but scored higher');
});

check('a REVEAL still beats a passage with no signal at all', () => {
    // Same talk, but the gold opener is plain so only the event distinguishes it.
    const flat = talk([
        { label: 'a', opener: 'Okay so today I want to talk about pricing.' },
        { label: 'b', opener: 'And you know a lot of people ask me about this.' },
        { label: 'TARGET', opener: 'The numbers moved quite a lot this year.' },
        { label: 'c', opener: 'And then we can talk about the details later.' },
    ]);
    const w = P.findBestShortWindow(flat.words, {
        events: [{ eventType: 'REVEAL', timelineTime: flat.sections.TARGET.start + 1 }],
        target: 60, min: 15, max: 60,
    });
    assert.ok(opensOn(flat, w, 'TARGET'), `picked [${spans(flat, w)}]`);
});

// ── 2. The weights, stated as behaviour ──────────────────────────────────────
section('2. Weighting');

check('EMPHASIS is worth less than REVEAL or PUNCHLINE', () => {
    const at = (type, label) => P.findBestShortWindow(ONE_GOOD_MOMENT.words, {
        events: [{ eventType: type, timelineTime: ONE_GOOD_MOMENT.sections[label].start + 1 }],
        target: 60, min: 15, max: 60,
    }).score;
    const emph = at('EMPHASIS_MOMENT', 'GOLD');
    const rev = at('REVEAL', 'GOLD');
    const punch = at('PUNCHLINE_DETECTED', 'GOLD');
    assert.ok(rev > emph, `REVEAL ${rev} must beat EMPHASIS ${emph}`);
    assert.ok(punch > emph, `PUNCHLINE ${punch} must beat EMPHASIS ${emph}`);
});

check('the event contribution is capped', () => {
    const base = ONE_GOOD_MOMENT.sections.GOLD.start;
    const many = Array.from({ length: 12 }, (_, i) => ({ eventType: 'REVEAL', timelineTime: base + 2 + i }));
    const few = [{ eventType: 'REVEAL', timelineTime: base + 2 }, { eventType: 'REVEAL', timelineTime: base + 4 }];
    const s12 = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: many, target: 60, min: 15, max: 60 }).score;
    const s2 = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: few, target: 60, min: 15, max: 60 }).score;
    assert.ok(s12 - s2 < 2, `12 events scored ${s12} vs 2 events ${s2} — the cap is not holding`);
});

check('a verbal hook is reported as a hook even with no detected event', () => {
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: [], target: 60, min: 15, max: 60 });
    assert.equal(w.hookEvent, 'VERBAL_HOOK',
        'the panel reads hookEvent to decide "Opens on a key moment" vs "No strong moment"');
});

check('a detected event still wins the hookEvent label over the verbal one', () => {
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words,
        { events: goldReveal(ONE_GOOD_MOMENT), target: 60, min: 15, max: 60 });
    assert.equal(w.hookEvent, 'REVEAL');
});

check('a plain passage with nothing in it reports no hook', () => {
    const flat = talk([
        { label: 'a', opener: 'The numbers moved quite a lot this year.' },
        { label: 'b', opener: 'We reviewed them again the following month.' },
    ]);
    const w = P.findBestShortWindow(flat.words, { events: [], target: 40, min: 15, max: 40 });
    assert.equal(w.hookEvent, null);
});

// ── 3. The quality floor ─────────────────────────────────────────────────────
section('3. The quality floor');

const SLOTS = [
    { platform: 'tiktok', min: 21, max: 60, target: 34 },
    { platform: 'reels', min: 15, max: 60, target: 30 },
    { platform: 'shorts', min: 30, max: 60, target: 50 },
];

check('a talk with ONE strong moment yields ONE short, not three', () => {
    const report = {};
    const picks = P.findShortCandidates(ONE_GOOD_MOMENT.words, { events: [], slots: SLOTS, report });
    assert.equal(picks.length, 1, `got ${picks.length}: ${picks.map(p => p.score.toFixed(2)).join(', ')}`);
    assert.equal(report.belowFloor.length, 2, 'the two filler slots must be reported, not silently dropped');
    assert.ok(report.belowFloor.every(b => b.score < P.MIN_WINDOW_SCORE));
});

check('…and the one it keeps is the gold moment', () => {
    const [pick] = P.findShortCandidates(ONE_GOOD_MOMENT.words, { events: [], slots: SLOTS });
    assert.ok(opensOn(ONE_GOOD_MOMENT, pick, 'GOLD'), `[${spans(ONE_GOOD_MOMENT, pick)}]`);
});

check('the floor is above what pacing and length alone can earn', () => {
    // density maxes at 2.0, length fit at 1.0 → 3.0 is the signal-free ceiling.
    assert.ok(P.MIN_WINDOW_SCORE > 3.0,
        `${P.MIN_WINDOW_SCORE} must exceed 3.0 or filler can pass on pacing alone`);
    assert.ok(P.MIN_WINDOW_SCORE <= 4.0, `${P.MIN_WINDOW_SCORE} is high enough to reject real picks`);
});

check('scoreFloor: 0 restores the old fill-every-slot behaviour', () => {
    const picks = P.findShortCandidates(ONE_GOOD_MOMENT.words, { events: [], slots: SLOTS, scoreFloor: 0 });
    assert.equal(picks.length, 3, 'an explicit 0 must opt out of the floor');
});

check('a talk with several strong moments fills several slots', () => {
    const rich = talk([
        { label: 'a', opener: GOLD_OPENER, body: 5 },
        { label: 'b', opener: 'But why does this actually matter for your business?', body: 5 },
        { label: 'c', opener: 'How do you actually price a project then?', body: 5 },
        { label: 'd', opener: 'Here is the truth about discounting your rate.', body: 5 },
    ]);
    const picks = P.findShortCandidates(rich.words, { events: [], slots: SLOTS });
    assert.ok(picks.length >= 2, `only ${picks.length} of 3 slots filled on a talk with four hooks`);
});

check('a window rejected on quality does not block a later slot from that stretch', () => {
    // The rejected window must not enter `taken`.
    const report = {};
    P.findShortCandidates(ONE_GOOD_MOMENT.words, { events: [], slots: SLOTS, report });
    assert.equal(report.floor, P.MIN_WINDOW_SCORE);
    const wide = P.findShortCandidates(ONE_GOOD_MOMENT.words, {
        events: [], slots: [{ platform: 'tiktok', min: 21, max: 60, target: 34 }], scoreFloor: 0,
    });
    assert.equal(wide.length, 1);
});

check('the report distinguishes "no window fitted" from "below the floor"', () => {
    const report = {};
    // A 40 s talk cannot fit two 55 s slots.
    const tiny = talk([{ label: 'a', opener: GOLD_OPENER, body: 2 }]);
    P.findShortCandidates(tiny.words, {
        events: [], report,
        slots: [{ platform: 'tiktok', min: 55, max: 60, target: 58 }, { platform: 'reels', min: 55, max: 60, target: 58 }],
    });
    assert.ok(report.noWindow.length >= 1, 'a slot that cannot fit belongs in noWindow');
    assert.equal(report.belowFloor.length, 0, 'and not in belowFloor');
});

check('report is optional — omitting it changes nothing', () => {
    assert.doesNotThrow(() => P.findShortCandidates(ONE_GOOD_MOMENT.words, { events: [], slots: SLOTS }));
});

// ── 4. The single-short path stays unfloored, but discloses ─────────────────
section('4. extract_short acts on a weak pick, and says so');

check('findBestShortWindow still returns a weak window (it cuts on request)', () => {
    const flat = talk([
        { label: 'a', opener: 'The numbers moved quite a lot this year.' },
        { label: 'b', opener: 'We reviewed them again the following month.' },
        { label: 'c', opener: 'That was broadly the end of the review.' },
    ]);
    const w = P.findBestShortWindow(flat.words, { events: [], target: 60, min: 15, max: 60 });
    assert.ok(w, 'an explicit request must not be refused for scoring poorly');
    assert.ok(w.score < P.MIN_WINDOW_SCORE, `score ${w.score} should be under the floor for this fixture`);
});

check('the handler discloses a weak pick and missing moment detection', () => {
    const src = readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');
    // R159 made this the WORSE of the two scores (the heuristic's own and the
    // judge-blended one), so a passage doubted by either is disclosed and
    // neither can hide the other.
    assert.ok(/weakScore < MIN_WINDOW_SCORE/.test(src), 'extract_short must compare against the floor');
    assert.ok(/const weakScore = Math\.min\(/.test(src), 'the weaker of the two scores must decide');
    assert.ok(/best available passage rather than a clear highlight/.test(src));
    assert.ok(/Moment detection (timed out|was unavailable)/.test(src));
});

check('repurpose_shorts discloses skipped slots and missing detection', () => {
    const src = readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');
    assert.ok(/report: pickReport/.test(src), 'the picker report must be requested');
    assert.ok(/no remaining passage was strong enough/.test(src));
    assert.ok(/picked from the words and pacing alone/.test(src));
    assert.ok(/skippedForQuality/.test(src), 'details should carry the count for callers');
});

check('_fetchSemanticEvents records WHY it came back empty', () => {
    const src = readFileSync(new URL('../client/src/agent/MediaExecutionEngine.js', import.meta.url), 'utf8');
    assert.ok(/_lastEventFetch = \{ ok: true/.test(src), 'a real empty answer must be distinguishable');
    assert.ok(/reason: err\?\.name === 'AbortError' \? 'timeout'/.test(src), 'a timeout must be named');
    assert.ok(/http_\$\{res\.status\}/.test(src));
});

// ── 5. Polish layers (R158: captions + camera) ───────────────────────────────
section('5. Polish defaults: captions + camera only');

const polishSrc = readFileSync(new URL('../client/src/agent/shortPolish.js', import.meta.url), 'utf8');

check('the default layer set is captions + camera, nothing else', () => {
    const block = polishSrc.slice(polishSrc.indexOf('const want = {'), polishSrc.indexOf('...(opts.layers || {})'));
    for (const [layer, expected] of [['title', 'false'], ['cta', 'false'], ['captions', 'true'],
        ['camera', 'true'], ['numbers', 'false'], ['graphics', 'false'], ['cuts', 'false']]) {
        assert.ok(new RegExp(`${layer}:\\s*${expected}`).test(block), `${layer} should default to ${expected}`);
    }
});

check('opts.layers still overrides, so nothing is unreachable', () => {
    assert.ok(/\.\.\.\(opts\.layers \|\| \{\}\)/.test(polishSrc),
        'the spread must come last so a caller can switch any layer back on');
});

check('the CTA has its own flag, no longer riding on want.title', () => {
    assert.ok(/if \(want\.cta && ctaBeat\)/.test(polishSrc));
    assert.ok(!/if \(want\.title && ctaBeat\)/.test(polishSrc), 'the old coupling must be gone');
});

check('body graphics have their own flag, so turning off the title keeps them available', () => {
    assert.ok(/want\.graphics \? addAutoStoryboard/.test(polishSrc));
    assert.ok(!/want\.title \? addAutoStoryboard/.test(polishSrc));
    assert.ok(!/!storyboardGraphics && want\.title && Array\.isArray/.test(polishSrc),
        'the timed-moment scenes must not be gated on the title either');
});

check('want.title still drives the LAYOUT offsets (that coupling is correct)', () => {
    assert.ok(/hookDurForCaptions = want\.title \? hookSpan : 0/.test(polishSrc),
        'with no title the captions should start at 0, which is a real layout question');
});

check('the hook-title and CTA code is still present, just off', () => {
    assert.ok(/composeComponentScene/.test(polishSrc), 'the scene engine wiring must survive');
    assert.ok(/CTA outro/.test(polishSrc));
    assert.ok(polishSrc.length > 80_000, 'nothing should have been deleted wholesale');
});

check('the polish-OFF path names every layer, including the new ones', () => {
    const fin = readFileSync(new URL('../client/src/agent/shortFinisher.js', import.meta.url), 'utf8');
    const block = fin.slice(fin.indexOf('const layers = wantsPolish'), fin.indexOf('const polished = polishShort'));
    for (const layer of ['title', 'cta', 'captions', 'camera', 'numbers', 'graphics', 'cuts']) {
        assert.ok(new RegExp(`${layer}: false`).test(block), `${layer} missing from the polish-off set`);
    }
});

check("polish_short's registry summary no longer promises a hook title", () => {
    const reg = readFileSync(new URL('../client/src/agent/CommandRegistry.js', import.meta.url), 'utf8');
    const entry = reg.slice(reg.indexOf("id: 'polish_short'"), reg.indexOf("id: 'polish_short'") + 700);
    assert.ok(!/AI hook title with motion/.test(entry), 'the summary must match what it now does');
    assert.ok(/captions/i.test(entry));
});

// ── 6. Regressions in the mechanics that already worked ──────────────────────
section('6. The mechanics that already worked still do');

check('a window still starts and ends on a sentence boundary', () => {
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: [], target: 60, min: 15, max: 60 });
    const starts = new Set(ONE_GOOD_MOMENT.words.map(x => x.start));
    const ends = new Set(ONE_GOOD_MOMENT.words.map(x => x.end));
    assert.ok(starts.has(w.start), 'start is on a word boundary');
    assert.ok(ends.has(w.end), 'end is on a word boundary');
});

check('a connector opener is still penalised', () => {
    const w = P.findBestShortWindow(ONE_GOOD_MOMENT.words, { events: [], target: 30, min: 15, max: 30 });
    assert.ok(!/^(and|so|but)\b/i.test(w.text), w.text);
});

check('degenerate input still yields nothing rather than throwing', () => {
    assert.equal(P.findBestShortWindow([], {}), null);
    assert.equal(P.findBestShortWindow(null, {}), null);
    assert.deepEqual(P.findShortCandidates([], { slots: SLOTS }), []);
    assert.deepEqual(P.findShortCandidates(ONE_GOOD_MOMENT.words, { slots: [] }), []);
});

check('picks are still non-overlapping with a gap', () => {
    const rich = talk([
        { label: 'a', opener: GOLD_OPENER, body: 5 },
        { label: 'b', opener: 'But why does this actually matter for your business?', body: 5 },
        { label: 'c', opener: 'How do you actually price a project then?', body: 5 },
    ]);
    const picks = P.findShortCandidates(rich.words, { events: [], slots: SLOTS });
    for (let i = 0; i < picks.length; i++) {
        for (let j = i + 1; j < picks.length; j++) {
            assert.ok(picks[i].end + 2 <= picks[j].start || picks[j].end + 2 <= picks[i].start,
                `${picks[i].platform} and ${picks[j].platform} overlap`);
        }
    }
});

check('scoring is defined once, not duplicated per path', () => {
    const src = readFileSync(new URL('../client/src/agent/shortPicker.js', import.meta.url), 'utf8');
    // The six scoring terms were written out TWICE, once in findBestShortWindow
    // and once in bestWindowAvoiding, so a re-weighting could be applied to one
    // path and silently miss the other. There must now be exactly one place
    // that adds an event's weight, and one place that filters event types.
    assert.equal((src.match(/eventScore \+= EVENT_WEIGHT/g) || []).length, 1,
        'the event SCORING term must exist in exactly one place');
    // Exactly two, and both are correct: normalizeEvents() filters unknown
    // event types, scoreWindow() adds the weight. Three or more means a path
    // has grown its own copy of the scoring again.
    assert.equal((src.match(/EVENT_WEIGHT\[e\.type\]/g) || []).length, 2,
        'expected one filter site (normalizeEvents) and one scoring site (scoreWindow)');
    assert.equal((src.match(/function normalizeEvents\(/g) || []).length, 1);
    assert.equal((src.match(/HOOK_OPENERS\.test/g) || []).length, 1,
        'the verbal-hook term must exist in exactly one place');
    assert.ok(/function scoreWindow\(/.test(src) && /function normalizeEvents\(/.test(src));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('ALL SHORT PICKING TESTS PASSED');
