/**
 * scripts/generate_real_reel_test.mjs
 *
 * Produces a realistic visual test of VIBED's Motion Design Engine
 * on vertical 9:16 social media Reel footage of an actual creator speaking
 * about 3 steps to create a pro video.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { execFileSync } = require('child_process');

const ARTIFACT_DIR = '/Users/marcivanstevienguidjol/.gemini/antigravity-ide/brain/4f076580-e5eb-4d49-b19f-5ce9f63a6172';
const SCRATCH_DIR = path.join(ARTIFACT_DIR, 'scratch');
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

// 1. Register Typography
const FONT_DIR = path.join(ROOT, 'client', 'public', 'fonts');
const FONT_FILES = {
    'Anton': 'Anton-Regular.ttf',
    'Montserrat': 'Montserrat-Bold.ttf',
    'Inter': 'Inter-Regular.ttf',
    'Poppins': 'Poppins-Regular.ttf',
    'BebasNeue': 'BebasNeue-Regular.ttf',
};
for (const [family, file] of Object.entries(FONT_FILES)) {
    const p = path.join(FONT_DIR, file);
    if (fs.existsSync(p)) {
        GlobalFonts.registerFromPath(p, family);
    }
}

// 2. Import VIBED Motion Engine Core Modules
const { composeSceneFromBrief, planFromBrief } = await import('../client/src/motion/SceneDirector.js');
const { flattenScene } = await import('../client/src/motion/SceneSchema.js');
const { resolveMotionAt } = await import('../client/src/motion/MotionResolver.js');
const { clipToMotionLayer } = await import('../client/src/motion/ClipAdapter.js');
const { drawTemplate, templateSize, templateParams } = await import('../client/src/motion/TemplateGraphics.js');
const { validateScene } = await import('../client/src/motion/SceneValidator.js');

console.log('=== VIBED REAL VISUAL TEST GENERATOR ===');

// 3. Creator Images & Beat Mapping
const BEATS = [
    {
        id: 'beat1',
        title: '3 STEPS TO PRO VIDEO',
        subtitle: 'Level up your content today',
        start: 0.0,
        end: 2.94,
        imageFile: 'creator_talking_reel_1792102088008.jpg',
        speech: 'Here are three steps to create a pro video for social media.',
        tag: 'HOOK',
        tagColor: '#FF3B30'
    },
    {
        id: 'beat2',
        title: 'HOOK IN FIRST 3s',
        subtitle: 'Stop the scroll immediately',
        start: 2.94,
        end: 5.23,
        imageFile: 'creator_step1_pose_1792102211155.jpg',
        speech: 'Step one: Hook in the first three seconds.',
        tag: 'STEP 01',
        tagColor: '#FF9500'
    },
    {
        id: 'beat3',
        title: 'CLEAN CRISP AUDIO',
        subtitle: '80% of viewers leave bad audio',
        start: 5.23,
        end: 7.43,
        imageFile: 'creator_step2_pose_1792102226125.jpg',
        speech: 'Step two: Clean, crisp audio.',
        tag: 'STEP 02',
        tagColor: '#00E5FF'
    },
    {
        id: 'beat4',
        title: 'DYNAMIC MOTION EDITS',
        subtitle: 'Keep pacing fast & rhythmic',
        start: 7.43,
        end: 9.56,
        imageFile: 'creator_step3_pose_1792102241590.jpg',
        speech: 'Step three: Dynamic motion edits.',
        tag: 'STEP 03',
        tagColor: '#AF52DE'
    },
    {
        id: 'beat5',
        title: 'SAVE & TRY THIS',
        subtitle: 'Follow for daily creator tips',
        start: 9.56,
        end: 11.50,
        imageFile: 'creator_cta_pose_1792102257859.jpg',
        speech: 'Save and try this for your next video!',
        tag: 'TAKE ACTION',
        tagColor: '#34C759'
    }
];

const TOTAL_DURATION = 11.50;

// 4. Load Creator Images
console.log('Loading creator high-resolution images...');
const loadedImages = {};
for (const beat of BEATS) {
    const fullPath = path.join(ARTIFACT_DIR, beat.imageFile);
    if (!fs.existsSync(fullPath)) {
        throw new Error(`Image not found: ${fullPath}`);
    }
    loadedImages[beat.id] = await loadImage(fullPath);
    console.log(`  ✓ Loaded ${beat.id} (${beat.imageFile})`);
}

// 5. Subject Definition (Tracked face/body of creator)
// In the 9:16 frame, the speaker's face and upper body occupy cy: 0.55
const subject = { cx: 0.50, cy: 0.55, w: 0.52, h: 0.60 };
const safeZone = { top: 0.08, bottom: 0.18, left: 0.06, right: 0.06 };

// 6. Execute VIBED Director to Compose the Scene
const brief = "Create a punchy viral reel video for social media. Introduce 3 steps to create a pro video, highlighting Step 1: Hook in first 3s, Step 2: Clean crisp audio, Step 3: Dynamic motion graphics, and finish with a strong call to action to save and follow.";

const plan = planFromBrief(brief, {
    items: ['Hook in first 3s', 'Clean crisp audio', 'Dynamic motion graphics'],
    title: '3 STEPS TO PRO VIDEO',
    cta: 'SAVE & TRY THIS',
});

// Override plan beat timings to match the real speaker's speech delivery
plan.titleBeat = { start: BEATS[0].start, duration: BEATS[0].end - BEATS[0].start };
plan.steps = [
    { title: BEATS[1].title, sub: BEATS[1].subtitle, start: BEATS[1].start, duration: BEATS[1].end - BEATS[1].start },
    { title: BEATS[2].title, sub: BEATS[2].subtitle, start: BEATS[2].start, duration: BEATS[2].end - BEATS[2].start },
    { title: BEATS[3].title, sub: BEATS[3].subtitle, start: BEATS[3].start, duration: BEATS[3].end - BEATS[3].start },
];
plan.ctaBeat = { start: BEATS[4].start, duration: BEATS[4].end - BEATS[4].start };

const composed = composeSceneFromBrief(brief, {
    aspectRatio: '9:16',
    duration: TOTAL_DURATION,
    subject,
    safeZone,
    plan,
});

const validation = validateScene(composed.scene);
console.log(`Scene validation: ${validation.counts.error} errors, ${validation.counts.warn} warnings.`);

const { placements } = flattenScene(composed.scene);
const clips = placements.map(p => p.clip);
console.log(`Total flattened clips: ${clips.length}`);
console.log(`Resolved Graphic placement: anchor=${composed.placement.anchor}, y=${composed.placement.y}`);

// 7. Video Dimensions (HD 9:16 Vertical)
const W = 720;
const H = 1280;
const scaleRatio = W / 1080;

/**
 * Draws the real creator with camera micro-motion and smooth beat transitions
 */
