/**
 * scripts/test_multi_upload_resolution.mjs
 *
 * R95: every video in a multi-file upload gets its resolution backfilled from
 * the proxy when its own in-browser probe fails to read width/height --  not
 * just the first one.
 *
 * Why this matters: agent/shortTimeline.js's aspectOf() falls back to
 * asset.resolution when a clip carries no metadata.resolution of its own
 * (the normal case -- client/src/store/useTimelineStore.js's
 * addAssetToTimeline() never sets clip.metadata at all). If an asset's
 * resolution is never known, fillFrameCrop() returns null by design (see
 * scripts/test_round_b.mjs "an unknown source shape is left uncropped rather
 * than guessed") and every short made from that clip renders pillarboxed --
 * narrower than the 9:16 frame, with blank bars either side -- instead of
 * filling it, with nothing in the UI to explain why.
 *
 * client/src/layouts/IDELayout.jsx's handleFileImport is the only place that
 * ever recovers a resolution the client probe failed to read (asking the
 * server-measured proxy size via applyProxyDimensions). It used to gate that
 * recovery on `!ratioSet`, a flag that goes true the first time ANY video in
 * the batch successfully reads its own dimensions -- a batch-wide "has the
 * project's aspect ratio been set yet" flag being reused to gate a per-file
 * concern. So the 2nd+ video in a multi-file upload whose own probe failed
 * (common for HEVC in a non-Safari browser, or a large 4K file on a slow
 * phone) silently and permanently lost its resolution, because nothing else
 * would ever call applyProxyDimensions for it again.
 *
 * This test re-implements the exact per-file decision IDELayout.jsx makes
 * (the real code is inside a large React component with JSX, so it is not
 * importable standalone) and checks it against realistic multi-file batches.
 * It is intentionally a parallel implementation of the condition, not a call
 * into the real file -- so test_export_rotation_zoom.js's static regex
 * checks on the actual source are what keep this test honest that the real
 * code still matches what is modeled here.
 */

// Mirrors IDELayout.jsx's handleFileImport loop decisions for ONE file,
// given the batch's `ratioSet` state so far.
function decide(ratioSetSoFar, metadata) {
    const isVideo = true;
    let ratioSet = ratioSetSoFar;
    if (isVideo && !ratioSet && metadata.width && metadata.height) {
        ratioSet = true; // detectAspectRatio() found something: project ratio is set
    }
    // THE FIX: no longer `isVideo && !ratioSet && !(metadata.width && metadata.height)`
    const needsResolutionFromProxy = isVideo && !(metadata.width && metadata.height);
    return { ratioSet, needsResolutionFromProxy };
}

let failed = 0;
const ok  = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.log(`  ✗ ${m}`); failed += 1; };

console.log('\nMulti-file upload: per-asset resolution backfill\n');

// 1. Single file, probe succeeds: no backfill needed.
{
    const { ratioSet, needsResolutionFromProxy } = decide(false, { width: 1920, height: 1080 });
    if (ratioSet && !needsResolutionFromProxy) ok('probe succeeds -> ratio set from the client, no proxy backfill needed');
    else bad('probe-succeeds case regressed');
}

// 2. Single file, probe fails: must backfill.
{
    const { needsResolutionFromProxy } = decide(false, { width: 0, height: 0 });
    if (needsResolutionFromProxy) ok('probe fails -> backfill requested');
    else bad('probe-fails case regressed');
}

// 3. THE BUG: a batch of 3 files. File 1's probe succeeds (sets ratioSet).
//    Files 2 and 3's probes fail. Both 2 and 3 must still get a backfill --
//    this is exactly what used to break (only file 2's neighbor-of-first
//    case was silently dropped once ratioSet went true).
{
    let ratioSet = false;
    const files = [
        { name: 'IMG_0001.MOV', width: 1080, height: 1920 },  // probe OK -> sets ratioSet
        { name: 'IMG_0004.MOV', width: 0,    height: 0 },     // probe failed (e.g. HEVC) -- the reported case
        { name: 'IMG_0007.MOV', width: 0,    height: 0 },     // probe failed too
    ];
    const results = [];
    for (const f of files) {
        const d = decide(ratioSet, f);
        ratioSet = d.ratioSet;
        results.push({ name: f.name, needsResolutionFromProxy: d.needsResolutionFromProxy });
    }
    const second = results[1];
    const third  = results[2];
    if (second.needsResolutionFromProxy) ok(`${second.name} (2nd file, probe failed, ratio already set by file 1) -> still gets a backfill`);
    else bad(`${second.name}: backfill was skipped -- this asset's resolution is lost forever, and every short cut from it is pillarboxed`);
    if (third.needsResolutionFromProxy) ok(`${third.name} (3rd file, same situation) -> still gets a backfill`);
    else bad(`${third.name}: backfill was skipped`);
}

// 4. A batch where EVERY file's probe fails (e.g. the whole browser can't
//    read dimensions for this codec): every single one must be backfilled,
//    not just the first.
{
    let ratioSet = false;
    const files = ['a.mov', 'b.mov', 'c.mov'];
    const flags = [];
    for (const name of files) {
        const d = decide(ratioSet, { width: 0, height: 0 });
        ratioSet = d.ratioSet;
        flags.push(d.needsResolutionFromProxy);
    }
    if (flags.every(Boolean)) ok('every file in an all-probes-failed batch gets a backfill');
    else bad(`some files in an all-probes-failed batch were skipped: ${JSON.stringify(flags)}`);
}

console.log('');
if (failed > 0) {
    console.error(`MULTI-UPLOAD RESOLUTION: ${failed} check(s) failed`);
    process.exit(1);
}
console.log('ALL MULTI-UPLOAD RESOLUTION CHECKS PASSED');
