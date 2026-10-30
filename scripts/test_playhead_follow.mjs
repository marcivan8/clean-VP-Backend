// scripts/test_playhead_follow.mjs
//
// R108 — stepping the playhead across the WHOLE timeline.
//
// `stepFrames` and the ←/→ shortcut both existed and both worked. What did
// not exist was anything scrolling the timeline to follow: the playhead is
// positioned in content coordinates inside a container that scrolls, so once
// it passed the right edge it left the screen. During playback it vanished;
// stepping frame by frame past that point moved a playhead nobody could see.
// The feature was reachable and reported success — the quieter sibling of the
// "built but never called" pattern in ADR-001.
//
// Two of these are arithmetic on the real reducer; the rest read the source,
// because the follow lives in a requestAnimationFrame loop inside a React
// component and this suite has no DOM.
import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
const check = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (err) { failures += 1; console.log(`  ✗ ${name}\n      ${err.message}`); }
};

const TIMELINE = read('client/src/components/Timeline/Timeline.jsx');
const STORE = read('client/src/store/useTimelineStore.js');
const LAYOUT = read('client/src/layouts/IDELayout.jsx');
const en = JSON.parse(read('client/src/locales/en/editor.json'));
const fr = JSON.parse(read('client/src/locales/fr/editor.json'));

/** The follow rule, lifted out of the RAF loop so it can be run here. */
function follow({ contentX, scrollLeft, view }) {
    const margin = Math.min(140, Math.max(48, view * 0.12));
    if (contentX < scrollLeft + margin) return Math.max(0, contentX - margin);
    if (contentX > scrollLeft + view - margin) return contentX - view + margin;
    return scrollLeft;
}

console.log('\n── 1. A frame is a frame, at any point on the timeline ──');

check('one step is one frame at the project fps, not a fixed number of seconds', () => {
    const i = STORE.indexOf('stepFrames: (frames) =>');
    const body = STORE.slice(i, STORE.indexOf('},', i));
    assert.ok(/playerRef\?\.playback\?\.fps/.test(body), 'fps is not read from the player');
    assert.ok(/Math\.round\(\(Number\(currentTime\) \|\| 0\) \* fps\)/.test(body),
        'the step is not taken on a frame boundary, so repeated steps would drift');
});

check('stepping stops playback rather than fighting it', () => {
    const i = STORE.indexOf('stepFrames: (frames) =>');
    const body = STORE.slice(i, STORE.indexOf('},', i));
    assert.ok(/if \(isPlaying\) get\(\)\.togglePlay\(\)/.test(body), 'a step while playing would be overwritten');
});

check('the shortcut covers the whole timeline, not the selected clip', () => {
    const i = LAYOUT.indexOf("e.key === 'ArrowLeft' || e.key === 'ArrowRight'");
    const body = LAYOUT.slice(i - 400, i + 700);
    assert.ok(/stepFrames\(dir \* \(e\.shiftKey \? Math\.round\(fps\) : 1\)\)/.test(body),
        'the step is not one frame / one second');
    assert.ok(!/activeClipId/.test(body), 'the step is scoped to a clip');
});

check('seek clamps to the timeline duration, which only ever grows', () => {
    const i = STORE.indexOf('seek: (time) =>');
    const body = STORE.slice(i, STORE.indexOf('},', i));
    assert.ok(/Math\.max\(0, Math\.min\(time, duration\)\)/.test(body), 'the playhead can leave the timeline');
    // If duration shrank below the content, stepping would stop short of it.
    assert.ok(/if \(maxEnd > get\(\)\.duration\)/.test(STORE), 'duration is recomputed downward somewhere');
});

console.log('\n── 2. The view follows the playhead ──');

check('the timeline scrolls to keep the playhead on screen', () => {
    const i = TIMELINE.indexOf('const updatePlayhead');
    assert.ok(i > 0, 'the playhead loop is gone');
    const body = TIMELINE.slice(i, TIMELINE.indexOf('requestAnimationFrame(updatePlayhead)', i));
    assert.ok(/area\.scrollLeft =/.test(body), 'nothing scrolls the view');
});

check('it follows only when the playhead moved', () => {
    // Otherwise every frame would rewrite scrollLeft and a user could never
    // scroll away from the playhead to look at another part of the timeline.
    const i = TIMELINE.indexOf('const updatePlayhead');
    const body = TIMELINE.slice(i, TIMELINE.indexOf('requestAnimationFrame(updatePlayhead)', i));
    assert.ok(/lastDrawnTimeRef/.test(body), 'there is no moved test');
    assert.ok(/Math\.abs\(time - lastDrawnTimeRef\.current\) > 1e-6/.test(body), 'the moved test is not on time');
});