function drawCreatorBackground(ctx, t) {
    // Find current active beat
    let activeIndex = BEATS.findIndex(b => t >= b.start && t < b.end);
    if (activeIndex === -1) activeIndex = BEATS.length - 1;
    const currentBeat = BEATS[activeIndex];

    // Subtle handheld breathing micro-motion
    const breathing = 1.0 + 0.012 * Math.sin(t * 1.8);
    const swayX = Math.sin(t * 0.9) * 2.5;
    const swayY = Math.cos(t * 1.1) * 2.0;

    // Check if we are near a cut transition (0.12s crossfade)
    const fadeWindow = 0.12;
    const timeUntilEnd = currentBeat.end - t;
    const isTransitioning = timeUntilEnd < fadeWindow && activeIndex < BEATS.length - 1;

    ctx.save();
    ctx.translate(W / 2 + swayX, H / 2 + swayY);
    ctx.scale(breathing, breathing);
    ctx.translate(-W / 2, -H / 2);

    // Draw base current image
    const imgA = loadedImages[currentBeat.id];
    ctx.drawImage(imgA, 0, 0, W, H);

    // If in transition window, crossfade with next pose
    if (isTransitioning) {
        const nextBeat = BEATS[activeIndex + 1];
        const imgB = loadedImages[nextBeat.id];
        const alpha = 1.0 - (timeUntilEnd / fadeWindow);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.drawImage(imgB, 0, 0, W, H);
        ctx.restore();
    }

    ctx.restore();

    // Subtle cinematic vignette to make upper text overlays and lower controls pop
    const vignette = ctx.createLinearGradient(0, 0, 0, H);
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0.40)');
    vignette.addColorStop(0.22, 'rgba(0, 0, 0, 0.0)');
    vignette.addColorStop(0.75, 'rgba(0, 0, 0, 0.0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // Social HUD (Reels controls)
    drawSocialHud(ctx, t);
}

function drawSocialHud(ctx, t) {
    ctx.save();
    // Top Reel indicator
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.font = '700 18px Inter';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText('Reels', 36, 64);

    // Audio pill (bottom left)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.beginPath();
    ctx.roundRect(32, H - 96, 230, 36, 18);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 13px Inter';
    ctx.shadowBlur = 0;
    ctx.fillText('♫ Samantha · Original Audio', 48, H - 73);

    // Engagement icons (heart, comment, share, bookmark)
    const iconX = W - 44;
    const icons = [
        { label: '48.2K', icon: '❤️' },
        { label: '1,280', icon: '💬' },
        { label: 'Share', icon: '↗️' },
        { label: 'Save',  icon: '🔖' }
    ];
    icons.forEach((item, i) => {
        const y = H - 320 + i * 58;
        ctx.fillStyle = '#ffffff';
        ctx.font = '24px Inter';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 6;
        ctx.fillText(item.icon, iconX, y);
        ctx.font = '600 11px Inter';
        ctx.fillText(item.label, iconX, y + 16);
    });

    // Top progress scrubber bar
    const progress = Math.min(1, t / TOTAL_DURATION);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.fillRect(0, 0, W, 4);
    ctx.fillStyle = '#FFE500';
    ctx.fillRect(0, 0, W * progress, 4);

    ctx.restore();
}

