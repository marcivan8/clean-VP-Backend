/**
 * nleExportService.js
 *
 * Thin client-side wrapper that POSTs the current Viral Pilot timeline state
 * to the backend NLE export endpoint (POST /api/export/nle) and triggers a
 * browser download of the returned file(s).
 *
 * All format generation is done server-side by @chatoctopus/timeline so we
 * get frame-accurate rational time math and proper OTIO/FCPXML/xmeml output.
 *
 * Supported targets (must match backend):
 *   "fcpx"     → FCPXML 1.8  (.fcpxml)  Final Cut Pro X
 *   "premiere" → xmeml v5   (.xml)     Adobe Premiere Pro
 *   "resolve"  → xmeml v5  (.xml) + OTIO (.otio)  DaVinci Resolve (dual download)
 *   "otio"     → OpenTimelineIO (.otio) Universal interchange
 */

const API_BASE = '/api/export';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Trigger a browser file download from an in-memory string or Blob.
 */
function downloadBlob(content, filename, mimeType) {
    const blob = content instanceof Blob
        ? content
        : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Compute the total timeline duration from all tracks.
 */
function computeDuration(tracks) {
    return Math.max(
        0,
        ...tracks.flatMap(t => t.clips || []).map(c => (c.start || 0) + (c.duration || 0))
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class NLEExportService {
    /**
     * Export the current timeline to an NLE-compatible format.
     *
     * @param {string} target  - 'fcpx' | 'premiere' | 'resolve' | 'otio'
     * @param {object} timelineState - current useTimelineStore state
     * @returns {Promise<{ success: boolean, message: string, format: string, filename?: string }>}
     */
    static async export(target, timelineState) {
        const { tracks = [], aspectRatio = '16:9', fps = 30 } = timelineState;
        const projectName = 'Vibed Project';

        console.log(`[NLEExportService] Exporting for: ${target}`);

        const body = {
            target,
            tracks,
            duration: computeDuration(tracks),
            fps,
            aspectRatio,
            projectName,
        };

        const response = await fetch(`${API_BASE}/nle`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({ error: 'Unknown server error' }));
            throw new Error(err.error || `Server returned ${response.status}`);
        }

        // ── DaVinci Resolve returns a JSON envelope with two files ────────────
        if (target === 'resolve') {
            const json = await response.json();
            if (!json.success || !Array.isArray(json.files)) {
                throw new Error('Invalid response from server for DaVinci export');
            }

            // Stagger the two downloads by 600 ms so browsers don't block them
            json.files.forEach((file, i) => {
                setTimeout(() => {
                    downloadBlob(file.content, file.filename, file.contentType);
                }, i * 600);
            });

            return {
                success:  true,
                message:  '✓ Exported for DaVinci Resolve.\n• XML: File → Import Timeline → Import AAF, EDL, XML…\n• OTIO: File → Import Timeline → OpenTimelineIO (Resolve 18+)',
                format:   'xmeml v5 (.xml) + OpenTimelineIO (.otio)',
                filename: json.files[0]?.filename,
            };
        }

        // ── All other targets: single file download from response body ────────
        const blob = await response.blob();
        const filename = response.headers.get('X-Export-Filename')
            || `viral-pilot.${target === 'fcpx' ? 'fcpxml' : target === 'otio' ? 'otio' : 'xml'}`;

        downloadBlob(blob, filename, blob.type);

        const META = {
            fcpx:     { message: '✓ Exported for Final Cut Pro.\nOpen in FCPX: File → Import → XML → Select the .fcpxml file',      format: 'FCPXML 1.8 (.fcpxml)' },
            premiere: { message: '✓ Exported for Premiere Pro.\nOpen in Premiere: File → Import → Select the .xml file',            format: 'xmeml v5 (.xml)'       },
            otio:     { message: '✓ Exported as OpenTimelineIO.\nImport in any OTIO-compatible NLE or convert with the OTIO CLI.', format: 'OpenTimelineIO (.otio)' },
        };

        const meta = META[target] || { message: `✓ Exported (${target})`, format: target };

        return { success: true, message: meta.message, format: meta.format, filename };
    }

    /**
     * Returns supported formats info for display in the UI.
     */
    static getSupportedFormats() {
        return [
            {
                id:          'premiere',
                name:        'Adobe Premiere Pro',
                format:      'xmeml v5 (.xml)',
                icon:        '🎬',
                description: 'Import via File → Import in Premiere Pro',
            },
            {
                id:          'fcpx',
                name:        'Final Cut Pro X',
                format:      'FCPXML 1.8 (.fcpxml)',
                icon:        '🎥',
                description: 'Import via File → Import → XML in Final Cut Pro',
            },
            {
                id:          'resolve',
                name:        'DaVinci Resolve',
                format:      'xmeml v5 (.xml) + OTIO',
                icon:        '🎞',
                description: 'Import via File → Import Timeline in DaVinci Resolve',
            },
            {
                id:          'otio',
                name:        'OpenTimelineIO',
                format:      'Universal (.otio)',
                icon:        '🔗',
                description: 'Universal interchange — works in Resolve 18, Premiere (beta), Kdenlive 20+',
            },
        ];
    }
}

/**
 * Convenience wrapper used by the NLE tab in ExportModal.
 */
export const exportToNLE = (format, tracks, opts = {}) => {
    const timelineState = {
        tracks,
        duration:    computeDuration(tracks),
        aspectRatio: opts.aspectRatio || '16:9',
        fps:         opts.fps         || 30,
    };
    return NLEExportService.export(format, timelineState);
};

export const getNLEFormats = () => NLEExportService.getSupportedFormats();

export default NLEExportService;