// scripts/test_mobile_chat_editor.mjs
//
// R160. No timeline on phones; the chat is the editing surface.
//
// Marc: "I want to remove the timeline from the mobile version and keep it
// solely AI Chat based editing. So the editor should just hide the timeline
// and make the chat fit correctly in the space let. We'll then have the
// preview and the chat in the editor."
//
// The mobile editor column was: header → preview (fixed height) → transport
// row → timeline (h-36, 144px) → MobileAIBar (flex-1) → bottom toolbar. The
// timeline took 144px of a ~700px column off the one surface you actually
// edit with on a phone, and a thumb cannot trim a clip in it anyway.
//
// Dropping it is only half the job: the chat has to COLLECT that height. It
// does, but only because the preview stage is shrink-0 with an explicit
// height on mobile while the bar is flex-1. If the stage ever becomes flex-1
// on mobile the two fight over the freed space and the chat gets a fraction
// of it, so that pairing is asserted here rather than left to be rediscovered.

import assert from 'assert/strict';
import { readFileSync } from 'fs';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };

console.log('\nmobile chat editor (R160)\n');

const ide = read('../client/src/layouts/IDELayout.jsx');
const bar = read('../client/src/components/MobileAIBar.jsx');

// ── the timeline is gone from the phone ─────────────────────────────────────

check('only one timeline is mounted, and it is the desktop one', () => {
    const mounts = ide.match(/<Timeline \/>/g) || [];
    assert.equal(mounts.length, 1, 'the mobile timeline is still being rendered');
    const at = ide.indexOf('<Timeline />');
    // Walk back to the guard that decides whether it renders at all.
    const guard = ide.lastIndexOf("mode === 'editor' && !isMobile", at);
    assert.ok(guard > 0 && at - guard < 1200,
        'the surviving mount is not the one behind the !isMobile guard');
});

check('no mobile block carries the timeline hint anchor any more', () => {
    const anchors = ide.match(/data-hint="timeline-strip"/g) || [];
    assert.equal(anchors.length, 1, 'the mobile copy of the anchor is still there');
    // first_clip and first_ai_edit point at it (FirstRunHint.HINTS). A hint
    // whose anchor is not on screen dismisses itself silently, so the two
    // clip hints simply do not fire on a phone — but they must still fire on
    // a desktop, which means the anchor has to survive somewhere.
    const at = ide.indexOf('data-hint="timeline-strip"');
    const guard = ide.lastIndexOf("!isMobile", at);
    assert.ok(guard > 0 && at - guard < 1200, 'the surviving anchor is not on the desktop timeline');
});

