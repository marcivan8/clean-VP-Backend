// Mobile export sheet must not pre-pick a platform preset: a preset fixes the
// frame size on the server (PLATFORM_PRESETS), overriding the project's own
// aspect ratio. It used to default to "YouTube" (1920×1080) from the editor's
// initial '16:9', so phone videos exported landscape whatever their format.
// node scripts/test_mobile_export.mjs
import assert from 'assert/strict';
import { readFileSync } from 'fs';

const sheet = readFileSync(new URL('../client/src/components/MobileExportSheet.jsx', import.meta.url), 'utf8');
const init = sheet.match(/const \[settings, setSettings\] = useState\(([\s\S]*?)\);\n/);
assert.ok(init, 'settings state found');
assert.match(init[1], /platform:\s*null/, 'no platform by default');
assert.doesNotMatch(init[1], /youtube|tiktok/, 'no preset derived from the aspect ratio at mount');
console.log('✓ mobile export defaults to the project format (no platform preset)');

const proc = readFileSync(new URL('../jobs/exportProcessor.js', import.meta.url), 'utf8');
assert.match(proc, /const resolvedDims = platform \|\| getResolutionDimensions\(settings\.aspectRatio, settings\.resolution\);/,
    'server: no platform → frame from the project aspect ratio');
const ide = readFileSync(new URL('../client/src/layouts/IDELayout.jsx', import.meta.url), 'utf8');
assert.match(ide, /aspectRatio: projectAspectRatio \|\| '16:9'/, 'client sends the project aspect ratio');
console.log('✓ server sizes the frame from the project aspect ratio when no platform is picked');
// ── R149: Save to Photos must survive iOS ────────────────────────────────────
//
// On iOS navigator.share() only opens the share sheet if it is called while
// the tap is still the active user gesture. The old code awaited a multi-MB
// download first, which spends that activation, so share() threw
// NotAllowedError and the user tapped Share and got an error message. The file
// is now fetched as soon as the render lands, and share() is called with
// nothing awaited before it.
{
    const code = sheet
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/[^\n]*$/gm, '');

    // The handler must NOT be async: an async save() invites an await before
    // the share call, which is exactly the bug.
    assert.match(code, /const save = \(mode\) =>/, 'save() must be synchronous so share() runs inside the gesture');
    assert.doesNotMatch(code, /const save = async/, 'save() must not be async');

    // The file has to exist before the tap.
    assert.match(code, /setReadyFile/, 'the export is prefetched into state');
    assert.match(code, /fetchAsFile\(result\.url, result\.filename\)[\s\S]{0,200}setReadyFile/,
        'the prefetch runs in an effect, not in the handler');

    // Nothing may be awaited between entering save() and calling share().
    const body = code.slice(code.indexOf('const save = (mode) =>'));
    const upToShare = body.slice(0, body.indexOf('navigator.share'));
    assert.ok(!/await/.test(upToShare),
        'nothing may be awaited before navigator.share(): that is what loses the iOS user activation');
    assert.match(body.slice(0, body.indexOf('navigator.share') + 400), /\.catch\(/,
        'the share promise is handled with .catch, since the handler cannot await it');

    // Dismissing the share sheet is a choice, not a failure.
    assert.match(code, /AbortError/, 'a dismissed share sheet must not be reported as an error');

    // The fallbacks must remain for browsers with no file sharing.
    assert.match(code, /downloadFile\(readyFile\)/, 'a prefetched file still downloads when sharing is unsupported');
    assert.match(code, /saveSlowPath/, 'the on-demand path remains for when the prefetch has not finished');
    console.log('\u2713 Save to Photos calls share() inside the tap, so iOS does not refuse it');
}

console.log('\nALL MOBILE-EXPORT CHECKS PASSED');
