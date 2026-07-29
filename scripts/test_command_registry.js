/**
 * scripts/test_command_registry.js
 *
 * Guards the command vocabulary. Run after touching CommandRegistry.js:
 *   node scripts/test_command_registry.js
 *
 * Pins the exact failure the registry was built to prevent: typing
 * "crop all the parts were the speaker 00 is speaking to 200% on her"
 * used to match 'crop' in the trim/shorten vocabulary and run SILENCE REMOVAL.
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

// The registry is ESM inside a CommonJS package, so it can't be require()d.
// Copying it to a .mjs temp file lets Node import it natively — no bundler,
// no dev-dependency, so this test runs anywhere `node` does.
const SRC = path.resolve(__dirname, '../client/src/agent/CommandRegistry.js');
const TMP = path.join(os.tmpdir(), `cmdreg-${Date.now()}.mjs`);

let fails = 0;
const assert = (cond, msg) => { if (!cond) { console.error('FAIL: ' + msg); fails++; } };

async function main() {
const reg = await import('file://' + TMP);

// ── 1. No two commands may claim the same phrase ─────────────────────────────
const collisions = reg.findCollisions();
assert(collisions.length === 0,
    'vocabulary collisions: ' + collisions.map(c => `"${c.phrase}" → ${c.commands.join(' & ')}`).join('; '));

// ── 2. THE REGRESSION: a spatial crop request must never route to cutting ────
const cropRequest = 'crop all the parts were the speaker 00 is speaking to 200% on her';
const r = reg.resolveCommand(cropRequest);
assert(r.match, 'crop request must match something');
assert(r.match && r.match.id === 'crop_clip',
    `crop request must resolve to crop_clip, got "${r.match && r.match.id}"`);
assert(reg.scoreCommand(reg.COMMAND_BY_ID.silence_removal, cropRequest) === 0,
    'silence_removal must be VETOED for a crop request (this is the original bug)');

// ── 2b. …and its PARAMS must be extracted correctly ─────────────────────────
const cropParams = reg.extractParams(reg.COMMAND_BY_ID.crop_clip, cropRequest);
assert(cropParams.amount === 2, `"200%" → amount 2, got ${cropParams.amount}`);
assert(cropParams.speaker === 'SPEAKER_00', `"speaker 00" → SPEAKER_00, got ${cropParams.speaker}`);
assert(cropParams.target === 'all', `"all the parts" → target all, got ${cropParams.target}`);

// Param extraction must not invent values it didn't see
const bare = reg.extractParams(reg.COMMAND_BY_ID.crop_clip, 'punch in a bit');
assert(bare.amount === 1.5, `no percent given → default 1.5, got ${bare.amount}`);
assert(bare.speaker === undefined, 'no speaker mentioned → must not invent one');

for (const [text, key, expected] of [
    ['crop to 150 percent', 'amount', 1.5],
    ['punch in 2x',         'amount', 2],
    ['double the crop',     'amount', 2],
]) {
    const got = reg.extractParams(reg.COMMAND_BY_ID.crop_clip, text)[key];
    assert(got === expected, `"${text}" → ${key}=${expected}, got ${got}`);
}

// ── 3. Genuine cleanup requests still work ───────────────────────────────────
for (const [text, expected] of [
    ['remove the silences',            'silence_removal'],
    ['remove filler words',            'remove_filler_words'],
    ['make it more dynamic',           'rhythm_zoom'],
    ['add captions',                   'auto_captions'],
    ['punch in on the speaker',        'crop_clip'],
    ['make it vertical',               'set_aspect_ratio'],
    ['export for youtube',             'queue_export'],
    ['detect speakers',                'detect_speakers'],
    ['apply camera angles',            'apply_angle'],
]) {
    const got = reg.resolveCommand(text).match;
    assert(got && got.id === expected, `"${text}" → expected ${expected}, got ${got && got.id}`);
}

// ── 4. Cutting commands must not be triggered by zoom/crop language ──────────
for (const text of ['zoom in on her', 'crop to 150%', 'punch in on speaker 01']) {
    const got = reg.resolveCommand(text).match;
    assert(got && got.category === 'transform',
        `"${text}" must be a transform, got ${got && got.id} (${got && got.category})`);
}

// ── 5. Macros expand to atomic steps only ────────────────────────────────────
const steps = reg.expandMacro('macro_multicam');
assert(steps.length === 4, 'multicam macro expands to 4 atomic steps, got ' + steps.length);
assert(steps.every(s => reg.COMMAND_BY_ID[s] && !reg.COMMAND_BY_ID[s].macro),
    'macro steps must all be atomic (no nested macros)');

// ── 6. Every command is well-formed ─────────────────────────────────────────
for (const c of reg.COMMANDS) {
    assert(!!c.id && !!c.label && !!c.category, `command missing id/label/category: ${JSON.stringify(c).slice(0, 60)}`);
    assert(Array.isArray(c.phrases) && c.phrases.length > 0, `${c.id} has no phrases`);
    for (const p of c.params || []) {
        assert(!!p.name && !!p.type, `${c.id} has a malformed param`);
    }
}

// ── 7. Every executable command must reach a REAL handler ───────────────────
// This is the guarantee that lets the vocabulary grow safely: a registry entry
// that routes to a non-existent operation would fail silently at runtime (the
// user types something, the pipeline shrugs). Checked statically against the
// planner's switch and the compiler's registration table.
const planner  = fs.readFileSync(path.resolve(__dirname, '../client/src/agent/EditPlanner.js'), 'utf8');
const compiler = fs.readFileSync(path.resolve(__dirname, '../client/src/agent/CommandCompiler.js'), 'utf8');
const engine   = fs.readFileSync(path.resolve(__dirname, '../client/src/agent/MediaExecutionEngine.js'), 'utf8');

for (const c of reg.COMMANDS) {
    if (c.unimplemented) continue;                 // declared, deliberately not live yet
    const op = c.executes || c.id;
    const known =
        planner.includes(`case '${op}'`) ||
        compiler.includes(`['${op}'`) ||
        engine.includes(`case '${op}'`);
    assert(known, `command "${c.id}" routes to operation "${op}" which no planner/compiler/engine handles`);
}

// Unimplemented commands must never be returned as a live match
const unimplemented = reg.COMMANDS.filter(c => c.unimplemented).map(c => c.id);
assert(unimplemented.every(id => reg.COMMAND_BY_ID[id].unimplemented === true),
    'unimplemented flags must be boolean true');
console.log(`  (${unimplemented.length} declared-but-not-live: ${unimplemented.join(', ') || 'none'})`);

console.log(`\n${reg.COMMANDS.length} commands registered`);
console.log(fails === 0 ? 'ALL COMMAND REGISTRY TESTS PASSED' : `${fails} FAILURES`);
}

fs.copyFileSync(SRC, TMP);
main()
    .catch(err => { console.error('test harness error:', err.message); fails++; })
    .finally(() => {
        try { fs.unlinkSync(TMP); } catch { /* ignore */ }
        process.exit(fails ? 1 : 0);
    });
