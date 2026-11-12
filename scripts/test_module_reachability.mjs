/**
 * scripts/test_module_reachability.mjs
 *
 * The guard for this codebase's signature bug: a module that is built,
 * correct, and reachable from nothing.
 *
 * ADR-001 catalogued it eight times. R163 found twenty client modules with no
 * importer, including a 394-line interview panel wired to a live route and a
 * mock "marketplace" tab rendering four fake extensions — neither openable by
 * any user, neither failing a single test.
 *
 * R165 rewrote this suite after its first version missed the biggest instance
 * of the very thing it exists to catch. Two bugs, both worth keeping in mind
 * when editing it:
 *
 *  1. IT MATCHED BY BASENAME. `./index` resolved against every index.js in the
 *     tree, so `components/Effects/index.js` — a barrel nobody imports — made
 *     EffectsPanel, EffectControls and PresetBrowser look imported. Resolution
 *     is now path-accurate, relative to the importing file.
 *  2. IT ONLY ASKED "DOES ANYONE IMPORT THIS". An importer that is itself
 *     unreachable is not reachability. The whole WebGL effects runtime
 *     (EffectPipeline, EffectRenderer, EffectGraph, the GPU/CPU/AI engines,
 *     ~4,500 lines) is imported only by PlaybackEngine, which is imported only
 *     by VideoPlayer.jsx, which nothing imports. Every one of them passed.
 *
 * WHAT IT ENFORCES NOW
 * --------------------
 * Hard failure on a CLUSTER ROOT: a module with no importer at all, and no
 * `NOT MOUNTED TODAY` / `NOT REACHABLE TODAY` marker in its first lines.
 * Marking the root documents the cluster hanging off it, which is why the
 * failure is scoped to roots rather than to all ~60 modules behind them.
 *
 * It also PRINTS the transitively-unreachable set every run, with its size, so
 * dead surface area is visible in the log even where it is not failing. That
 * number going up is the signal; it is not asserted, because a module can be
 * legitimately parked and a hard cap would just get raised.
 *
 * Run: node scripts/test_module_reachability.mjs
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const SRC = join(ROOT, 'client', 'src');
const SKIP = /node_modules|_to_delete|__tests__|\.test\.|[/\\]dist[/\\]/;

/** Entry points: nothing imports these, by definition. */
const ENTRY_POINTS = new Set(['main.jsx', 'App.jsx']);

/**
 * Files reached through a vite alias rather than a relative import. Revideo
 * imports `hls.js` at module scope and the alias redirects it to
 * revideo/LazyHls.js, so that file is live even though nothing in client/src
 * names it. Parsed from the config so adding an alias does not quietly make
 * this guard wrong.
 */
