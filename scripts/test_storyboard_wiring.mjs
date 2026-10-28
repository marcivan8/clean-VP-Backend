// R112 round B: the storyboard actually REACHES the timeline.
// Round A shipped a planner nothing imported. These checks exist so that
// cannot happen again quietly: every link of the chain is asserted, from the
// typed sentence to the clips on the tracks.
// node scripts/test_storyboard_wiring.mjs
import assert from 'assert/strict';
import fs from 'fs';

const log = console.log;
let failures = 0;
const check = (name, fn) => {
    try { fn(); log(`  ok  ${name}`); } catch (e) { failures++; log(`  FAIL ${name}: ${e.message}`); }
};
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

const SB = await import('../client/src/motion/Storyboard.js');
const BR = await import('../client/src/motion/StoryboardBridge.js');
const { resolveCommand } = await import('../client/src/agent/CommandRegistry.js');

const say = (text, t0 = 0, step = 0.4) => text.split(' ').map((w, i) => ({
    word: w, start: +(t0 + i * step).toFixed(3), end: +(t0 + i * step + step * 0.85).toFixed(3),
}));
const WORDS = [
    ...say('So last year my revenue grew by forty percent.', 0),
    ...say('But the real reason is simple.', 8),
    ...say('First you record, second you upload, third you publish.', 16),
    ...say('I use Vibed every single day now.', 24),
    ...say('Want to try it? Link in bio.', 30),
];
const PLAN = SB.planStoryboard({ words: WORDS, cuts: [8.2, 16.1], duration: 36 });

log('\n-- 1. The chain exists, link by link --');

check('the command is registered and every phrasing reaches it', () => {
    for (const phrase of ['storyboard this video', 'illustrate what i say', 'illustre ce que je dis',
        'add graphics throughout', 'make it look like a premium creator video']) {
        const r = resolveCommand(phrase);
        assert.equal(r.match?.id, 'storyboard_video', `"${phrase}" went to ${r.match?.id}`);
        assert.equal(r.confidence, 'high', `"${phrase}" is ${r.confidence}`);
        assert.equal(r.ambiguous, false, `"${phrase}" is ambiguous`);
    }
});

check('the neighbouring commands were not stolen by the new phrases', () => {
    for (const [phrase, id] of [['design a scene', 'design_scene'], ['add a bar chart', 'add_template'],
        ['remove silences', 'silence_removal'], ['add captions', 'auto_captions']]) {
        assert.equal(resolveCommand(phrase).match?.id, id, `"${phrase}" was stolen`);
    }
});

check('all five files of the command path are touched (the vibed-codegen checklist)', () => {
    assert.ok(read('../client/src/agent/CommandRegistry.js').includes("id: 'storyboard_video'"), 'registry');
    assert.ok(read('../client/src/agent/EditPlanner.js').includes("case 'storyboard_video'"), 'planner');
    assert.ok(read('../client/src/agent/CommandCompiler.js').includes("['storyboard_video'"), 'compiler');
    assert.ok(read('../client/src/agent/MediaExecutionEngine.js').includes("case 'storyboard_video'"), 'engine');
    assert.ok(read('../client/src/store/useTimelineStore.js').includes('applyStoryboard:'), 'store');
});

check('the planner is IMPORTED, not merely present (what round A was missing)', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    assert.ok(/from '\.\.\/motion\/Storyboard\.js'/.test(store), 'the store does not import Storyboard');
    assert.ok(/from '\.\.\/motion\/StoryboardBridge\.js'/.test(store), 'the store does not import StoryboardBridge');
    assert.ok(read('../client/src/agent/MediaExecutionEngine.js').includes('vision/ShotSampler.js'), 'nothing imports ShotSampler');
});

// R116 - the Tools menu is no longer mounted (the composer's left button is
// Styles), so the ICON mapping it used has gone with it. The sentence still
// has to resolve to the command: that pairing is the expensive part and it is
// what rots silently if the menu is ever remounted.
check('its menu sentence still resolves to the command', () => {
    const tools = read('../client/src/components/Assistant/composerTools.js');
    assert.ok(tools.includes("command: 'storyboard_video'"), 'not in the Tools menu');
    const m = tools.match(/id: 'storyboard',\s*command: 'storyboard_video',\s*icon: '(\w+)',\s*prompt: '([^']+)'/);
    assert.ok(m, 'the storyboard tool entry is malformed');
    assert.equal(resolveCommand(m[2]).match?.id, 'storyboard_video', 'the menu prompt does not resolve to the command');
    assert.ok(m[1], 'the entry lost its icon name');
    for (const lang of ['en', 'fr']) {
        const a = JSON.parse(read(`../client/src/locales/${lang}/editor.json`)).assistant;
        assert.ok(a.tool?.storyboard, `${lang} tool.storyboard`);
    }
});

