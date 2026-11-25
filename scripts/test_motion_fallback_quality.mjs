import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { planMotionForLayers, planMotionFromBrief, composeMotion, VERBS, VIDEO_SAFE_VERBS } from '../client/src/motion/MotionComposer.js';
import { resolveMotionAt } from '../client/src/motion/MotionResolver.js';

let checks = 0;
function check(name, fn) {
    fn();
    checks += 1;
    console.log(`  ✓ ${name}`);
}

console.log('\nMotion fallback quality');

check('parses an ordered English sequence into distinct timed beats', () => {
    const plan = planMotionFromBrief('Slide in, then pulse, then fade out', { duration: 4, kind: 'text' });
    assert.deepEqual(plan.beats.map(beat => beat.verb), ['slide-in', 'pulse', 'fade-out']);
    assert.equal(plan.beats[0].at, 0);
    assert.ok(plan.beats[1].at > plan.beats[0].at);
    assert.equal(plan.beats[2].at, 0); // exits are end-anchored
});

check('parses French instructions, accents, and travel direction', () => {
    const plan = planMotionFromBrief('Fais apparaître depuis la gauche, puis pulse, puis fondu sortant', { duration: 4, kind: 'text' });
    assert.deepEqual(plan.beats.map(beat => beat.verb), ['fade-in', 'pulse', 'fade-out']);
    assert.equal(plan.beats[0].direction, 'right');
    assert.ok(plan.beats[1].at > 0);
});

check('uses a video-safe recipe when the brief only requests an entrance', () => {
    const plan = planMotionFromBrief('Fade in and whip out', { duration: 4, kind: 'video' });
    assert.ok(plan.beats.length > 0);
    assert.ok(plan.beats.every(beat => VIDEO_SAFE_VERBS.has(beat.verb)));
    const { animations } = composeMotion(plan, { duration: 4, kind: 'video' });
    assert.ok(animations.length > 0);
    assert.ok(animations.every(animation => animation.keyframes.every(frame => !('opacity' in frame.properties))));
});

check('uses calmer, role-aware recipes for captions, logos, and footage', () => {
    const caption = planMotionFromBrief('animate it', { duration: 3, kind: 'caption', editingStyle: 'interview' });
    const logo = planMotionFromBrief('make it punchy', { duration: 3, kind: 'text', role: 'logo' });
    const footage = planMotionFromBrief('cinematic', { duration: 3, kind: 'video' });
    assert.equal(caption.recipe, 'caption-calm');
    assert.ok(logo.beats.every(beat => !['slam-in', 'whip-in', 'glitch-in', 'spin-in'].includes(beat.verb)));
    assert.ok(footage.beats.every(beat => VIDEO_SAFE_VERBS.has(beat.verb)));
});

check('coordinates a text stack with a delayed secondary line and reverse exit', () => {
    const layers = [
        { id: 'title', kind: 'text', name: 'Main title', duration: 4 },
        { id: 'caption-subtitle', kind: 'caption', name: 'Subtitle', duration: 4 },
    ];
    const first = planMotionForLayers(layers, 'fade in then pulse then fade out', { seed: 'project-1' });
    const again = planMotionForLayers(layers, 'fade in then pulse then fade out', { seed: 'project-1' });
    assert.deepEqual(first, again, 'same project and prompt must remain deterministic');
    const titleIn = first.title.beats.find(beat => VERBS[beat.verb].group === 'in');
    const subtitleIn = first['caption-subtitle'].beats.find(beat => VERBS[beat.verb].group === 'in');
    const titleOut = first.title.beats.find(beat => VERBS[beat.verb].group === 'out');
    const subtitleOut = first['caption-subtitle'].beats.find(beat => VERBS[beat.verb].group === 'out');
    assert.ok(subtitleIn.at > titleIn.at);
    assert.ok(subtitleOut.at > titleOut.at, 'the later-arriving line should leave earlier');
});

check('the composed fallback animates through the shared preview resolver', () => {
    const plan = planMotionFromBrief('cinematic slow push in', { duration: 4, kind: 'video' });
    const { animations } = composeMotion(plan, { duration: 4, kind: 'video' });
    const layer = { id: 'footage', kind: 'video', startTime: 0, duration: 4, animations };
    const start = resolveMotionAt(layer, 0);
    const middle = resolveMotionAt(layer, 2);
    assert.ok(middle.scale > start.scale, `expected a visible push-in (${start.scale} → ${middle.scale})`);
});

{
    const require = createRequire(import.meta.url);
    const { generateMotionScript } = require('../services/motionProvider.js');
    const previousProvider = process.env.AI_MOTION_PROVIDER;
    try {
        process.env.AI_MOTION_PROVIDER = 'rules';
        const layers = [
            { id: 'title', kind: 'text', role: 'title', duration: 4 },
            { id: 'subtitle', kind: 'caption', role: 'caption', duration: 4 },
            { id: 'footage', kind: 'video', role: 'video', duration: 4 },
        ];
        const result = await generateMotionScript({
            brief: 'fade in then punch then fade out', layers, editingStyle: 'editorial', seed: 'project-1',
            composer: { planMotionFromBrief, planMotionForLayers, verbCatalog: () => [], composeMotion },
            cleanLayers: value => value,
            buildPrompt: () => '',
        });
        assert.equal(result.source, 'rules');
        assert.match(result.notes, /offline deterministic motion recipe/i);
        assert.ok(result.layers.title.beats.some(beat => beat.verb === 'fade-in'));
        assert.ok(result.layers.subtitle.beats.every(beat => !['whip-in', 'slam-in', 'glitch-in'].includes(beat.verb)));
        assert.ok(result.layers.footage.beats.every(beat => VIDEO_SAFE_VERBS.has(beat.verb)));
        checks += 1;
        console.log('  ✓ provider fallback preserves coordinated, layer-aware plans and reports its source');
    } finally {
        if (previousProvider === undefined) delete process.env.AI_MOTION_PROVIDER;
        else process.env.AI_MOTION_PROVIDER = previousProvider;
    }
}

console.log(`\n${checks} checks passed.`);
