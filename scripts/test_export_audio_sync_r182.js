// scripts/test_export_audio_sync_r182.js — R182: the exported sound stays in
// sync with the picture across many cuts, and a clip without audio does not
// silence the export. Runs the REAL exporter (jobs/exportProcessor.js) with
// the bundled ffmpeg on a synthetic source whose picture flashes white and
// whose sound beeps at the same instant every 2 s, then measures every
// flash/beep pair in the exported file.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
process.chdir(ROOT);
const FF = require('ffmpeg-static');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { fail++; console.log('  ✗', m); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vibed-audio-sync-'));
const SRC = path.join(tmp, 'src.mp4');
const SILENT = path.join(tmp, 'silent.mp4');
execFileSync(FF, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', "color=c=black:s=640x360:r=30:d=44,geq=lum='if(lt(mod(N\\,60)\\,1)\\,255\\,16)':cb=128:cr=128",
    '-f', 'lavfi', '-i', "sine=frequency=1000:sample_rate=48000:duration=44,volume='if(lt(mod(t\\,2)\\,0.06)\\,1\\,0)':eval=frame",
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', SRC]);
execFileSync(FF, ['-y', '-loglevel', 'error', '-i', SRC, '-an', '-c:v', 'copy', SILENT]);

/** Every flash with the nearest beep, as audio-minus-picture milliseconds. */
function measure(file) {
    const fps = 30, frame = 16 * 9;
    const v = execFileSync(FF, ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=16:9,format=gray`, '-f', 'rawvideo', '-'], { maxBuffer: 1 << 28 });
    const flashes = [];
    for (let i = 0; i * frame < v.length; i++) {
        let sum = 0; for (let j = 0; j < frame; j++) sum += v[i * frame + j];
        if (sum / frame > 128 && !(flashes.length && i - flashes[flashes.length - 1].f < 5)) flashes.push({ f: i, t: i / fps });
    }
    let beeps = [];
    try {
        const a = execFileSync(FF, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
        let quiet = 0;
        for (let i = 0; i < a.length / 2; i++) {
            if (Math.abs(a.readInt16LE(i * 2)) > 1500) { if (quiet > 4800) beeps.push(i / 48000); quiet = 0; } else quiet++;
        }
    } catch { beeps = []; }
    const offsets = flashes.map(fl => Math.round((beeps.reduce((b, t) => (Math.abs(t - fl.t) < Math.abs(b - fl.t) ? t : b), Infinity) - fl.t) * 1000));
    return { flashes: flashes.length, beeps: beeps.length, offsets };
}

function probe(file) {
    const out = execFileSync(FF, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] }).toString();
    return out;
}
function streams(file) {
    try { execFileSync(FF, ['-i', file], { stdio: ['ignore', 'ignore', 'pipe'] }); return ''; }
    catch (e) { return String(e.stderr || ''); }
}

async function exportCuts(name, n, len, { firstSource = SRC } = {}) {
    const clips = [];
    let t = 0;
    for (let i = 0; i < n; i++) {
        // Each clip starts 0.25 s before a flash/beep of the source.
        clips.push({ id: `c${i}`, type: 'video', name: 'src.mp4', fsPath: i === 0 ? firstSource : SRC, start: t, duration: len, offset: 2 * ((i % 20) + 1) - 0.25, volume: 1 });
        t += len;
    }
    const processExportJob = require('../jobs/exportProcessor.js');
    const res = await processExportJob({
        id: `r182-${name}-${process.pid}`,
        data: { timeline: { tracks: [{ id: 'v1', type: 'video', clips }], duration: t }, settings: { resolution: '720p', aspectRatio: '16:9', quality: 'low' }, userId: 'test-r182' },
        updateProgress: async () => {},
    });
    const url = res?.url || '';
    const file = path.join(ROOT, url.replace(/^\//, ''));
    return { file, timeline: t };
}

(async () => {
    const made = [];
    try {
        console.log('\n§1 many short cuts (silence removal)');
        const a = await exportCuts('cuts', 60, 0.47);
        made.push(a.file);
        const m = measure(a.file);
        const spread = Math.max(...m.offsets) - Math.min(...m.offsets);
        ok(m.flashes === 60 && m.beeps === 60, 'every cut keeps its picture and its sound');
        ok(m.offsets.every(o => Math.abs(o) <= 34), `the sound stays within one frame of the picture at every cut (worst ${Math.max(...m.offsets.map(Math.abs))} ms)`);
        ok(Math.abs(m.offsets.slice(-10).reduce((s, x) => s + x, 0) / 10 - m.offsets.slice(0, 10).reduce((s, x) => s + x, 0) / 10) < 15, `no drift from the first cuts to the last (spread ${spread} ms)`);
        const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(streams(a.file));
        const secs = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
        ok(Math.abs(secs - a.timeline) < 0.05, `the export is as long as the timeline (${secs.toFixed(2)} s for ${a.timeline.toFixed(2)} s)`);

        console.log('\n§2 a first clip without audio');
        const b = await exportCuts('silentfirst', 5, 1.0, { firstSource: SILENT });
        made.push(b.file);
        ok(/Audio: aac/.test(streams(b.file)), 'the export still has a sound track');
        const mb = measure(b.file);
        ok(mb.beeps === 4 && mb.offsets.slice(1).every(o => Math.abs(o) <= 34), 'the other clips keep their sound, in sync');

        console.log('\n§3 wiring');
        const src = fs.readFileSync(path.join(ROOT, 'jobs/exportProcessor.js'), 'utf8');
        ok(/const joined = await joinSegments\(segments, outputPath, \{ tmpDir, audioBitrate, durations/.test(src), 'STEP 2 joins through joinSegments with the timeline lengths');
        ok(!/inputOptions\(\['-f', 'concat', '-safe', '0'\]\)\s*\.videoCodec\('copy'\)\s*\.audioCodec\('copy'\)/.test(src), 'the old stream-copied audio concat is gone');
    } catch (err) {
        fail++; console.log('  ✗ export failed:', err.message);
    } finally {
        for (const f of made) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
        fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log(`\n${'─'.repeat(60)}\nExport audio sync: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
