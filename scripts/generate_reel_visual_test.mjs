/**
 * scripts/generate_reel_visual_test.mjs
 *
 * Generates visual test frames and an animated video demonstrating how VIBED
 * animates a 9:16 vertical Reel where a creator talks in front of camera
 * about "3 steps to create a pro video for social media".
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const { execFileSync } = require('child_process');

// Register fonts
const FONT_DIR = path.join(ROOT, 'client', 'public', 'fonts');
const FONT_FILES = {
    'Anton': 'Anton-Regular.ttf',
    'Montserrat': 'Montserrat-Bold.ttf',
    'Inter': 'Inter-Regular.ttf',
};
for (const [family, file] of Object.entries(FONT_FILES)) {
    const p = path.join(FONT_DIR, file);
    if (fs.existsSync(p)) {
        GlobalFonts.registerFromPath(p, family);
    }
}

// Import motion modules
const { composeSceneFromBrief, planFromBrief } = await import('../client/src/motion/SceneDirector.js');
const { flattenScene } = await import('../client/src/motion/SceneSchema.js');
const { resolveMotionAt } = await import('../client/src/motion/MotionResolver.js');
const { clipToMotionLayer } = await import('../client/src/motion/ClipAdapter.js');
const { drawTemplate, templateSize, templateParams } = await import('../client/src/motion/TemplateGraphics.js');

const ARTIFACT_DIR = '/Users/marcivanstevienguidjol/.gemini/antigravity-ide/brain/4f076580-e5eb-4d49-b19f-5ce9f63a6172';

// 1. Creative Brief
const brief = "Create a punchy viral reel video for social media. Introduce 3 steps to create a pro video, highlighting Step 1: Hook in first 3s, Step 2: Clean crisp audio, Step 3: Dynamic motion graphics, and finish with a strong call to action to save and follow.";

// 2. Creator subject in front of camera
// In a 9:16 Reel, a speaker occupies the center-to-lower portion of the frame
const subject = { cx: 0.5, cy: 0.58, w: 0.44, h: 0.54 };
const safeZone = { top: 0.08, bottom: 0.18, left: 0.06, right: 0.06 };

const plan = planFromBrief(brief, {
    items: ['Hook in first 3s', 'Clean crisp audio', 'Dynamic motion graphics'],
    title: '3 STEPS TO PRO VIDEO',
});

const composed = composeSceneFromBrief(brief, {
    aspectRatio: '9:16',
    duration: 10,
    subject,
    safeZone,
    plan,
});

if (!composed || !composed.scene) {
    console.error('Failed to compose scene from brief');
    process.exit(1);
}

const { placements } = flattenScene(composed.scene);
const clips = placements.map(p => p.clip);
console.log(`Scene composed successfully: ${composed.scene.duration}s, ${clips.length} flattened clips.`);
console.log(`Graphic placement: anchor=${composed.placement.anchor}, y=${composed.placement.y || 'auto'}, reason="${composed.placement.reason}"`);

// Canvas resolution for vertical preview (540 x 960 for high-performance rendering)
const W = 540;
const H = 960;
const scaleRatio = W / 1080; // 0.5 scale factor against reference 1080x1920

/**
 * Draws the talking-head creator in studio environment
 */
function drawCreatorBackground(ctx, t) {
    // 1. Studio backdrop: dark moody charcoal gradient with subtle cinematic ambient glow
    const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.45, 80, W * 0.5, H * 0.5, H * 0.75);
    bgGrad.addColorStop(0, '#1c212d');
    bgGrad.addColorStop(0.5, '#12151c');
    bgGrad.addColorStop(1, '#090a0e');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Subtle ambient neon rim light in background (cyber cyan / gold)
    const rimGrad = ctx.createRadialGradient(W * 0.15, H * 0.35, 10, W * 0.15, H * 0.35, 260);
    rimGrad.addColorStop(0, 'rgba(0, 229, 255, 0.18)');
    rimGrad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = rimGrad;
    ctx.fillRect(0, 0, W, H);

    const warmGrad = ctx.createRadialGradient(W * 0.85, H * 0.55, 10, W * 0.85, H * 0.55, 240);
    warmGrad.addColorStop(0, 'rgba(255, 229, 0, 0.12)');
    warmGrad.addColorStop(1, 'rgba(255, 229, 0, 0)');
    ctx.fillStyle = warmGrad;
    ctx.fillRect(0, 0, W, H);

    // 2. Creator figure (talking to camera)
    ctx.save();
    // Gentle natural breathing / gesture sway
    const swayX = Math.sin(t * 1.8) * 3;
    const swayY = Math.cos(t * 2.4) * 2;

    const personCx = W * 0.5 + swayX;
    const personCy = H * 0.65 + swayY;

    // Body / Torso (dark stylish blazer/tee)
    ctx.fillStyle = '#181b22';
    ctx.beginPath();
    ctx.ellipse(personCx, personCy + 180, 160, 220, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shoulder highlights / rim light
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(personCx - 100, personCy + 130, 60, 100, -0.2, Math.PI * 0.8, Math.PI * 1.4);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 229, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(personCx + 100, personCy + 130, 60, 100, 0.2, Math.PI * 1.6, Math.PI * 2.2);
    ctx.stroke();

    // Neck
    ctx.fillStyle = '#c59577';
    ctx.fillRect(personCx - 22, personCy - 20, 44, 60);

    // Head / Face
    ctx.fillStyle = '#dfab8c';
    ctx.beginPath();
    ctx.ellipse(personCx, personCy - 70, 52, 68, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hair
    ctx.fillStyle = '#1a1816';
    ctx.beginPath();
    ctx.ellipse(personCx, personCy - 110, 54, 44, 0, 0, Math.PI * 2);
    ctx.fill();

    // Studio microphone in front (podcaster / creator aesthetic)
    ctx.fillStyle = '#2a2e39';
    ctx.beginPath();
    ctx.roundRect(personCx - 16, personCy + 90, 32, 54, 12);
    ctx.fill();
    ctx.strokeStyle = '#4f566b';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Mic stand
    ctx.strokeStyle = '#1d212a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(personCx, personCy + 144);
    ctx.lineTo(personCx, H);
    ctx.stroke();

    ctx.restore();

    // 3. Social UI Overlay (Reel HUD)
    drawSocialHud(ctx, t);
}

function drawSocialHud(ctx, t) {
    ctx.save();
    // Top Reel indicator
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = '700 13px Inter';
    ctx.fillText('Reels', 28, 48);

    // Audio pill (bottom left)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(24, H - 76, 170, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '500 11px Inter';
    ctx.fillText('♫ Original Audio · Creator', 36, H - 58);

    // Engagement icons (heart, comment, share on right)
    const iconX = W - 36;
    const icons = ['♡', '💬', '↗'];
    icons.forEach((ic, i) => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.font = '20px Inter';
        ctx.textAlign = 'center';
        ctx.fillText(ic, iconX, H - 210 + i * 46);
    });

    // Recording time / progress bar
    const progress = Math.min(1, t / 10);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(0, 0, W, 3);
    ctx.fillStyle = '#FFE500';
    ctx.fillRect(0, 0, W * progress, 3);

    ctx.restore();
}

