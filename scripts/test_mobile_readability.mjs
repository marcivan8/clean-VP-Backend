// scripts/test_mobile_readability.mjs
//
// R156. Five things Marc hit on a phone, in his words:
//
//   1 "when I upload multiple assets, nothing is telling me how far the
//     upload is so that I know when to take the next action"
//   2 the "Something else…" card "should be instead the chat bar only, not
//     the full chat panel"
//   3 "I want the elements in the different panels to be more readable"
//   4 "the preview lags a lot, mostly when there's cut and transition"
//   5 export finished but "it stopped there for a long time" instead of
//     opening the phone's share sheet
//
// (1) had a cause worth naming: handleFileImport built each asset in a loop
// and only called addAssets ONCE, after every file had finished. Every
// uploadProgress callback in between went through updateAsset, which is a
// no-op for an id the store has never seen — so the progress of a multi-file
// import was thrown away and the card had nothing to render. (5) had one too:
// the share row was disabled on !readyFile, so a prefetch that merely was slow
// looked frozen and one that FAILED disabled the row permanently, with the
// on-demand fallback it was documented to fall back to unreachable.

import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { summarizeUploads, isUploading, uploadRunMembers } from '../client/src/lib/uploadProgress.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nmobile readability (R156)\n');

// ── 1 · one number for the whole import ─────────────────────────────────────

const T = 1_700_000_000_000;
const file = (id, phase, progress, offsetMs = 0) => ({
    id, name: `${id}.mp4`, uploadPhase: phase, uploadProgress: progress, uploadStartTime: T + offsetMs,
});

check('the percentage covers every file, not just the first', () => {
    const s = summarizeUploads([file('a', 'uploading', 40), file('b', 'uploading', 0, 900)]);
    assert.equal(s.total, 2, 'both files are part of the import');
    assert.equal(s.done, 0);
    assert.equal(s.percent, 20, 'the mean of 40 and 0 — the old code showed 40');
});

check('it never walks backwards when a file finishes', () => {
    const before = summarizeUploads([file('a', 'uploading', 90), file('b', 'uploading', 10, 900)]);
    const after = summarizeUploads([file('a', 'ready', 90), file('b', 'uploading', 10, 900)]);
    assert.equal(before.percent, 50);
    assert.ok(after.percent >= before.percent,
        `finishing a file dropped the bar from ${before.percent}% to ${after.percent}% — the complaint, restated`);
    assert.equal(after.done, 1, 'and it says how many are through');
});

check('a finished file counts as 100 whatever it last reported', () => {
    // 'processing' arrives on a 5s timer, so uploadProgress often stops short
    // of 100 and never gets there. The bar must still reach the end.
    const s = summarizeUploads([file('a', 'ready', 61), file('b', 'ready', 48, 400)]);
    assert.equal(s, null, 'nothing left in flight, so nothing to report');
    const mid = summarizeUploads([file('a', 'ready', 61), file('b', 'uploading', 100, 400)]);
    assert.equal(mid.percent, 100);
});

check('an earlier import is not folded into this one', () => {
    const s = summarizeUploads([file('old', 'ready', 100), file('new', 'uploading', 10, 10 * 60_000)]);
    assert.equal(s.total, 1, 'a file from ten minutes ago is not part of this run');
    assert.equal(s.activeName, 'new.mp4');
});

check('files started minutes apart in one slow import stay together', () => {
    // The loop awaits each upload, so file 3 can start a while after file 1.
    const s = summarizeUploads([file('a', 'ready', 100), file('b', 'ready', 100, 60_000), file('c', 'uploading', 0, 120_000)]);
    assert.equal(s.total, 3);
    assert.equal(s.done, 2);
});

check('phases: only ready is finished', () => {
    assert.equal(isUploading({ uploadPhase: 'uploading' }), true);
    assert.equal(isUploading({ uploadPhase: 'processing' }), true, 'the proxy is still encoding');
    assert.equal(isUploading({ uploadPhase: 'ready' }), false);
    assert.equal(isUploading({}), false, 'no phase at all is not an upload');
    assert.deepEqual(uploadRunMembers(null), []);
});

// ── 1b · the progress has somewhere to land ─────────────────────────────────

const ide = read('../client/src/layouts/IDELayout.jsx');
const store = read('../client/src/store/useTimelineStore.js');

