/**
 * useSupabasePersistence.js
 *
 * Subscribes to structural timeline changes and debounces Supabase writes.
 * Intentionally kept SEPARATE from useTimelineStore.js so that importing
 * supabase-js does NOT alter the module-dependency graph of the store.
 * That separation prevents Rollup from reordering chunks in a way that puts
 * a reference to `useTimelineStore` before its `const` declaration (TDZ).
 *
 * Also handles one-shot project thumbnail capture: after the first autosave
 * that includes video clips, a thumbnail is captured from the first frame
 * and stored in Supabase + GCS/local.
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

const DEBOUNCE_MS    = 3000; // write to Supabase 3 s after last localStorage save
const THUMB_DELAY_MS = 2000; // wait before attempting thumbnail (let proxy URLs settle)

async function _supabaseSave(projectData, projectId, projectName, onNewProject) {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return null; // anonymous — localStorage only

        if (!projectId) {
            const newId = await createProject(projectName || 'Untitled Project', projectData);
            if (newId) onNewProject(newId);
            return newId;
        } else {
            await updateProject(projectId, projectData);
            return projectId;
        }
    } catch (e) {
        console.warn('[useSupabasePersistence] Supabase autosave failed:', e.message);
        return null;
    }
}

export function useSupabasePersistence() {
    const timerRef         = useRef(null);
    const thumbTimerRef    = useRef(null);
    const thumbnailDoneRef = useRef(false); // captures at most once per editor session

    useEffect(() => {
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
                timerRef.current = setTimeout(async () => {
                    const { projectId, projectName, setProjectId } = useTimelineStore.getState();
                    const savedId = await _supabaseSave(projectData, projectId, projectName, (newId) => {
                        setProjectId(newId);
                    });

                    // ── Thumbnail capture (one-shot) ──────────────────────────────
                    // Trigger after the first successful save that has video clips.
                    if (!thumbnailDoneRef.current && savedId) {
                        const { tracks, assets } = useTimelineStore.getState();
                        const hasVideoClips = tracks.some(
                            t => t.type === 'video' && t.clips?.length > 0
                        );
                        if (hasVideoClips) {
                            thumbnailDoneRef.current = true; // lock immediately to prevent re-entry
                            clearTimeout(thumbTimerRef.current);
                            thumbTimerRef.current = setTimeout(async () => {
                                try {
                                    const { captureProjectThumbnail } = await import(
                                        '../utils/captureProjectThumbnail.js'
                                    );
                                    const { tracks: t, assets: a } = useTimelineStore.getState();
                                    await captureProjectThumbnail(savedId, t, a);
                                } catch (err) {
                                    console.warn('[useSupabasePersistence] Thumbnail capture failed:', err.message);
                                    thumbnailDoneRef.current = false; // allow retry next save
                                }
                            }, THUMB_DELAY_MS);
                        }
                    }
                }, DEBOUNCE_MS);
            }
        );

        return () => {
            unsub();
            clearTimeout(timerRef.current);
            clearTimeout(thumbTimerRef.current);
        };
    }, []);
}
