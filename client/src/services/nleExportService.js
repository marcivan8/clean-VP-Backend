/**
 * nleExportService.js — Viral Pilot
 *
 * Generates NLE-compatible project files from the timeline state.
 * All generation is client-side (no backend round-trip).
 *
 * Supported formats:
 *  - EDL (CMX 3600) — Premiere Pro, Avid, DaVinci Resolve
 *  - FCPXML 1.11    — Final Cut Pro X
 *  - CapCut JSON    — CapCut desktop / mobile project
 *  - DaVinci CSV    — DaVinci Resolve timeline CSV import
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert seconds to SMPTE timecode string "HH:MM:SS:FF"
 */
function toSMPTE(seconds, fps = 30) {
    const totalFrames = Math.round(seconds * fps);
    const frames  = totalFrames % fps;
    const secs    = Math.floor(totalFrames / fps) % 60;
    const mins    = Math.floor(totalFrames / fps / 60) % 60;
    const hours   = Math.floor(totalFrames / fps / 3600);
    return [hours, mins, secs, frames].map(n => String(n).padStart(2, '0')).join(':');
}

/**
 * Convert seconds to FCP rational time string "NNNNNs/NNNNNs"
 */
function toFCPTime(seconds, timebase = 30000, subBase = 1001) {
    // Use simple integer approach: frames at timebase
    const frames = Math.round(seconds * (timebase / subBase));
    return `${frames}/${timebase / subBase * 1}s`;
}

/**
 * Sanitize XML attribute values
 */
function xmlEscape(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Download a text blob in the browser
 */
export function downloadBlob(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. EDL — CMX 3600 (Premiere Pro, DaVinci, Avid)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a CMX 3600 EDL string.
 * @param {Array}  tracks    - Legacy tracks array from useTimelineStore
 * @param {number} fps       - Frame rate (default 30)
 * @param {string} title     - Project title
 * @returns {string}
 */
export function generateEDL(tracks, fps = 30, title = 'Viral Pilot Export') {
    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack || !videoTrack.clips.length) {
        throw new Error('No video clips found in timeline.');
    }

    const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);

    const lines = [
        `TITLE: ${title}`,
        `FCM: NON-DROP FRAME`,
        '',
    ];

    clips.forEach((clip, i) => {
        const eventNum    = String(i + 1).padStart(3, '0');
        const reel        = (clip.name || `REEL_${i + 1}`).replace(/[^A-Za-z0-9_]/g, '_').slice(0, 8).toUpperCase();
        const srcStart    = clip.offset || 0;
        const srcEnd      = srcStart + clip.duration;
        const recStart    = clip.start;
        const recEnd      = clip.start + clip.duration;

        lines.push(`${eventNum}  ${reel.padEnd(8)} V     C        ${toSMPTE(srcStart, fps)} ${toSMPTE(srcEnd, fps)} ${toSMPTE(recStart, fps)} ${toSMPTE(recEnd, fps)}`);
        if (clip.name) {
            lines.push(`* FROM CLIP NAME: ${clip.name}`);
        }
        lines.push('');
    });

    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FCPXML 1.11 — Final Cut Pro X
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an FCPXML 1.11 document string.
 * @param {Array}  tracks
 * @param {number} fps
 * @param {string} aspectRatio  e.g. '16:9' | '9:16' | '1:1'
 * @param {string} title
 * @returns {string}
 */
export function generateFCPXML(tracks, fps = 30, aspectRatio = '16:9', title = 'Viral Pilot Export') {
    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack || !videoTrack.clips.length) {
        throw new Error('No video clips found in timeline.');
    }

    const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);

    // Aspect ratio → width/height
    const [w, h] = (aspectRatio || '16:9').split(':').map(Number);
    const width  = w === 9 ? 1080 : 1920;
    const height = h === 16 ? 1920 : (h === 9 ? 1080 : 1080);

    // FCP uses rational timebase: 30000/1001 for 29.97, 30/1 for 30
    const timebase  = fps === 29.97 ? '30000/1001s' : `${fps}/1s`;
    const frameDur  = fps === 29.97 ? '1001/30000s' : `1/${fps}s`;

    // Build asset + clip refs
    const assets   = [];
    const clipsXML = [];

    clips.forEach((clip, i) => {
        const assetId  = `r${i + 1}`;
        const name     = xmlEscape(clip.name || `Clip ${i + 1}`);
        const srcUrl   = clip.src ? xmlEscape(clip.src) : '';
        const duration = clip.duration || 1;
        const offset   = clip.offset  || 0;
        const start    = clip.start   || 0;

        // FCP rational times (simple integer/1s approach)
        const durStr    = `${Math.round(duration * fps)}/${fps}s`;
        const startStr  = `${Math.round(start * fps)}/${fps}s`;
        const offsetStr = `${Math.round(offset * fps)}/${fps}s`;

        assets.push(`    <asset id="${assetId}" name="${name}" uid="${assetId}" start="${offsetStr}" duration="${durStr}" hasVideo="1" hasAudio="1">
      <media-rep kind="original-media" sig="${assetId}" src="${srcUrl}" />
    </asset>`);

        clipsXML.push(`        <clip name="${name}" ref="${assetId}" offset="${startStr}" duration="${durStr}" start="${offsetStr}" tcFormat="NDF">`);
        clipsXML.push(`        </clip>`);
    });

    const totalDuration = Math.max(...clips.map(c => c.start + c.duration), 0);
    const totalDurStr   = `${Math.round(totalDuration * fps)}/${fps}s`;

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">
  <resources>
    <format id="r0" name="FFVideoFormat${height}p${fps}" frameDuration="${frameDur}" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>