check('each asset is registered before its upload runs', () => {
    const pushAt = ide.indexOf('processedAssets.push(assetEntry);');
    const registerAt = ide.indexOf('addAssets([assetEntry])');
    assert.ok(pushAt > 0 && registerAt > pushAt,
        'without this, updateAsset(assetId, { uploadProgress }) writes to an asset the store does not have yet');
    assert.ok(registerAt < ide.indexOf('const processingTimer = setTimeout'),
        'registering it after the upload starts would still lose the early progress');
});

check('addAssets can be called twice without duplicating the batch', () => {
    assert.match(store, /const known = new Set\(state\.assets\.map\(a => a\?\.id\)\);/);
    assert.match(store, /const fresh = incoming\.filter\(a => a\.id && !known\.has\(a\.id\)\);/);
    assert.ok(!/assets: \[\.\.\.state\.assets, \.\.\.newAssets\]/.test(store),
        'a blind concat would add every file a second time at the end of the loop');
});

check('a failed import is taken back out of the store', () => {
    // It used to be enough to splice it out of the local batch; now it has
    // already been inserted.
    const rollbacks = ide.split('processedAssets.splice(processedAssets.indexOf(assetEntry), 1);').length - 1;
    const removals = ide.split('removeAsset(assetId);').length - 1;
    assert.ok(rollbacks >= 2, 'the two import failure paths');
    assert.ok(removals >= rollbacks, 'every rollback also drops the store copy');
});

const flow = read('../client/src/components/MobileFlow.jsx');

