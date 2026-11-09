/**
 * scripts/test_capability_graph.mjs
 *
 * Guards the capability graph and the generated Brain catalogue.
 *
 * What this pins:
 *   1. Coverage — every registry command has a capability contract. A new
 *      command with no contract would be invisible to planning.
 *   2. No contradiction — the graph never drops a `requires` the registry
 *      declares, so the two cannot disagree about preconditions.
 *   3. Prerequisite resolution — the headline behaviour: asking for a
 *      transcript-gated command on a project with no transcript must insert
 *      auto_captions BEFORE it, not fail and not reorder.
 *   4. No fabrication — a missing requirement that only a content-creating
 *      command could satisfy must report `unreachable`, never silently insert
 *      "build a video from a script". This is the R30 rule: a step that cannot
 *      do the job says so.
 *   5. Catalogue sync — the committed JSON matches what the registry would
 *      generate right now. This is what replaces the hand-maintained list's
 *      "remember to update me" comment with a failing test.
 *   6. Every catalogue phrase routes back to its own command, so a suggestion
 *      the Brain copies verbatim cannot mis-route.
 *
 * Run: node scripts/test_capability_graph.mjs
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const reg   = await import(new URL('../client/src/agent/CommandRegistry.js', import.meta.url).href);
const graph = await import(new URL('../client/src/agent/CapabilityGraph.js', import.meta.url).href);
const serverCatalog = require('../server/brain/capabilityCatalog.js');

let passed = 0, failed = 0;
const check = (name, cond, detail) => {
    if (cond) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name}`); if (detail) console.log(`      ${detail}`); }
};
const section = (t) => console.log(`\n${t}`);

// ── 1. Coverage ──────────────────────────────────────────────────────────────
section('1. Coverage: every registry command has a contract');

const uncovered = reg.COMMANDS.filter(c => !graph.contractFor(c.id));
check('every registry command resolves to a contract', uncovered.length === 0,
    uncovered.map(c => c.id).join(', '));

const nonMacroUncovered = reg.COMMANDS
    .filter(c => !c.macro && !graph.CAPABILITIES[c.id])
    .map(c => c.id);
check('every non-macro command is declared in CAPABILITIES', nonMacroUncovered.length === 0,
    `undeclared: ${nonMacroUncovered.join(', ')} — add it to CapabilityGraph.js`);

const ghosts = Object.keys(graph.CAPABILITIES).filter(id => !reg.COMMAND_BY_ID[id]);
check('CAPABILITIES has no entry for a command that does not exist', ghosts.length === 0,
    `ghost ids: ${ghosts.join(', ')}`);

check('unknown command yields no contract', graph.contractFor('not_a_real_command') === null);
check('unknown command is never eligible',
    graph.isEligible('not_a_real_command', new Set(['clips', 'transcript'])) === false);

// ── 2. No contradiction with the registry ────────────────────────────────────
section('2. The graph never contradicts the registry');

const contradictions = [];
for (const cmd of reg.COMMANDS.filter(c => Array.isArray(c.requires) && c.requires.length)) {
    const got = graph.contractFor(cmd.id).requires;
    for (const r of cmd.requires) {
        if (!got.includes(r)) contradictions.push(`${cmd.id}: registry requires '${r}', graph does not`);
    }
}
check("registry's own `requires` are all preserved", contradictions.length === 0,
    contradictions.join('; '));

const badResources = [];
const KNOWN = new Set(Object.values(graph.RESOURCES));
for (const cmd of reg.COMMANDS) {
    const c = graph.contractFor(cmd.id);
    for (const r of [...c.requires, ...c.prefers, ...c.provides]) {
        if (!KNOWN.has(r)) badResources.push(`${cmd.id} → '${r}'`);
    }
}
check('no contract references an unknown resource', badResources.length === 0,
    badResources.join(', '));

// ── 3. Macro contracts are computed, not hand-written ────────────────────────
section('3. Macro contracts derive from their expansion');

const multicam = graph.contractFor('macro_multicam');
check('macro_multicam requires only clips (its own detect_speakers provides diarization)',
    multicam.requires.length === 1 && multicam.requires[0] === 'clips',
    `got [${multicam.requires}]`);
check('macro_multicam provides what its steps provide',
    multicam.provides.includes('diarization') && multicam.provides.includes('sceneAnalysis'),
    `got [${multicam.provides}]`);

const cleanPolish = graph.contractFor('macro_clean_and_polish');
check('macro_clean_and_polish still requires a transcript (no step provides one)',
    cleanPolish.requires.includes('transcript') && cleanPolish.requires.includes('clips'),
    `got [${cleanPolish.requires}]`);

// ── 4. Prerequisite resolution — the headline behaviour ──────────────────────
section('4. Prerequisite resolution');

const A = graph.planFor(['silence_removal', 'rhythm_zoom'], new Set(['clips']));
check('transcript-gated goals get auto_captions inserted',
    A.steps[0] === 'auto_captions', `steps: [${A.steps}]`);
check('…exactly once, for two goals that both need it',
    A.steps.filter(s => s === 'auto_captions').length === 1, `steps: [${A.steps}]`);
check('…before both goals, preserving requested order',
    A.steps.indexOf('auto_captions') < A.steps.indexOf('silence_removal')
    && A.steps.indexOf('silence_removal') < A.steps.indexOf('rhythm_zoom'),
    `steps: [${A.steps}]`);
check('…and reports what it inserted', A.inserted.includes('auto_captions'));
check('…with nothing unreachable', A.unreachable.length === 0);

const B = graph.planFor(['apply_angle'], new Set(['clips']));
check('diarization-gated goal inserts detect_speakers',
    B.steps[0] === 'detect_speakers' && B.steps[1] === 'apply_angle', `steps: [${B.steps}]`);
check('soft preference surfaces as an upgrade, not a blocker',
    B.upgrades.some(u => u.id === 'apply_angle' && u.missing.includes('sceneAnalysis')),
    JSON.stringify(B.upgrades));

const D = graph.planFor(['silence_removal'], new Set(['clips', 'transcript']));
check('an already-satisfiable goal inserts nothing',
    D.steps.length === 1 && D.inserted.length === 0, `steps: [${D.steps}]`);

const order = graph.planFor(['rhythm_zoom', 'apply_angle'], new Set(['clips']));
check('two different prerequisites both get inserted',
    order.steps.includes('auto_captions') && order.steps.includes('detect_speakers'),
    `steps: [${order.steps}]`);
check('…each before the goal that needs it',
    order.steps.indexOf('auto_captions') < order.steps.indexOf('rhythm_zoom')
    && order.steps.indexOf('detect_speakers') < order.steps.indexOf('apply_angle'),
    `steps: [${order.steps}]`);

// ── 5. No fabrication (R30) ──────────────────────────────────────────────────
section('5. A missing requirement is reported, never fabricated');

const C = graph.planFor(['silence_removal'], new Set());
check('empty project: goal is unreachable, not planned',
    C.steps.length === 0 && C.unreachable.some(u => u.id === 'silence_removal'),
    `steps: [${C.steps}] unreachable: ${JSON.stringify(C.unreachable)}`);
check('…and reports `clips` as what is missing',
    C.unreachable.some(u => u.missing.includes('clips')), JSON.stringify(C.unreachable));
check('…and NEVER inserts create_video_from_script to manufacture clips',
    !C.steps.includes('create_video_from_script') && !C.inserted.includes('create_video_from_script'),
    `inserted: [${C.inserted}]`);
check('…nor create_video_from_assets',
    !C.inserted.includes('create_video_from_assets'), `inserted: [${C.inserted}]`);

check('create_video_from_script is not auto-insertable',
    graph.isAutoInsertable('create_video_from_script') === false);
check('auto_captions / detect_speakers / detect_scene ARE auto-insertable',
    ['auto_captions', 'detect_speakers', 'detect_scene'].every(graph.isAutoInsertable));
check('insertableOnly producer lookup refuses a content-creating producer',
    graph.producerOf('clips', { insertableOnly: true }) === null,
    `got ${graph.producerOf('clips', { insertableOnly: true })}`);

const F = graph.planFor(['clear_lut'], new Set(['clips']));
check('an inverse command with nothing to undo is unreachable',
    F.steps.length === 0 && F.unreachable.some(u => u.missing.includes('colorGrade')),
    JSON.stringify(F.unreachable));

const G = graph.planFor(['not_a_real_command'], new Set(['clips']));
check('an unknown goal is reported unreachable, not dropped',
    G.unreachable.some(u => u.id === 'not_a_real_command'), JSON.stringify(G.unreachable));

// ── 6. Producer selection prefers a runnable producer ────────────────────────
section('6. Producer selection');

check('transcript ← auto_captions', graph.producerOf('transcript') === 'auto_captions');
check('diarization ← detect_speakers (read-only, not the destructive split)',
    graph.producerOf('diarization') === 'detect_speakers');
check('sceneAnalysis ← detect_scene', graph.producerOf('sceneAnalysis') === 'detect_scene');
check('a producer whose own requirements are unmet ranks below one that can run',
    graph.producerOf('diarization', { have: new Set(['clips']) }) === 'detect_speakers');
check('an unproducible resource returns null', graph.producerOf('not_a_resource') === null);

// ── 7. deriveResources against realistic store shapes ───────────────────────
section('7. Resource derivation');

const res = (state, facts) => graph.deriveResources(state, facts);
check('null/empty state yields no resources',
    res(null).size === 0 && res({}).size === 0);
check('a video clip yields `clips`',
    res({ tracks: [{ type: 'video', clips: [{ id: 'c1' }] }] }).has('clips'));
check('an audio-only asset does NOT yield `assets`',
    !res({ assets: [{ type: 'audio' }] }).has('assets'));
check('a video asset yields `assets`',
    res({ assets: [{ type: 'video' }] }).has('assets'));
check('clip.emphasis yields keywordEmphasis',
    res({ tracks: [{ type: 'text', clips: [{ id: 't', emphasis: { indices: [0] } }] }] }).has('keywordEmphasis'));
check('per-clip grading yields colorGrade',
    res({ tracks: [{ type: 'video', clips: [{ id: 'c', grading: { lut: 'x' } }] }] }).has('colorGrade'));
check('projectLUTId yields colorGrade',
    res({ projectLUTId: 'lut1' }).has('colorGrade'));
check('clip.shadow / clip.blurZone yield their resources', (() => {
    const r = res({ tracks: [{ type: 'video', clips: [{ id: 'c', shadow: {}, blurZone: {} }] }] });
    return r.has('shadow') && r.has('blurZone');
})());
check('selectedClipIds yields selection',
    res({ selectedClipIds: ['c1'] }).has('selection'));
check('editHistory yields history',
    res({ editHistory: [{ op: 'x' }] }).has('history'));
check('SuggestionEngine facts override the store when supplied', (() => {
    const r = res({ tracks: [] }, { clipCount: 3, hasTranscript: true, diarized: true });
    return r.has('clips') && r.has('transcript') && r.has('diarization');
})());

// ── 8. Generated catalogue is in sync ────────────────────────────────────────
section('8. Generated catalogue');

let syncOk = true, syncErr = '';
try {
    execFileSync('node', [path.join(ROOT, 'scripts', 'generate_capability_catalog.mjs'), '--check'],
        { cwd: ROOT, stdio: 'pipe' });
} catch (err) {
    syncOk = false;
    syncErr = String(err.stdout || '') + String(err.stderr || '');
}
check('committed catalog matches the registry (regenerate if this fails)', syncOk, syncErr.trim());

const cat = serverCatalog.catalog;
check('catalog covers every registry command',
    reg.COMMANDS.every(c => cat.commands.some(e => e.id === c.id)),
    reg.COMMANDS.filter(c => !cat.commands.some(e => e.id === c.id)).map(c => c.id).join(', '));
check('catalog is far larger than the 14-entry hand list it replaced',
    cat.commandCount >= reg.COMMANDS.length, `commandCount=${cat.commandCount}`);
check('every entry carries phrase, id, executes and requires',
    cat.commands.every(e => e.phrase && e.id && e.executes && Array.isArray(e.requires)));

const misroutes = [];
for (const entry of cat.commands.filter(e => e.registryDeclared)) {
    const r = reg.resolveCommand(entry.phrase);
    if (!r.match || r.match.id !== entry.id) {
        misroutes.push(`"${entry.phrase}" → ${r.match ? r.match.id : 'NO MATCH'} (expected ${entry.id})`);
    }
}
check('every registry-declared phrase routes back to its own command',
    misroutes.length === 0, misroutes.join('; '));

const stolen = [];
for (const entry of cat.commands.filter(e => !e.registryDeclared)) {
    const r = reg.resolveCommand(entry.phrase);
    if (r.match) stolen.push(`"${entry.phrase}" is now taken by ${r.match.id} (was ${entry.id})`);
}
check('supplemented phrases still reach the local parser unintercepted',
    stolen.length === 0, stolen.join('; '));

check('the legacy `executes` mapping is carried through', (() => {
    const split = cat.commands.find(e => e.id === 'split_by_speaker');
    const mc = cat.commands.find(e => e.id === 'macro_multicam');
    return split && split.executes === 'split_speakers' && mc && mc.executes === 'virtual_multicam';
})(), 'split_by_speaker must execute split_speakers; macro_multicam must execute virtual_multicam');

// ── 9. Server prompt section ─────────────────────────────────────────────────
section('9. Brain prompt section');

const emptyCtx = { clipCount: 0, totalAssets: 0 };
const clipsCtx = { clipCount: 3, totalAssets: 2 };
const fullCtx  = {
    clipCount: 8, totalAssets: 3, hasCaptions: true, detectedSpeakers: 2,
    analyzedAssets: 3, hasColorGrade: true, editsDone: ['auto_captions'],
};

const sEmpty = serverCatalog.commandsPromptSection(emptyCtx);
const sClips = serverCatalog.commandsPromptSection(clipsCtx);
const sFull  = serverCatalog.commandsPromptSection(fullCtx);

check('section names every operation count', /\(\d+ operations/.test(sClips));
check('transcript-gated commands are BLOCKED without a transcript',
    /run "Add captions" first/.test(sClips) && /silence_removal/.test(sClips.split('NOT YET POSSIBLE')[1] || ''));
check('…and READY once a transcript exists',
    !/NOT YET POSSIBLE/.test(sFull) || !/silence_removal/.test(sFull.split('NOT YET POSSIBLE')[1] || ''));
check('a fully-analysed project blocks nothing the server can see',
    serverCatalog.partition(fullCtx).blocked.length === 0,
    JSON.stringify(serverCatalog.partition(fullCtx).blocked.map(b => b.command.id)));
check('an empty project leaves almost everything blocked',
    serverCatalog.partition(emptyCtx).blocked.length > 40);
check('no raw resource identifier leaks into the prompt',
    !/(colorGrade|captionClips|sceneAnalysis|keywordEmphasis|blurZone)\b/.test(
        [sEmpty, sClips, sFull].join('\n').replace(/→ [a-z_]+/g, '')),
    'resource keys must render through RESOURCE_NAME');
check('blocked commands are grouped by fix, not one line each',
    (sEmpty.match(/unlocks \d+:/g) || []).length > 0
    && (sEmpty.match(/unlocks \d+:/g) || []).length < 12,
    `groups: ${(sEmpty.match(/unlocks \d+:/g) || []).length}`);
check('user-supplied resources read as a user action, not a command to run',
    /the user has to add clips on the timeline/.test(sEmpty));
check('state resources read as a precondition, not an upload',
    /only applies once there is a colour grade/.test(sClips));
check('the empty-project section stays compact', sEmpty.length < 4500, `${sEmpty.length} chars`);

check('server-side resource derivation matches the determinable set',
    serverCatalog.DETERMINABLE.every(r => Object.values(graph.RESOURCES).includes(r)),
    'server DETERMINABLE must be a subset of the graph vocabulary');

const sr = serverCatalog.deriveResources(fullCtx);
check('server derives clips/transcript/diarization/sceneAnalysis/colorGrade from ctx',
    ['clips', 'assets', 'transcript', 'diarization', 'sceneAnalysis', 'colorGrade'].every(r => sr.has(r)),
    [...sr].join(', '));
check('server derives nothing from an empty ctx',
    serverCatalog.deriveResources({}).size === 0);
check('server tolerates a null ctx', (() => {
    try { return serverCatalog.deriveResources(null).size === 0; } catch { return false; }
})());

// ── 9b. No server module may emit a command that does not exist ───────────
section('9b. Server-side command strings are real');

/**
 * R157: server/brain/strategies/ emitted `remove_silence`, `generate_captions`,
 * `apply_smart_zoom`, `add_clip_to_track`, `add_music_bed` and
 * `set_track_volume` — seven of its eight command strings did not exist, so
 * POST /api/brain/organize could only ever return a plan of no-ops presented
 * as a plan. Nothing caught it, because nothing checked server-emitted command
 * strings against the real vocabulary. This does.
 */
