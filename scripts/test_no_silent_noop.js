/**
 * scripts/test_no_silent_noop.js
 *
 *   node scripts/test_no_silent_noop.js
 *
 * Pins the "a command must never report success over an unchanged timeline"
 * contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * `remove_repetition` shipped routed to VideoEditorTools.removeRepetition(),
 * which filters ContentAnalyzer segments by `importance_score < 0.3`. When the
 * backend is unreachable ContentAnalyzer silently degrades to _localAnalysis(),
 * which hardcodes EVERY segment to `importance_score: 0.5, type: VALUE`. So the
 * filter matched nothing — always — and the tool returned `success: true` with
 * "Removed 0 low-value segment(s)".
 *
 * The user sees a green check over a completely untouched video. That is worse
 * than a crash: a crash is reportable, this just teaches them the product
 * doesn't work. It is also invisible to the existing suite —
 * test_command_registry.js Test 7 asserts a command routes to a handler that
 * EXISTS, not that the handler can produce a CHANGE. This file covers that gap.
 *
 * Pure static analysis of the real sources. No browser, network or credentials.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const TOOLS_PATH  = path.resolve(__dirname, '../client/src/agent/VideoEditorTools.js');
const ENGINE_PATH = path.resolve(__dirname, '../client/src/agent/MediaExecutionEngine.js');
const PLANNER_PATH = path.resolve(__dirname, '../client/src/agent/EditPlanner.js');

const tools   = fs.readFileSync(TOOLS_PATH, 'utf8');
const engine  = fs.readFileSync(ENGINE_PATH, 'utf8');
const planner = fs.readFileSync(PLANNER_PATH, 'utf8');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

/**
 * Extract a method body by its declaration prefix.
 *
 * Must skip the PARAMETER LIST before brace-matching: several of these methods
 * destructure with defaults — `async removeRepetition({ importance_threshold =
 * 0.3 } = {})` — so naively matching from the first `{` after the declaration
 * starts counting inside the parameter destructuring and closes the body early,
 * returning a fragment. That silently made every assertion against those
 * methods fail even when the source was correct.
 */
function methodBody(source, decl) {
    const start = source.indexOf(decl);
    if (start === -1) return null;

    // Walk the parameter list to its matching ')'.
    let i = source.indexOf('(', start);
    if (i === -1) return null;
    let paren = 0;
    for (; i < source.length; i++) {
        if (source[i] === '(') paren++;
        else if (source[i] === ')') { paren--; if (paren === 0) { i++; break; } }
    }

    // Now the first '{' is genuinely the body opener.
    let depth = 0, began = false;
    for (i = source.indexOf('{', i); i < source.length; i++) {
        if (source[i] === '{') { depth++; began = true; }
        else if (source[i] === '}') { depth--; if (began && depth === 0) return source.slice(start, i + 1); }
    }
    return null;
}

console.log('\n── 1. "Remove repetition" routes to the real implementation ──');
// The dead path filtered importance scores that _localAnalysis() guarantees
// will never match. The live path hits /api/ai/detect-repeated-takes, which
// does an embedding similarity scan + GPT-4o arbitration and returns
// activeSegments — the same shape silence removal produces, so it flows
// through _applySegmentsToTimeline and can re-cut a single source clip.
const planRepetition = methodBody(planner, 'static planRemoveRepetition(planId)');
check('planRemoveRepetition exists', !!planRepetition);
check('it emits action "remove_repeated_takes"',
    /action:\s*'remove_repeated_takes'/.test(planRepetition || ''),
    'Routing back to the legacy `remove_repetition` action reintroduces the guaranteed no-op.');
check('it no longer emits the legacy "remove_repetition" action',
    !/action:\s*'remove_repetition'/.test(planRepetition || ''));