const ALIAS_TARGETS = (() => {
    const out = new Set();
    try {
        const cfg = readFileSync(join(ROOT, 'client', 'vite.config.js'), 'utf8');
        for (const m of cfg.matchAll(/replacement:\s*resolve\([^,]+,\s*['"`]([^'"`]+)['"`]\)/g)) {
            const p = resolve(join(ROOT, 'client'), m[1]);
            if (existsSync(p)) out.add(p);
        }
    } catch { /* no config readable: fall through with none */ }
    return out;
})();

// Accepts the wordings already used in the tree rather than imposing a new
// one: composerTools.js has said "TOOL_GROUPS is NOT MOUNTED anywhere" since
// R116, and CreativeDirector.js carries "SUPERSEDED - DO NOT WIRE THIS UP",
// which is a stronger statement of the same decision.
const MARKER = /NOT MOUNTED|NOT REACHABLE|SUPERSEDED/;
const MARKER_LINES = 10;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (SKIP.test(p)) continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(js|jsx)$/.test(p)) out.push(resolve(p));
    }
    return out;
}

const files = walk(SRC);
const rel = (f) => relative(SRC, f);

// ── Path-accurate import graph ───────────────────────────────────────────────
// `import x from './y'` can mean ./y.js, ./y.jsx, ./y/index.js or ./y/index.jsx.
// Bare side-effect imports (`import './i18n.js'`) count too — missing those was
// how an earlier draft of this file decided main.jsx imported almost nothing.
const CANDIDATES = ['', '.js', '.jsx', '/index.js', '/index.jsx'];
const SPEC = /(?:from\s*|import\s*\(\s*|require\s*\(\s*|import\s+)['"`](\.[^'"`]+)['"`]/g;
// A web worker is loaded by URL, not by import: PlaybackEngine starts
// engine/VideoWorker.js with `new Worker(new URL('./VideoWorker.js',
// import.meta.url))`. Missing this made the worker look like its own dead root
// rather than part of the cluster it belongs to.
const WORKER_URL = /new URL\(\s*['"`](\.[^'"`]+)['"`]\s*,\s*import\.meta\.url\s*\)/g;

function resolveSpec(fromFile, spec) {
    const base = resolve(dirname(fromFile), spec);
    for (const ext of CANDIDATES) {
        const p = base + ext;
        if (existsSync(p) && statSync(p).isFile()) return resolve(p);
    }
    return null;
}

const importers = new Map(files.map(f => [f, new Set()]));
for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of [SPEC, WORKER_URL]) {
        for (const m of src.matchAll(re)) {
            const target = resolveSpec(f, m[1]);
            if (target && importers.has(target)) importers.get(target).add(f);
        }
    }
}

const marked = new Set(files.filter(f =>
    MARKER.test(readFileSync(f, 'utf8').split('\n').slice(0, MARKER_LINES).join('\n'))));

// ── Cluster roots: nothing imports them ─────────────────────────────────────
const roots = files.filter(f =>
    !ENTRY_POINTS.has(basename(f)) && !ALIAS_TARGETS.has(f) && importers.get(f).size === 0);

// ── Transitive dead set: reachable only through dead roots ──────────────────
// Fixpoint: a module is dead when every one of its importers is dead.
const dead = new Set(roots);
for (let changed = true; changed;) {
    changed = false;
    for (const f of files) {
        if (dead.has(f) || ENTRY_POINTS.has(basename(f)) || ALIAS_TARGETS.has(f)) continue;
        const ups = [...importers.get(f)];
        if (ups.length > 0 && ups.every(u => dead.has(u))) { dead.add(f); changed = true; }
    }
}

/**
 * THE FROZEN INVENTORY.
 *
 * Marking a cluster root explains the cluster, but it does not stop the
 * cluster GROWING: a new panel wired only into an already-dead barrel
 * inherits the root's marker and stays quiet. That is the exact mistake this
 * suite exists to catch, so the dead set is pinned instead.
 *
 * Any module that becomes unreachable fails this suite. Any module that
 * leaves the list — because it was wired up or deleted — also fails it, so the
 * list cannot drift into fiction. Both failures are fixed the same way: by
 * editing this array in the change that caused it, which puts the decision in
 * the diff where someone reviews it.
 */
const EXPECTED_DEAD = [
    'agent/AgentOrchestrator.js',
    'agent/AudioDirector.js',
    'agent/CreativeDirector.js',
    'agent/ErrorRecoveryAgent.js',
    'agent/ExecutionSupervisor.js',
    'agent/LongFormVideoProcessor.js',
    'agent/ToolExecutionResults.js',
    'agent/VersionManager.js',
    'agent/orchestrator/OrchestratorConfig.js',
    'agent/orchestrator/OrchestratorController.js',
    'agent/orchestrator/OrchestratorEvents.js',
    'agent/orchestrator/OrchestratorFSM.js',
    'agent/orchestrator/index.js',
    'components/Assistant/composerTools.js',
    'components/AudioExportPanel.jsx',
    'components/Effects/EffectControls.jsx',
    'components/Effects/EffectsPanel.jsx',
    'components/Effects/PresetBrowser.jsx',
    'components/Effects/index.js',
    'components/Player/CaptionOverlay.jsx',
    'components/Player/DebugOverlay.jsx',
    'components/Player/FatigueAlert.jsx',
    'components/Player/ObjectLayerOverlay.jsx',
    'components/Player/TransitionLayer.jsx',
    'components/Player/VideoPlayer.jsx',
    'components/Player/transitionStyle.js',
    'components/Timeline/QualityHUD.jsx',
    'components/TimelineEventSuggestions.jsx',
    'components/ViralIntelligencePanel.jsx',
    'effects/EffectGraph.js',
    'effects/EffectPipeline.js',
    'effects/EffectRenderer.js',
    'effects/engines/AIEffects.js',
    'effects/engines/CPUEffects.js',
    'effects/engines/GPUEffects.js',
    'effects/index.js',
    'effects/presets/EffectPreset.js',
    'effects/presets/PresetLibrary.js',
    'engine/MP4Demuxer.js',
    'engine/MasterClock.js',
    'engine/PlaybackEngine.js',
    'engine/RingBuffer.js',
    'engine/VideoWorker.js',
    'engine/audioResample.js',
    'engine/libs/mp4box.all.js',
    'engine/webglContextLifecycle.js',
    'hooks/index.js',
    'hooks/useAgentEvents.js',
    'hooks/useEffects.js',
    'hooks/useJobRecovery.js',
    'hooks/useJobStatus.js',
    'motion/ArtDirector.js',
    'motion/ConstraintEngine.js',
    'motion/DepthCompositor.js',
    'motion/DirectorStoryteller.js',
    'motion/SpringPhysics.js',
    'motion/index.js',
    'timeline/retimeMap.js',
    'utils/pendingJobs.js',
];

let failures = 0;
const unmarkedRoots = roots.filter(f => !marked.has(f)).map(rel).sort();

if (unmarkedRoots.length > 0) {
    failures++;
    console.log(`  ✗ ${unmarkedRoots.length} module(s) are imported by nothing and do not say so:\n`);
    for (const r of unmarkedRoots) console.log(`      ${r}`);
    console.log(`
      Each one is either a feature nobody can open, or parked code. Decide
      which, on the record:
        • mount it (an import plus whatever opens it — for a panel, an entry in
          PanelRail's RAIL_TABS *and* a render branch in IDELayout), or
        • delete it, or
        • keep it and put "NOT MOUNTED TODAY (Rxxx)" in its first ${MARKER_LINES} lines
          with the reason and what reviving it needs.

      A barrel (index.js) counts as nothing: re-exporting a module does not
      make it reachable if the barrel itself is imported by nobody.
`);
} else {
    console.log('  ✓ every module imported by nothing declares itself parked');
}

console.log(`  ✓ ${roots.length} cluster root(s) parked on the record:`);
for (const r of roots.map(rel).sort()) console.log(`      ${r}`);

// Reported, not asserted — see the header.
const behind = [...dead].filter(f => importers.get(f).size > 0).map(rel).sort();
console.log(`\n  · ${dead.size} of ${files.length} client modules are unreachable in total`
    + ` (${roots.length} root(s) plus ${behind.length} behind them)`);
for (const b of behind) console.log(`      ${b}`);

// ── The inventory must match exactly ────────────────────────────────────────
const actual = [...dead].map(rel).sort();
const appeared = actual.filter(f => !EXPECTED_DEAD.includes(f));
const revived = EXPECTED_DEAD.filter(f => !actual.includes(f));

if (appeared.length > 0) {
    failures++;
    console.log(`\n  ✗ ${appeared.length} module(s) became unreachable:\n`);
    for (const a of appeared) console.log(`      ${a}`);
    console.log(`
      Nothing can open these. If that is intended, add them to EXPECTED_DEAD
      in this file so the decision is in the diff. If it is not, wire them up:
      a module reachable only from an already-dead module is not reachable,
      however many re-exports sit in between.
`);
}
if (revived.length > 0) {
    failures++;
    console.log(`\n  ✗ ${revived.length} module(s) are no longer unreachable (good) — remove them from EXPECTED_DEAD:\n`);
    for (const r of revived) console.log(`      ${r}`);
}
if (appeared.length === 0 && revived.length === 0) {
    console.log(`\n  ✓ the unreachable set is exactly the ${EXPECTED_DEAD.length} modules on the record`);
}

assert.ok(files.length > 200, `only found ${files.length} client modules — the walk is broken`);
assert.ok(importers.get(resolve(SRC, 'layouts', 'IDELayout.jsx')).size > 0,
    'IDELayout has no importer — resolution is broken, not the codebase');
console.log(`\n  ✓ scanned ${files.length} client modules`);

if (failures > 0) { console.log('\nMODULE REACHABILITY FAILED'); process.exit(1); }
console.log('\nALL MODULE REACHABILITY CHECKS PASSED');
