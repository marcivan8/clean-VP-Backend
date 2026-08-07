import { useShallow } from 'zustand/react/shallow';
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Video, Play, Pause, Layers, Settings, Share, Menu, Upload, Palette, Move, X, ChevronLeft, ChevronRight } from 'lucide-react';
import classNames from 'classnames';
import { Player } from '@revideo/player-react';
import project from '../revideo/project';
import SettingsPanel from '../components/SettingsPanel';
import useTimelineStore from '../store/useTimelineStore';
import { transcriptionManager } from '../agent/TranscriptionManager';
import ErrorBoundary from '../components/ErrorBoundary';
import Timeline from '../components/Timeline/Timeline';
import ReasoningPanel from '../components/Assistant/ReasoningPanel';
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import DraggableAsset from '../components/DraggableAsset';
import TextPanel from '../components/TextPanel';
import TranscriptPanel from '../components/TranscriptPanel';
import TextOverlay from '../components/Player/TextOverlay';
import MobileToolbar from '../components/MobileToolbar';
import MobileAIBar from '../components/MobileAIBar';
import useDeviceType from '../hooks/useDeviceType';
import MixerPanel from '../components/Sidebar/MixerPanel';
import InterviewEditPanel from '../components/InterviewEditPanel';
import AssetPanel from '../components/AssetPanel';
import ExportModal from '../components/ExportModal';
import { Type } from 'lucide-react';
import { ClarificationDialog } from '../components/ClarificationDialog';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { trackEvent } from '../utils/trackEvent';
import { probeMedia } from '../utils/mediaProbe';
import ProxyService from '../services/proxyService';
import useAIStore from '../store/useAIStore';
import useSessionStore from '../store/useSessionStore';
import AuthPromptModal from '../components/AuthPromptModal';
import { useSupabasePersistence } from '../hooks/useSupabasePersistence';

const VideoTimeDisplay = () => {
    const timeRef = useRef(null);
    useEffect(() => {
        let r;
        const update = () => {
            // FIX: Read currentTime from store — same source as the playhead RAF
            const state = useTimelineStore.getState();
            const time = state.currentTime || 0;
            if (timeRef.current) timeRef.current.innerText = time.toFixed(2);
            r = requestAnimationFrame(update);
        };
        r = requestAnimationFrame(update);
        return () => cancelAnimationFrame(r);
    }, []);
    return <span ref={timeRef} className="font-mono text-xs text-primary">0.00</span>;
};

const getPlayerDimensions = (ratio) => {
    switch (ratio) {
        case '9:16': return { width: 1080, height: 1920 };
        case '1:1':  return { width: 1080, height: 1080 };
        case '4:3':  return { width: 1440, height: 1080 };
        case '4:5':  return { width: 1080, height: 1350 };
        case '21:9': return { width: 2560, height: 1080 };
        case '16:9':
        default:     return { width: 1920, height: 1080 };
    }
};

// ── Video type detection + contextual welcome message ─────────────────────────
// Uses resolution, fps, file extension, duration, and filename — in that order
// of reliability. Filename keywords are the weakest signal because most real
// uploads have generic names like IMG_0029.MOV or clip001.mp4.
//
// Returns one of: 'screen_recording' | 'interview_or_call' | 'vertical_social' |
//                 'short_clip' | 'talking_head'
function detectVideoType(filename, resolution, duration, fps) {
    const lower    = (filename || '').toLowerCase();
    const ext      = lower.match(/\.(\w+)$/)?.[1] || '';
    const w        = resolution?.w || 0;
    const h        = resolution?.h || 0;
    const ratio    = h > 0 ? w / h : 16 / 9;
    const isPortrait = ratio < 0.75;           // 9:16 (0.56), 4:5 (0.80) → portrait
    const isSquare   = ratio >= 0.9 && ratio <= 1.15; // ~1:1

    // ── 1. File extension (very reliable) ────────────────────────────────────
    // .webm = browser-captured (screen share, video call, Loom)
    // .mkv  = OBS default output
    if (ext === 'webm' || ext === 'mkv') return 'screen_recording';

    // ── 2. Aspect ratio (reliable — camera orientation is intentional) ────────
    if (isPortrait || isSquare) return 'vertical_social';

    // ── 3. Resolution × framerate (reliable for screen recordings) ───────────
    // Monitors ship in a fixed set of widths; phones do too but in portrait.
    // 60 fps at a standard monitor width = almost certainly a screen capture.
    const monitorWidths = new Set([1280, 1366, 1440, 1600, 1920, 2560, 3440, 3840]);
    if (fps >= 50 && monitorWidths.has(w)) return 'screen_recording';

    // ── 4. Filename keywords (weakest — many uploads have generic names) ──────
    if (/\b(screen|screencast|capture|loom|obs|desktop|walkthrough|tutorial|demo|howto|how[-_]?to)\b/.test(lower)) {
        return 'screen_recording';
    }
    if (/\b(zoom|meet(?:ing)?|teams|webex|podcast|interview|conversation|call|webinar|session)\b/.test(lower)) {
        return 'interview_or_call';
    }
    if (/\b(reel|tiktok|short|vertical|portrait|story|ig|instagram)\b/.test(lower)) {
        return 'vertical_social';
    }

    // ── 5. Duration ───────────────────────────────────────────────────────────
    // NOTE: duration alone cannot distinguish a long YouTube talking head from
    // a podcast — both can be 20+ minutes of 16:9 footage. Only use it to
    // catch very short clips; everything else defaults to talking_head.
    if (duration < 30) return 'short_clip';

    return 'talking_head'; // safe default: single-person on-camera
}

// buildProxyReadyMessage() used to build a hardcoded "here's what I can do"
// greeting posted as its own ROKA chat bubble on upload. Removed — it was a
// second, independent voice competing with BrainPanel's asset_added analysis
// (see ReasoningPanel.jsx), which reasons over real project state via GPT-4o
// instead of a fixed duration/aspect-ratio heuristic. ROKA now speaks once,
// through the Brain. detectVideoType() below is kept only to drive the
// input placeholder hint (CONTEXTUAL_SUGGESTION) — that's a passive UI
// affordance, not a competing answer.

const CONTEXTUAL_SUGGESTION = {
    screen_recording:  'add captions',
    interview_or_call: 'split speakers',
    vertical_social:   'make it more dynamic',
    short_clip:        'make it more dynamic',
    talking_head:      'make it more dynamic',
};

