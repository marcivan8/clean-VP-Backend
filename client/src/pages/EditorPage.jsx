import React, { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';
import { getProject } from '../lib/projectsApi.js';

const EditorPage = () => {
    const { projectId } = useParams();
    const thumbTriggeredRef = useRef(false);

    useEffect(() => {
        if (!projectId) return;
        thumbTriggeredRef.current = false; // reset on project change

        const storeId = useTimelineStore.getState().projectId;

        const afterLoad = (project) => {
            // If no thumbnail yet and there are video clips, capture one after
            // the store has settled (assets + proxyUrls are in place).
            if (!project.thumbnail_url && !thumbTriggeredRef.current) {
                const state = project.timeline_state || {};
                const hasVideoClip = (state.tracks || []).some(
                    t => t.type === 'video' && t.clips?.length > 0
                );
                const hasProxyUrl = (state.assets || []).some(a => a.proxyUrl);

                if (hasVideoClip && hasProxyUrl) {
                    thumbTriggeredRef.current = true;
                    setTimeout(async () => {
                        try {
                            const { captureProjectThumbnail } = await import(
                                '../utils/captureProjectThumbnail.js'
                            );
                            const { tracks, assets } = useTimelineStore.getState();
                            await captureProjectThumbnail(project.id, tracks, assets);
                        } catch (err) {
                            console.warn('[EditorPage] Thumbnail capture failed:', err.message);
                        }
                    }, 4000); // give the store + player time to settle
                }
            }
        };

        if (storeId === projectId) {
            // Store already has this project — check thumbnail without reloading
            getProject(projectId).then(project => {
                if (project) afterLoad(project);
            }).catch(() => {});
            return;
        }

        // Different project — load from Supabase and restore into the store
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
            console.log('[EditorPage] Loaded project:', project.id);
            afterLoad(project);
        }).catch(err => {
            console.error('[EditorPage] Failed to load project:', err.message);
        });
    }, [projectId]);

    return <IDELayout mode="editor" />;
};

export default EditorPage;