log('\n-- 2. The bridge: beats become placements the store can place --');

check('every beat of a real plan becomes a placement, none skipped', () => {
    const { placements, skipped } = BR.placementsFor(PLAN.beats, { kindPlan: SB.KIND_PLAN });
    assert.equal(skipped.length, 0, `skipped: ${JSON.stringify(skipped)}`);
    assert.equal(placements.length, PLAN.beats.length);
    for (const p of placements) {
        assert.ok(p.source === 'template' || p.source === 'component', p.source);
        assert.ok(p.id && p.params && Number.isFinite(p.start) && p.duration > 0, JSON.stringify(p));
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'no position');
    }
});

check('nothing is written for the user: every string traces to the transcript', () => {
    const spoken = WORDS.map(w => w.word.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
    // Two things are not quotes and are allowed.
    //  - A FIGURE is DERIVED from the speech, not invented: "forty percent"
    //    becomes "40%", which is the same claim in the notation a card can
    //    show. Each one is checked against what MomentAnalyzer read off the
    //    transcript, so a figure that appeared from nowhere still fails.
    //  - BEFORE/AFTER, marked invented in splitSides, claims nothing about
    //    the speaker.
    const ALLOWED = new Set(['before', 'after', '']);
    const derived = new Set(PLAN.beats.map(b => b.evidence).filter(Boolean)
        .flatMap(e => e.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)));
    const { placements } = BR.placementsFor(PLAN.beats, { kindPlan: SB.KIND_PLAN });
    for (const p of placements) {
        for (const value of Object.values(p.params)) {
            if (typeof value !== 'string') continue;
            for (const word of value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
                assert.ok(spoken.includes(word) || derived.has(word) || ALLOWED.has(word),
                    `"${word}" in ${p.id} was neither said nor derived from a figure`);
            }
        }
    }
    // And the derivation itself is faithful: the figure a beat carries is the
    // one MomentAnalyzer read, not something the bridge made up.
    const stat = PLAN.beats.find(b => b.kind === 'stat');
    assert.equal(stat.evidence, '40%', `the figure was derived as ${stat.evidence}`);
});

check('a stat card carries the figure AND context, never the figure twice', () => {
    const stat = BR.placementsFor(PLAN.beats, { kindPlan: SB.KIND_PLAN })
        .placements.find(p => p.id === 'kpi-stat-callout');
    assert.ok(stat, 'no stat card was planned');
    assert.equal(stat.params.stat, '40%');
    assert.ok(stat.params.label, 'the label is empty — the phrase was only the figure');
    assert.ok(!/forty|percent|40/i.test(stat.params.label), `the label repeats the figure: "${stat.params.label}"`);
});

check('labelBeside strips the figure words and nothing else', () => {
    assert.equal(BR.labelBeside('my revenue grew by forty percent', '40%'), 'my revenue grew by');
    assert.equal(BR.labelBeside('we hit 12 million downloads', '12M'), 'we hit downloads');
    assert.equal(BR.labelBeside('forty percent', '40%'), '', 'nothing but the figure must give an empty label');
});

check('a list phrase splits on its own ordinals, and refuses when it has no structure', () => {
    assert.deepEqual(BR.listItems('First you record, second you upload, third you publish.'),
        ['you record', 'you upload', 'you publish']);
    assert.deepEqual(BR.listItems('one unbroken clause here'), []);
    assert.deepEqual(BR.listItems(''), []);
});

check('a beat whose graphic cannot be filled falls through to one that can', () => {
    // A `list` beat with no internal structure: step-card and checklist both
    // need items, so it must land on the kinetic title rather than be dropped.
    const beat = { id: 'b', start: 5, end: 7, kind: 'list', graphic: 'step-card', layout: 'card', text: 'finally something', evidence: null };
    const alone = BR.placementFor(beat);
    assert.equal(alone, null, 'step-card accepted a phrase with no items');
    const withFallback = BR.placementFor(beat, { fallbacks: ['checklist', 'kinetic-title'] });
    assert.ok(withFallback, 'the fallthrough did not fire');
    assert.equal(withFallback.source, 'component');
    assert.equal(withFallback.id, 'KineticTitle');
});

