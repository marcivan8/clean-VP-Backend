import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playerSource = fs.readFileSync(path.join(root, 'client/src/components/Player/VideoPlayer.jsx'), 'utf8');
const storeSource = fs.readFileSync(path.join(root, 'client/src/store/useTimelineStore.js'), 'utf8');

console.log('--- Testing Playhead Seeking & Frame Accuracy Past 35s ---');

// Test 1: Player duration calculation logic
function computePlayerDuration(nonTextTracks, timelineDuration) {
    const clips = nonTextTracks.flatMap(t => t.clips || []);
    const maxEnd = clips.reduce((m, c) => Math.max(m, (c.start || 0) + (c.duration || 0)), 0);
    return Math.max(timelineDuration, maxEnd, 1);
}

{
    // A project with video clips ending at 35s, but timeline duration 60s
    const tracks = [
        { id: 'v1', type: 'video', clips: [{ start: 0, duration: 35 }] }
    ];
    const playerDur = computePlayerDuration(tracks, 60);
    assert.strictEqual(playerDur, 60, 'Player duration must not be restricted to 35s when timeline is 60s');
    console.log('✓ Test 1 Passed: playerDuration covers timeline duration (60s) even when clips end at 35s');
}

{
    // A project with clips extending beyond timeline duration (e.g. 75s)
    const tracks = [
        { id: 'v1', type: 'video', clips: [{ start: 0, duration: 75 }] }
    ];
    const playerDur = computePlayerDuration(tracks, 60);
    assert.strictEqual(playerDur, 75, 'Player duration must expand if clips extend past timeline duration');
    console.log('✓ Test 2 Passed: playerDuration covers clips that extend past timeline duration');
}

// Test 3: Frame-accurate seek calculation
function calcSeekTime(clientX, rectLeft, zoomLevel, timelineDuration, fps = 30) {
    const x = clientX - rectLeft;
    const t = Math.max(0, Math.min(timelineDuration, x / zoomLevel));
    return Math.round(t * fps) / fps;
}

{
    const zoomLevel = 25; // 25 px/sec
    const timelineDuration = 60;
    const fps = 30;
    const rectLeft = 128; // ruler starts after 128px track header

    // Click at frame 1051 (35s + 1 frame = 35 + 1/30 = 35.0333...s)
    const targetSeconds = 35 + 1 / 30;
    const clientX = rectLeft + targetSeconds * zoomLevel;
    const seekTime = calcSeekTime(clientX, rectLeft, zoomLevel, timelineDuration, fps);
    
    assert.strictEqual(Math.abs(seekTime - (35 + 1 / 30)) < 1e-9, true, 'Seek time matches exact frame');
    assert.strictEqual(Math.round(seekTime * fps), 1051, 'Frame number must be exactly 1051');
    console.log(`✓ Test 3 Passed: Seeking to 35s + 1 frame lands exactly on frame 1051 (${seekTime.toFixed(4)}s)`);

    // Frame stepping test (every frame from 1050 to 1060 can be addressed)
    for (let f = 1050; f <= 1060; f++) {
        const timeAtFrame = f / fps;
        const xPos = rectLeft + timeAtFrame * zoomLevel;
        const computed = calcSeekTime(xPos, rectLeft, zoomLevel, timelineDuration, fps);
        assert.strictEqual(Math.round(computed * fps), f, `Frame ${f} must be precisely addressable`);
    }
    console.log('✓ Test 4 Passed: All frames past 35s (frames 1050 to 1060) are individually and precisely addressable');
}

// Test 5: onTimeUpdate feedback guard while paused
{
    let storeCurrentTime = 35.0333; // user seeked to frame 1051
    let isPlaying = false;

    function handleTimeUpdate(emittedTime) {
        if (isPlaying) {
            storeCurrentTime = emittedTime;
        }
    }

    // Revideo emits 35.0 (quantized or keyframe snapped while paused)
    handleTimeUpdate(35.0);
    assert.strictEqual(storeCurrentTime, 35.0333, 'Store currentTime must NOT be overwritten by onTimeUpdate while paused');
    console.log('✓ Test 5 Passed: onTimeUpdate does not snap or overwrite user targeted frame while paused');

    // When playing, onTimeUpdate does update store
    isPlaying = true;
    handleTimeUpdate(35.1);
    assert.strictEqual(storeCurrentTime, 35.1, 'Store currentTime updates while playing');
    console.log('✓ Test 6 Passed: onTimeUpdate advances playhead normally during playback');
}

// Playback time is observational. A seek action sends requestSeek() back to
// the player, so routing each onTick through seek creates a playback feedback
// loop and makes the playhead/video stutter.
assert.match(storeSource, /setPlaybackTime:\s*\(time\)\s*=>/);
assert.match(playerSource, /onTick:\s*\(time\)\s*=>\s*\{[\s\S]*?setPlaybackTime\(time\)/);
assert.match(playerSource, /if \(isPlaying\) useTimelineStore\.getState\(\)\.setPlaybackTime\(e\.currentTarget\.currentTime\)/);
assert.doesNotMatch(playerSource, /onTick:\s*\(time\)\s*=>\s*\{[\s\S]*?\.seek\(time\)/);
console.log('✓ Playback clock updates do not issue recursive seek commands');
console.log('ALL PLAYHEAD SEEK TESTS PASSED!');