${assets.join('\n')}
  </resources>
  <library>
    <event name="${xmlEscape(title)}">
      <project name="${xmlEscape(title)}">
        <sequence format="r0" duration="${totalDurStr}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${clipsXML.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DaVinci Resolve — Timeline CSV
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a DaVinci Resolve-compatible CSV timeline.
 * @param {Array}  tracks
 * @param {number} fps
 * @returns {string}
 */
export function generateDaVinciCSV(tracks, fps = 30) {
    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack || !videoTrack.clips.length) {
        throw new Error('No video clips found in timeline.');
    }

    const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);

    const rows = [
        ['#', 'Name', 'Source In', 'Source Out', 'Record In', 'Record Out', 'Duration', 'FPS'],
    ];

    clips.forEach((clip, i) => {
        const srcIn  = toSMPTE(clip.offset || 0, fps);
        const srcOut = toSMPTE((clip.offset || 0) + clip.duration, fps);
        const recIn  = toSMPTE(clip.start, fps);
        const recOut = toSMPTE(clip.start + clip.duration, fps);
        rows.push([
            i + 1,
            clip.name || `Clip ${i + 1}`,
            srcIn,
            srcOut,
            recIn,
            recOut,
            clip.duration.toFixed(3),
            fps,
        ]);
    });

    return rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. CapCut — JSON Project File
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a CapCut-compatible JSON project.
 * Based on CapCut desktop project format (v2).
 * @param {Array}  tracks
 * @param {string} aspectRatio
 * @param {string} title
 * @returns {string} JSON string
 */
export function generateCapCutJSON(tracks, aspectRatio = '9:16', title = 'Viral Pilot Export') {
    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack || !videoTrack.clips.length) {
        throw new Error('No video clips found in timeline.');
    }

    const clips = [...videoTrack.clips].sort((a, b) => a.start - b.start);
    const [w, h] = (aspectRatio || '9:16').split(':').map(Number);
    const ratio   = aspectRatio === '9:16' ? '540:960' : aspectRatio === '1:1' ? '1080:1080' : '1920:1080';

    const MICROSEC = 1_000_000; // CapCut uses microseconds

    const segments = clips.map((clip, i) => ({
        id: `segment_${i}`,
        material_id: `material_${i}`,
        target_timerange: {
            start: Math.round(clip.start * MICROSEC),
            duration: Math.round(clip.duration * MICROSEC),
        },
        source_timerange: {
            start: Math.round((clip.offset || 0) * MICROSEC),
            duration: Math.round(clip.duration * MICROSEC),
        },
        speed: clip.speed || 1.0,
        volume: clip.volume !== undefined ? clip.volume : 1.0,
        clip: {
            alpha: 1.0,
            flip: { horizontal: false, vertical: false },
            rotation: 0,
            scale: { x: 1.0, y: 1.0 },
            translation: { x: 0.0, y: 0.0 },
        },
    }));

    const materials = clips.map((clip, i) => ({
        id: `material_${i}`,
        type: 'video',
        path: clip.src || '',
        name: clip.name || `Clip ${i + 1}`,
        duration: Math.round(clip.duration * MICROSEC),
        width: w === 9 ? 1080 : 1920,
        height: h === 16 ? 1920 : 1080,
    }));

    const project = {
        version: '3.0.0',
        id: `viral_pilot_${Date.now()}`,
        name: title,
        canvas_config: {
            ratio,
            width: w === 9 ? 1080 : 1920,
            height: h === 16 ? 1920 : 1080,
            fps: 30,
        },
        duration: Math.round(Math.max(...clips.map(c => c.start + c.duration), 0) * MICROSEC),
        tracks: [
            {
                id: 'video_track_0',
                type: 'video',
                segments,
            }
        ],
        materials: {
            videos: materials,
        },
        fps: 30,
    };

    return JSON.stringify(project, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified export entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Export timeline to the requested NLE format and trigger browser download.
 *
 * @param {'edl'|'fcpxml'|'davinci'|'capcut'} format
 * @param {Array}  tracks       - from useTimelineStore.getState().tracks
 * @param {object} opts         - { fps, aspectRatio, title }
 */
export function exportToNLE(format, tracks, opts = {}) {
    const fps         = opts.fps         || 30;
    const aspectRatio = opts.aspectRatio || '16:9';
    const title       = opts.title       || 'Viral Pilot Export';

    switch (format) {
        case 'edl': {
            const content = generateEDL(tracks, fps, title);
            downloadBlob(content, `${title}.edl`, 'text/plain');
            break;
        }
        case 'fcpxml': {
            const content = generateFCPXML(tracks, fps, aspectRatio, title);
            downloadBlob(content, `${title}.fcpxml`, 'application/xml');
            break;
        }
        case 'davinci': {
            const content = generateDaVinciCSV(tracks, fps);
            downloadBlob(content, `${title}_davinci.csv`, 'text/csv');
            break;
        }
        case 'capcut': {
            const content = generateCapCutJSON(tracks, aspectRatio, title);
            downloadBlob(content, `${title}_capcut.json`, 'application/json');
            break;
        }
        default:
            throw new Error(`Unknown NLE format: ${format}`);
    }
}
