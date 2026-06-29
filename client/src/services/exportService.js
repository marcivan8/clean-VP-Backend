/**
 * DEPRECATED — do not use.
 *
 * Export is handled directly in IDELayout.jsx (handleExportConfirm).
 * That function correctly uses the 202 async job pattern:
 *   POST /api/render → { jobId } → poll /api/render/status/:jobId → download from GCS
 *
 * This file previously used a synchronous pattern that broke when the backend
 * switched to async rendering. It is kept only to avoid broken-import errors;
 * nothing here should be called.
 */

export const exportTimeline = () => {
    throw new Error(
        '[exportService] This function is deprecated. Export is handled by IDELayout.handleExportConfirm.'
    );
};
