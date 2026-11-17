/**
 * client/src/agent/DesignStudioCommandRegistry.js
 *
 * SINGLE SOURCE OF TRUTH for Design Studio AI commands & actions.
 *
 * Powers the conversational AI layer director ("Or just say it"), the natural
 * language design prompt, and bridges external AI agent requests to live canvas state.
 *
 * Grounded in professional design system ontology and taxonomies:
 * - Semantic layer mapping dictionary (e.g. "hand" -> subject cutout, "type" -> headline text).
 * - Multi-clause compound prompt parsing (e.g. "Make the hand larger, push type left").
 * - Full alignment, ordering, rotation, shadow, stroke, corner radius, and font controls.
 * - Atomic by default: every command is reversible via undo checkpoints.
 *
 * Pure, zero-dependency. Strictly zero emojis.
 */

// ── Semantic Ontologies & Dictionaries ────────────────────────────────────────

export const LAYER_SEMANTIC_DICTIONARY = {
    subject: [
        'hand', 'hands', 'finger', 'fingers', 'person', 'model', 'actor',
        'cutout', 'subject', 'hero', 'photo', 'image', 'picture', 'figure',
        'portrait', 'silhouette', 'product shot', 'isolated'
    ],
    headline: [
        'type', 'text', 'typography', 'words', 'title', 'heading', 'headline',
        'caption', 'copy', 'header', 'quote', 'label'
    ],
    duration: [
        'badge', 'pill', 'duration', 'time', 'timestamp', 'clock', 'tag', 'counter', 'chip'
    ],
    background: [
        'background', 'bg', 'backdrop', 'canvas', 'surface', 'base', 'wallpaper', 'ground'
    ],
    rect: [
        'rect', 'rectangle', 'box', 'card', 'panel', 'frame', 'square'
    ],
    circle: [
        'circle', 'ellipse', 'dot', 'oval', 'ring'
    ],
};

/**
 * Resolves a semantic layer token to a layer ID.
 *
 * @param {string} text
 * @param {string|null} fallbackLayerId
 * @returns {string}
 */
export function resolveTargetLayer(text, fallbackLayerId = 'headline') {
    if (!text || typeof text !== 'string') return fallbackLayerId || 'headline';
    const s = text.toLowerCase();

    for (const [layerKey, synonyms] of Object.entries(LAYER_SEMANTIC_DICTIONARY)) {
        for (const syn of synonyms) {
            // Match word boundaries so "type" matches "push type left"
            const regex = new RegExp(`\\b${syn}\\b`, 'i');
            if (regex.test(s)) {
                return layerKey;
            }
        }
    }

    return fallbackLayerId || 'headline';
}

// ── Registry Commands ────────────────────────────────────────────────────────

