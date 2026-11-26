/**
 * designProjects.js — Design Studio projects saved in the user's account (R170).
 *
 * A design is an ordinary row of `projects`, marked by
 * `timeline_state.kind === 'design'` with the studio state under
 * `timeline_state.design`. No schema change: the dashboard reads the marker
 * through `kind:timeline_state->>kind` without loading the whole design.
 *
 * THE GUARD THAT MATTERS: the studio used to open on the last VIDEO project's
 * id when it had none of its own, and its autosave wrote
 * `{ metadata: { design_studio } }` as that project's whole timeline_state —
 * silently wiping the user's video edit. saveDesign() therefore refuses to
 * write to any row that is not already a design.
 */
import { supabase } from './supabaseClient.js';

export const DESIGN_KIND = 'design';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isCloudId = (id) => UUID.test(String(id || ''));

const FORMAT_ASPECT = { thumbnail: '16:9', social: '1:1', product: '3:2', packaging: '2:3', ad: '4:5', print: '1:1.41' };
export const aspectForFormat = (formatId) => FORMAT_ASPECT[formatId] || '16:9';

/** The saved shape. Unknown keys are dropped so a stray field cannot grow the row. */
export function designState(payload = {}) {
    return {
        kind: DESIGN_KIND,
        design: {
            layers: Array.isArray(payload.layers) ? payload.layers : [],
            selectedFormat: payload.selectedFormat || 'thumbnail',
            brandKit: payload.brandKit || null,
            briefText: typeof payload.briefText === 'string' ? payload.briefText : '',
            customComponents: Array.isArray(payload.customComponents) ? payload.customComponents : [],
            mediaAssets: Array.isArray(payload.mediaAssets) ? payload.mediaAssets : [],
            updatedAt: Date.now(),
        },
    };
}

export const isDesignState = (state) => state && typeof state === 'object' && state.kind === DESIGN_KIND;

async function currentUserId() {
    const { data: { user } = {} } = await supabase.auth.getUser();
    return user?.id || null;
}

/** @returns {Promise<{ id: string } | { error: string }>} */
export async function createDesignProject(name, payload = {}) {
    const userId = await currentUserId();
    if (!userId) return { error: 'Sign in to create a design.' };
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled design';
    const state = designState(payload);
    const { data, error } = await supabase.from('projects').insert({
        user_id: userId,
        name: clean,
        timeline_state: state,
        aspect_ratio: aspectForFormat(state.design.selectedFormat),
        duration: 0,
    }).select('id').single();
    if (error) {
        console.error('[designProjects] create failed:', error.message);
        return { error: 'The design could not be created. Try again.' };
    }
    return { id: data.id };
}

/**
 * @returns {Promise<{ name: string, design: object } | { error: string, notDesign?: boolean, missing?: boolean }>}
 */
export async function loadDesign(projectId) {
    if (!isCloudId(projectId)) return { error: 'Not a saved design.', missing: true };
    const { data, error } = await supabase.from('projects').select('id, name, timeline_state').eq('id', projectId).maybeSingle();
    if (error) return { error: error.message };
    if (!data) return { error: 'This design was not found.', missing: true };
    if (!isDesignState(data.timeline_state)) return { error: 'This project is a video project, not a design.', notDesign: true };
    return { name: data.name, design: data.timeline_state.design || {} };
}

/**
 * Save the studio state. Refuses (and says so) unless the row is a design:
 * the filter on `timeline_state->>kind` makes the database itself the guard,
 * so a video project can never be overwritten from here, whatever id arrives.
 * @returns {Promise<boolean>}
 */
export async function saveDesign(projectId, payload, name) {
    if (!isCloudId(projectId)) return false;
    const state = designState(payload);
    const updates = {
        timeline_state: state,
        aspect_ratio: aspectForFormat(state.design.selectedFormat),
        updated_at: new Date().toISOString(),
    };
    if (name !== undefined) updates.name = String(name).trim().slice(0, 120) || 'Untitled design';
    const { data, error } = await supabase.from('projects').update(updates)
        .eq('id', projectId).eq('timeline_state->>kind', DESIGN_KIND).select('id');
    if (error) { console.error('[designProjects] save failed:', error.message); return false; }
    // R38: an update that matched no row is not an error, and must not read as saved.
    if (!data || data.length === 0) { console.error('[designProjects] save matched no design row; nothing written'); return false; }
    return true;
}
