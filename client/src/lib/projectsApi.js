/**
 * projectsApi.js
 *
 * CRUD helpers for the `projects` Supabase table.
 * All functions require the user to be authenticated (RLS enforced server-side).
 * Anonymous users are not blocked from calling these, but Supabase will return
 * an empty result set / RLS error, which every function handles gracefully.
 */

import { supabase } from './supabaseClient.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Returns null if not signed in, otherwise the UUID of the current user. */
async function currentUserId() {
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

/**
 * Build the slim metadata object stored alongside the full timeline_state.
 * Extracted so it is consistent between create and update calls.
 */
function buildMeta(projectData) {
    return {
        aspect_ratio:   projectData.aspectRatio  ?? '16:9',
        duration:       projectData.duration      ?? 0,
    };
}

// ─── exported API ─────────────────────────────────────────────────────────────

/**
 * Create a new project row and return the generated project ID.
 *
 * @param {string} name         Display name shown on the dashboard
 * @param {object} projectData  Full autosave payload (from saveProject())
 * @returns {Promise<string|null>}  The new project's UUID, or null on failure
 */
export async function createProject(name, projectData) {
    const userId = await currentUserId();
    if (!userId) return null;

    const { data, error } = await supabase
        .from('projects')
        .insert({
            user_id:        userId,
            name:           name || 'Untitled Project',
            timeline_state: projectData ?? {},
            ...buildMeta(projectData ?? {}),
        })
        .select('id')
        .single();

    if (error) {
        console.error('[projectsApi] createProject failed:', error.message);
        return null;
    }
    return data.id;
}

/**
 * Fetch a single project row (including the full timeline_state).
 *
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
export async function getProject(projectId) {
    const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

    if (error) {
        console.error('[projectsApi] getProject failed:', error.message);
        return null;
    }
    return data;
}

/**
 * List all projects belonging to the current user, newest first.
 * Returns an array of lightweight rows (no timeline_state) for the dashboard.
 *
 * @returns {Promise<object[]>}
 */
export async function listProjects() {
    const { data, error } = await supabase
        .from('projects')
        .select('id, name, thumbnail_url, aspect_ratio, duration, created_at, updated_at')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('[projectsApi] listProjects failed:', error.message);
        return [];
    }
    return data ?? [];
}

/**
 * Persist changes to an existing project.
 * Called by the autosave hook — safe to call frequently (deduplicated by a
 * debounce timer in useTimelineStore before this function is ever reached).
 *
 * @param {string} projectId
 * @param {object} projectData  Full autosave payload (from saveProject())
 * @param {string} [name]       Optional renamed title
 * @param {string} [thumbnailUrl]
 * @returns {Promise<boolean>}  true on success
 */
export async function updateProject(projectId, projectData, name, thumbnailUrl) {
    const updates = {
        timeline_state: projectData,
        updated_at:     new Date().toISOString(),
        ...buildMeta(projectData),
    };
    if (name           !== undefined) updates.name          = name;
    if (thumbnailUrl   !== undefined) updates.thumbnail_url = thumbnailUrl;

    const { error } = await supabase
        .from('projects')
        .update(updates)
        .eq('id', projectId);

    if (error) {
        console.error('[projectsApi] updateProject failed:', error.message);
        return false;
    }
    return true;
}

/**
 * Rename a project (dashboard 3-dot menu).
 *
 * @param {string} projectId
 * @param {string} newName
 * @returns {Promise<boolean>}
 */
export async function renameProject(projectId, newName) {
    const { error } = await supabase
        .from('projects')
        .update({ name: newName })
        .eq('id', projectId);

    if (error) {
        console.error('[projectsApi] renameProject failed:', error.message);
        return false;
    }
    return true;
}

/**
 * Permanently delete a project.
 *
 * @param {string} projectId
 * @returns {Promise<boolean>}
 */
export async function deleteProject(projectId) {
    const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', projectId);

    if (error) {
        console.error('[projectsApi] deleteProject failed:', error.message);
        return false;
    }
    return true;
}

/**
 * Duplicate an existing project under a new name.
 *
 * @param {string} projectId
 * @param {string} [newName]
 * @returns {Promise<string|null>}  New project ID or null on failure
 */
export async function duplicateProject(projectId, newName) {
    const original = await getProject(projectId);
    if (!original) return null;
    return createProject(
        newName ?? `${original.name} (Copy)`,
        original.timeline_state,
    );
}