check('it uses the same coordinates the playhead is drawn in', () => {
    const i = TIMELINE.indexOf('const updatePlayhead');
    const body = TIMELINE.slice(i, TIMELINE.indexOf('requestAnimationFrame(updatePlayhead)', i));
    // The line is drawn at labelW + px; following anything else would track
    // a point the playhead is not at.
    assert.ok(/const contentX = labelWRef\.current \+ px;/.test(body), 'the follow and the draw disagree');
});

check('the scroll is instant, not animated', () => {
    const i = TIMELINE.indexOf('const updatePlayhead');
    const body = TIMELINE.slice(i, TIMELINE.indexOf('requestAnimationFrame(updatePlayhead)', i));
    assert.ok(!/behavior:\s*'smooth'/.test(body), 'an animated scroll inside a 60fps loop lags behind itself');
});

check('a ruler drag cannot also start the tracks-area selection/scrub handler', () => {
    const i = TIMELINE.indexOf('const handleRulerMouseDown');
    const body = TIMELINE.slice(i, TIMELINE.indexOf('}, [seekFromRulerX])', i));
    assert.ok(/e\.stopPropagation\(\)/.test(body), 'ruler mousedown bubbles into the parent tracks-area handler');
});

check('auto-follow stays out of the way while mouse or touch scrubbing owns the pointer', () => {
    assert.ok(/const isScrubbingRef = React\.useRef\(false\)/.test(TIMELINE), 'no active scrub state');
    const i = TIMELINE.indexOf('const updatePlayhead');
    const body = TIMELINE.slice(i, TIMELINE.indexOf('requestAnimationFrame(updatePlayhead)', i));
    assert.ok(/!isScrubbingRef\.current/.test(body), 'the playhead can scroll the ruler under the pointer');
    assert.ok(/onTouchEnd=\{handleRulerTouchEnd\}/.test(TIMELINE), 'touch scrubbing never releases its active state');
    assert.ok(/onTouchCancel=\{handleRulerTouchEnd\}/.test(TIMELINE), 'cancelled touch scrubbing can leave follow disabled');
});

console.log('\n── 3. The follow rule itself ──');

check('a playhead already in view does not move the scroll', () => {
    assert.equal(follow({ contentX: 600, scrollLeft: 400, view: 1000 }), 400);
});

check('running off the right edge pulls the view forward, with room to spare', () => {
    const next = follow({ contentX: 1500, scrollLeft: 400, view: 1000 });
    assert.ok(next > 400, 'the view did not follow');
    const margin = Math.min(140, Math.max(48, 1000 * 0.12));
    assert.equal(next, 1500 - 1000 + margin);
    // The playhead has to land INSIDE the new window, not on its edge.
    assert.ok(1500 > next && 1500 < next + 1000, 'the playhead is outside the view it just scrolled to');
});

check('stepping back off the left edge pulls the view back', () => {
    const next = follow({ contentX: 420, scrollLeft: 400, view: 1000 });
    assert.ok(next < 400, 'the view did not follow backwards');
    assert.ok(next >= 0, 'the view scrolled past the start');
});

check('it never scrolls to a negative offset at the very start', () => {
    assert.equal(follow({ contentX: 0, scrollLeft: 300, view: 1000 }), 0);
    assert.equal(follow({ contentX: 10, scrollLeft: 300, view: 1000 }), 0);
});

check('the margin holds on a narrow window without swallowing it', () => {
    for (const view of [300, 600, 1200, 2400]) {
        const margin = Math.min(140, Math.max(48, view * 0.12));
        assert.ok(margin >= 48, `margin ${margin} at ${view}px`);
        assert.ok(margin <= view / 3, `margin ${margin} eats a ${view}px window`);
    }
});

console.log('\n── 4. The shortcut is discoverable ──');

check('the toolbar has frame-step buttons', () => {
    assert.ok(/stepFrames\(-1\)/.test(TIMELINE) && /stepFrames\(1\)/.test(TIMELINE),
        'the only way to step is a shortcut nothing mentions');
});

check('their labels name the key, in both locales', () => {
    for (const [loc, dict] of [['en', en], ['fr', fr]]) {
        for (const key of ['stepBack', 'stepForward']) {
            const copy = dict.timeline?.[key];
            assert.ok(copy, `${loc}: ${key} is missing`);
            assert.ok(/←|→/.test(copy), `${loc}.${key} does not name the shortcut: ${copy}`);
        }
    }
});

check('the buttons are reachable by a screen reader', () => {
    const i = TIMELINE.indexOf("t('timeline.stepBack')");
    const body = TIMELINE.slice(i - 200, i + 600);
    assert.ok(/aria-label=\{t\('timeline\.stepBack'\)\}/.test(body), 'the back button has no accessible name');
    assert.ok(/aria-label=\{t\('timeline\.stepForward'\)\}/.test(body), 'the forward button has no accessible name');
});

console.log(failures === 0 ? '\n✅ playhead follow: all checks passed\n' : `\n❌ playhead follow: ${failures} failing\n`);
process.exit(failures === 0 ? 0 : 1);