check('the card reads the whole import', () => {
    assert.match(flow, /const upload = summarizeUploads\(assets\);/);
    assert.match(flow, /mobileFlow\.uploadBatch/, 'the "n of m files ready" line');
    assert.ok(!/const uploading = assets\.find\(asset => asset\.uploadPhase/.test(flow),
        'the first-unfinished-file lookup is what showed one number out of seven');
});

// ── 2 · "Something else" opens the composer, not the panel ──────────────────

const flowStore = read('../client/src/store/useMobileFlowStore.js');

check('the flow store knows which face the change step wears', () => {
    assert.match(flowStore, /changeMode: 'tweak',/, 'the default');
    assert.match(flowStore, /toChange: \(mode\) => set\(\{ step: 'change', changeMode: mode === 'describe' \? 'describe' : 'tweak'/);
    assert.match(flowStore, /toOutcome: \(\) => set\(\{ step: 'outcome'/,
        'describe mode is entered from the first screen, so Back has to go there');
});

check('the first screen asks in a field, not behind a panel of cards', () => {
    // Marc's ask was that "Something else" open the chat bar rather than the
    // full "Change something" panel. R156 did that with changeMode:'describe';
    // a later round went further and put the prompt field on the first screen
    // itself, so the card is gone and there is nothing to open. The describe
    // branch below is still here and still correct, but nothing reaches it —
    // flagged rather than deleted.
    assert.match(flow, /id="mobile-short-request"/, 'the inline prompt field IS the chat bar on the first screen');
    assert.match(flow, /mobileFlow\.promptPlaceholder/);
    assert.match(flow, /const describeOnly = useMobileFlowStore\(s => s\.changeMode\) === 'describe';/);
    const entries = (flow.match(/toChange\('describe'\)/g) || []).length;
    assert.equal(entries, 0, 'if describe mode is wired up again, say so here');
});

check('describe mode drops the six change cards', () => {
    assert.match(flow, /\{!describeOnly && \(<>/, 'the cards and the "or say it" label are behind this');
    const guardAt = flow.indexOf('{!describeOnly && (<>');
    const cardsAt = flow.indexOf('{CHANGES.map(c => (');
    const labelAt = flow.indexOf("mobileFlow.orSay");
    const formAt = flow.indexOf('onSubmit={(e) => { e.preventDefault(); run(typed); setTyped(\'\'); }}');
    assert.ok(guardAt > 0 && cardsAt > guardAt && labelAt > guardAt,
        'both the cards and the label they introduce must be inside the guard');
    assert.ok(formAt > labelAt, 'the composer itself stays outside it — that is the whole point');
});

check('describe mode has its own words and does not borrow the tweak copy', () => {
    assert.match(flow, /mobileFlow\.describeTitle/);
    assert.match(flow, /mobileFlow\.describePlaceholder/);
    assert.match(flow, /autoFocus=\{describeOnly\}/, 'the composer is the only thing on screen, so it takes focus');
});

for (const lang of ['en', 'fr']) {
    const copy = JSON.parse(read(`../client/src/locales/${lang}/editor.json`));
    check(`${lang}: the new strings are translated`, () => {
        for (const key of ['uploadBatch', 'describeTitle', 'describeSubtitle', 'describePlaceholder']) {
            assert.ok(copy.mobileFlow[key], `mobileFlow.${key} is missing`);
        }
        assert.ok(copy.mobileExport.preparingFilePercent.includes('{{percent}}'));
        assert.equal(copy.mobileFlow.uploadBatch.includes('{{done}}'), true);
        assert.equal(copy.mobileFlow.uploadBatch.includes('{{total}}'), true);
    });
    check(`${lang}: no em dash in the strings this round touched`, () => {
        for (const key of ['somethingElse', 'describeTitle', 'describeSubtitle', 'describePlaceholder', 'uploadBatch']) {
            assert.ok(!String(copy.mobileFlow[key]).includes('—'), `mobileFlow.${key} still has an em dash`);
        }
    });
}

// ── 4 · what the preview does per frame at a cut ────────────────────────────

const tlayer = read('../client/src/components/Player/TransitionLayer.jsx');
const tstyle = read('../client/src/components/Player/transitionStyle.js');
const player = read('../client/src/components/Player/VideoPlayer.jsx');

check('the overlay draw no longer forces layout every frame', () => {
    // A call, not the word: the comment above the effect names it.
    assert.ok(!/\.getBoundingClientRect\(/.test(tlayer),
        'this effect runs once per frame of a transition; a layout read in it is the stutter');
    assert.match(tlayer, /const sizedForRef = React\.useRef\(0\);/);
    assert.match(tlayer, /if \(sizedForRef\.current !== w \|\| !cv\.width\)/,
        'measure once per container width, not once per frame');
});

check('the overlay canvas is capped instead of running at full dpr', () => {
    assert.match(tlayer, /Math\.min\(window\.devicePixelRatio \|\| 1, 2\)/);
    assert.match(tlayer, /Math\.min\(1280, Math\.round\(cssW \* scale\)\)/,
        'a 3000px canvas cleared and refilled per frame is detail nobody can see');
});

check('phones get a cheap blur rather than the nine-primitive SVG chain', () => {
    assert.match(tstyle, /export function transitionFilter\(fx, lutFilter, \{ cheap = false, frameWidth = 0 \} = \{\}\)/);
    assert.match(tstyle, /\? \(px > 0\.05 \? `blur\(\$\{px\.toFixed\(2\)\}px\)` : ''\)/);
    assert.match(tstyle, /: `url\(#\$\{TFX_FILTER_ID\}\)`/, 'desktop keeps the full chain');
    assert.match(player, /cheap: isMobileViewport, frameWidth: frameWidthPx/);
    assert.match(player, /const \{ isMobile: isMobileViewport \} = useDeviceType\(\);/);
});

check('the blur is still measured in frame widths', () => {
    // blurX/blurY are fractions of the frame; the SVG chain multiplies them by
    // the frame width for stdDeviation and the CSS path has to agree, or the
    // preview blurs by a different amount than the export.
    assert.match(tstyle, /\* \(Number\(frameWidth\) \|\| 0\)/);
    assert.match(tlayer, /const bx = fx \? fx\.blurX \* w : 0;/, 'the SVG path is unchanged');
});

check('the LUT still comes before the transition', () => {
    // The order is what makes a graded clip look graded during a cut.
    assert.match(tstyle, /const parts = \[lut, effect\]\.filter\(Boolean\);/);
});

// ── 5 · the export hands off instead of sitting there ───────────────────────

const sheet = read('../client/src/components/MobileExportSheet.jsx');

check('the download reports how far it has got', () => {
    assert.match(sheet, /res\.body\.getReader\(\)/);
    assert.match(sheet, /onProgress\(total \? Math\.min\(99, Math\.round\(\(received \/ total\) \* 100\)\) : null\)/,
        'null when the response has no Content-Length — better than a made-up number');
    assert.match(sheet, /mobileExport\.preparingFilePercent/);
});

check('a failed prefetch leaves a button you can tap', () => {
    assert.match(sheet, /disabled=\{fetchState === 'loading' \|\| busy === 'share'\}/);
    assert.ok(!/disabled=\{!readyFile\}/.test(sheet),
        'disabling on !readyFile made the documented on-demand fallback unreachable and the row dead for good');
    assert.match(sheet, /setFetchState\('failed'\)/);
});

check('a stalled download gives up rather than saying "preparing" forever', () => {
    assert.match(sheet, /const PREFETCH_TIMEOUT_MS = 120_000;/);
    assert.match(sheet, /setTimeout\(\(\) => controller\?\.abort\(\), PREFETCH_TIMEOUT_MS\)/);
    assert.match(sheet, /return \(\) => \{ cancelled = true; clearTimeout\(timer\); controller\?\.abort\(\); \};/,
        'and it is cleaned up when the sheet closes');
});

check('share() is still called inside the tap', () => {
    // iOS refuses navigator.share() once the user activation is spent, which is
    // the entire reason the file is fetched up front. Nothing here may await
    // before that call.
    const save = sheet.slice(sheet.indexOf('const save = (mode) => {'), sheet.indexOf('const saveSlowPath'));
    assert.ok(!/await/.test(save), 'an await before share() spends the activation and iOS throws NotAllowedError');
    assert.match(save, /navigator\.share\(\{ files: \[readyFile\], title: readyFile\.name \}\)/);
});

// ── 3 · the panels are legible ──────────────────────────────────────────────

const css = read('../client/src/index.css');
const mobileSheet = read('../client/src/components/MobileSheet.jsx');

check('the phone panel switcher is sized for a thumb', () => {
    const block = css.slice(css.indexOf('.studio-tab-btn {'), css.indexOf('.studio-tab-btn:hover'));
    const size = Number(/font-size: ([\d.]+)px/.exec(block)[1]);
    const minH = Number(/min-height: ([\d.]+)px/.exec(block)[1]);
    assert.ok(size >= 12, `${size}px uppercase mono on a phone is not readable`);
    assert.ok(minH >= 40, `a ${minH}px tap target is below what a finger can hit`);
    assert.match(block, /color: var\(--fg-2\)/, '--fg-3 left eleven labels all but invisible');
});

check('the active panel is obvious', () => {
    const active = css.slice(css.indexOf('.studio-tab-btn.active'), css.indexOf('.studio-tab-btn.active') + 220);
    assert.match(active, /border-color: var\(--accent\)/);
    assert.match(active, /font-weight: 600/);
});

check('the switcher icons are not 10px any more', () => {
    const strip = ide.slice(ide.indexOf("{tab === 'media'      && <Layers"), ide.indexOf("{tab === 'settings'   && <Settings") + 120);
    assert.ok(!/w-2\.5 h-2\.5/.test(strip), '10px icons beside 12px type');
    assert.ok(!/fontSize: 9/.test(strip), 'a 9px emoji');
    assert.equal((strip.match(/w-4 h-4/g) || []).length, 8, 'the eight lucide icons');
});

check('sheet labels, chips and rows carry readable type', () => {
    assert.match(mobileSheet, /fontSize: 11\.5, letterSpacing: '0\.1em', textTransform: 'uppercase', color: 'var\(--fg-2\)'/,
        'SheetLabel was 10.5px in --fg-3');
    assert.match(mobileSheet, /minHeight: 44, padding: '0 16px'/, 'SheetChip');
    assert.match(mobileSheet, /fontSize: 15, fontWeight: active \? 600 : 500/, 'SheetChip type');
    assert.match(mobileSheet, /<span style=\{\{ fontSize: 16, fontWeight: 600 \}\}>\{label\}<\/span>/, 'SheetRow');
    assert.match(mobileSheet, /fontSize: 13\.5, color: 'var\(--fg-2\)'/, 'SheetRow sub-label');
});

check('the media panel header is a heading, not fine print', () => {
    const header = ide.slice(ide.indexOf("ideLayout.mediaAndAssets") - 400, ide.indexOf("ideLayout.mediaAndAssets") + 700);
    assert.match(header, /fontSize: 16, fontWeight: 650/);
    assert.match(header, /width: 40, height: 40/, 'the close button was a 24px target');
});

console.log(`\nmobile readability: ${n} passed, 0 failed\n`);
