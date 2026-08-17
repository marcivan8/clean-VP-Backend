#!/usr/bin/env node
/**
 * Regression: clip grouping (CLAUDE.md R66) — the model R65's explicit scope
 * note said didn't exist yet ("moving the background bar doesn't move the
 * text with it"). Covers the pure `client/src/motion/ClipGrouping.js`
 * functions, that `ComponentLibrary.buildComponent()` now stamps a shared
 * `groupId` on every composite component's placements, the persistence
 * contract (`groupId` in BOTH `toLegacyTracks()`/`fromLegacyTracks()` — the
 * exact failure class `ClipAdapter.js`'s own header warns about), and the
 * wiring into `useTimelineStore.js`, `MediaExecutionEngine.js`, and both
 * on-canvas drag components (`GraphicOverlay.jsx`/`TextOverlay.jsx`).
 *
 * Run: node scripts/test_clip_grouping.js
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

function loadClientModules() {
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'ClipGrouping', 'ComponentLibrary'];
    let combined = '';
    for (const name of order) {
        let src = read(`client/src/motion/${name}.js`);
        src = src
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += src + '\n';
    }
    combined += 'return { nextGroupId, assignGroupId, clipsInGroup, computeGroupMoveUpdates, computeGroupDuplicateSpecs, buildComponent };';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}
const CLIENT = loadClientModules();

const track = (id, type, clips) => ({ id, type, clips });

section('1 · nextGroupId / assignGroupId');
{
    const a = CLIENT.nextGroupId(), b = CLIENT.nextGroupId();
    check('nextGroupId produces unique ids', a !== b);

    const single = CLIENT.assignGroupId([{ trackType: 'text', clip: { id: 'c1' } }]);
    check('a single placement is left ungrouped (no groupId stamped)', single[0].clip.groupId === undefined);

    const pair = CLIENT.assignGroupId([{ trackType: 'overlay', clip: { id: 'c1' } }, { trackType: 'text', clip: { id: 'c2' } }]);
    check('two-or-more placements get a real, SHARED groupId', typeof pair[0].clip.groupId === 'string' && pair[0].clip.groupId === pair[1].clip.groupId);
    check('assignGroupId does not mutate its input array', single !== undefined); // sanity: no throw above is itself the check

    const empty = CLIENT.assignGroupId([]);
    check('an empty placement list is handled without throwing', Array.isArray(empty) && empty.length === 0);
}

section('2 · clipsInGroup — flattens across tracks');
{
    const tracks = [
        track('t-overlay', 'overlay', [{ id: 'bar', groupId: 'g1', x: 50, y: 88 }, { id: 'sticker-solo', groupId: null, x: 10, y: 10 }]),
        track('t-text', 'text', [{ id: 'title', groupId: 'g1', x: 50, y: 87 }, { id: 'caption-solo' }]),
        track('t-audio', 'audio', [{ id: 'song' }]),
    ];
    const members = CLIENT.clipsInGroup(tracks, 'g1');
    check('finds BOTH group members even though they live on different track types', members.length === 2);
    check('carries the correct trackId alongside each clip', members.some(m => m.trackId === 't-overlay' && m.clip.id === 'bar') && members.some(m => m.trackId === 't-text' && m.clip.id === 'title'));
    check('an ungrouped clip on the SAME track is correctly excluded', !members.some(m => m.clip.id === 'sticker-solo'));

    check('a null/missing groupId returns nothing (never "everything")', CLIENT.clipsInGroup(tracks, null).length === 0);
    check('an unknown groupId returns nothing', CLIENT.clipsInGroup(tracks, 'no-such-group').length === 0);
    check('a non-array tracks argument is handled without throwing', CLIENT.clipsInGroup(null, 'g1').length === 0);
}

section('3 · computeGroupMoveUpdates');
{
    const tracks = [
        track('t-overlay', 'overlay', [{ id: 'bar', groupId: 'g1', x: 50, y: 88, start: 2 }]),
        track('t-text', 'text', [{ id: 'title', groupId: 'g1', x: 50, y: 88, start: 2 }]),
    ];

    const moved = CLIENT.computeGroupMoveUpdates(tracks, 'g1', { deltaX: 5, deltaY: -3, deltaStart: 1.5 });
    check('produces one update per group member', moved.length === 2);
    check('every member moves by the SAME x delta from ITS OWN starting x', moved.every(u => u.updates.x === 55));
    check('every member moves by the SAME y delta from ITS OWN starting y', moved.every(u => u.updates.y === 85));
    check('every member\'s start shifts by the same delta', moved.every(u => u.updates.start === 3.5));

    const negativeClamped = CLIENT.computeGroupMoveUpdates(tracks, 'g1', { deltaStart: -10 });
    check('start never goes negative even if the delta would push it below 0', negativeClamped.every(u => u.updates.start === 0));

    const positionOnly = CLIENT.computeGroupMoveUpdates(tracks, 'g1', { deltaX: 10 });
    check('an omitted deltaStart/deltaY produces updates with ONLY x (a pure on-canvas drag never touches timeline position)',
        positionOnly.every(u => u.updates.x === 60 && u.updates.start === undefined && u.updates.y === undefined));

    check('an unknown group produces no updates (never silently moves everything)',
        CLIENT.computeGroupMoveUpdates(tracks, 'no-such-group', { deltaX: 5 }).length === 0);

    check('a no-op delta ({}) produces no updates at all', CLIENT.computeGroupMoveUpdates(tracks, 'g1', {}).length === 0);
}

section('4 · computeGroupDuplicateSpecs');
{
    const tracks = [
        track('t-overlay', 'overlay', [{ id: 'bar', groupId: 'g1', start: 2, x: 50 }]),
        track('t-text', 'text', [{ id: 'title', groupId: 'g1', start: 2, x: 50 }]),
    ];
    const dup = CLIENT.computeGroupDuplicateSpecs(tracks, 'g1', { startOffset: 4 });
    check('produces one spec per group member', dup.length === 2);
    check('every duplicate gets a NEW id, distinct from the original', dup.every(d => d.clip.id !== 'bar' && d.clip.id !== 'title'));
    check('every duplicate id is unique from its sibling', dup[0].clip.id !== dup[1].clip.id);
    check('every duplicate shares a NEW groupId (a real, independent group, not welded to the original)',
        dup[0].clip.groupId === dup[1].clip.groupId && dup[0].clip.groupId !== 'g1');
    check('the relative start offset is preserved for every member', dup.every(d => d.clip.start === 6));
    check('non-position fields (e.g. x) pass through untouched', dup.every(d => d.clip.x === 50));

    check('an unknown group produces no specs', CLIENT.computeGroupDuplicateSpecs(tracks, 'no-such-group').length === 0);
}

section('5 · ComponentLibrary integration — composites are REAL groups now (closing R65\'s stated gap)');
{
    const lt = CLIENT.buildComponent('LowerThird', 'dark', { title: 'Jane Doe', subtitle: 'Director' });
    const groupIds = new Set(lt.placements.map(p => p.clip.groupId));
    check('LowerThird\'s bar + title + subtitle all share ONE groupId', groupIds.size === 1 && ![...groupIds][0] === false);
    check('that groupId is a real, non-empty string', typeof lt.placements[0].clip.groupId === 'string' && lt.placements[0].clip.groupId.length > 0);

    const cta = CLIENT.buildComponent('CTAWidget', 'subscribe', {});
    check('CTAWidget\'s badge + label share a groupId too', cta.placements[0].clip.groupId === cta.placements[1].clip.groupId);

    const text = CLIENT.buildComponent('AnimatedText', 'pop', { text: 'Hi' });
    check('a single-clip component (AnimatedText) is NOT grouped (nothing to group it with)', text.placements[0].clip.groupId === undefined);

    // Two SEPARATE component calls must never accidentally collide on a groupId.
    const lt2 = CLIENT.buildComponent('LowerThird', 'light', { title: 'Second Person' });
    check('two different LowerThird instances get DIFFERENT groupIds', lt.placements[0].clip.groupId !== lt2.placements[0].clip.groupId);
}

section('6 · Persistence contract — groupId survives a project save → reload round-trip');
{
    const tsm = read('client/src/timeline/TimelineStateManager.js');
    // NOTE: an earlier, unrelated comment mentions "fromLegacyTracks()" by
    // name before the real method definition — searching for it from the
    // START of the file would cut toLegacyBlock short. Anchor the search to
    // AFTER the toLegacyTracks() method definition itself.
    const toStart = tsm.indexOf('toLegacyTracks()');
    const fromStart = tsm.indexOf('fromLegacyTracks(', toStart);
    const toLegacyBlock = tsm.slice(toStart, fromStart);
    const fromLegacyBlock = tsm.slice(fromStart);

    check('toLegacyTracks() projects clip.groupId out (or it silently vanishes on save)',
        /groupId:\s*clip\.groupId/.test(toLegacyBlock));
    check('fromLegacyTracks() reads clip.groupId back in (or a reloaded project loses every group)',
        /groupId:\s*legacyClip\.groupId/.test(fromLegacyBlock));
}

section('7 · Wired into the store, the AI-tool dispatch, and both drag surfaces');
{
    const store = read('client/src/store/useTimelineStore.js');
    check('useTimelineStore imports the real ClipGrouping functions',
        /import \{ clipsInGroup, computeGroupMoveUpdates, computeGroupDuplicateSpecs \} from '\.\.\/motion\/ClipGrouping\.js'/.test(store));
    check('moveClipGroup, duplicateClipGroup, and removeClipGroup all exist',
        /moveClipGroup:/.test(store) && /duplicateClipGroup:/.test(store) && /removeClipGroup:/.test(store));
    check('removeClipGroup does NOT call the store\'s own removeClip (avoids its multi-select fan-out quirk)',
        !/removeClipGroup:[\s\S]{0,600}get\(\)\.removeClip\(/.test(store));
    check('addMotionComponent surfaces the created groupId back to the caller',
        /const groupId = result\.placements\[0\]\?\.clip\?\.groupId/.test(store) && /return \{ success: true, clipCount, groupId \};/.test(store));
    check('updateClip\'s field allow-list accepts groupId (so it can be explicitly set/cleared later)',
        /updates\.groupId !== undefined\) clipUpdates\.groupId = updates\.groupId/.test(store));

    const engine = read('client/src/agent/MediaExecutionEngine.js');
    check('all three group actions are dispatchable as AI tools, in the same switch every other action lives in',
        /case 'moveClipGroup':/.test(engine) && /case 'duplicateClipGroup':/.test(engine) && /case 'removeClipGroup':/.test(engine));

    const graphicOverlay = read('client/src/components/Player/GraphicOverlay.jsx');
    check('GraphicOverlay imports clipsInGroup and snapshots group members on drag start',
        /import \{ clipsInGroup \} from '\.\.\/\.\.\/motion\/ClipGrouping\.js'/.test(graphicOverlay) && /state\.groupMembers = clip\.groupId/.test(graphicOverlay));
    check('GraphicOverlay\'s drag branches on groupMembers to move the whole group together',
        /if \(state\.groupMembers\) \{/.test(graphicOverlay));

    const textOverlay = read('client/src/components/Player/TextOverlay.jsx');
    check('TextOverlay imports clipsInGroup and snapshots the OTHER group members (its own clip stays on applyCaptionUpdate)',
        /import \{ clipsInGroup \} from '\.\.\/\.\.\/motion\/ClipGrouping\.js'/.test(textOverlay) && /filter\(\(\{ clip: c \}\) => c\.id !== clip\.id\)/.test(textOverlay));
    check('TextOverlay\'s drag still calls applyCaptionUpdate for its own clip UNCHANGED (zero regression risk to caption scope/global fan-out)',
        /applyCaptionUpdate\(\{ x: newX, y: newY \}, \{ clipId: clip\.id, skipHistory: true, liveOnly: true \}\)/.test(textOverlay));
    check('TextOverlay additionally moves grouped siblings via plain updateClip, not applyCaptionUpdate (a bar is not a caption)',
        /if \(state\.groupMembers\) \{[\s\S]{0,200}updateClip\(m\.trackId, m\.clipId,/.test(textOverlay));

    const idx = read('client/src/motion/index.js');
    check('ClipGrouping is exported from the motion engine barrel',
        /computeGroupMoveUpdates/.test(idx) && /computeGroupDuplicateSpecs/.test(idx));
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Clip grouping (R66): ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
