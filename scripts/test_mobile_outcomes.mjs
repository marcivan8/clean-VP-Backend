// scripts/test_mobile_outcomes.mjs
//
// R144 — the outcome cards on the mobile flow, and the playbook change behind them.
//
// The cards ARE lengths: "Reel, 15-30s". Before this, only the Reel playbook
// cut a short at all — Talking head, Vlog, Interview and Podcast cleaned and
// captioned the whole video — so a phone could not ask Talking head for a
// 40-second cut. The fix is opt-in: a `shortTargetSeconds` fact adds the short
// and the 9:16 step to any style, and desktop Auto, which never passes it,
// keeps the playbooks it had.
//
// The length travels inside the PROMPT rather than as a new argument, because
// EditPlanner already reads a number out of the request and sets explicit:true,
// which is what drops the one-minute floor (R106). One rule, not two.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

// The outcome table imports the timeline store, which reads browser globals at
// module scope. Same stubs the other client-side scripts here use.
globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 390;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const realLog = console.log;
console.log = () => {}; console.warn = () => {}; console.error = () => {};

let n = 0;
const check = (name, fn) => { fn(); n++; realLog(`  ok  ${name}`); };

realLog('\nmobile outcomes\n');

const { buildAutopilotSteps, EDITING_STYLE_IDS } = await import('../client/src/agent/EditingStyles.js');
const { OUTCOMES, OUTCOME_BY_ID } = await import('../client/src/agent/mobileOutcomes.js');

const stepsFor = (styleId, facts = {}) =>
    buildAutopilotSteps(styleId, 'edit it', { hasTranscript: true, ...facts });
const keys = (s) => s.map(x => x.key);

// ── desktop behaviour is untouched ───────────────────────────────────────────
check('without the fact, only Reel cuts a short — exactly as before', () => {
    assert.ok(keys(stepsFor('reel')).includes('short'));
    for (const id of ['talking_head', 'vlog', 'interview', 'podcast']) {
        assert.ok(!keys(stepsFor(id)).includes('short'), `${id} must not have gained a short step`);
        assert.ok(!keys(stepsFor(id)).includes('vertical'), `${id} must not have gained a 9:16 step`);
    }
});

check('Reel without a named length still asks for no number', () => {
    const short = stepsFor('reel').find(s => s.key === 'short');
    assert.equal(short.prompt, 'Extract a short of the strongest moment');
    assert.ok(!/\d/.test(short.prompt), 'an unnamed length must stay unnamed so the floor applies');
});

// ── the mobile path ──────────────────────────────────────────────────────────
check('any style can be asked for a short of a named length', () => {
    for (const id of EDITING_STYLE_IDS) {
        const s = stepsFor(id, { shortTargetSeconds: 40 });
        assert.ok(keys(s).includes('short'), `${id} should cut a short when asked`);
        assert.ok(keys(s).includes('vertical'), `${id} should go vertical when asked`);
    }
});

check('the length reaches the prompt in the shape EditPlanner parses', () => {
    // EditPlanner: /(\d{2,3})\s*(?:s\b|sec|second|seconde)/i
    const planner = /(\d{2,3})\s*(?:s\b|sec|second|seconde)/i;
    for (const o of OUTCOMES) {
        const short = stepsFor(o.styleId, { shortTargetSeconds: o.seconds }).find(s => s.key === 'short');
        const m = short.prompt.match(planner);
        assert.ok(m, `"${short.prompt}" must match the planner's explicit-length regex`);
        assert.equal(Number(m[1]), o.seconds, 'the number the planner reads must be the one asked for');
    }
});

check('a nonsense length is ignored rather than passed on', () => {
    for (const bad of [0, 5, 500, -40, NaN, null, undefined, 'soon']) {
        const s = stepsFor('talking_head', { shortTargetSeconds: bad });
        assert.ok(!keys(s).includes('short'), `${String(bad)} should not produce a short step`);
    }
});

check('the floor stays reachable: 10s is allowed, 9s is not', () => {
    assert.ok(keys(stepsFor('talking_head', { shortTargetSeconds: 10 })).includes('short'));
    assert.ok(!keys(stepsFor('talking_head', { shortTargetSeconds: 9 })).includes('short'));
    assert.ok(keys(stepsFor('talking_head', { shortTargetSeconds: 180 })).includes('short'));
    assert.ok(!keys(stepsFor('talking_head', { shortTargetSeconds: 181 })).includes('short'));
});

check('a transcript step is added first when there is none', () => {
    const s = stepsFor('talking_head', { shortTargetSeconds: 40, hasTranscript: false });
    assert.equal(keys(s)[0], 'transcript', 'picking a moment needs words first');
});

check('a typed request runs as itself, not as a playbook', () => {
    const s = buildAutopilotSteps('reel', 'keep only the part about pricing', { hasTranscript: true, shortTargetSeconds: 22 });
    assert.deepEqual(keys(s), ['request']);
});

// ── the offer ────────────────────────────────────────────────────────────────
check('every outcome names a style that exists', () => {
    for (const o of OUTCOMES) {
        assert.ok(EDITING_STYLE_IDS.includes(o.styleId), `${o.id} points at a real style`);
    }
});

check('every outcome asks for a length inside the range it promises', () => {
    for (const o of OUTCOMES) {
        const [lo, hi] = o.range.match(/\d+/g).map(Number);
        assert.ok(o.seconds >= lo && o.seconds <= hi,
            `${o.id}: asks for ${o.seconds}s but promises ${o.range}`);
    }
});

check('outcome ids are unique and looked up by id', () => {
    assert.equal(new Set(OUTCOMES.map(o => o.id)).size, OUTCOMES.length);
    assert.equal(OUTCOME_BY_ID.reel.seconds, 22);
});

realLog(`\n${n} checks passed\n`);
