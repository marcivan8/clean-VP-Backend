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
import MixerPanel from '../components/Sidebar/MixerPanel';
import ExportModal from '../components/ExportModal';
import DebugPanel from '../components/DebugPanel';
import { Type, Bug, Cpu, TrendingUp, GitCompare } from 'lucide-react';
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

    const fileInputRef = useRef(null);

    const [isExporting, setIsExporting] = React.useState(false);
    const [exportUrl, setExportUrl] = React.useState(null);
    const [exportResult, setExportResult] = React.useState(null);
    const [exportError, setExportError] = React.useState(null);
    const [showExportModal, setShowExportModal] = React.useState(false);
    const [showDebug, setShowDebug] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState('media');
    const [activeColorRange, setActiveColorRange] = React.useState('reds');
    const [openMenu, setOpenMenu] = React.useState(null);
    // Phase 7 state
    const [showPresetMarketplace, setShowPresetMarketplace] = React.useState(false);
    const [rightPanelTab, setRightPanelTab] = React.useState('ai'); // 'ai' | 'viral' | 'ab'
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
                            console.log(`[IDELayout] Proxy Ready: ${data.proxyUrl}`);
                            useTimelineStore.getState().updateAsset(assetId, {
                                proxyUrl: data.proxyUrl,
                                isProxying: false
                            });
                            // Store the backend path so AI commands can reference it
                            useTimelineStore.getState().setUploadedFile({ 
                                name: `uploads/${data.proxyPath}` 
                            });
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
            const response = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
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
            {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
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

            <div className="h-screen w-screen bg-background text-foreground flex flex-col overflow-hidden font-sans">
                {/* Top Bar */}
                <header className="h-14 md:h-12 border-b border-border flex items-center justify-between px-4 bg-card z-20 shrink-0">
                    <div className="flex items-center gap-3">
                        <button className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground" onClick={() => setShowSidebar(!showSidebar)}>
                            <Menu className="w-5 h-5" />
                        </button>
                        <div className="bg-primary/10 p-1.5 rounded-md hidden md:block">
                            <Video className="w-5 h-5 text-primary" />
                        </div>
                        <h1 className="font-bold text-sm tracking-wide truncate max-w-[150px] md:max-w-none">
                            VIRAL PILOT <span className="text-muted-foreground font-normal ml-2 hidden sm:inline">Untitled Project</span>
                        </h1>
                    </div>

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
                                File
                            </button>
                            {openMenu === 'file' && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-card border border-border shadow-xl rounded-md py-1 z-50 flex flex-col">
                                        <button onClick={() => { if (confirm("New project? Current timeline will be cleared.")) { useTimelineStore.getState().loadProject({ tracks: [], duration: 60 }); } setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">New Project</button>
                                        <button onClick={() => { projectLoaderRef.current.click(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Open Project...</button>
                                        <div className="h-px bg-border my-1" />
                                        <button onClick={() => { const data = useTimelineStore.getState().saveProject(); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `project-${Date.now()}.json`; a.click(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Save Project</button>
                                        <div className="h-px bg-border my-1" />
                                        <button onClick={() => { triggerImport(); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Import Media...</button>
                                        <button onClick={() => { setShowExportModal(true); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Export Video</button>
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
                                Edit
                            </button>
                            {openMenu === 'edit' && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                    <div className="absolute top-full left-0 mt-1 w-48 bg-card border border-border shadow-xl rounded-md py-1 z-50 flex flex-col">
                                        <button onClick={() => { useTimelineStore.getState().undo(); setOpenMenu(null); }} disabled={past.length === 0} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">Undo (Ctrl+Z)</button>
                                        <button onClick={() => { useTimelineStore.getState().redo(); setOpenMenu(null); }} disabled={future.length === 0} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">Redo (Ctrl+Y)</button>
                                        <div className="h-px bg-border my-1" />
                                        <button onClick={() => { useTimelineStore.getState().copyClip(activeClipId); setOpenMenu(null); }} disabled={!activeClip} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors disabled:opacity-50">Copy</button>
                                        <button onClick={() => { useTimelineStore.getState().pasteClip(currentTime); setOpenMenu(null); }} className="px-4 py-2 text-xs text-left hover:bg-secondary transition-colors">Paste</button>
                                        <button onClick={() => { if (activeClip && activeTrackId) { useTimelineStore.getState().removeClip(activeTrackId, activeClip.id); } setOpenMenu(null); }} disabled={!activeClip} className="px-4 py-2 text-xs text-left hover:bg-red-500/10 text-red-400 transition-colors disabled:opacity-50">Delete</button>
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
                                catch { alert("Invalid Project File"); }
                            };
                            reader.readAsText(file);
                        }} />
                    </div>

                    <div className="flex items-center gap-2 md:gap-3">
                        <button onClick={() => setShowAI(!showAI)} className={classNames("md:hidden p-2 rounded-full transition-colors", showAI ? "bg-purple-500/20 text-purple-400" : "text-muted-foreground hover:bg-secondary")}>
                            <Sparkles className="w-5 h-5" />
                        </button>
                        <button onClick={() => setActiveTab('settings')} className={classNames("hidden md:block p-2 hover:bg-secondary rounded-full transition-colors", activeTab === 'settings' ? "bg-secondary text-foreground" : "")}>
                            <Settings className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <button onClick={() => setShowDebug(!showDebug)} className={classNames("hidden md:block p-2 hover:bg-secondary rounded-full transition-colors", showDebug ? "bg-red-500/20 text-red-500" : "text-muted-foreground hover:text-red-400")} title="Toggle Debug HUD">
                            <Bug className="w-4 h-4" />
                        </button>
                        <button onClick={() => setShowExportModal(true)} disabled={isExporting} className="bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 md:px-4 rounded-md text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-50">
                            {isExporting ? <span className="animate-spin">⏳</span> : <Share className="w-3 h-3" />}
                            {isExporting ? "Rendering..." : "Export"}
                        </button>
                        {exportUrl && (
                            <a href={exportUrl} download className="hidden md:block text-[10px] text-green-400 hover:text-green-300 underline" onClick={() => setExportUrl(null)}>Download</a>
                        )}
                    </div>
                </header>

                {/* Main Workspace */}
                <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">

                    {/* Left Sidebar */}
                    <aside className={classNames(
                        "bg-card border-r border-border md:w-72 flex flex-col z-30 transition-transform duration-300 ease-in-out font-sans",
                        "absolute inset-0 md:static md:translate-x-0 w-3/4 max-w-sm border-r shadow-2xl md:shadow-none",
                        showSidebar ? "translate-x-0" : "-translate-x-full"
                    )}>
                        <div className="md:hidden p-3 border-b border-border flex justify-between items-center bg-card">
                            <span className="font-bold text-sm">Tools</span>
                            <button onClick={() => setShowSidebar(false)}><X className="w-4 h-4" /></button>
                        </div>

                        <input type="file" ref={fileInputRef} onChange={handleFileImport} className="hidden" accept="video/*,audio/*,image/*" multiple />

                        <div className="p-3 border-b border-border flex gap-2 overflow-x-auto no-scrollbar">
                            {['media', 'effects', 'color', 'text', 'audio', 'transform', 'presets', 'settings'].map(tab => (
                                <button key={tab} onClick={() => tab === 'presets' ? setShowPresetMarketplace(true) : setActiveTab(tab)} className={classNames("px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap flex items-center gap-2", activeTab === tab ? "bg-secondary/50 text-foreground" : "hover:bg-secondary text-muted-foreground")}>
                                    {tab === 'media' && <Layers className="w-3 h-3" />}
                                    {tab === 'effects' && <Sparkles className="w-3 h-3" />}
                                    {tab === 'color' && <Palette className="w-3 h-3" />}
                                    {tab === 'text' && <Type className="w-3 h-3" />}
                                    {tab === 'audio' && <span>🎤</span>}
                                    {tab === 'transform' && <Move className="w-3 h-3" />}
                                    {tab === 'presets' && <span>🧩</span>}
                                    {tab === 'settings' && <Settings className="w-3 h-3" />}
                                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto pb-24 md:pb-20">
                            {activeTab === 'media' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Project Media</div>
                                        <button onClick={triggerImport} className="text-[10px] bg-primary/10 hover:bg-primary/20 text-primary px-2 py-1 rounded transition-colors flex items-center gap-1">
                                            <Upload className="w-3 h-3" /> Import
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        {assets.length === 0 && (
                                            <div onClick={triggerImport} className="aspect-video border border-dashed border-border rounded-md flex flex-col items-center justify-center text-muted-foreground hover:bg-secondary/30 cursor-pointer transition-colors p-4 text-center col-span-2">
                                                <Upload className="w-6 h-6 mb-2 opacity-50" />
                                                <span className="text-xs">Drop media here</span>
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
                                    <EffectsPanel targetId={activeClipId} playbackEngine={useTimelineStore.getState().playbackEngine} playhead={currentTime} className="h-full" />
                                </section>
                            )}

                            {activeTab === 'color' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Color Grading</div>
                                            {activeClip && <div className="text-[10px] text-green-400 font-mono">ACTIVE</div>}
                                        </div>
                                        {!activeClip ? (
                                            <div className="p-4 rounded-md border border-dashed border-border text-center">
                                                <p className="text-xs text-muted-foreground">Select a clip to adjust color.</p>
                                            </div>
                                        ) : (
                                            <>
                                                {[
                                                    { key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
                                                    { key: 'contrast', label: 'Contrast', min: 0, max: 200, unit: '%' },
                                                    { key: 'saturate', label: 'Saturation', min: 0, max: 200, unit: '%' },
                                                    { key: 'hueRotate', label: 'Hue Rotate', min: 0, max: 360, unit: '°' },
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
                                                    <button onClick={() => updateClip(activeTrackId, activeClip.id, { grading: { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 }, filter: 'none' })} className="w-full py-1.5 text-xs bg-secondary hover:bg-white/10 rounded text-muted-foreground transition-colors">Reset Color</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'text' && <section className="p-4 border-b border-border/50"><TextPanel /></section>}
                            {activeTab === 'audio' && <section className="p-4 border-b border-border/50"><MixerPanel /></section>}

                            {activeTab === 'transform' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Transform</div>
                                            {activeClip && <div className="text-[10px] text-green-400 font-mono">ACTIVE</div>}
                                        </div>
                                        {!activeClip ? (
                                            <div className="p-4 rounded-md border border-dashed border-border text-center"><p className="text-xs text-muted-foreground">Select a clip to transform.</p></div>
                                        ) : (
                                            <>
                                                {[
                                                    { key: 'scale', label: 'Scale', min: 10, max: 300, toDisplay: v => Math.round((v || 1) * 100), unit: '%', fromDisplay: v => v / 100 },
                                                    { key: 'x', label: 'Position X', min: -1920, max: 1920, toDisplay: v => v || 0, unit: 'px', fromDisplay: v => v },
                                                    { key: 'y', label: 'Position Y', min: -1080, max: 1080, toDisplay: v => v || 0, unit: 'px', fromDisplay: v => v },
                                                    { key: 'rotation', label: 'Rotation', min: -180, max: 180, toDisplay: v => v || 0, unit: '°', fromDisplay: v => v },
                                                ].map(({ key, label, min, max, toDisplay, unit, fromDisplay }) => (
                                                    <div key={key} className="space-y-2">
                                                        <div className="flex justify-between text-xs"><span>{label}</span><span className="text-muted-foreground">{toDisplay(activeClip[key])}{unit}</span></div>
                                                        <input type="range" min={min} max={max} value={toDisplay(activeClip[key])} onChange={(e) => updateClip(activeTrackId, activeClip.id, { [key]: fromDisplay(parseInt(e.target.value)) })} className="w-full accent-primary h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer" />
                                                    </div>
                                                ))}
                                                <div className="pt-4 border-t border-border">
                                                    <button onClick={() => updateClip(activeTrackId, activeClip.id, { scale: 1, x: 0, y: 0, rotation: 0 })} className="w-full py-1.5 text-xs bg-secondary hover:bg-white/10 rounded text-muted-foreground transition-colors">Reset Transform</button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </section>
                            )}

                            {activeTab === 'marketplace' && (
                                <section className="p-4 border-b border-border/50">
                                    <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold mb-3">Extensions</div>
                                    {[
                                        { id: 'ext-1', name: 'Auto Captions', desc: 'Generate captions with AI', icon: '💬', installed: true },
                                        { id: 'ext-2', name: 'Motion Graphics', desc: 'Pre-built motion templates', icon: '✨', installed: false },
                                        { id: 'ext-3', name: 'Sound FX Library', desc: '10,000+ royalty-free sounds', icon: '🔊', installed: false },
                                        { id: 'ext-4', name: 'Social Templates', desc: 'Templates for TikTok, Reels', icon: '📱', installed: true },
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
                                                {ext.installed ? 'Installed' : 'Install'}
                                            </button>
                                        </div>
                                    ))}
                                </section>
                            )}

                            {activeTab === 'settings' && <section className="p-4"><SettingsPanel /></section>}
                        </div>
                    </aside>

                    {showSidebar && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setShowSidebar(false)} />}

                    {/* Center — Viewport & Timeline */}
                    <main className="flex-1 flex flex-col min-w-0 bg-background/50 relative">
                        <div className="flex-1 flex items-center justify-center bg-black/20 md:p-8 p-4 relative overflow-hidden">
                            <div className={classNames(
                                "bg-black rounded-lg shadow-2xl relative border border-white/5 group overflow-hidden transition-all duration-500 ease-in-out",
                                aspectRatio === '9:16'
                                    ? 'aspect-[9/16] max-h-[70vh] md:max-h-[550px] w-auto'
                                    : aspectRatio === '1:1'
                                        ? 'aspect-square max-h-[50vh] md:max-h-[450px] w-auto'
                                        : 'aspect-video max-w-full max-h-full md:max-h-[60vh] w-auto'
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
                                            // FIX: Key only changes on aspectRatio, NOT on clip count.
                                            // Previously keyed on tracks.reduce(...clips.length) which caused
                                            // a full Revideo player remount (recompile) every time a clip
                                            // was added. That broke playback and caused 3-5s stutters.
                                            <Player
                                                key={`player-${aspectRatio}`}
                                                onPlayerReady={handlePlayerReady}
                                                playing={isPlaying}
                                                controls={false}
                                                currentTime={currentTime}
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
                            </div>

                            {/* Floating Playback Controls */}
                            <div className="absolute bottom-6 flex items-center gap-4 bg-black/80 backdrop-blur-md px-4 py-2 rounded-full border border-white/10 shadow-xl z-20 scale-90 md:scale-100 origin-bottom">
                                <button className="hover:text-primary transition-colors" onClick={() => useTimelineStore.getState().seek(0)}><SkipBack /></button>
                                <button className="hover:text-primary transition-colors" onClick={() => useTimelineStore.getState().togglePlay()}>
                                    {!isPlaying ? <Play className="fill-white" /> : <Pause className="fill-white" />}
                                </button>
                                <button className="hover:text-primary transition-colors"><SkipForward /></button>
                                <div className="w-px h-4 bg-white/20 mx-2"></div>
                                <VideoTimeDisplay />
                            </div>
                        </div>

                        {mode === 'editor' && (
                            <div className="h-48 md:h-72 border-t border-border bg-card flex flex-col overflow-hidden shrink-0">
                                <Timeline />
                            </div>
                        )}
                    </main>

                    {/* Right Sidebar — AI + Phase 7 panels */}
                    <aside className={classNames(
                        "bg-card border-l border-border md:w-80 flex flex-col z-30 transition-transform duration-300 ease-in-out font-sans",
                        "absolute inset-0 md:static translate-x-full md:translate-x-0 w-full md:w-80 border-l shadow-2xl md:shadow-none",
                        showAI ? "!translate-x-0" : ""
                    )}>
                        <div className="md:hidden p-3 border-b border-border flex justify-between items-center bg-card">
                            <span className="font-bold text-sm text-foreground">Assistant</span>
                            <button onClick={() => setShowAI(false)}><X className="w-4 h-4" /></button>
                        </div>
                        {/* Right panel tab switcher */}
                        <div className="flex px-4 pt-3 border-b border-border bg-card shrink-0 gap-6">
                            {[
                                { id: 'ai', label: 'Assistant', icon: Cpu },
                                { id: 'viral', label: 'Insights', icon: TrendingUp },
                                { id: 'ab', label: 'Iterations', icon: GitCompare }
                            ].map(p => {
                                const Icon = p.icon;
                                const isActive = rightPanelTab === p.id;
                                return (
                                    <button 
                                        key={p.id} 
                                        onClick={() => setRightPanelTab(p.id)}
                                        className={classNames(
                                            "flex items-center gap-2 pb-3 text-xs font-medium transition-colors relative",
                                            isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {p.label}
                                        {isActive && (
                                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex-1 overflow-hidden h-full">
                            {rightPanelTab === 'ai' && <ReasoningPanel />}
                            {rightPanelTab === 'viral' && (
                                <ViralIntelligencePanel
                                    onAnalyze={() => {
                                        const store = useEditorStore.getState();
                                        store.setIsAnalyzing(true);
                                        // Mock analysis — replace with real API call to /api/analyze
                                        setTimeout(() => {
                                            store.setViralAnalysis({
                                                hook:        { score: 72, grade: 'B', hasSpeech: true, hasFace: false, hasFastCuts: true, hasHookKeyword: true, matchedKeywords: ['watch this'], timestampedHooks: [{ time: 0.5, strength: 'MEDIUM', type: 'verbal_hook', keyword: 'watch this' }], suggestion: 'Strong hook — add a face for +10 points.' },
                                                pacing:      { score: 68, feedback: 'Good pacing for short-form.', deadMoments: [{ start: 8.2, end: 11.5, length: 3.3, severity: 'MEDIUM', reasons: ['no_speech','no_visual_cut'] }] },
                                                emotion:     { score: 60, dominantEmotion: 'neutral', feedback: 'Boost emotional energy.' },
                                                structure:   { score: 75, hasCTA: true, feedback: 'Good structure with CTA.' },
                                                platformFit: { tiktok: 78, reels: 72, shorts: 75, youtube: 52, pinterest: 45, linkedin: 38, bestPlatform: 'tiktok', optimizations: { tiktok: ['Add a face in the first second.'], reels: ['Shorten to under 90s.'], shorts: [], youtube: [], pinterest: [], linkedin: [] } },
                                                engagement:  { score: 71, tier: 'HIGH', tierColor: '#22c55e', breakdown: [{ label:'Hook', score:72, contribution:22, grade:'B', suggestion:'Add a face.' },{ label:'Pacing', score:68, contribution:14, grade:'C', suggestion:'More cuts.' },{ label:'Emotion', score:60, contribution:12, grade:'C', suggestion:null },{ label:'Structure', score:75, contribution:11, grade:'B', suggestion:null },{ label:'Platform Fit', score:78, contribution:12, grade:'B', suggestion:null }], actionItems: [{ priority:1, area:'Pacing', action:'Add more cuts every 2–3s.', impact:'MEDIUM' }] }
                                            });
                                        }, 2000);
                                    }}
                                    onSeek={(t) => useTimelineStore.getState().seek(t)}
                                />
                            )}
                            {rightPanelTab === 'ab' && <ABTestPanel />}
                        </div>
                    </aside>

                    {showAI && <div className="fixed inset-0 bg-black/50 z-20 md:hidden" onClick={() => setShowAI(false)} />}
                </div>
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
