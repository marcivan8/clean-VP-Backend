/**
 * client/src/agent/zoneQuery.js
 *
 * R99 — parses "blur the top right corner" / "add a blur zone in the
 * bottom left" / "blur the logo" style prompts into a rectangle for the
 * new add_blur_zone command. Mirrors stickerQuery.js's (R97) shape and
 * intent on purpose: pull the one piece of meaning that matters -- here, a
 * screen position, optionally a size -- out of a loose sentence.
 *
 * Positions are coarse named zones, not freehand coordinates: there is no
 * UI here for the user to draw a rectangle with, and "blur the top right
 * corner" / "blur the bottom of the screen" covers the real cases (a
 * watermark, a timestamp, a caption burned into the source, a stray face
 * in the background) without asking the user to specify pixels.
 */

const ZONE_PRESETS = {
    'top-left':     { x: 0,    y: 0,    w: 0.35, h: 0.35 },
    'top-right':    { x: 0.65, y: 0,    w: 0.35, h: 0.35 },
    'bottom-left':  { x: 0,    y: 0.65, w: 0.35, h: 0.35 },
    'bottom-right': { x: 0.65, y: 0.65, w: 0.35, h: 0.35 },
    top:            { x: 0,    y: 0,    w: 1,    h: 0.25 },
    bottom:         { x: 0,    y: 0.75, w: 1,    h: 0.25 },
    left:           { x: 0,    y: 0,    w: 0.3,  h: 1 },
    right:          { x: 0.7,  y: 0,    w: 0.3,  h: 1 },
    center:         { x: 0.3,  y: 0.3,  w: 0.4,  h: 0.4 },
};

/** The sensible default when the wording names no location at all: the
 *  corner where a watermark/logo/timestamp usually sits. */
const DEFAULT_PRESET = 'top-right';

/**
 * @param {string} text the user's prompt
 * @returns {{x:number,y:number,w:number,h:number}} a zone box in frame
 *   fractions — never null; a prompt naming no location gets the default
 *   corner rather than failing, matching add_sticker's own "no keyword ->
 *   sensible default" convention (R97).
 */
export function zoneFromText(text) {
    const lower = String(text || '').toLowerCase();

    let preset = null;
    if (/\b(top|upper)[\s-]*(left)\b/.test(lower)) preset = 'top-left';
    else if (/\b(top|upper)[\s-]*(right)\b/.test(lower)) preset = 'top-right';
    else if (/\b(bottom|lower)[\s-]*(left)\b/.test(lower)) preset = 'bottom-left';
    else if (/\b(bottom|lower)[\s-]*(right)\b/.test(lower)) preset = 'bottom-right';
    else if (/\bcorner\b/.test(lower)) preset = DEFAULT_PRESET;
    else if (/\b(top|upper)\b/.test(lower)) preset = 'top';
    else if (/\b(bottom|lower)\b/.test(lower)) preset = 'bottom';
    else if (/\bleft\b/.test(lower)) preset = 'left';
    else if (/\bright\b/.test(lower)) preset = 'right';
    else if (/\b(center|centre|middle)\b/.test(lower)) preset = 'center';

    const box = { ...ZONE_PRESETS[preset || DEFAULT_PRESET] };

    // A size word nudges the box bigger/smaller around its own anchor
    // corner/edge rather than recentring it.
    let sizeMul = 1;
    if (/\b(small|tiny|little)\b/.test(lower)) sizeMul = 0.65;
    else if (/\b(large|big|huge|wide)\b/.test(lower)) sizeMul = 1.35;

    if (sizeMul !== 1) {
        const newW = Math.max(0.08, Math.min(1, box.w * sizeMul));
        const newH = Math.max(0.08, Math.min(1, box.h * sizeMul));
        // Keep the box anchored to whichever edge it was already touching
        // (x=0 stays 0, x+w=1 stays 1, etc.) so "a bigger top-right corner"
        // grows toward the center rather than drifting off-frame.
        const touchesRight = box.x + box.w >= 0.999;
        const touchesBottom = box.y + box.h >= 0.999;
        box.x = touchesRight ? Math.max(0, 1 - newW) : box.x;
        box.y = touchesBottom ? Math.max(0, 1 - newH) : box.y;
        box.w = newW;
        box.h = newH;
    }

    return box;
}

export default { zoneFromText };
