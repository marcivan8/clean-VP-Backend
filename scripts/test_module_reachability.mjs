/**
 * scripts/test_module_reachability.mjs
 *
 * The guard for this codebase's signature bug: a module that is built,
 * correct, and reachable from nothing.
 *
 * ADR-001 catalogued it eight times. The roadmap audit found
 * AutonomousEditingPanel ("not a build, a mount"). R160 found
 * `changeMode: 'describe'`. R157 found a mounted route no client ever called.
 * R163 found twenty client modules with no importer, including a 394-line
 * interview panel wired to a live route and a mock "marketplace" tab rendering
 * four fake extensions — neither of which any user could open, and neither of
 * which failed a single test.
 *
 * THE RULE THIS ENFORCES
 * ----------------------
 * A client module with no importer is allowed, but it has to SAY SO in its
 * first few lines — `NOT MOUNTED TODAY` or `NOT REACHABLE TODAY`, with the
 * reason and what reviving it would take. That turns the next audit from an
 * archaeology problem into a read, and it makes the cheap mistake (leaving a
 * finished panel unwired and forgetting) fail loudly, while leaving the
 * legitimate case (deliberately parked code) possible.
 *
 * It deliberately does NOT try to prove a module is *useful* — only that
 * somebody decided, on the record, whether it is connected.
 *
 * Run: node scripts/test_module_reachability.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP = /node_modules|_to_delete|__tests__|\.test\.|[/\\]dist[/\\]/;

/** Entry points: nothing imports these, by definition. */
const ENTRY_POINTS = new Set(['main', 'App']);

/** The marker a parked module must carry, in its first lines. */
const MARKER = /NOT MOUNTED TODAY|NOT REACHABLE TODAY/;
const MARKER_LINES = 8;

function walk(dir, out = []) {
    for (const entry of readdirSync(join(ROOT, dir))) {
        const rel = join(dir, entry);
        if (SKIP.test(rel)) continue;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
        else if (/\.(js|jsx|mjs)$/.test(rel)) out.push(rel);
    }
    return out;
}

const clientFiles = walk(join('client', 'src'));
// Anything that could import a client module: the client itself, plus the
// server/scripts side, because a few client modules are loaded by the test
// harness or shared with the worker.
const corpus = [
    ...clientFiles,
    ...['server', 'routes', 'services', 'middleware', 'scripts', 'jobs', 'analysis', 'viralEngine']
        .flatMap(d => { try { return walk(d); } catch { return []; } }),
].map(rel => [rel, readFileSync(join(ROOT, rel), 'utf8')]);

let failures = 0;
const orphans = [];
const parked = [];

for (const rel of clientFiles) {
    const stem = basename(rel, extname(rel));
    if (ENTRY_POINTS.has(stem)) continue;

    // An importer is any other file naming this module in an import/require
    // path. Matching on the basename is deliberately loose: a false POSITIVE
    // (deciding something is reachable when it is not) only weakens the
    // guard, while a false negative would make it cry wolf and get deleted.
    const pattern = new RegExp(`['"\`][^'"\`]*[/]${stem}(\\.jsx?|\\.mjs)?['"\`]`);
    const hasImporter = corpus.some(([other, src]) => other !== rel && pattern.test(src));
    if (hasImporter) continue;

    const head = readFileSync(join(ROOT, rel), 'utf8').split('\n').slice(0, MARKER_LINES).join('\n');
    if (MARKER.test(head)) { parked.push(rel); continue; }
    orphans.push(rel);
}

if (orphans.length > 0) {
    failures++;
    console.log(`  ✗ ${orphans.length} client module(s) are reachable from nothing and do not say so:\n`);
    for (const o of orphans) console.log(`      ${o}`);
    console.log(`
      Each one is either a feature nobody can open, or parked code. Decide
      which, on the record:
        • mount it (an import plus whatever opens it — for a panel, an entry in
          PanelRail's RAIL_TABS *and* a render branch in IDELayout), or
        • delete it, or
        • keep it and put "NOT MOUNTED TODAY (Rxxx)" in its first ${MARKER_LINES} lines
          with the reason and what reviving it needs.
`);
} else {
    console.log(`  ✓ every client module is either imported or declares itself parked`);
}

console.log(`  ✓ ${parked.length} module(s) parked on the record:`);
for (const p of parked) console.log(`      ${relative('.', p)}`);

// Sanity-check the guard itself: if the marker regex or the walk breaks, this
// suite would pass vacuously and prove nothing.
assert.ok(clientFiles.length > 200, `only found ${clientFiles.length} client modules — the walk is broken`);
assert.ok(corpus.length > clientFiles.length, 'the corpus is missing the server side');
console.log(`  ✓ scanned ${clientFiles.length} client modules against ${corpus.length} files`);

if (failures > 0) { console.log('\nMODULE REACHABILITY FAILED'); process.exit(1); }
console.log('\nALL MODULE REACHABILITY CHECKS PASSED');