console.log('\n── 2. Legacy removeRepetition() refuses instead of no-oping ──');
const removeRep = methodBody(tools, 'async removeRepetition(');
check('removeRepetition exists', !!removeRep);
if (removeRep) {
    check('it bails out on the offline-fallback analysis',
        /localFallback/.test(removeRep),
        '_localAnalysis() hardcodes importance_score 0.5 — the filter can never match.');
    check('it reports failure when nothing matched the threshold',
        /lowValueSegs\.length === 0[\s\S]{0,400}success:\s*false/.test(removeRep),
        'Zero matches must not report success.');
    check('it reports failure when every cut threw',
        /removedCount === 0[\s\S]{0,400}success:\s*false/.test(removeRep),
        'If no segment was actually cut, the timeline is unchanged — say so.');
}

console.log('\n── 3. Offline fallback analysis is never presented as real ──');
// ContentAnalyzer._localAnalysis() sets localFallback: true. Every consumer
// must surface it rather than reporting a confident result over placeholder
// data it never computed.
const analyzeStructure = methodBody(tools, 'async analyzeStructure(');
check('analyzeStructure flags the degraded path',
    /localFallback/.test(analyzeStructure || ''),
    'Reporting "analysis complete: N segments" over placeholder data is false confidence.');

const findHook = methodBody(tools, 'async findHook()');
check('findHook flags the degraded path',
    /localFallback/.test(findHook || ''),
    '_localAnalysis() hardcodes the "hook" to the first 25 s of clip 0 — that is not a detected hook.');

console.log('\n── 4. reorderClips only claims success when clips moved ──');
const reorder = methodBody(tools, 'async reorderClips(');
check('reorderClips exists', !!reorder);
if (reorder) {
    check('it detects an already-correct order',
        /isUnchanged/.test(reorder),
        'Applying the order the clips are already in is a no-op — must not report success.');
    check('it rejects an order matching no clips on the timeline',
        /resolvedOrder\.length === 0[\s\S]{0,300}success:\s*false/.test(reorder),
        'The old `if (!clip) continue` swallowed unknown ids and still claimed success.');
    check('it counts clips that actually moved',
        /\bmoved\+\+/.test(reorder));
}

console.log('\n── 5. applySmartZoom reports what it actually applied ──');
const smartZoom = methodBody(tools, 'async applySmartZoom(');
check('applySmartZoom exists', !!smartZoom);
if (smartZoom) {
    check('zero zoom events reports failure, not success',
        /events\.length === 0[\s\S]{0,300}success:\s*false/.test(smartZoom),
        'The user asked for zooms and got none — that is not a success.');
    check('it counts touched clips rather than all clips',
        /touchedClipIds/.test(smartZoom),
        'Reporting allClips.length claimed "applied to 10 clips" when only 2 were touched.');
}

console.log('\n── 6. Engine-side commands guard their apply counts ──');
check('rhythm_zoom counts keyframes it actually wrote',
    /rzApplied/.test(engine),
    'The summary counts come from the SERVER response, not from what landed on the timeline.');
check('rhythm_zoom fails when nothing was applied',
    /rzApplied === 0[\s\S]{0,300}success:\s*false/.test(engine));
check('detectRepeatedTakes fails when no takes were cut',
    /removedCount === 0[\s\S]{0,400}success:\s*false/.test(engine),
    'A backend that found nothing must not surface as an applied edit.');
check('detect-repeated-takes aborts early without a transcript',
    /Repetition removal needs a transcript/.test(engine),
    'It is transcript-only — with none, the endpoint 400s. Fail with something actionable instead.');

// These were already correct (R14/R23-era code) — pin them so they stay that way.
check('crop_clip fails when no clips matched',
    /cropped === 0[\s\S]{0,300}success:\s*false/.test(engine));
check('reset_crop success is conditional on clearing something',
    /success:\s*cleared > 0/.test(engine));
check('virtual_multicam fails when it tagged nothing',
    /totalTagged === 0/.test(engine));

console.log(
    failures === 0
        ? '\nALL NO-SILENT-NOOP TESTS PASSED\n'
        : `\n${failures} NO-SILENT-NOOP TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
