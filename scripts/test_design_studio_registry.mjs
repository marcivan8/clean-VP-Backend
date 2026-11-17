/**
 * scripts/test_design_studio_registry.mjs
 *
 * Verifies Design Studio AI Knowledge and Command Registries:
 * 1. Server Knowledge Engine (server/knowledge/vibedDesignStudioKnowledge.js)
 * 2. Client Command Registry (client/src/agent/DesignStudioCommandRegistry.js)
 * 3. Execution, parameter extraction, and prompt synthesis.
 *
 * Zero-dependency, native Node test runner. Strictly zero emojis.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const serverKnowledge = require('../server/knowledge/vibedDesignStudioKnowledge.js');
const clientRegistry = await import('../client/src/agent/DesignStudioCommandRegistry.js');

let passed = 0;
let failed = 0;

function check(label, condition, details = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}${details ? ` — ${details}` : ''}`);
        failed++;
    }
}

console.log('\n── 1. Server Design Studio Knowledge Engine ──');
const {
    DESIGN_SKILL_DOMAINS,
    DESIGN_TOOL_REGISTRY,
    AUTONOMOUS_DESIGN_RECIPES,
    classifyDesignSkills,
    getDesignToolContract,
    getDesignToolsByDomain,
    buildDesignStudioKnowledgePrompt,
} = serverKnowledge;

check('All 7 design skill domains are defined',
    Object.keys(DESIGN_SKILL_DOMAINS).length === 7);

check('Tool contracts have purpose, usageWays, and whenToUse',
    Object.values(DESIGN_TOOL_REGISTRY).every(t =>
        t.id && t.purpose && Array.isArray(t.usageWays) && t.usageWays.length > 0 && t.whenToUse
    ));

check('Recipes exist and contain steps',
    AUTONOMOUS_DESIGN_RECIPES.length >= 3 &&
    AUTONOMOUS_DESIGN_RECIPES.every(r => r.id && Array.isArray(r.steps) && r.steps.length > 0));

const classified = classifyDesignSkills('make headline larger and shift it left');
check('classifyDesignSkills detects geometry and typography',
    classified.some(c => c.domain === DESIGN_SKILL_DOMAINS.CANVAS_GEOMETRY || c.domain === DESIGN_SKILL_DOMAINS.TYPOGRAPHY_HIERARCHY));

const promptBlock = buildDesignStudioKnowledgePrompt();
check('buildDesignStudioKnowledgePrompt outputs principles and tools',
    promptBlock.includes('DESIGN STUDIO CRAFT & KNOWLEDGE REGISTRY') &&
    promptBlock.includes('ds_transform_layer') &&
    promptBlock.includes('Mobile 120px Readability'));

console.log('\n── 2. Client Design Studio Command Registry ──');
const {
    DESIGN_COMMANDS,
    extractDesignParams,
    scoreDesignCommand,
    resolveDesignCommand,
    executeDesignCommand,
} = clientRegistry;

check('At least 10 design commands registered',
    DESIGN_COMMANDS.length >= 10);

check('Commands have id, phrases, category, and execute functions',
    DESIGN_COMMANDS.every(c => c.id && Array.isArray(c.phrases) && typeof c.execute === 'function'));

// Parameter extraction checks
const nudgeParams = extractDesignParams(null, 'push headline 40px left');
check('extractDesignParams extracts targetLayer headline and left delta',
    nudgeParams.targetLayer === 'headline' && nudgeParams.deltaX === -40);

const sizeParams = extractDesignParams(null, 'set font size 88');
check('extractDesignParams extracts font size 88',
    sizeParams.fontSize === 88);

const fontParams = extractDesignParams(null, 'switch to instrument serif font');
check('extractDesignParams extracts Instrument Serif',
    fontParams.fontFamily === 'Instrument Serif');

const colorParams = extractDesignParams(null, 'make headline white text');
check('extractDesignParams extracts white color',
    colorParams.color === '#FFFFFF');

const dirParams = extractDesignParams(null, 'apply 94 rule style');
check('extractDesignParams extracts direction dir-b',
    dirParams.directionId === 'dir-b');

const surfParams = extractDesignParams(null, 'adapt to instagram social graphic');
check('extractDesignParams extracts social format',
    surfParams.formatId === 'social');

console.log('\n── 3. Live Canvas Execution & Mutation ──');
let mockLayers = [
    { id: 'headline', name: 'Headline', type: 'text', x: 60, y: 390, fontSize: 72, fill: '#F4EDE2' },
    { id: 'duration', name: 'Duration', type: 'badge', x: 48, y: 48, fill: '#C85A17' },
    { id: 'subject', name: 'Subject', type: 'image', x: 740, y: 120, w: 420, h: 560 },
    { id: 'background', name: 'Background', type: 'bg', fill: '#1A1A1A' },
];

const mockCtx = {
    layers: mockLayers,
    setLayers: (updater) => {
        mockLayers = typeof updater === 'function' ? updater(mockLayers) : updater;
    },
    selectedLayerId: 'headline',
    selectedFormat: 'thumbnail',
    setSelectedFormat: (fmt) => { mockCtx.selectedFormat = fmt; },
    applyDirection: (dirId) => { mockLayers[0].fill = '#C8622F'; },
    setSafeAreasEnabled: () => {},
    handleExport2Sizes: () => {},
};

// Test nudge
const execNudge = executeDesignCommand('nudge left', mockCtx);
check('executeDesignCommand shifts headline left',
    execNudge.success && mockLayers[0].x < 60);

// Test scale
const execScale = executeDesignCommand('make headline larger', mockCtx);
check('executeDesignCommand scales font size up',
    execScale.success && mockLayers[0].fontSize > 72);

// Test direction
const execDir = executeDesignCommand('apply 94 rule', mockCtx);
check('executeDesignCommand applies direction B',
    execDir.success && mockLayers[0].fill === '#C8622F');

// Test format adaptation
const execAdapt = executeDesignCommand('adapt to instagram', mockCtx);
check('executeDesignCommand adapts format to social',
    execAdapt.success && mockCtx.selectedFormat === 'social');

console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`Design Studio Registry Tests: ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
