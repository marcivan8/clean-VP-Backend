'use strict';

/**
 * server/lut-engine/library/LUTExportIntegration.js
 *
 * Bridges the LUT engine with exportProcessor.js.
 *
 * When a project's export job includes a LUT ID, this module:
 *   1. Fetches the LUT's gcs_path from the DB
 *   2. Downloads the .cube file to a temp path on the worker
 *   3. Returns the FFmpeg lut3d filter string to inject into the export pipeline
 *
 * DESIGN RULE: LUT is applied via FFmpeg lut3d filter ONLY.
 *              CSS filter is NEVER used in export context.
 *
 * Usage (inside exportProcessor.js):
 *   const { lutExportIntegration } = require('../server/lut-engine/library/LUTExportIntegration');
 *   const filter = await lutExportIntegration.getLUTFilterForExport(lutId, jobTempDir);
 *   if (filter) ffmpegFilters.push(filter);
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { supabaseAdmin } = require('../../../config/database.js');
const { lutService }    = require('./LUTService.js');

class LUTExportIntegration {
    /**
     * Download a LUT file and return the FFmpeg lut3d filter string.
     *
     * @param {string}      lutId      — UUID of the LUT asset
     * @param {string|null} [tempDir]  — directory to store temp file (default: os.tmpdir())
     * @returns {Promise<string|null>} FFmpeg filter string, or null if unavailable
     */
    async getLUTFilterForExport(lutId, tempDir = null) {
        if (!lutId) return null;

        try {
            const lut = await lutService.getLUTById(lutId);
            if (!lut) {
                console.warn(`[LUTExportIntegration] LUT ${lutId} not found`);
                return null;
            }

            const gcsPath = lut.gcs_path || lut.gcsPath;
            if (!gcsPath) {
                console.warn(`[LUTExportIntegration] LUT ${lutId} has no gcs_path (not seeded with file)`);
                return null;
            }

            // Download to temp file
            const lutFilePath = await this._downloadLUT(gcsPath, lut.name, tempDir);
            if (!lutFilePath) return null;

            return lutService.buildFFmpegFilter(lutId, lutFilePath);
        } catch (err) {
            console.error('[LUTExportIntegration.getLUTFilterForExport]', err.message);
            return null;
        }
    }

    /**
     * Inject the LUT filter into an FFmpeg command array.
     * Appends -vf "lut3d='path'" to the args array.
     *
     * @param {string[]} ffmpegArgs — mutable args array
     * @param {string}   lutId
     * @param {string}   lutFilePath
     * @returns {string[]} updated args
     */
    injectIntoFFmpegArgs(ffmpegArgs, lutId, lutFilePath) {
        const filter = lutService.buildFFmpegFilter(lutId, lutFilePath);
        if (!filter) return ffmpegArgs;

        const args = [...ffmpegArgs];
        // If there's already a -vf flag, extend it; otherwise add new
        const vfIdx = args.indexOf('-vf');
        if (vfIdx !== -1 && vfIdx + 1 < args.length) {
            args[vfIdx + 1] = `${args[vfIdx + 1]},${filter}`;
        } else {
            args.push('-vf', filter);
        }
        return args;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Download a LUT file from GCS to a local temp path.
     * Returns null if download fails.
     *
     * @private
     */
    async _downloadLUT(gcsPath, lutName, tempDir) {
        const dir      = tempDir || os.tmpdir();
        const ext      = path.extname(gcsPath) || '.cube';
        const filename = `lut_${lutName}${ext}`;
        const localPath = path.join(dir, filename);

        // If already cached locally, reuse
        if (fs.existsSync(localPath)) return localPath;

        try {
            // Try StorageService download (GCS in prod, local in dev)
            const { StorageService } = require('../../../services/StorageService.js');
            const storage = new StorageService();
            await storage.downloadFile(gcsPath, localPath);
            return localPath;
        } catch (err) {
            console.error('[LUTExportIntegration._downloadLUT] download failed:', err.message);
            return null;
        }
    }
}

// Singleton
const lutExportIntegration = new LUTExportIntegration();
module.exports = { LUTExportIntegration, lutExportIntegration };
