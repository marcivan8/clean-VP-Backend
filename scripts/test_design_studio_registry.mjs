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

// Test background removal
const resBgMatch = resolveDesignCommand('I want to remove the background');
check('resolveDesignCommand maps "I want to remove the background" to ds_remove_background',
    resBgMatch.match?.id === 'ds_remove_background' && resBgMatch.score >= 95);

const execBg = executeDesignCommand('I want to remove the background', mockCtx);
check('executeDesignCommand isolates subject and sets backgroundRemoved true',
    execBg.success && mockLayers.find(l => l.id === 'subject')?.backgroundRemoved === true);

// Test thumbnail creation from brief with quotes containing apostrophes
const thumbPrompt = 'create me a social media thumbnail from this image with the title "I\'m ready"';
const resThumb = resolveDesignCommand(thumbPrompt);
check('resolveDesignCommand maps "create me a social media thumbnail..." to ds_generate_thumbnail',
    resThumb.match?.id === 'ds_generate_thumbnail' && resThumb.score >= 95);

const { extractHeadlineFromBrief } = clientRegistry;
const extractedTitle = extractHeadlineFromBrief(thumbPrompt);
check('extractHeadlineFromBrief preserves apostrophes in "I\'m ready"',
    extractedTitle === "I'm ready");

let motionSceneTriggered = false;
let imageMockLayers = [
    { id: 'background', type: 'bg', fill: '#0F172A' },
    { id: 'IMG_1126', name: 'IMG_1126', type: 'image', url: 'https://example.com/speaker.jpg', w: 600, h: 800 },
];
const mockCtxWithImage = {
    ...mockCtx,
    layers: imageMockLayers,
    setLayers: (l) => { imageMockLayers = typeof l === 'function' ? l(imageMockLayers) : l; },
    applyDirection: (dir) => { imageMockLayers = dir.layers; },
    handleSaveAsMotionScene: () => { motionSceneTriggered = true; return { success: true }; },
};

const execThumb = executeDesignCommand(thumbPrompt, mockCtxWithImage);
check('executeDesignCommand generates thumbnail preserving existing image layer and headline',
    execThumb.success && imageMockLayers.some(l => l.type === 'text' && l.text === "I'm ready") && imageMockLayers.some(l => l.type === 'image' && l.url === 'https://example.com/speaker.jpg'));

// Test animate design command
const resAnimate = resolveDesignCommand('animate this design');
check('resolveDesignCommand maps "animate this design" to ds_animate_design',
    resAnimate.match?.id === 'ds_animate_design' && resAnimate.score >= 90);

const execAnimate = executeDesignCommand('animate this design', mockCtxWithImage);
check('executeDesignCommand dispatches handleSaveAsMotionScene',
    execAnimate.success && motionSceneTriggered === true);

console.log('\n── 4. Professional Vector & Auto Layout Engines ──');
const vectorMath = await import('../client/src/design-studio/vectorMath.js');
const autoLayout = await import('../client/src/design-studio/autoLayout.js');
const designSystem = await import('../client/src/design-studio/designSystem.js');

// Test polygon generation
const polygonD = vectorMath.generatePolygonPath(100, 100, 50, 6);
check('generatePolygonPath generates valid 6-sided polygon SVG path',
    polygonD.startsWith('M') && polygonD.endsWith('Z') && polygonD.includes('L'));

// Test star generation
const starD = vectorMath.generateStarPath(100, 100, 50, 25, 5);
check('generateStarPath generates valid 5-point star SVG path',
    starD.startsWith('M') && starD.endsWith('Z') && starD.includes('L'));

// Test squircle rounded rect
const rectD = vectorMath.generateRoundedRectPath(0, 0, 200, 100, 16, true);
check('generateRoundedRectPath generates smooth squircle path with Bézier curves',
    rectD.includes('C ') && rectD.endsWith('Z'));

// Test boolean compound operations
const boolRes = vectorMath.executeBooleanOperation('union', ['M 0 0 H 50 V 50 H 0 Z', 'M 25 25 H 75 V 75 H 25 Z']);
check('executeBooleanOperation unions SVG paths',
    boolRes.pathD.includes('M 0 0') && boolRes.fillRule === 'nonzero');

// Test Auto Layout Flexbox resolver
const mockFrame = {
    x: 0,
    y: 0,
    w: 400,
    h: 100,
    autoLayout: { enabled: true, direction: 'horizontal', gap: 20, paddingLeft: 10, paddingRight: 10, alignItems: 'center', sizingH: 'hug', sizingV: 'hug' }
};
const mockChildren = [
    { id: 'c1', x: 0, y: 0, w: 80, h: 40 },
    { id: 'c2', x: 0, y: 0, w: 100, h: 40 },
];
const alRes = autoLayout.resolveAutoLayout(mockFrame, mockChildren);
check('resolveAutoLayout computes horizontal positions with gap',
    alRes.childrenUpdates[0].x === 10 && alRes.childrenUpdates[1].x === 110);

// Test Smart Selection Spacing
const unspacedLayers = [
    { id: 'l1', x: 10, y: 0, w: 50 },
    { id: 'l2', x: 80, y: 0, w: 50 },
    { id: 'l3', x: 200, y: 0, w: 50 },
];
const spacedLayers = autoLayout.distributeSmartSelection(unspacedLayers, 'horizontal');
check('distributeSmartSelection spaces objects uniformly',
    spacedLayers[1].x - (spacedLayers[0].x + spacedLayers[0].w) ===
    spacedLayers[2].x - (spacedLayers[1].x + spacedLayers[1].w));

// Test Property Copy & Paste
const sourceLayer = {
    id: 'src',
    fill: '#00E5FF',
    stroke: '#FFFFFF',
    strokeWidth: 4,
    opacity: 80,
    fontFamily: 'Instrument Serif',
    fontSize: 64,
};
const targetLayer = { id: 'dst', fill: '#000000', opacity: 100 };
const copiedBag = designSystem.copyLayerProperties(sourceLayer);
const pastedLayer = designSystem.pasteLayerProperties(targetLayer, copiedBag);
check('copyLayerProperties and pasteLayerProperties copy visual styling',
    pastedLayer.fill === '#00E5FF' && pastedLayer.strokeWidth === 4 && pastedLayer.opacity === 80);

// Test Boolean, AutoLayout, Theme commands in registry
mockCtx.selectedLayerIds = ['headline', 'duration'];
const execBoolCmd = executeDesignCommand('union', mockCtx);
check('executeDesignCommand executes boolean union on selected shapes',
    execBoolCmd.success);

const execAutoLayoutCmd = executeDesignCommand('apply auto layout with 24px gap', mockCtx);
check('executeDesignCommand applies auto layout',
    execAutoLayoutCmd.success);

const execThemeCmd = executeDesignCommand('apply dark theme', mockCtx);
check('executeDesignCommand applies theme tokens',
    execThemeCmd.success);

const execReviewCmd = executeDesignCommand('review design for contrast and hierarchy', mockCtx);
check('executeDesignCommand audits design and returns feedback',
    execReviewCmd.success && execReviewCmd.message.includes('WCAG'));

console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`Design Studio Registry Tests: ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