/**
 * Renders full frame at timestamp t
 */
function renderFrame(t) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 1. Draw live creator footage
    drawCreatorBackground(ctx, t);

    // 2. Active motion clips at time t
    const activeClips = clips.filter(c => t >= c.start && t <= c.start + c.duration);

    // Sort: backdrop panels first, text/labels on top
    activeClips.sort((a, b) => {
        const isBackdropA = a.template?.kind === 'panel';
        const isBackdropB = b.template?.kind === 'panel';
        if (isBackdropA && !isBackdropB) return -1;
        if (!isBackdropA && isBackdropB) return 1;
        return 0;
    });

    for (const clip of activeClips) {
        const layer = clipToMotionLayer(clip, { type: clip.type });
        const m = resolveMotionAt(layer, t);

        if (!m.visible || m.opacity <= 0.01) continue;

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, m.opacity));

        const cx = (m.x / 100) * W;
        const cy = (m.y / 100) * H;

        ctx.translate(cx, cy);
        if (m.rotation) ctx.rotate((m.rotation * Math.PI) / 180);
        if (m.scale !== 1) ctx.scale(m.scale, m.scale);

        if (clip.type === 'text') {
            const fontSize = Math.round((clip.fontSize || 48) * scaleRatio);
            const fontFamily = clip.fontFamily || 'Inter';
            const fontWeight = clip.fontWeight || 800;
            ctx.font = `${fontWeight} ${fontSize}px "${fontFamily}"`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const lines = String(clip.content || '').split('\n');
            const lineHeight = fontSize * 1.18;
            const totalTextHeight = (lines.length - 1) * lineHeight;

            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                const lineY = -totalTextHeight / 2 + li * lineHeight;

                // High-contrast clean dropshadow
                ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                ctx.shadowBlur = 16;
                ctx.shadowOffsetY = 4;

                // Stroke outline if defined
                if (clip.stroke) {
                    ctx.strokeStyle = clip.stroke.color || '#000000';
                    ctx.lineWidth = Math.max(2, (clip.stroke.width || 3) * scaleRatio);
                    ctx.strokeText(line, 0, lineY);
                }

                ctx.fillStyle = clip.color || '#ffffff';
                ctx.fillText(line, 0, lineY);
            }
        } else if (clip.type === 'template') {
            const kind = clip.template?.kind;
            const params = templateParams(kind, clip.template?.params);
            const size = templateSize(kind, params);
            const localT = t - clip.start;

            // Matches GraphicOverlay and Compositor: width = W * 0.25 * scale
            const tplW = W * 0.25 * (clip.scale || 1);
            const tplH = tplW * (size.h / size.w);

            ctx.translate(-tplW / 2, -tplH / 2);
            try {
                drawTemplate(ctx, kind, params, localT, clip.duration, { scale: (tplW / size.w) });
            } catch (err) {
                console.warn('Template draw error:', err.message);
            }
        }

        ctx.restore();
    }

    return canvas;
}

// 8. Render Key Beat Frames for Carousel and High-Res Inspection
const keyBeats = [
    { name: 'real_reel_beat1_hook.png', t: 1.50, title: 'Beat 1: Hook Title (0.0s – 2.94s)' },
    { name: 'real_reel_beat2_step1.png', t: 4.10, title: 'Beat 2: Step 01 - Hook in first 3s (2.94s – 5.23s)' },
    { name: 'real_reel_beat3_step2.png', t: 6.30, title: 'Beat 3: Step 02 - Clean crisp audio (5.23s – 7.43s)' },
    { name: 'real_reel_beat4_step3.png', t: 8.50, title: 'Beat 4: Step 03 - Dynamic motion edits (7.43s – 9.56s)' },
    { name: 'real_reel_beat5_cta.png',   t: 10.5, title: 'Beat 5: Call to Action - Save & Try (9.56s – 11.5s)' },
];

console.log('Rendering 5 real high-res visual beat frames...');
for (const beat of keyBeats) {
    const canvas = renderFrame(beat.t);
    const destPath = path.join(ARTIFACT_DIR, beat.name);
    fs.writeFileSync(destPath, canvas.toBuffer('image/png'));
    console.log(`  ✓ Saved ${beat.name} at t=${beat.t}s`);
}

