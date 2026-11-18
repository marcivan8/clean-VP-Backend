/**
 * scripts/test_visual_speaker_grounding.mjs
 *
 * Automated tests for:
 * 1. AssemblyAI Diarization & Visual Speaker Grounding (findSpeakerSampleTimes, classifySpeakerSide, buildSpeakerVisualMap, computeSpeakerFraming).
 * 2. Visual-aware multi-cam cut director with spatial framing.
 * 3. Design Studio background layer deletion (transparent canvas) and addition.
 */

import {
    findSpeakerSampleTimes,
    classifySpeakerSide,
    buildSpeakerVisualMap,
    computeSpeakerFraming,
} from '../client/src/agent/visualSpeakerGrounding.js';
import {
    planMultiCamCuts,
    extractSpeakerTurns,
} from '../client/src/agent/MultiCamDirector.js';
import {
    resolveDesignCommand,
    executeDesignCommand,
} from '../client/src/agent/DesignStudioCommandRegistry.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

console.log('\n── 1. AssemblyAI Diarization & Visual Speaker Grounding ──');

// Synthetic AssemblyAI diarization data
const mockWords = [
    // Host speaks 0.0s to 4.0s
    { word: 'Welcome', start: 0.0, end: 0.5, speaker: 'SPEAKER_00' },
    { word: 'to', start: 0.6, end: 0.8, speaker: 'SPEAKER_00' },
    { word: 'the', start: 0.9, end: 1.1, speaker: 'SPEAKER_00' },
    { word: 'show', start: 1.2, end: 1.8, speaker: 'SPEAKER_00' },
    { word: 'everyone', start: 1.9, end: 3.8, speaker: 'SPEAKER_00' },

    // Guest speaks 5.5s to 9.5s
    { word: 'Thanks', start: 5.5, end: 6.0, speaker: 'SPEAKER_01' },
    { word: 'for', start: 6.1, end: 6.3, speaker: 'SPEAKER_01' },
    { word: 'having', start: 6.4, end: 6.8, speaker: 'SPEAKER_01' },
    { word: 'me', start: 6.9, end: 7.4, speaker: 'SPEAKER_01' },
    { word: 'today', start: 7.5, end: 9.5, speaker: 'SPEAKER_01' },
];

const sampleTimes = findSpeakerSampleTimes(mockWords, ['SPEAKER_00', 'SPEAKER_01']);
assert(sampleTimes.length === 2, 'Extracts sample times for both speakers');
assert(sampleTimes[0].speaker === 'SPEAKER_00' && sampleTimes[0].sampleTime >= 1.5 && sampleTimes[0].sampleTime <= 2.2,
    `Speaker 0 sample time centered around 1.9s (got ${sampleTimes[0]?.sampleTime}s)`);
assert(sampleTimes[1].speaker === 'SPEAKER_01' && sampleTimes[1].sampleTime >= 7.0 && sampleTimes[1].sampleTime <= 8.0,
    `Speaker 1 sample time centered around 7.5s (got ${sampleTimes[1]?.sampleTime}s)`);

// Test spatial classification
assert(classifySpeakerSide({ cx: 0.25, cy: 0.45, w: 0.2, h: 0.3 }) === 'left', 'classifySpeakerSide detects left speaker');
assert(classifySpeakerSide({ cx: 0.75, cy: 0.45, w: 0.2, h: 0.3 }) === 'right', 'classifySpeakerSide detects right speaker');
assert(classifySpeakerSide({ cx: 0.50, cy: 0.45, w: 0.2, h: 0.3 }) === 'center', 'classifySpeakerSide detects center speaker');

// Build visual map from snapshot detections
const mockSnapshots = [
    {
        speaker: 'SPEAKER_00',
        sampleTime: 1.9,
        detections: [{ class: 'person', score: 0.95, bbox: [200, 100, 300, 400] }], // Left side on 1280x720 (cx = 350/1280 = 0.273)
        frameWidth: 1280,
        frameHeight: 720,
    },
    {
        speaker: 'SPEAKER_01',
        sampleTime: 7.5,
        detections: [{ class: 'person', score: 0.92, bbox: [800, 100, 300, 400] }], // Right side on 1280x720 (cx = 950/1280 = 0.742)
        frameWidth: 1280,
        frameHeight: 720,
    },
];