/**
 * Renders a single frame at timestamp t
 */
function renderFrame(t) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // 1. Draw creator background
    drawCreatorBackground(ctx, t);

    // 2. Render all active clips at time t
    const activeClips = clips.filter(c => t >= c.start && t <= c.start + c.duration);

    // Sort: templates (backdrops/accents) draw first if backdrop, text draws on top
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

        // Center coordinates in canvas pixels
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

            // Shadow
            if (clip.textShadow) {
                ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                ctx.shadowBlur = 14;
                ctx.shadowOffsetY = 4;
            }

            // Stroke / Outline
            if (clip.stroke) {
                ctx.strokeStyle = clip.stroke.color || '#000000';
                ctx.lineWidth = Math.max(2, (clip.stroke.width || 3) * scaleRatio);
                ctx.strokeText(clip.content || '', 0, 0);
            }

            ctx.fillStyle = clip.color || '#ffffff';
            ctx.fillText(clip.content || '', 0, 0);
        } else if (clip.type === 'template') {
            const kind = clip.template?.kind;
            const params = templateParams(kind, clip.template?.params);
            const size = templateSize(kind, params);
            const localT = t - clip.start;

            // Template canvas draws centered
            const tplW = size.w * scaleRatio * (clip.scale || 1);
            const tplH = size.h * scaleRatio * (clip.scale || 1);

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

// 3. Render 5 Key Visual Beat Frames
const keyBeats = [
    { name: 'reel_beat1_hook.png', t: 1.1, title: 'Beat 1: Hook Title (0.0s – 2.2s)' },
    { name: 'reel_beat2_step1.png', t: 2.9, title: 'Beat 2: Step 01 - Hook in first 3s (2.2s – 4.2s)' },
    { name: 'reel_beat3_step2.png', t: 4.9, title: 'Beat 3: Step 02 - Clean crisp audio (4.2s – 6.2s)' },
    { name: 'reel_beat4_step3.png', t: 6.9, title: 'Beat 4: Step 03 - Dynamic motion graphics (6.2s – 8.2s)' },
    { name: 'reel_beat5_cta.png', t: 8.9, title: 'Beat 5: Call to Action - Save & Try (8.2s – 10.0s)' },
];

console.log('Rendering 5 key visual frames...');
for (const beat of keyBeats) {
    const canvas = renderFrame(beat.t);
    const destPath = path.join(ARTIFACT_DIR, beat.name);
    fs.writeFileSync(destPath, canvas.toBuffer('image/png'));
    console.log(`  ✓ Saved ${beat.name} (at t=${beat.t}s)`);
}

// 4. Render smooth MP4 video preview of the 10-second Reel
console.log('Rendering 10s video sequence (30 fps)...');
const tempFramesDir = path.join(ARTIFACT_DIR, 'scratch', 'reel_frames');
fs.mkdirSync(tempFramesDir, { recursive: true });

const fps = 24; // 24 fps for smooth motion preview
const totalFrames = Math.round(10 * fps);
for (let i = 0; i < totalFrames; i++) {
    const t = i / fps;
    const canvas = renderFrame(t);
    const frameName = `frame_${String(i).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(tempFramesDir, frameName), canvas.toBuffer('image/png'));
}

const videoDestPath = path.join(ARTIFACT_DIR, 'reel_animation_preview.mp4');
const ffmpegBin = ffmpegInstaller.path;

console.log('Encoding MP4 with FFmpeg...');
execFileSync(ffmpegBin, [
    '-y',
    '-framerate', String(fps),
    '-i', path.join(tempFramesDir, 'frame_%04d.png'),
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-preset', 'fast',
    videoDestPath,
]);

// Cleanup temp frames
fs.rmSync(tempFramesDir, { recursive: true, force: true });
console.log(`✓ Video rendered successfully: ${videoDestPath}`);
console.log('Visual test generation complete!');