export const DESIGN_COMMANDS = [
    // ── 1. Layer Geometry & Positioning ───────────────────────────────────────
    {
        id: 'ds_nudge_layer',
        category: 'geometry',
        label: 'Nudge or move layer',
        summary: 'Shifts layer horizontally or vertically on the canvas.',
        phrases: [
            'move left', 'nudge left', 'push left', 'shift left', 'push type left',
            'move right', 'nudge right', 'push right', 'shift right',
            'move up', 'nudge up', 'push up', 'shift up',
            'move down', 'nudge down', 'push down', 'shift down',
            'center headline', 'center text', 'align center', 'center it', 'center'
        ],
        negative: ['size', 'font', 'color', 'export'],
        execute: (params, ctx) => {
            const { targetLayer = 'headline', deltaX = 0, deltaY = 0, center = false } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer ||
                    (targetLayer === 'subject' && (l.id === 'subject' || l.type === 'image')) ||
                    (targetLayer === 'headline' && (l.id === 'headline' || l.type === 'text')) ||
                    (targetLayer === 'duration' && (l.id === 'duration' || l.type === 'badge')) ||
                    (!targetLayer && l.id === ctx.selectedLayerId);

                if (isTarget) {
                    updated = true;
                    if (center) {
                        return { ...l, x: Math.max(20, Math.round((1280 - (l.w || 400)) / 2)) };
                    }
                    return {
                        ...l,
                        x: Math.max(0, l.x + deltaX),
                        y: Math.max(0, l.y + deltaY),
                    };
                }
                return l;
            }));

            if (!updated) return { success: false, message: `Could not find layer ${targetLayer}` };
            return {
                success: true,
                message: center ? `Centered ${targetLayer}` : `Moved ${targetLayer} by (${deltaX}px, ${deltaY}px)`,
            };
        },
    },

    // ── 2. Layer Scale & Dimensions ───────────────────────────────────────────
    {
        id: 'ds_scale_layer',
        category: 'geometry',
        label: 'Scale layer',
        summary: 'Enlarges or reduces the dimensions of target layer.',
        phrases: [
            'make larger', 'larger', 'make bigger', 'bigger', 'enlarge', 'scale up', 'bump up',
            'make the hand larger', 'make hand larger', 'hand larger',
            'make smaller', 'smaller', 'shrink', 'scale down', 'reduce size'
        ],
        negative: ['font size', 'text size', 'color'],
        execute: (params, ctx) => {
            const { targetLayer = 'headline', factor = 1.2 } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer ||
                    (targetLayer === 'subject' && (l.id === 'subject' || l.type === 'image')) ||
                    (targetLayer === 'headline' && (l.id === 'headline' || l.type === 'text')) ||
                    (targetLayer === 'duration' && (l.id === 'duration' || l.type === 'badge')) ||
                    (!targetLayer && l.id === ctx.selectedLayerId);

                if (isTarget) {
                    updated = true;
                    if (l.type === 'text') {
                        const newSize = Math.max(20, Math.min(140, Math.round(l.fontSize * factor)));
                        const newH = Math.round(l.h * factor);
                        return { ...l, fontSize: newSize, h: newH };
                    }
                    return {
                        ...l,
                        w: Math.round(l.w * factor),
                        h: Math.round(l.h * factor),
                    };
                }
                return l;
            }));

            if (!updated) return { success: false, message: `Could not find layer ${targetLayer}` };
            return { success: true, message: `Scaled ${targetLayer} by factor ${factor}` };
        },
    },

    // ── 3. Alignment & Distribution ───────────────────────────────────────────
    {
        id: 'ds_align_layer',
        category: 'alignment',
        label: 'Align layer',
        summary: 'Snaps layer alignment relative to canvas boundaries or composition.',
        phrases: [
            'align left', 'align right', 'align center', 'align top', 'align bottom', 'align middle',
            'flush left', 'flush right', 'stick to left', 'stick to right', 'snap to top'
        ],
        execute: (params, ctx) => {
            const { targetLayer = 'headline', alignment = 'left' } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    if (alignment === 'left') return { ...l, x: 48 };
                    if (alignment === 'right') return { ...l, x: Math.max(0, 1280 - (l.w || 200) - 48) };
                    if (alignment === 'center') return { ...l, x: Math.max(0, Math.round((1280 - (l.w || 200)) / 2)) };
                    if (alignment === 'top') return { ...l, y: 48 };
                    if (alignment === 'bottom') return { ...l, y: Math.max(0, 720 - (l.h || 100) - 48) };
                    if (alignment === 'middle') return { ...l, y: Math.max(0, Math.round((720 - (l.h || 100)) / 2)) };
                }
                return l;
            }));

            if (!updated) return { success: false, message: `Could not align layer ${targetLayer}` };
            return { success: true, message: `Aligned ${targetLayer} to ${alignment}` };
        },
    },

    // ── 4. Layer Hierarchy & Ordering ─────────────────────────────────────────
    {
        id: 'ds_layer_order',
        category: 'hierarchy',
        label: 'Reorder layer hierarchy',
        summary: 'Brings layer forward or sends backward in the rendering stack.',
        phrases: [
            'bring to front', 'bring forward', 'send to back', 'send backward',
            'move to front', 'move to back', 'duplicate layer', 'duplicate'
        ],
        execute: (params, ctx) => {
            const { targetLayer = ctx.selectedLayerId, action = 'bring_forward' } = params;
            if (!targetLayer) return { success: false, message: 'No target layer selected' };

            let success = false;
            ctx.setLayers(prev => {
                const idx = prev.findIndex(l => l.id === targetLayer);
                if (idx === -1) return prev;

                const newLayers = [...prev];
                const [item] = newLayers.splice(idx, 1);

                if (action === 'bring_to_front') {
                    newLayers.unshift(item);
                    success = true;
                } else if (action === 'send_to_back') {
                    newLayers.push(item);
                    success = true;
                } else if (action === 'bring_forward') {
                    const newIdx = Math.max(0, idx - 1);
                    newLayers.splice(newIdx, 0, item);
                    success = true;
                } else if (action === 'send_backward') {
                    const newIdx = Math.min(newLayers.length, idx + 1);
                    newLayers.splice(newIdx, 0, item);
                    success = true;
                } else if (action === 'duplicate') {
                    const dup = {
                        ...item,
                        id: `${item.id}-copy-${Date.now()}`,
                        name: `${item.name} (Copy)`,
                        x: item.x + 24,
                        y: item.y + 24,
                    };
                    newLayers.splice(idx, 0, item, dup);
                    success = true;
                }
                return newLayers;
            });

            return { success, message: `Applied layer hierarchy: ${action}` };
        },
    },

    // ── 5. Corner Radius (Rounded Corners) ────────────────────────────────────
    {
        id: 'ds_set_corner_radius',
        category: 'styling',
        label: 'Set corner radius',
        summary: 'Rounds the corners of boxes, cards, badges, or cutouts.',
        phrases: [
            'round corners', 'rounded', 'corner radius', 'make round', 'pill radius',
            'radius 12', 'radius 16', 'radius 24', 'radius 999'
        ],
        execute: (params, ctx) => {
            const { targetLayer, radius = 16 } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return { ...l, borderRadius: radius };
                }
                return l;
            }));

            return { success: updated, message: `Set corner radius on ${targetLayer || 'layer'} to ${radius}px` };
        },
    },

    // ── 6. Drop Shadow & Elevation ────────────────────────────────────────────
    {
        id: 'ds_set_shadow',
        category: 'styling',
        label: 'Set drop shadow',
        summary: 'Applies or adjusts drop shadow elevation and blur.',
        phrases: [
            'add shadow', 'drop shadow', 'elevation', 'soft shadow', 'remove shadow', 'no shadow'
        ],
        execute: (params, ctx) => {
            const { targetLayer, hasShadow = true } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return {
                        ...l,
                        dropShadow: hasShadow,
                        shadowBlur: hasShadow ? 24 : 0,
                        shadowOffsetY: hasShadow ? 8 : 0,
                        shadowColor: hasShadow ? 'rgba(0, 0, 0, 0.4)' : 'transparent',
                    };
                }
                return l;
            }));

            return { success: updated, message: `${hasShadow ? 'Added' : 'Removed'} drop shadow on ${targetLayer || 'layer'}` };
        },
    },

    // ── 7. Stroke & Border ────────────────────────────────────────────────────
    {
        id: 'ds_set_stroke',
        category: 'styling',
        label: 'Set stroke border',
        summary: 'Adds or updates outline stroke width and color.',
        phrases: [
            'add stroke', 'stroke border', 'outline', 'white stroke', 'cyan stroke', 'remove stroke'
        ],
        execute: (params, ctx) => {
            const { targetLayer, strokeWidth = 2, strokeColor = '#00E5FF' } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return { ...l, strokeWidth, strokeColor };
                }
                return l;
            }));

            return { success: updated, message: `Updated stroke border on ${targetLayer || 'layer'}` };
        },
    },

    // ── 8. Opacity & Transparency ─────────────────────────────────────────────
    {
        id: 'ds_set_opacity',
        category: 'styling',
        label: 'Set layer opacity',
        summary: 'Adjusts layer opacity percentage from 0 to 100.',
        phrases: [
            'opacity 80', 'opacity 50', 'half opacity', 'transparent', 'fade layer', 'make opaque'
        ],
        execute: (params, ctx) => {
            const { targetLayer, opacity = 100 } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return { ...l, opacity: Math.max(0, Math.min(100, opacity)) };
                }
                return l;
            }));

            return { success: updated, message: `Set opacity to ${opacity}% on ${targetLayer || 'layer'}` };
        },
    },

    // ── 9. Rotation Angle ─────────────────────────────────────────────────────
    {
        id: 'ds_set_rotation',
        category: 'geometry',
        label: 'Rotate layer',
        summary: 'Rotates layer by specified angle in degrees.',
        phrases: [
            'rotate 15', 'rotate -15', 'tilt right', 'tilt left', 'rotate layer', 'reset rotation'
        ],
        execute: (params, ctx) => {
            const { targetLayer, rotation = 0 } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return { ...l, rotation };
                }
                return l;
            }));

            return { success: updated, message: `Rotated ${targetLayer || 'layer'} by ${rotation}°` };
        },
    },

    // ── 10. Typography & Font Styling ─────────────────────────────────────────
    {
        id: 'ds_set_font_size',
        category: 'typography',
        label: 'Set font size',
        summary: 'Sets exact font size for headline or text layers.',
        phrases: [
            'size 88', 'font size 72', 'make text 96', 'size 64', 'size 48',
            'make headline size', 'font size'
        ],
        execute: (params, ctx) => {
            const { targetLayer = 'headline', fontSize = 72 } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = (l.type === 'text') && (l.id === targetLayer || !targetLayer || l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return { ...l, fontSize };
                }
                return l;
            }));

            if (!updated) return { success: false, message: 'No text layer found to update font size' };
            return { success: true, message: `Set font size to ${fontSize}px` };
        },
    },

    {
        id: 'ds_set_font_family',
        category: 'typography',
        label: 'Set font family',
        summary: 'Changes typeface to Plus Jakarta Sans, Instrument Serif, Geist, or JetBrains Mono.',
        phrases: [
            'change font', 'use serif', 'serif font', 'use plus jakarta sans',
            'use geist', 'use mono', 'monospace font', 'sans serif font'
        ],
        execute: (params, ctx) => {
            const { targetLayer = 'headline', fontFamily = 'Plus Jakarta Sans' } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                if (l.type === 'text') {
                    updated = true;
                    return { ...l, fontFamily };
                }
                return l;
            }));

            if (!updated) return { success: false, message: 'No text layer found to change font' };
            return { success: true, message: `Changed font family to ${fontFamily}` };
        },
    },

    // ── 11. Color & Brand Palette ─────────────────────────────────────────────
    {
        id: 'ds_set_layer_color',
        category: 'color',
        label: 'Set layer fill color',
        summary: 'Updates fill color or gradient swatch on target layer.',
        phrases: [
            'make it white', 'make white', 'turn white', 'make black', 'make terracotta',
            'make blue', 'make cyan', 'change color', 'set fill', 'color white', 'color black'
        ],
        execute: (params, ctx) => {
            const { targetLayer = ctx.selectedLayerId, color = '#FFFFFF' } = params;
            let updated = false;

            ctx.setLayers(prev => prev.map(l => {
                const isTarget = l.id === targetLayer || (!targetLayer && l.id === ctx.selectedLayerId);
                if (isTarget) {
                    updated = true;
                    return { ...l, fill: color };
                }
                return l;
            }));

            if (!updated) return { success: false, message: `Could not apply color to ${targetLayer}` };
            return { success: true, message: `Applied fill color ${color} to ${targetLayer}` };
        },
    },

    // ── 12. Creative Directions & Presets ─────────────────────────────────────
    {
        id: 'ds_apply_direction',
        category: 'presets',
        label: 'Apply creative direction',
        summary: 'Switches whole artboard styling to a preset direction.',
        phrases: [
            'switch to direction', 'direction b', 'the 94 rule', '94 rule', 'apply 94 rule', 'direction c', '1:16',
            'pour slower', 'direction d', 'light editorial', 'split ratio', 'editorial direction'
        ],
        execute: (params, ctx) => {
            const { directionId = 'dir-b' } = params;
            if (typeof ctx.applyDirection === 'function') {
                ctx.applyDirection(directionId);
                return { success: true, message: `Applied creative direction: ${directionId}` };
            }
            return { success: false, message: 'applyDirection not available in current context' };
        },
    },

    // ── 13. Surface Adaptations ───────────────────────────────────────────────
    {
        id: 'ds_adapt_surface',
        category: 'surfaces',
        label: 'Adapt surface format',
        summary: 'Re-targets design composition to a different surface aspect ratio.',
        phrases: [
            'adapt to', 'switch to instagram', 'square format', '1:1 format',
            'product design format', 'packaging format', 'paid ad format', 'print format', 'youtube thumbnail'
        ],
        execute: (params, ctx) => {
            const { formatId = 'social' } = params;
            if (typeof ctx.setSelectedFormat === 'function') {
                ctx.setSelectedFormat(formatId);
                return { success: true, message: `Adapted canvas to ${formatId} format` };
            }
            return { success: false, message: 'setSelectedFormat not available' };
        },
    },
];

