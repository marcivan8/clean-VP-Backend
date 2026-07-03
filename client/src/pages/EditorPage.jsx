import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';
import { getProject } from '../lib/projectsApi.js';

const EditorPage = () => {
    const { projectId } = useParams();

    useEffect(() => {
        if (!projectId) return;

        // If the store already holds this project (e.g. just created from dashboard),
        // skip the Supabase fetch to avoid overwriting unsaved local state.
        const storeId = useTimelineStore.getState().projectId;
        if (storeId === projectId) return;

        // Load the project from Supabase and restore it into the store.
        getProject(projectId).then(project => {
            if (!project) {
                console.warn('[EditorPage] Project not found:', projectId);
                return;
            }
            const state = useTimelineStore.getState();
            state.loadProject(project.timeline_state || {});
            state.setProjectId(project.id);
            state.setProjectName(project.name || 'Untitled Project');
            try {
                localStorage.setItem('vp_autosave', JSON.stringify(project.timeline_state || {}));
                localStorage.setItem('vp_project_id', project.id);
                localStorage.setItem('vp_project_name', project.name || 'Untitled Project');
            } catch (_) {}
            console.log('[EditorPage] Loaded project from Supabase:', project.id);
        }).catch(err => {
            console.error('[EditorPage] Failed to load project:', err.message);
        });
    }, [projectId]);

    return <IDELayout mode="editor" />;
};

export default EditorPage;
