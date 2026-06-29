/**
 * useSupabasePersistence.js
 *
 * Subscribes to structural timeline changes and debounces Supabase writes.
 * Intentionally kept SEPARATE from useTimelineStore.js so that importing
 * supabase-js does NOT alter the module-dependency graph of the store.
 * That separation prevents Rollup from reordering chunks in a way that puts
 * a reference to `useTimelineStore` before its `const` declaration (TDZ).
 *
 * Mount once inside IDELayout (or any component that is always present in the
 * editor view) with:
 *
 *   useSupabasePersistence();
 */

import { useEffect, useRef } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { supabase } from '../lib/supabaseClient.js';
import { createProject, updateProject } from '../lib/projectsApi.js';

const DEBOUNCE_MS = 3000; // write to Supabase 3 s after last localStorage save

async function _supabaseSave(projectData, projectId, projectName, onNewProject) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return; // anonymous — localStorage only

        if (!projectId) {
            const newId = await createProject(projectName || 'Untitled Project', projectData);
            if (newId) onNewProject(newId);
        } else {
            await updateProject(projectId, projectData);
        }
    } catch (e) {
        console.warn('[useSupabasePersistence] Supabase autosave failed:', e.message);
    }
}

export function useSupabasePersistence() {
    const timerRef = useRef(null);

    useEffect(() => {
        // Subscribe to structural timeline changes (same events that trigger saveProject)
        // We watch `tracks` because it changes on every structural edit.
        // Using subscribeWithSelector to avoid firing on playback-only updates.
        const unsub = useTimelineStore.subscribe(
            (state) => state.tracks,
            () => {
                // Grab the latest project data from localStorage (saveProject already wrote it)
                let projectData = null;
                try {
                    const raw = localStorage.getItem('vp_autosave');
                    if (raw) projectData = JSON.parse(raw);
                } catch (_) {}

                if (!projectData) return;

                clearTimeout(timerRef.current);
                timerRef.current = setTimeout(() => {
                    const { projectId, projectName, setProjectId } = useTimelineStore.getState();
                    _supabaseSave(projectData, projectId, projectName, (newId) => {
                        setProjectId(newId);
                    });
                }, DEBOUNCE_MS);
            }
        );

        return () => {
            unsub();
            clearTimeout(timerRef.current);
        };
    }, []);
}
