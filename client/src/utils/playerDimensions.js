// The project's REFERENCE resolution for a given aspect ratio — the pixel
// space that clip properties like `fontSize` and `stroke.width` are defined
// in, and (by default, absent an explicit platform/resolution override) the
// resolution the export worker renders at. See IDELayout.jsx's `<Player>`
// mount, which syncs `project.settings.shared.size` to exactly these numbers
// right before render, and jobs/exportProcessor.js's RESOLUTION_PRESETS /
// PLATFORM_PRESETS.
//
// Extracted out of IDELayout.jsx (where this was originally a local,
// un-exported function) so TextOverlay.jsx can use the SAME numbers to scale
// its DOM caption rendering to match — see the scale-factor comment in
// TextOverlay.jsx for why that matters.
export const getPlayerDimensions = (ratio) => {
    switch (ratio) {
        case '9:16': return { width: 1080, height: 1920 };
        case '1:1':  return { width: 1080, height: 1080 };
        case '4:3':  return { width: 1440, height: 1080 };
        case '4:5':  return { width: 1080, height: 1350 };
        case '21:9': return { width: 2560, height: 1080 };
        case '16:9':
        default:     return { width: 1920, height: 1080 };
    }
};