check('a bare shape is never placed on its own', () => {
    // highlight-box and underline decorate text that is already there; with no
    // text layer under them they are a stray rectangle.
    for (const graphic of ['highlight-box', 'underline']) {
        assert.equal(BR.paramsFor(graphic, { text: 'anything at all' }), null, graphic);
    }
});

check('a malformed beat is refused rather than placed at a nonsense time', () => {
    for (const bad of [null, {}, { start: 5, end: 5 }, { start: 9, end: 2 }, { start: NaN, end: 4 },
        { start: 1, end: 3, graphic: 'not-a-graphic', text: 'hello' }]) {
        assert.equal(BR.placementFor(bad), null, JSON.stringify(bad));
    }
});

check('the layout decides where the graphic sits', () => {
    const seen = new Set();
    for (const layout of SB.LAYOUTS) {
        const pos = BR.LAYOUT_POSITION[layout];
        assert.ok(pos, `no position for layout "${layout}"`);
        assert.ok(pos.x >= 0 && pos.x <= 100 && pos.y >= 0 && pos.y <= 100, `${layout} is off-frame`);
        seen.add(`${pos.x},${pos.y}`);
    }
    assert.ok(seen.size > 1, 'every layout puts the graphic in the same place');
});

log('\n-- 2b. Review before placing --');

check('asking to SEE the storyboard plans without placing anything', () => {
    const planner = read('../client/src/agent/EditPlanner.js');
    const body = planner.slice(planner.indexOf("case 'storyboard_video'"), planner.indexOf("case 'design_scene'"));
    assert.ok(/dryRun/.test(body), 'the planner never sets dryRun');
    // The wording decides. "show me the storyboard" is a request to look;
    // "storyboard it" is a request to act. Both reach the same command.
    const re = body.match(/const dryRun = ([\s\S]*?);\n/);
    assert.ok(re, 'the dryRun rule is not a single expression to check');
    const rule = new Function('asked', `return ${re[1].replace(/\n\s*/g, ' ')};`);
    for (const ask of ['show me the storyboard', 'preview the storyboard', 'what would you put on screen',
        'montre moi le storyboard', 'planifie le storyboard']) {
        assert.equal(!!rule(ask), true, `"${ask}" should be a review`);
    }
    for (const ask of ['storyboard this video', 'storyboard it', 'add graphics throughout',
        'show me the storyboard then do it', 'illustre ce que je dis']) {
        assert.equal(!!rule(ask), false, `"${ask}" should place`);
    }
});

check('a review run is answered with the beats, one line each', () => {
    const engine = read('../client/src/agent/MediaExecutionEngine.js');
    const body = engine.slice(engine.indexOf("case 'storyboard_video'"), engine.indexOf("case 'design_scene'"));
    assert.ok(/if \(dryRun\)/.test(body), 'the engine ignores dryRun');
    assert.ok(/Nothing has been placed/.test(body), 'a review run does not say it changed nothing');
    assert.ok(body.indexOf('if (dryRun)') < body.indexOf('const headline'), 'the review path falls through to the placing path');
});

log('\n-- 2c. Defects the review pass found (a 44s script, read line by line) --');

// The script the review ran on. Every check below failed on it before the fix.
const REVIEW = (() => {
    const lines = ['Everyone tells you to post more.', 'That advice nearly killed my channel.',
        'Last year I published 200 videos.', 'My watch time actually went down.',
        'But the real problem was not the volume.', 'It was that nobody finished them.',
        'First I cut every pause.', 'Second I added captions.', 'Third I stopped over explaining.',
        'Retention went from 20 percent to 55 percent.', 'I use Vibed to do all three in one pass.',
        'Want the exact settings? Link in bio.'];
    let words = [];
    let t = 0;
    for (const line of lines) {
        words = words.concat(say(line, t, 0.38));
        // A real pause between sentences, which is what the clause rules read.
        t += line.split(' ').length * 0.38 + 1.2;
    }
    return { words, duration: Math.ceil(t) };
})();

