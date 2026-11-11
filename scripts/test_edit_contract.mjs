// Contract checks for asset inventory, discoverable tools, and honest execution.
import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);
import assert from 'node:assert/strict';

globalThis.localStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.innerWidth = 1280;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-service-role-key';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { buildAssetManifest } = await import('../client/src/agent/AssetManifest.js');
const { visualAnalysisAssetIds } = await import('../client/src/agent/assetAnalysisWait.js');
const { validateToolInvocation } = await import('../client/src/agent/ToolCapabilityCatalog.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const { TOOL_DEFINITIONS, TOOL_CAPABILITIES } = await import('../client/src/agent/VideoEditorTools.js');
const { VideoEditorTools } = await import('../client/src/agent/VideoEditorTools.js');
const { AgentOrchestrator } = await import('../client/src/agent/AgentOrchestrator.js');
const { ContextGenerator } = await import('../client/src/agent/ContextGenerator.js');
const { EditorialBrain } = await import('../server/brain/EditorialBrain.js');
const useTimelineStore = (await import('../client/src/store/useTimelineStore.js')).default;

const many = Array.from({ length: 85 }, (_, index) => ({ id: `asset-${index}`, name: `Rush ${index}.mp4`, type: 'video', analysis_status: index === 0 ? 'processing' : 'done', analysisConfidence: 0.8 }));
many.push({ id: 'ref', name: 'Look reference.mp4', type: 'video', assistantReference: true });
many.push({ id: 'ref-db', name: 'Stored reference.mp4', type: 'video', is_reference: true });
many.push({ id: 'doc', name: 'Brief.pdf', type: 'document', analysis_status: 'failed' });
const manifest = buildAssetManifest(many);
assert.equal(manifest.length, 88, 'every uploaded item remains addressable');
assert.equal(manifest[0].analysisStatus, 'processing');
assert.equal(manifest[0].confidence, 0.8);
assert.equal(manifest[85].role, 'reference');
assert.equal(manifest[85].editable, false);
assert.equal(manifest[86].role, 'reference', 'database reference markers normalize to the reference role');
assert.equal(manifest[86].editable, false);
assert.equal(manifest[87].role, 'document');
assert.equal(manifest[87].analysisStatus, 'failed');
assert.deepEqual(visualAnalysisAssetIds(many).includes('ref-db'), false,
    'database reference markers are excluded from source-footage analysis');

useTimelineStore.setState({ assets: many });
const context = ContextGenerator.getTimelineContext();
assert.equal(context.assetManifest.total, 88);
assert.equal(context.mediaBin.length, 86, 'all reference marker variants are excluded from editable sources');
assert.ok(context.mediaBin.some(asset => asset.id === 'asset-84'), 'large bins are not truncated at 60');
assert.ok(context.assetManifest.assets.some(asset => asset.id === 'asset-84'), 'complete asset inventory is available in structured context');
assert.match(context.display, /complete named inventory.*structured assetManifest\.assets/i, 'prompt display points to complete structured inventory instead of duplicating it');

const editorialBrain = new EditorialBrain();
const assetSearchTool = new VideoEditorTools();
const oversizedInventory = Array.from({ length: 120 }, (_, index) => ({
    id: `large-${index}`, name: index === 109 ? 'Interview speaker closeup.mp4' : `Rush ${index}.mp4`,
    type: 'video', duration: 18, analysis_status: 'done',
    ...(index === 109 ? { content_description: 'Interview speaker explaining the product launch' } : {}),
    ...(index === 119 ? { transcript_text: 'The bakery owner describes the opening morning and first customers.' } : {}),
}));
oversizedInventory.push({ id: 'large-reference', name: 'Style reference.mp4', type: 'video', is_reference: true, analysis_status: 'done' });
const inventoryPrompt = editorialBrain.buildSystemPrompt({ binItems: oversizedInventory }, {}, null, null, 'use the interview speaker closeup');
assert.ok(oversizedInventory.every(asset => inventoryPrompt.includes(asset.id)),
    'the complete oversized inventory is present in ROKA context');
assert.match(inventoryPrompt, /large-2\|Rush 2\.mp4\|video\|source\|analysed/,
    'large bins retain type, role, and analysis state on compact rows');
assert.match(inventoryPrompt, /large-reference\|Style reference\.mp4\|video\|reference\|analysed/,
    'large-bin compact rows preserve reference role');
assert.match(inventoryPrompt, /id=large-109 \| Interview speaker closeup\.mp4/,
    'request-relevant assets beyond the first 40 receive detailed context');
const transcriptRankedPrompt = editorialBrain.buildSystemPrompt(
    { binItems: oversizedInventory }, {}, null, null, 'show the bakery opening morning',
);
assert.match(transcriptRankedPrompt, /id=large-119 \| Rush 119\.mp4/,
    'transcript evidence can rank a later, generically named rush into detailed context');
assert.match(transcriptRankedPrompt, /transcript=The bakery owner describes the opening morning/,
    'the transcript evidence used for ranking is also shown to the planner');
const veryLargeBin = Array.from({ length: 5000 }, (_, index) => ({
    id: `huge-${index}`, name: `Rush ${index}.mp4`, type: 'video', duration: 18, analysis_status: 'done',
    ...(index === 4800 ? { content_description: 'Bakery owner interview about opening morning and customers.' } : {}),
}));
const boundedInventoryPrompt = editorialBrain.buildSystemPrompt(
    { binItems: veryLargeBin }, {}, null, null, 'find the bakery owner interview',
);
assert.ok(boundedInventoryPrompt.length < 40_000, '5,000 assets cannot overflow the ROKA prompt with unbounded inventory rows');
assert.match(boundedInventoryPrompt, /Context-limited shortlist: \d+ of 5000 assets shown; \d+ additional assets remain/,
    'large-bin prompt explicitly reports omitted context instead of presenting a partial index as complete');
assert.match(boundedInventoryPrompt, /id=huge-4800 \| Rush 4800\.mp4/,
    'a semantically relevant asset near the end of a very large bin is prioritized into detailed context');
assert.match(boundedInventoryPrompt, /call search_uploaded_assets/,
    'ROKA is explicitly directed to search the complete bin when prompt context omits assets');
assert.match(boundedInventoryPrompt, /Use full-bin search or a batch-aware edit tool to inspect omitted assets/,
    'prompt context limits direct model exposure without preventing full-bin work');
assert.doesNotMatch(boundedInventoryPrompt, /request a batch-aware plan or a narrower selection/,
    'ROKA does not stop large-bin edits just because the prompt index is bounded');
assert.equal(veryLargeBin.every(asset => boundedInventoryPrompt.includes(asset.id)), false,
    'large bins are bounded in model context while the source manifest remains complete');
useTimelineStore.setState({ assets: [...veryLargeBin, { id: 'huge-reference', name: 'Bakery moodboard reference', type: 'video', is_reference: true }] });
const uploadedSearch = await assetSearchTool.execute({ name: 'search_uploaded_assets', args: { query: 'bakery owner opening morning', limit: 10 } });
assert.equal(uploadedSearch.success, true, 'the lightweight full-bin search executes as a read-only tool');
assert.equal(uploadedSearch.details.totalAssetsScanned, 5001, 'uploaded-asset search scans the complete bin');
assert.equal(uploadedSearch.details.results[0].id, 'huge-4800', 'a relevant asset near the end of a large bin ranks first');
assert.equal(uploadedSearch.details.results[0].editable, true);
assert.equal(uploadedSearch.details.hasMore, false);
const referenceSearch = await assetSearchTool.execute({ name: 'search_uploaded_assets', args: { query: 'moodboard', includeReferences: true } });
assert.equal(referenceSearch.details.results[0].role, 'reference', 'references can be searched as inspiration while retaining their non-editable role');
assert.equal(referenceSearch.details.results[0].editable, false, 'reference search never marks a reference as timeline-eligible');
const excludedReferenceSearch = assetSearchTool.searchUploadedAssets({ query: 'moodboard' });
assert.equal(excludedReferenceSearch.details.totalMatches, 0, 'reference assets are excluded by default from source asset lookup');
const pagedAssets = Array.from({ length: 67 }, (_, index) => ({ id: `page-${index}`, name: `Bakery interior ${index}.mp4`, type: 'video' }));
useTimelineStore.setState({ assets: pagedAssets });
const firstAssetPage = assetSearchTool.searchUploadedAssets({ query: 'bakery interior', limit: 50 });
const secondAssetPage = assetSearchTool.searchUploadedAssets({ query: 'bakery interior', limit: 50, offset: firstAssetPage.details.nextOffset });
assert.equal(firstAssetPage.details.results.length, 50, 'full-bin search bounds response size and provides pagination');
assert.equal(firstAssetPage.details.hasMore, true);
assert.equal(secondAssetPage.details.results.length, 17);
assert.equal(new Set([...firstAssetPage.details.results, ...secondAssetPage.details.results].map(asset => asset.id)).size, 67,
    'pagination returns every matching asset once without omissions');

const iterativePlanner = new AgentOrchestrator();
const plannedContextSnapshots = [];
const preflightExecutions = [];
iterativePlanner.getAgentPlan = async (_prompt, plannerContext) => {
    plannedContextSnapshots.push(plannerContext);
    if (!plannerContext.assetSearchFindings) return {
        thought: 'Search omitted footage before editing.',
        actions: [
            { name: 'search_uploaded_assets', args: { query: 'bakery owner', limit: 50 } },
            { name: 'create_video_from_assets', args: { style: 'reel' } },
        ],
    };
    return { thought: 'Plan from discovered evidence.', actions: [{ name: 'create_video_from_assets', args: { style: 'reel' } }] };
};
iterativePlanner.tools.execute = async action => {
    preflightExecutions.push(action.name);
    return {
        success: true,
        details: {
            totalAssetsScanned: 5000,
            totalMatches: 1,
            results: [{ id: 'late-bin-asset', name: 'Bakery owner interview.mp4', type: 'video', role: 'source', editable: true, evidence: 'Owner describes opening morning.' }],
            hasMore: false,
            nextOffset: null,
        },
    };
};
const iterativePlan = await iterativePlanner.generatePlan('Create a reel using the bakery owner footage');
assert.deepEqual(preflightExecutions, ['search_uploaded_assets'], 'planning preflight executes only read-only asset searches, never mixed edit actions');
assert.equal(plannedContextSnapshots.length, 2, 'the edit is replanned after full-bin search returns');
assert.equal(plannedContextSnapshots[1].assetSearchFindings[0].results[0].id, 'late-bin-asset', 'discovered omitted asset evidence is passed into the next plan');
assert.deepEqual(iterativePlan.actions.map(action => action.name), ['create_video_from_assets'], 'only the evidence-informed edit plan is returned for approval');

const fallbackReferencePrompt = editorialBrain.buildSystemPrompt({ binItems: [
    { id: 'fallback-reference', name: 'Moodboard.mp4', type: 'video', is_reference: true },
    { id: 'fallback-source', name: 'Camera footage.mp4', type: 'video' },
] }, {}, null, null, 'make a video');
assert.match(fallbackReferencePrompt, /id=fallback-reference \| Moodboard\.mp4 \| video \| analysis status unknown \| role=reference/,
    'reference role survives even when server-side asset analysis is unavailable');
assert.match(fallbackReferencePrompt, /id=fallback-source \| Camera footage\.mp4 \| video \| analysis status unknown \| role=source/,
    'ordinary footage remains a source when the analysis lookup is unavailable');
useTimelineStore.setState({ assets: many });
assert.equal(useTimelineStore.getState().addAssetToTimeline(many[86]), false, 'reference assets marked by the database cannot be added to timeline');
const videoTrackId = useTimelineStore.getState().tracks.find(track => track.type === 'video')?.id;
assert.equal(useTimelineStore.getState().addClip(videoTrackId, { assetId: many[86].id, start: 0, duration: 5, url: '/reference' }), false,
    'the central clip insertion guard rejects a database-marked reference');

assert.equal(TOOL_CAPABILITIES.length, TOOL_DEFINITIONS.length, 'every declared tool has a capability contract');
assert.equal(TOOL_CAPABILITIES.find(capability => capability.name === 'search_uploaded_assets')?.mutatesProject, false,
    'uploaded-asset lookup declares its read-only side effects accurately');
for (const capability of TOOL_CAPABILITIES) {
    assert.ok(capability.name && capability.inputs && capability.preconditions.length && capability.effects.length && capability.cost && capability.verification,
        `${capability.name} declares inputs, preconditions, effects, cost, and verification`);
}
assert.equal(validateToolInvocation(TOOL_DEFINITIONS.find(tool => tool.name === 'cut_clip'), {}).success, false);
assert.equal(validateToolInvocation(TOOL_DEFINITIONS.find(tool => tool.name === 'cut_clip'), { clipId: 'c', time: 1, trackId: 't' }).success, true);
assert.equal(validateToolInvocation(null, {}).success, false);

const engine = new MediaExecutionEngine();
assert.equal(await engine.verifyExecution({ commands: [], results: [] }), false, 'empty execution cannot report success');
assert.equal(await engine.verifyExecution({ commands: [{ action: 'x' }], results: [] }), false, 'missing results cannot report success');
assert.equal(await engine.verifyExecution({ commands: [{ action: 'x' }], results: [{ success: undefined }] }), false, 'a missing success signal cannot report success');
assert.equal(await engine.verifyExecution({ commands: [{ action: 'x' }], results: [{ success: true }] }), true);
assert.equal(await engine.verifyExecution({ commands: [{ action: 'x' }], results: [{ success: false }] }), false);

console.log('Edit contract passed: full asset manifest, tool contracts, invocation validation, and strict execution results.');