// ── Compound Prompt Parsing & Parameter Extraction ───────────────────────────

/**
 * Splits a compound user prompt into individual discrete clauses.
 * E.g. "Make the hand larger, push type left" -> ["Make the hand larger", "push type left"]
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitCompoundPrompt(text) {
    if (!text || typeof text !== 'string') return [];
    // Split by commas, semicolons, "&", "and", "then", or "plus"
    return text
        .split(/[,;&]|\s+and\s+|\s+then\s+|\s+plus\s+/i)
        .map(c => c.trim())
        .filter(c => c.length > 2);
}

/**
 * Extracts structured parameters from natural language for a specific command.
 *
 * @param {object} cmd
 * @param {string} text
 * @returns {object}
 */
export function extractDesignParams(cmd, text) {
    const s = String(text || '').toLowerCase();
    const params = {};

    // 1. Resolve target layer via semantic dictionary
    params.targetLayer = resolveTargetLayer(s, null);

    // 2. Geometry deltas
    const pxMatch = s.match(/(\d+)\s*px\s*(?:to the\s*)?(left|right|up|down)/i) ||
                    s.match(/(?:by\s*)?(\d+)\s*px\s*(left|right|up|down)/i) ||
                    s.match(/(left|right|up|down)\s*(?:by\s*)?(\d+)\s*(?:px)?/i);
    let explicitDist = null;
    let explicitDir = null;
    if (pxMatch) {
        if (!isNaN(Number(pxMatch[1])) && isNaN(Number(pxMatch[2]))) {
            explicitDist = Number(pxMatch[1]);
            explicitDir = pxMatch[2].toLowerCase();
        } else if (isNaN(Number(pxMatch[1])) && !isNaN(Number(pxMatch[2]))) {
            explicitDir = pxMatch[1].toLowerCase();
            explicitDist = Number(pxMatch[2]);
        }
    }

    const defaultDelta = 48;
    if (explicitDir === 'left' || (!explicitDir && /\bleft\b/i.test(s))) {
        params.deltaX = -(explicitDist ?? defaultDelta);
    }
    if (explicitDir === 'right' || (!explicitDir && /\bright\b/i.test(s))) {
        params.deltaX = explicitDist ?? defaultDelta;
    }
    if (explicitDir === 'up' || (!explicitDir && /\bup\b/i.test(s))) {
        params.deltaY = -(explicitDist ?? defaultDelta);
    }
    if (explicitDir === 'down' || (!explicitDir && /\bdown\b/i.test(s))) {
        params.deltaY = explicitDist ?? defaultDelta;
    }
    if (/\bcenter\b/i.test(s)) params.center = true;

    // 3. Scale factors
    if (/larger|bigger|enlarge|scale up|boost|maximize/i.test(s)) params.factor = 1.25;
    if (/smaller|shrink|scale down|reduce/i.test(s)) params.factor = 0.8;

    // 4. Alignments
    if (/align left|flush left/i.test(s)) params.alignment = 'left';
    else if (/align right|flush right/i.test(s)) params.alignment = 'right';
    else if (/align center|centered/i.test(s)) params.alignment = 'center';
    else if (/align top/i.test(s)) params.alignment = 'top';
    else if (/align bottom/i.test(s)) params.alignment = 'bottom';
    else if (/align middle/i.test(s)) params.alignment = 'middle';

    // 5. Hierarchy
    if (/front/i.test(s)) params.action = 'bring_to_front';
    else if (/back/i.test(s)) params.action = 'send_to_back';
    else if (/forward/i.test(s)) params.action = 'bring_forward';
    else if (/backward/i.test(s)) params.action = 'send_backward';
    else if (/duplicate/i.test(s)) params.action = 'duplicate';

    // 6. Corner radius
    const radiusMatch = s.match(/radius\s*(\d+)/i) || s.match(/(\d+)\s*px\s*(?:radius|rounded)/i);
    if (radiusMatch) params.radius = parseInt(radiusMatch[1], 10);
    else if (/pill|circle|fully round/i.test(s)) params.radius = 999;
    else if (/round/i.test(s)) params.radius = 20;

    // 7. Drop Shadow
    if (/no shadow|remove shadow/i.test(s)) params.hasShadow = false;
    else if (/shadow|elevation/i.test(s)) params.hasShadow = true;

    // 8. Stroke & Border
    if (/stroke|border|outline/i.test(s)) {
        params.strokeWidth = 2;
        if (/white/i.test(s)) params.strokeColor = '#FFFFFF';
        else if (/cyan|blue/i.test(s)) params.strokeColor = '#00E5FF';
        else if (/black/i.test(s)) params.strokeColor = '#1A1C22';
        else params.strokeColor = '#0B7C91';
    }

    // 9. Opacity
    const opacityMatch = s.match(/(?:opacity|alpha)\s*(\d+)/i) || s.match(/(\d+)%/i);
    if (opacityMatch) params.opacity = parseInt(opacityMatch[1], 10);
    else if (/half/i.test(s)) params.opacity = 50;

    // 10. Rotation
    const rotateMatch = s.match(/rotate\s*(-?\d+)/i) || s.match(/(-?\d+)\s*deg/i);
    if (rotateMatch) params.rotation = parseInt(rotateMatch[1], 10);
    else if (/tilt right/i.test(s)) params.rotation = 12;
    else if (/tilt left/i.test(s)) params.rotation = -12;

    // 11. Font size numeric
    const sizeMatch = s.match(/(?:font\s*size|text\s*size|type\s*size)\s*(\d+)/i) ||
                      (cmd?.id === 'ds_set_font_size' && s.match(/(\d+)\s*(?:px)?/i)) ||
                      (!/\b(?:left|right|up|down|radius|opacity|rotate)\b/i.test(s) && s.match(/(?:size)\s*(\d+)/i));
    if (sizeMatch) {
        params.fontSize = parseInt(sizeMatch[1], 10);
    }

    // 12. Font families
    if (/serif/i.test(s)) params.fontFamily = 'Instrument Serif';
    else if (/geist/i.test(s)) params.fontFamily = 'Geist';
    else if (/mono/i.test(s)) params.fontFamily = 'JetBrains Mono';
    else if (/sans|jakarta/i.test(s)) params.fontFamily = 'Plus Jakarta Sans';

    // 13. Color extraction
    if (/white/i.test(s)) params.color = '#FFFFFF';
    else if (/black/i.test(s)) params.color = '#1A1C22';
    else if (/terracotta|orange|accent/i.test(s)) params.color = '#C85A17';
    else if (/cream|warm/i.test(s)) params.color = '#F4EDE2';
    else if (/blue|cyan/i.test(s)) params.color = '#00E5FF';

    // 14. Direction IDs
    if (/94/i.test(s)) params.directionId = 'dir-b';
    else if (/1:16|ratio/i.test(s)) params.directionId = 'dir-c';
    else if (/slower|pour|blue/i.test(s)) params.directionId = 'dir-d';

    // 15. Format IDs
    if (/instagram|social|square|1:1/i.test(s)) params.formatId = 'social';
    else if (/product|showcase/i.test(s)) params.formatId = 'product';
    else if (/packaging|box/i.test(s)) params.formatId = 'packaging';
    else if (/ad|feed|4:5/i.test(s)) params.formatId = 'ad';
    else if (/print|poster|a4/i.test(s)) params.formatId = 'print';
    else if (/thumbnail|youtube/i.test(s)) params.formatId = 'thumbnail';

    return params;
}

