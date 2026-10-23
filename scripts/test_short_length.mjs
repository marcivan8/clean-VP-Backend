// scripts/test_short_length.mjs
//
// R106 — shorts run a minute at minimum, and longer when the content earns it.
//
// What this replaces: slot ranges taken straight off
// `PLATFORM_PROFILES[].length`, which produced windows of roughly 12-45 s
// whatever was being said. Those numbers were attention-span guidance for
// hand-editing, not platform limits — TikTok accepts an hour, Reels and
// Shorts accept three minutes — so the edit was constrained by an editorial
// guess that nothing enforced, and a dense three-payoff explanation was cut
// to the same length as a one-line joke.
//
// The checks below are mostly about the EDGES, because that is where a
// minimum does damage: a source shorter than the floor, a user who asked for
// a specific length, and a count that no longer fits.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const log = console.log;
let failures = 0;
function check(name, fn) {
    try { fn(); log(`  ✓ ${name}`); }
    catch (err) { failures += 1; log(`  ✗ ${name}\n      ${err.message}`); }
}

const SL = await import('../client/src/agent/shortLength.js');
const PP = await import('../client/src/agent/PlatformProfiles.js');
const PICK = await import('../client/src/agent/shortPicker.js');

const { MIN_SHORT_SECONDS, planShortLength, fitShortCount } = SL;

/** `n` evenly spaced words across `span` seconds. */
const words = (n, span) => Array.from({ length: n }, (_, i) => ({ word: `w${i}`, start: i * (span / n), end: i * (span / n) + 0.18 }));
/** `n` REVEAL events spread across `total`. */
const reveals = (n, total) => Array.from({ length: n }, (_, i) => ({ eventType: 'REVEAL', timelineTime: (i + 1) * (total / (n + 1)) }));

log('\n── 1. The floor holds, on every platform ──');

check('a minute is the minimum wherever the short is going', () => {
    for (const platform of PP.PLATFORM_IDS) {
        for (const style of [null, 'reel', 'vlog', 'talking_head', 'interview', 'podcast']) {
            const p = planShortLength({ platform, totalDuration: 900, words: words(1800, 900), events: reveals(6, 900), style });
            assert.ok(p.min >= MIN_SHORT_SECONDS, `${platform}/${style}: min is ${p.min}`);
            assert.ok(p.target >= MIN_SHORT_SECONDS, `${platform}/${style}: target is ${p.target}`);
            assert.ok(p.max >= p.target, `${platform}/${style}: max ${p.max} is under target ${p.target}`);
        }
    }
});

check('even the tightest style and emptiest content clears the floor', () => {
    // Reel style, sparse delivery, no payoffs, barely-long-enough source: the
    // combination that most wants to collapse back to 30 s.
    const p = planShortLength({ platform: 'reels', totalDuration: 130, words: words(130, 130), events: [], style: 'reel' });
    assert.ok(p.target >= MIN_SHORT_SECONDS, `target fell to ${p.target}`);
    assert.ok(p.min >= MIN_SHORT_SECONDS);
});

log('\n── 2. A source shorter than the floor is handled honestly ──');

check('a 40 s video does not claim to produce a minute', () => {
    // The one case where the minimum cannot be kept. Silently shipping a 40 s
    // "minute" would be worse than saying so.
    const p = planShortLength({ platform: 'tiktok', totalDuration: 40, words: words(80, 40), events: [] });
    assert.equal(p.floored, true, 'a too-short source was not flagged');
    assert.ok(p.max <= 40, `max ${p.max} exceeds the source`);
    assert.ok(p.reasons.some(r => /only 40 s/.test(r)), `no reason given: ${JSON.stringify(p.reasons)}`);
});

check('nothing ever asks for more than the source contains', () => {
    for (const total of [12, 45, 61, 90, 200, 1200]) {
        const p = planShortLength({ platform: 'shorts', totalDuration: total, words: words(Math.max(10, total * 2), total), events: reveals(5, total), style: 'podcast' });
        assert.ok(p.max <= total, `${total}s source planned a ${p.max}s max`);
        assert.ok(p.target <= total, `${total}s source planned a ${p.target}s target`);
    }
});

check('garbage input degrades instead of throwing', () => {
    for (const bad of [{}, { totalDuration: null }, { totalDuration: -5 }, { totalDuration: 600, words: null, events: null }, { totalDuration: 600, platform: 'myspace' }]) {
        const p = planShortLength(bad);
        assert.ok(Number.isFinite(p.target) && Number.isFinite(p.min) && Number.isFinite(p.max), JSON.stringify(bad));
        assert.ok(p.max >= p.min, JSON.stringify(bad));
    }
});

