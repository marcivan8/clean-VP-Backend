import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { MOTION_PRESETS, PRESET_GROUPS, buildPreset } = await import('../client/src/motion/MotionPresets.js');
const { createMotionLayer, LAYER_KINDS, validateMotionLayer } = await import('../client/src/motion/MotionSchema.js');
const { EASING_FUNCTIONS } = await import('../client/src/motion/Easing.js');

const kindForGroup = {
    text: LAYER_KINDS.TEXT,
    image: LAYER_KINDS.IMAGE,
    sticker: LAYER_KINDS.STICKER,
    camera: LAYER_KINDS.VIDEO,
};

assert.ok(Object.keys(MOTION_PRESETS).length >= 150,
    `expected at least 150 unique animation presets, got ${Object.keys(MOTION_PRESETS).length}`);

for (const groupName of Object.keys(kindForGroup)) {
    const group = PRESET_GROUPS.find(item => item.group === groupName);
    assert.ok(group, `missing ${groupName} preset group`);
    assert.ok(group.ids.length >= 30, `${groupName} should offer at least 30 presets; got ${group.ids.length}`);

    for (const id of group.ids) {
        assert.ok(MOTION_PRESETS[id], `${id} missing from the global registry`);
        const animations = buildPreset(id, { duration: 2.4 });
        assert.ok(animations.length > 0, `${id} generated no animation`);

        for (const animation of animations) {
            assert.ok(EASING_FUNCTIONS[animation.easing], `${id} uses unknown easing "${animation.easing}"`);
            assert.ok(animation.keyframes.length > 0, `${id} generated no keyframes`);
            assert.ok(animation.keyframes.every(frame => Number.isFinite(frame.time) && frame.time >= 0), `${id} emitted invalid keyframe time`);
            assert.ok(animation.keyframes.every(frame => frame.time <= animation.duration + 1e-6), `${id} has keyframes beyond its duration`);
            assert.ok(animation.keyframes.every(frame => Object.keys(frame.properties).length > 0), `${id} emitted an empty keyframe`);
        }

        const result = validateMotionLayer(createMotionLayer({
            id: `test-${id}`,
            kind: kindForGroup[groupName],
            duration: 2.4,
            animations,
        }));
        assert.deepEqual(result.errors, [], `${id}: ${result.errors.join('; ')}`);
    }
}

// Exercise compact captions and long shots for every unique preset, including
// presets authored for continuous camera/image movement.
for (const id of Object.keys(MOTION_PRESETS)) {
    for (const duration of [0.7, 6]) {
        const animations = buildPreset(id, { duration });
        assert.ok(animations.length > 0, `${id} failed at ${duration}s`);
        for (const animation of animations) {
            assert.ok(animation.keyframes.every(frame => frame.time <= animation.duration + 1e-6), `${id} exceeded ${duration}s`);
        }
    }
}

const transformPanel = readFileSync(new URL('../client/src/components/TransformPanel.jsx', import.meta.url), 'utf8');
const motionPanel = readFileSync(new URL('../client/src/components/MotionPanel.jsx', import.meta.url), 'utf8');
assert.match(transformPanel, /availablePresets\.filter\(presetId/,
    'the transform panel should search the full kind-specific preset list');
assert.match(motionPanel, /ids\.filter\(id/,
    'the motion panel should search the full grouped preset list');
assert.doesNotMatch(transformPanel, /availablePresets\.slice\(0,\s*9\)/,
    'the transform panel must not hide presets after the first nine');

console.log(`ALL MOTION PRESET CATALOG TESTS PASSED (${Object.keys(MOTION_PRESETS).length} unique presets)`);