/**
 * Scores a single command against input clause text.
 *
 * @param {object} cmd
 * @param {string} text
 * @returns {number}
 */
export function scoreDesignCommand(cmd, text) {
    if (!text || typeof text !== 'string') return 0;
    const s = text.toLowerCase().trim();

    // Veto if negative keyword matches
    for (const neg of (cmd.negative || [])) {
        if (s.includes(neg)) return 0;
    }

    let score = 0;
    for (const phrase of (cmd.phrases || [])) {
        if (s === phrase) return 100;
        if (s.includes(phrase)) {
            score = Math.max(score, 50 + phrase.length);
        }
    }

    // Heuristics for intent matching
    if (cmd.id === 'ds_scale_layer' && /larger|bigger|enlarge|smaller|shrink/i.test(s)) {
        score = Math.max(score, 70);
    }
    if (cmd.id === 'ds_nudge_layer' && /left|right|up|down|push|shift|nudge/i.test(s)) {
        score = Math.max(score, 70);
    }
    if (cmd.id === 'ds_align_layer' && /align|flush/i.test(s)) {
        score = Math.max(score, 75);
    }
    if (cmd.id === 'ds_set_corner_radius' && /radius|round/i.test(s)) {
        score = Math.max(score, 80);
    }
    if (cmd.id === 'ds_set_shadow' && /shadow|elevation/i.test(s)) {
        score = Math.max(score, 80);
    }
    if (cmd.id === 'ds_layer_order' && /front|back|forward|backward|duplicate/i.test(s)) {
        score = Math.max(score, 80);
    }
    if (cmd.id === 'ds_apply_direction' && /direction|94 rule|1:16|pour slower|style/i.test(s)) {
        score = Math.max(score, 85);
    }
    if (cmd.id === 'ds_set_font_size' && /(?:font\s*size|text\s*size|type\s*size|\bsize\s*\d+)/i.test(s)) {
        score = Math.max(score, 85);
    }

    return score;
}

