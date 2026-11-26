/**
 * designOperations.js — apply the Design Studio AI's operations safely (R170).
 *
 * The copilot used to spread whatever the model returned straight onto the
 * canvas: unknown types, any field, unbounded numbers. This is the gate
 * between the model and the layers. Every operation is checked; what cannot be
 * applied is counted and reported, never silently dropped (R30).
 *
 * Pure: no React, no network. Layers are back to front; the background is the
 * layer of type 'bg' (the canvas paints it separately).
 */
import { sanitizeLayerPatch, isSafeFill } from './designVariations.js';

export const CREATABLE_TYPES = new Set(['rect', 'ellipse', 'star', 'line', 'badge', 'text', 'image']);
export const MAX_LAYERS = 80;

let seq = 0;
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

/** Compact catalog for the prompt: id, name, category and the text slots. */
export function buildComponentCatalog(components) {
    return (Array.isArray(components) ? components : []).map(c => ({
        id: c.id,
        name: c.name,
        category: c.category,
        size: [c.w, c.h],
        slots: (c.layers || []).filter(l => l.type === 'text').map(l => l.id),
    }));
}

/** Whether a prompt asks for a whole design rather than one change. */
export function isBuildRequest(prompt) {
    const s = String(prompt || '').toLowerCase().trim();
    const words = s.split(/\s+/).filter(Boolean).length;
    const creates = /^(please\s+)?(create|design|make|build|generate|draft|compose|produce|cr[ée]e|cr[ée]er|fais|faire|g[ée]n[èe]re|g[ée]n[ée]rer|con[çc]ois|r[ée]alise)\b/.test(s);
    const wholeThing = /\b(thumbnail|miniature|poster|affiche|cover|couverture|banner|banni[èe]re|ad\b|pub\b|publicit|post\b|visual|visuel|design|layout|flyer|card|carte|story)\b/.test(s);
    return (creates && wholeThing) || words >= 25;
}

function placeComponent(op, components, format) {
    const cmp = components.find(c => c.id === op.componentId);
    if (!cmp) return null;
    const scale = Math.min(6, Math.max(0.2, Number(op.scale) || 1));
    const ox = Number.isFinite(Number(op.x)) ? Number(op.x) : Math.round(((Number(format?.w) || 1280) - (cmp.w || 0) * scale) / 2);
    const oy = Number.isFinite(Number(op.y)) ? Number(op.y) : Math.round(((Number(format?.h) || 720) - (cmp.h || 0) * scale) / 2);
    const instance = newId(cmp.id);
    const texts = op.text && typeof op.text === 'object' ? op.text : {};
    return (cmp.layers || []).map(child => {
        const l = {
            ...child,
            id: `${instance}_${child.id}`,
            groupId: instance,
            x: Math.round(ox + (Number(child.x) || 0) * scale),
            y: Math.round(oy + (Number(child.y) || 0) * scale),
            w: Math.round((Number(child.w) || 0) * scale),
            h: Math.round((Number(child.h) || 0) * scale),
            visible: true,
            locked: false,
        };
        if (child.fontSize) l.fontSize = Math.round(child.fontSize * scale);
        if (child.type === 'text' && typeof texts[child.id] === 'string' && texts[child.id].trim()) l.text = texts[child.id].slice(0, 400);
        return l;
    });
}

/**
 * @param {Array} layers     current layers
 * @param {Array} operations the model's operations
 * @param {{ components?: Array, media?: Array, format?: {w,h}, mode?: 'edit'|'build' }} ctx
 * @returns {{ layers: Array, applied: number, skipped: Array<string>, selectIds: Array<string> }}
 */
export function applyDesignOperations(layers, operations, { components = [], media = [], format = {}, mode = 'edit' } = {}) {
    let next = (Array.isArray(layers) ? layers : []).map(l => ({ ...l }));
    const skipped = [];
    const selectIds = [];
    let applied = 0;
    const ops = Array.isArray(operations) ? operations.slice(0, 60) : [];

    // A build replaces the canvas content, keeping the user's background only if
    // the model does not set a new one and leaving their uploads in Media.
    if (mode === 'build' && ops.some(o => o?.op === 'add_layer' || o?.op === 'add_component')) {
        next = next.filter(l => l.type === 'bg');
    }

    for (const op of ops) {
        const kind = op?.op;
        if (kind === 'set_background') {
            if (!isSafeFill(op.fill)) { skipped.push('background colour it could not use'); continue; }
            const bg = next.find(l => l.type === 'bg');
            if (bg) next = next.map(l => (l === bg ? { ...l, fill: op.fill.trim() } : l));
            else next = [{ id: 'background', name: 'Background', type: 'bg', fill: op.fill.trim(), visible: true, locked: false }, ...next];
            applied++;
        } else if (kind === 'add_layer') {
            const src = op.layer || {};
            if (!CREATABLE_TYPES.has(src.type)) { skipped.push(`a "${src.type || 'unknown'}" layer`); continue; }
            if (next.length >= MAX_LAYERS) { skipped.push('layers beyond the 80-layer limit'); continue; }
            const layer = { id: newId(src.type), name: String(src.name || src.type).slice(0, 60), type: src.type, visible: true, locked: false, ...sanitizeLayerPatch(src) };
            if (src.type === 'image') {
                const asset = media.find(m => m.id === src.mediaId);
                if (!asset?.url) { skipped.push('an image that is not in your media'); continue; }
                layer.src = asset.url;
                layer.name = layer.name === 'image' ? (asset.name || 'Image') : layer.name;
            }
            if (!Number.isFinite(layer.w) || !Number.isFinite(layer.h)) { layer.w = layer.w || 300; layer.h = layer.h || (src.type === 'text' ? 80 : 200); }
            if (!Number.isFinite(layer.x)) layer.x = 48;
            if (!Number.isFinite(layer.y)) layer.y = 48;
            next = [...next, layer];
            selectIds.push(layer.id);
            applied++;
        } else if (kind === 'add_component') {
            const placed = placeComponent(op, components, format);
            if (!placed) { skipped.push(`a component that does not exist ("${op.componentId}")`); continue; }
            if (next.length + placed.length > MAX_LAYERS) { skipped.push('a component beyond the 80-layer limit'); continue; }
            next = [...next, ...placed];
            selectIds.push(...placed.map(l => l.id));
            applied++;
        } else if (kind === 'update_layer') {
            const id = op.layerId || op.layer?.id;
            const target = next.find(l => l.id === id);
            if (!target) { skipped.push('a change to a layer that is not on the canvas'); continue; }
            const patch = sanitizeLayerPatch(op.patch || op.layer || {});
            if (Object.keys(patch).length === 0) { skipped.push(`a change to "${target.name || id}" with nothing usable`); continue; }
            next = next.map(l => (l.id === id ? { ...l, ...patch } : l));
            applied++;
        } else if (kind === 'delete_layer') {
            const id = op.layerId || op.layer?.id;
            if (!next.some(l => l.id === id)) { skipped.push('removing a layer that is not on the canvas'); continue; }
            next = next.filter(l => l.id !== id);
            applied++;
        } else {
            skipped.push(`an unknown operation ("${kind}")`);
        }
    }
    return { layers: next, applied, skipped, selectIds };
}
