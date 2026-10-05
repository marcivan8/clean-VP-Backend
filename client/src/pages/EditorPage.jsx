import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import IDELayout from '../layouts/IDELayout';
import useTimelineStore from '../store/useTimelineStore';
import { getProject } from '../lib/projectsApi.js';
import { ensureMediaSession } from '../utils/mediaSession.js';

console.log('[EditorPage] Component Rendered');

// All caption-editor fonts, served by Bunny Fonts (EU, no visitor logging)
// instead of Google Fonts, so opening the editor does not send the visitor's
// IP address to Google. Injected on-demand rather than blocking the
// landing page. Loaded once per session — browser caches the font files so
// subsequent editor opens have zero latency.
const EDITOR_FONTS_URL =
    'https://fonts.bunny.net/css?family=anton:400|bebas-neue:400|montserrat:300,400,500,600,700,800,900|inter:300,400,500,600,700,800|barlow-condensed:600,700|playfair-display:400,700,400i,700i|lora:400,700|merriweather:300,400,700,400i|dm-serif-display:400|cormorant-garamond:400,600,700,400i,600i,700i|dm-sans:400,500,600|unbounded:700,900|nunito:400,600,700,800|poppins:400,500,600,700|quicksand:400,500,700|josefin-sans:400,700|raleway:400,500,700|rajdhani:500,600,700|exo-2:600,700,800|orbitron:700,900|oxanium:600,700|roboto-condensed:400,700|oswald:400,500,600,700|teko:500,600,700|black-han-sans:400|saira-condensed:700,800|cabin:600,700|caveat:400,600,700|pacifico:400|kalam:400,700|satisfy:400|dancing-script:400,700|boogaloo:400|righteous:400|press-start-2p:400|audiowide:400|outfit:300,400,500,600,700,800|roboto:300,400,500,700|lato:300,400,700&display=swap';

function injectEditorFonts() {
    if (document.getElementById('vibed-editor-fonts')) return; // already injected
    const pc1 = document.createElement('link');
    pc1.rel = 'preconnect';
    pc1.href = 'https://fonts.bunny.net';
    pc1.crossOrigin = 'anonymous';
    pc1.id = 'vibed-fonts-pc1';

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = EDITOR_FONTS_URL;
    link.id = 'vibed-editor-fonts';

    document.head.appendChild(pc1);
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
                // Media cookie first: the project's videos are owner-only.
                const [project] = await Promise.all([getProject(projectId), ensureMediaSession()]);

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
