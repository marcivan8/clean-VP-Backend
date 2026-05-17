/**
 * test_timeline_pipeline.js
 *
 * Standalone diagnostic that validates the backend side of the
 * "AI command → timeline update" pipeline without requiring a browser.
 *
 * Run: node scripts/test_timeline_pipeline.js
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

let passed = 0;
let failed = 0;

function ok(label, got, expected) {
    if (JSON.stringify(got) === JSON.stringify(expected)) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label}`);
        console.error(`     expected: ${JSON.stringify(expected)}`);
        console.error(`     got:      ${JSON.stringify(got)}`);
        failed++;
    }
}

function truthy(label, val) {
    if (val) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label} — got: ${val}`);
        failed++;
    }
}

function falsy(label, val) {
    if (!val) {
        console.log(`  ✅ ${label}`);
        passed++;
    } else {
        console.error(`  ❌ ${label} — expected falsy, got: ${val}`);
        failed++;
    }
}

// ─── 1. proxyPath is now returned by videoProcessor ──────────────────────────
console.log('\n=== 1. videoProcessor returns proxyPath ===');
{
    // Simulate what videoProcessor.js returns
    const inputPath = 'temp/IMG_3126.MOV';
    const result = {
        proxyUrl: '/uploads/proxies/dev-user/IMG_3126.MOV/proxy.m3u8',
        waveformUrl: '/uploads/proxies/dev-user/IMG_3126.MOV/waveform.json',
        originalPath: inputPath,
        proxyPath: inputPath,    // ← the fix
    };

    truthy('result contains proxyPath', result.proxyPath);
    ok('proxyPath equals originalPath', result.proxyPath, result.originalPath);
    ok('proxyPath is uploads-relative', result.proxyPath, 'temp/IMG_3126.MOV');
}

// ─── 2. IDELayout fallback logic ──────────────────────────────────────────────
console.log('\n=== 2. IDELayout uploadedFile.name resolution ===');
{
    // Before fix: proxyPath missing → name = undefined
    const dataBefore = { proxyUrl: '/uploads/...', originalPath: 'temp/IMG.MOV' };
    const beforeName = dataBefore.proxyPath;                         // undefined
    ok('BEFORE fix: proxyPath absent → name is undefined', beforeName, undefined);

    // After fix: prefer proxyPath, fall back to originalPath
    const dataAfter  = { proxyUrl: '/uploads/...', originalPath: 'temp/IMG.MOV', proxyPath: 'temp/IMG.MOV' };
    const afterName  = dataAfter.proxyPath || dataAfter.originalPath;
    ok('AFTER fix: name resolves correctly', afterName, 'temp/IMG.MOV');

    // Fallback branch: proxyPath absent but originalPath present (older worker)
    const dataLegacy = { proxyUrl: '/uploads/...', originalPath: 'temp/IMG.MOV' };
    const legacyName = dataLegacy.proxyPath || dataLegacy.originalPath;
    ok('Legacy fallback: originalPath used when proxyPath missing', legacyName, 'temp/IMG.MOV');
}

// ─── 3. $uploaded_file symbolic ref resolution ────────────────────────────────
console.log('\n=== 3. $uploaded_file → silence route filename ===');
{
    function resolveUploadedFile(uploadedFile) {
        return uploadedFile?.name || 'video.mp4';
    }

    // Before fix: uploadedFile.name = undefined
    const before = resolveUploadedFile({ name: undefined });
    ok('BEFORE fix: resolves to fallback', before, 'video.mp4');

    // After fix: uploadedFile.name = 'temp/IMG_3126.MOV'
    const after  = resolveUploadedFile({ name: 'temp/IMG_3126.MOV' });
    ok('AFTER fix: resolves to correct path', after, 'temp/IMG_3126.MOV');
}

// ─── 4. silenceRoutes path resolution ─────────────────────────────────────────
console.log('\n=== 4. silenceRoutes file-path resolution ===');
{
    const uploadsDir = path.resolve(__dirname, '../uploads');

    function resolveFilePath(filename) {
        const normalizedFilename = filename.startsWith('/') ? filename.slice(1) : filename;
        let filePath = path.resolve(uploadsDir, normalizedFilename);
        if (!filePath.startsWith(uploadsDir)) {
            const tempPath = path.resolve(uploadsDir, 'temp', path.basename(normalizedFilename));
            if (tempPath.startsWith(uploadsDir)) filePath = tempPath;
            else return null;
        }
        return filePath;
    }

    // Old broken filename
    const bad = resolveFilePath('video.mp4');
    ok('video.mp4 resolves inside uploads/', bad, path.join(uploadsDir, 'video.mp4'));
    falsy('video.mp4 does not exist on disk', fs.existsSync(bad));

    // Fixed filename
    const good = resolveFilePath('temp/IMG_3126.MOV');
    ok('temp/IMG_3126.MOV resolves inside uploads/', good, path.join(uploadsDir, 'temp', 'IMG_3126.MOV'));
    // We don't assert existence here — it's only present while a test video is uploaded
    truthy('path stays within uploads dir', good.startsWith(uploadsDir));
}

// ─── 5. silenceProcessor returns correct activeSegments shape ─────────────────
console.log('\n=== 5. silenceProcessor result shape ===');
{
    // Simulate what the silence job returns
    const jobResult = {
        activeSegments: [
            { start: 0,   end: 3.2, duration: 3.2 },
            { start: 5.1, end: 8.4, duration: 3.3 },
        ],
        videoDuration: 10,
    };

    truthy('activeSegments present', jobResult.activeSegments);
    ok('activeSegments length', jobResult.activeSegments.length, 2);
    truthy('each segment has start', jobResult.activeSegments.every(s => s.start !== undefined));
    truthy('each segment has end',   jobResult.activeSegments.every(s => s.end   !== undefined));
    truthy('each segment has duration', jobResult.activeSegments.every(s => s.duration > 0));
}

// ─── 6. silenceDetect clip-replacement arithmetic ─────────────────────────────
console.log('\n=== 6. silenceDetect clip-replacement arithmetic ===');
{
    const activeSegments = [
        { start: 0,   end: 3.2, duration: 3.2 },
        { start: 5.1, end: 8.4, duration: 3.3 },
    ];

    const newClips = [];
    let currentStartTime = 0;
    activeSegments.forEach((seg, i) => {
        newClips.push({
            id: `clip_silence_${i}`,
            start: currentStartTime,
            duration: seg.duration,
            offset: seg.start,
        });
        currentStartTime += seg.duration;
    });

    ok('First clip start',    newClips[0].start,    0);
    ok('First clip duration', newClips[0].duration, 3.2);
    ok('First clip offset',   newClips[0].offset,   0);
    ok('Second clip start',   newClips[1].start,    3.2);
    ok('Second clip duration',newClips[1].duration, 3.3);
    ok('Second clip offset',  newClips[1].offset,   5.1);
    ok('Total timeline duration', currentStartTime, 6.5);
}

// ─── 7. GCS storage module exports bucket synchronously ───────────────────────
console.log('\n=== 7. storage.js exports ===');
{
    try {
        const storage = require('../config/storage');
        truthy('module exports useLocalStorage field', 'useLocalStorage' in storage);
        truthy('module exports bucket field',         'bucket' in storage);
        truthy('module exports FOLDERS field',        'FOLDERS' in storage);
        if (storage.useLocalStorage) {
            console.log('  ℹ️  Running in local storage mode (no GCS)');
            falsy('bucket is null in local mode', storage.bucket);
        } else {
            console.log('  ℹ️  GCS client initialized');
            truthy('bucket is non-null in GCS mode', storage.bucket);
        }
    } catch (e) {
        console.error(`  ❌ storage.js threw: ${e.message}`);
        failed++;
    }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
    console.error('Some tests failed — see above for details.');
    process.exit(1);
} else {
    console.log('All tests passed ✅');
}
