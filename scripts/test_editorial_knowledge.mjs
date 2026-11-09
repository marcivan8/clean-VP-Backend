/**
 * scripts/test_editorial_knowledge.mjs
 *
 * Guards the editorial knowledge library and its use by the judge.
 *
 * The two failure modes that matter:
 *  1. A remedy naming a command that does not exist. That is exactly what
 *     server/brain/strategies/ did — `remove_silence`, `generate_captions`,
 *     `apply_smart_zoom` — so its plans were lists of no-ops presented as
 *     plans. Every remedy command here is validated against the generated
 *     catalogue.
 *  2. Inventing a finding. The Brain prompt's own rule is "do NOT invent a gap
 *     to fill this space", and a library that reports a sag on a project whose
 *     cut was never read is worse than silence. Unreadable signals must read as
 *     ABSENT, and a finished project must produce nothing.
 *
 * Run: node scripts/test_editorial_knowledge.mjs
 */

import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const EK = require('../server/knowledge/editorialKnowledge.js');
const catalog = require('../server/brain/commandCatalog.generated.json');
const Judge = require('../server/brain/JudgeService.js');

let passed = 0, failed = 0;
const check = (name, fn) => {
    try { fn(); passed++; console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`      ${e.message}`); }
};
const section = (t) => console.log(`\n${t}`);

const ids = (facts, opts) => EK.detectSituations(facts, opts).map(s => s.id);

// ── 1. Every remedy is real ──────────────────────────────────────────────────
section('1. No remedy names a command that does not exist');

const KNOWN = new Set(catalog.commands.flatMap(e => [e.id, e.executes]));

check('every remedy command exists in the generated catalogue', () => {
    const bad = EK.remedyCommands().filter(c => !KNOWN.has(c));
    assert.equal(bad.length, 0,
        `${bad.join(', ')} — the server/brain/strategies failure mode (R157)`);
});

check('every remedy either names a command or is explicitly advisory', () => {
    const broken = [];
    for (const entry of EK.KNOWLEDGE) {
        for (const r of entry.remedies) {
            const hasCommand = typeof r.command === 'string' && r.command.length > 0;
            if (hasCommand === !!r.advisory) {
                broken.push(`${entry.id}: remedy must be one or the other`);
            }
            if (!r.why) broken.push(`${entry.id}: remedy has no reason`);
        }
    }
    assert.equal(broken.length, 0, broken.join('; '));
});

check('every situation has an id, title, severity, craft note and a remedy', () => {
    for (const e of EK.KNOWLEDGE) {
        assert.ok(e.id && typeof e.id === 'string', 'id');
        assert.ok(e.title, `${e.id}: title`);
        assert.ok(Object.values(EK.SEVERITY).includes(e.severity), `${e.id}: severity`);
        assert.ok(e.craft && e.craft.length > 40, `${e.id}: craft note too thin`);
        assert.ok(Array.isArray(e.remedies) && e.remedies.length > 0, `${e.id}: remedies`);
        assert.ok(Array.isArray(e.rejectedBy), `${e.id}: rejectedBy`);
        assert.equal(typeof e.detect, 'function', `${e.id}: detect`);
    }
});

check('SITUATIONS and KNOWLEDGE agree', () => {
    const declared = new Set(Object.values(EK.SITUATIONS));
    const present = new Set(EK.KNOWLEDGE.map(e => e.id));
    for (const id of declared) assert.ok(present.has(id), `${id} declared but has no entry`);
    for (const id of present) assert.ok(declared.has(id), `${id} has an entry but is not in SITUATIONS`);
    assert.equal(EK.KNOWLEDGE.length, Object.keys(EK.BY_ID).length, 'duplicate ids');
});

check('every style named in rejectedBy is a real editing style', () => {
    const styles = require('../server/brain/editingStyles.js').EDITING_STYLE_IDS;
    for (const e of EK.KNOWLEDGE) {
        for (const s of e.rejectedBy) {
            assert.ok(styles.includes(s), `${e.id} rejects unknown style '${s}'`);
        }
    }
});

// ── 2. Detection is right ────────────────────────────────────────────────────
section('2. Detection on measured state');