/**
 * Resolves a single clause to its best matching command.
 *
 * @param {string} clauseText
 * @returns {{ match: object|null, params: object, score: number }}
 */
export function resolveDesignCommand(clauseText) {
    let bestCmd = null;
    let highestScore = 0;

    for (const cmd of DESIGN_COMMANDS) {
        const sc = scoreDesignCommand(cmd, clauseText);
        if (sc > highestScore) {
            highestScore = sc;
            bestCmd = cmd;
        }
    }

    if (!bestCmd || highestScore < 30) {
        return { match: null, params: {}, score: 0 };
    }

    const params = extractDesignParams(bestCmd, clauseText);
    return { match: bestCmd, params, score: highestScore };
}

/**
 * Executes a compound or single design command against live Design Studio context.
 * Supports multi-clause prompts like "Make the hand larger, push type left".
 *
 * @param {string} promptText
 * @param {object} ctx
 * @returns {{ success: boolean, message: string, results: object[] }}
 */
export function executeDesignCommand(promptText, ctx) {
    if (!promptText || !promptText.trim()) {
        return { success: false, message: 'Empty design command.' };
    }

    const clauses = splitCompoundPrompt(promptText);
    if (clauses.length === 0) {
        clauses.push(promptText.trim());
    }

    const results = [];
    let allSucceeded = true;

    for (const clause of clauses) {
        const { match, params } = resolveDesignCommand(clause);

        if (match) {
            try {
                const res = match.execute(params, ctx);
                results.push({ clause, commandId: match.id, ...res });
                if (!res.success) allSucceeded = false;
            } catch (err) {
                results.push({ clause, commandId: match.id, success: false, message: err.message });
                allSucceeded = false;
            }
        } else {
            // Heuristic fallbacks for clauses
            const s = clause.toLowerCase();
            if (s.includes('left') || s.includes('right') || s.includes('up') || s.includes('down')) {
                const nudgeCmd = DESIGN_COMMANDS.find(c => c.id === 'ds_nudge_layer');
                const p = extractDesignParams(nudgeCmd, clause);
                const res = nudgeCmd.execute(p, ctx);
                results.push({ clause, commandId: nudgeCmd.id, ...res });
            } else if (s.includes('larger') || s.includes('smaller') || s.includes('bigger')) {
                const scaleCmd = DESIGN_COMMANDS.find(c => c.id === 'ds_scale_layer');
                const p = extractDesignParams(scaleCmd, clause);
                const res = scaleCmd.execute(p, ctx);
                results.push({ clause, commandId: scaleCmd.id, ...res });
            } else {
                results.push({
                    clause,
                    success: false,
                    message: `Unrecognized clause: "${clause}".`,
                });
                allSucceeded = false;
            }
        }
    }

    const messages = results.map(r => r.message).join(' · ');
    return {
        success: allSucceeded,
        message: messages || 'Updated canvas layout.',
        results,
    };
}
