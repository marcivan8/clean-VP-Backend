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
assert.match(ide, /const planAspectRatio = override\?\.aspectRatio \|\| live\.aspectRatio \|\| aspectRatio;/,
    'client resolves the aspect ratio from the exported project or short override');
assert.match(ide, /aspectRatio: planAspectRatio \|\| projectAspectRatio \|\| '16:9'/,
    'client sends the resolved aspect ratio to the server');
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
    const prefetchEffect = code.slice(code.indexOf('useEffect(() => {'), code.indexOf('}, [open, result?.url, result?.filename])'));
    assert.match(prefetchEffect, /fetchAsFile\(result\.url, result\.filename,\s*\{/,
        'the prefetch runs in an effect, not in the handler');
    assert.match(prefetchEffect, /\.then\(\(f\) => \{[\s\S]*?setReadyFile\(f\)/,
        'the fetched file is saved to state when the prefetch resolves');

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

// ── R153: the share screen matches the design ───────────────────────────────
//
// It had drifted a long way: a full native video player, a violet download
// button and a plain text list of destinations. The design (Export.dc.html) is
// a small poster beside the title, destinations as soft cards, and ONE light
// primary button at the bottom.
{
    const { readFileSync } = await import('fs');
    const dest = readFileSync(new URL('../client/src/components/ShareDestinations.jsx', import.meta.url), 'utf8');
    const rowStyle = readFileSync(new URL('../client/src/components/shareRow.js', import.meta.url), 'utf8');
    const code = sheet.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    const done = code.slice(code.indexOf("view === 'done'"), code.indexOf("view === 'error'"));

    // The colour Marc called out. The design's primary is the light pill.
    assert.match(done, /background: 'var\(--fg\)', color: 'var\(--bg\)'/, 'the primary button is the light pill');
    assert.ok(!/background: 'var\(--accent\)'/.test(done), 'the violet download button is gone');
    assert.match(done, /borderRadius: 999/, 'and it is a pill, not a soft rectangle');
    assert.match(done, /height: 56/, 'at the design height');

    // A poster, not a player: the result screen is where the short is watched.
    assert.ok(!/<video[\s\S]{0,120}controls/.test(done), 'no native player on the share screen');
    assert.match(done, /width: 86, height: 134/, 'the design poster size');

    // Destinations are cards, shared with ShareDestinations so the two cannot
    // drift apart.
    assert.match(rowStyle, /borderRadius: 15/);
    assert.match(rowStyle, /padding: '15px 16px'/);
    assert.match(done, /SHARE_ROW/);
    assert.match(dest, /SHARE_ROW/, 'the destination rows use the same card');
    assert.ok(!/borderTop: '1px solid var\(--line\)'/.test(dest), 'the old plain list is gone');
    assert.match(done, /SHARE_LABEL/, 'the section carries the mono heading');

    // The share control must never run navigator.share() after an await: iOS
    // refuses a share outside the tap's user activation, and that refusal is
    // the error Marc saw, "Impossible d'ouvrir le menu de partage".
    //
    // The original guard was `disabled={!readyFile}`, which made that true by
    // never letting the tap through at all — and so made the row permanently
    // dead when the prefetch FAILED, which is the other thing Marc hit: the
    // export finished and the row sat on "Préparation du fichier…". Both are
    // held now by disabling only while the fetch is in flight AND making the
    // post-await path a download instead of a share.
    assert.match(done, /disabled=\{fetchState === 'loading' \|\| busy === 'share'\}/,
        'tappable once the fetch has settled either way, not only when it succeeded');
    assert.match(done, /fetchState === 'loading'[\s\S]*?t\('mobileExport\.preparingFile'\)[\s\S]*?t\('mobileExport\.saveToPhotos'\)/,
        'and says it is preparing rather than failing');

    const slow = code.slice(code.indexOf('const saveSlowPath'), code.indexOf('const platform ='));
    assert.ok(!/navigator\.share/.test(slow),
        'the slow path awaits a multi-MB download first; a share after that is refused on iOS');
    assert.match(slow, /downloadFile\(file\);/, 'a download needs no user activation, so it is what still works');
    assert.match(slow, /setShareError\(t\('mobileExport\.savedInsteadOfShare'\)\)/,
        'and the user is told the file was saved rather than shown an error for something that worked');

    const fast = code.slice(code.indexOf('const save = (mode) => {'), code.indexOf('const saveSlowPath'));
    assert.ok(!/await/.test(fast), 'the fast path must stay inside the activation');

    for (const lang of ['en', 'fr']) {
        const me = JSON.parse(readFileSync(new URL(`../client/src/locales/${lang}/editor.json`, import.meta.url), 'utf8')).mobileExport;
        for (const k of ['sendTo', 'saveToPhotos', 'noWatermark', 'freeNote']) {
            assert.ok(me[k], `${lang} mobileExport.${k} missing`);
            assert.ok(!/\u2014/.test(me[k]), `${lang} mobileExport.${k} has an em dash`);
        }
    }
    // Every artboard in the design uses the light pill for its primary action;
    // there is no violet primary anywhere in it. That holds for the options and
    // error views of this sheet too, not just the finished one.
    // Plain string checks: the escaping needed to put this CSS in a regex is
    // what made an earlier version of this assertion silently match nothing.
    assert.ok(!code.includes("background: 'var(--accent)', color: '#fff'"),
        'no violet primary button anywhere in the share sheet');
    assert.ok(code.includes('linear-gradient(90deg, var(--accent-2), var(--accent))'),
        'the progress bar is the cyan to violet sweep the design draws, not flat violet');
    assert.match(code, /linear-gradient\(90deg, var\(--accent-2\), var\(--accent\)\)/,
        'the progress bar is the cyan to violet sweep the design draws, not flat violet');

    console.log('\u2713 share screen matches the design, light primary, no premature share');
}

console.log('\nALL MOBILE-EXPORT CHECKS PASSED');
