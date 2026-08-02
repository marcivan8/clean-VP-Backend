/**
 * scripts/test_caption_scope.js
 *
 *   node scripts/test_caption_scope.js
 *
 * Pins the caption edit-scope contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * Captions are editable from TWO surfaces: the Text panel and directly on the
 * playback canvas (drag / pinch / corner-resize in TextOverlay). The
 * global/individual toggle lived in TextPanel's local `useState`, so the canvas
 * had no way to read it and every canvas edit called `updateClip()` directly —
 * i.e. always single-segment. The user would set "Global", drag a caption, and
 * watch exactly one segment move while the rest stayed put. One setting, two
 * behaviours depending on where you happened to touch it.
 *
 * The fix is a single scope-aware store action (`applyCaptionUpdate`) that both
 * surfaces call. This file tests that action's semantics directly, plus a static
 * check that no caption surface has quietly reintroduced a direct write.
 *
 * The interesting rules, all of which are invisible in the source text:
 *   - global scope fans style across EVERY text track, not just the edited one
 *   - `content` (the caption's words) is ALWAYS per-segment, even in global
 *     scope — fanning it out would overwrite every caption with the same text
 *   - `liveOnly` keeps a mid-drag update single-clip so a 200-caption project
 *     doesn't take N store writes per pointer event
 *
 * No browser, no network, no credentials.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let failures = 0;
const check = (name, cond, detail) => {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
    }
};

// ── A faithful re-implementation of applyCaptionUpdate's contract ────────────
// The real action is defined inside a Zustand closure that needs React and the
// TimelineStateManager to instantiate. Rather than boot all of that, we mirror
// the semantics here and separately assert (section 5) that the real source
// still has the branches this model depends on.
function makeStore(tracks, scope = 'global') {
    return {
        tracks,
        captionEditScope: scope,
        historySaves: 0,
        writes: [],
        _saveHistory() { this.historySaves++; },
        updateClip(trackId, clipId, updates) {
            this.writes.push({ trackId, clipId, updates });
            const tr = this.tracks.find(t => t.id === trackId);
            const cl = tr?.clips.find(c => c.id === clipId);
            if (cl) Object.assign(cl, updates);
        },
        applyCaptionUpdate(updates, opts = {}) {
            const { clipId = null, scope = null, skipHistory = false, liveOnly = false } = opts;
            const effectiveScope = scope || this.captionEditScope || 'global';
            const { content, ...styleOnly } = updates || {};
            const hasStyle = Object.keys(styleOnly).length > 0;

            const textTracks = (this.tracks || []).filter(t => t.type === 'text');
            if (textTracks.length === 0) return 0;

            const ownerTrack = clipId ? textTracks.find(t => t.clips.some(c => c.id === clipId)) : null;
            if (!skipHistory) this._saveHistory();

            let updated = 0;
            if (hasStyle) {
                if (effectiveScope === 'global' && !liveOnly) {
                    for (const track of textTracks) {
                        for (const clip of (track.clips || [])) {
                            this.updateClip(track.id, clip.id, styleOnly);
                            updated++;
                        }
                    }
                } else if (clipId && ownerTrack) {
                    this.updateClip(ownerTrack.id, clipId, styleOnly);
                    updated++;
                }
            }
            if (content !== undefined && clipId && ownerTrack) {
                this.updateClip(ownerTrack.id, clipId, { content });
                if (!hasStyle) updated++;
            }
            return updated;
        },
    };
}

const captions = (n, prefix = 'c') =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, content: `line ${i}`, x: 50, y: 85, scale: 1 }));

console.log('\n── 1. Global scope fans a style change to every caption ──');
{
    const s = makeStore([{ id: 'text-1', type: 'text', clips: captions(5) }], 'global');
    const n = s.applyCaptionUpdate({ y: 20 }, { clipId: 'c2' });
    check('all 5 captions updated', n === 5, `updated ${n}`);
    check('every caption moved', s.tracks[0].clips.every(c => c.y === 20));
    check('exactly one undo entry for the batch', s.historySaves === 1,
        'N history saves would make a single edit take N undos to reverse.');
}

console.log('\n── 2. Individual scope touches only the edited caption ──');
{
    const s = makeStore([{ id: 'text-1', type: 'text', clips: captions(5) }], 'individual');
    const n = s.applyCaptionUpdate({ y: 20 }, { clipId: 'c2' });
    check('exactly 1 caption updated', n === 1);
    check('the edited caption moved', s.tracks[0].clips.find(c => c.id === 'c2').y === 20);
    check('the others did not', s.tracks[0].clips.filter(c => c.id !== 'c2').every(c => c.y === 85));
}

console.log('\n── 3. content is ALWAYS per-segment, even in global scope ──');
{
    const s = makeStore([{ id: 'text-1', type: 'text', clips: captions(4) }], 'global');
    s.applyCaptionUpdate({ content: 'edited', y: 30 }, { clipId: 'c1' });
    const clips = s.tracks[0].clips;
    check('only the edited caption got the new text',
        clips.find(c => c.id === 'c1').content === 'edited' &&
        clips.filter(c => c.id !== 'c1').every(c => c.content !== 'edited'),
        'Fanning content out would overwrite every caption in the project with the same words.');
    check('the style part still fanned out to all', clips.every(c => c.y === 30));
}

console.log('\n── 4. liveOnly keeps a mid-drag update to one clip ──');
{
    const s = makeStore([{ id: 'text-1', type: 'text', clips: captions(200) }], 'global');
    s.writes = [];
    // Simulate 30 pointermove events during a drag.
    for (let i = 0; i < 30; i++) {
        s.applyCaptionUpdate({ x: 50 + i }, { clipId: 'c7', skipHistory: true, liveOnly: true });
    }
    check('a 30-move drag over 200 captions made 30 writes, not 6000',
        s.writes.length === 30, `made ${s.writes.length}`);
    check('no history entries were created mid-drag', s.historySaves === 0);

    // Commit on pointer-up — NOW it fans out.
    s.writes = [];
    const n = s.applyCaptionUpdate({ x: 79 }, { clipId: 'c7', skipHistory: true });
    check('pointer-up commit reaches all 200 captions', n === 200, `reached ${n}`);
    check('final position propagated', s.tracks[0].clips.every(c => c.x === 79),
        'Without the commit, the canvas would still behave as if scope were always individual.');
}

console.log('\n── 5. Global means global across MULTIPLE text tracks ──');
{
    const s = makeStore([
        { id: 'text-1', type: 'text',  clips: captions(3, 'a') },
        { id: 'text-2', type: 'text',  clips: captions(2, 'b') },
        { id: 'vid-1',  type: 'video', clips: [{ id: 'v0' }] },
    ], 'global');
    const n = s.applyCaptionUpdate({ fontSize: 42 }, { clipId: 'a0' });
    check('both text tracks were updated', n === 5, `updated ${n}`);
    check('the video track was untouched', s.tracks[2].clips[0].fontSize === undefined);
}

console.log('\n── 6. An explicit scope overrides the store setting ──');
{
    // The per-segment editor rows pass scope:'individual' explicitly so they stay
    // local even while the panel-wide toggle says global.
    const s = makeStore([{ id: 'text-1', type: 'text', clips: captions(4) }], 'global');
    const n = s.applyCaptionUpdate({ y: 10 }, { clipId: 'c1', scope: 'individual' });
    check('explicit individual scope wins over global store scope', n === 1);
    check('only the targeted caption changed',
        s.tracks[0].clips.filter(c => c.y === 10).length === 1);
}

console.log('\n── 7. Every caption surface routes through the shared action ──');
{
    const root = path.resolve(__dirname, '..');
    const panel   = fs.readFileSync(path.join(root, 'client/src/components/TextPanel.jsx'), 'utf8');
    const overlay = fs.readFileSync(path.join(root, 'client/src/components/Player/TextOverlay.jsx'), 'utf8');
    const store   = fs.readFileSync(path.join(root, 'client/src/store/useTimelineStore.js'), 'utf8');

    // A direct updateClip() call from either surface reintroduces the split-brain.
    const stripComments = (src) => src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    check('TextPanel makes no direct updateClip call',
        !/\bupdateClip\s*\(/.test(stripComments(panel)),
        'Caption edits must go through applyCaptionUpdate or the scope toggle stops meaning anything.');
    check('TextOverlay makes no direct updateClip call',
        !/\bupdateClip\s*\(/.test(stripComments(overlay)));
    check('TextPanel reads scope from the store, not local useState',
        /captionEditScope/.test(panel) && !/useState\(['"]global['"]\)/.test(panel),
        'Component-local scope is invisible to the canvas — that WAS the bug.');
    check('TextOverlay uses applyCaptionUpdate', /applyCaptionUpdate/.test(overlay));

    // The model above is only meaningful if the real action still has these branches.
    check('store action exists', /applyCaptionUpdate:\s*\(/.test(store));
    check('store action honours liveOnly', /liveOnly/.test(store));
    check('store action separates content from style', /const \{ content, \.\.\.styleOnly \}/.test(store));
    check('store exposes the scope setter', /setCaptionEditScope:/.test(store));
}

console.log(
    failures === 0
        ? '\nALL CAPTION SCOPE TESTS PASSED\n'
        : `\n${failures} CAPTION SCOPE TEST(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
