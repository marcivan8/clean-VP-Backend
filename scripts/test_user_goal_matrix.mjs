// User-goal integration matrix: style × mode × request × uploaded-media mix.
// Exercises the real Auto playbook and the real intent → plan → compile path;
// only the execution boundary is stubbed so this stays deterministic/offline.
// Run with: node scripts/test_user_goal_matrix.mjs
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 390;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

const quiet = { log: console.log, warn: console.warn, error: console.error };
console.log = () => {}; console.warn = () => {}; console.error = () => {};

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { ContextGenerator } = await import('../client/src/agent/ContextGenerator.js');
const { IntentParser } = await import('../client/src/agent/IntentParser.js');
const { EditPlanner } = await import('../client/src/agent/EditPlanner.js');
const { CommandCompiler } = await import('../client/src/agent/CommandCompiler.js');
const { runAutopilot } = await import('../client/src/agent/StyleAutopilot.js');
const { EDITING_STYLE_IDS } = await import('../client/src/agent/EditingStyles.js');

const word = (text, start) => ({ word: text, start, end: start + 0.3 });
const sourceAssets = {
    talking: [
        { id: 'talk', name: 'talking-head.mp4', type: 'video', duration: 90, contentDescription: 'Person speaking to camera' },
    ],
    mixed: [
        { id: 'talk', name: 'talking-head.mp4', type: 'video', duration: 90, contentDescription: 'Person speaking about a launch' },
        { id: 'event', name: 'event.mp4', type: 'video', duration: 34, contentDescription: 'Crowd at a product event' },
        { id: 'still', name: 'stage.jpg', type: 'image', contentDescription: 'Product stage' },
        { id: 'music', name: 'track.mp3', type: 'audio', duration: 110 },
        { id: 'reference', name: 'reference.mp4', type: 'video', duration: 30, assistantReference: true },
    ],
    collage: [
        { id: 'still-a', name: 'one.jpg', type: 'image' },
        { id: 'still-b', name: 'two.jpg', type: 'image' },
        { id: 'music', name: 'track.mp3', type: 'audio', duration: 110 },
        { id: 'reference', name: 'reference.jpg', type: 'image', assistantReference: true },
    ],
};
const requests = [
    'edit it',
    'make it vertical',
    'add captions',
    'use the event footage to illustrate what I say',
];
const mixes = Object.keys(sourceAssets);

function setup(style, mix, { analysis = 'complete' } = {}) {
    const assets = sourceAssets[mix].map(asset => ({
        ...asset,
        ...(analysis === 'incomplete' && asset.type === 'video' && !asset.assistantReference
            ? { analysis_status: 'processing', visualAnalysis: null }
            : {}),
    }));
    const main = assets.find(asset => asset.id === 'talk') || assets.find(asset => asset.type === 'video' && !asset.assistantReference);
    const videoClips = main ? [{
        id: `clip-${main.id}`, assetId: main.id, type: 'video', name: main.name,
        start: 0, duration: Math.min(main.duration || 30, 30), offset: 0, speed: 1,
    }] : [];
    const tracks = videoClips.length ? [{ id: 'video-main', type: 'video', name: 'Video', volume: 1, clips: videoClips }] : [];
    const manager = window.timelineManager;
    manager.fromLegacyTracks(tracks);
    useTimelineStore.setState({
        tracks: manager.toLegacyTracks(), assets, editingStyle: style, editingMode: 'normal',
        duration: videoClips[0]?.duration || 0, currentTime: 0, aspectRatio: '9:16',
        captions: analysis === 'complete' ? [word('hello', 0), word('there', 0.4)] : [],
        transcripts: {}, transcriptionAttempted: analysis !== 'complete',
        activeClipId: videoClips[0]?.id || null, selectedClipIds: [], selectedTimelineRange: null,
        targetFindings: [], assetTargetFindings: [], contentAnalysis: null,
    });
}

async function realPipeline(prompt) {
    const intent = await IntentParser.parse(prompt);
    const planned = await EditPlanner.generatePlan(intent);
    if (!planned.success || !planned.plan || planned.status === 'clarification_needed') {
        return { success: false, clarification: true, operation: intent.operation, commands: [] };
    }
    const compiled = CommandCompiler.compile({
        ...planned.plan,
        intent: intent.confidence === 'HIGH' ? intent : { ...intent, confidence: 'HIGH' },
    }, useTimelineStore.getState());
    return {
        success: compiled.success || compiled.commands?.length > 0,
        clarification: false,
        operation: intent.operation,
        commands: compiled.commands || [],
    };
}