check('a figure is labelled by ITS OWN clause, not the sentence before it', () => {
    // The first version read backwards by starting N words earlier and
    // scanning FORWARD, so it stopped at the sentence boundary and returned
    // the previous sentence: "200" came out labelled "nearly killed my
    // channel".
    const beats = SB.planStoryboard(REVIEW).beats;
    const stat = beats.find(b => b.kind === 'stat');
    assert.ok(stat, 'no stat beat');
    assert.ok(/published/.test(stat.text), `the stat quotes the wrong clause: "${stat.text}"`);
    assert.ok(!/channel/.test(stat.text), `the stat reached into the previous sentence: "${stat.text}"`);
});

check('an ordinal only counts where its clause begins', () => {
    // "all three in one pass" is not an enumeration; matching the bare
    // numerals anywhere made it two list beats.
    const beats = SB.planStoryboard(REVIEW).beats;
    for (const b of beats) {
        if (b.kind !== 'list') continue;
        assert.ok(/^(first|second|third|finally|lastly|next)/i.test(b.text),
            `a list beat that opens with no ordinal: "${b.text}"`);
    }
});

check('the question is the one actually asked', () => {
    const beats = SB.planStoryboard(REVIEW).beats;
    const q = beats.find(b => b.kind === 'question');
    if (q) assert.ok(/\?/.test(q.text), `the question beat has no question in it: "${q.text}"`);
});

check('the bridge does not defeat the planner\'s no-repeat rule', () => {
    // Three one-line statements all fail step-card and checklist, so the
    // fallthrough converged every one of them on the same kinetic title: the
    // plan said "varied" and the video showed one card three times.
    const plan = SB.planStoryboard(REVIEW);
    const { placements } = BR.placementsFor(plan.beats, { kindPlan: SB.KIND_PLAN });
    for (let i = 1; i < placements.length; i++) {
        const a = placements[i - 1];
        const b = placements[i];
        if (a.id !== b.id) continue;
        // A repeat is allowed only when there was nowhere else to go, and it
        // must at least change its look.
        assert.notEqual(a.preset, b.preset,
            `${b.id} repeats with the same preset "${b.preset}" at ${b.start}s`);
    }
});

check('a component preset rotates on reuse and stays a real preset', () => {
    assert.equal(BR.presetFor('KineticTitle', 0), 'creator');
    assert.notEqual(BR.presetFor('KineticTitle', 1), BR.presetFor('KineticTitle', 0));
    // Wrapping, not running off the end of the list.
    assert.equal(BR.presetFor('KineticTitle', 2), BR.presetFor('KineticTitle', 0));
    assert.equal(BR.presetFor('NotAComponent', 0), null);
    for (const [id, list] of Object.entries(BR.COMPONENT_PRESETS)) {
        assert.ok(Array.isArray(list) && list.length > 0, `${id} has no presets`);
    }
});

check('the whole 44s script plans and bridges with nothing skipped', () => {
    const plan = SB.planStoryboard(REVIEW);
    const { placements, skipped } = BR.placementsFor(plan.beats, { kindPlan: SB.KIND_PLAN });
    assert.equal(skipped.length, 0, `skipped: ${JSON.stringify(skipped)}`);
    assert.ok(placements.length >= 6, `only ${placements.length} graphics over ${REVIEW.duration}s`);
    // And the video is still mostly the speaker.
    const covered = plan.beats.reduce((sum, b) => sum + (b.end - b.start), 0);
    assert.ok(covered / REVIEW.duration < 0.5, `graphics cover ${Math.round(covered / REVIEW.duration * 100)}% of the video`);
});

log('\n-- 3. The planner rules that round B added --');

check('a beat never repeats the words the beat before it is showing', () => {
    // "first ... second ... third" is three list cues in one sentence, far
    // enough apart in time to survive the gap rule.
    const texts = PLAN.beats.map(b => b.text);
    for (let i = 0; i < texts.length - 1; i++) {
        assert.ok(SB.phraseOverlap(texts[i], texts[i + 1]) <= SB.MAX_PHRASE_OVERLAP,
            `beat ${i + 1} repeats beat ${i}: "${texts[i]}" / "${texts[i + 1]}"`);
    }
    assert.ok(PLAN.reasoning.some(r => /repeated the words/.test(r)), 'the drop was not explained');
});

