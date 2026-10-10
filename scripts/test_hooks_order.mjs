/**
 * scripts/test_hooks_order.mjs
 *
 * R95: no React hook may sit after an early return.
 *
 * Why this test exists. Previewing a short went blank dark with nothing in the
 * UI to explain it. The cause was three components that called a hook BELOW an
 * early return:
 *
 *   Player/GraphicOverlay.jsx   useMemo under `if (overlayTracks.length === 0) return null`
 *   Player/TextOverlay.jsx      useMemo under `if (textTracks.length === 0) return null`
 *   Effects/EffectControls.jsx  3x useCallback under the "no parameters" return
 *
 * A timeline with no overlay/text track returns early and runs N hooks. The
 * moment one appears -- which is exactly what agent/shortPolish.js does, adding
 * track-short-title (text) and track-short-graphics (overlay) to a finished
 * short -- the same component runs N+1 hooks, React throws error #310
 * ("rendered more hooks than during the previous render") out of render, and
 * the whole player subtree unmounts into a dark frame. No error toast, no
 * console message the user would see: just dark and idle.
 *
 * This class of bug is invisible until the one render that crosses the early
 * return, so it is guarded statically here rather than left to be found by hand.
 */

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here       = path.dirname(fileURLToPath(import.meta.url));
const clientDir  = path.join(here, '..', 'client');

// ESLint is a client devDependency, not a root one: resolve it from client/.
const requireFromClient = createRequire(path.join(clientDir, 'package.json'));
const { ESLint } = await import(pathToFileURL(requireFromClient.resolve('eslint')).href);

let failed = 0;
const ok   = (m) => console.log(`  ✓ ${m}`);
const bad  = (m) => { console.log(`  ✗ ${m}`); failed += 1; };

console.log('\nReact hooks order (rules-of-hooks) across client/src\n');

const eslint = new ESLint({ cwd: clientDir });
const results = await eslint.lintFiles(['src']);

const violations = results.flatMap(r =>
    (r.messages || [])
        .filter(m => m.ruleId === 'react-hooks/rules-of-hooks')
        .map(m => ({ file: path.relative(clientDir, r.filePath), line: m.line, message: m.message })),
);

if (violations.length === 0) {
    ok(`no conditional hooks in any of ${results.length} linted files`);
} else {
    bad(`${violations.length} conditional hook call(s) -- each one is a React #310 crash waiting for the render that reaches it:`);
    for (const v of violations) console.log(`      ${v.file}:${v.line}  ${v.message}`);
}

// The three components the shorts preview actually renders through must stay
// clean even if the sweep above is ever narrowed.
const guarded = [
    'src/components/Player/GraphicOverlay.jsx',
    'src/components/Player/TextOverlay.jsx',
    'src/components/Effects/EffectControls.jsx',
];
for (const rel of guarded) {
    const r = results.find(x => path.relative(clientDir, x.filePath) === rel);
    if (!r) { bad(`${rel} was not linted -- the sweep above no longer covers it`); continue; }
    const n = (r.messages || []).filter(m => m.ruleId === 'react-hooks/rules-of-hooks').length;
    if (n === 0) ok(`${rel}: hooks run unconditionally`);
    else bad(`${rel}: ${n} conditional hook call(s)`);
}

console.log('');
if (failed > 0) {
    console.error(`HOOKS ORDER: ${failed} check(s) failed`);
    process.exit(1);
}
console.log('ALL HOOKS ORDER CHECKS PASSED');
