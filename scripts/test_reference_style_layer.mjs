import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';
import fs from 'node:fs';

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const { buildStyleReferencePlan } = await import('../client/src/motion/StyleReferenceAdapter.js');
const { fallbackShortScenePlan, polishShort } = await import('../client/src/agent/shortPolish.js');
const { PLATFORM_PROFILES } = await import('../client/src/agent/PlatformProfiles.js');

const profile = {
    confidence: 0.91,
    motionEnergy: 'low',
    captionTreatment: 'clean',
    titleTreatment: 'minimal',
    graphicsDensity: 'sparse',
    transitionPacing: 'slow',
    visualTone: 'editorial',
    colorPalette: ['#123456', '#EEEEEE', 'javascript:alert(1)'],
    motifs: ['thin lines', 'soft panels'],
    animationId: 'untrusted-animation',
};

assert.equal(buildStyleReferencePlan(null), null);
assert.equal(buildStyleReferencePlan({ ...profile, confidence: 0.2 }), null);
assert.equal(buildStyleReferencePlan({ confidence: 0.99, motionEnergy: 'unknown', captionTreatment: 'unknown', titleTreatment: 'unknown', graphicsDensity: 'unknown', transitionPacing: 'unknown', visualTone: 'unknown' }), null);
const adapted = buildStyleReferencePlan(profile);
assert.equal(adapted.captionPack, 'ali-abdaal');
assert.equal(adapted.accent, '#123456');
assert.equal(adapted.textColor, '#EEEEEE');
assert.equal(adapted.graphicsMax, 1);
assert.equal(adapted.recipe, 'explainer');
assert.equal(adapted.surface, 'light', 'light reference palettes should carry a light UI surface into scene composition');
assert.equal(Object.hasOwn(adapted, 'animationId'), false);

const words = 'I learned how to make the result much better because this was the key lesson'.split(' ')
    .map((word, i) => ({ word, start: i * 0.6, end: i * 0.6 + 0.5 }));
const scene = fallbackShortScenePlan(words, {
    headline: 'The Key Lesson', duration: 12, platform: 'reels', editingStyle: 'reel', referenceStyle: profile,
    visualContext: [
        { assetId: 'ref', isReference: true, isBroll: true, contentDescription: 'a red sports car racing', sceneType: 'sports' },
        { assetId: 'source', isReference: false, isBroll: true, contentDescription: 'a kitchen and cooking scene', sceneType: 'cooking' },
    ],
});
assert.equal(scene.tone, 'editorial');
assert.equal(scene.referenceStyleApplied.visualTone, 'editorial');
assert.equal(scene.brollMoments.some(moment => moment.assetIds?.includes('ref')), false, 'reference video leaked into source b-roll candidates');
assert.equal(scene.visualSummary.includes('sports'), false, 'reference subject contaminated source visual grounding');

const built = { duration: 12, aspectRatio: '9:16', tracks: [{ id: 'video', type: 'video', clips: [{ id: 'v1', type: 'video', assetId: 'source-asset', sourceUrl: '/uploads/source.mp4', start: 0, duration: 12, offset: 0 }] }] };
const polished = polishShort(built, PLATFORM_PROFILES.reels, { words, scenePlan: scene, referenceStyleProfile: profile });
const captions = polished.tracks.flatMap(track => track.clips).filter(clip => String(clip.id).startsWith('short-caption-'));
assert.ok(captions.length > 0, 'expected generated transcript captions');
assert.equal(captions[0].color, '#EEEEEE');
assert.equal(captions[0].captionStyle.wordHighlight.color, '#123456');

const storyboardWords = [
    ...('The launch worked well today.'.split(' ').map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.42 }))),
    ...('First share the product dashboard with the full team.'.split(' ').map((word, i) => ({ word, start: 6 + i * 0.5, end: 6 + i * 0.5 + 0.42 }))),
    ...('Then explain the steps and the result.'.split(' ').map((word, i) => ({ word, start: 14 + i * 0.5, end: 14 + i * 0.5 + 0.42 }))),
];
const sourceFaces = [1, 2, 3, 4].map(i => ({
    id: `face-${i}`, type: 'image/png', url: `/uploads/face-${i}.png`, has_faces: true, name: `Person ${i}`,
}));
const refAsset = { id: 'ref-face', type: 'image/png', url: '/uploads/reference-only.png', has_faces: true, assistantReference: true };
const phoneStyle = { ...profile, colorPalette: ['#FFFFFF', '#111827'], motifs: ['phone mockup'] };
const phoneOutput = polishShort(built, PLATFORM_PROFILES.reels, {
    words: storyboardWords, events: [], scenePlan: scene, referenceStyleProfile: phoneStyle,
    assets: [refAsset],
});
const phoneScenes = phoneOutput.tracks.flatMap(track => track.clips || []).filter(clip => String(clip.id).startsWith('short-storyboard-'));
assert.ok(phoneScenes.some(clip => clip.template?.kind === 'phone-frame' && clip.template.params?.theme === 'light'),
    'phone/interface reference motifs should select a light device frame');