const KNOWN_COMMANDS = new Set(cat.commands.flatMap(e => [e.id, e.executes]));

// Compound operations IntentParser produces, plus the asset-engine verbs,
// which are legitimately not registry commands. Explicit, so a NEW unknown
// string still fails.
const ALLOWED_NON_REGISTRY = new Set([
    'long_form_edit', 'smart_cleanup', 'auto_edit', 'export',
    'compound_clean_dynamic', 'compound_clean_virtual_multicam',
    'compound_split_speakers_virtual_multicam',
    'search_sfx', 'search_luts', 'search_presets', 'apply_preset',
    'export_audio', 'recommend_sfx', 'recommend_presets',
]);

const readText = (...parts) => readFileSync(path.join(ROOT, ...parts), 'utf8');

const serverBrainFiles = [];
const walkBrain = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkBrain(full);
        else if (entry.name.endsWith('.js')) serverBrainFiles.push(full);
    }
};
walkBrain(path.join(ROOT, 'server', 'brain'));
// server/knowledge too: editorialKnowledge.js names a command in every remedy,
// which is the same hazard in a different folder.
walkBrain(path.join(ROOT, 'server', 'knowledge'));

let strategiesExist = true;
try { readdirSync(path.join(ROOT, 'server', 'brain', 'strategies')); }
catch { strategiesExist = false; }
check('server/brain/strategies/ is gone (R157)', !strategiesExist,
    'it emitted command strings that do not exist');

