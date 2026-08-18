#!/usr/bin/env node
/**
 * Regression: Render architecture split (CLAUDE.md R69) — the self-hosted
 * (non-Lambda) Revideo render-worker now draws captions + motion graphics +
 * stickers/lower-thirds, while FFmpeg keeps cuts/audio/encoding/muxing AND
 * camera motion. Covers: the ported motion/ files stay in sync with
 * client/src/motion/, RevideoLayerAdapter's resolution priority, the new
 * scene's structure, render-worker/server.js's updated contract, and
 * exportProcessor.js's opt-in wiring (STEP 2.5/STEP 4 mutual exclusion with
 * Revideo, fails-open behaviour, env docs).
 *
 * Run: node scripts/test_revideo_render_path.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const check = (n, c, d) => {
    if (c) { passed++; console.log(`  ✓ ${n}`); }
    else { failed++; console.log(`  ✗ ${n}`); if (d) console.log(`      ${d}`); }
};
const section = (t) => console.log(`\n${t}`);

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => {
    try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
    catch (err) { console.log(`  ✗ could not read ${rel} — ${err.code || err.message}`); failed++; return ''; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

// Strips this project's synced-copy header block (everything up to and
// including the "───" divider line) so the REST of the file can be
// byte-compared against the original it was copied from.
function stripSyncHeader(src) {
    const dividerIdx = src.indexOf('─────────────────────────────────────────────────────────────────────────');
    if (dividerIdx === -1) return src;
    const afterDivider = src.indexOf('\n', dividerIdx);
    const closeComment = src.indexOf('*/', afterDivider);
    return closeComment === -1 ? src : src.slice(closeComment + 2).replace(/^\s+/, '');
}

section('1 · synced motion files match client/src/motion/ (drift detection)');
{
    for (const f of ['Easing.js', 'MotionSchema.js', 'MotionResolver.js', 'MotionPresets.js', 'CaptionModel.js']) {
        const original = read(`client/src/motion/${f}`);
        const copy = stripSyncHeader(read(`render-worker/revideo/src/motion/${f}`));
        check(`${f}: worker copy body matches the original verbatim`, original.trim() === copy.trim(),
            original.length !== copy.length ? `length differs: original ${original.length} vs copy ${copy.length}` : 'content differs');
    }
}

function loadESM(rel, extraExports) {
    let src = read(rel);
    src = src
        .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+'([^']+)';\s*$/gm, (m, names, from) => {
            // Resolve sibling imports to already-loaded module vars — handled below per-file instead.
            return `// ${m.trim()}`;
        })
        .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
        .replace(/\bexport\s+(const|function|class|let)\b/g, '$1');
    src += `\nreturn { ${extraExports} };`;
    // eslint-disable-next-line no-new-func
    return new Function(src)();
}

section('2 · RevideoLayerAdapter.js — resolution priority (CJS-strip-eval, resolved inline since it composes 3 sibling modules)');
{
    // The adapter imports from MotionSchema.js and MotionPresets.js — rather
    // than resolve a real multi-module ESM graph in a strip-eval harness,
    // load all three bodies concatenated (they're additive, not colliding
    // names) exactly as the real Vite bundle would resolve them.
    const easing = read('render-worker/revideo/src/motion/Easing.js');
    const schema = read('render-worker/revideo/src/motion/MotionSchema.js');
    const presets = read('render-worker/revideo/src/motion/MotionPresets.js');
    const adapter = read('render-worker/revideo/src/motion/RevideoLayerAdapter.js');

    let combined = [easing, schema, presets, adapter]
        .map(s => s
            .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
            .replace(/^\s*export\s+default\s+\{[\s\S]*?\};\s*$/gm, '')
            .replace(/\bexport\s+(const|function|class|let)\b/g, '$1')
        )
        .join('\n');
    combined += '\nreturn { clipToLayer, inferKind, buildPreset, MOTION_PRESETS };';
    // eslint-disable-next-line no-new-func
    const mod = new Function(combined)();

    const layerWithAnimations = mod.clipToLayer({ id: 'c1', type: 'text', start: 2, duration: 3, animations: [{ id: 'a', type: 'fade', duration: 1, keyframes: [{ time: 0, properties: { opacity: 0 } }] }] }, { type: 'text' });
    check('priority 1: clip.animations wins when present', layerWithAnimations.animations.length === 1 && layerWithAnimations.animations[0].type === 'fade');

    const layerLegacy = mod.clipToLayer({ id: 'c2', type: 'text', start: 0, duration: 2, animation: 'pop' }, { type: 'text' });
    check('priority 2: legacy clip.animation string maps through LEGACY_ANIMATION_MAP → a real preset', layerLegacy.animations.length > 0 && layerLegacy.animations[0].presetId === 'pop');

    const layerPack = mod.clipToLayer({ id: 'c3', type: 'text', start: 0, duration: 2, captionStyle: { animationPreset: 'slide-up' } }, { type: 'text' });
    check('priority 3: captionStyle.animationPreset used when nothing else is set', layerPack.animations.length > 0 && layerPack.animations[0].presetId === 'slide-up');

    const layerNone = mod.clipToLayer({ id: 'c4', type: 'text', start: 0, duration: 2 }, { type: 'text' });
    check('no animation source → empty array, not a throw', Array.isArray(layerNone.animations) && layerNone.animations.length === 0);

    check('inferKind: caption when words present', mod.inferKind({ type: 'text', words: [{ text: 'hi', start: 0, end: 1 }] }, 'text') === 'caption');
    check('inferKind: plain text otherwise', mod.inferKind({ type: 'text' }, 'text') === 'text');
    check('inferKind: overlay clip with no own type defaults to image', mod.inferKind({}, 'overlay') === 'image');

    check('null clip does not throw', mod.clipToLayer(null, {}) === null);
}

