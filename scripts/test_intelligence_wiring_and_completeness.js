#!/usr/bin/env node
/**
 * Regression: wiring DirectorIntelligence into the UI, plus the media
 * completeness / crash-recovery fixes found auditing "the other
 * intelligences" (ProjectIntelligence, StoryIntelligence, DirectorIntelligence,
 * PipelineAdapter) and re-auditing MediaIntelligencePipeline.
 *
 * 1. /api/brain/analyze now returns the projectMap/storyMap it already derives
 *    (previously computed — real GPT-4o cost — and silently discarded).
 * 2. useBrain.js's analyzeProject() carries them into lastResponse, and no
 *    longer drops response.insight/response.warnings on the floor.
 * 3. ReasoningPanel.jsx runs DirectorIntelligence.buildProposals() on them and
 *    attaches the result to the pushed brain_advisory card.
 * 4. BrainPanel.jsx renders the proposals, honoring the applicable/advisory
 *    distinction buildProposals() already enforces.
 * 5. VisualAnalyzer now probes real duration instead of always sampling the
 *    first ~9 seconds of every clip.
 * 6. MediaIntelligencePipeline: updated_at is set on every status write, a
 *    stale-processing sweep recovers crash-stuck assets, and the bin
 *    classification gate no longer waits forever on one stuck/failed asset.
 * 7. PipelineAdapter.js: the dead, misleading controller import is gone and
 *    its fallback context now includes captions/media bin/edit history.
 *
 * Run: node scripts/test_intelligence_wiring_and_completeness.js
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

section('1 · brainRoutes.js — /analyze returns the maps it already derives');
{
    const routes = read('server/routes/brainRoutes.js');
    check('response now includes projectMap',
        /return res\.json\(\{[\s\S]{0,300}projectMap,/.test(routes));
    check('response now includes storyMap',
        /return res\.json\(\{[\s\S]{0,300}storyMap,/.test(routes));
}

section('2 · useBrain.js — analyzeProject() preserves insight/warnings and carries the maps');
{
    const hook = read('client/src/hooks/useBrain.js');
    check('spreads data.response (not just message) into lastResponse.response',
        /\.\.\.\(data\.response \|\| \{\}\)/.test(hook));
    check('lastResponse.projectMap is set from the response',
        /projectMap:\s*data\.projectMap\s*\?\?\s*null/.test(hook));
    check('lastResponse.storyMap is set from the response',
        /storyMap:\s*data\.storyMap\s*\?\?\s*null/.test(hook));
}

section('3 · ReasoningPanel.jsx — computes and attaches DirectorIntelligence proposals');
{
    const panel = read('client/src/components/Assistant/ReasoningPanel.jsx');
    check('imports buildProposals from DirectorIntelligence.js',
        /import \{ buildProposals \} from '\.\.\/\.\.\/agent\/DirectorIntelligence\.js';/.test(panel));
    check('calls buildProposals with the story/project maps off brainLastResponse',
        /buildProposals\(\{\s*\n?\s*storyMap:\s*brainLastResponse\.storyMap[\s\S]{0,80}projectMap:\s*brainLastResponse\.projectMap/.test(panel));
    check('proposals are included in the hasContent check (a proposals-only analysis still surfaces a card)',
        /directorProposals\.proposals\.length\s*\n?\s*\);/.test(panel) || /\|\|\s*directorProposals\.proposals\.length/.test(panel));
    check('proposal ids are folded into the de-dupe key',
        /directorProposals\.proposals\.map\(p => p\.id\)\.join\(','\)/.test(panel));
    check('directorProposals is attached to the pushed suggestion data',
        /data:\s*\{\s*\.\.\.brainLastResponse,\s*directorProposals\s*\}/.test(panel));
}

section('4 · BrainPanel.jsx — renders proposals, respects applicable vs advisory');
{
    const bp = read('client/src/components/BrainPanel.jsx');
    check('reads directorProposals off brainOutput',
        /brainOutput\?\.directorProposals\?\.proposals \|\| \[\]/.test(bp));
    check('ProposalItem only fires onAccept when proposal.applicable is true',
        /if \(!proposal\.applicable\) return; \/\/ advisory/.test(bp));
    check('non-applicable proposals render an explicit "not an applicable action" label',
        /Observation — not an applicable action/.test(bp));
    check('handleAcceptProposal resubmits the human-readable title, not a raw command id',
        /const handleAcceptProposal = \(proposal\) => \{\s*\n\s*if \(proposal\?\.title\) onSendCommand\?\.\(proposal\.title\);/.test(bp));
    check('an "Editorial findings" section is rendered ahead of the plain suggestion chips',
        bp.indexOf('Editorial findings') > 0 && bp.indexOf('Editorial findings') < bp.indexOf('Next steps'));
}

section('5 · VisualAnalyzer.js — probes real duration instead of a fixed ~9s window');
{
    const va = read('server/brain/media/VisualAnalyzer.js');
    check('sets fluent-ffmpeg\'s ffprobe path via @ffprobe-installer/ffprobe',
        /ffmpeg\.setFfprobePath\(ffprobeInstaller\.path\)/.test(va));
    check('probeDuration() resolves 0 (not throws) on ffprobe failure, preserving the old fallback',
        /async probeDuration\(filePath\) \{[\s\S]{0,600}resolve\(0\)/.test(va));
    check('analyze() probes duration when the caller passes none',
        /const realDuration = duration \|\| await this\.probeDuration\(filePath\);/.test(va));
    check('extractFrames() is called with the probed duration, not the raw (often null) argument',
        /this\.extractFrames\(filePath, realDuration, tempFiles\)/.test(va));
}

section('6a · MediaIntelligencePipeline.js — updated_at set on every status write');
{
    const mp = read('server/brain/media/MediaIntelligencePipeline.js');
    check('_updateAssetStatus() writes updated_at alongside analysis_status',
        /\.update\(\{ analysis_status: status, updated_at: new Date\(\)\.toISOString\(\) \}\)/.test(mp));
}

section('6b · MediaIntelligencePipeline.js — stale-processing recovery sweep');
{
    const mp = read('server/brain/media/MediaIntelligencePipeline.js');
    check('defines a generous staleness threshold (not so tight it kills legitimate long jobs)',
        /STALE_PROCESSING_MS = 15 \* 60 \* 1000/.test(mp));
    check('sweep flips stuck rows to FAILED, never deletes or silently drops them',
        /\.update\(\{ analysis_status: ASSET_ANALYSIS_FAILED, updated_at: new Date\(\)\.toISOString\(\) \}\)\s*\n\s*\.eq\('analysis_status', ASSET_ANALYSIS_PROCESSING\)\s*\n\s*\.lt\('updated_at', cutoff\)/.test(mp));
    check('sweep is guarded to start once per process regardless of how many instances are created',
        /let _staleSweepStarted = false;/.test(mp) && /if \(_staleSweepStarted\) return;/.test(mp));
    check('the interval is unref()\'d so it can never block process exit (same pattern as Session.js)',
        /setInterval\(\(\) => \{ _recoverStaleProcessing\(sweepPipeline\); \}, STALE_SWEEP_INTERVAL_MS\)\.unref\(\)/.test(mp));
    check('recovered assets trigger a re-check of their project\'s classification gate',
        /await pipeline\._maybeRunBinClassification\(userId, projectId\)\.catch/.test(mp));
}

section('6c · MediaIntelligencePipeline.js — bin classification no longer waits forever on one stuck asset');
{
    const mp = read('server/brain/media/MediaIntelligencePipeline.js');
    check('gate now accepts DONE-or-FAILED as "resolved", not just DONE',
        /a\.analysis_status === ASSET_ANALYSIS_DONE \|\| a\.analysis_status === ASSET_ANALYSIS_FAILED/.test(mp));
    check('gate still requires at least one asset to have actually succeeded',
        /const anyDone = assets\.some\(a => a\.analysis_status === ASSET_ANALYSIS_DONE\);/.test(mp));
    check('classification is re-checked from the early "no readable file" failure path',
        /Could not resolve a readable file[\s\S]{0,400}await this\._maybeRunBinClassification\(userId, projectId\);/.test(mp));
    check('classification is re-checked from the catch-all failure path in analyzeAsset()',
        /analyzeAsset FAILED for[\s\S]{0,400}await this\._maybeRunBinClassification\(userId, projectId\);/.test(mp));
}

section('7 · PipelineAdapter.js — dead import removed, fallback context enriched');
{
    const pa = read('server/brain/PipelineAdapter.js');
    check('the unused controller destructure/require is gone',
        !/const \{ chatAgentHandler: _unused, \.\.\.controller \}/.test(pa));
    check('header now describes this as an independent fallback, not a call into chatAgentHandler',
        /a lightweight, independent fallback, NOT a call/.test(pa));
    check('fallback context now includes hasCaptions',
        /hasCaptions:\s*!!projectContext\?\.hasCaptions,/.test(pa));
    check('fallback context now includes hasMusicTrack',
        /hasMusicTrack:\s*!!projectContext\?\.hasMusicTrack,/.test(pa));
    check('fallback context now includes a trimmed mediaBin',
        /mediaBin:\s*\(projectContext\?\.mediaBin \|\| \[\]\)\.map/.test(pa));
    check('fallback context now includes recent editHistory',
        /editHistory:\s*\(projectContext\?\.editHistory \|\| \[\]\)\.slice\(-15\)/.test(pa));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