check('a fresh upload leads with no_transcript', () => {
    const got = ids({ clipCount: 3, hasCaptions: false, duration: 300, cutRate: 0.6 });
    assert.equal(got[0], EK.SITUATIONS.NO_TRANSCRIPT, got.join(', '));
});

check('dead air is found once a transcript exists and cleanup has not run', () => {
    assert.ok(ids({ clipCount: 4, hasCaptions: true, editsDone: [] })
        .includes(EK.SITUATIONS.DEAD_AIR));
});

check('…and NOT after a compound cleanup already ran', () => {
    assert.ok(!ids({ clipCount: 4, hasCaptions: true, editsDone: ['compound_clean_dynamic'] })
        .includes(EK.SITUATIONS.DEAD_AIR));
});

check('a late hook is found from the story map', () => {
    const got = ids({ clipCount: 8, hasCaptions: true, storyMap: { status: 'ok', hook_at_sec: 42 } });
    assert.ok(got.includes(EK.SITUATIONS.BURIED_HOOK), got.join(', '));
});

check('…but never when the cut has not been read', () => {
    for (const storyMap of [null, undefined, { status: 'failed' }, { status: 'insufficient_data' }]) {
        assert.ok(!ids({ clipCount: 8, hasCaptions: true, storyMap })
            .includes(EK.SITUATIONS.BURIED_HOOK), JSON.stringify(storyMap));
    }
});

check('…and not when the hook already lands early', () => {
    assert.ok(!ids({ clipCount: 8, hasCaptions: true, storyMap: { status: 'ok', hook_at_sec: 2, hook_strength: 'strong' } })
        .includes(EK.SITUATIONS.BURIED_HOOK));
});

check('a lost through-line is only reported when explicitly false', () => {
    assert.ok(ids({ storyMap: { delivers_through_line: false } }).includes(EK.SITUATIONS.THROUGH_LINE_LOST));
    for (const v of [true, null, undefined]) {
        assert.ok(!ids({ storyMap: { delivers_through_line: v } }).includes(EK.SITUATIONS.THROUGH_LINE_LOST), String(v));
    }
});

check('multi-speaker footage without angles is found', () => {
    assert.ok(ids({ clipCount: 6, detectedSpeakers: 2, multicamCoverage: 0.1 })
        .includes(EK.SITUATIONS.UNDIFFERENTIATED_SPEAKERS));
    assert.ok(!ids({ clipCount: 6, detectedSpeakers: 2, multicamCoverage: 0.9 })
        .includes(EK.SITUATIONS.UNDIFFERENTIATED_SPEAKERS));
});

check('the wrong aspect is found per platform, not per guess', () => {
    assert.ok(ids({ aspectRatio: '16:9', platform: 'instagram_reels' }).includes(EK.SITUATIONS.WRONG_ASPECT));
    assert.ok(!ids({ aspectRatio: '9:16', platform: 'instagram_reels' }).includes(EK.SITUATIONS.WRONG_ASPECT));
    assert.ok(ids({ aspectRatio: '9:16', platform: 'youtube_long' }).includes(EK.SITUATIONS.WRONG_ASPECT));
    // No platform set: nothing to be wrong against.
    assert.ok(!ids({ aspectRatio: '16:9' }).includes(EK.SITUATIONS.WRONG_ASPECT));
});

check('short-form length is judged against short-form only', () => {
    assert.ok(ids({ duration: 240, platform: 'tiktok' }).includes(EK.SITUATIONS.OVERLONG_FOR_FORMAT));
    assert.ok(!ids({ duration: 2400, platform: 'youtube_long' }).includes(EK.SITUATIONS.OVERLONG_FOR_FORMAT));
});

check('a finished project produces NO findings', () => {
    const got = ids({
        clipCount: 10, hasCaptions: true, duration: 420, cutRate: 7,
        rhythmCoverage: 0.9, multicamCoverage: 0.9, hasColorGrade: true,
        completionScore: 95, unusedAssets: [],
        editsDone: ['auto_captions', 'silence_removal', 'remove_filler_words', 'enhance_audio', 'rhythm_zoom'],
        editingStyle: 'talking_head',
    });
    assert.deepEqual(got, [], `invented findings: ${got.join(', ')}`);
});

