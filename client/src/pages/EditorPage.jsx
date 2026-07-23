import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';
import { getProject } from '../lib/projectsApi.js';

console.log('[EditorPage] Component Rendered');

// All 35 caption-editor fonts, injected on-demand rather than blocking the
// landing page. Loaded once per session — browser caches the font files so
// subsequent editor opens have zero latency.
const EDITOR_FONTS_URL =
    'https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Montserrat:wght@300;400;500;600;700;800;900&family=Inter:wght@300;400;500;600;700;800&family=Barlow+Condensed:wght@600;700&family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&family=Lora:wght@400;700&family=Merriweather:ital,wght@0,300;0,400;0,700;1,400&family=DM+Serif+Display&family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400;1,600;1,700&family=DM+Sans:wght@400;500;600&family=Unbounded:wght@700;900&family=Nunito:wght@400;600;700;800&family=Poppins:wght@400;500;600;700&family=Quicksand:wght@400;500;700&family=Josefin+Sans:wght@400;700&family=Raleway:wght@400;500;700&family=Rajdhani:wght@500;600;700&family=Exo+2:wght@600;700;800&family=Orbitron:wght@700;900&family=Oxanium:wght@600;700&family=Roboto+Condensed:wght@400;700&family=Oswald:wght@400;500;600;700&family=Teko:wght@500;600;700&family=Black+Han+Sans&family=Saira+Condensed:wght@700;800&family=Cabin:wght@600;700&family=Caveat:wght@400;600;700&family=Pacifico&family=Kalam:wght@400;700&family=Satisfy&family=Dancing+Script:wght@400;700&family=Boogaloo&family=Righteous&family=Press+Start+2P&family=Audiowide&family=Outfit:wght@300;400;500;600;700;800&family=Roboto:wght@300;400;500;700&family=Lato:wght@300;400;700&display=swap';

function injectEditorFonts() {
    if (document.getElementById('vibed-editor-fonts')) return; // already injected
    const pc1 = document.createElement('link');
    pc1.rel = 'preconnect';
    pc1.href = 'https://fonts.googleapis.com';
    pc1.id = 'vibed-fonts-pc1';

    const pc2 = document.createElement('link');
    pc2.rel = 'preconnect';
    pc2.href = 'https://fonts.gstatic.com';
    pc2.crossOrigin = 'anonymous';
    pc2.id = 'vibed-fonts-pc2';

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = EDITOR_FONTS_URL;
    link.id = 'vibed-editor-fonts';

    document.head.appendChild(pc1);
    document.head.appendChild(pc2);
    document.head.appendChild(link);
}

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

    // Inject caption-editor Google Fonts on first mount.
    // Fonts are not in index.html because they're not needed on the landing page.
    useEffect(() => {
        injectEditorFonts();
    }, []);

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