// 9. Generate Sound Design (Voiceover + SFX Transitions)
console.log('Assembling professional audio track (Voiceover + SFX)...');
const audioTrackList = [];

// Voice files
for (const beat of BEATS) {
    const aiffPath = path.join(SCRATCH_DIR, `${beat.id}.aiff`);
    if (!fs.existsSync(aiffPath)) {
        execFileSync('say', ['-v', 'Samantha', '-r', '210', beat.speech, '-o', aiffPath]);
    }
    audioTrackList.push({ file: aiffPath, delay: beat.start });
}

// SFX Whooshes on each entrance
const whoosh1 = path.join(ROOT, 'Social SFX Pack - Collection 1', 'Whooshs', 'Whoosh 1.mp3');
const whoosh2 = path.join(ROOT, 'Social SFX Pack - Collection 1', 'Whooshs', 'Whoosh 2.mp3');
const whoosh3 = path.join(ROOT, 'Social SFX Pack - Collection 1', 'Whooshs', 'Whoosh 3.mp3');
const impact = path.join(ROOT, 'Social SFX Pack - Collection 1', 'Impacts', 'Cinematic Impact.mp3');

const sfxCues = [
    { file: whoosh1, delay: 0.05, volume: 0.5 },
    { file: whoosh2, delay: 2.94, volume: 0.6 },
    { file: whoosh3, delay: 5.23, volume: 0.6 },
    { file: whoosh2, delay: 7.43, volume: 0.6 },
    { file: impact,  delay: 9.56, volume: 0.4 },
];

// Build FFmpeg complex filter to mix all audio inputs
const ffmpegBin = ffmpegInstaller.path;
const audioInputs = [];
const filterParts = [];
let streamIdx = 0;

for (const v of audioTrackList) {
    audioInputs.push('-i', v.file);
    const delayMs = Math.round(v.delay * 1000);
    filterParts.push(`[${streamIdx}:a]adelay=${delayMs}|${delayMs}[v${streamIdx}];`);
    streamIdx++;
}

for (const s of sfxCues) {
    audioInputs.push('-i', s.file);
    const delayMs = Math.round(s.delay * 1000);
    filterParts.push(`[${streamIdx}:a]volume=${s.volume},adelay=${delayMs}|${delayMs}[v${streamIdx}];`);
    streamIdx++;
}

const mixLabels = Array.from({ length: streamIdx }, (_, i) => `[v${i}]`).join('');
const filterComplex = `${filterParts.join('')}${mixLabels}amix=inputs=${streamIdx}:duration=longest:dropout_transition=2[aout]`;

const finalAudioPath = path.join(SCRATCH_DIR, 'mixed_reel_audio.aac');
console.log('Mixing audio with FFmpeg amix...');
execFileSync(ffmpegBin, [
    '-y',
    ...audioInputs,
    '-filter_complex', filterComplex,
    '-map', '[aout]',
    '-c:a', 'aac',
    '-b:a', '192k',
    finalAudioPath
]);
console.log(`✓ Audio mixed successfully: ${finalAudioPath}`);

// 10. Render Full Video Frames (24 fps across 11.5 seconds)
const fps = 24;
const totalFrames = Math.round(TOTAL_DURATION * fps);
console.log(`Rendering ${totalFrames} video frames at 720x1280 @ 24fps...`);
const framesDir = path.join(SCRATCH_DIR, 'real_reel_frames');
fs.mkdirSync(framesDir, { recursive: true });

for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    const canvas = renderFrame(t);
    const frameName = `frame_${String(i).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(framesDir, frameName), canvas.toBuffer('image/png'));
    if (i % 48 === 0 || i === totalFrames - 1) {
        process.stdout.write(`  Rendered frame ${i}/${totalFrames} (${Math.round((i/totalFrames)*100)}%)\r`);
    }
}
console.log('\n✓ Frame rendering complete.');

// 11. Encode Final High-Definition MP4 Video with Muxed Audio
const finalVideoPath = path.join(ARTIFACT_DIR, 'real_reel_final.mp4');
console.log('Encoding final high-definition MP4 video with FFmpeg...');
execFileSync(ffmpegBin, [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(framesDir, 'frame_%04d.png'),
    '-i', finalAudioPath,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '19',
    '-preset', 'fast',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    finalVideoPath,
]);

// Clean up scratch frames to conserve disk space
fs.rmSync(framesDir, { recursive: true, force: true });
console.log(`✓ High-Definition Animated Reel produced: ${finalVideoPath}`);

console.log('=== REAL VISUAL TEST GENERATION COMPLETE ===');
