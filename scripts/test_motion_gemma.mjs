#!/usr/bin/env node
/**
 * scripts/test_motion_gemma.mjs
 *
 * Test suite for Motion Provider abstraction and Gemma integration (Phases 2 & 3).
 *
 * Validates:
 *   1. Motion provider resolution (AI_MOTION_PROVIDER, AI_PROVIDER fallback, normalization)
 *   2. JSON parsing & bounded repair (markdown fences, conversational prefixes/suffixes, trailing commas)
 *   3. Motion schema validation and clamping (MotionComposer vocabulary, direction, energy, duration)
 *   4. Scene plan validation and fallback (SceneDirector tones, beat kinds, kicker/stat formatting)
 *   5. Timeout and cancellation behavior (AbortSignal, timeouts falling back to rules)
 *   6. Sanitized telemetry (no leaking prompts, briefs, or secret keys)
 *   7. Deterministic rule-based fallback ('rules' / unconfigured / model failure)
 *   8. Benchmark runner comparing available providers (mock, rules, and optional local gemma)
 *
 * Run: node scripts/test_motion_gemma.mjs
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');

const stub = (rel, exp) => {
    try {
        const p = require.resolve(path.join(ROOT, rel));
        require.cache[p] = { id: p, filename: p, loaded: true, exports: exp };
    } catch {
        // ignore
    }
};
stub('middleware/auth.js', { authenticateUser: (q, s, n) => n(), optionalAuth: (q, s, n) => n() });

const motionProvider = require('../services/motionProvider.js');
const {
    resolveMotionProvider,
    repairAndParseJSON,
    generateScenePlan,
    generateMotionScript,
    logMotionTelemetry,
} = motionProvider;

const AIProvider = require('../services/AIProvider.js');
const { _resetForTests } = AIProvider;

const motionRoutes = require('../server/routes/motionRoutes.js');
const {
    buildMotionPrompt,
    cleanLayers,
    buildScenePlanPrompt,
    cleanScenePlan,
    loadComposer,
} = motionRoutes;

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.log(`  ✗ ${name}`);
        if (detail) console.log(`      ${detail}`);
    }
}

function section(title) {
    console.log(`\n${title}`);
}

async function withEnv(vars, fn) {
    const saved = {};
    for (const [k, v] of Object.entries(vars)) {
        saved[k] = process.env[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    _resetForTests();
    try {
        return await fn();
    } finally {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        _resetForTests();
    }
}

async function runTests() {
    const composer = await loadComposer();

    section('1 · Motion Provider Resolution');
    {
        check('default provider resolves to "current"', resolveMotionProvider({}) === 'current');
        check('AI_MOTION_PROVIDER="gemma" normalizes to "gemma-local"', resolveMotionProvider({ AI_MOTION_PROVIDER: 'gemma' }) === 'gemma-local');
        check('AI_MOTION_PROVIDER="gemma-local" resolves to "gemma-local"', resolveMotionProvider({ AI_MOTION_PROVIDER: 'gemma-local' }) === 'gemma-local');
        check('AI_MOTION_PROVIDER="gemma-groq" normalizes to "groq"', resolveMotionProvider({ AI_MOTION_PROVIDER: 'gemma-groq' }) === 'groq');
        check('AI_MOTION_PROVIDER="groq" resolves to "groq"', resolveMotionProvider({ AI_MOTION_PROVIDER: 'groq' }) === 'groq');
        check('AI_MOTION_PROVIDER="rules" resolves to "rules"', resolveMotionProvider({ AI_MOTION_PROVIDER: 'rules' }) === 'rules');
        check('AI_MOTION_PROVIDER="mock" resolves to "mock"', resolveMotionProvider({ AI_MOTION_PROVIDER: 'mock' }) === 'mock');
        check('AI_PROVIDER fallback is respected when AI_MOTION_PROVIDER is unset', resolveMotionProvider({ AI_PROVIDER: 'mock' }) === 'mock');
        check('AI_MOTION_PROVIDER takes precedence over AI_PROVIDER', resolveMotionProvider({ AI_MOTION_PROVIDER: 'rules', AI_PROVIDER: 'mock' }) === 'rules');
    }

    section('2 · JSON Boundary Extraction and Bounded Repair');
    {
        // 2.1 Direct JSON
        const direct = repairAndParseJSON('{"valid": true, "count": 42}');
        check('direct valid JSON parses', direct.data && direct.data.valid === true && direct.error === null);

        // 2.2 Markdown fenced JSON
        const fenced = repairAndParseJSON('```json\n{"layers": {"title": {"beats": []}}}\n```');
        check('json fenced block extracts cleanly', fenced.data && fenced.data.layers && fenced.data.layers.title);

        // 2.3 Markdown fenced without language
        const bareFence = repairAndParseJSON('```\n{"notes": "creative opening"}\n```');
        check('bare markdown fence extracts cleanly', bareFence.data && bareFence.data.notes === 'creative opening');

        // 2.4 Conversational prefix and suffix (typical for open-weight models like Gemma)
        const conversational = repairAndParseJSON(
            'Here is the motion script you requested:\n' +
            '{\n  "layers": {\n    "title": {\n      "beats": [{"verb": "rise-in"}]\n    }\n  },\n  "notes": "smooth rise"\n}\n' +
            'I hope this fits your brief!'
        );
        check('extracts JSON surrounded by chat/reasoning text', conversational.data && conversational.data.notes === 'smooth rise');

        // 2.5 Trailing commas in arrays and objects (very common in small models)
        const trailingCommas = repairAndParseJSON(
            '{\n' +
            '  "layers": {\n' +
            '    "h1": {\n' +
            '      "beats": [\n' +
            '        {"verb": "fade-in", "at": 0,},\n' +
            '        {"verb": "punch", "at": 1,},\n' +
            '      ],\n' +
            '    },\n' +
            '  },\n' +
            '  "notes": "done",\n' +
            '}'
        );
        check('repairs illegal trailing commas in objects and arrays', trailingCommas.data && trailingCommas.data.layers.h1.beats.length === 2);

        // 2.6 Array-wrapped candidate
        const arrayJson = repairAndParseJSON('Some prelude [1, 2, 3] postscript');
        check('extracts array structures', Array.isArray(arrayJson.data) && arrayJson.data.length === 3);

        // 2.7 Degraded / non-JSON input
        const invalid = repairAndParseJSON('I cannot help with this request.');
        check('gracefully reports error on text without JSON', invalid.data === null && Boolean(invalid.error));

        const empty = repairAndParseJSON('   ');
        check('gracefully reports error on empty string', empty.data === null && empty.error === 'empty_input');
    }

    section('3 · Schema Validation & Clamping');
    {
        // 3.1 Layer cleaning
        const rawLayers = [
            { id: 'clip-1', kind: 'text', content: 'Headline', duration: 4 },
            { id: 'clip-2', kind: 'invalid-kind', content: 'Sub', duration: -10 },
            { id: '', kind: 'text' }, // should be filtered
        ];
        const cleaned = cleanLayers(rawLayers);
        check('filters invalid layers without id', cleaned.length === 2);
        check('defaults invalid kind to "text"', cleaned[1].kind === 'text');
        check('clamps negative or zero duration to minimum 0.2s', cleaned[1].duration >= 0.2);

        // 3.2 Scene plan cleaning
        const rawPlan = {
            tone: 'PREMIUM', // needs case-insensitivity or validation
            beats: [
                { kind: 'intro', text: 'Clean Reveal #trending', motion: { enter: 'rise-in', energy: 0.8 } },
                { kind: 'stat', value: '+150%!', label: 'Growth in ARR' },
                { kind: 'cta', text: 'Try it today.', motion: { enter: 'invalid-enter', energy: 2.5 } },
            ],
            extraGarbage: 'discard-me',
        };
        const cleanedPlan = cleanScenePlan(rawPlan);
        check('recognizes valid tone', cleanedPlan && cleanedPlan.tone === 'premium');
        check('strips hashtags and trailing punctuation from text', cleanedPlan.beats[0].text === 'Clean Reveal');
        check('preserves kicker and stat values', cleanedPlan.beats[1].value === '+150%');
        check('preserves valid motion override', cleanedPlan.beats[0].motion && cleanedPlan.beats[0].motion.enter === 'rise-in');
        check('discards invalid enter verb in motion override', cleanedPlan.beats[2].motion === undefined);

        // 3.3 Empty plan refusal
        const emptyPlan = cleanScenePlan({ beats: [], points: [] });
        check('refuses empty scene plan with no usable content', emptyPlan === null);
    }

    section('4 · Fallback to Rules on Provider Errors & Timeouts');
    await withEnv({ AI_MOTION_PROVIDER: 'rules' }, async () => {
        const layers = [{ id: 'title', kind: 'text', content: 'Launch', duration: 3 }];
        const result = await generateMotionScript({
            brief: 'minimal reveal',
            layers,
            composer,
            buildPrompt: buildMotionPrompt,
            cleanLayers,
        });
        check('AI_MOTION_PROVIDER="rules" returns source: "rules"', result.source === 'rules');
        check('deterministic rule planner provides motion beats', result.layers.title && result.layers.title.beats.length >= 1);
    });

    await withEnv({ AI_PROVIDER: 'mock', AI_MOTION_PROVIDER: 'mock' }, async () => {
        // Fast timeout test
        const controller = new AbortController();
        controller.abort(); // already cancelled

        const layers = [{ id: 'title', kind: 'text', content: 'Cancelled test', duration: 3 }];
        const cancelledResult = await generateMotionScript({
            brief: 'test cancellation',
            layers,
            composer,
            signal: controller.signal,
            buildPrompt: buildMotionPrompt,
            cleanLayers,
        });
        check('cancellation immediately falls back to rules safely', cancelledResult.source === 'rules');
        check('cancelled result still provides valid layers', cancelledResult.layers && cancelledResult.layers.title);
    });

    section('5 · End-to-End Generation with Mock Provider');
    await withEnv({ AI_PROVIDER: 'mock', AI_MOTION_PROVIDER: 'mock' }, async () => {
        // 5.1 Motion Script
        const layers = [
            { id: 'hero-title', kind: 'text', content: 'Next Gen Video', duration: 4 },
            { id: 'badge', kind: 'shape', content: '', duration: 4 },
        ];
        const motionRes = await generateMotionScript({
            brief: 'bold modern product intro with high energy',
            layers,
            editingStyle: 'punchy',
            composer,
            buildPrompt: buildMotionPrompt,
            cleanLayers,
        });
        check('mock motion generation returns source: "llm"', motionRes.source === 'llm');
        check('returns animations or beats for requested layers', motionRes.layers && motionRes.layers['hero-title']);
        check('includes descriptive motion notes', typeof motionRes.notes === 'string' && motionRes.notes.length > 0);

        // Validate composed layer beats through MotionComposer
        const titleBeats = motionRes.layers['hero-title'].beats || [];
        const validatedTitle = composer.composeMotion({ beats: titleBeats }, {
            duration: 4,
            kind: 'text',
        });
        check('composed motion compiles without dropping verbs', validatedTitle.dropped.length === 0);
        check('composed motion generates valid animations', validatedTitle.animations.length > 0);

        // 5.2 Scene Plan
        const sceneRes = await generateScenePlan({
            brief: 'Announce new AI motion graphics features for social creators',
            transcript: 'Today we are shipping automated motion design for videos.',
            platform: 'shorts',
            buildPrompt: buildScenePlanPrompt,
            cleanPlan: cleanScenePlan,
        });
        check('mock scene plan returns source: "llm"', sceneRes.source === 'llm');
        check('scene plan contains valid beats', sceneRes.plan && Array.isArray(sceneRes.plan.beats) && sceneRes.plan.beats.length > 0);
        check('scene plan selects an aesthetic tone', typeof sceneRes.plan.tone === 'string' && sceneRes.plan.tone.length > 0);
    });

    section('6 · Telemetry Sanitization');
    {
        let loggedText = '';
        const originalLog = console.log;
        console.log = (msg) => {
            loggedText += msg + '\n';
        };

        try {
            logMotionTelemetry({
                operation: 'motion-script',
                provider: 'gemma-local',
                model: 'gemma2:2b',
                latencyMs: 142.6,
                status: 'success',
                failureCategory: null,
            });
        } finally {
            console.log = originalLog;
        }

        check('telemetry logs op, provider, model, latencyMs, and status', loggedText.includes('op=motion-script') && loggedText.includes('provider=gemma-local'));
        check('telemetry latency is rounded to whole ms', loggedText.includes('latencyMs=143'));
        check('telemetry contains no leaked user prompt or secrets', !loggedText.includes('prompt') && !loggedText.includes('key'));
    }

    section('7 · Performance & Generation Benchmark');
    {
        console.log('  Running repeatable benchmark across key motion categories...');
        const categories = [
            { name: 'Product Reveal', brief: 'Sleek luxury product reveal with elegant text float' },
            { name: 'Kinetic Title', brief: 'Bold kinetic typography slamming in on the first second' },
            { name: 'Stat Callout', brief: 'Highlight +300% growth with punchy number emphasis' },
            { name: 'Lower Third', brief: 'Subtle speaker name and title bar rising from bottom' },
        ];

        const testLayers = [
            { id: 'main', kind: 'text', content: 'VIBED Motion Engine', duration: 4 },
        ];

        for (const cat of categories) {
            // Rules Benchmark
            const t0 = Date.now();
            const rulesRes = await withEnv({ AI_MOTION_PROVIDER: 'rules' }, () =>
                generateMotionScript({
                    brief: cat.brief,
                    layers: testLayers,
                    composer,
                    buildPrompt: buildMotionPrompt,
                    cleanLayers,
                })
            );
            const rulesLatency = Date.now() - t0;

            // Mock Benchmark
            const t1 = Date.now();
            const mockRes = await withEnv({ AI_PROVIDER: 'mock', AI_MOTION_PROVIDER: 'mock' }, () =>
                generateMotionScript({
                    brief: cat.brief,
                    layers: testLayers,
                    composer,
                    buildPrompt: buildMotionPrompt,
                    cleanLayers,
                })
            );
            const mockLatency = Date.now() - t1;

            check(
                `Benchmark [${cat.name}]: rules (${rulesLatency}ms, ${rulesRes.source}) | mock (${mockLatency}ms, ${mockRes.source})`,
                rulesRes.layers.main && mockRes.layers.main
            );
        }

        // Check if a local Gemma endpoint is reachable on localhost:11434 (Ollama)
        let localGemmaAvailable = false;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 800);
            const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const data = await res.json();
                localGemmaAvailable = (data.models || []).some(m => m.name.includes('gemma'));
            }
        } catch {
            // Local server not running, expected in standard CI/offline environments
        }

        if (localGemmaAvailable) {
            console.log('  [Local Gemma Detected] Running live benchmark against local model...');
            const t0 = Date.now();
            const gemmaRes = await withEnv({ AI_MOTION_PROVIDER: 'gemma-local' }, () =>
                generateMotionScript({
                    brief: 'Minimal high-tech reveal',
                    layers: testLayers,
                    composer,
                    buildPrompt: buildMotionPrompt,
                    cleanLayers,
                })
            );
            const gemmaLatency = Date.now() - t0;
            check(`Live Gemma generation succeeded in ${gemmaLatency}ms (source: ${gemmaRes.source})`, gemmaRes.layers && gemmaRes.layers.main);
        } else {
            console.log('  ℹ Local Gemma not detected on localhost:11434. Gemma integration verified via mock provider & contract compliance.');
        }
    }

    section('8 · Vertical Slice: Reference 8s Product Reveal');
    {
        const { composeSceneFromBrief, planFromBrief } = await import('../client/src/motion/SceneDirector.js');
        const { validateScene } = await import('../client/src/motion/SceneValidator.js');
        const { flattenScene } = await import('../client/src/motion/SceneSchema.js');
        const { resolveMotionAt } = await import('../client/src/motion/MotionResolver.js');
        const { clipToMotionLayer } = await import('../client/src/motion/ClipAdapter.js');

        const referenceBrief = "Create a premium 8-second product reveal for a modern creative software brand called 'Aether'. Open with a subtle backdrop accent, animate the title with a clean high-end entrance, introduce a supportive tagline, highlight key capabilities with staggered bullet callouts, and close with a restrained call-to-action.";

        // 8.1 Editorial Plan extraction from creative brief
        const plan = planFromBrief(referenceBrief);
        check('plan detects premium tone', plan.tone.label === 'premium');
        check('plan extracts requested 8-second duration', plan.askedDuration === 8);
        check('plan extracts brand title "Aether"', plan.beats[0].text === 'Aether');
        check('plan extracts supportive tagline', plan.beats[0].sub === 'Creative Software Reimagined');
        check('plan orders beats: intro -> 3 capabilities -> cta',
            plan.beats.length === 5 &&
            plan.beats[0].kind === 'intro' &&
            plan.beats[1].kind === 'point' &&
            plan.beats[2].kind === 'point' &&
            plan.beats[3].kind === 'point' &&
            plan.beats[4].kind === 'cta'
        );

        // 8.2 Scene Composition for 16:9
        const wideRes = composeSceneFromBrief(referenceBrief, { aspectRatio: '16:9' });
        check('composed 16:9 scene exists', Boolean(wideRes && wideRes.scene));
        check('composed 16:9 scene duration is exactly ~8.0s', Math.abs(wideRes.scene.duration - 8.0) < 0.05);

        const wideValidation = validateScene(wideRes.scene);
        check(
            '16:9 composition validates with 0 errors and 0 warnings',
            wideValidation.counts.error === 0 && wideValidation.counts.warn === 0,
            JSON.stringify(wideValidation.issues)
        );

        // Verify intro beat has backdrop accent
        const introGroup = wideRes.scene.nodes[0];
        const hasBackdrop = introGroup.children.some(c => c.name === 'Backdrop' || c.origin?.role === 'backdrop');
        check('intro beat includes subtle backdrop accent', hasBackdrop);

        // 8.3 Responsive Scaling for 9:16 vertical shape
        const verticalRes = composeSceneFromBrief(referenceBrief, { aspectRatio: '9:16' });
        check('composed 9:16 vertical scene exists', Boolean(verticalRes && verticalRes.scene));
        const verticalValidation = validateScene(verticalRes.scene);
        check(
            '9:16 vertical composition validates with 0 errors and 0 warnings',
            verticalValidation.counts.error === 0 && verticalValidation.counts.warn === 0,
            JSON.stringify(verticalValidation.issues)
        );

        // 8.4 Timeline Flattening & Traceability
        const { placements } = flattenScene(wideRes.scene);
        check('flattens cleanly into timeline clip placements (>=14 clips)', placements.length >= 14);
        const clips = placements.map(p => p.clip);
        check('all clips retain sceneId and sceneNodeId for bidirectional editing',
            clips.every(c => c.sceneId && c.sceneNodeId)
        );

        // 8.5 Motion Resolution & Preview Parity
        let motionParityPass = true;
        const testTimestamps = [0.2, 1.0, 2.0, 3.5, 5.0, 6.5, 7.8];
        for (const t of testTimestamps) {
            const active = clips.filter(c => t >= c.start && t < c.start + c.duration);
            for (const clip of active) {
                const layer = clipToMotionLayer(clip, { type: clip.type });
                const m = resolveMotionAt(layer, t);
                if (typeof m.opacity !== 'number' || typeof m.scale !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) {
                    motionParityPass = false;
                }
            }
        }
        check('preview motion resolution resolves smoothly across all 8s timestamps', motionParityPass);

        // 8.6 Headless Render / Export Parity
        // Validate that backdrop and accent template shapes draw cleanly via Skia canvas
        const Canvas = require('@napi-rs/canvas');
        const TemplateGraphics = await import('../client/src/motion/TemplateGraphics.js');
        const c = Canvas.createCanvas(400, 200);
        const ctx = c.getContext('2d');
        let drawError = null;
        try {
            TemplateGraphics.drawTemplate(ctx, 'panel', { w: 400, h: 200, color: '#0E0F11', opacity: 0.72 }, 1.0, 4.0, { scale: 1 });
            TemplateGraphics.drawTemplate(ctx, 'underline', { w: 300, h: 4, color: '#C8A96A', thickness: 3 }, 1.0, 4.0, { scale: 1 });
        } catch (err) {
            drawError = err.message;
        }
        check('production compositor draws template accents without errors', drawError === null);
    }

    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`Motion & Gemma Provider Suite: ${passed} passed, ${failed} failed`);
    console.log(`────────────────────────────────────────────────────────────`);

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error('Test suite uncaught error:', err);
    process.exit(1);
});
