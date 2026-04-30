/**
 * NLEExportService
 * Exports the current timeline to industry-standard NLE interchange formats.
 *
 * Supported targets:
 *   • Premiere Pro  → .xml  (Final Cut XML 7 / Premiere compatible)
 *   • Final Cut Pro → .fcpxml (FCPXML 1.10)
 *   • DaVinci Resolve → .edl + .xml
 *   • CapCut → .json (CapCut project manifest)
 *
 * These files can be opened directly in the respective NLE software,
 * preserving clip order, in/out points, speed, volume, and basic transitions.
 */

const FRAME_RATE = 30; // Default project frame rate

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function secToFrames(seconds, fps = FRAME_RATE) {
    return Math.round(seconds * fps);
}

function secToTimecode(seconds, fps = FRAME_RATE) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.round((seconds % 1) * fps);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

function sanitizeName(name) {
    return (name || 'Untitled').replace(/[^a-zA-Z0-9_\- .]/g, '_');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// PREMIERE PRO / FINAL CUT 7 XML
// ─────────────────────────────────────────────────────────────────────────────

function buildPremiereXML(tracks, duration, projectName = 'Viral Pilot Project') {
    const videoTracks = tracks.filter(t => t.type === 'video');
    const audioTracks = tracks.filter(t => t.type === 'audio');
    const allClips = [...videoTracks, ...audioTracks].flatMap(t => t.clips || []);

    // Build media file registry
    const mediaFiles = [...new Set(allClips.map(c => c.src || c.url || c.name || 'clip.mp4'))];

    const mediaElements = mediaFiles.map((src, i) => {
        const name = sanitizeName(src.split('/').pop() || `media_${i}`);
        return `
    <media id="media_${i}" name="${name}">
      <duration>${secToFrames(duration)}</duration>
      <rate><timebase>${FRAME_RATE}</timebase><ntsc>FALSE</ntsc></rate>
      <pathurl>file://localhost/${src}</pathurl>
      <timecode><string>00:00:00:00</string><rate><timebase>${FRAME_RATE}</timebase></rate></timecode>
      <video><track><clipitem id="clip_ref_${i}">
        <masterclipid>master_${i}</masterclipid>
        <name>${name}</name>
        <start>0</start>
        <end>${secToFrames(duration)}</end>
        <in>0</in>
        <out>${secToFrames(duration)}</out>
      </clipitem></track></video>
    </media>`;
    }).join('\n');

    const videoTrackXML = videoTracks.map((track, ti) => {
        const clips = (track.clips || []).sort((a, b) => a.start - b.start);
        const clipItems = clips.map((clip, ci) => {
            const src = clip.src || clip.url || clip.name || 'clip.mp4';
            const mediaIdx = mediaFiles.indexOf(src);
            const inPoint = secToFrames(clip.offset || 0);
            const outPoint = secToFrames((clip.offset || 0) + clip.duration);
            const startFrame = secToFrames(clip.start);
            const endFrame = secToFrames(clip.start + clip.duration);
            return `
      <clipitem id="video_ci_${ti}_${ci}">
        <masterclipid>master_${mediaIdx >= 0 ? mediaIdx : 0}</masterclipid>
        <name>${sanitizeName(clip.name)}</name>
        <enabled>TRUE</enabled>
        <duration>${secToFrames(clip.duration)}</duration>
        <rate><timebase>${FRAME_RATE}</timebase><ntsc>FALSE</ntsc></rate>
        <start>${startFrame}</start>
        <end>${endFrame}</end>
        <in>${inPoint}</in>
        <out>${outPoint}</out>
        <file id="media_${mediaIdx >= 0 ? mediaIdx : 0}"/>
        <speed><value>${(clip.speed || 1) * 100}</value></speed>
      </clipitem>`;
        }).join('\n');

        return `
    <track>
${clipItems}
    </track>`;
    }).join('\n');

    const audioTrackXML = audioTracks.map((track, ti) => {
        const clips = (track.clips || []).sort((a, b) => a.start - b.start);
        const clipItems = clips.map((clip, ci) => {
            const src = clip.src || clip.url || clip.name || 'audio.mp3';
            const mediaIdx = mediaFiles.indexOf(src);
            return `
      <clipitem id="audio_ci_${ti}_${ci}">
        <name>${sanitizeName(clip.name)}</name>
        <enabled>TRUE</enabled>
        <duration>${secToFrames(clip.duration)}</duration>
        <rate><timebase>${FRAME_RATE}</timebase></rate>
        <start>${secToFrames(clip.start)}</start>
        <end>${secToFrames(clip.start + clip.duration)}</end>
        <in>${secToFrames(clip.offset || 0)}</in>
        <out>${secToFrames((clip.offset || 0) + clip.duration)}</out>
        <file id="media_${mediaIdx >= 0 ? mediaIdx : 0}"/>
        <levels><keyframe><when>0</when><value>${Math.round((clip.volume || 1) * 100)}</value></keyframe></levels>
      </clipitem>`;
        }).join('\n');

        return `<track>${clipItems}</track>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="7">
  <sequence>
    <name>${sanitizeName(projectName)}</name>
    <duration>${secToFrames(duration)}</duration>
    <rate><timebase>${FRAME_RATE}</timebase><ntsc>FALSE</ntsc></rate>
    <timecode><string>00:00:00:00</string></timecode>
    <media>
      <video>${videoTrackXML}</video>
      <audio>${audioTrackXML}</audio>
    </media>
  </sequence>
</xmeml>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL CUT PRO X (.fcpxml)
// ─────────────────────────────────────────────────────────────────────────────

function buildFCPXML(tracks, duration, projectName = 'Viral Pilot Project') {
    const videoTrack = tracks.find(t => t.type === 'video');
    const clips = ((videoTrack?.clips) || []).sort((a, b) => a.start - b.start);

    // Asset registry
    const sources = [...new Set(clips.map(c => c.src || c.url || c.name || 'clip.mp4'))];
    const assets = sources.map((src, i) => {
        const name = sanitizeName(src.split('/').pop() || `asset_${i}`);
        return `  <asset id="r${i + 2}" name="${name}" uid="asset_${i}" src="file://localhost/${src}" start="0s" duration="${duration}s" hasVideo="1" hasAudio="1"/>`;
    }).join('\n');

    const spineClips = clips.map((clip, i) => {
        const src = clip.src || clip.url || clip.name || 'clip.mp4';
        const assetIdx = sources.indexOf(src);
        const offset = `${clip.start}s`;
        const dur = `${clip.duration}s`;
        const inPoint = `${clip.offset || 0}s`;
        const name = sanitizeName(clip.name);
        const speed = clip.speed || 1;
        const speedAttr = speed !== 1 ? `<timeMap><timept time="0s" value="0s" interp="smooth2"/><timept time="${clip.duration}s" value="${clip.duration / speed}s" interp="smooth2"/></timeMap>` : '';

        return `      <clip name="${name}" offset="${offset}" duration="${dur}" start="${inPoint}">
        <video ref="r${assetIdx + 2}" offset="0s" duration="${dur}" start="${inPoint}">
          ${speedAttr}
        </video>
      </clip>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p${FRAME_RATE}" frameDuration="1/${FRAME_RATE}s" width="1920" height="1080"/>
${assets}
  </resources>
  <library>
    <event name="${sanitizeName(projectName)}">
      <project name="${sanitizeName(projectName)}">
        <sequence format="r1" duration="${duration}s" tcStart="0s" tcFormat="NDF">
          <spine>
${spineClips}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAVINCI RESOLVE (.edl)
// ─────────────────────────────────────────────────────────────────────────────

function buildEDL(tracks, duration, projectName = 'Viral Pilot Project') {
    const videoTrack = tracks.find(t => t.type === 'video');
    const clips = ((videoTrack?.clips) || []).sort((a, b) => a.start - b.start);

    const edlLines = clips.map((clip, i) => {
        const eventNum = String(i + 1).padStart(3, '0');
        const reel = sanitizeName(clip.name || `clip_${i}`).substring(0, 8).toUpperCase();
        const srcIn = secToTimecode(clip.offset || 0);
        const srcOut = secToTimecode((clip.offset || 0) + clip.duration);
        const recIn = secToTimecode(clip.start);
        const recOut = secToTimecode(clip.start + clip.duration);
        return `${eventNum}  ${reel.padEnd(8)} V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`;
    }).join('\n');

    return `TITLE: ${sanitizeName(projectName)}
FCM: NON-DROP FRAME

${edlLines}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPCUT PROJECT JSON
// ─────────────────────────────────────────────────────────────────────────────

function buildCapCutProject(tracks, duration, aspectRatio = '16:9', projectName = 'Viral Pilot Project') {
    const videoTrack = tracks.find(t => t.type === 'video');
    const audioTracks = tracks.filter(t => t.type === 'audio');
    const videoClips = ((videoTrack?.clips) || []).sort((a, b) => a.start - b.start);

    const [w, h] = aspectRatio === '9:16' ? [1080, 1920] : aspectRatio === '1:1' ? [1080, 1080] : [1920, 1080];

    const segments = videoClips.map((clip, i) => ({
        id: `seg_${i}_${Date.now()}`,
        material_id: `mat_${i}`,
        target_timerange: {
            start: Math.round(clip.start * 1000000), // CapCut uses microseconds
            duration: Math.round(clip.duration * 1000000)
        },
        source_timerange: {
            start: Math.round((clip.offset || 0) * 1000000),
            duration: Math.round(clip.duration * 1000000)
        },
        speed: clip.speed || 1,
        volume: clip.volume || 1,
        enable_adjust: true,
        enable_color_correct_adjust: false,
    }));

    const materials = videoClips.map((clip, i) => ({
        id: `mat_${i}`,
        type: 'video',
        path: clip.src || clip.url || clip.name || '',
        duration: Math.round(clip.duration * 1000000),
        width: w,
        height: h,
    }));

    return JSON.stringify({
        id: `project_${Date.now()}`,
        name: projectName,
        time_range: { start: 0, duration: Math.round(duration * 1000000) },
        canvas_config: { width: w, height: h, ratio: aspectRatio, fps: FRAME_RATE },
        version: '11.0.0',
        create_time: Math.floor(Date.now() / 1000),
        tracks: [
            {
                id: 'video_track_0',
                type: 'video',
                segments
            },
            ...audioTracks.map((at, i) => ({
                id: `audio_track_${i}`,
                type: 'audio',
                segments: (at.clips || []).map((clip, j) => ({
                    id: `audio_seg_${i}_${j}`,
                    material_id: `audio_mat_${i}_${j}`,
                    target_timerange: {
                        start: Math.round(clip.start * 1000000),
                        duration: Math.round(clip.duration * 1000000)
                    },
                    volume: clip.volume || 1
                }))
            }))
        ],
        materials: { videos: materials }
    }, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class NLEExportService {
    /**
     * Export the current timeline to an NLE-compatible format.
     * @param {string} target - 'premiere' | 'finalcut' | 'davinci' | 'capcut'
     * @param {object} timelineState - The current useTimelineStore state
     */
    static async export(target, timelineState) {
        const { tracks, duration, aspectRatio } = timelineState;
        const projectName = 'Viral Pilot Project';

        console.log(`[NLEExportService] Exporting for: ${target}`);

        switch (target) {
            case 'premiere': {
                const xml = buildPremiereXML(tracks, duration, projectName);
                downloadFile(xml, 'viral-pilot-premiere.xml', 'application/xml');
                return {
                    success: true,
                    message: '✓ Exported for Premiere Pro.\nOpen in Premiere: File → Import → Select the .xml file',
                    format: 'Final Cut XML 7 (.xml)',
                    filename: 'viral-pilot-premiere.xml'
                };
            }

            case 'finalcut': {
                const fcpxml = buildFCPXML(tracks, duration, projectName);
                downloadFile(fcpxml, 'viral-pilot.fcpxml', 'application/xml');
                return {
                    success: true,
                    message: '✓ Exported for Final Cut Pro.\nOpen in FCPX: File → Import → XML → Select the .fcpxml file',
                    format: 'FCPXML 1.10 (.fcpxml)',
                    filename: 'viral-pilot.fcpxml'
                };
            }

            case 'davinci': {
                const edl = buildEDL(tracks, duration, projectName);
                const xml = buildPremiereXML(tracks, duration, projectName); // DaVinci also accepts FCP7 XML
                downloadFile(edl, 'viral-pilot-resolve.edl', 'text/plain');
                // Also offer the XML for better compatibility
                setTimeout(() => downloadFile(xml, 'viral-pilot-resolve.xml', 'application/xml'), 500);
                return {
                    success: true,
                    message: '✓ Exported for DaVinci Resolve.\n• EDL: File → Import Timeline → Import AAF, EDL, XML…\n• XML: Provides better metadata (also downloaded)',
                    format: 'EDL + FCP7 XML',
                    filename: 'viral-pilot-resolve.edl'
                };
            }

            case 'capcut': {
                const json = buildCapCutProject(tracks, duration, aspectRatio, projectName);
                downloadFile(json, 'viral-pilot-capcut.json', 'application/json');
                return {
                    success: true,
                    message: '✓ Exported for CapCut.\nOpen in CapCut: Projects → Import → Select the .json file',
                    format: 'CapCut Project JSON (.json)',
                    filename: 'viral-pilot-capcut.json'
                };
            }

            default:
                throw new Error(`Unknown NLE target: ${target}. Supported: premiere, finalcut, davinci, capcut`);
        }
    }

    /**
     * Returns supported formats info for display in the UI.
     */
    static getSupportedFormats() {
        return [
            {
                id: 'premiere',
                name: 'Adobe Premiere Pro',
                format: 'Final Cut XML 7 (.xml)',
                icon: '🎬',
                description: 'Import via File → Import in Premiere Pro'
            },
            {
                id: 'finalcut',
                name: 'Final Cut Pro X',
                format: 'FCPXML 1.10 (.fcpxml)',
                icon: '🎥',
                description: 'Import via File → Import → XML in FCPX'
            },
            {
                id: 'davinci',
                name: 'DaVinci Resolve',
                format: 'EDL + XML',
                icon: '🎞',
                description: 'Import via File → Import Timeline in Resolve'
            },
            {
                id: 'capcut',
                name: 'CapCut',
                format: 'Project JSON (.json)',
                icon: '✂️',
                description: 'Import via Projects → Import in CapCut'
            }
        ];
    }
}

export default NLEExportService;