const phoneScreen = phoneOutput.tracks.flatMap(track => track.clips || []).find(clip => String(clip.id).startsWith('short-phone-screen-'));
assert.ok(phoneScreen?.type === 'video' && phoneScreen.frame?.w > 0 && phoneScreen.sourceUrl === '/uploads/source.mp4',
    'phone screen should use the project source video in a masked screen box, never the reference video');
const dashboardLayers = phoneOutput.tracks.flatMap(track => track.clips || []);
const dashboardOnly = polishShort(built, PLATFORM_PROFILES.reels, {
    words: storyboardWords, events: [], scenePlan: scene,
    referenceStyleProfile: { ...profile, motifs: ['dashboard interface'] }, assets: [refAsset],
});
const dashboardOutput = dashboardOnly.tracks.flatMap(track => track.clips || []);
assert.ok(dashboardOutput.some(clip => clip.template?.kind === 'scene-background')
    && dashboardOutput.some(clip => String(clip.id).startsWith('short-dashboard-speaker-') && clip.frame?.y >= 0.4),
    'dashboard motif should compose a designed backdrop and the project speaker video in a lower split');

const collageStyle = { ...profile, colorPalette: ['#FFFFFF', '#111827'], motifs: ['portrait collage'] };
const collageOutput = polishShort(built, PLATFORM_PROFILES.reels, {
    words: storyboardWords, events: [], scenePlan: scene, referenceStyleProfile: collageStyle,
    assets: [...sourceFaces, refAsset],
});
const portraits = collageOutput.tracks.flatMap(track => track.clips || [])
    .filter(clip => String(clip.id).startsWith('short-storyboard-') && clip.template?.kind === 'profile-portrait');
assert.equal(portraits.length, 4, 'portrait collage scenes should stage verified source faces as separate animated layers');
assert.ok(portraits.every(clip => clip.template.params.shape === 'rounded' && !clip.template.params.imageUrl.includes('reference-only')),
    'portrait cards should use source assets, never the style-reference video');

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const engine = read('client/src/agent/MediaExecutionEngine.js');
const shortFinisher = read('client/src/agent/shortFinisher.js');
const polish = read('client/src/agent/shortPolish.js');
const analyzer = read('server/brain/media/VisualAnalyzer.js');
const pipeline = read('server/brain/media/MediaIntelligencePipeline.js');
const routes = read('server/routes/brainRoutes.js');
const worker = read('worker.js');
assert.match(analyzer, /styleReference \? \[0\.08, 0\.28, 0\.5, 0\.72, 0\.92\]/);
assert.match(pipeline, /visual_style_profile: visualAnalysis\.visualStyleProfile/);
assert.match(routes, /router\.post\('\/analyze-style-reference'/);
assert.match(routes, /\.eq\('user_id', req\.user\.id\)/);
assert.match(worker, /isReference === true/);
assert.match(engine, /styleReferenceProfileFor\(st, visualContext/);
assert.match(engine, /referenceStyle: referenceStyleProfile/);
assert.match(engine, /buildStyleReferencePlan\(rawStyle\)/);
assert.match(shortFinisher, /referenceStyleProfile:\s*opts\.referenceStyleProfile/,
    'the Shorts panel finishing path forwards the attached reference style profile into polishShort');
assert.match(polish, /planStoryboard\(\{[\s\S]{0,260}kindPlan/,
    'Auto Pro Finish uses the reusable semantic storyboard planner');
assert.match(polish, /repairStoryboard\(qaInput, qaOpts\)/,
    'generated scenes are collision-checked before they become timeline clips');

console.log('Reference style analysis/planning checks passed.');
