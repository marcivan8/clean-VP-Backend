import React, { useRef, useEffect } from 'react';
import { PanelLeft, Sparkles, Video, Play, Pause, Maximize2, Scissors, Music, Layers, Settings, Share, Menu, Upload, Palette, X, Puzzle, Move } from 'lucide-react';
import classNames from 'classnames';
import { Player } from '@revideo/player-react';
import project from '../revideo/project';
import SettingsPanel from '../components/SettingsPanel';
import useTimelineStore from '../store/useTimelineStore';
import ErrorBoundary from '../components/ErrorBoundary';
import Timeline from '../components/Timeline/Timeline';
import ReasoningPanel from '../components/Assistant/ReasoningPanel';
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor } from '@dnd-kit/core';
import DraggableAsset from '../components/DraggableAsset';
import DraggableEffect from '../components/DraggableEffect';
import TextPanel from '../components/TextPanel';
import MobileBottomNav from '../components/MobileBottomNav';
import useDeviceType from '../hooks/useDeviceType';
import MixerPanel from '../components/Sidebar/MixerPanel';
import ExportModal from '../components/ExportModal';
import { Type, Cpu, TrendingUp, GitCompare } from 'lucide-react';
import { EffectsPanel } from '../components/Effects';
import { ClarificationDialog } from '../components/ClarificationDialog';
import { ApprovalDialog } from '../components/ApprovalDialog';
import { probeMedia } from '../utils/mediaProbe';
import ProxyService from '../services/proxyService';
import { ViralIntelligencePanel } from '../components/ViralIntelligencePanel';
import { ABTestPanel } from '../components/ABTestPanel';
import { PresetMarketplace } from '../components/PresetMarketplace';
import { AutonomousEditingPanel } from '../components/AutonomousEditingPanel';
import useEditorStore from '../store/useEditorStore';
import PresetSystem from '../presets/PresetSystem';

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

