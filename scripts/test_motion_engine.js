#!/usr/bin/env node
/**
 * Regression: the Motion Graphics engine (CLAUDE.md R58).
 *
 * This codebase's defining failure mode is building something complete and
 * never connecting it — eight documented instances (R33's LUT import, R37's
 * UserStylePage, POST /api/brain/organize, R46's /account, R52's
 * CreativeDirector, R55's LUTExportIntegration, R55c's clip.grading, and
 * DirectorIntelligence, which was written to fix R52 and is itself unwired).
 *
 * So this file tests TWO different things, and the second matters more:
 *   §1-§5  the engine computes correct values (ordinary unit tests)
 *   §6-§8  the engine is actually REACHABLE — imported by real components,
 *          persisted through both projection lists, and not silently bypassed
 *
 * A green §1-§5 with a red §6 means we built instance nine.
 *
 * Run: node scripts/test_motion_engine.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const ROOT = path.resolve(__dirname, '..');
/**
 * Read a repo file. A missing file is reported as a FAILED CHECK rather than
 * an unhandled ENOENT that kills the run — a crashed test file looks the same
 * as a passing one in CI output, which is the worst possible failure mode for
 * a suite whose whole job is proving things are still connected.
 */
const read = (rel) => {
    try {
        return fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch (err) {
        console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`);
        failed++;
        return '';
    }
};

// ── Load the ESM motion modules into CommonJS ───────────────────────────────
// The client is ESM + Vite; this script is CJS like every other scripts/*.js.
// Rather than add a build step, strip the import/export syntax and eval the
// modules in dependency order. Crude, but it exercises the REAL source — a
// hand-rewritten copy would pass while the shipped file was broken.
function loadModules() {
    const sandbox = { console, Math, Number, Date, Array, Object, JSON, String, Boolean, isNaN, parseInt, parseFloat };
    const order = ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter', 'KeyframeBridge'];
    let combined = '';
    for (const name of order) {
        let src = read(`client/src/motion/${name}.js`);
        src = src
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')          // drop imports (all intra-module)
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '') // drop default export objects
            .replace(/^\s*export\s+default\s+[^;]+;\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
        combined += `\n/* ---- ${name} ---- */\n${src}\n`;
    }
    combined += '\nreturn { resolveEasing, listEasingNames, EASING_FUNCTIONS, clamp,'
             + ' LAYER_KINDS, ANIMATION_TYPES, createKeyframe, createAnimation, createMotionLayer, validateMotionLayer,'
             + ' sampleAnimation, resolveMotionAt,'
             + ' MOTION_PRESETS, buildPreset, presetsForKind, LEGACY_ANIMATION_MAP,'
             + ' groupWordsIntoSegments, activeWordIndex, revealedWordCount, CAPTION_STYLE_PACKS, stylePackToClipFields,'
             + ' clipToMotionLayer, motionLayerToClipUpdates, applyPresetToClip,'
             + ' animationsToParamTracks, paramTracksToAnimations, buildEditorModel, applyKeyframeOp,'
             + ' MOTION_PARAM_DEFS, CUSTOM_ANIMATION_ID, LEGACY_PACK_MOTION, legacyPackToCaptionStyle };\n';
    // eslint-disable-next-line no-new-func
    return new Function(combined)();
}

let M;
try {
    M = loadModules();
} catch (err) {
    console.error('FATAL: could not load client/src/motion/*.js —', err.message);
    process.exit(1);
}

section('1 · Easing resolves every spelling in use, and never throws');
{
    check('canonical camelCase resolves', typeof M.resolveEasing('easeOutCubic') === 'function');
    check('kebab-case resolves to the SAME function as camelCase',
        M.resolveEasing('ease-in-out') === M.resolveEasing('easeInOut'),
        "KeyframeEditor.jsx emits kebab-case; EffectNode's table is camelCase. Four of its five dropdown options silently fell back to linear.");
    check('unknown easing degrades to linear rather than throwing',
        M.resolveEasing('not-a-real-easing') === M.EASING_FUNCTIONS.linear);
    check('undefined/null degrade to linear',
        M.resolveEasing(undefined) === M.EASING_FUNCTIONS.linear && M.resolveEasing(null) === M.EASING_FUNCTIONS.linear);

    // An easing that doesn't hit its endpoints makes every animation land wrong.
    for (const name of Object.keys(M.EASING_FUNCTIONS)) {
        const fn = M.EASING_FUNCTIONS[name];
        check(`${name}: f(0)=0 and f(1)=1`,
            near(fn(0), 0, 1e-6) && near(fn(1), 1, 1e-6),
            `f(0)=${fn(0)}, f(1)=${fn(1)}`);
    }
}

section('2 · Keyframe interpolation');
{
    const anim = M.createAnimation({
        type: 'fade', duration: 1, easing: 'linear',
        keyframes: [M.createKeyframe(0, { opacity: 0 }), M.createKeyframe(1, { opacity: 1 })],
    });
    check('samples the start value at t=0', near(M.sampleAnimation(anim, 0).opacity, 0));
    check('samples the end value at t=duration', near(M.sampleAnimation(anim, 1).opacity, 1));
    check('interpolates linearly at the midpoint', near(M.sampleAnimation(anim, 0.5).opacity, 0.5));
    check('clamps before the first keyframe', near(M.sampleAnimation(anim, -5).opacity, 0));
    check('clamps after the last keyframe', near(M.sampleAnimation(anim, 99).opacity, 1));

    // Sparse per-property tracks: an animation touching only opacity must not
    // emit a scale value and silently reset everyone else's scale to 1.
    const sparse = M.createAnimation({
        type: 'fade', duration: 1, easing: 'linear',
        keyframes: [M.createKeyframe(0, { opacity: 0 }), M.createKeyframe(1, { opacity: 1 })],
    });
    check('only reports properties its keyframes actually mention',
        Object.keys(M.sampleAnimation(sparse, 0.5)).join(',') === 'opacity');

    check('keyframes are sorted on construction',
        M.createAnimation({ keyframes: [M.createKeyframe(1, { opacity: 1 }), M.createKeyframe(0, { opacity: 0 })] })
            .keyframes[0].time === 0);
}

section('3 · Layer resolution composes animations correctly');
{
    const layer = M.createMotionLayer({
        startTime: 10, duration: 2, x: 50, y: 80, scale: 1, opacity: 1,
        animations: M.buildPreset('fade', { duration: 2 }),
    });

    check('a layer is not visible before its start', M.resolveMotionAt(layer, 9.9).visible === false);
    check('a layer is visible inside its window',    M.resolveMotionAt(layer, 11).visible === true);
    check('a layer is not visible after its end',    M.resolveMotionAt(layer, 12.1).visible === false);

    check('opacity is 0 at the very start of a fade', near(M.resolveMotionAt(layer, 10).opacity, 0, 1e-3));
    check('opacity has reached 1 after the entrance', near(M.resolveMotionAt(layer, 11).opacity, 1, 1e-3));
    check('fade OUT anchors to the layer END, not its start',
        M.resolveMotionAt(layer, 12).opacity < 0.05,
        'an exit anchored to the start lands in the wrong place the moment a clip is trimmed');

    // Composition rules: translate adds, scale multiplies.
    const twoTranslate = M.createMotionLayer({
        startTime: 0, duration: 1, x: 50,
        animations: [
            M.createAnimation({ type: 'translate', duration: 1, easing: 'linear',
                keyframes: [M.createKeyframe(0, { x: 10 }), M.createKeyframe(1, { x: 10 })] }),
            M.createAnimation({ type: 'translate', duration: 1, easing: 'linear',
                keyframes: [M.createKeyframe(0, { x: 5 }), M.createKeyframe(1, { x: 5 })] }),
        ],
    });
    check('two translate animations ADD (50 + 10 + 5 = 65)',
        near(M.resolveMotionAt(twoTranslate, 0.5).x, 65));

    const twoScale = M.createMotionLayer({
        startTime: 0, duration: 1, scale: 2,
        animations: [
            M.createAnimation({ type: 'scale', duration: 1, easing: 'linear',
                keyframes: [M.createKeyframe(0, { scale: 0.5 }), M.createKeyframe(1, { scale: 0.5 })] }),
        ],
    });
    check('scale MULTIPLIES against the layer base (2 × 0.5 = 1)',
        near(M.resolveMotionAt(twoScale, 0.5).scale, 1));

    // Guard rails — a NaN reaching a CSS transform blanks the element silently.
    const junk = M.createMotionLayer({
        startTime: 0, duration: 1,
        animations: [M.createAnimation({ type: 'scale', duration: 1,
            keyframes: [M.createKeyframe(0, { scale: 1 })] })],
    });
    const r = M.resolveMotionAt(junk, 0.5);
    check('every resolved value is finite', [r.x, r.y, r.scale, r.rotation, r.opacity, r.blur, r.glow, r.reveal].every(Number.isFinite));
    check('opacity is clamped to 0..1', r.opacity >= 0 && r.opacity <= 1);
    check('resolving a null layer does not throw', M.resolveMotionAt(null, 0).visible === false);
}

section('4 · Every motion preset builds valid, non-empty animations');
{
    const ids = Object.keys(M.MOTION_PRESETS);
    check('the library has at least 20 presets', ids.length >= 20, `found ${ids.length}`);

    for (const id of ids) {
        const anims = M.buildPreset(id, { duration: 2 });
        const layer = M.createMotionLayer({ startTime: 0, duration: 2, animations: anims });
        const { valid, errors } = M.validateMotionLayer(layer);
        check(`${id}: builds a valid animation set`, anims.length > 0 && valid, errors.join('; '));

        // Every preset must be evaluable across its whole span without NaN.
        let clean = true;
        for (let t = 0; t <= 2.0001; t += 0.1) {
            const res = M.resolveMotionAt(layer, t);
            if (![res.x, res.y, res.scale, res.rotation, res.opacity].every(Number.isFinite)) { clean = false; break; }
        }
        check(`${id}: resolves cleanly across its full duration`, clean);
    }

    check('an unknown preset returns [] rather than throwing',
        Array.isArray(M.buildPreset('does-not-exist', {})) && M.buildPreset('does-not-exist', {}).length === 0,
        'a preset removed in a later version must not break an old project on load');

    check('presets are filtered by layer kind', M.presetsForKind(M.LAYER_KINDS.VIDEO).includes('camera-push'));
}

section('5 · Caption model preserves word timings (the R58 core fix)');
{
    const words = [
        { word: 'THIS',  start: 1.0, end: 1.2 },
        { word: 'IS',    start: 1.2, end: 1.3 },
        { word: 'CRAZY', start: 1.3, end: 1.6 },
    ];
    const segs = M.groupWordsIntoSegments(words, 6, 0.4);

    check('produces one segment for a tight word run', segs.length === 1);
    check('still emits the legacy text/start/end fields',
        segs[0].text === 'THIS IS CRAZY' && near(segs[0].start, 1.0) && near(segs[0].end, 1.6),
        'callers that ignore `words` must be completely unaffected');
    check('AND carries the word array through',
        Array.isArray(segs[0].words) && segs[0].words.length === 3,
        'this is the single line where per-word timing used to be discarded');
    check('word times are absolute, matching the segment clock',
        near(segs[0].words[0].start, 1.0) && near(segs[0].words[2].end, 1.6));

    check('splits on a pause longer than the threshold',
        M.groupWordsIntoSegments([
            { word: 'a', start: 0,   end: 0.1 },
            { word: 'b', start: 1.0, end: 1.1 },
        ], 6, 0.4).length === 2);
    check('splits at maxWords', M.groupWordsIntoSegments(
        Array.from({ length: 8 }, (_, i) => ({ word: `w${i}`, start: i * 0.1, end: i * 0.1 + 0.05 })), 3, 10
    ).length === 3);
    check('empty / garbage input returns []',
        M.groupWordsIntoSegments(null).length === 0 && M.groupWordsIntoSegments([]).length === 0);

    check('finds the active word by real timing', M.activeWordIndex(segs[0].words, 1.25) === 1);
    check('returns -1 outside any word', M.activeWordIndex(segs[0].words, 5) === -1);

    check('reveal count uses REAL word timings when present',
        M.revealedWordCount(segs[0].words, 1.25, 0, 3) === 2,
        'the old WordByWord could only guess from linear clip progress');
    check('reveal count falls back to linear progress without word data',
        M.revealedWordCount(null, 0, 0.5, 4) === 2);

    // Style packs must only reference fonts that actually ship — referencing a
    // font present in neither FONT_SPECS nor index.css is precisely the R57 bug.
    const exportSrc = read('jobs/exportProcessor.js');
    const cssSrc    = read('client/src/index.css');
    for (const pack of Object.values(M.CAPTION_STYLE_PACKS)) {
        check(`style pack "${pack.id}": font "${pack.fontFamily}" is in FONT_SPECS (export)`,
            exportSrc.includes(`'${pack.fontFamily}':`));
        check(`style pack "${pack.id}": font "${pack.fontFamily}" has an @font-face (preview)`,
            cssSrc.includes(`font-family: '${pack.fontFamily}'`));
    }

    const fields = M.stylePackToClipFields('mrbeast');
    check('a style pack converts to FLAT existing clip fields',
        fields.fontFamily === 'Anton' && fields.stroke && fields.captionStyle?.packId === 'mrbeast',
        'applying a pack must be an ordinary updateClip so every existing consumer picks it up');
    check('an unknown style pack returns null rather than throwing',
        M.stylePackToClipFields('nope') === null);
}

section('6 · The adapter keeps existing clips working (backwards compatibility)');
{
    // A clip made before R58: legacy single-string animation, no `animations`.
    const legacyClip = {
        id: 'c1', type: 'text', content: 'hello', start: 5, duration: 2,
        animation: 'pop', position: 'bottom', fontFamily: 'Anton',
    };
    const layer = M.clipToMotionLayer(legacyClip, { id: 't1', type: 'text' });
    check('a legacy clip adapts to a motion layer', !!layer);
    check('the legacy `animation` string still produces real animations',
        layer.animations.length > 0,
        'without this, every pre-R58 project silently stops animating');
    check("position:'bottom' maps to the same 85% the export uses",
        layer.x === 50 && layer.y === 85,
        'TextOverlay, exportProcessor and the adapter must agree on where "bottom" is');

    const noAnim = M.clipToMotionLayer({ id: 'c2', type: 'text', start: 0, duration: 1, animation: 'none' });
    check('animation:"none" yields a completely static layer', noAnim.animations.length === 0);
    const stat = M.resolveMotionAt(noAnim, 0.5);
    check('a static layer resolves to its base transform untouched',
        stat.scale === 1 && stat.opacity === 1 && stat.rotation === 0);

    check('numeric x/y win over the position enum',
        M.clipToMotionLayer({ id: 'c3', type: 'text', x: 20, y: 30, position: 'bottom', start: 0, duration: 1 }).y === 30);

    check('a caption clip (has words) is typed as a caption layer',
        M.clipToMotionLayer({ id: 'c4', type: 'text', start: 0, duration: 1,
            words: [{ text: 'a', start: 0, end: 0.2 }] }).kind === M.LAYER_KINDS.CAPTION);

    check('garbage input returns null rather than throwing', M.clipToMotionLayer(null) === null);

    const updates = M.motionLayerToClipUpdates(layer);
    check('writing back produces ordinary clip fields', updates.start === 5 && updates.duration === 2 && Array.isArray(updates.animations));
    check('writing back does NOT emit endTime',
        updates.endTime === undefined,
        'the timeline is start+duration everywhere; writing both invites them to disagree');

    const applied = M.applyPresetToClip({ id: 'c5', duration: 1 }, 'slide-up');
    check('applying a preset clears the legacy animation string',
        applied.animation === 'none' && applied.animations.length > 0,
        'leaving both set makes the UI show a selection that is not what renders');
}

section('7 · The engine is actually WIRED (not instance nine of the dead-code pattern)');
{
    const overlay  = read('client/src/components/Player/TextOverlay.jsx');
    const mediaEng = read('client/src/agent/MediaExecutionEngine.js');
    const tsm      = read('client/src/timeline/TimelineStateManager.js');
    const store    = read('client/src/store/useTimelineStore.js');

    check('TextOverlay imports the resolver',
        /from '\.\.\/\.\.\/motion\/MotionResolver\.js'/.test(overlay)
        && /resolveMotionAt\(layer, currentTime\)/.test(overlay),
        'TextOverlay is the ONLY mounted text renderer — if it does not call the engine, nothing does');
    check('TextOverlay imports the clip adapter',
        /clipToMotionLayer/.test(overlay));
    check('TextOverlay renders per-word when word timings exist',
        /CaptionWords/.test(overlay) && /clip\.words/.test(overlay));
    check('the superseded CSS keyframe path was REMOVED, not left dormant',
        !/const getAnimationStyle/.test(overlay) && !/vibed-overlay-anims/.test(overlay),
        'two systems both claiming to animate the same element is worse than either alone');

    check('caption grouping delegates to the caption model',
        /groupWordsIntoSegments/.test(mediaEng)
        && /from '\.\.\/motion\/CaptionModel\.js'/.test(mediaEng),
        'this is the one line where word timings used to die');

    // Persistence: a field in one projection list but not the other silently
    // vanishes on reload. That is exactly what was happening to `animation`.
    for (const field of ['animations', 'words', 'captionStyle']) {
        check(`"${field}" is projected out by toLegacyTracks`,
            new RegExp(`${field}: clip\\.${field}`).test(tsm));
        check(`"${field}" is read back by fromLegacyTracks`,
            new RegExp(`${field}: legacyClip\\.${field}`).test(tsm),
            'projected but not read back = silently lost on project reload');
    }
    check('the pre-existing `animation` round-trip bug is fixed too',
        /animation: legacyClip\.animation/.test(tsm),
        'it was projected out and never read back — text animations reset on every reload');

    check('addCaptionClips carries words onto the caption clip',
        /words:\s*Array\.isArray\(cap\.words\)/.test(store),
        'without this the words die one step later than they used to');
}

section('8 · Nothing that already worked was changed out from under it');
{
    const overlay = read('client/src/components/Player/TextOverlay.jsx');
    const store   = read('client/src/store/useTimelineStore.js');

    check('TextOverlay still routes edits through applyCaptionUpdate',
        /applyCaptionUpdate/.test(overlay),
        'R32: the global/per-segment caption scope toggle depends on this');
    check('drag / pinch / resize handlers are intact',
        /handlePointerDown/.test(overlay) && /handleResizePointerDown/.test(overlay));
    check('the caption overlap clamp is untouched',
        /Math\.min\(cap\.end \|\| 0, nextStart\)/.test(store));
    check('existing caption style inheritance still works',
        /existingTextClip\?\.fontFamily\s*\|\|\s*'Anton'/.test(store));
    // Purity check. Tests CODE, not prose — the module docs legitimately
    // discuss useTimelineStore when explaining why the engine stays out of it,
    // and a naive whole-file regex flags its own documentation.
    const stripComments = (src) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    const impure = [];
    for (const n of ['Easing', 'MotionSchema', 'MotionResolver', 'MotionPresets', 'CaptionModel', 'ClipAdapter']) {
        const code = stripComments(read(`client/src/motion/${n}.js`));
        if (/^\s*import\s[^;]*\bfrom\s*['"]react['"]/m.test(code))      impure.push(`${n}: imports react`);
        if (/^\s*import\s[^;]*useTimelineStore/m.test(code))            impure.push(`${n}: imports the store`);
        if (/\bdocument\s*\./.test(code))                               impure.push(`${n}: touches the DOM`);
        if (/\bwindow\s*\./.test(code))                                 impure.push(`${n}: touches window`);
        // Every import must stay inside the motion module — a dependency on
        // any other part of the app is how "pure core" quietly stops being one.
        const externalImports = (code.match(/^\s*import\s[^;]*from\s*['"]([^'"]+)['"]/gm) || [])
            .map(l => (l.match(/from\s*['"]([^'"]+)['"]/) || [])[1])
            .filter(p => p && !p.startsWith('./'));
        if (externalImports.length > 0) impure.push(`${n}: imports outside motion/ (${externalImports.join(', ')})`);
    }
    check('the motion engine has no React/DOM/store/cross-module dependency',
        impure.length === 0,
        impure.join('; ') || 'purity is what lets preview, canvas and export share one implementation');
}


section('9 · The keyframe bridge round-trips (R61)');
{
    const clip = { id: 'c1', type: 'text', start: 0, duration: 4,
                   animations: M.buildPreset('pop', { duration: 4 }) };

    const tracks = M.animationsToParamTracks(clip.animations, 4);
    check('a preset\'s animations expose per-parameter tracks',
        Object.keys(tracks).length > 0 && Array.isArray(tracks.scale),
        'the editor filters on float params; nothing to show means nothing to edit');
    check('track keyframes are ascending in time',
        tracks.scale.every((kf, i, a) => i === 0 || kf.time >= a[i - 1].time));

    // Round-trip must not lose keyframes.
    const back = M.paramTracksToAnimations(tracks, 4);
    const backTracks = M.animationsToParamTracks(back, 4);
    check('tracks survive a round-trip through the animation model',
        JSON.stringify(Object.keys(tracks).sort()) === JSON.stringify(Object.keys(backTracks).sort()));
    check('a round-trip collapses to ONE custom animation',
        back.length === 1 && back[0].id === M.CUSTOM_ANIMATION_ID,
        'two animations both driving scale have no sane representation in a flat per-parameter timeline');

    // An 'out'-anchored animation must map to real clip-local time, not 0.
    const fadeClip = { id: 'c2', duration: 6, animations: M.buildPreset('fade', { duration: 6 }) };
    const fadeTracks = M.animationsToParamTracks(fadeClip.animations, 6);
    check('an exit anchored to the clip END lands late in the timeline, not at 0',
        Array.isArray(fadeTracks.opacity) && Math.max(...fadeTracks.opacity.map(k => k.time)) > 3,
        'anchoring exits to the start would put every fade-out in the wrong place');

    const added = M.applyKeyframeOp(clip, { kind: 'add', param: 'opacity', time: 1.5, value: 0.5 });
    check('adding a keyframe returns clip updates', Array.isArray(added.animations) && added.animations.length === 1);
    check('adding clears the legacy animation string', added.animation === 'none',
        'both set means the Text panel shows a selection that is not what renders');
    const addedTracks = M.animationsToParamTracks(added.animations, 4);
    check('the added keyframe is present at the right time',
        addedTracks.opacity.some(k => Math.abs(k.time - 1.5) < 1e-3));

    const removed = M.applyKeyframeOp({ ...clip, animations: added.animations },
        { kind: 'remove', param: 'opacity', time: 1.5 });
    const removedTracks = M.animationsToParamTracks(removed.animations, 4);
    check('removing a keyframe removes it',
        !(removedTracks.opacity || []).some(k => Math.abs(k.time - 1.5) < 1e-3));

    check('two keyframes at the same instant replace rather than stack',
        M.animationsToParamTracks(
            M.applyKeyframeOp({ ...clip, animations: added.animations },
                { kind: 'add', param: 'opacity', time: 1.5, value: 0.9 }).animations, 4
        ).opacity.filter(k => Math.abs(k.time - 1.5) < 1e-3).length === 1,
        'duplicates at one instant make interpolation order-dependent');

    check('an unknown parameter is ignored, not thrown on',
        Object.keys(M.applyKeyframeOp(clip, { kind: 'add', param: 'nope', time: 1 })).length === 0);
    check('garbage input never throws',
        Object.keys(M.applyKeyframeOp(null, null)).length === 0);

    const model = M.buildEditorModel(clip);
    check('the editor model exposes float params (what KeyframeEditor filters on)',
        Object.values(model.definition.params).every(d => d.type === 'float'),
        'KeyframeEditor only renders params whose type is float/int');
    check('buildEditorModel handles a null clip', M.buildEditorModel(null) === null);
}

section('10 · REACHABILITY — the engine has callers outside the test suite (R61)');
{
    const panel  = read('client/src/components/MotionPanel.jsx');
    const ide    = read('client/src/layouts/IDELayout.jsx');
    const reason = read('client/src/components/Assistant/ReasoningPanel.jsx');

    // This section is the point of R61. The engine was complete and almost
    // entirely uncallable — 21 of 26 presets, all 8 style packs and the whole
    // keyframe editor had no caller but these tests. That is this codebase's
    // signature failure (CLAUDE.md counts eight prior instances).
    check('MotionPanel calls applyPresetToClip',
        /applyPresetToClip/.test(panel),
        'without a caller the 26 presets are library code, not a feature');
    check('MotionPanel mounts the previously-orphaned KeyframeEditor',
        /<KeyframeEditor/.test(panel) && /from '\.\/Effects\/KeyframeEditor\.jsx'/.test(panel));
    check('MotionPanel wires the editor callbacks to real store writes',
        /onAddKeyframe=/.test(panel) && /onRemoveKeyframe=/.test(panel) && /updateClip\(trackId, clip\.id, updates\)/.test(panel));

    // Both halves of a tab are required — this file has three render branches
    // whose buttons were trimmed from the array, so they can never be selected.
    check('IDELayout imports MotionPanel', /import MotionPanel from/.test(ide));
    check("'motion' is in the CLICKABLE tab array",
        /\['media', 'captions', 'transcript', 'color', 'motion'/.test(ide),
        'a render branch with no tab button is unreachable — see effects/interview/marketplace');
    check("'motion' has a render branch",
        /activeTab === 'motion' && <MotionPanel \/>/.test(ide));

    check('the caption style picker applies the MOTION half of a pack',
        /captionStyle: legacyPackToCaptionStyle\(style\.id\)/.test(reason),
        'this card set only visual properties, which is why every pack\'s uppercase flag was applied to nothing');
    check('and it imports the mapping', /legacyPackToCaptionStyle/.test(reason)
        && /from '\.\.\/\.\.\/motion\/CaptionModel\.js'/.test(reason));

    // Every pack the existing picker offers must have motion behaviour, or
    // picking it silently drops the animation half.
    const packIds = [...reason.matchAll(/id: '([a-z-]+)',\s+name: '/g)].map(m => m[1]);
    check('the existing picker\'s packs were all found', packIds.length >= 10, `found ${packIds.length}`);
    const unmapped = packIds.filter(id => !M.LEGACY_PACK_MOTION[id]);
    check('every style pack in that picker has a motion mapping',
        unmapped.length === 0, `unmapped: ${unmapped.join(', ')}`);
    check('an unmapped pack degrades safely rather than returning null',
        M.legacyPackToCaptionStyle('does-not-exist')?.wordHighlight?.mode === 'none',
        'returning null in a style-apply path would drop the motion half silently');

    // Every preset the panel can offer must actually exist.
    const groups = ['text', 'image', 'sticker', 'camera'];
    const offered = groups.flatMap(g => M.presetsForKind(
        g === 'camera' ? M.LAYER_KINDS.VIDEO
        : g === 'image' ? M.LAYER_KINDS.IMAGE
        : g === 'sticker' ? M.LAYER_KINDS.STICKER
        : M.LAYER_KINDS.TEXT));
    check('every preset the panel can offer resolves to a real preset',
        offered.length > 0 && offered.every(id => !!M.MOTION_PRESETS[id]),
        `${offered.length} offered`);
}

section('11 · REACHABILITY — the "overlay" graphics track has real callers (R62)');
{
    const store    = read('client/src/store/useTimelineStore.js');
    const dragAsset = read('client/src/components/DraggableAsset.jsx');
    const ide      = read('client/src/layouts/IDELayout.jsx');
    const schema   = read('client/src/timeline/TimelineSchema.js');
    const adapter  = read('client/src/motion/ClipAdapter.js');
    const compositor = read('client/src/motion/Compositor.js');

    // Data model: creating a clip is pointless if nothing can ever call it —
    // the same "built but never wired" check as §10, applied to R62's action.
    check('useTimelineStore exposes addOverlayClip',
        /addOverlayClip:\s*\(asset/.test(store));
    check('addOverlayClip creates/reuses an \'overlay\' track and adds a clip',
        /get\(\)\.addTrack\('overlay'\)/.test(store) && /get\(\)\.addClip\(trackId/.test(store));

    check('DraggableAsset has a real UI entry point that calls it',
        /addOverlayClip\(asset\)/.test(dragAsset),
        'a store action nobody\'s UI calls is exactly instance nine of the dead-code pattern');
    check('...gated to image assets, matching what the compositor can actually source',
        /asset\.type === 'image'/.test(dragAsset));

    // Preview: the DOM overlay renderer must exist, be imported, and be
    // mounted — not just written.
    check('GraphicOverlay.jsx exists',
        read('client/src/components/Player/GraphicOverlay.jsx').includes('export default GraphicOverlay'));
    check('IDELayout imports GraphicOverlay', /import GraphicOverlay from/.test(ide));
    check('IDELayout mounts <GraphicOverlay />', /<GraphicOverlay \/>/.test(ide));

    // Double-render guard: overlay tracks must be excluded from the Revideo
    // player variables the same way text tracks are — otherwise a sticker
    // renders three times (Revideo canvas + GraphicOverlay DOM + compositor
    // export pass) and every drag reloads the Revideo scene.
    check("IDELayout excludes 'overlay' tracks from the Revideo player, like it already does for 'text'",
        /t\.type !== 'text' && t\.type !== 'overlay'/.test(ide),
        'without this, a sticker would triple-render and every drag would reload the Revideo scene');

    // Ordering: an 'overlay' track landing in the TYPE_ORDER 99-bucket would
    // silently sort wherever object-iteration order happens to put it.
    check("TimelineSchema's getSortedLayers has an explicit 'overlay' bucket",
        /'overlay':\s*2/.test(schema));

    // Kind inference: a clip on an overlay track with no clip.type of its own
    // must not be misread as a caption/text layer (wrong resolver behaviour —
    // e.g. word-highlight code would run against a sticker).
    check("ClipAdapter's inferKind has an explicit 'overlay' → IMAGE fallback",
        /if \(t === 'overlay'\) return LAYER_KINDS\.IMAGE;/.test(adapter));

    // The compositor is the piece that makes an overlay track reach the
    // EXPORTED video, not just the preview (see caption engine's answer:
    // captions still don't reach export because drawtext doesn't read the
    // motion fields — overlay tracks must not repeat that gap).
    check("Compositor's VISUAL_TRACK_TYPES includes 'overlay'",
        /VISUAL_TRACK_TYPES = new Set\(\['video', 'image', 'overlay'\]\)/.test(compositor));
    check('the base track is chosen by TYPE, not array position — an overlay track can never become the base',
        /baseTrack = visual\.find\(t => t\.type === 'video' \|\| t\.type === 'image'\)/.test(compositor),
        'visual[0] would let an overlay track become "base" whenever its order value ties with the video track\'s');
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Motion engine: ${passed} passed, ${failed} failed`);
console.log('─'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