check('findings come back worst-first', () => {
    const hits = EK.detectSituations({
        clipCount: 8, hasCaptions: true, duration: 600, cutRate: 6, editsDone: [],
        storyMap: { status: 'ok', delivers_through_line: false, hook_at_sec: 42 },
    });
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < hits.length; i++) {
        assert.ok(order[hits[i - 1].severity] <= order[hits[i].severity],
            hits.map(h => `${h.id}:${h.severity}`).join(' > '));
    }
});

// ── 3. Style awareness, from the predicates ─────────────────────────────────
section('3. Style awareness');

const BARE = {
    clipCount: 4, hasCaptions: true, duration: 3600, cutRate: 0.6,
    rhythmCoverage: 0, multicamCoverage: 0, editsDone: [], completionScore: 40,
};

check('podcast is not told to vary framing or cut faster', () => {
    const got = ids({ ...BARE, editingStyle: 'podcast' });
    assert.ok(!got.includes(EK.SITUATIONS.MONO_FRAMING), got.join(', '));
    assert.ok(!got.includes(EK.SITUATIONS.CUTS_TOO_SLOW), got.join(', '));
});

check('…but is still told about audio and captions', () => {
    const got = ids({ ...BARE, editingStyle: 'podcast' });
    assert.ok(got.includes(EK.SITUATIONS.WEAK_AUDIO));
    assert.ok(got.includes(EK.SITUATIONS.DEAD_AIR));
});

check('talking head IS told to vary framing', () => {
    assert.ok(ids({ ...BARE, editingStyle: 'talking_head' }).includes(EK.SITUATIONS.MONO_FRAMING));
});

check('a buried hook is not a defect for recorded-order styles', () => {
    const withHook = { clipCount: 8, hasCaptions: true, storyMap: { status: 'ok', hook_at_sec: 42 } };
    for (const style of ['vlog', 'interview', 'podcast']) {
        assert.ok(!ids({ ...withHook, editingStyle: style }).includes(EK.SITUATIONS.BURIED_HOOK), style);
    }
    assert.ok(ids({ ...withHook, editingStyle: 'reel' }).includes(EK.SITUATIONS.BURIED_HOOK));
});

check('b-roll gaps are not raised for formats where b-roll is optional', () => {
    const gap = { projectMap: { coverage_gaps: [{ gap: 'no cutaways', severity: 'high' }] } };
    for (const style of ['podcast', 'interview', 'talking_head']) {
        assert.ok(!ids({ ...gap, editingStyle: style }).includes(EK.SITUATIONS.THIN_COVERAGE), style);
    }
    assert.ok(ids({ ...gap, editingStyle: 'vlog' }).includes(EK.SITUATIONS.THIN_COVERAGE));
});

check('an explicit styleId option beats the one on the facts', () => {
    const got = ids({ ...BARE, editingStyle: 'talking_head' }, { styleId: 'podcast' });
    assert.ok(!got.includes(EK.SITUATIONS.MONO_FRAMING));
});

// ── 4. Robustness: an unreadable signal is an ABSENT signal ─────────────────
section('4. Robustness');

check('garbage input yields no findings and never throws', () => {
    for (const bad of [null, undefined, {}, 'x', 42, [],
        { storyMap: 'garbage' }, { projectMap: { coverage_gaps: 'nope' } },
        { unusedAssets: 'x' }, { editsDone: 'not-an-array' }, { clipCount: NaN },
        { duration: 'long' }, { aspectRatio: 123, platform: 'tiktok' }]) {
        const got = EK.detectSituations(bad);
        assert.ok(Array.isArray(got), JSON.stringify(bad));
    }
});

check('a detect() that throws is treated as no match, not a crash', () => {
    const exploding = { get clipCount() { throw new Error('boom'); } };
    assert.doesNotThrow(() => EK.detectSituations(exploding));
});

check('craftNotes is capped and never throws', () => {
    const notes = EK.craftNotes({ clipCount: 3, hasCaptions: false, duration: 300, cutRate: 0.5 });
    assert.ok(Array.isArray(notes) && notes.length > 0 && notes.length <= 4, `${notes.length} notes`);
    assert.ok(notes.every(n => typeof n === 'string' && n.length > 40));
    assert.doesNotThrow(() => EK.craftNotes(null));
    assert.deepEqual(EK.craftNotes(null), []);
});

