#!/usr/bin/env node
/**
 * Regression: two related fixes to the upload → insight → organize flow.
 *
 * 1. The Brain no longer gives a generic "start uploading" advisory (via the
 *    project_opened trigger) while a just-dropped file is still proxying —
 *    it defers to the asset_added trigger, which correctly waits for the
 *    upload to settle. The proxy-generation status card now explains WHY
 *    ("processing" means generating a smooth-playback proxy), instead of
 *    leaving it as an opaque spinner.
 * 2. organize-clips now triggers (and waits for) the REAL asset analysis
 *    pipeline (the same MediaIntelligencePipeline upload already queues) for
 *    any clip that reaches it without a stored profile, instead of relying
 *    solely on the lighter live-frame-extraction fallback.
 *
 * Run: node scripts/test_upload_insight_and_organize_analysis.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};

section('1 · ReasoningPanel.jsx — project_opened defers while a proxy is in flight');
{
    const panel = read('client/src/components/Assistant/ReasoningPanel.jsx');
    check('project_opened effect checks for actively-proxying assets before analyzing',
        /if \(assets\.some\(a => a\.isProxying\)\) return;/.test(panel));
    check('the ref is still marked even when deferred (so asset_added\'s gate opens)',
        /analyzedProjectRef\.current = projectId;\s*\n\s*if \(assets\.some\(a => a\.isProxying\)\) return;/.test(panel));
    check('assets is a dependency of the project_opened effect (re-evaluates as proxying settles)',
        /\}, \[projectId, analyzeProject, assets\]\);/.test(panel));
    check('the processing-phase detail line renders only during uploadPhase === \'processing\'',
        /phase === 'processing' &&[\s\S]{0,240}uploadProcessingDetail/.test(panel));
}

section('2 · Locale copy — proxy status explains WHY, in both shipped languages');
{
    for (const locale of ['en', 'fr']) {
        const strings = read(`client/src/locales/${locale}/editor.json`);
        check(`${locale}/editor.json defines uploadProcessingDetail`, /"uploadProcessingDetail"\s*:\s*"[^"]{20,}"/.test(strings));
    }
}

section('3 · MediaExecutionEngine.js — organize-clips request carries projectId');
{
    const mee = read('client/src/agent/MediaExecutionEngine.js');
    check('POST body includes projectId alongside clips',
        /body:\s*JSON\.stringify\(\{\s*clips:\s*clipPayload,\s*projectId:\s*ocStore\.projectId \|\| null\s*\}\)/.test(mee));
}

section('4 · interviewRoutes.js — organize-clips triggers + waits on real analysis');
{
    const routes = read('routes/interviewRoutes.js');
    check('imports ASSET_ANALYSIS_PROCESSING alongside ASSET_ANALYSIS_DONE',
        /ASSET_ANALYSIS_DONE, ASSET_ANALYSIS_PROCESSING \} = require\('\.\.\/server\/brain\/media\/analysisStatus'\)/.test(routes));
    check('imports and instantiates the SAME MediaIntelligencePipeline upload uses (module-level singleton, not per-request)',
        /const \{ MediaIntelligencePipeline \} = require\('\.\.\/server\/brain\/media\/MediaIntelligencePipeline'\);\s*\nconst mediaIntel = new MediaIntelligencePipeline\(\);/.test(routes));
    check('destructures projectId from the request body',
        /const \{ clips = \[\], projectId = null \} = req\.body;/.test(routes));
    check('only clips with BOTH assetId and gcsPath qualify for on-demand analysis',
        /if \(!clip\.assetId \|\| !clip\.gcsPath \|\| needsAnalysis\.has\(clip\.assetId\)\) continue;/.test(routes));
    check('checks current analysis_status before triggering — never re-triggers an already-\'processing\' asset',
        /statusById\[id\] !== ASSET_ANALYSIS_PROCESSING/.test(routes) && /statusById\[id\] === ASSET_ANALYSIS_PROCESSING/.test(routes));
    check('calls mediaIntel.analyzeAsset(...) — the real pipeline, not a lighter classifier',
        /mediaIntel\s*\n?\s*\.analyzeAsset\(id, a\.gcsPath, projectId, requestUserId, a\.name\)/.test(routes));
    check('each analyzeAsset() call fails open per-asset (.catch, not left to reject the batch)',
        /\.catch\(err => console\.warn\(`\[interviewRoutes\] organize-clips: analyzeAsset/.test(routes));
    check('polls for in-flight analysis to settle with a bounded deadline (organize is synchronous — must wait, not fire-and-forget)',
        /const deadline = Date\.now\(\) \+ 45_000;/.test(routes) && /while \(Date\.now\(\) < deadline\)/.test(routes));
    check('re-fetches profiles and recomputes profiledClips/needFrames after analysis settles, before frame extraction',
        /const freshProfiles = await fetchAssetProfiles\(ids, requestUserId\);/.test(routes) &&
        /Object\.assign\(profilesById, freshProfiles\);/.test(routes));
    check('the whole on-demand-analysis step fails open (try/catch around it — falls through to frame extraction on any error)',
        /catch \(analysisErr\) \{[\s\S]{0,300}organize-clips: on-demand analysis step failed/.test(routes));
    check('profiledClips/needFrames were converted to `let` (reassigned after analysis) — not still `const`',
        /let profiledClips = clips\.filter/.test(routes) && /let needFrames\s*= clips\.filter/.test(routes));
}

console.log(`\n${'─'.repeat(60)}\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
