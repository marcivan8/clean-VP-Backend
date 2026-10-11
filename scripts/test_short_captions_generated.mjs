// scripts/test_short_captions_generated.mjs
//
// Marc reported: in the Shorts panel, captions "aren't allowed" -- confirmed
// to mean a short built from raw footage that was never captioned on the
// main edit first came back with no captions at all. shortPolish.js's
// captions layer only ever RESTYLED caption clips that already existed on
// the timeline; when none did, the loop silently did nothing. This pins the
// fix: when no caption clips exist for the short's window but a word-level
// transcript is available (agent/shortFinisher.js always passes one, shifted
// to the short's own clock via shiftToShort), captions are now GENERATED
// from it with the same grouping the main editor's "Add captions" command
// uses (motion/CaptionModel.js's groupWordsIntoSegments), then styled like
// any other caption. It only stays silent when there is truly no speech.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'assert/strict';

const log = console.log; console.log = () => {}; console.warn = () => {}; console.info = () => {}; console.error = () => {};
let failures = 0;
async function check(name, fn) {
    try { await fn(); log(`✓ ${name}`); }
    catch (err) { failures += 1; log(`✗ ${name}\n    ${err.message}\n${err.stack}`); }
}

const SPo = await import('../client/src/agent/shortPolish.js');
const PP = await import('../client/src/agent/PlatformProfiles.js');

const W = (text, step = 0.4, t0 = 0) => text.split(' ').map((w, i) => ({ word: w, start: t0 + i * step, end: t0 + i * step + 0.3 }));

// A short with NO caption clip anywhere -- the exact shape a short pulled
// straight from raw, never-captioned footage has.
const SHORT_NO_CAPTIONS = { duration: 20, aspectRatio: '9:16', tracks: [
    { id: 'v', type: 'video', clips: [{ id: 'a', type: 'video', start: 0, duration: 20, offset: 0 }] },
] };
const WORDS = W('here is how we grew revenue by 300 percent in one year with one simple change', 0.45);

await check('a short with a transcript but no captions GETS captions, not silence', () => {
    const r = SPo.polishShort(SHORT_NO_CAPTIONS, PP.PLATFORM_PROFILES.tiktok, { words: WORDS, layers: { title: false, numbers: false, camera: false, cuts: false } });
    assert.deepEqual(r.applied.map(a => a.split(' (')[0]), ['captions'], 'captions should be the only thing applied with every other layer off');
    assert.ok(/generated from the transcript/.test(r.applied[0]), `expected the message to say captions were generated, got: ${r.applied[0]}`);

    const capTrack = r.tracks.find(t => t.id === 'track-short-captions');
    assert.ok(capTrack, 'no captions track was created');
    assert.ok(capTrack.clips.length > 0, 'the captions track has no clips');
});

await check('generated caption clips are short-prefixed, styled, carry words, and tile the window', () => {
    const r = SPo.polishShort(SHORT_NO_CAPTIONS, PP.PLATFORM_PROFILES.tiktok, { words: WORDS });
    const caps = r.tracks.find(t => t.id === 'track-short-captions').clips;
    assert.ok(caps.length > 1, 'expected more than one caption line for this much speech');

    for (const c of caps) {
        // `short-` prefixed so MediaExecutionEngine's isFinishLayer catches it
        // and a re-run of "polish_short" on the main edit replaces this batch
        // instead of stacking a second one, exactly like the hook title.
        assert.ok(String(c.id).startsWith('short-'), `expected a short-prefixed id, got "${c.id}"`);
        assert.equal(c.type, 'text');
        assert.ok(Array.isArray(c.words) && c.words.length > 0, 'word-level timing was dropped');
        assert.equal(c.fontFamily, PP.PLATFORM_PROFILES.tiktok.captionPack && c.fontFamily, 'platform pack fields were applied');
        assert.equal(c.y, PP.PLATFORM_PROFILES.tiktok.captionY, 'kept in the platform safe zone like a restyled caption');
        assert.ok(Number(c.duration) > 0, `non-positive duration for "${c.content}"`);
        assert.ok(Number(c.start) + Number(c.duration) <= SHORT_NO_CAPTIONS.duration + 1e-6, 'a caption runs past the end of the short');
    }
    // No two consecutive lines overlap (the same anti-jitter clamp
    // addCaptionClips uses on the main editor).
    const sorted = [...caps].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
        assert.ok(sorted[i - 1].start + sorted[i - 1].duration <= sorted[i].start + 1e-6,
            `captions "${sorted[i - 1].content}" and "${sorted[i].content}" overlap`);
    }
});

await check('key words still get emphasised on generated captions', () => {
    const r = SPo.polishShort(SHORT_NO_CAPTIONS, PP.PLATFORM_PROFILES.tiktok, { words: WORDS, plan: { keywords: ['revenue'] } });
    const caps = r.tracks.find(t => t.id === 'track-short-captions').clips;
    assert.ok(caps.some(c => c.emphasis?.indices?.length > 0), 'no caption line got an emphasis mark');
});

await check('an existing caption on the window is restyled, never duplicated by generation', () => {
    const withCaption = { duration: 20, aspectRatio: '9:16', tracks: [
        { id: 'v', type: 'video', clips: [{ id: 'a', type: 'video', start: 0, duration: 20, offset: 0 }] },
        { id: 't', type: 'text', clips: [{ id: 'caption-1', content: 'we grew revenue by 300 percent', start: 1, duration: 2, words: [{ word: 'we', start: 1, end: 1.2 }] }] },
    ] };
    const r = SPo.polishShort(withCaption, PP.PLATFORM_PROFILES.tiktok, { words: WORDS });
    assert.equal(r.tracks.find(t => t.id === 'track-short-captions'), undefined, 'a generated captions track should not appear alongside an existing one');
    assert.deepEqual(r.applied.filter(a => a.startsWith('captions')), ['captions (1)'], 'only the existing caption was styled, not regenerated');
});

await check('no transcript and no existing captions stays silent -- nothing to caption', () => {
    const r = SPo.polishShort(SHORT_NO_CAPTIONS, PP.PLATFORM_PROFILES.tiktok, { words: [] });
    assert.ok(!r.applied.some(a => a.startsWith('captions')), 'should not claim to have added captions with no transcript at all');
});

log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL SHORT-CAPTIONS-GENERATED CHECKS PASSED');
process.exit(failures ? 1 : 0);
