/**
 * routes/nleExport.js
 *
 * POST /api/export/nle
 * Converts the Viral Pilot timeline state into industry-standard NLE project
 * files using @chatoctopus/timeline (OTIO-first, frame-accurate rational math).
 *
 * Supported targets:
 *   "fcpx"     → FCPXML 1.8  (.fcpxml)  — Final Cut Pro X
 *   "premiere" → xmeml v5   (.xml)     — Adobe Premiere Pro
 *   "resolve"  → xmeml v5   (.xml) + OTIO (.otio) — DaVinci Resolve
 *   "otio"     → OpenTimelineIO (.otio) — Universal interchange
 */

const express = require('express');
const router  = express.Router();
const { authenticateUser } = require('../middleware/auth');

// Cache the ESM module after first load (package is ESM-only — no require() support)
let _timeline = null;
async function getTimeline() {
    if (!_timeline) {
        _timeline = await import('@chatoctopus/timeline');
    }
    return _timeline;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a Viral Pilot fps value to the nearest FRAME_RATES key the library
 * knows about. Falls back to "30" when no exact match.
 */
function resolveFrameRateKey(fps) {
    const map = {
        24:     '24',
        23.976: '23.976',
        25:     '25',
        29.97:  '29.97',
        30:     '30',
        59.94:  '59.94',
        60:     '60',
    };
    return map[fps] || map[Math.round(fps)] || '30';
}

/**
 * Derive pixel dimensions from a Viral Pilot aspectRatio string.
 * Always targets a 1080-height master (or 1920-height for 9:16).
 */
function resolveDimensions(aspectRatio) {
    switch (aspectRatio) {
        case '9:16':  return { width: 1080, height: 1920 };
        case '1:1':   return { width: 1080, height: 1080 };
        case '4:3':   return { width: 1440, height: 1080 };
        case '21:9':  return { width: 2560, height: 1080 };
        default:      return { width: 1920, height: 1080 }; // 16:9
    }
}

/**
 * Convert a Viral Pilot track list into the OTIO-first Timeline model
 * expected by @chatoctopus/timeline.
 *
 * Viral Pilot clip schema:
 *   { id, name, src|url, start, duration, offset, speed, volume, type }
 *
 * OTIO clip schema:
 *   { kind: "clip", name, mediaReference: { type:"external", targetUrl, ... },
 *     sourceRange: { startTime: Rational, duration: Rational } }
 */
function buildOTIOTimeline(tracks, fps, aspectRatio, projectName, lib) {
    const {
        rational,
        ZERO,
        FRAME_RATES,
        createTimeline,
    } = lib;

    const frKey    = resolveFrameRateKey(fps);
    const frameRate = FRAME_RATES[frKey]; // { num, den }
    const { width, height } = resolveDimensions(aspectRatio);

    // Convert seconds → frame-aligned Rational
    const secToRational = (secs) => {
        // Round to nearest frame, then express as frames/frameRate
        const frames = Math.round(secs * (frameRate.num / frameRate.den));
        return rational(frames * frameRate.den, frameRate.num);
    };

    const otioTracks = tracks.map((track) => {
        const kind    = track.type === 'audio' ? 'audio' : 'video';
        const clips   = (track.clips || []).sort((a, b) => a.start - b.start);

        const items = clips.map((clip) => {
            const src          = clip.src || clip.url || clip.name || 'media.mp4';
            const offsetSecs   = clip.offset  || 0;
            const durationSecs = clip.duration || 0;

            // If speed != 1 we need to scale the source duration accordingly
            const speed        = clip.speed || 1;
            const srcDuration  = durationSecs * speed; // raw source seconds consumed

            return {
                kind: 'clip',
                name: clip.name || `clip_${clip.id || Math.random().toString(36).slice(2)}`,
                mediaReference: {
                    type:          'external',
                    name:          src.split('/').pop(),
                    targetUrl:     src.startsWith('file://') ? src : `file://localhost${src.startsWith('/') ? '' : '/'}${src}`,
                    mediaKind:     kind,
                    availableRange: {
                        startTime: ZERO,
                        duration:  secToRational(srcDuration + offsetSecs),
                    },
                },
                sourceRange: {
                    startTime: secToRational(offsetSecs),
                    duration:  secToRational(srcDuration),
                },
            };
        });

        return { kind, name: track.name || (kind === 'video' ? 'V1' : 'A1'), items };
    }).filter((t) => t.items.length > 0);

    return createTimeline({
        name:   projectName || 'Viral Pilot Project',
        format: {
            width,
            height,
            frameRate,
            audioRate:   48000,
            colorSpace:  '1-1-1 (Rec. 709)',
        },
        tracks: otioTracks,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT-TYPE + FILENAME MAP
// ─────────────────────────────────────────────────────────────────────────────
const FORMAT_META = {
    fcpx:    { contentType: 'application/xml',  ext: 'fcpxml' },
    premiere:{ contentType: 'application/xml',  ext: 'xml'    },
    resolve: { contentType: 'application/xml',  ext: 'xml'    },  // primary
    otio:    { contentType: 'application/json', ext: 'otio'   },
};

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE
// ─────────────────────────────────────────────────────────────────────────────
router.post('/nle', authenticateUser, async (req, res) => {
    const {
        target,
        tracks        = [],
        fps           = 30,
        aspectRatio   = '16:9',
        projectName   = 'Viral Pilot Project',
    } = req.body;

    console.log(`[NLEExport] Requested target: ${target}, fps: ${fps}, tracks: ${tracks.length}`);

    const VALID_TARGETS = ['fcpx', 'premiere', 'resolve', 'otio'];
    if (!VALID_TARGETS.includes(target)) {
        return res.status(400).json({
            error: `Invalid target "${target}". Supported: ${VALID_TARGETS.join(', ')}`
        });
    }

    if (!tracks || tracks.length === 0) {
        return res.status(400).json({ error: 'No tracks provided. Add clips to your timeline before exporting.' });
    }

    try {
        const lib = await getTimeline();
        const { exportTimeline } = lib;

        const timeline = buildOTIOTimeline(tracks, fps, aspectRatio, projectName, lib);

        const slug = (projectName || 'viral-pilot')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        // ── Standard single-file export ──────────────────────────────────────
        if (target !== 'resolve') {
            const meta    = FORMAT_META[target];
            const content = exportTimeline(timeline, target);
            const filename = `${slug}.${meta.ext}`;

            res.setHeader('Content-Type', meta.contentType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.setHeader('X-Export-Target', target);
            res.setHeader('X-Export-Filename', filename);
            return res.send(content);
        }

        // ── DaVinci Resolve: dual-file (.xml + .otio) via multipart ─────────
        // We use a JSON envelope so the client can trigger two downloads.
        const xmlContent  = exportTimeline(timeline, 'resolve');
        const otioContent = exportTimeline(timeline, 'otio');

        return res.json({
            success: true,
            target: 'resolve',
            files: [
                {
                    filename:    `${slug}-resolve.xml`,
                    contentType: 'application/xml',
                    content:     xmlContent,
                },
                {
                    filename:    `${slug}-resolve.otio`,
                    contentType: 'application/json',
                    content:     otioContent,
                },
            ],
        });

    } catch (err) {
        console.error('[NLEExport] Export error:', err);
        return res.status(500).json({ error: `Export failed: ${err.message}` });
    }
});

module.exports = router;