log('\n── 3. Longer when the content earns it ──');

check('a dense podcast with payoffs runs far past the floor', () => {
    const p = planShortLength({ platform: 'tiktok', totalDuration: 1200, words: words(4000, 1200), events: reveals(40, 1200), style: 'podcast' });
    assert.ok(p.target > 120, `dense podcast only reached ${p.target}s`);
});

check('a sparse reel with nothing marked stays near the floor', () => {
    const p = planShortLength({ platform: 'reels', totalDuration: 180, words: words(300, 180), events: [], style: 'reel' });
    assert.ok(p.target < 90, `sparse reel stretched to ${p.target}s`);
});

check('density moves it: same source, faster delivery runs longer', () => {
    const base = { platform: 'tiktok', totalDuration: 900, events: reveals(8, 900), style: 'vlog' };
    const slow = planShortLength({ ...base, words: words(1350, 900) });   // 1.5 w/s
    const fast = planShortLength({ ...base, words: words(3600, 900) });   // 4.0 w/s
    assert.ok(fast.target > slow.target, `fast ${fast.target}s did not beat slow ${slow.target}s`);
});

check('payoffs move it: same delivery, more moments runs longer', () => {
    const base = { platform: 'tiktok', totalDuration: 900, words: words(2200, 900), style: 'vlog' };
    const bare = planShortLength({ ...base, events: [] });
    const rich = planShortLength({ ...base, events: reveals(30, 900) });
    assert.ok(rich.target > bare.target, `rich ${rich.target}s did not beat bare ${bare.target}s`);
});

check('style moves it: a podcast runs longer than a reel', () => {
    const base = { platform: 'tiktok', totalDuration: 900, words: words(2200, 900), events: reveals(10, 900) };
    const reel = planShortLength({ ...base, style: 'reel' });
    const pod = planShortLength({ ...base, style: 'podcast' });
    assert.ok(pod.target > reel.target, `podcast ${pod.target}s did not beat reel ${reel.target}s`);
});

check('source length moves it, holding density constant', () => {
    // Events and words have to SCALE with the duration here. Ten reveals is
    // four a minute in a 150 s source and a third of one in a 1800 s source,
    // so holding them fixed measures payoff density, not source length — the
    // first version of this check did exactly that and read backwards.
    const at = (total) => planShortLength({
        platform: 'tiktok',
        totalDuration: total,
        words: words(Math.round(total * 2.4), total),
        events: reveals(Math.max(1, Math.round(total / 90)), total),
        style: 'vlog',
    });
    const short = at(150);
    const long = at(1800);
    assert.ok(long.target > short.target, `long source ${long.target}s did not beat short ${short.target}s`);
});

check('it says why, in words a user can read', () => {
    const p = planShortLength({ platform: 'tiktok', totalDuration: 1200, words: words(4000, 1200), events: reveals(40, 1200), style: 'podcast' });
    assert.ok(p.reasons.length > 0, 'no reasoning returned');
    for (const r of p.reasons) {
        assert.equal(typeof r, 'string');
        assert.ok(!/score|factor|clamp|0\.\d/.test(r), `reason leaks internals: "${r}"`);
    }
});

log('\n── 4. The ceiling respects the platform ──');

check('nothing is planned past the platform ceiling', () => {
    for (const platform of PP.PLATFORM_IDS) {
        const sf = PP.PLATFORM_PROFILES[platform].shortForm;
        assert.ok(sf && sf.min === MIN_SHORT_SECONDS, `${platform} has no short-form floor`);
        const p = planShortLength({ platform, totalDuration: 7200, words: words(30000, 7200), events: reveals(400, 7200), style: 'podcast' });
        assert.ok(p.max <= sf.max, `${platform} planned ${p.max}s over its ${sf.max}s ceiling`);
    }
});

check('every ceiling leaves room under the real upload limit', () => {
    // The Pro Finish adds a hook title and a CTA outro on top of the window.
    // A short that is legal to upload but has no room for its own ending is
    // worse than one ten seconds shorter.
    for (const platform of PP.PLATFORM_IDS) {
        const p = PP.PLATFORM_PROFILES[platform];
        assert.ok(p.shortForm.max < p.uploadLimitSeconds,
            `${platform}: ceiling ${p.shortForm.max}s is not under the ${p.uploadLimitSeconds}s upload limit`);
    }
});

