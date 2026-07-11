import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';
import { getProject } from '../lib/projectsApi.js';

console.log('[EditorPage] Component Rendered');

/**
 * EditorPage
 *
 * Handles two routes:
 *   /editor            — fresh start (no project loaded from cloud)
 *   /editor/:projectId — load a saved project from Supabase on mount
 *
 * Project loading is intentionally done here, not inside IDELayout, so that
 * the store is fully hydrated before the timeline renders.
 */
const EditorPage = () => {
    const { projectId } = useParams();
    const navigate = useNavigate();
    const { loadProject, setProjectId, setProjectName } = useTimelineStore();

    // Show a loading screen while the cloud project hydrates
    const [cloudLoading, setCloudLoading] = useState(!!projectId);
    const loadedRef = useRef(null); // guard against double-load in React StrictMode

    useEffect(() => {
        if (!projectId) return; // no ID → fresh editor, nothing to load
        if (loadedRef.current === projectId) return;
        loadedRef.current = projectId;

        async function fetchAndHydrate() {
            setCloudLoading(true);
            try {
                const project = await getProject(projectId);

                if (!project) {
                    // Not found or access denied — bounce back to dashboard
                    console.warn('[EditorPage] Project not found, redirecting to dashboard');
                    navigate('/dashboard', { replace: true });
                    return;
                }

                // Hydrate timeline store
                loadProject(project.timeline_state ?? {});
                setProjectId(project.id);
                setProjectName(project.name);

                // Mirror into localStorage so the autosave hook reads the right state
                try {
                    localStorage.setItem('vp_autosave', JSON.stringify(project.timeline_state ?? {}));
                    localStorage.setItem('vp_project_id', project.id);
                } catch (_) { /* quota full — skip */ }

                console.log(`[EditorPage] Loaded project "${project.name}" (${project.id})`);

                // If no thumbnail yet, capture one after the store settles
                if (!project.thumbnail_url) {
                    const state = project.timeline_state || {};
                    const hasVideoClip = (state.tracks || []).some(
                        t => t.type === 'video' && t.clips?.length > 0
                    );
                    const hasProxyUrl = (state.assets || []).some(a => a.proxyUrl);

                    if (hasVideoClip && hasProxyUrl) {
                        setTimeout(async () => {
                            try {
                                const { captureProjectThumbnail } = await import('../utils/captureProjectThumbnail.js');
                                const { tracks, assets } = useTimelineStore.getState();
                                await captureProjectThumbnail(project.id, tracks, assets);
                            } catch (err) {
                                console.warn('[EditorPage] Thumbnail capture failed:', err.message);
                            }
                        }, 4000); // give the store + player time to settle
                    }
                }
            } catch (err) {
                console.error('[EditorPage] Failed to load project:', err.message);
                navigate('/dashboard', { replace: true });
            } finally {
                setCloudLoading(false);
            }
        }

        fetchAndHydrate();
    }, [projectId, loadProject, setProjectId, setProjectName, navigate]);

    if (cloudLoading) {
        return (
            <div style={{
                position: 'fixed', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: '#0A0A0B',
                flexDirection: 'column',
                gap: 16,
            }}>
                {/* Subtle aurora */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                    <div style={{
                        position: 'absolute', width: '46vmax', height: '46vmax', borderRadius: '50%',
                        background: '#00E5FF', top: '-16vmax', left: '-8vmax',
                        filter: 'blur(120px)', opacity: 0.18,
                    }} />
                    <div style={{
                        position: 'absolute', width: '46vmax', height: '46vmax', borderRadius: '50%',
                        background: '#8A2BE2', bottom: '-18vmax', right: '-10vmax',
                        filter: 'blur(120px)', opacity: 0.14,
                    }} />
                </div>

                <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: '2px solid rgba(255,255,255,0.08)',
                    borderTop: '2px solid #00E5FF',
                    animation: 'vb-spin 0.8s linear infinite',
                    position: 'relative', zIndex: 1,
                }} />
                <span style={{
                    fontFamily: '"JetBrains Mono", monospace',
                    fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: 'rgba(255,255,255,0.45)',
                    position: 'relative', zIndex: 1,
                }}>
                    Opening project…
                </span>
                <style>{`@keyframes vb-spin { to { transform: rotate(360deg); } }`}</style>
            </div>
        );
    }

    return <IDELayout mode="editor" />;
};

export default EditorPage;
