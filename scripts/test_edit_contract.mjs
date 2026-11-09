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

const { buildAssetManifest } = await import('../client/src/agent/AssetManifest.js');
const { validateToolInvocation } = await import('../client/src/agent/ToolCapabilityCatalog.js');
const { MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');
const { TOOL_DEFINITIONS, TOOL_CAPABILITIES } = await import('../client/src/agent/VideoEditorTools.js');
const { ContextGenerator } = await import('../client/src/agent/ContextGenerator.js');
const useTimelineStore = (await import('../client/src/store/useTimelineStore.js')).default;

const many = Array.from({ length: 85 }, (_, index) => ({ id: `asset-${index}`, name: `Rush ${index}.mp4`, type: 'video', analysis_status: index === 0 ? 'processing' : 'done', analysisConfidence: 0.8 }));
many.push({ id: 'ref', name: 'Look reference.mp4', type: 'video', assistantReference: true });
many.push({ id: 'doc', name: 'Brief.pdf', type: 'document', analysis_status: 'failed' });
const manifest = buildAssetManifest(many);
assert.equal(manifest.length, 87, 'every uploaded item remains addressable');
assert.equal(manifest[0].analysisStatus, 'processing');
assert.equal(manifest[0].confidence, 0.8);
assert.equal(manifest[85].role, 'reference');
assert.equal(manifest[85].editable, false);
assert.equal(manifest[86].role, 'document');
assert.equal(manifest[86].analysisStatus, 'failed');

useTimelineStore.setState({ assets: many });
const context = ContextGenerator.getTimelineContext();
assert.equal(context.assetManifest.total, 87);
assert.equal(context.mediaBin.length, 86, 'references are known but excluded from editable media sources');
assert.ok(context.mediaBin.some(asset => asset.id === 'asset-84'), 'large bins are not truncated at 60');
assert.ok(context.display.includes('asset-84'));

assert.equal(TOOL_CAPABILITIES.length, TOOL_DEFINITIONS.length, 'every declared tool has a capability contract');
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