let matrixCases = 0;
for (const style of EDITING_STYLE_IDS) {
    for (const mode of ['normal', 'auto']) {
        for (const request of requests) {
            for (const mix of mixes) {
                setup(style, mix);
                useTimelineStore.setState({ editingMode: mode });
                const styleContext = ContextGenerator.getStructuredContext().ProjectContext.editingStyle;
                assert.equal(styleContext.id, style, `${style}/${mode}/${request}/${mix}: selected style must reach the planner context`);
                assert.equal(styleContext.mode, mode, `${style}/${mode}/${request}/${mix}: selected mode must reach the planner context`);
                if (mode === 'normal') {
                    const result = await realPipeline(request);
                    assert.ok(result.operation || result.clarification,
                        `${style}/${mode}/${request}/${mix}: parser returned neither an operation nor clarification`);
                } else {
                    const result = await runAutopilot(request, {
                        styleId: style,
                        shortTargetSeconds: 30,
                        run: realPipeline,
                    });
                    assert.equal(result.operation, 'auto_edit', `${style}/${mode}/${request}/${mix}`);
                    assert.ok(result.details?.report?.steps?.length,
                        `${style}/${mode}/${request}/${mix}: Auto should report every attempted playbook step`);
                }
                matrixCases++;
            }
        }
    }
}

// References are visible to style guidance but never offered as editable bin media.
setup('reel', 'mixed');
const mixedContext = ContextGenerator.getTimelineContext();
assert.equal(mixedContext.mediaBin.some(asset => asset.id === 'reference'), false);
assert.equal(mixedContext.mediaBin.some(asset => asset.id === 'event'), true);
assert.equal(mixedContext.mediaBin.some(asset => asset.id === 'music'), true);
setup('reel', 'mixed');
const referencePlan = [];
await runAutopilot('edit it', {
    styleId: 'reel', shortTargetSeconds: 30,
    onPlan: plan => referencePlan.push(...plan),
    run: async () => ({ success: true, operation: 'mock_edit', commands: [{ action: 'mock' }] }),
});
assert.ok(referencePlan.some(step => /never add the reference video as footage/i.test(step.prompt)),
    'reference guidance should reach the creative finishing step without making references source footage');

// Large bins keep every editable asset addressable; references stay segregated.
const largeBin = Array.from({ length: 70 }, (_, i) => ({
    id: `bin-${i}`, name: `asset-${i}.mp4`, type: 'video', duration: 12,
}));
largeBin.push({ id: 'bin-reference', name: 'inspiration.mp4', type: 'video', assistantReference: true });
window.timelineManager.fromLegacyTracks([]);
useTimelineStore.setState({ ...useTimelineStore.getState(), tracks: [], assets: largeBin, duration: 0 });
const largeContext = ContextGenerator.getTimelineContext();
assert.equal(largeContext.mediaBin.length, 70, 'large bins are not silently truncated');
assert.equal(largeContext.assetManifest.total, 71);
assert.ok(largeContext.mediaBin.some(asset => asset.id === 'bin-69'));
assert.ok(largeContext.assetManifest.assets.some(asset => asset.id === 'bin-69'), 'last large-bin asset remains in the complete manifest');
assert.match(largeContext.display, /Style reference: inspiration\.mp4; analysis=pending\. It is design guidance only, never an edit source\./);

// Incomplete transcription/analysis still yields a usable Auto plan that asks
// for transcript-dependent work first rather than pretending analysis exists.
setup('reel', 'talking', { analysis: 'incomplete' });
const incompleteSteps = [];
const incompleteResult = await runAutopilot('edit it', {
    styleId: 'reel', shortTargetSeconds: 30,
    onPlan: plan => incompleteSteps.push(...plan),
    run: async () => ({ success: true, operation: 'mock_edit', commands: [{ action: 'mock' }] }),
});
assert.equal(incompleteResult.success, true);
assert.equal(incompleteSteps[0]?.label, 'transcript', 'Reel should request words before selecting its best moment');

// An unavailable executor is reported as a failed/partial run, not a false success.
setup('talking_head', 'talking');
const unavailable = await runAutopilot('edit it', {
    styleId: 'talking_head', shortTargetSeconds: 30,
    run: async () => ({ success: false, message: 'Tool unavailable in this environment' }),
});
assert.equal(unavailable.success, false);
const unavailableReport = useTimelineStore.getState().autoEditReports?.at(-1);
assert.equal(unavailableReport?.status, 'failed');
assert.ok(unavailableReport?.steps?.length, 'the failed tool attempts should be visible in the saved Auto report');
assert.ok(unavailableReport.steps.every(step => step.status === 'skipped'));

// An underspecified instruction must remain a question or conversation; it
// must not silently compile into a destructive edit.
setup('reel', 'talking');
const ambiguous = await IntentParser.parse('make it better');
assert.ok(ambiguous.needs_clarification || ambiguous.operation === 'chat',
    `ambiguous request unexpectedly resolved to ${ambiguous.operation}`);

console.log = quiet.log; console.warn = quiet.warn; console.error = quiet.error;
quiet.log(`User-goal matrix passed: ${matrixCases} style × mode × prompt × asset-mix cases, plus references, large bin, incomplete analysis, unavailable tool, and ambiguity.`);
