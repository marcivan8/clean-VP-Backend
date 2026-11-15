/**
 * scripts/test_editor_tools_registry.mjs
 *
 * Verifies the Editor Tools Knowledge Engine, Tool Capability Registry,
 * and Atomic Multi-Step Execution Transactions across the platform.
 *
 * Guarantees:
 *   1. Zero Drift: Every tool in vibedEditorKnowledge exists in CommandRegistry & catalog.
 *   2. Comprehensive Craft Intelligence: Every tool has a purpose, usage modes, and preconditions.
 *   3. Intent Classification: Prompt skills are accurately mapped across all 8 disciplines.
 *   4. ROKA Prompt Generation: System prompt carries targeted tool craft and autonomous recipes.
 *   5. Atomic Transactions: Multi-step edits collapse into a single undo checkpoint.
 *
 * Run: node scripts/test_editor_tools_registry.mjs
 */

import { register } from 'module';
register('./lib/clientLoaderHooks.mjs', import.meta.url);

import assert from 'assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(path.join(ROOT, 'package.json'));

// Stub browser environment globals
globalThis.localStorage = {
    _m: {},
    getItem(k) { return this._m[k] ?? null; },
    setItem(k, v) { this._m[k] = String(v); },
    removeItem(k) { delete this._m[k]; },
};
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200;
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' });

// Stub Supabase credentials
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'dummy-key';

let passed = 0;
let failed = 0;

function log(msg = '') {
    process.stdout.write(msg + '\n');
}