const visualMap = buildSpeakerVisualMap(mockSnapshots);
assert(visualMap.SPEAKER_00?.side === 'left', 'Speaker 0 (Host) mapped to left side');
assert(visualMap.SPEAKER_01?.side === 'right', 'Speaker 1 (Guest) mapped to right side');
assert(visualMap.SPEAKER_00?.label === 'Host', 'Speaker 0 labeled as Host');
assert(visualMap.SPEAKER_01?.label === 'Guest', 'Speaker 1 labeled as Guest');

// Framing computation
const framingHost = computeSpeakerFraming(visualMap.SPEAKER_00.anchor, 1.4);
assert(framingHost.scale === 1.4 && framingHost.cx < 0.45, 'Framing computed with punch-in zoom centered on Host');
const framingGuest = computeSpeakerFraming(visualMap.SPEAKER_01.anchor, 1.4);
assert(framingGuest.scale === 1.4 && framingGuest.cx > 0.55, 'Framing computed with punch-in zoom centered on Guest');

console.log('\n── 2. Visual-Aware Multi-Cam Director Cuts ──');
const cuts = planMultiCamCuts({
    angleA: { id: 'camHost' },
    angleB: { id: 'camGuest' },
    wideAngle: { id: 'camWide' },
    words: mockWords,
    speakers: ['SPEAKER_00', 'SPEAKER_01'],
    speakerVisualMap: visualMap,
    totalDuration: 12,
});

assert(cuts.length >= 2, 'Generates multi-cam cut decision list');
assert(cuts[0].activeAngle === 'camHost' && cuts[0].side === 'left', 'First cut assigns Host camera based on left visual grounding');
const guestCut = cuts.find(c => c.speaker === 'SPEAKER_01');
assert(guestCut && guestCut.activeAngle === 'camGuest' && guestCut.side === 'right', 'Guest cut assigns Guest camera based on right visual grounding');
assert(guestCut?.framing?.scale > 1, 'Cut includes speaker-focused spatial framing coordinates');

console.log('\n── 3. Design Studio Background Layer Deletion & Addition ──');

let testLayers = [
    { id: 'headline', type: 'text', text: 'Hello' },
    { id: 'background', type: 'bg', fill: '#10151D' },
];
const mockCtx = {
    get layers() { return testLayers; },
    setLayers: (fn) => { testLayers = typeof fn === 'function' ? fn(testLayers) : fn; },
    selectedLayerId: 'background',
    setSelectedLayerId: () => {},
};

// Test delete canvas background command
const resDelBg = resolveDesignCommand('delete background layer');
assert(resDelBg.match?.id === 'ds_delete_canvas_background' && resDelBg.score >= 95,
    'Resolves "delete background layer" to ds_delete_canvas_background');

const execDelBg = executeDesignCommand('delete background layer', mockCtx);
assert(execDelBg.success && !testLayers.some(l => l.id === 'background'),
    'Deletes background layer making canvas transparent');

// Test add background layer command
const resAddBg = resolveDesignCommand('add background layer');
assert(resAddBg.match?.id === 'ds_add_canvas_background' && resAddBg.score >= 90,
    'Resolves "add background layer" to ds_add_canvas_background');

const execAddBg = executeDesignCommand('add background layer', mockCtx);
assert(execAddBg.success && testLayers.some(l => l.id === 'background'),
    'Adds background layer back to canvas');

console.log(`\n────────────────────────────────────────────────────────────`);
console.log(`Visual Grounding & Background Layer Tests: ${passed} passed, ${failed} failed`);
console.log(`────────────────────────────────────────────────────────────\n`);

if (failed > 0) process.exit(1);