const offenders = [];
for (const file of serverBrainFiles) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bcommand:\s*'([a-z_][a-z0-9_]*)'/g)) {
        const name = m[1];
        if (KNOWN_COMMANDS.has(name) || ALLOWED_NON_REGISTRY.has(name)) continue;
        offenders.push(`${path.relative(ROOT, file)} → command: '${name}'`);
    }
}
check('no server brain/knowledge module declares a command that does not exist',
    offenders.length === 0,
    offenders.join('; ') + ' — add it to CommandRegistry, or stop emitting it');

const staleAllow = [...ALLOWED_NON_REGISTRY].filter(n => reg.COMMAND_BY_ID[n]);
check('the allowlist holds only genuinely non-registry operations',
    staleAllow.length === 0,
    staleAllow.join(', ') + ' are registry commands now — drop them from ALLOWED_NON_REGISTRY');

const routesSrc = readText('server', 'routes', 'brainRoutes.js');
check('/api/brain/organize is gone from brainRoutes',
    !/router\.post\('\/organize'/.test(routesSrc),
    'the route is back but its strategies are not');
check('…and brainRoutes no longer calls buildOrganizePlan',
    !/mediaIntel\.buildOrganizePlan/.test(routesSrc));

const pipelineSrc = readText('server', 'brain', 'media', 'MediaIntelligencePipeline.js');
check('MediaIntelligencePipeline no longer exposes buildOrganizePlan',
    !/async buildOrganizePlan\s*\(/.test(pipelineSrc));
check('…and the removal is explained where it was',
    /R157/.test(pipelineSrc), 'future readers need to know why it went');

// ── 10. The Brain prompt actually uses it ────────────────────────────────────
section('10. EditorialBrain wiring');

const brainSrc = require('node:fs').readFileSync(
    path.join(ROOT, 'server', 'brain', 'EditorialBrain.js'), 'utf8');
check('EditorialBrain imports the generated catalogue',
    brainSrc.includes("require('./capabilityCatalog')"));
check('EditorialBrain calls commandsPromptSection(ctx)',
    brainSrc.includes('commandsPromptSection(ctx)'));
check('the hand-maintained list is gone',
    !brainSrc.includes('this list is maintained by hand'));
check('the remove_repetition disambiguation survived the replacement',
    brainSrc.includes('remove_repetition'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('ALL CAPABILITY GRAPH TESTS PASSED');