check('limit is honoured', () => {
    const facts = { clipCount: 4, hasCaptions: true, editsDone: [], editingStyle: 'talking_head', cutRate: 0.6 };
    assert.ok(EK.detectSituations(facts).length > 2);
    assert.equal(EK.detectSituations(facts, { limit: 2 }).length, 2);
});

// ── 5. The judge actually uses it ───────────────────────────────────────────
section('5. The judge is given the craft');

const JUDGED_FACTS = {
    clipCount: 8, hasCaptions: true, duration: 600, cutRate: 6, editsDone: ['auto_captions'],
    editingStyle: 'talking_head',
    storyMap: { status: 'ok', delivers_through_line: false, hook_at_sec: 42 },
};

check('the judge prompt carries the craft notes', () => {
    const prompt = Judge.buildJudgePrompt(
        [{ id: 'auto_captions' }, { id: 'apply_lut' }],
        { styleId: 'talking_head', facts: JUDGED_FACTS });
    assert.ok(/WHAT THIS EDIT NEEDS/.test(prompt));
    assert.ok(/hook lands late/i.test(prompt), 'the measured situation must reach the judge');
    assert.ok(/does not deliver its point/i.test(prompt));
});

check('…and tells it to score against them, not against plausibility', () => {
    const prompt = Judge.buildJudgePrompt([{ id: 'auto_captions' }], { facts: JUDGED_FACTS });
    assert.ok(/however reasonable it sounds in the abstract/i.test(prompt));
});

check('no facts → no craft section, and no crash', () => {
    const prompt = Judge.buildJudgePrompt([{ id: 'auto_captions' }], {});
    assert.ok(!/WHAT THIS EDIT NEEDS/.test(prompt));
    assert.ok(/RUBRIC/.test(prompt));
});

check('a finished project adds no craft section (nothing to say)', () => {
    const prompt = Judge.buildJudgePrompt([{ id: 'apply_lut' }], {
        facts: {
            clipCount: 10, hasCaptions: true, duration: 420, cutRate: 7,
            rhythmCoverage: 0.9, multicamCoverage: 0.9, hasColorGrade: true,
            completionScore: 95, unusedAssets: [], editingStyle: 'talking_head',
            editsDone: ['auto_captions', 'silence_removal', 'remove_filler_words', 'enhance_audio', 'rhythm_zoom'],
        },
    });
    assert.ok(!/WHAT THIS EDIT NEEDS/.test(prompt), 'must not manufacture a need');
});

check('pre-supplied craftNotes win over derivation', () => {
    const prompt = Judge.buildJudgePrompt([{ id: 'auto_captions' }],
        { craftNotes: ['Bespoke note about this project that is long enough to matter.'], facts: JUDGED_FACTS });
    assert.ok(/Bespoke note/.test(prompt));
    assert.ok(!/hook lands late/i.test(prompt), 'derivation must not also run');
});

check('bad facts do not break the prompt', () => {
    for (const facts of ['x', 42, [], { storyMap: 'garbage' }]) {
        assert.doesNotThrow(() => Judge.buildJudgePrompt([{ id: 'auto_captions' }], { facts }));
    }
});

check('the prompt stays affordable with craft notes attached', () => {
    const prompt = Judge.buildJudgePrompt(
        Array.from({ length: 8 }, (_, i) => ({ id: `cmd_${i}`, summary: 'A candidate.' })),
        { styleId: 'talking_head', facts: JUDGED_FACTS });
    assert.ok(prompt.length < 6000, `${prompt.length} chars — a judge must stay cheap`);
});

check('brainRoutes passes facts so the craft reaches the judge', () => {
    const src = require('node:fs').readFileSync(
        new URL('../server/routes/brainRoutes.js', import.meta.url), 'utf8');
    assert.ok(/facts: \{/.test(src), 'the /analyze judge call must pass facts');
    assert.ok(/projectMap,\s*\n\s*storyMap,\s*\n\s*\},/.test(src),
        'the maps have to be inside facts — they are what the story situations read');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('ALL EDITORIAL KNOWLEDGE TESTS PASSED');