check('phraseOverlap measures words, not characters or order', () => {
    assert.equal(SB.phraseOverlap('you record and upload', 'upload and record you'), 1);
    assert.equal(SB.phraseOverlap('alpha beta', 'gamma delta'), 0);
    assert.equal(SB.phraseOverlap('anything', ''), 0, 'an empty phrase must not divide by zero');
});

check('the store action refuses, with a reason, before it touches history', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    const guardAt = Math.min(
        body.indexOf('There is no transcript'),
        body.indexOf('no duration to plan over'),
    );
    assert.ok(guardAt > 0, 'the guards are missing');
    assert.ok(guardAt < body.indexOf('_saveHistory()'), 'history is snapshotted before the input is checked');
});

check('the whole storyboard is ONE undo', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    assert.equal((body.match(/_saveHistory\(\)/g) || []).length, 1, 'more than one history snapshot');
    assert.ok(/skipHistory: true/.test(body), 'the placements do not skip history');
    // And the two placement paths must honour it.
    assert.ok(/addTemplateClip: \(kind, params = \{\}, opts = \{\}\)/.test(store), 'addTemplateClip takes no opts');
    assert.ok(/addMotionComponent: \(componentId, presetId, params = \{\}, opts = \{\}\)/.test(store), 'addMotionComponent takes no opts');
    assert.ok(/if \(!opts\.skipHistory\) get\(\)\._saveHistory\(\);/.test(store), '_placeScene always snapshots');
});

check('a dry run plans without placing anything', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    assert.ok(body.indexOf('input.dryRun') < body.indexOf('_saveHistory()'), 'a dry run still snapshots history');
});

check('one graphic that throws does not abandon the rest half-placed', () => {
    const store = read('../client/src/store/useTimelineStore.js');
    const body = store.slice(store.indexOf('applyStoryboard:'), store.indexOf('R65 — Motion Graphics Components'));
    // The loop places the REPAIRED placements since round C; find it by the
    // variable the code actually uses rather than pinning an old name.
    const at = body.indexOf('for (const p of finalPlacements)');
    assert.ok(at > 0, 'the placement loop was not found');
    const loop = body.slice(at);
    assert.ok(/try \{/.test(loop) && /catch \(err\)/.test(loop), 'the placement loop has no try/catch');
    assert.ok(/failed\.push/.test(loop), 'a failure is swallowed rather than reported');
});

check('every template a bridge can name has a timeline name', () => {
    // A clip reading "undefined" is what the four special-cased kinds left
    // behind for every other kind.
    const store = read('../client/src/store/useTimelineStore.js');
    assert.ok(/function templateClipName\(/.test(store), 'templateClipName is missing');
    assert.ok(/name: templateClipName\(kind, p\)/.test(store), 'addTemplateClip does not use it');
});

check('the engine converts shot cuts from source time to timeline time', () => {
    const engine = read('../client/src/agent/MediaExecutionEngine.js');
    const body = engine.slice(engine.indexOf("case 'storyboard_video'"), engine.indexOf("case 'design_scene'"));
    // Boundaries come back in the clip's own source time; the beats are in
    // timeline time. Without the offset and speed every snap lands on the
    // wrong second of a trimmed or sped-up clip.
    assert.ok(/base\.offset/.test(body), 'the clip offset is ignored');
    assert.ok(/base\.speed/.test(body), 'the clip speed is ignored');
    assert.ok(/startAt \+ \(c - offset\) \/ speed/.test(body), 'the conversion is missing');
});

check('no transcript is answered with a sentence, not a crash', () => {
    const engine = read('../client/src/agent/MediaExecutionEngine.js');
    const body = engine.slice(engine.indexOf("case 'storyboard_video'"), engine.indexOf("case 'design_scene'"));
    assert.ok(/I need the transcript first/.test(body), 'no message for a missing transcript');
    assert.ok(body.indexOf('words.length === 0') < body.indexOf('sampleShots'), 'it decodes footage before checking it has words');
});

check('shot detection failing is a warning, not a failure', () => {
    const engine = read('../client/src/agent/MediaExecutionEngine.js');
    const body = engine.slice(engine.indexOf("case 'storyboard_video'"), engine.indexOf("case 'design_scene'"));
    assert.ok(/console\.warn\('\[storyboard_video\] shot detection unavailable/.test(body), 'no graceful path');
    assert.ok(/planning on the speech alone/.test(body), 'the fallback is not explained');
});

log(failures === 0 ? '\nALL STORYBOARD WIRING TESTS PASSED' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