check('the Shorts panel no longer calls its own output too long', () => {
    // profileNotes is rendered in ShortsPanel. Judged against the old
    // attention-span range, every minute-plus short would have been labelled
    // a mistake the moment the floor moved.
    for (const platform of PP.PLATFORM_IDS) {
        const sf = PP.PLATFORM_PROFILES[platform].shortForm;
        const mid = Math.round((sf.min + sf.max) / 2);
        const notes = PP.profileNotes({ start: 0, end: mid }, PP.PLATFORM_PROFILES[platform], { hasCaptions: true });
        const lengthNote = notes.find(n => n.code === 'length' || n.code === 'too_long');
        assert.ok(lengthNote, `${platform}: no length note at all`);
        assert.equal(lengthNote.level, 'ok', `${platform}: a ${mid}s short is flagged "${lengthNote.level}" — ${lengthNote.text}`);
    }
});

log('\n── 5. Count follows length, not the other way round ──');

check('fewer shorts come back when each one is longer', () => {
    // Three two-minute shorts need six minutes of source. Promising three
    // from four used to come back as "2 more could not fit", which reads
    // like a failure rather than arithmetic.
    assert.equal(fitShortCount(90, 3), 1, '90 s cannot hold more than one minute-long short');
    assert.equal(fitShortCount(200, 3, 60), 3);
    assert.equal(fitShortCount(200, 3, 120), 1, 'a 120 s plan still promised three from 200 s');
    assert.equal(fitShortCount(1200, 3, 150), 3);
});

check('it never returns zero, and never more than asked', () => {
    for (const [total, want, per] of [[10, 5, 60], [0, 3, 60], [5000, 2, 60], [300, 9, 90]]) {
        const n = fitShortCount(total, want, per);
        assert.ok(n >= 1, `${total}/${want}/${per} returned ${n}`);
        assert.ok(n <= want, `${total}/${want}/${per} returned ${n}, more than the ${want} asked for`);
    }
});

log('\n── 6. Wired, and the user is told why ──');

check('the engine plans length before it decides how many', () => {
    const src = read('client/src/agent/MediaExecutionEngine.js');
    const planAt = src.indexOf('const sizing = planShortLength(');
    const countAt = src.indexOf('const count = fitShortCount(');
    assert.ok(planAt > 0, 'repurpose_shorts never plans a length');
    assert.ok(countAt > planAt, 'the count is decided before the length it depends on');
    assert.ok(!/length\.ideal/.test(src.slice(planAt - 2000, planAt)), 'the old attention-span range still builds slots');
});

check('the reasoning reaches the message', () => {
    const src = read('client/src/agent/MediaExecutionEngine.js');
    assert.match(src, /Lengths follow the content/, 'the new lengths are never explained');
    assert.match(src, /only \$\{count\} fit/, 'a reduced count is never explained');
    assert.match(src, /They are under a minute/, 'an undersized source is never explained');
});

check('an explicit "30 second short" still wins', () => {
    // A minimum the user cannot override is not a default.
    const planner = read('client/src/agent/EditPlanner.js');
    assert.match(planner, /explicit: Boolean\(m\)/, 'the planner does not carry an explicit length down');
    const engine = read('client/src/agent/MediaExecutionEngine.js');
    assert.match(engine, /const explicitLen = args\.explicit === true;/, 'extract_short ignores an explicit ask');
    assert.match(engine, /const floor = explicitLen \? 10 : MIN_SHORT_SECONDS;/, 'the floor is applied even to an explicit ask');
});

check('the picker still honours whatever range it is handed', () => {
    // shortLength decides; shortPicker obeys. This is the contract that lets
    // the floor move without touching the scoring.
    const w = words(900, 600).map((x, i) => ({ ...x, word: i % 9 === 8 ? 'end.' : 'word' }));
    const [got] = PICK.findShortCandidates(w, {
        events: reveals(10, 600),
        slots: [{ platform: 'tiktok', min: 60, max: 120, target: 90 }],
    });
    assert.ok(got, 'the picker found nothing in a 600 s transcript');
    const dur = got.end - got.start;
    assert.ok(dur >= 60 && dur <= 120, `picked a ${dur.toFixed(1)}s window outside the 60-120 range`);
});

log(failures === 0 ? '\n✅ short length: all checks passed\n' : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
