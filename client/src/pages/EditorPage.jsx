/**
 * EditorPage.jsx
 *
 * Handles two routes:
 *   /editor              — anonymous / legacy (no Supabase load)
 *   /editor/:projectId   — authenticated, loads project from Supabase on mount
 */

import React, { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';
import { getProject } from '../lib/projectsApi.js';

const EditorPage = () => {
    const { projectId } = useParams();   // undefined on /editor
    const navigate      = useNavigate();
    const loaded        = useRef(false);

    const { loadProject, setProjectId, setProjectName } = useTimelineStore();

    useEffect(() => {
        // If there's no projectId in the URL we're in anonymous/legacy mode — nothing to load.
        if (!projectId || loaded.current) return;
        loaded.current = true;

        (async () => {
            const project = await getProject(projectId);
            if (!project) {
                // Project not found (deleted, wrong ID, wrong user) — go to dashboard
                console.warn('[EditorPage] Project not found:', projectId);
                navigate('/dashboard', { replace: true });
                return;
            }

            // Hydrate the timeline store from the Supabase row
            loadProject(project.timeline_state ?? {});
            setProjectId(project.id);
            setProjectName(project.name);

            // Keep localStorage in sync so the pre-restore block on the next
            // cold load also has fresh data (avoids a flash of empty timeline).
            try {
                localStorage.setItem('vp_autosave', JSON.stringify({
                    ...(project.timeline_state ?? {}),
                    timestamp: Date.now(),
                }));
                localStorage.setItem('vp_project_id', project.id);
            } catch (_) {}

            console.log('[EditorPage] Loaded project:', project.name, project.id);
        })();
    }, [projectId, loadProject, setProjectId, setProjectName, navigate]);

    return <IDELayout mode="editor" projectId={projectId} />;
};

export default EditorPage;