const IDELayout = ({ children, mode = 'editor' }) => {
    const { t } = useTranslation('editor');

    // Keeps Supabase in sync with localStorage autosaves (debounced 3 s after each change).
    // Without this call the hook was defined but never mounted — Supabase never updated.
    useSupabasePersistence();

    // ── beforeunload guard ────────────────────────────────────────────────────
    // Warn the user before closing/refreshing the tab while AI is processing
    // or a video proxy is still uploading. Uses a ref so the handler always
    // reads the latest value without needing to be re-registered.
    useEffect(() => {
        const isBusyRef = { current: false };

        const checkBusy = () => {
            const aiAnalyzing = useAIStore.getState().isAnalyzing;
            const anyProxying = useTimelineStore.getState().assets?.some(
                a => a.isProxying || (a.uploadPhase && a.uploadPhase !== 'ready')
            ) ?? false;
            isBusyRef.current = aiAnalyzing || anyProxying;
        };

        const handleBeforeUnload = (e) => {
            checkBusy();
            if (!isBusyRef.current) return;
            e.preventDefault();
            e.returnValue = ''; // required for Chrome to show the dialog
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        // Keep isBusyRef in sync by subscribing to both stores
        const unsubAI       = useAIStore.subscribe(checkBusy);
        const unsubTimeline = useTimelineStore.subscribe(
            s => s.assets,
            checkBusy,
        );

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            unsubAI();
            unsubTimeline();
        };
    }, []);

    // ── keyboard shortcuts ────────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Don't intercept shortcuts while typing in an input or textarea
            const tag = document.activeElement?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            if (e.code === 'Space') {
                e.preventDefault();
                useTimelineStore.getState().togglePlay();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    useTimelineStore.getState().redo();
                } else {
                    useTimelineStore.getState().undo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                useTimelineStore.getState().redo();
            } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'c') {
                const { activeClipId } = useTimelineStore.getState();
                if (activeClipId) {
                    e.preventDefault();
                    useTimelineStore.getState().copyClip(activeClipId);
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                useTimelineStore.getState().pasteClip(useTimelineStore.getState().currentTime);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const { isPlaying, setUploadedFile, updateClip, uploadedFile, aspectRatio, assets, addAssets, addClip, zoomLevel, tracks, activeClipId, setActiveClip, past, future, duration, projectName, projectId, setProjectName } = useTimelineStore(useShallow(state => ({
    isPlaying: state.isPlaying,
    setUploadedFile: state.setUploadedFile,
    updateClip: state.updateClip,
    uploadedFile: state.uploadedFile,
    aspectRatio: state.aspectRatio,
    assets: state.assets,
    addAssets: state.addAssets,
    addClip: state.addClip,
    zoomLevel: state.zoomLevel,
    tracks: state.tracks,
    activeClipId: state.activeClipId,
    setActiveClip: state.setActiveClip,
    past: state.past,
    future: state.future,
    duration: state.duration,
    projectName: state.projectName,
    projectId: state.projectId,
    setProjectName: state.setProjectName,
})));

    // ── Inline project rename ──────────────────────────────────────────────────
    const [editingName, setEditingName] = useState(false);
    const [nameInput, setNameInput] = useState('');
    const nameInputRef = useRef(null);

    const startRename = useCallback(() => {
        setNameInput(projectName || t('ideLayout.untitledProject'));
        setEditingName(true);
        setTimeout(() => nameInputRef.current?.select(), 0);
    }, [projectName, t]);

    const commitRename = useCallback(async () => {
        const trimmed = nameInput.trim() || t('ideLayout.untitledProject');
        setEditingName(false);
        if (trimmed === projectName) return;
        setProjectName(trimmed);
        if (projectId) {
            const { renameProject } = await import('../lib/projectsApi.js');
            await renameProject(projectId, trimmed);
        }
    }, [nameInput, projectName, projectId, setProjectName]);

    const { activeClip, activeTrackId, activeTrackType } = React.useMemo(() => {
        if (!activeClipId) return { activeClip: null, activeTrackId: null, activeTrackType: null };
        for (const track of tracks) {
            const clip = track.clips.find(c => c.id === activeClipId);
            if (clip) return { activeClip: clip, activeTrackId: track.id, activeTrackType: track.type };
        }
        return { activeClip: null, activeTrackId: null, activeTrackType: null };
    }, [tracks, activeClipId]);

    // Defer track changes so rapid caption/clip additions coalesce into a
    // single playerVariables update — one playback.reload() instead of N.
    const deferredTracks = React.useDeferredValue(tracks);

    const hasClips = React.useMemo(
        () => deferredTracks.some(t => t.clips?.length > 0),
        [deferredTracks]
    );

    // Convert legacy direct GCS URLs (stored in old autosaves) to go through
    // our server proxy. The proxy has credentials; the browser doesn't.
    const toProxyUrl = React.useCallback((url) => {
        if (!url) return url;
        const GCS = 'https://storage.googleapis.com/';
        if (url.startsWith(GCS)) {
            // strip "https://storage.googleapis.com/<bucket>/" → keep the object path
            const withoutBucket = url.slice(GCS.length).split('/').slice(1).join('/');
            return `/api/proxy/gcs-media/${withoutBucket}`;
        }
        // If the backend returns a relative storage path (e.g., 'proxies/...' or 'raw/...'),
        // we must route it through our proxy endpoint so the browser can fetch it.
        if (url.startsWith('proxies/') || url.startsWith('raw/')) {
            return `/api/proxy/gcs-media/${url}`;
        }
        return url;
    }, []);

    const playerVariables = React.useMemo(() => {
        // Text tracks are rendered exclusively by <TextOverlay />, which also
        // handles interactive drag/resize. Passing them to the Revideo player
        // would cause duplicate captions AND make every text-clip mutation
        // (e.g. scale drag) reload the scene generator, jumping the playhead.
        const nonTextTracks = deferredTracks.filter(t => t.type !== 'text');
        const isAnySolo = deferredTracks.some(tr => tr.solo);

        // Compute duration from non-text (video/audio/image) clips only.
        // If we used the store's `duration` directly, adding a caption that
        // extends the timeline would change playerVariables, trigger
        // playback.reload(), run recalculate(), and hit Revideo's loop-guard
        // which seeks the playhead back to frame 0 while playing. Deriving
        // duration from the clips we actually pass to Revideo prevents this.
        const playerDuration = (() => {
            const clips = nonTextTracks.flatMap(t => t.clips || []);
            if (clips.length === 0) return Math.max(duration, 1);
            const maxEnd = clips.reduce((m, c) => Math.max(m, (c.start || 0) + (c.duration || 0)), 0);
            return Math.max(maxEnd, 1);
        })();

        return {
            tracks: nonTextTracks.map((t, idx) => {
                const shouldMute = t.muted || (isAnySolo && !t.solo);
                const rawVol = t.volume !== undefined ? t.volume : 1;
                const trackVol = shouldMute ? 0 : rawVol;

                return {
                    id: t.id,
                    type: t.type,
                    order: t.order ?? idx,
                    clips: (t.clips || []).map(c => {
                        const sourceAsset = assets.find(a => a.id === c.assetId);
                        // Resolution order:
                        // 1. proxyUrl (server-relative or blob) — already correct format
                        // 2. asset blob URL (in-memory, valid while tab is open)
                        // 3. stored fileUrl / clip url field
                        // All GCS https:// URLs are rewritten to go through /api/proxy/gcs-media
                        const rawUrl = sourceAsset?.proxyUrl
                            || c.proxyUrl
                            || sourceAsset?.url
                            || sourceAsset?.fileUrl
                            || c.url
                            || c.fileUrl;
                        return {
                            ...c,
                            type: t.type || c.type,
                            globalVolume: trackVol,
                            url: toProxyUrl(rawUrl) || ""
                        };
                    })
                };
            }),
            duration: playerDuration,
            aspectRatio: aspectRatio,
            fps: 30,
            // Tell the Revideo scene which origin to prefix /api/ and /uploads/ paths
            // with. Without this the scene defaults to http://127.0.0.1:3000, which
            // points to the user's own machine rather than the deployed backend.
            backendUrl: window.location.origin
        };
    }, [deferredTracks, duration, aspectRatio, assets, toProxyUrl]);

    const handleGradingChange = (key, value) => {
        if (!activeClip || !activeTrackId) return;
        const currentGrading = activeClip.grading || { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 };
        const newGrading = { ...currentGrading, [key]: value };
        const filter = `brightness(${newGrading.brightness}%) contrast(${newGrading.contrast}%) saturate(${newGrading.saturate}%) hue-rotate(${newGrading.hueRotate}deg)`;
        updateClip(activeTrackId, activeClip.id, {
            grading: newGrading,
            filter: filter
        });
    };

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 5 },
        })
    );
    const [showSidebar, setShowSidebar] = React.useState(false);
    const [showAI, setShowAI] = React.useState(false);
    
    const { isMobile } = useDeviceType();
    // null = nothing open; 'media' | 'ai' | 'audio' | 'more' = bottom sheet open
    const [mobileSheet, setMobileSheet] = React.useState(null);

    const fileInputRef = useRef(null);

    // Tab bar horizontal scroll indicators (media/captions/transcript/... row overflows on narrow sidebars)
    const tabBarRef = useRef(null);
    const [tabScroll, setTabScroll] = React.useState({ left: false, right: false });

    const updateTabScrollState = useCallback(() => {
        const el = tabBarRef.current;
        if (!el) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        setTabScroll({
            left:  el.scrollLeft > 2,
            right: el.scrollLeft < maxScroll - 2,
        });
    }, []);

    useEffect(() => {
        updateTabScrollState();
        const el = tabBarRef.current;
        if (!el) return;
        el.addEventListener('scroll', updateTabScrollState, { passive: true });
        window.addEventListener('resize', updateTabScrollState);
        return () => {
            el.removeEventListener('scroll', updateTabScrollState);
            window.removeEventListener('resize', updateTabScrollState);
        };
    }, [updateTabScrollState]);

    const scrollTabBar = useCallback((dir) => {
        const el = tabBarRef.current;
        if (!el) return;
        el.scrollBy({ left: dir * 120, behavior: 'smooth' });
    }, []);

    const [isExporting, setIsExporting] = React.useState(false);
    const [exportUrl, setExportUrl] = React.useState(null);
    const [exportResult, setExportResult] = React.useState(null);
    const [exportError, setExportError] = React.useState(null);
    const [showExportModal, setShowExportModal] = React.useState(false);

    // ── Progressive auth ──────────────────────────────────────────────────
    const { isAnonymous, hoursLeft, getOrCreate, sessionId } = useSessionStore();
    const [authPrompt, setAuthPrompt] = React.useState(null); // null | trigger string
    const authShownRef = React.useRef(false); // only show one prompt per session

    const showAuthPrompt = React.useCallback((trigger) => {
        if (!isAnonymous || authShownRef.current) return;
        authShownRef.current = true;
        setAuthPrompt(trigger);
    }, [isAnonymous]);

    // Ensure a session exists from the moment they open the editor
    useEffect(() => { getOrCreate(); }, [getOrCreate]);

    // Trigger: 20-minute editing timer
    useEffect(() => {
        if (!isAnonymous) return;
        const t = setTimeout(() => showAuthPrompt('timer'), 20 * 60 * 1000);
        return () => clearTimeout(t);
    }, [isAnonymous, showAuthPrompt]);

    // Trigger: exit intent — mouse leaves the top of the viewport
    useEffect(() => {
        if (!isAnonymous) return;
        const handler = (e) => {
            if (e.clientY < 8) showAuthPrompt('exit_intent');
        };
        document.addEventListener('mouseleave', handler);
        return () => document.removeEventListener('mouseleave', handler);
    }, [isAnonymous, showAuthPrompt]);

    // Trigger: first successful AI operation
    useEffect(() => {
        if (!isAnonymous) return;
        return useAIStore.subscribe((state) => {
            const hasSuccess = state.logs.some(l => l.type === 'success');
            if (hasSuccess) showAuthPrompt('ai_success');
        });
    }, [isAnonymous, showAuthPrompt]);

    const activeTab    = useAIStore(s => s.activeTab);
    const setActiveTab = useAIStore(s => s.setActiveTab);

    // Toggle a mobile bottom sheet. 'audio' maps to the media panel with the audio tab pre-selected.
    const handleMobileSheet = useCallback((sheet) => {
        setMobileSheet(prev => {
            if (sheet === 'audio') {
                // Audio always opens the media panel at the audio tab; tapping again closes
                if (prev === 'audio') return null;
                setActiveTab('audio');
                return 'audio';
            }
            if (sheet === 'media') setActiveTab('media');
            return prev === sheet ? null : sheet;
        });
    }, [setActiveTab]);

    // Called when user taps a clip action in the context toolbar.
    // Opens the left panel at the appropriate tab.
    const handleClipAction = useCallback((tabName) => {
        setActiveTab(tabName);
        setMobileSheet('media');
    }, [setActiveTab]);

    // Called when user taps Done in the context toolbar.
    // Closes any open panel and deselects the clip.
    const handleDeselect = useCallback(() => {
        setMobileSheet(null);
        setActiveClip(null);
    }, [setActiveClip]);

    // Called when user taps Delete in the mobile clip context toolbar.
    const handleDeleteClip = useCallback(() => {
        if (activeTrackId && activeClipId) {
            useTimelineStore.getState().removeClip(activeTrackId, activeClipId);
        }
        handleDeselect();
    }, [activeTrackId, activeClipId, handleDeselect]);

    const [activeColorRange, setActiveColorRange] = React.useState('reds');
    const [openMenu, setOpenMenu] = React.useState(null);

    const projectLoaderRef = useRef(null);
    const playerRef = useRef(null);

    const handlePlayerReady = (revideoPlayer) => {
        playerRef.current = revideoPlayer;
        useTimelineStore.getState().setPlayerRef(revideoPlayer);
        console.log("[IDELayout] Revideo Player Ready", revideoPlayer);

        // Safety net: if a variables change slips through and triggers a Revideo reload
        // while playing, the loop-guard in Player.prepare() overrides the saved seek
        // position to frame 0. Subscribe to onRecalculated and, if we were playing at
        // a non-zero position, request a seek back to the correct frame AFTER the
        // loop-guard has run (setTimeout(0) defers past the current prepare() call).
        if (revideoPlayer.onRecalculated?.subscribe) {
            revideoPlayer.onRecalculated.subscribe(() => {
                const { isPlaying, currentTime } = useTimelineStore.getState();
                if (isPlaying && currentTime > 0.1) {
                    const fps = revideoPlayer.playback?.fps ?? 30;
                    setTimeout(() => {
                        // Guard: don't seek if the player has been replaced by a remount
                        if (playerRef.current === revideoPlayer) {
                            revideoPlayer.requestSeek(Math.round(currentTime * fps));
                        }
                    }, 0);
                }
            });
        }
    };

    const handleSelectiveGradingChange = (range, key, value) => {
        if (!activeClip || !activeTrackId) return;
        const currentGrading = activeClip.grading || {};
        const currentSelective = currentGrading.selective || {};
        const newSelective = {
            ...currentSelective,
            [range]: {
                ...(currentSelective[range] || { hue: 0, sat: 0, lum: 0 }),
                [key]: value
            }
        };
        updateClip(activeTrackId, activeClip.id, {
            grading: { ...currentGrading, selective: newSelective }
        });
    };

    const EFFECTS = [
        { id: 'fx-blur', name: 'Blur', icon: '🌫️', filter: 'blur(5px)' },
        { id: 'fx-grayscale', name: 'B&W', icon: '⚫', filter: 'grayscale(100%)' },
        { id: 'fx-sepia', name: 'Sepia', icon: '🟤', filter: 'sepia(100%)' },
        { id: 'fx-invert', name: 'Invert', icon: '🔄', filter: 'invert(100%)' },
        { id: 'fx-brightness', name: 'Bright', icon: '☀️', filter: 'brightness(150%)' },
        { id: 'fx-contrast', name: 'Contrast', icon: '🌓', filter: 'contrast(150%)' },
    ];

    const detectAspectRatio = (width, height) => {
        if (!width || !height) return null;
        const r = width / height;
        const ratios = [
            { label: '9:16', value: 9 / 16 },
            { label: '1:1', value: 1 },
            { label: '4:3', value: 4 / 3 },
            { label: '4:5', value: 4 / 5 },
            { label: '21:9', value: 21 / 9 },
            { label: '16:9', value: 16 / 9 },
        ];
        let closest = '16:9', minDiff = Infinity;
        ratios.forEach(({ label, value }) => {
            const diff = Math.abs(r - value);
            if (diff < minDiff) { minDiff = diff; closest = label; }
        });
        return closest;
    };

    const handleFileImport = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            console.log("📂 Files Selected:", files.length);

            const processedAssets = [];
            // Always detect aspect ratio from the first video in this batch.
            // Using hasExistingClips to skip detection caused the ratio to stay
            // locked to a stale autosaved value when the user starts a new video.
            let ratioSet = false;

            for (const file of files) {
                const url = URL.createObjectURL(file);
                let metadata = { duration: 0, fps: 30, width: 0, height: 0, thumbnail: null };

                try {
                    const probeResult = await probeMedia(file);
                    metadata = { ...metadata, ...probeResult };
                } catch (err) {
                    console.warn(`Failed to probe media for ${file.name}:`, err);
                }

                const isVideo = file.type.startsWith('video');

                // FIX: Set aspect ratio BEFORE building the asset list so that
                // the Revideo player key (which includes aspectRatio) is correct
                // when the player first mounts for this content.
                if (isVideo && !ratioSet && metadata.width && metadata.height) {
                    const detected = detectAspectRatio(metadata.width, metadata.height);
                    if (detected) {
                        useTimelineStore.getState().setAspectRatio(detected);
                        ratioSet = true;
                        console.log(`[IDELayout] Auto-detected aspect ratio: ${detected}`);
                    }
                }

                const assetId = `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                const assetEntry = {
                    id: assetId,
                    name: file.name,
                    type: isVideo ? 'video' : file.type.startsWith('image') ? 'image' : 'audio',
                    url: url,
                    file: file,
                    fileSize: file.size,
                    proxyUrl: null,
                    isProxying: isVideo,
                    uploadPhase: isVideo ? 'uploading' : 'ready',
                    uploadStartTime: Date.now(),
                    thumbnail: metadata.thumbnail,
                    sourceDuration: metadata.duration,
                    duration: metadata.duration,
                    fps: metadata.fps,
                    resolution: metadata.width && metadata.height ? { w: metadata.width, h: metadata.height } : null
                };
                processedAssets.push(assetEntry);

                if (isVideo) {
                    // After 5s with no response, assume upload is done and proxy is encoding
                    const processingTimer = setTimeout(() => {
                        useTimelineStore.getState().updateAsset(assetId, { uploadPhase: 'processing' });
                    }, 5000);

                    const userId = sessionId || 'anon';
                    // Track whether early transcription already started (via onUploadComplete).
                    // This prevents a duplicate job when the proxy .then() resolves.
                    let earlyTranscriptionPath = null;
                    // Set once the parallel (pre-proxy) analysis request succeeds, so the
                    // post-proxy path below doesn't queue the same asset twice.
                    let assetAnalysisQueued = false;

                    ProxyService.uploadAndGenerateProxy(
                        file,
                        userId,
                        (progress) => {
                            useTimelineStore.getState().updateAsset(assetId, { uploadProgress: progress });
                        },
                        (gcsPath) => {
                            // ⚡ File landed on GCS — start transcription NOW, in parallel
                            // with proxy encoding. Whisper and FFmpeg proxy run simultaneously.
                            if (gcsPath) {
                                earlyTranscriptionPath = gcsPath;
                                // Record the per-asset storage path. uploadedFilePath is a
                                // SINGLE global field, so with several uploads each one
                                // overwrote the last and every command then targeted
                                // whichever file happened to finish last. Keep the global
                                // for the first upload only (back-compat for single-file
                                // flows) and always store the per-asset path alongside it.
                                useTimelineStore.getState().updateAsset(assetId, { gcsPath });
                                if (!useTimelineStore.getState().uploadedFilePath) {
                                    useTimelineStore.getState().setUploadedFilePath(gcsPath);
                                }
                                transcriptionManager.startBackgroundTranscription(gcsPath, {
                                    platform: null,
                                    targetDuration: null,
                                });
                                console.log(`[IDELayout] ⚡ Early transcription started: ${gcsPath}`);

                                // Media intelligence runs here — the moment the file is on
                                // GCS — so scene/content analysis happens IN PARALLEL with
                                // proxy encoding rather than waiting for it. Both read the
                                // same raw upload, so there's no ordering dependency, and
                                // the Brain gets footage-aware context far sooner.
                                (async () => {
                                    try {
                                        const { authFetch } = await import('../utils/authFetch.js');
                                        const resp = await authFetch('/api/brain/analyze-asset', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                                assetId,
                                                gcsPath,
                                                name: file.name,
                                                projectId: useTimelineStore.getState().projectId || null,
                                            }),
                                        });
                                        assetAnalysisQueued = resp.ok;
                                        console.log(resp.ok
                                            ? `[IDELayout] 🧠 media intelligence queued (parallel with proxy) for "${file.name}"`
                                            : `[IDELayout] asset analysis not queued (${resp.status}) — Brain advice stays generic for "${file.name}"`);
                                    } catch (e) {
                                        console.warn('[IDELayout] asset analysis request failed (non-critical):', e.message);
                                    }
                                })();
                            }
                        },
                    )
                        .then(data => {
                            clearTimeout(processingTimer);
                            if (!data) {
                                console.warn('[IDELayout] Proxy job resolved with null result — job may have completed before SSE could read returnvalue');
                                // Marking the asset "ready" with NO playable URL left the
                                // player with nothing to load — a blank dark canvas — and
                                // the waveform with no source. When the raw upload path is
                                // known we can still play the original through the GCS
                                // media proxy: heavier than the proxy encode, but working.
                                const fallbackRaw = earlyTranscriptionPath || null;
                                if (fallbackRaw) {
                                    const GCS_BUCKET_FB = import.meta.env.VITE_GCS_BUCKET_NAME || 'viral-pilot_bucket';
                                    useTimelineStore.getState().updateAsset(assetId, {
                                        proxyUrl:    `/api/proxy/gcs-media/${fallbackRaw}`,
                                        sourceUrl:   `https://storage.googleapis.com/${GCS_BUCKET_FB}/${fallbackRaw}`,
                                        isProxying:  false,
                                        uploadPhase: 'ready',
                                    });
                                    console.warn(`[IDELayout] Falling back to the raw upload for playback: ${fallbackRaw}`);
                                } else {
                                    useTimelineStore.getState().updateAsset(assetId, { isProxying: false, uploadPhase: 'ready' });
                                }
                                return;
                            }
                            console.log(`[IDELayout] Proxy Ready: ${data.proxyUrl}`);

                            // Build the full raw GCS URL so the export route can
                            // download the source directly without guessing the path.
                            const GCS_BUCKET = import.meta.env.VITE_GCS_BUCKET_NAME || 'viral-pilot_bucket';
                            const rawGcsUrl = data.rawGcsPath
                                ? `https://storage.googleapis.com/${GCS_BUCKET}/${data.rawGcsPath}`
                                : null;

                            useTimelineStore.getState().updateAsset(assetId, {
                                proxyUrl: data.proxyUrl,
                                sourceUrl: rawGcsUrl || undefined,
                                isProxying: false,
                                uploadPhase: 'ready'
                            });

                            // Backfill sourceUrl on any clips already placed on the
                            // timeline that belong to this asset — they were added
                            // before the upload resolved, so they still have blob URLs.
                            if (rawGcsUrl) {
                                const { tracks } = useTimelineStore.getState();
                                tracks.forEach(track => {
                                    (track.clips || []).forEach(clip => {
                                        if (clip.assetId === assetId) {
                                            useTimelineStore.getState().updateClip(track.id, clip.id, {
                                                sourceUrl: rawGcsUrl,
                                                url: rawGcsUrl,
                                            }, { skipHistory: true });
                                        }
                                    });
                                });
                            }
                            // Persist proxyUrl immediately — the debounced autosave only
                            // fires on timeline events, so without this explicit call the
                            // proxyUrl would be missing from localStorage on page refresh.
                            useTimelineStore.getState().saveProject();

                            if (data.originalPath) {
                                useTimelineStore.getState().setUploadedFilePath(data.originalPath);
                            }
                            // Start (or retry) transcription — the early parallel attempt
                            // may have failed (e.g. 401 before auth was established, or
                            // GCS path was null on the legacy upload path).
                            //
                            // BUG THIS GUARD USED TO MISS: `alreadyRunning` only covers the
                            // states where a call in flight is still active or already
                            // succeeded (transcribing/analyzing/ready). By the time proxy
                            // encoding finishes for a large file, the EARLY attempt (kicked
                            // off the moment the raw upload landed on GCS, in parallel with
                            // proxy encoding) has often already TIMED OUT — Whisper +
                            // diarization on a long 4K interview can exceed the 300s budget —
                            // and TranscriptionManager's `finally` block has already cleared
                            // its in-flight controller and set status to FAILED. FAILED isn't
                            // "already running", so this fired a SECOND full pipeline
                            // (diarize → fallback transcribe, another 300s budget) against the
                            // exact same file. Two full transcription attempts running back to
                            // back doubled load on a worker that's already the documented
                            // bottleneck for exactly this kind of job (R24), which is what
                            // dragged waveform extraction and background scene analysis down
                            // with it into their own timeouts in the same session.
                            //
                            // The fix: don't blindly retry the IDENTICAL path that already
                            // failed. A timeout means the underlying job genuinely didn't
                            // finish in time — re-running the same call immediately is very
                            // likely to fail the same way, not recover. Only start a fresh
                            // attempt when this is a genuinely different path (the legacy
                            // upload path where the early attempt never got a gcsPath at all)
                            // or the manager is sitting IDLE (no attempt was made yet).
                            {
                                const tmStatus = transcriptionManager.getStatus().status;
                                const alreadyRunning = tmStatus === 'transcribing' || tmStatus === 'analyzing' || tmStatus === 'ready';
                                const transcriptPath = data.rawGcsPath || data.originalPath;
                                const alreadyAttemptedThisFile =
                                    !!earlyTranscriptionPath && transcriptPath === earlyTranscriptionPath &&
                                    (tmStatus === 'failed' || alreadyRunning);

                                if (!alreadyRunning && !alreadyAttemptedThisFile && transcriptPath) {
                                    transcriptionManager.startBackgroundTranscription(transcriptPath, {
                                        platform: null,
                                        targetDuration: null,
                                    });
                                } else if (alreadyAttemptedThisFile && tmStatus === 'failed') {
                                    // NOTE: there is currently no UI affordance that re-triggers
                                    // startBackgroundTranscription() after a failure — nothing
                                    // subscribes to EVENT_TYPES.TRANSCRIPTION_FAILED to offer a
                                    // retry. Until one exists, a genuinely failed transcription
                                    // (as opposed to this now-suppressed duplicate) has no
                                    // recovery path other than re-importing the clip. Worth a
                                    // manual retry control in TranscriptPanel.jsx as a follow-up.
                                    console.warn(
                                        `[IDELayout] Skipping automatic transcription retry for "${transcriptPath}" — ` +
                                        `the early parallel attempt already failed for this exact file. ` +
                                        `Re-running the identical request immediately is unlikely to succeed and would ` +
                                        `double load on an already-timed-out job.`
                                    );
                                }
                            }
                            // Store the GCS raw path so AI API calls (silence, filler, denoise)
                            // can locate the file via the worker's GCS fallback.
                            // rawGcsPath (e.g. "raw/{userId}/{filename}") is the canonical GCS key;
                            // proxyPath / originalPath are temp-relative and only exist locally.
                            const rawFilePath = data.rawGcsPath || data.proxyPath || data.originalPath;
                            if (rawFilePath) {
                                useTimelineStore.getState().setUploadedFile({ name: rawFilePath });
                                useTimelineStore.getState().setUploadedFilePath(rawFilePath);
                                useTimelineStore.getState().updateAsset(assetId, { gcsPath: data.rawGcsPath || rawFilePath });
                                console.log(`[IDELayout] uploadedFile path set: ${rawFilePath}`);
                                trackEvent('video_uploaded');

                                // FALLBACK ONLY: the analysis is normally queued earlier, in
                                // parallel with proxy encoding (see the onUploadComplete
                                // callback above). This covers the legacy upload path where
                                // that callback never fired with a gcsPath.
                                if (!assetAnalysisQueued) (async () => {
                                    try {
                                        const { authFetch } = await import('../utils/authFetch.js');
                                        const resp = await authFetch('/api/brain/analyze-asset', {
                                            method: 'POST',
                                            body: JSON.stringify({
                                                assetId,
                                                gcsPath:   data.rawGcsPath || rawFilePath,
                                                name:      file.name,
                                                projectId: useTimelineStore.getState().projectId || null,
                                            }),
                                        });
                                        if (!resp.ok) {
                                            console.warn(`[IDELayout] asset analysis not queued (${resp.status}) — Brain advice will stay generic for "${file.name}"`);
                                        } else {
                                            console.log(`[IDELayout] 🧠 media intelligence queued for "${file.name}"`);
                                        }
                                    } catch (e) {
                                        console.warn('[IDELayout] asset analysis request failed (non-critical):', e.message);
                                    }
                                })();
                            } else {
                                console.warn('[IDELayout] Proxy job result missing proxyPath and originalPath — AI API calls will not work');
                            }

                            const dur = assetEntry.sourceDuration || assetEntry.duration || 0;

                            // ── Contextual placeholder hint ───────────────────────
                            // Fires ~800ms after proxy so the timeline has rendered.
                            // Sets the input placeholder ("Try: ...") based on
                            // duration/content type — a passive UI hint only. This
                            // used to ALSO post its own "here's what I can do" ROKA
                            // chat bubble here, which duplicated (and could disagree
                            // with) BrainPanel's asset_added analysis below — ROKA
                            // now speaks once, through the Brain. See
                            // ReasoningPanel.jsx's asset_added advisory trigger.
                            if (processedAssets.length === 1) {
                                setTimeout(() => {
                                    const aiStore = useAIStore.getState();
                                    const videoType = detectVideoType(
                                        file.name,
                                        assetEntry.resolution,
                                        dur,
                                        assetEntry.fps,
                                    );
                                    aiStore.setContextualSuggestion(
                                        CONTEXTUAL_SUGGESTION[videoType] ?? 'make it more dynamic'
                                    );
                                }, 800);
                            }

                            // ── Thumbnail capture ─────────────────────────────────
                            // Trigger right after the first proxy completes — the file
                            // is guaranteed to exist at this moment (local or GCS).
                            // Only capture if the project has no thumbnail yet.
                            setTimeout(async () => {
                                try {
                                    const { projectId: pid, tracks: t, assets: a } =
                                        useTimelineStore.getState();
                                    if (!pid) return;
                                    // Quick check: does the project already have a thumbnail?
                                    const { getProject } = await import('../lib/projectsApi.js');
                                    const proj = await getProject(pid);
                                    if (proj?.thumbnail_url) return; // already done
                                    const { captureProjectThumbnail } = await import(
                                        '../utils/captureProjectThumbnail.js'
                                    );
                                    await captureProjectThumbnail(pid, t, a);
                                } catch (err) {
                                    console.warn('[IDELayout] Thumbnail capture after proxy failed:', err.message);
                                }
                            }, 1500); // short delay so the player has loaded the new proxyUrl

                            // ── Proactive talking-head / on-camera video detection ────
                            // Any single-camera recording longer than 90 s — talking
                            // head, vlog, selfie, tutorial, whatever — gets a background
                            // analysis that surfaces what's hurting engagement and what
                            // we can do about it. Fires 3 s after proxy so thumbnail
                            // capture goes first.
                            if (dur > 90 && processedAssets.length === 1 && rawFilePath) {
                                setTimeout(async () => {
                                    const aiStore = useAIStore.getState();
                                    try {
                                        // Lazy-import so the initial bundle stays light.
                                        const { authFetch }     = await import('../utils/authFetch.js');
                                        const { pollJobResult } = await import('../utils/jobPoller.js');

                                        const res = await authFetch('/api/interview/analyze', {
                                            method: 'POST',
                                            body:   JSON.stringify({ filename: rawFilePath }),
                                        });

                                        // Silently bail on auth / plan-gate errors — no scary UI.
                                        if (!res.ok) {
                                            console.warn('[IDELayout] Background video analysis non-ok:', res.status);
                                            return;
                                        }

                                        const { jobId } = await res.json();
                                        if (!jobId) return;

                                        const result = await pollJobResult(jobId);
                                        if (!result?.summary) return;

                                        const {
                                            fillerCount,
                                            deadAirCount,
                                            deadAirSaved,
                                            thinkingCount,
                                        } = result.summary;

                                        // Only surface findings if there's something meaningful to report.
                                        const killers = [];
                                        if (deadAirCount > 0) killers.push(`${deadAirCount} silent gaps (${deadAirSaved}s of dead air)`);
                                        if (fillerCount  > 0) killers.push(`${fillerCount} filler words`);
                                        if (thinkingCount > 0) killers.push(`${thinkingCount} thinking pauses`);

                                        if (killers.length > 0) {
                                            // NOTE: this used to also post its own "Scan complete —
                                            // I found: ..." ROKA chat bubble, ~3s after upload — a
                                            // third independent voice arriving after (and possibly
                                            // contradicting) BrainPanel's asset_added analysis. Removed
                                            // per the "one ROKA voice" requirement — the Brain doesn't
                                            // currently see filler/dead-air counts from this scan, so
                                            // that specific insight is silently dropped for now rather
                                            // than shown out of sync. Feeding this data into
                                            // server/brain/ContextEngine.js so the Brain's own message
                                            // can mention it is the correct long-term fix.
                                            aiStore.setContextualSuggestion(
                                                (fillerCount > 0 || deadAirCount > 0)
                                                    ? 'make it more dynamic'
                                                    : 'make it feel multi-camera'
                                            );
                                        }
                                        // If nothing found: stay quiet — the Brain's asset_added
                                        // analysis is the single source of guidance now.

                                    } catch (err) {
                                        // Best-effort: if this fails the user just misses
                                        // the proactive message — no error shown in the UI.
                                        console.warn('[IDELayout] Background video analysis failed:', err.message);
                                    }
                                }, 3000);
                            }
                        })
                        .catch(err => {
                            clearTimeout(processingTimer);
                            console.error(`[IDELayout] Proxy generation failed for ${file.name}`, err);
                            // Same reasoning as the null-result branch above: without a
                            // URL the asset renders as a blank dark player. If the raw
                            // file reached storage before the encode failed, play that.
                            const fallbackRaw = earlyTranscriptionPath || null;
                            if (fallbackRaw) {
                                const GCS_BUCKET_FB = import.meta.env.VITE_GCS_BUCKET_NAME || 'viral-pilot_bucket';
                                useTimelineStore.getState().updateAsset(assetId, {
                                    proxyUrl:    `/api/proxy/gcs-media/${fallbackRaw}`,
                                    sourceUrl:   `https://storage.googleapis.com/${GCS_BUCKET_FB}/${fallbackRaw}`,
                                    isProxying:  false,
                                    uploadPhase: 'ready',
                                });
                                console.warn(`[IDELayout] Proxy failed — playing the raw upload instead: ${fallbackRaw}`);
                                return;
                            }
                            useTimelineStore.getState().updateAsset(assetId, { isProxying: false, uploadPhase: 'ready' });
                        });
                }
            }

            addAssets(processedAssets);

            if (processedAssets.length === 1) {
                // Before auto-placing, evict ghost clips (stale segments from a
                // previous session that have no URL). Without this the new clip
                // overlaps them visually and `currentEnd` would push it far right
                // even after the ghost-skip fix in addAssetToTimeline.
                const tsState = useTimelineStore.getState();
                tsState.tracks.forEach(track => {
                    (track.clips || []).forEach(clip => {
                        const hasValidUrl = clip.url || clip.sourceUrl || clip.proxyUrl;
                        if (!hasValidUrl) tsState.removeClip(track.id, clip.id);
                    });
                });

                // Single file: auto-place immediately. The player resolves proxy URL
                // from the asset store once processing finishes — no extra work needed.
                useTimelineStore.getState().addAssetToTimeline(processedAssets[0]);
                // Always start preview from the beginning of the newly placed clip
                useTimelineStore.getState().seek(0);
            }
            // NOTE: multi-file uploads used to post their own hardcoded "I've got
            // your N clips ready…" assistant message here. That was a SECOND ROKA
            // voice with its own understanding — it knew the clip list while the
            // Editorial Brain, speaking right below it, still described the project
            // as "a monologue". There is now exactly one voice: the Brain's
            // debounced asset_added analysis (ReasoningPanel) speaks once the bin
            // has settled, and it receives the media bin + per-asset intelligence
            // so it can name the clips itself. ReasoningPanel emits a minimal
            // factual fallback only if the Brain produces nothing.

            console.log("✅ Store updated with assets and metadata", processedAssets);
        }
    };

    const triggerImport = () => {
        fileInputRef.current.click();
    };

    // Standard export path: FFmpeg + drawtext via BullMQ (jobs/exportProcessor.js).
    // Fast, stable, the default for every user.
    const handleFfmpegExport = async (settings) => {
        const { tracks, duration, assets, projectLUTId } = useTimelineStore.getState();
        const { authFetch }     = await import('../utils/authFetch.js');
        const { pollJobResult } = await import('../utils/jobPoller.js');

        // Enqueue the export job — returns { jobId } immediately
        const response = await authFetch('/api/render', {
            method: 'POST',
            body: JSON.stringify({
                timeline: { tracks, duration, assets: assets || [] },
                settings: {
                    platform: settings.platform || null,
                    quality:  settings.quality  || 'high',
                    resolution: settings.resolution || '1080p',
                    // The selected colour grade. Stored in the timeline store but
                    // never sent, so the export had no way to know a LUT was
                    // chosen — one half of why selecting a LUT changed no pixel
                    // (see CLAUDE.md R55). Null is the normal, ungraded case.
                    projectLUTId: projectLUTId || null,
                },
            }),
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || data.message || 'Export failed');
        if (!data.jobId)   throw new Error('Export response missing jobId');

        // Poll until the worker finishes (handles Railway timeouts gracefully)
        const result = await pollJobResult(data.jobId);
        if (!result?.url) throw new Error('Export completed but no URL returned');

        return { url: result.url, filename: result.filename, metadata: result.metadata };
    };

    // Cinematic (beta) export path: real Chromium render via Revideo on AWS Lambda
    // (render-lambda/). Renders through an actual browser engine instead of FFmpeg's
    // drawtext filter, so it handles fonts/effects more faithfully — but it depends
    // on RENDER_WORKER_URL / WORKER_SECRET / AWS_LAMBDA_FUNCTION_NAME being configured
    // on the backend (see routes/revideoRenderRoutes.js). If those aren't set, the
    // route responds 500 "Render proxy not configured" and we surface a clear,
    // actionable error instead of a cryptic failure.
    const handleRevideoExport = async () => {
        const { tracks, duration, aspectRatio } = useTimelineStore.getState();
        const { authFetch }        = await import('../utils/authFetch.js');
        const { pollRevideoResult } = await import('../utils/revideoPoller.js');

        const response = await authFetch('/api/revideo/render', {
            method: 'POST',
            body: JSON.stringify({
                tracks,
                duration,
                fps: 30,
                aspectRatio: aspectRatio || '16:9',
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 500 && /not configured/i.test(data.error || '')) {
            throw new Error(
                'Cinematic render isn’t set up yet on this deployment (missing RENDER_WORKER_URL / WORKER_SECRET / AWS Lambda config). Use Standard export for now, or ask your admin to finish the Revideo/Lambda setup.'
            );
        }
        if (!response.ok) throw new Error(data.error || data.message || 'Cinematic render failed to start');
        if (!data.jobId)  throw new Error('Cinematic render response missing jobId');

        const result = await pollRevideoResult(data.jobId);
        return { url: result.url, filename: `vibed-export-${result.renderId || Date.now()}.mp4`, metadata: null };
    };

    const handleExportConfirm = async (settings) => {
        trackEvent('video_exported');
        setIsExporting(true);
        setExportResult(null);
        setExportError(null);
        setExportUrl(null);

        try {
            const result = settings.engine === 'revideo'
                ? await handleRevideoExport()
                : await handleFfmpegExport(settings);

            setExportResult({ success: true, url: result.url, filename: result.filename, metadata: result.metadata });
            setExportUrl(result.url);
        } catch (err) {
            console.error('Export Failed:', err);
            setExportError(err.message);
        } finally {
            setIsExporting(false);
        }
    };

    const [activeDragItem, setActiveDragItem] = React.useState(null);

    const handleDragStart = (event) => {
        const { active } = event;
        if (active.data.current?.type === 'asset') {
            setActiveDragItem(active.data.current.asset);
        }
    };

    const handleDragEnd = (event) => {
        setActiveDragItem(null);
        const { active, over, delta } = event;
        if (!active || !over) return;

        const activeData = active.data.current;
        const targetData = over.data.current;
        const state = useTimelineStore.getState();

        // Utility to check overlap
        const checkOverlap = (trackId, newStart, duration, ignoreClipId = null) => {
            const track = state.tracks.find(t => t.id === trackId);
            if (!track) return false;
            return track.clips.some(c => {
                if (c.id === ignoreClipId) return false;
                const cEnd = c.start + c.duration;
                const newEnd = newStart + duration;
                return (newStart < cEnd - 0.01 && newEnd > c.start + 0.01);
            });
        };

        // Drop ASSET onto TRACK
        if (activeData?.type === 'asset' && targetData?.trackId) {
            const asset = activeData.asset;
            let trackId = targetData.trackId;
            const dropTime = state.currentTime;
            const duration = asset.type === 'image' ? 5 : (asset.duration || asset.sourceDuration || 10);

            if (checkOverlap(trackId, dropTime, duration)) {
                trackId = state.addTrack(asset.type === 'audio' ? 'audio' : 'video');
            }

            addClip(trackId, {
                id: `clip-${Date.now()}`,
                assetId: asset.id,
                start: dropTime,
                duration: duration,
                name: asset.name,
                color: asset.type === 'audio' ? 'bg-orange-500' : 'bg-blue-500',
                url: asset.url,
                speed: 1.0,
                volume: 1.0,
                metadata: {
                    fps: asset.fps,
                    resolution: asset.resolution
                }
            });
        }

        // Move existing CLIP
        if (activeData?.clip && targetData?.trackId) {
            const activeClipId = active.id;
            let targetTrackId = targetData.trackId;
            const currentClip = activeData.clip;

            const deltaSeconds = delta.x / state.zoomLevel;
            let newStart = Math.max(0, currentClip.start + deltaSeconds);

            // Snapping
            const SNAP_THRESHOLD_PX = 10;
            const snapThresholdTime = SNAP_THRESHOLD_PX / state.zoomLevel;
            let closestSnap = null;
            let minDist = Infinity;
            const snapPoints = [0, state.currentTime];

            state.tracks.forEach(t => {
                t.clips.forEach(c => {
                    if (c.id === activeClipId) return;
                    snapPoints.push(c.start);
                    snapPoints.push(c.start + c.duration);
                });
            });

            snapPoints.forEach(point => {
                const distStart = Math.abs(newStart - point);
                if (distStart < snapThresholdTime && distStart < minDist) {
                    minDist = distStart;
                    closestSnap = point;
                }
                const newEnd = newStart + currentClip.duration;
                const distEnd = Math.abs(newEnd - point);
                if (distEnd < snapThresholdTime && distEnd < minDist) {
                    minDist = distEnd;
                    closestSnap = point - currentClip.duration;
                }
            });

            if (closestSnap !== null) newStart = closestSnap;

            if (checkOverlap(targetTrackId, newStart, currentClip.duration, activeClipId)) {
                targetTrackId = state.addTrack(currentClip.type === 'audio' ? 'audio' : 'video');
            }

            state.updateClip(activeData.trackId, activeClipId, { 
                start: newStart,
                layerId: targetTrackId !== activeData.trackId ? targetTrackId : undefined
            });
        }

        // Drop EFFECT onto CLIP
        if (activeData?.type === 'effect' && targetData?.type === 'clip') {
            const clipId = targetData.clipId;
            const trackId = targetData.trackId;
            useTimelineStore.getState().updateClip(trackId, clipId, { filter: activeData.filter });
        }
    };

    return (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>

            <ExportModal
                isOpen={showExportModal}
                onClose={() => setShowExportModal(false)}
                onExport={handleExportConfirm}
                isExporting={isExporting}
                exportResult={exportResult}
                exportError={exportError}
            />
            <ClarificationDialog />
            <ApprovalDialog />

            {/* Progressive auth prompt */}
            {authPrompt && (
                <AuthPromptModal
                    trigger={authPrompt}
                    onDismiss={() => { setAuthPrompt(null); authShownRef.current = false; }}
                    onSuccess={() => {
                        setAuthPrompt(null);
                        // If this was an export trigger, open the export modal now
                        if (authPrompt === 'export') setShowExportModal(true);
                    }}
                />
            )}

            {/* Session countdown — show when < 24 h remain and user is anonymous */}
            {isAnonymous && hoursLeft() !== null && hoursLeft() < 24 && (
                <div
                    className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-3 py-2 px-4 text-xs"
                    style={{ background: 'rgba(255,140,0,0.12)', borderBottom: '0.5px solid rgba(255,140,0,0.3)', backdropFilter: 'blur(8px)' }}
                >
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'oklch(0.78 0.15 60)', letterSpacing: '0.06em' }}>
                        Your project will be available for {Math.round(hoursLeft())} more hour{Math.round(hoursLeft()) !== 1 ? 's' : ''} —
                    </span>
                    <button
                        onClick={() => showAuthPrompt('timer')}
                        style={{ fontFamily: 'var(--f-mono)', fontSize: 10, color: 'oklch(0.85 0.18 60)', textDecoration: 'underline', letterSpacing: '0.06em' }}
                    >
                        Save with a free account
                    </button>
                </div>
            )}

            <div className="h-screen w-screen overflow-hidden flex flex-col font-sans selection:bg-primary/30 text-foreground" style={{ background: "linear-gradient(180deg, var(--bg-2), var(--bg-3))" }}>
                {/* ── Background Aurora Glows ── */}
                <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
                    <div className="absolute rounded-full blur-[120px]" style={{ width: "50vw", height: "50vw", top: "-20vw", left: "40vw", background: "var(--accent)", opacity: 0.12 }} />
                    <div className="absolute rounded-full blur-[120px]" style={{ width: "40vw", height: "40vw", bottom: "-30vw", left: "-10vw", background: "var(--violet)", opacity: 0.10 }} />
                </div>
                {/* Top Bar */}
                <header className="h-11 border-b flex items-center justify-start gap-6 px-4 z-40 shrink-0" style={{ background: "var(--glass)", borderColor: "var(--line-soft)", backdropFilter: "blur(20px) saturate(160%)" }}>
                    <div className="flex items-center gap-3">

                        <button className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground" onClick={() => setShowSidebar(!showSidebar)}>
                            <Menu className="w-5 h-5" />
                        </button>
                        <span className="studio-mono-label hidden md:inline">vibed/studio</span>
                    </div>

                    {/* Centered project name — click to rename */}
                    <div className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-2" style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--fg-3)" }}>
                        {editingName ? (
                            <input
                                ref={nameInputRef}
                                value={nameInput}
                                onChange={e => setNameInput(e.target.value)}
                                onBlur={commitRename}
                                onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingName(false); }}
                                style={{
                                    background: 'var(--bg-3)',
                                    border: '0.5px solid var(--accent)',
                                    borderRadius: 4,
                                    padding: '2px 8px',
                                    color: 'var(--fg)',
                                    fontFamily: 'var(--f-mono)',
                                    fontSize: 11,
                                    outline: 'none',
                                    minWidth: 120,
                                    maxWidth: 280,
                                }}
                            />
                        ) : (
                            <span
                                title={t('ideLayout.clickToRename')}
                                onClick={startRename}
                                style={{
                                    color: 'var(--fg-2)',
                                    cursor: 'text',
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    transition: 'background 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-2)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                                {projectName || t('ideLayout.untitledProject')}
                            </span>
                        )}
                        <span style={{ color: "var(--fg-4)" }}>·</span>
                        <VideoTimeDisplay />
                    </div>

                    {/* Mobile title */}
                    <h1 className="md:hidden font-bold text-sm tracking-wide truncate max-w-[150px]">
                        VIBED
                    </h1>

                    {/* Menu Bar */}
                    <div className="hidden md:flex items-center gap-1 z-50">
                        <div className="relative">
                            <button
                                onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
                                className={classNames(
                                    "px-3 py-1.5 text-xs rounded-md transition-colors",
                                    openMenu === 'file' ? "bg-secondary text-foreground" : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t('ideLayout.menu.file')}
                            </button>
                            {openMenu === 'file' && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-card border border-border shadow-xl rounded-md py-1 z-50 flex flex-col">
                                        <button onClick={() => { if (confirm(t('ideLayout.menu.confirmNewProject'))) { useTimelineStore.getState().loadProject({ tracks: [], duration: 60 }); } setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">{t('ideLayout.menu.newProject')}</button>
                                        <button onClick={() => { projectLoaderRef.current.click(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">{t('ideLayout.menu.openProject')}</button>
                                        <div className="h-px bg-border my-1" />
                                        <button onClick={() => { const data = useTimelineStore.getState().saveProject(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `project-${Date.now()}.json`; a.click(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">{t('ideLayout.menu.saveProject')}</button>
                                        <div className="h-px bg-border my-1" />
                                        <button onClick={() => { triggerImport(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">{t('ideLayout.menu.importMedia')}</button>
                                        <button onClick={() => { setShowExportModal(true); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">{t('ideLayout.menu.exportVideo')}</button>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="relative">
                            <button
                                onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
                                className={classNames(
                                    "px-3 py-1.5 text-xs rounded-md transition-colors",
                                    openMenu === 'edit' ? "bg-secondary text-foreground" : "hover:bg-secondary text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {t('ideLayout.menu.edit')}
                            </button>
                            {openMenu === 'edit' && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-card border border-border shadow-xl rounded-md py-1 z-50 flex flex-col">
                                        <button onClick={() => { useTimelineStore.getState().undo(); setOpenMenu(null); }} disabled={past.length === 0} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">{t('ideLayout.menu.undo')}</button>
                                        <button onClick={() => { useTimelineStore.getState().redo(); setOpenMenu(null); }} disabled={future.length === 0} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">{t('ideLayout.menu.redo')}</button>
                                        <div className="h-px bg-border my-1" />
                                        <button onClick={() => { useTimelineStore.getState().copyClip(activeClipId); setOpenMenu(null); }} disabled={!activeClip} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">{t('ideLayout.menu.copy')}</button>
                                        <button onClick={() => { useTimelineStore.getState().pasteClip(useTimelineStore.getState().currentTime); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">{t('ideLayout.menu.paste')}</button>
                                        <button onClick={() => { if (activeClip && activeTrackId) { useTimelineStore.getState().removeClip(activeTrackId, activeClip.id); } setOpenMenu(null); }} disabled={!activeClip} className="px-4 py-2 text-xs text-left hover:bg-red-500/10 text-red-400 transition-colors disabled:opacity-50">{t('ideLayout.menu.delete')}</button>
                                    </div>
                                </>
                            )}
                        </div>

                        <input type="file" ref={projectLoaderRef} className="hidden" accept=".json" onChange={(e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                try { useTimelineStore.getState().loadProject(JSON.parse(ev.target.result)); }
                                catch { alert(t('ideLayout.menu.invalidProjectFile')); }
                            };
                            reader.readAsText(file);
                        }} />
                    </div>

                    <div className="flex items-center gap-2 md:gap-3 ml-auto">
                        <button onClick={() => setActiveTab('settings')} className={classNames("hidden md:block p-2 hover:bg-secondary rounded-full transition-colors", activeTab === 'settings' ? "bg-secondary text-foreground" : "")}>
                            <Settings className="w-4 h-4 text-muted-foreground" />
                        </button>

                        <button
                            onClick={() => {
                                if (isAnonymous) { showAuthPrompt('export'); }
                                else { setShowExportModal(true); }
                            }}
                            disabled={isExporting}
                            className="glass-button-pro px-4 py-1.5 md:px-5 rounded-md text-[10px] flex items-center gap-2 disabled:opacity-50"
                        >
                            {isExporting ? <span className="animate-spin">⏳</span> : <Share className="w-3 h-3" />}
                            {isExporting ? t('ideLayout.rendering') : t('ideLayout.export')}
                        </button>
                    </div>
                </header>

                {/* Main Workspace */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative pb-14 md:pb-0">

                    {/* Left Sidebar (Media/Effects) — bottom sheet on mobile, static sidebar on desktop */}
                    <aside
                        className={classNames(
                            "flex flex-col font-sans shrink-0 transition-transform duration-300 ease-in-out",
                            "border-[var(--line-soft)]",
                            // Mobile: fixed bottom sheet above toolbar
                            "fixed inset-x-0 bottom-14 z-40 max-h-[65vh] rounded-t-2xl border-t overflow-hidden",
                            // Desktop: revert to static left sidebar
                            "md:static md:inset-auto md:bottom-auto md:z-30 md:max-h-none md:rounded-none md:border-t-0 md:border-r md:w-72 md:shadow-none md:overflow-y-auto md:translate-y-0",
                            // Mobile visibility + disable pointer events when hidden (prevents touch bleed-through)
                            ['media', 'audio', 'more'].includes(mobileSheet) ? "translate-y-0" : "translate-y-full pointer-events-none md:pointer-events-auto"
                        )}
                        style={{ background: "linear-gradient(180deg, var(--glass), transparent)" }}
                    >
                        <div className="md:hidden p-3 border-b border-[var(--line-soft)] flex justify-between items-center shrink-0" style={{ background: "var(--glass)" }}>
                            <span className="font-bold text-sm" style={{ color: "var(--fg)" }}>{t('ideLayout.mediaAndAssets')}</span>
                            <button
                                onClick={() => setMobileSheet(null)}
                                className="p-1 rounded-full transition-colors hover:bg-white/10"
                                style={{ color: "var(--fg-3)" }}
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <input id="media-file-input" type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept="video/*,audio/*,image/*" multiple />

                        <div className="relative border-b" style={{ borderColor: "var(--line-soft)" }}>
                            <div ref={tabBarRef} className="p-2 flex gap-1 overflow-x-auto no-scrollbar">
                                {['media', 'captions', 'transcript', 'color', 'assets', 'audio', 'transform', 'settings'].map(tab => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={classNames("studio-tab-btn", activeTab === tab && "active")}
                                    >
                                        {tab === 'media'      && <Layers   className="w-2.5 h-2.5" />}
                                        {tab === 'captions'   && <Type     className="w-2.5 h-2.5" />}
                                        {tab === 'transcript' && <span style={{ fontSize: 9 }}>📝</span>}
                                        {tab === 'color'      && <Palette  className="w-2.5 h-2.5" />}
                                        {tab === 'assets'     && <Sparkles className="w-2.5 h-2.5" />}
                                        {tab === 'audio'      && <span style={{ fontSize: 9 }}>🎤</span>}
                                        {tab === 'transform'  && <Move     className="w-2.5 h-2.5" />}
                                        {tab === 'settings'   && <Settings className="w-2.5 h-2.5" />}
                                        {t(`ideLayout.tabs.${tab}`)}
                                    </button>
                                ))}
                            </div>

                            {/* Left scroll fade + arrow — only visible when scrolled away from the start */}
                            {tabScroll.left && (
                                <>
                                    <div
                                        className="pointer-events-none absolute inset-y-0 left-0 w-6"
                                        style={{ background: "linear-gradient(90deg, var(--bg-2, #111), transparent)" }}
                                    />
                                    <button
                                        onClick={() => scrollTabBar(-1)}
                                        className="absolute left-0 top-0 bottom-0 flex items-center justify-center w-5"
                                        style={{ color: "var(--fg-3)" }}
                                        aria-label={t('ideLayout.scrollTabsLeft')}
                                    >
                                        <ChevronLeft className="w-3 h-3" />
                                    </button>
                                </>
                            )}

                            {/* Right scroll fade + arrow — only visible when more tabs overflow to the right */}
                            {tabScroll.right && (
                                <>
                                    <div
                                        className="pointer-events-none absolute inset-y-0 right-0 w-6"
                                        style={{ background: "linear-gradient(270deg, var(--bg-2, #111), transparent)" }}
                                    />
                                    <button
                                        onClick={() => scrollTabBar(1)}
                                        className="absolute right-0 top-0 bottom-0 flex items-center justify-center w-5"
                                        style={{ color: "var(--fg-3)" }}
                                        aria-label={t('ideLayout.scrollTabsRight')}
                                    >
                                        <ChevronRight className="w-3 h-3" />
                                    </button>
                                </>
                            )}
                        </div>

                        {/* Transcript panel manages its own internal scroll */}
                        {activeTab === 'transcript' && (
                            <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                                <TranscriptPanel />
                            </div>
                        )}

                        {/* Assets panel (SFX · LUTs · Presets) — managed its own scroll */}
                        {activeTab === 'assets' && (
                            <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
                                <AssetPanel onClose={() => setActiveTab('media')} />
                            </div>
                        )}

                        <div className={classNames("flex-1 overflow-y-auto pb-24 md:pb-20", (activeTab === 'transcript' || activeTab === 'assets') && "hidden")}>
                            {activeTab === 'media' && (
                                <section className="p-4 border-b" style={{ borderColor: "var(--line-soft)" }}>
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="studio-mono-label" style={{ color: 'var(--fg-2)' }}>{t('ideLayout.bin', { count: assets.length })}</div>
                                        {/* Import button — input overlaid directly so Android taps hit the input itself */}
                                        <div className="relative text-[10px] bg-primary/10 hover:bg-primary/20 text-primary px-2 py-1 rounded transition-colors flex items-center gap-1" style={{ fontFamily: "var(--f-mono)" }}>
                                            <Upload className="w-3 h-3" /> {t('ideLayout.import')}
                                            <input
                                                type="file"
                                                onChange={handleFileImport}
                                                accept="video/*,audio/*,image/*"
                                                multiple
                                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                style={{ fontSize: 0 }}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {assets.length === 0 && (
                                            /* Dropzone — same overlay trick: invisible input fills the entire card */
                                            <div className="relative aspect-video border border-dashed border-border rounded-md flex flex-col items-center justify-center text-muted-foreground hover:bg-secondary/30 transition-colors p-4 text-center col-span-2">
                                                <Upload className="w-6 h-6 mb-2 opacity-50" />
                                                <span className="text-xs">{t('ideLayout.tapOrDropMedia')}</span>
                                                <span className="text-[10px] opacity-50 mt-1">{t('ideLayout.mediaTypes')}</span>
                                                <input
                                                    type="file"
                                                    onChange={handleFileImport}
                                                    accept="video/*,audio/*,image/*"
                                                    multiple
                                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                                    style={{ fontSize: 0 }}
                                                />
                                            </div>
                                        )}
                                        {assets.map(asset => (
                                            <DraggableAsset key={asset.id} asset={asset} />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'effects' && (
                                <section className="h-full bg-card">
                                    <EffectsPanel targetId={activeClipId} playbackEngine={useTimelineStore.getState().playbackEngine} playhead={useTimelineStore.getState().currentTime} className="h-full" />
                                </section>
                            )}

                            {activeTab === 'color' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">{t('ideLayout.colorGrading.title')}</div>
                                            {activeClip && <div className="text-[10px] text-green-400 font-mono">{t('ideLayout.active')}</div>}
                                        </div>
                                        {!activeClip ? (
                                            <div className="p-4 rounded-md border border-dashed border-border text-center">
                                                <p className="text-xs text-muted-foreground">{t('ideLayout.colorGrading.selectClip')}</p>
                                            </div>
                                        ) : (
                                            <>
                                                {[
                                                    { key: 'brightness', label: t('ideLayout.colorGrading.brightness'), min: 0, max: 200, unit: '%' },
                                                    { key: 'contrast', label: t('ideLayout.colorGrading.contrast'), min: 0, max: 200, unit: '%' },
                                                    { key: 'saturate', label: t('ideLayout.colorGrading.saturation'), min: 0, max: 200, unit: '%' },
                                                    { key: 'hueRotate', label: t('ideLayout.colorGrading.hueRotate'), min: 0, max: 360, unit: '°' },
                                                ].map(({ key, label, min, max, unit }) => (
                                                    <div key={key} className="space-y-2">
                                                        <div className="flex justify-between text-xs">
                                                            <span>{label}</span>
                                                            <span className="text-muted-foreground">{(activeClip.grading?.[key] ?? (key === 'hueRotate' ? 0 : 100))}{unit}</span>
                                                        </div>
                                                        <input type="range" min={min} max={max} value={activeClip.grading?.[key] ?? (key === 'hueRotate' ? 0 : 100)} onChange={(e) => handleGradingChange(key, parseInt(e.target.value))} className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer" />
                                                    </div>
                                                ))}
                                                <div className="pt-4 border-t border-border">
                                                    <button onClick={() => updateClip(activeTrackId, activeClip.id, { grading: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 }, filter: 'none' })} className="w-full py-1.5 text-xs bg-secondary hover:bg-white/10 rounded text-muted-foreground transition-colors">{t('ideLayout.colorGrading.reset')}</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'interview' && <section className="border-b border-border/50"><InterviewEditPanel /></section>}
                            {activeTab === 'captions' && <section className="p-4 border-b border-border/50"><TextPanel /></section>}
                            {activeTab === 'audio' && <section className="p-4 border-b border-border/50"><MixerPanel /></section>}

                            {activeTab === 'transform' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">{t('ideLayout.transform.title')}</div>
                                            {activeClip && <div className="text-[10px] text-green-400 font-mono">{t('ideLayout.active')}</div>}
                                        </div>
                                        {!activeClip ? (
                                            <div className="p-4 rounded-md border border-dashed border-border text-center"><p className="text-xs text-muted-foreground">{t('ideLayout.transform.selectClip')}</p></div>
                                        ) : (
                                            <>
                                                {[
                                                    { key: 'scale', label: t('ideLayout.transform.scale'), min: 10, max: 300, toDisplay: v => Math.round((v || 1) * 100), unit: '%', fromDisplay: v => v / 100 },
                                                    { key: 'x', label: t('ideLayout.transform.positionX'), min: -1920, max: 1920, toDisplay: v => v || 0, unit: 'px', fromDisplay: v => v },
                                                    { key: 'y', label: t('ideLayout.transform.positionY'), min: -1080, max: 1080, toDisplay: v => v || 0, unit: 'px', fromDisplay: v => v },
                                                    { key: 'rotation', label: t('ideLayout.transform.rotation'), min: -180, max: 180, toDisplay: v => v || 0, unit: '°', fromDisplay: v => v },
                                                ].map(({ key, label, min, max, toDisplay, unit, fromDisplay }) => {
                                                    const displayVal = toDisplay(activeClip[key]);
                                                    // Canvas renders at native video resolution (e.g. 1920px).
                                                    // CSS scale() only degrades quality if the visual display
                                                    // exceeds native res — unlikely below 300% on typical screens.
                                                    const scaleQuality = key === 'scale'
                                                        ? (displayVal <= 150 ? { color: '#34d399', label: t('ideLayout.transform.qualitySharp') }
                                                        : displayVal <= 250 ? { color: '#fbbf24', label: t('ideLayout.transform.qualityZoomedIn') }
                                                        : { color: '#f87171', label: t('ideLayout.transform.qualityExtremeZoom') })
                                                        : null;
                                                    return (
                                                    <div key={key} className="space-y-2">
                                                        <div className="flex justify-between text-xs items-center">
                                                            <span>{label}</span>
                                                            <div className="flex items-center gap-1.5">
                                                                {scaleQuality && (
                                                                    <span className="flex items-center gap-1">
                                                                        <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: scaleQuality.color, boxShadow: `0 0 4px ${scaleQuality.color}` }} />
                                                                        <span className="text-[10px]" style={{ color: scaleQuality.color }}>{scaleQuality.label}</span>
                                                                    </span>
                                                                )}
                                                                <span className="text-muted-foreground">{displayVal}{unit}</span>
                                                            </div>
                                                        </div>
                                                        <input type="range" min={min} max={max} value={displayVal}
                                                            onChange={(e) => updateClip(activeTrackId, activeClip.id, { [key]: fromDisplay(parseInt(e.target.value)) }, { skipHistory: true })}
                                                            onPointerUp={(e) => updateClip(activeTrackId, activeClip.id, { [key]: fromDisplay(parseInt(e.target.value)) })}
                                                            className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer" />
                                                    </div>
                                                    );
                                                })}
                                                <p className="text-[10px] leading-relaxed pt-1" style={{ color: 'var(--fg-3)', fontFamily: 'var(--f-sans)' }}>
                                                    {t('ideLayout.transform.qualityNote')}
                                                </p>
                                                <div className="pt-3 border-t border-border">
                                                    <button onClick={() => updateClip(activeTrackId, activeClip.id, { scale: 1, x: 0, y: 0, rotation: 0 })} className="w-full py-1.5 text-xs bg-secondary hover:bg-white/10 rounded text-muted-foreground transition-colors">{t('ideLayout.transform.reset')}</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'marketplace' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-3">{t('ideLayout.extensions.title')}</div>
                                    {[
                                        { id: 'ext-1', name: t('ideLayout.extensions.autoCaptions.name'), desc: t('ideLayout.extensions.autoCaptions.desc'), icon: '💬', installed: true },
                                        { id: 'ext-2', name: t('ideLayout.extensions.motionGraphics.name'), desc: t('ideLayout.extensions.motionGraphics.desc'), icon: '✨', installed: false },
                                        { id: 'ext-3', name: t('ideLayout.extensions.soundFxLibrary.name'), desc: t('ideLayout.extensions.soundFxLibrary.desc'), icon: '🔊', installed: false },
                                        { id: 'ext-4', name: t('ideLayout.extensions.socialTemplates.name'), desc: t('ideLayout.extensions.socialTemplates.desc'), icon: '📱', installed: true },
                                    ].map(ext => (
                                        <div key={ext.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 hover:border-primary/30 hover:bg-secondary/20 transition-all cursor-pointer group mb-2">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-secondary/50 flex items-center justify-center text-lg">{ext.icon}</div>
                                                <div>
                                                    <div className="text-sm font-medium">{ext.name}</div>
                                                    <div className="text-[10px] text-muted-foreground">{ext.desc}</div>
                                                </div>
                                            </div>
                                            <button className={classNames("px-3 py-1 text-[10px] rounded-full font-medium transition-colors", ext.installed ? "bg-green-500/20 text-green-400" : "bg-primary/10 text-primary hover:bg-primary/20")}>
                                                {ext.installed ? t('ideLayout.extensions.installed') : t('ideLayout.extensions.install')}
                                            </button>
                                        </div>
                                    ))}
                                </section>
                            )}

                            {activeTab === 'settings' && <section className="p-4"><SettingsPanel /></section>}
                        </div>
                    </aside>

                    {showSidebar && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setShowSidebar(false)} />}

                    {/* Backdrop — closes any open mobile sheet on tap */}
                    {isMobile && mobileSheet !== null && (
                        <div
                            className="fixed inset-0 bg-black/60 z-30 md:hidden"
                            style={{ backdropFilter: 'blur(2px)' }}
                            onClick={() => setMobileSheet(null)}
                        />
                    )}

                    {/* Center — Viewport & Timeline (always visible on all screen sizes) */}
                    <main className="flex-1 flex flex-col min-w-0 relative">
                        <div
                            className={classNames(
                                "relative overflow-hidden shrink-0",
                                isMobile
                                    // Mobile: explicit height so child canvas height:100% resolves in Safari.
                                    // CSS aspect-ratio alone does NOT create a "definite height" for child
                                    // height:100% in WebKit — the canvas collapses to 0 and nothing plays.
                                    ? "w-full flex items-center justify-center"
                                    // Desktop: unchanged
                                    : "flex-1 flex items-center justify-center md:p-8 p-4"
                            )}
                            style={{
                                background: "radial-gradient(60% 80% at 50% 40%, #1c1f24 0%, #0c0d10 100%)",
                                // Explicit height in viewport units gives the canvas a definite parent height.
                                // 16:9 → 56.25vw (= 100vw × 9/16, fills phone width exactly, no wasted space)
                                // 9:16 / 1:1 → 45vh (portrait/square capped to avoid overflowing timeline)
                                // Using vh (not svh) for universal iOS/Android support
                                ...(isMobile && {
                                    height: (aspectRatio === '9:16' || aspectRatio === '1:1') ? '45vh' : '56.25vw',
                                }),
                            }}
                        >
                            <div className={classNames(
                                "bg-black rounded-lg shadow-2xl relative border border-white/5 group overflow-hidden transition-all duration-500 ease-in-out",
                                isMobile
                                    // Mobile: inner fills the outer's explicit height.
                                    // 16:9 → w-full h-full (fills entire container, no gaps)
                                    // 9:16 / 1:1 → height-driven, width from aspect-ratio, centered by flex
                                    ? (
                                        aspectRatio === '9:16'
                                            ? 'h-full w-auto aspect-[9/16]'
                                            : aspectRatio === '1:1'
                                                ? 'h-full w-auto aspect-square'
                                                : 'w-full h-full'
                                      )
                                    // Desktop: unchanged
                                    : (
                                        aspectRatio === '9:16'
                                            ? 'aspect-[9/16] max-h-[70vh] md:max-h-[550px] w-auto'
                                            : aspectRatio === '1:1'
                                                ? 'aspect-square max-h-[50vh] md:max-h-[450px] w-auto'
                                                : 'aspect-video max-w-full max-h-full md:max-h-[60vh] w-auto'
                                      )
                            )}>
                                <ErrorBoundary>
                                    {(() => {
                                        const dims = getPlayerDimensions(aspectRatio);
                                        // Sync project canvas size to current aspect ratio
                                        if (project && project.settings && project.settings.shared) {
                                            const v = project.settings.shared.size;
                                            if (v) { v.x = dims.width; v.y = dims.height; }
                                            else { project.settings.shared.size = { x: dims.width, y: dims.height }; }
                                        }

                                        return (
                                            <Player
                                                key={`player-${aspectRatio}-${hasClips ? 'media' : 'empty'}`}
                                                onPlayerReady={handlePlayerReady}
                                                playing={isPlaying}
                                                controls={false}
                                                currentTime={useTimelineStore.getState().currentTime}
                                                onTimeUpdate={(time) => {
                                                    useTimelineStore.setState({ currentTime: time });
                                                }}
                                                project={project}
                                                variables={playerVariables}
                                                width={dims.width}
                                                height={dims.height}
                                                className="w-full h-full"
                                                style={{ width: '100%', height: '100%', display: 'block' }}
                                            />
                                        );
                                    })()}
                                </ErrorBoundary>
                                <TextOverlay />
                            </div>

                            {/* Floating Playback Controls */}
                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 backdrop-blur-xl px-4 py-2 rounded-full shadow-xl z-20 scale-90 md:scale-100 origin-bottom" style={{ background: "rgba(14,15,17,0.85)", border: "0.5px solid var(--line-strong)" }}>
                                <button className="hover:text-primary transition-colors" onClick={() => useTimelineStore.getState().seek(0)} style={{ color: "var(--fg-3)" }}><SkipBack /></button>
                                <button className="hover:text-primary transition-colors" onClick={() => useTimelineStore.getState().togglePlay()} style={{ color: "var(--fg)" }}>
                                    {!isPlaying ? <Play className="fill-current" /> : <Pause className="fill-current" />}
                                </button>
                                <button className="hover:text-primary transition-colors" style={{ color: "var(--fg-3)" }}><SkipForward /></button>
                                <div className="w-px h-3.5 mx-1" style={{ background: "var(--line-strong)" }} />
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)", letterSpacing: "0.06em" }}>
                                    <VideoTimeDisplay />
                                </span>
                            </div>
                        </div>

                        {/* Timeline — always visible. Mini (h-36) on mobile, full-height on desktop. */}
                        {mode === 'editor' && (
                            <div
                                className={classNames(
                                    "border-t flex flex-col overflow-hidden shrink-0",
                                    isMobile ? "h-36" : "h-48 md:h-72"
                                )}
                                style={{ background: "var(--bg-2)", borderColor: "var(--line-soft)" }}
                            >
                                <Timeline />
                            </div>
                        )}

                        {/* Compact AI bar — always visible on mobile, between timeline and toolbar */}
                        {isMobile && (
                            <MobileAIBar onExpand={() => setMobileSheet('ai')} />
                        )}
                    </main>

                    {/* Right Sidebar — AI panel. Bottom sheet on mobile, static sidebar on desktop. */}
                    <aside
                        className={classNames(
                            "flex flex-col font-sans shrink-0 transition-transform duration-300 ease-in-out",
                            "border-[var(--line-soft)]",
                            // Mobile: fixed bottom sheet above toolbar (taller than media panel for the chat)
                            "fixed inset-x-0 bottom-14 z-40 max-h-[80vh] rounded-t-2xl border-t overflow-hidden",
                            // Desktop: revert to static right sidebar (always visible)
                            "md:static md:inset-auto md:bottom-auto md:z-30 md:max-h-none md:rounded-none md:border-t-0 md:border-l md:w-80 md:shadow-none md:overflow-y-auto md:translate-y-0",
                            // Mobile visibility + disable pointer events when hidden
                            mobileSheet === 'ai' ? "translate-y-0" : "translate-y-full pointer-events-none md:pointer-events-auto"
                        )}
                        style={{ background: "linear-gradient(180deg, var(--glass), transparent)" }}
                    >

                        <div className="flex-1 overflow-hidden h-full">
                            <ReasoningPanel />
                        </div>
                    </aside>
                </div>
                
                {/* Mobile Bottom Toolbar */}
                <MobileToolbar
                    activeSheet={mobileSheet}
                    onSheetChange={handleMobileSheet}
                    onImport={triggerImport}
                    activeTrackType={isMobile ? activeTrackType : null}
                    onClipAction={handleClipAction}
                    onDeselect={handleDeselect}
                    onDeleteClip={handleDeleteClip}
                />
            </div>

            <DragOverlay>
                {activeDragItem ? (
                    <div className="w-32 h-20 bg-primary/20 backdrop-blur-md border border-primary rounded-lg shadow-2xl flex items-center justify-center pointer-events-none cursor-grabbing z-50 transform rotate-3">
                        {activeDragItem.thumbnail ? <img src={activeDragItem.thumbnail} className="w-full h-full object-cover opacity-80" /> : <Video className="w-8 h-8 text-primary" />}
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
};

const SkipBack = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" x2="5" y1="19" y2="5"/></svg>
const SkipForward = (props) => <svg {...props} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>

export default IDELayout;
