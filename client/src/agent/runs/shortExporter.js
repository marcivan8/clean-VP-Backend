/**
 * client/src/agent/runs/shortExporter.js — how an agent run exports a short
 * (R179). The export itself lives in IDELayout (handleFfmpegExport, the same
 * function the Shorts panel's Export button calls); IDELayout registers it here
 * while the editor is open, so the run store can call it without importing a
 * component. No exporter registered = the editor is not open, and the post
 * step says so instead of hanging.
 */
let exporter = null;

export function setShortExporter(fn) {
    exporter = typeof fn === 'function' ? fn : null;
    return () => { if (exporter === fn) exporter = null; };
}

export function getShortExporter() {
    return exporter;
}

export default { setShortExporter, getShortExporter };