section('3 · new scene (render-worker/revideo/src/scenes/timeline.tsx) — structure');
{
    const scene = read('render-worker/revideo/src/scenes/timeline.tsx');
    check('imports the ported RevideoLayerAdapter', /from '\.\.\/motion\/RevideoLayerAdapter\.js'/.test(scene));
    check('imports resolveMotionAt from the ported MotionResolver', /resolveMotionAt.*from '\.\.\/motion\/MotionResolver\.js'/.test(scene));
    check('imports revealedWordCount from the ported CaptionModel', /revealedWordCount.*from '\.\.\/motion\/CaptionModel\.js'/.test(scene));
    check('reads baseVideoUrl as a scene variable', /baseVideoUrl.*=.*useVar.*baseVideoUrl/.test(scene) || /vars\.get\('baseVideoUrl'/.test(scene) || /'baseVideoUrl'/.test(scene));
    check('base video is a SINGLE full-canvas Video node (no per-clip video loop)', /<Video\b/.test(scene) && (scene.match(/<Video\b/g) || []).length === 1);
    check('renders text tracks', /track\.type === 'text'/.test(scene));
    check('renders overlay tracks, image-sourced only', /track\.type === 'overlay'/.test(scene));
    check('does NOT handle video/audio/image base tracks (moved to FFmpeg)', !/track\.type === 'video'/.test(scene) && !/track\.type === 'audio'/.test(scene));
    // Checks for the actual crop-simulation ARTIFACTS the old render-lambda
    // scene used (clip.virtualCam, vcZoom/cropW/cropX vars) — not just the
    // word "zoom", which legitimately appears in this file's own docblock
    // explaining why camera motion was deliberately left out.
    check('does NOT apply camera-motion/virtualCam crop simulation (stays in FFmpeg per the confirmed split)',
        !/clip\.virtualCam/.test(scene) && !/vcZoom|cropW|cropX/.test(scene));
    check('removes each clip node after its duration (no permanent on-screen leak)', /nodeRef\(\)\.remove\(\)/.test(scene));
    check('converts percent-of-frame-centre to pixel-from-canvas-centre', /toPxX/.test(scene) && /toPxY/.test(scene));
    check('word-timed reveal uses revealedWordCount, not a flat reveal fraction', /revealedWordCount\(/.test(scene));
}

section('3b · render-worker caption fonts — @font-face registration for headless Chrome');
{
    // The worker's Chrome instance is a fully isolated build (its own Docker
    // context, see Dockerfile's `COPY . .` from render-worker/ only) with no
    // access to client/src/index.css's @font-face rules or client/public/
    // fonts/. Without its own registration, every caption font silently
    // rendered as Chrome's default sans-serif — see fonts.css's header for
    // the full story. This section pins that the fix stays wired up AND
    // stays in sync with the two other places a font must be registered
    // (jobs/exportProcessor.js's FONT_SPECS, client/src/index.css) — adding
    // a font to one and not the others is exactly the kind of drift that
    // silently reintroduces this bug for just that one family.
    const scene = read('render-worker/revideo/src/scenes/timeline.tsx');
    check('scene still assigns the raw fontFamily to Txt (the fix is registering it, not routing around it)',
        /fontFamily=\{clip\.fontFamily \|\| 'Inter'\}/.test(scene));

    const project = read('render-worker/revideo/src/project.ts');
    check('project.ts imports fonts.css as a side effect, so every scene render has it bundled',
        /import '\.\/fonts\.css';/.test(project));

    const fontsCss = read('render-worker/revideo/src/fonts.css');
    const cssFamilies = [...fontsCss.matchAll(/^@font-face \{ font-family: '([^']+)';.*src: url\('\.\/fonts\/([^']+)'\)/gm)]
        .map(m => ({ family: m[1], file: m[2] }));
    check('fonts.css declares at least one @font-face rule (parse sanity)', cssFamilies.length > 0);
    check('every fonts.css @font-face uses font-display: block, not swap',
        (fontsCss.match(/@font-face/g) || []).length ===
        (fontsCss.match(/font-display: block/g) || []).length,
        'a headless frame-capture must never paint the fallback-font frame — see fonts.css header on why `swap` (fine for a live browser) is wrong here');

    const exportProc = read('jobs/exportProcessor.js');
    const specMatches = [...exportProc.matchAll(/'([^']+)':\s*\{\s*file:\s*'([^']+)'/g)]
        .map(m => ({ family: m[1], file: m[2] }));
    check('jobs/exportProcessor.js FONT_SPECS was actually parsed (regression guard for this check itself)',
        specMatches.length >= 30);

    const cssFamilySet = new Set(cssFamilies.map(f => f.family));
    const missingFromWorkerCss = specMatches.filter(s => !cssFamilySet.has(s.family));
    check('every FONT_SPECS family has a matching @font-face in the worker\'s fonts.css',
        missingFromWorkerCss.length === 0,
        `missing: ${missingFromWorkerCss.map(f => f.family).join(', ')}`);

    const cssFileSet = new Set(cssFamilies.map(f => f.file));
    const missingFromWorkerCssFiles = specMatches.filter(s => !cssFileSet.has(s.file));
    check('every FONT_SPECS file is referenced by the worker\'s fonts.css (same filenames as client/public/fonts/)',
        missingFromWorkerCssFiles.length === 0,
        `missing: ${missingFromWorkerCssFiles.map(f => f.file).join(', ')}`);

    let workerFontFiles = [];
    try { workerFontFiles = fs.readdirSync(path.join(ROOT, 'render-worker/revideo/src/fonts')); } catch { /* reported below */ }
    check('render-worker/revideo/src/fonts/ directory exists with .ttf files in it', workerFontFiles.length > 0);
    const workerFileSet = new Set(workerFontFiles);
    const missingActualFiles = specMatches.filter(s => !workerFileSet.has(s.file));
    check('every FONT_SPECS .ttf file actually exists in render-worker/revideo/src/fonts/ (not just referenced in CSS)',
        missingActualFiles.length === 0,
        `missing: ${missingActualFiles.map(f => f.file).join(', ')}`);

    const clientCss = read('client/src/index.css');
    const clientFamilySet = new Set(
        [...clientCss.matchAll(/^@font-face \{ font-family: '([^']+)';.*src: url\('\/fonts\/([^']+)'\)/gm)]
            .map(m => m[1])
    );
    const missingFromClient = specMatches.filter(s => !clientFamilySet.has(s.family));
    check('every FONT_SPECS family also has a browser @font-face in client/src/index.css (three-way sync, not just worker+export)',
        missingFromClient.length === 0,
        `missing: ${missingFromClient.map(f => f.family).join(', ')}`);
}

section('4 · render-worker/server.js — updated contract');
{
    const server = read('render-worker/server.js');
    check('requires baseVideoUrl, rejects a request without one', /baseVideoUrl/.test(server) && /400/.test(server));
    check('still requires WORKER_SECRET-gated auth on non-health routes', /WORKER_SECRET/.test(server) && /\/health/.test(server));
    check('passes baseVideoUrl through to renderVideo variables', /variables:\s*\{\s*baseVideoUrl/.test(server));

    // R69 FOLLOW-UP — a real end-to-end render (in a throwaway sandboxed test
    // rig, not just node --check) surfaced that `renderVideo()`'s actual
    // settings shape is `settings.puppeteer` (a real PuppeteerLaunchOptions
    // object), NOT the top-level `puppeteerLaunchArgs` array this file used
    // to pass — confirmed by reading @revideo/renderer's own render-video.d.ts
    // and by that array being silently ignored in a live run. Also found: the
    // bundled static ffprobe binary (@ffprobe-installer) segfaults on a
    // network-URL input — settings.ffmpeg pins it to the system binaries the
    // Dockerfile installs instead.
    check('uses the REAL settings.puppeteer shape, not the old (silently ignored) puppeteerLaunchArgs key', /puppeteer:\s*\{[\s\S]*?executablePath/.test(server) && !/^\s*puppeteerLaunchArgs\s*:/m.test(server));
    check('pins ffmpeg/ffprobe to the system binaries installed in the Dockerfile', /ffmpeg:\s*\{[\s\S]*?ffmpegPath:\s*'\/usr\/bin\/ffmpeg'[\s\S]*?ffprobePath:\s*'\/usr\/bin\/ffprobe'/.test(server));
}

section('4b · render-worker/Dockerfile — real codec support');
{
    const dockerfile = read('render-worker/Dockerfile');
    // R69 FOLLOW-UP — the single most important finding of this pass: Debian's
    // `chromium` apt package has NO H.264 support (no decode, no encode —
    // confirmed directly: canPlayType() returns "", and Revideo's own output
    // encoder, hardcoded to codec "avc1.4d0034" with no override in v0.10.4,
    // throws "Cannot call 'encode' on a closed codec"). This is a hard block
    // on EVERY render, independent of baseVideoUrl's format. Fix: install
    // real Google Chrome (proprietary codec license), not open-source
    // Chromium.
    check('installs google-chrome-stable (real H.264 support), not the codec-stripped Debian chromium package', /google-chrome-stable/.test(dockerfile) && !/\bchromium\b/.test(dockerfile.replace(/#.*$/gm, '')));
    check('installs system ffmpeg (for settings.ffmpeg to point at)', /\bffmpeg\b/.test(dockerfile.replace(/#.*$/gm, '')));
    check('PUPPETEER_EXECUTABLE_PATH points at the installed Chrome binary', /PUPPETEER_EXECUTABLE_PATH=\/usr\/bin\/google-chrome-stable/.test(dockerfile));
}

section('5 · jobs/exportProcessor.js — opt-in wiring, mutual exclusion, fails open');
{
    const exp = read('jobs/exportProcessor.js');
    check('defines renderViaRevideoWorker', /async function renderViaRevideoWorker/.test(exp));
    check('defines resolvePublicBackendUrl (reused, not re-derived)', /function resolvePublicBackendUrl/.test(exp));
    check('useRevideo is opt-in via REVIDEO_RENDER_ENABLED', /REVIDEO_RENDER_ENABLED.*===\s*'1'/.test(exp));
    check('useRevideo requires RENDER_WORKER_URL to be configured', /!!process\.env\.RENDER_WORKER_URL/.test(exp));
    check('useRevideo requires an actual text or overlay track (no-op otherwise)', /revideoTextTracks\.length > 0 \|\| revideoOverlayTracks\.length > 0/.test(exp));

    check('STEP 2.5 (compositor) is skipped when useRevideo — no double-compositing', /rawPlan && process\.env\.COMPOSITOR_DISABLED !== '1' && !useRevideo/.test(exp));
    check('STEP 4 (drawtext captions) is skipped when useRevideo — no double captions', /textTracks\.length > 0 && !useRevideo/.test(exp));

    check('Revideo call is wrapped in try/catch (fails open)', /catch \(revideoErr\)/.test(exp));
    check('failure sets revideoWarning rather than throwing the whole export', /revideoWarning = revideoErr\.message/.test(exp));
    check('success sets revideoSucceeded = true', /revideoSucceeded = true/.test(exp));
    check('revideoWarning is surfaced in the job result', /revideoWarning:\s*revideoWarning \|\| undefined/.test(exp));

    check('uploads (or locally serves) the base video for the worker to fetch — GCS branch', /gcsBucket\.upload\(finalVideoPath/.test(exp));
    check('uploads (or locally serves) the base video for the worker to fetch — local fallback branch', /fs\.copyFileSync\(finalVideoPath/.test(exp));
    check('best-effort cleanup of the temp GCS base-video copy', /Could not clean up temp GCS base video/.test(exp));
}

section('6 · .env.example documents the new configuration');
{
    const env = read('.env.example');
    check('documents REVIDEO_RENDER_ENABLED', /REVIDEO_RENDER_ENABLED=/.test(env));
    check('documents RENDER_WORKER_URL', /RENDER_WORKER_URL=/.test(env));
    check('documents WORKER_SECRET', /WORKER_SECRET=/.test(env));
}

console.log(`\n${'─'.repeat(60)}\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