check('the clip hints still have an anchor to find', () => {
    const hints = read('../client/src/components/FirstRunHint.jsx');
    assert.match(hints, /first_clip:\s+\{ anchor: 'timeline-strip'/);
    assert.match(hints, /if \(!el\) \{ dismiss\(\); return; \}/,
        'a missing anchor must say nothing rather than strand the hint');
});

// ── the chat collects the freed height ─────────────────────────────────────

check('the chat is still mounted in the editor column', () => {
    const mainAt = ide.indexOf('<main className="flex-1 flex flex-col min-w-0 min-h-0 relative">');
    const barAt = ide.indexOf('<MobileAIBar');
    const closeAt = ide.indexOf('</main>', mainAt);
    assert.ok(mainAt > 0 && barAt > mainAt && barAt < closeAt,
        'MobileAIBar has to be inside the flex column to take its share of it');
});

check('the chat takes the space the timeline had', () => {
    assert.match(bar, /"md:hidden w-full flex-1 flex flex-col border-t min-h-0"/,
        'flex-1 is the whole mechanism — without it the chat keeps its old height and the space is simply lost');
});

check('the preview stage does not compete for it', () => {
    const stage = ide.slice(ide.indexOf('ref={previewStageRef}'), ide.indexOf('ref={previewStageRef}') + 2400);
    assert.match(stage, /"relative overflow-hidden shrink-0"/,
        'a flex-1 stage would split the freed height with the chat instead of leaving it');
    assert.match(stage, /\? "w-full flex items-center justify-center"/,
        'the mobile branch must not add flex-1');
    assert.match(stage, /height: mobileShortPreviewMode \? '100dvh' : \(\(aspectRatio === '9:16' \|\| aspectRatio === '1:1'\) \? '45vh' : '56\.25vw'\)/,
        'an explicit height is what makes shrink-0 mean a fixed share');
});

check('the transport row is still there — preview and chat, per the ask', () => {
    assert.match(ide, /\{isMobile && !mobileShortPreviewMode && <MobileTransportBar \/>\}/);
    const transportAt = ide.indexOf('<MobileTransportBar />');
    const barAt = ide.indexOf('<MobileAIBar');
    assert.ok(transportAt < barAt, 'play/undo belong with the preview, above the chat');
});

// ── the chat reads like the surface it now is ──────────────────────────────

check('its header is a header, not a 10.5px strip label', () => {
    const header = bar.slice(bar.indexOf('aria-expanded={expanded}'), bar.indexOf('aria-expanded={expanded}') + 1400);
    const size = Number(/fontSize:\s+([\d.]+),/.exec(header)[1]);
    assert.ok(size >= 12, `${size}px uppercase mono is strip-label type, not the heading of the editing surface`);
    assert.match(header, /minHeight: 44/, 'it is a tap target that opens the full chat');
    assert.ok(!/color:\s+'var\(--fg-3\)'/.test(header), '--fg-3 on --bg-2 is barely legible at this size');
});

check('the chevron that opens the full chat is labelled', () => {
    assert.match(bar, /aria-label=\{t\('mobileRoka\.expand'\)\}/);
    assert.match(bar, /aria-label=\{t\('mobileRoka\.collapse'\)\}/);
});

check('the "now just ask" hint lands on the composer you can see', () => {
    // The desktop ChatComposer has the same anchor but is mounted off-screen
    // on a phone, and querySelector takes the first match in document order.
    assert.match(bar, /data-hint="assistant-input"/);
    const composer = read('../client/src/components/Assistant/ChatComposer.jsx');
    assert.match(composer, /data-hint="assistant-input"/, 'desktop keeps its own');
    const mainClose = ide.indexOf('</main>');
    const asideAt = ide.indexOf('<aside\n                        data-tour="ai-assistant"');
    assert.ok(mainClose > 0 && asideAt > mainClose,
        'the off-screen desktop panel must come AFTER the mobile bar in the DOM, or the hint points at it again');
});

for (const lang of ['en', 'fr']) {
    check(`${lang}: the chevron label is translated`, () => {
        const copy = JSON.parse(read(`../client/src/locales/${lang}/editor.json`));
        assert.ok(copy.mobileRoka.expand, 'mobileRoka.expand is missing');
        assert.ok(copy.mobileRoka.collapse);
        assert.ok(!copy.mobileRoka.expand.includes('—'));
    });
}

// ── what the timeline was the only way to do ───────────────────────────────

check('a clip can still be selected without a timeline', () => {
    // MobileToolbar switches to clip actions on activeTrackType / activeClipId.
    // The timeline's Clip.jsx was one way in; tapping the thing in the preview
    // is the other, and it is the one that survives on a phone.
    for (const file of ['Player/BaseClipOverlay.jsx', 'Player/TextOverlay.jsx', 'Player/GraphicOverlay.jsx']) {
        assert.match(read(`../client/src/components/${file}`), /setActiveClip\(clip\.id\)/,
            `${file} is the mobile way into the clip toolbar now`);
    }
    assert.match(ide, /activeTrackType=\{isMobile \? activeTrackType : null\}/,
        'so the clip-action toolbar is still wired');
});

check('the timeline itself is untouched for desktop', () => {
    const timeline = read('../client/src/components/Timeline/Timeline.jsx');
    // Its effects are all its own UI (scroll hint, pinch zoom, key handling),
    // so unmounting it on a phone takes nothing else with it. If something
    // shared ever moves in here, this is the assertion that should fail.
    assert.ok(!/EventBus\.emit/.test(timeline),
        'the timeline now only renders on desktop — anything it broadcasts would stop reaching phones');
});

console.log(`\nmobile chat editor: ${n} passed, 0 failed\n`);