async function test(name, fn) {
    try {
        await fn();
        passed++;
        log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        log(`  ✗ ${name}\n    Error: ${err.message}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Editor Knowledge Engine & Semantic Taxonomy
// ─────────────────────────────────────────────────────────────────────────────

log('\n1 · Editor Knowledge Engine & Semantic Taxonomy');

const {
    EDITOR_SKILL_DOMAINS,
    TOOL_REGISTRY,
    AUTONOMOUS_RECIPES,
    classifyEditorSkills,
    getToolContract,
    getToolsByDomain,
    buildEditorKnowledgePrompt,
} = nodeRequire(path.join(ROOT, 'server/knowledge/vibedEditorKnowledge.js'));

const { describeToolCapabilities, validateToolInvocation } = await import('../client/src/agent/ToolCapabilityCatalog.js');
const { TOOL_DEFINITIONS } = await import('../client/src/agent/VideoEditorTools.js');
const catalog = nodeRequire(path.join(ROOT, 'server/brain/commandCatalog.generated.json'));

const KNOWN_TOOLS = new Set([
    ...catalog.commands.map(c => c.id),
    ...TOOL_DEFINITIONS.map(t => t.name),
]);

await test('all 8 editor skill domains are declared in EDITOR_SKILL_DOMAINS', () => {
    assert.equal(EDITOR_SKILL_DOMAINS.TIMELINE_CUTS, 'timeline-cuts');
    assert.equal(EDITOR_SKILL_DOMAINS.PACING_CLEANUP, 'pacing-cleanup');
    assert.equal(EDITOR_SKILL_DOMAINS.VISUAL_FRAMING, 'visual-framing');
    assert.equal(EDITOR_SKILL_DOMAINS.BROLL_COVERAGE, 'broll-coverage');
    assert.equal(EDITOR_SKILL_DOMAINS.AUDIO_INTELLIGENCE, 'audio-intelligence');
    assert.equal(EDITOR_SKILL_DOMAINS.COLOR_FINISHING, 'color-finishing');
    assert.equal(EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY, 'captions-typography');
    assert.equal(EDITOR_SKILL_DOMAINS.ASSEMBLY_MACROS, 'assembly-macros');
});

await test('every tool in TOOL_REGISTRY is a real command or agent tool on the platform', () => {
    const unknown = Object.keys(TOOL_REGISTRY).filter(id => !KNOWN_TOOLS.has(id));
    assert.equal(unknown.length, 0, `Unknown tools found: ${unknown.join(', ')}`);
});

await test('every tool in TOOL_REGISTRY has purpose, usage modes, preconditions, and heuristics', () => {
    for (const [id, tool] of Object.entries(TOOL_REGISTRY)) {
        assert.equal(tool.id, id, `Tool ID mismatch: ${id}`);
        assert.ok(tool.label && tool.label.length > 2, `${id}: missing label`);
        assert.ok(Object.values(EDITOR_SKILL_DOMAINS).includes(tool.domain), `${id}: invalid domain ${tool.domain}`);
        assert.ok(tool.purpose && tool.purpose.length > 20, `${id}: purpose too brief`);
        assert.ok(Array.isArray(tool.usageWays) && tool.usageWays.length > 0, `${id}: missing usageWays`);
        for (const u of tool.usageWays) {
            assert.ok(u.mode && u.mode.length > 2, `${id}: invalid usage mode`);
            assert.ok(u.description && u.description.length > 10, `${id}: invalid mode description`);
        }
        assert.ok(tool.whenToUse && tool.whenToUse.length > 15, `${id}: missing whenToUse`);
        assert.ok(tool.whenNotToUse && tool.whenNotToUse.length > 15, `${id}: missing whenNotToUse`);
        assert.ok(Array.isArray(tool.preconditions) && tool.preconditions.length > 0, `${id}: missing preconditions`);
        assert.ok(tool.cost, `${id}: missing cost`);
    }
});

await test('classifyEditorSkills correctly routes user prompts to skill domains', () => {
    // 1. Silence removal / dead air -> PACING_CLEANUP
    const p1 = classifyEditorSkills('strip dead air and silence between words').map(d => d.domain);
    assert.ok(p1.includes(EDITOR_SKILL_DOMAINS.PACING_CLEANUP));

    // 2. Punch in zoom -> VISUAL_FRAMING
    const p2 = classifyEditorSkills('punch in zoom on key moments').map(d => d.domain);
    assert.ok(p2.includes(EDITOR_SKILL_DOMAINS.VISUAL_FRAMING));

    // 3. B-roll cutaway -> BROLL_COVERAGE
    const p3 = classifyEditorSkills('add b-roll cutaways to illustrate spoken topics').map(d => d.domain);
    assert.ok(p3.includes(EDITOR_SKILL_DOMAINS.BROLL_COVERAGE));

    // 4. Audio normalize & denoise -> AUDIO_INTELLIGENCE
    const p4 = classifyEditorSkills('clean background noise and normalize audio').map(d => d.domain);
    assert.ok(p4.includes(EDITOR_SKILL_DOMAINS.AUDIO_INTELLIGENCE));

    // 5. Color grade & LUT -> COLOR_FINISHING
    const p5 = classifyEditorSkills('apply a cinematic warm color grade lut').map(d => d.domain);
    assert.ok(p5.includes(EDITOR_SKILL_DOMAINS.COLOR_FINISHING));

    // 6. Subtitles & captions -> CAPTIONS_TYPOGRAPHY
    const p6 = classifyEditorSkills('generate karaoke captions with highlighted keywords').map(d => d.domain);
    assert.ok(p6.includes(EDITOR_SKILL_DOMAINS.CAPTIONS_TYPOGRAPHY));

    // 7. Repurpose shorts -> ASSEMBLY_MACROS
    const p7 = classifyEditorSkills('repurpose this into a viral vertical tiktok short').map(d => d.domain);
    assert.ok(p7.includes(EDITOR_SKILL_DOMAINS.ASSEMBLY_MACROS));
});

await test('buildEditorKnowledgePrompt formats craft guidelines, tool usage modes, and recipes', () => {
    const readyIds = ['silence_removal', 'apply_zoom', 'normalize_audio', 'auto_captions', 'apply_lut'];
    const prompt = buildEditorKnowledgePrompt(readyIds);

    assert.ok(prompt.includes('AUTONOMOUS EDITOR CRAFT & TOOL INTELLIGENCE'), 'Must contain header');
    assert.ok(prompt.includes('CORE EDITORIAL PRINCIPLES'), 'Must contain principles');
    assert.ok(prompt.includes('STANDARD AUTONOMOUS COMPOSITION RECIPES'), 'Must contain recipes');
    assert.ok(prompt.includes('silence_removal'), 'Must describe silence_removal');
    assert.ok(prompt.includes('apply_zoom'), 'Must describe apply_zoom');
    assert.ok(prompt.includes('normalize_audio'), 'Must describe normalize_audio');
    assert.ok(prompt.includes('auto_captions'), 'Must describe auto_captions');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Client-Side Tool Capability Catalog & Execution Contracts
// ─────────────────────────────────────────────────────────────────────────────

log('\n2 · Client-Side Tool Capability Catalog');

await test('describeToolCapabilities provides verified contracts across all tool categories', () => {
    const capabilities = describeToolCapabilities(TOOL_DEFINITIONS);
    assert.ok(capabilities.length >= 25, 'Must describe all defined tools');

    const byName = new Map(capabilities.map(c => [c.name, c]));

    // Check specific contracts
    const silence = byName.get('silence_removal');
    assert.ok(silence, 'silence_removal must be registered');
    assert.ok(silence.effects[0].includes('Splits and removes pauses'), 'silence_removal must describe exact timeline effects');
    assert.ok(silence.verification.includes('reduced'), 'silence_removal must specify verification rule');

    const zoom = byName.get('apply_zoom');
    assert.ok(zoom, 'apply_zoom must be registered');
    assert.ok(zoom.effects[0].includes('scale/crop'), 'apply_zoom must describe transform effects');

    const captions = byName.get('auto_captions');
    assert.ok(captions, 'auto_captions must be registered');
    assert.ok(captions.effects[0].includes('subtitles'), 'auto_captions must describe caption placement');

    const lut = byName.get('apply_lut');
    assert.ok(lut, 'apply_lut must be registered');
    assert.ok(lut.effects[0].includes('LUT'), 'apply_lut must describe color grade matrix');
});

await test('validateToolInvocation checks required parameters accurately', () => {
    const def = { name: 'cut_clip', parameters: { required: ['clipId', 'time', 'trackId'] } };

    const valid = validateToolInvocation(def, { clipId: 'c1', time: 10, trackId: 't1' });
    assert.equal(valid.success, true);

    const invalid = validateToolInvocation(def, { clipId: 'c1' });
    assert.equal(invalid.success, false);
    assert.ok(invalid.error.includes('time'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Atomic Multi-Step Execution & Rollback Transactions
// ─────────────────────────────────────────────────────────────────────────────

log('\n3 · Atomic Multi-Step Execution & Rollback Transactions');

const { default: useTimelineStore } = await import('../client/src/store/useTimelineStore.js');
const { default: MediaExecutionEngine } = await import('../client/src/agent/MediaExecutionEngine.js');

await test('beginHistoryGroup, endHistoryGroup, and cancelHistoryGroup provide atomic transactions', () => {
    useTimelineStore.setState({ tracks: [], past: [], future: [] });
    const store = useTimelineStore.getState();

    // 1. Initial state setup
    const initialTrackId = store.addTrack('video');
    store.addClip(initialTrackId, {
        id: 'initial-clip-1',
        name: 'Original Shot',
        type: 'video',
        start: 0,
        duration: 30,
    });

    const pastLengthBefore = useTimelineStore.getState().past.length;

    const initialVideoTrack = useTimelineStore.getState().tracks.find(t => t.id === initialTrackId);
    const initialPlacementId = initialVideoTrack.clips[0].id;

    // 2. Start atomic multi-step transaction
    store.beginHistoryGroup();

    // Step A: Split clip
    store.splitClip(initialTrackId, initialPlacementId, 10);

    // Step B: Add color grade
    store.applyColorGrade('cinematic');

    // Step C: Add a text overlay
    store.addTextOverlay('Chapter One: Inception', { position: 'lower_third', duration: 4 });

    // Multi-step operations ran, now close the transaction
    store.endHistoryGroup();

    const pastAfter = useTimelineStore.getState().past;
    // Exactly ONE history snapshot must be added for all three operations combined
    assert.equal(pastAfter.length, pastLengthBefore + 1, 'Multi-step edits must produce exactly ONE undo snapshot');

    // 3. Execute single undo
    store.undo();

    const restoredState = useTimelineStore.getState();
    const videoTrack = restoredState.tracks.find(t => t.id === initialTrackId);
    // Undo must restore the original undivided clip
    assert.equal(videoTrack.clips.length, 1, 'Undo must revert splits, grade, and overlay in a single step');
    assert.ok(videoTrack.clips[0].clipId === 'initial-clip-1' || videoTrack.clips[0].id.includes('placement'));
    assert.equal(videoTrack.clips[0].duration, 30);
});

await test('cancelHistoryGroup cleanly aborts intermediate edits on failure', () => {
    const store = useTimelineStore.getState();
    const trackId = store.addTrack('video');
    store.addClip(trackId, { id: 'clean-clip-1', start: 0, duration: 20 });

    const track = useTimelineStore.getState().tracks.find(t => t.id === trackId);
    assert.equal(track?.clips?.length, 1);
    const placementId = track.clips[0].id;

    // Start transaction
    store.beginHistoryGroup();

    // Perform an edit
    store.splitClip(trackId, placementId, 8);
    assert.equal(useTimelineStore.getState().tracks.find(t => t.id === trackId)?.clips?.length, 2);

    // Simulation: Failure or abort triggers cancelHistoryGroup
    store.cancelHistoryGroup();

    // Timeline must be restored back to 1 clip without creating a corrupted past entry
    const restoredClips = useTimelineStore.getState().tracks.find(t => t.id === trackId)?.clips?.length;
    assert.equal(restoredClips, 1, 'cancelHistoryGroup must restore pre-transaction state');
});

log('\n────────────────────────────────────────────────────────────');
log(`Editor Tools Registry & Autonomous Craft: ${passed} passed, ${failed} failed`);
log('────────────────────────────────────────────────────────────\n');

if (failed > 0) {
    process.exit(1);
}