const IDELayout = ({ children, mode = 'editor' }) => {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    useTimelineStore.getState().redo();
                } else {
                    useTimelineStore.getState().undo();
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                useTimelineStore.getState().redo();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const {
        isPlaying, setUploadedFile, updateClip, uploadedFile,
        aspectRatio, assets, addAssets, addClip, zoomLevel, tracks, activeClipId,
        setActiveClip, past, future, duration, currentTime
    } = useTimelineStore();

    const { activeClip, activeTrackId } = React.useMemo(() => {
        if (!activeClipId) return { activeClip: null, activeTrackId: null };
        for (const track of tracks) {
            const clip = track.clips.find(c => c.id === activeClipId);
            if (clip) return { activeClip: clip, activeTrackId: track.id };
        }
        return { activeClip: null, activeTrackId: null };
    }, [tracks, activeClipId]);

    const playerVariables = React.useMemo(() => {
        return {
            tracks: tracks.map((t, idx) => {
                const isAnySolo = tracks.some(tr => tr.solo);
                const shouldMute = t.muted || (isAnySolo && !t.solo);
                const rawVol = t.volume !== undefined ? t.volume : 1;
                const trackVol = shouldMute ? 0 : rawVol;

                return {
                    id: t.id,
                    type: t.type,
                    order: t.order ?? idx,
                    clips: t.clips.map(c => {
                        const sourceAsset = assets.find(a => a.id === c.assetId);
                        const activeUrl = sourceAsset?.proxyUrl || c.proxyUrl || sourceAsset?.fileUrl || c.url || c.fileUrl;
                        return {
                            ...c,
                            type: t.type || c.type,
                            globalVolume: trackVol,
                            url: activeUrl || ""
                        };
                    })
                };
            }),
            duration: duration,
            aspectRatio: aspectRatio,
            fps: 30
        };
    }, [tracks, duration, aspectRatio, assets]);

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
    const [mobileTab, setMobileTab] = React.useState('ai'); // Default to AI on mobile as per user preference

    const fileInputRef = useRef(null);

    const [isExporting, setIsExporting] = React.useState(false);
    const [exportUrl, setExportUrl] = React.useState(null);
    const [exportResult, setExportResult] = React.useState(null);
    const [exportError, setExportError] = React.useState(null);
    const [showExportModal, setShowExportModal] = React.useState(false);

    const [activeTab, setActiveTab] = React.useState('media');
    const [activeColorRange, setActiveColorRange] = React.useState('reds');
    const [openMenu, setOpenMenu] = React.useState(null);
    // Phase 7 state
    const [showPresetMarketplace, setShowPresetMarketplace] = React.useState(false);

    const projectLoaderRef = useRef(null);
    const playerRef = useRef(null);

    const handlePlayerReady = (revideoPlayer) => {
        playerRef.current = revideoPlayer;
        useTimelineStore.getState().setPlayerRef(revideoPlayer);
        console.log("[IDELayout] Revideo Player Ready", revideoPlayer);
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
            const hasExistingClips = useTimelineStore.getState().tracks.some(t => t.clips && t.clips.length > 0);
            let ratioSet = hasExistingClips;

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

                processedAssets.push({
                    id: assetId,
                    name: file.name,
                    type: isVideo ? 'video' : file.type.startsWith('image') ? 'image' : 'audio',
                    url: url,
                    file: file,
                    proxyUrl: null,
                    isProxying: isVideo,
                    thumbnail: metadata.thumbnail,
                    sourceDuration: metadata.duration,
                    duration: metadata.duration,
                    fps: metadata.fps,
                    resolution: metadata.width && metadata.height ? { w: metadata.width, h: metadata.height } : null
                });

                if (isVideo) {
                    ProxyService.uploadAndGenerateProxy(file, 'demo-user')
                        .then(data => {
                            if (!data) {
                                console.warn('[IDELayout] Proxy job resolved with null result — job may have completed before SSE could read returnvalue');
                                useTimelineStore.getState().updateAsset(assetId, { isProxying: false });
                                return;
                            }
                            console.log(`[IDELayout] Proxy Ready: ${data.proxyUrl}`);
                            useTimelineStore.getState().updateAsset(assetId, {
                                proxyUrl: data.proxyUrl,
                                isProxying: false
                            });
                            // Store uploads-relative raw file path so AI API calls (silence, filler,
                            // denoise) can locate the file on the server. proxyPath is returned by
                            // the worker; fall back to originalPath if an older worker omits it.
                            const rawFilePath = data.proxyPath || data.originalPath;
                            if (rawFilePath) {
                                useTimelineStore.getState().setUploadedFile({ name: rawFilePath });
                                useTimelineStore.getState().setUploadedFilePath(rawFilePath);
                                console.log(`[IDELayout] uploadedFile path set: ${rawFilePath}`);
                            } else {
                                console.warn('[IDELayout] Proxy job result missing proxyPath and originalPath — AI API calls will not work');
                            }
                        })
                        .catch(err => {
                            console.error(`[IDELayout] Proxy generation failed for ${file.name}`, err);
                            useTimelineStore.getState().updateAsset(assetId, { isProxying: false });
                        });
                }
            }

            addAssets(processedAssets);
            console.log("✅ Store updated with assets and metadata", processedAssets);
        }
    };

    const triggerImport = () => {
        fileInputRef.current.click();
    };

    const handleExportConfirm = async (settings) => {
        const { tracks, duration } = useTimelineStore.getState();
        setIsExporting(true);
        setExportResult(null);
        setExportError(null);
        setExportUrl(null);

        try {
            // Attach auth token if one exists in localStorage
            const headers = { 'Content-Type': 'application/json' };
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) {
                        const parsed = JSON.parse(localStorage.getItem(key) || '{}');
                        if (parsed?.access_token) {
                            headers['Authorization'] = `Bearer ${parsed.access_token}`;
                            break;
                        }
                    }
                }
            } catch (_) { /* no token — dev mode, route uses optionalAuth */ }

            // POST to /api/render — the FFmpeg export engine mounted in exportRoutes.js
            const response = await fetch('/api/render', {
                method: 'POST',
                headers,
                body: JSON.stringify({ timeline: { tracks, duration }, settings })
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Export failed');
            setExportResult(data);
            setExportUrl(data.url);
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

            {/* Phase 7: Preset Marketplace Modal */}
            <PresetMarketplace
                isOpen={showPresetMarketplace}
                onClose={() => setShowPresetMarketplace(false)}
                onApplyPreset={(preset) => {
                    const ops = PresetSystem.apply(preset.id);
                    console.log('[IDELayout] Applying preset:', preset.name, ops);
                }}
            />

            {/* Phase 7: Autonomous Editing Panel (floating) */}
            <AutonomousEditingPanel />

            <div className="h-screen w-screen overflow-hidden flex flex-col font-sans selection:bg-primary/30 text-foreground" style={{ background: "linear-gradient(180deg, var(--bg-2), var(--bg-3))" }}>
                {/* ── Background Aurora Glows ── */}
                <div className="pointer-events-none fixed inset-0 overflow-hidden z-0" aria-hidden="true">
                    <div className="absolute rounded-full blur-[120px]" style={{ width: "50vw", height: "50vw", top: "-20vw", left: "40vw", background: "var(--accent)", opacity: 0.12 }} />
                    <div className="absolute rounded-full blur-[120px]" style={{ width: "40vw", height: "40vw", bottom: "-30vw", left: "-10vw", background: "var(--violet)", opacity: 0.10 }} />
                </div>
                {/* Top Bar */}
                <header className="h-10 border-b flex items-center justify-between px-3 z-20 shrink-0 relative" style={{ background: "var(--bg)", borderColor: "var(--line-soft)" }}>
                    {/* Left: traffic lights + breadcrumb */}
                    <div className="flex items-center gap-2 min-w-0">
                        <div className="hidden md:flex items-center gap-1.5 shrink-0">
                            <div className="studio-traffic-dot" style={{ background: "#ff5f57" }} />
                            <div className="studio-traffic-dot" style={{ background: "#febc2e" }} />
                            <div className="studio-traffic-dot" style={{ background: "#28c840" }} />
                        </div>
                        <button className="md:hidden p-1.5 -ml-1 text-muted-foreground" onClick={() => setShowSidebar(!showSidebar)}>
                            <Menu className="w-4 h-4" />
                        </button>
                        {/* Breadcrumb */}
                        <div className="hidden md:flex items-center gap-1.5 min-w-0" style={{ fontFamily: "var(--f-mono)", fontSize: 11 }}>
                            <button onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')} className="flex items-center gap-1 hover:opacity-80 transition-opacity shrink-0" style={{ color: "var(--fg-3)" }}>
                                <span style={{ fontSize: 10 }}>←</span>
                                <span>Marketing</span>
                            </button>
                            {openMenu === 'file' && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                    <div className="absolute top-full left-8 mt-1 w-48 border shadow-xl rounded-md py-1 z-50 flex flex-col" style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}>
                                        <button onClick={() => { if (confirm("New project? Current timeline will be cleared.")) { useTimelineStore.getState().loadProject({ tracks: [], duration: 60 }); } setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">New Project</button>
                                        <button onClick={() => { projectLoaderRef.current.click(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Open Project...</button>
                                        <div className="h-px my-1" style={{ background: "var(--line)" }} />
                                        <button onClick={() => { const data = useTimelineStore.getState().saveProject(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `project-${Date.now()}.json`; a.click(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Save Project</button>
                                        <div className="h-px my-1" style={{ background: "var(--line)" }} />
                                        <button onClick={() => { triggerImport(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Import Media...</button>
                                        <button onClick={() => { setShowExportModal(true); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Export Video</button>
                                    </div>
                                </>
                            )}
                            <span style={{ color: "var(--fg-4)" }}>/</span>
                            <button onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')} className="hover:opacity-80 truncate max-w-[180px]" style={{ color: "var(--fg-2)" }}>
                                The North Wind · Ep. 03
                            </button>
                            {openMenu === 'edit' && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                    <div className="absolute top-full left-32 mt-1 w-48 border shadow-xl rounded-md py-1 z-50 flex flex-col" style={{ background: "var(--bg-2)", borderColor: "var(--line)" }}>
                                        <button onClick={() => { useTimelineStore.getState().undo(); setOpenMenu(null); }} disabled={past.length === 0} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">Undo (Ctrl+Z)</button>
                                        <button onClick={() => { useTimelineStore.getState().redo(); setOpenMenu(null); }} disabled={future.length === 0} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">Redo (Ctrl+Y)</button>
                                        <div className="h-px my-1" style={{ background: "var(--line)" }} />
                                        <button onClick={() => { useTimelineStore.getState().copyClip(activeClipId); setOpenMenu(null); }} disabled={!activeClip} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">Copy</button>
                                        <button onClick={() => { useTimelineStore.getState().pasteClip(currentTime); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Paste</button>
                                        <button onClick={() => { if (activeClip && activeTrackId) { useTimelineStore.getState().removeClip(activeTrackId, activeClip.id); } setOpenMenu(null); }} disabled={!activeClip} className="px-4 py-2 text-xs text-left hover:bg-red-500/10 text-red-400 transition-colors disabled:opacity-50">Delete</button>
                                    </div>
                                </>
                            )}
                            <span style={{ color: "var(--fg-4)" }}>·</span>
                            <span style={{ color: "var(--fg-4)" }}>v.143</span>
                            <span style={{ color: "var(--fg-4)" }}>·</span>
                            <span style={{ color: "var(--fg-4)" }}>auto-saved 12s ago</span>
                        </div>
                        <h1 className="md:hidden font-bold text-xs" style={{ fontFamily: "var(--f-mono)" }}>VIBED</h1>
                    </div>

                    <input type="file" ref={projectLoaderRef} className="hidden" accept=".json" onChange={(e) => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            try { useTimelineStore.getState().loadProject(JSON.parse(ev.target.result)); }
                            catch { alert("Invalid Project File"); }
                        };
                        reader.readAsText(file);
                    }} />

                    {/* Right: live indicator + actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setShowAI(!showAI)} className="md:hidden p-1.5 text-muted-foreground">
                            <Sparkles className="w-4 h-4" />
                        </button>
                        <div className="hidden md:flex items-center gap-1.5" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)" }}>
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#28c840", boxShadow: "0 0 6px #28c840", animation: "pulse-soft 3s infinite" }} />
                            <span>Live · 3 collaborators</span>
                        </div>
                        <button className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded text-xs transition-colors hover:opacity-80" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-2)", border: "0.5px solid var(--line)", background: "transparent" }}>
                            Share
                        </button>
                        <button onClick={() => setShowExportModal(true)} disabled={isExporting} className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-all disabled:opacity-50" style={{ fontFamily: "var(--f-mono)", fontSize: 10, background: "var(--fg)", color: "var(--bg)", letterSpacing: "0.02em" }}>
                            {isExporting ? "Rendering…" : "Export ↗"}
                        </button>
                        {exportUrl && (
                            <a href={exportUrl} download className="text-[10px] text-green-400 hover:text-green-300 underline" onClick={() => setExportUrl(null)}>Download</a>
                        )}
                    </div>
                </header>

                {/* Main Workspace */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative pb-[64px] md:pb-0">

                    {/* Left Sidebar — Project Browser */}
                    <aside
                        className={classNames(
                            "flex flex-col z-30 transition-transform duration-300 ease-in-out shrink-0 overflow-hidden",
                            "absolute inset-0 md:static md:translate-x-0 w-full md:shadow-none",
                            "md:w-[218px]",
                            (!isMobile || mobileTab === 'media') ? "translate-x-0" : "-translate-x-full"
                        )}
                        style={{ background: "var(--bg)", borderRight: "0.5px solid var(--line-soft)" }}
                    >
                        <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept="video/*,audio/*,image/*" multiple />

                        <div className="flex-1 overflow-y-auto">

                            {/* PROJECT section */}
                            <div className="px-4 pt-4 pb-1">
                                <span className="studio-mono-label">Project</span>
                            </div>
                            {[
                                { name: "The North Wind · Ep. 03", colors: ["#4B6FE4","#7B5CE4"], active: true },
                                { name: "Ep. 02 · master",          colors: ["#E4764B","#E45B7B"], active: false },
                                { name: "Title cards",               colors: ["#4BE4B6","#4B9AE4"], active: false },
                            ].map((p) => (
                                <div key={p.name} className="flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-md cursor-pointer transition-colors" style={{ background: p.active ? "var(--glass-2)" : "transparent" }}>
                                    <div className="w-[22px] h-[22px] rounded-[5px] shrink-0" style={{ background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]})` }} />
                                    <span className="text-xs truncate" style={{ color: p.active ? "var(--fg)" : "var(--fg-3)", fontFamily: "var(--f-sans)" }}>{p.name}</span>
                                </div>
                            ))}

                            {/* BIN section */}
                            <div className="px-4 pt-4 pb-1 flex items-center justify-between">
                                <span className="studio-mono-label">Bin · {assets.length || 8} Clips</span>
                                <button onClick={triggerImport} className="transition-opacity hover:opacity-80" style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                    + Import
                                </button>
                            </div>
                            {assets.length === 0 ? (
                                // Placeholder clips matching the design
                                [
                                    { name: "Cold open",        time: "00:20", colors: ["#3B5BE4","#5B3BE4"] },
                                    { name: "Interview · Mara", time: "00:27", colors: ["#5B4BE4","#7B4BE4"], active: true },
                                    { name: "B-roll · harbour", time: "00:34", colors: ["#3B7BE4","#3B5BE4"] },
                                    { name: "Drone · sunrise",  time: "00:41", colors: ["#4B3BE4","#3B5BE4"] },
                                    { name: "Score · stems",    time: "00:48", colors: ["#3BE4B6","#3B7BE4"] },
                                    { name: "Voiceover v3",     time: "00:55", colors: ["#5B3BE4","#8B3BE4"] },
                                    { name: "B-roll · streets", time: "01:02", colors: ["#3B4BE4","#1B3BE4"] },
                                    { name: "Archive · 1972",   time: "01:09", colors: ["#1B2BE4","#0B1BE4"] },
                                ].map((clip) => (
                                    <div key={clip.name} className="flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-md cursor-pointer group transition-colors" style={{ background: clip.active ? "color-mix(in oklch, var(--accent) 14%, transparent)" : "transparent" }}>
                                        <div className="w-[22px] h-[22px] rounded-[4px] shrink-0" style={{ background: `linear-gradient(135deg, ${clip.colors[0]}, ${clip.colors[1]})` }} />
                                        <span className="text-xs flex-1 truncate" style={{ color: clip.active ? "var(--fg)" : "var(--fg-2)", fontFamily: "var(--f-sans)", fontSize: 12 }}>{clip.name}</span>
                                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: clip.active ? "var(--fg-3)" : "var(--fg-4)", flexShrink: 0 }}>{clip.time}</span>
                                    </div>
                                ))
                            ) : (
                                assets.map((asset, i) => {
                                    const GRADS = [
                                        ["#3B5BE4","#5B3BE4"],["#5B4BE4","#7B4BE4"],["#3B7BE4","#3B5BE4"],
                                        ["#4B3BE4","#3B5BE4"],["#3BE4B6","#3B7BE4"],["#5B3BE4","#8B3BE4"],
                                        ["#3B4BE4","#1B3BE4"],["#1B2BE4","#0B1BE4"],
                                    ];
                                    return (
                                        <DraggableAsset
                                            key={asset.id}
                                            asset={asset}
                                            listView={true}
                                            gradientColors={GRADS[i % GRADS.length]}
                                            isActive={asset.id === activeClipId}
                                        />
                                    );
                                })
                            )}

                            {/* SAVED VARIANTS section */}
                            <div className="px-4 pt-4 pb-1">
                                <span className="studio-mono-label">Saved Variants</span>
                            </div>
                            {[
                                { name: "Director's cut",   colors: ["#28c840","#3B7BE4"] },
                                { name: "9:16 · TikTok set",colors: ["#E4764B","#E45B9B"] },
                                { name: "Cinema 2.39:1",    colors: ["#5B4BE4","#3B1BE4"] },
                            ].map((v) => (
                                <div key={v.name} className="flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-md cursor-pointer transition-colors hover:bg-[var(--glass)]">
                                    <div className="w-[22px] h-[22px] rounded-[5px] shrink-0" style={{ background: `linear-gradient(135deg, ${v.colors[0]}, ${v.colors[1]})` }} />
                                    <span className="text-xs truncate" style={{ color: "var(--fg-3)", fontFamily: "var(--f-sans)", fontSize: 12 }}>{v.name}</span>
                                </div>
                            ))}

                            {/* Adjustments panel — shown when a clip is selected */}
                            {activeClip && (
                                <div className="mt-4 mx-2 mb-4 rounded-lg overflow-hidden" style={{ border: "0.5px solid var(--line)" }}>
                                    <div className="flex items-center gap-1 overflow-x-auto no-scrollbar px-2 pt-2 pb-1" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                                        {['effects','color','text','audio','transform','settings'].map(tab => (
                                            <button key={tab} onClick={() => tab === 'settings' ? setActiveTab('settings') : setActiveTab(tab)} className={classNames("studio-tab-btn", activeTab === tab && "active")} style={{ fontSize: 9 }}>
                                                {tab === 'effects' && <Sparkles className="w-2 h-2" />}
                                                {tab === 'color' && <Palette className="w-2 h-2" />}
                                                {tab === 'text' && <Type className="w-2 h-2" />}
                                                {tab === 'audio' && <span style={{ fontSize: 8 }}>🎤</span>}
                                                {tab === 'transform' && <Move className="w-2 h-2" />}
                                                {tab === 'settings' && <Settings className="w-2 h-2" />}
                                                {tab}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="p-3" style={{ background: "var(--bg-2)" }}>
                                        {activeTab === 'effects' && <EffectsPanel targetId={activeClipId} playbackEngine={useTimelineStore.getState().playbackEngine} playhead={currentTime} className="h-full" />}
                                        {activeTab === 'color' && (
                                            <div className="space-y-3">
                                                {[
                                                    { key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
                                                    { key: 'contrast',   label: 'Contrast',   min: 0, max: 200, unit: '%' },
                                                    { key: 'saturate',   label: 'Saturation', min: 0, max: 200, unit: '%' },
                                                    { key: 'hueRotate',  label: 'Hue',        min: 0, max: 360, unit: '°' },
                                                ].map(({ key, label, min, max, unit }) => (
                                                    <div key={key} className="space-y-1">
                                                        <div className="flex justify-between" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)" }}>
                                                            <span>{label}</span>
                                                            <span>{(activeClip.grading?.[key] ?? (key === 'hueRotate' ? 0 : 100))}{unit}</span>
                                                        </div>
                                                        <input type="range" min={min} max={max} value={activeClip.grading?.[key] ?? (key === 'hueRotate' ? 0 : 100)} onChange={(e) => handleGradingChange(key, parseInt(e.target.value))} className="w-full accent-primary h-1 rounded-full appearance-none cursor-pointer" style={{ background: "var(--bg-3)" }} />
                                                    </div>
                                                ))}
                                                <button onClick={() => updateClip(activeTrackId, activeClip.id, { grading: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 }, filter: 'none' })} className="w-full py-1 text-[10px] rounded transition-colors" style={{ background: "var(--glass)", color: "var(--fg-3)", fontFamily: "var(--f-mono)" }}>Reset</button>
                                            </div>
                                        )}
                                        {activeTab === 'text' && <TextPanel />}
                                        {activeTab === 'audio' && <MixerPanel />}
                                        {activeTab === 'transform' && (
                                            <div className="space-y-3">
                                                {[
                                                    { key: 'scale', label: 'Scale', min: 10, max: 300, toDisplay: v => Math.round((v||1)*100), unit: '%', fromDisplay: v => v/100 },
                                                    { key: 'x',     label: 'X',     min: -1920, max: 1920, toDisplay: v => v||0, unit: 'px', fromDisplay: v => v },
                                                    { key: 'y',     label: 'Y',     min: -1080, max: 1080, toDisplay: v => v||0, unit: 'px', fromDisplay: v => v },
                                                    { key: 'rotation', label: 'Rotate', min: -180, max: 180, toDisplay: v => v||0, unit: '°', fromDisplay: v => v },
                                                ].map(({ key, label, min, max, toDisplay, unit, fromDisplay }) => (
                                                    <div key={key} className="space-y-1">
                                                        <div className="flex justify-between" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-3)" }}>
                                                            <span>{label}</span><span>{toDisplay(activeClip[key])}{unit}</span>
                                                        </div>
                                                        <input type="range" min={min} max={max} value={toDisplay(activeClip[key])} onChange={(e) => updateClip(activeTrackId, activeClip.id, { [key]: fromDisplay(parseInt(e.target.value)) })} className="w-full accent-primary h-1 rounded-full appearance-none cursor-pointer" style={{ background: "var(--bg-3)" }} />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        {activeTab === 'settings' && <SettingsPanel />}
                                    </div>
                                </div>
                            )}

                            <div className="h-6" />
                        </div>
                    </aside>

                    {showSidebar && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setShowSidebar(false)} />}

                    {/* Center — Viewport & Timeline */}
                    <main className={classNames(
                        "flex-1 flex flex-col min-w-0 relative",
                        isMobile && mobileTab !== 'player' && mobileTab !== 'edit' ? "hidden" : "flex"
                    )}>
                        {/* Viewer */}
                        <div className={classNames(
                            "flex-1 flex items-center justify-center p-3 md:p-5 relative overflow-hidden",
                            isMobile && mobileTab === 'edit' ? "hidden" : "flex"
                        )} style={{ background: "radial-gradient(60% 80% at 50% 40%, #1c1f24 0%, #0c0d10 100%)" }}>
                            <div className={classNames(
                                "relative overflow-hidden shadow-2xl transition-all duration-500 ease-in-out",
                                aspectRatio === '9:16'
                                    ? 'aspect-[9/16] max-h-[calc(100vh-340px)] w-auto rounded-md'
                                    : aspectRatio === '1:1'
                                        ? 'aspect-square max-h-[calc(100vh-340px)] w-auto rounded-md'
                                        : 'aspect-video w-full max-h-[calc(100vh-340px)] rounded-md'
                            )} style={{ border: "0.5px solid rgba(255,255,255,0.06)", background: "#000" }}>
                                <ErrorBoundary>
                                    {(() => {
                                        const dims = getPlayerDimensions(aspectRatio);
                                        if (project && project.settings && project.settings.shared) {
                                            const v = project.settings.shared.size;
                                            if (v) { v.x = dims.width; v.y = dims.height; }
                                            else { project.settings.shared.size = { x: dims.width, y: dims.height }; }
                                        }
                                        return (
                                            <Player
                                                key={`player-${aspectRatio}`}
                                                onPlayerReady={handlePlayerReady}
                                                playing={isPlaying}
                                                controls={false}
                                                currentTime={currentTime}
                                                onTimeUpdate={(time) => { useTimelineStore.setState({ currentTime: time }); }}
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

                                {/* Timecode overlays */}
                                <div className="absolute top-2.5 left-3 pointer-events-none" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "rgba(255,255,255,0.65)", letterSpacing: "0.04em" }}>
                                    A001_C012 · <VideoTimeDisplay />
                                </div>
                                <div className="absolute top-2.5 right-3 pointer-events-none" style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "rgba(255,255,255,0.45)", letterSpacing: "0.04em" }}>
                                    ARRI 4.6K · ProRes 422 HQ
                                </div>
                            </div>

                            {/* Playback controls — centered below viewer */}
                            <div className="absolute bottom-4 flex items-center gap-3 px-4 py-1.5 rounded-full z-20" style={{ background: "rgba(14,15,17,0.85)", border: "0.5px solid var(--line-strong)", backdropFilter: "blur(12px)" }}>
                                <button onClick={() => useTimelineStore.getState().seek(0)} className="transition-colors hover:text-primary" style={{ color: "var(--fg-3)" }}><SkipBack /></button>
                                <button onClick={() => useTimelineStore.getState().togglePlay()} className="transition-colors hover:text-primary w-7 h-7 rounded-full flex items-center justify-center" style={{ color: "var(--fg)", background: "var(--glass-2)" }}>
                                    {!isPlaying ? <Play className="w-3.5 h-3.5 fill-current ml-0.5" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                                </button>
                                <button className="transition-colors hover:text-primary" style={{ color: "var(--fg-3)" }}><SkipForward /></button>
                            </div>
                        </div>

                        {/* Timeline */}
                        {mode === 'editor' && (!isMobile || mobileTab === 'edit') && (
                            <div className={classNames(
                                "border-t flex flex-col overflow-hidden shrink-0",
                                isMobile ? "flex-1 h-full" : "h-[185px]"
                            )} style={{ background: "var(--bg)", borderColor: "var(--line-soft)" }}>
                                <Timeline />
                            </div>
                        )}
                    </main>

                    {/* Right Sidebar — AI Assistant */}
                    <aside
                        className={classNames(
                            "flex flex-col z-30 transition-transform duration-300 ease-in-out shrink-0",
                            "absolute inset-0 md:static w-full md:w-[280px] shadow-2xl md:shadow-none",
                            (!isMobile && showAI) || (isMobile && mobileTab === 'ai') ? "translate-x-0" : "translate-x-full md:translate-x-0"
                        )}
                        style={{ background: "var(--bg)", borderLeft: "0.5px solid var(--line-soft)" }}
                    >
                        {/* Assistant header */}
                        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
                            <div className="flex items-center gap-2.5">
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "color-mix(in oklch, var(--accent) 20%, var(--bg-2))", border: "0.5px solid color-mix(in oklch, var(--accent) 30%, transparent)" }}>
                                    <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-xs font-semibold leading-none" style={{ color: "var(--fg)" }}>Assistant</span>
                                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, color: "var(--fg-4)", letterSpacing: "0.04em" }}>respects your taste</span>
                                </div>
                            </div>
                            <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", padding: "2px 6px", border: "0.5px solid var(--line)", borderRadius: 4 }}>⌘ /</span>
                        </div>
                        <div className="flex-1 overflow-hidden h-full">
                            <ReasoningPanel />
                        </div>
                    </aside>
                </div>
                
                {/* Mobile Bottom Navigation */}
                <MobileBottomNav activeTab={mobileTab} onTabChange={setMobileTab} />
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
