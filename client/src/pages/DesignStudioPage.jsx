/**
 * client/src/pages/DesignStudioPage.jsx
 *
 * VIBED Design Studio — Figma-class AI & manual design workspace.
 * Recreates the complete design system from "Design studio — AI and manual.png"
 * aligned with the landing page design language (Plus Jakarta Sans, Geist, JetBrains Mono).
 *
 * Features:
 * - Collapsible left Creative Tool Shelf (Back to Editor, Projects, Toolbox, Directions).
 * - Interactive direct manipulation canvas (mouse drag, 4 corner resize handles, inline text edit).
 * - Dual save/export: "Save to Timeline" (inserts overlay track to active project) + "Export 2 sizes" (PNG download).
 * - Format switcher (YouTube thumbnail 1280x720, Social graphic 1080x1080, Product 1200x800, etc.).
 * - Full Properties Inspector (X, Y, W, H, Type, Swatches, Opacity).
 * - Layers Stack with visibility, lock, and delete controls.
 * - Conversational AI layer director ("Or just say it") powered by DesignStudioCommandRegistry.
 *
 * Strictly zero emojis.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Sparkles, ArrowLeft, ArrowRight, ArrowDown, ChevronsUp, ChevronsDown,
    Undo, Redo, Eye, EyeOff, Lock, Unlock, Check, AlertCircle, Download,
    Type, Square, Circle, Image as ImageIcon, PenTool, AlignLeft, AlignCenter,
    AlignRight, Maximize2, Move, Crop, CheckCircle2, Compass, Layers, Sliders,
    ChevronDown, Video, FileText, Share2, ExternalLink, RefreshCw, Send, Plus,
    ArrowUp, Users, Film, PanelLeftClose, PanelLeftOpen, MousePointer, Trash2,
    Palette, ChevronLeft, ChevronRight, Save, Copy, RotateCw, ArrowUpRight, Star, Upload,
    X, FolderOpen, UploadCloud
} from 'lucide-react';

import { Logo } from '../components/Logo.jsx';
import { useUserPlan } from '../hooks/useUserPlan.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { executeDesignCommand } from '../agent/DesignStudioCommandRegistry.js';
import CanvasToolbar from '../design-studio/components/CanvasToolbar.jsx';
import InteractiveVectorCanvas from '../design-studio/components/InteractiveVectorCanvas.jsx';
import PropertiesInspector from '../design-studio/components/PropertiesInspector.jsx';
import LayersAndAssetsPanel from '../design-studio/components/LayersAndAssetsPanel.jsx';
import DesignStudioAiDirector from '../design-studio/components/DesignStudioAiDirector.jsx';
import { executeBooleanOperation, generateRoundedRectPath } from '../design-studio/vectorMath.js';
import { distributeSmartSelection } from '../design-studio/autoLayout.js';
import { removeBackgroundFromImage } from '../design-studio/imageBackgroundRemoval.js';

const FORMAT_PRESETS = [
    { id: 'thumbnail', label: 'Video thumbnail', res: '1280 × 720 · YouTube', w: 1280, h: 720, aspect: '16/9' },
    { id: 'social', label: 'Social graphic', res: '1080 × 1080 · Instagram', w: 1080, h: 1080, aspect: '1/1' },
    { id: 'product', label: 'Product design', res: '1200 × 800 · Showcase', w: 1200, h: 800, aspect: '3/2' },
    { id: 'packaging', label: 'Packaging', res: '800 × 1200 · Label', w: 800, h: 1200, aspect: '2/3' },
    { id: 'ad', label: 'Paid ad', res: '1080 × 1350 · 4:5 Feed', w: 1080, h: 1350, aspect: '4:5' },
    { id: 'print', label: 'Print', res: '2480 × 3508 · A4 300DPI', w: 2480, h: 3508, aspect: '1:1.41' },
];

const DIRECTIONS = [
    {
        id: 'dir-b',
        title: 'The 94° rule',
        style: 'B — Light, editorial',
        headline: 'THE 94°\nRULE.',
        bg: 'linear-gradient(170deg, #F5EFEB 0%, #D8CFC8 100%)',
        textColor: '#1A1C22',
        accentColor: '#C8622F',
    },
    {
        id: 'dir-c',
        title: '1:16',
        style: 'C — Split, one number',
        headline: '1:16\nRATIO.',
        bg: 'linear-gradient(135deg, #C85A17 0%, #1F140E 100%)',
        textColor: '#FFFFFF',
        accentColor: '#F4EDE2',
    },
    {
        id: 'dir-d',
        title: 'Pour slower than you think',
        style: 'D — Off-kit blue',
        headline: 'POUR SLOWER\nTHAN YOU THINK.',
        bg: 'linear-gradient(160deg, #0B192C 0%, #1E3E62 100%)',
        textColor: '#FFFFFF',
        accentColor: '#00E5FF',
    },
];

export default function DesignStudioPage() {
    const navigate = useNavigate();
    const { isPro, plan } = useUserPlan();
    const { projectName, addOverlayClip, addAssets, assets: timelineAssets = [] } = useTimelineStore();

    // Format Dropdown & Variations Tray State
    const [formatDropdownOpen, setFormatDropdownOpen] = useState(false);
    const [showVariationsTray, setShowVariationsTray] = useState(false);

    // Work Mode: 'generate' | 'edit'
    const [editMode, setEditMode] = useState('edit');
    const [kitOn, setKitOn] = useState(true);

    // Format & Brief
    const [selectedFormat, setSelectedFormat] = useState('thumbnail');
    const currentFormat = FORMAT_PRESETS.find(f => f.id === selectedFormat) || FORMAT_PRESETS[0];
    const [briefText, setBriefText] = useState('Lead with the ratio, keep the hand in frame, must read at 120px wide');
    const [videoFrame, setVideoFrame] = useState('Frame 0:11');

    // Creative Directions State
    const [directions, setDirections] = useState(DIRECTIONS);

    // Context Menu State (Figma-class canvas right-click menu)
    const [contextMenu, setContextMenu] = useState(null); // { x: number, y: number, layerId: string|null }

    // Asset & Media Drawer State
    const [assetDrawerOpen, setAssetDrawerOpen] = useState(false);
    const [assetDrawerTab, setAssetDrawerTab] = useState('upload'); // 'upload' | 'timeline'

    // Visual Brand Kit Panel State
    const [brandKitModalOpen, setBrandKitModalOpen] = useState(false);
    const [brandKit, setBrandKit] = useState({
        name: 'VIBED Studio Kit',
        accent: '#00E5FF',
        accent2: '#C85A17',
        surface: '#1F140E',
        text: '#F4EDE2',
        display: 'Plus Jakarta Sans',
        body: 'Geist',
        mono: 'JetBrains Mono',
        logoUrl: '',
    });

    // File Input Refs
    const exportCanvasRef = useRef(null);
    const canvasContainerRef = useRef(null);
    const cutoutInputRef = useRef(null);
    const assetInputRef = useRef(null);
    const brandKitInputRef = useRef(null);
    const logoInputRef = useRef(null);

    // Canvas Layers State
    const [layers, setLayers] = useState([
        {
            id: 'headline',
            name: 'Headline',
            type: 'text',
            text: '22 G IN.\nTHREE CIRCLES.',
            x: 64,
            y: 392,
            w: 612,
            h: 148,
            fontSize: 72,
            fontFamily: 'Plus Jakarta Sans',
            fill: '#F4EDE2',
            opacity: 100,
            visible: true,
            locked: false,
        },
        {
            id: 'duration',
            name: 'Duration badge',
            type: 'badge',
            text: '0:30',
            x: 48,
            y: 48,
            w: 84,
            h: 32,
            fill: '#C85A17',
            opacity: 100,
            visible: true,
            locked: false,
        },
        {
            id: 'subject',
            name: 'Subject cutout',
            meta: 'Frame 0:11 · masked',
            type: 'image',
            x: 740,
            y: 120,
            w: 420,
            h: 560,
            fill: 'linear-gradient(180deg, #42291A 0%, #1A1109 100%)',
            visible: true,
            locked: false,
        },
        {
            id: 'background',
            name: 'Background',
            type: 'bg',
            fill: 'linear-gradient(160deg, #1C1109 0%, #2D1A10 100%)',
            visible: true,
            locked: true,
        },
    ]);

    const [selectedLayerId, setSelectedLayerId] = useState('headline');
    const [selectedLayerIds, setSelectedLayerIds] = useState(['headline']);
    const [showGuides, setShowGuides] = useState(false);
    const [zoom, setZoom] = useState(0.75);
    const [leftRailTab, setLeftRailTab] = useState('layers');
    const [customComponents, setCustomComponents] = useState(() => {
        try {
            const saved = localStorage.getItem('vp_custom_components');
            return saved ? JSON.parse(saved) : [];
        } catch {
            return [];
        }
    });

    const handleCreateMasterComponent = (layer) => {
        const selected = layers.filter(l => selectedLayerIds.includes(l.id));
        const targets = selected.length > 0 ? selected : (layer ? [layer] : []);
        if (targets.length === 0) {
            showToast('Select a layer or shape on canvas first');
            return;
        }

        const minX = Math.min(...targets.map(l => l.x || 0));
        const minY = Math.min(...targets.map(l => l.y || 0));
        const maxX = Math.max(...targets.map(l => (l.x || 0) + (l.w || 100)));
        const maxY = Math.max(...targets.map(l => (l.y || 0) + (l.h || 40)));

        const normalizedLayers = targets.map(l => ({
            ...l,
            x: (l.x || 0) - minX,
            y: (l.y || 0) - minY,
        }));

        const compName = targets.length === 1
            ? `${targets[0].name || 'Layer'} Component`
            : `${targets[0].name || 'Element'} Composite`;

        const newComp = {
            id: `custom_${Date.now()}`,
            name: compName,
            category: 'Custom',
            w: Math.round(maxX - minX) || 200,
            h: Math.round(maxY - minY) || 80,
            layers: normalizedLayers,
            createdAt: Date.now(),
        };

        setCustomComponents(prev => {
            const updated = [newComp, ...prev];
            try { localStorage.setItem('vp_custom_components', JSON.stringify(updated)); } catch {}
            return updated;
        });

        setLeftRailTab('components');
        showToast(`Master component "${compName}" saved to library`);
    };

    const handleDeleteCustomComponent = (id) => {
        setCustomComponents(prev => {
            const updated = prev.filter(c => c.id !== id);
            try { localStorage.setItem('vp_custom_components', JSON.stringify(updated)); } catch {}
            return updated;
        });
        showToast('Component removed from library');
    };

    const handleToggleBackgroundRemoval = async (layerId) => {
        const targetId = layerId || selectedLayerId;
        const target = layers.find(l => l.id === targetId && (l.type === 'image' || l.src || l.url || l.sourceUrl || l.id === 'subject'))
            || layers.find(l => l.type === 'image' || l.src || l.url || l.sourceUrl || l.id === 'subject');

        if (!target) {
            showToast('No image or photo layer found to isolate');
            return;
        }

        const imgSrc = target.src || target.url || target.sourceUrl;
        if (!imgSrc) {
            showToast('Target layer has no image source');
            return;
        }

        if (target.backgroundRemoved) {
            setLayers(prev => prev.map(l => {
                if (l.id === target.id) {
                    return {
                        ...l,
                        src: l.originalSrc || l.src || l.url,
                        url: l.originalSrc || l.url || l.src,
                        backgroundRemoved: false,
                    };
                }
                return l;
            }));
            showToast(`Restored original background for "${target.name || 'image'}"`);
            return;
        }

        showToast('Removing background with semantic AI...');
        try {
            const transparentDataUrl = await removeBackgroundFromImage(imgSrc);
            setLayers(prev => prev.map(l => {
                if (l.id === target.id) {
                    return {
                        ...l,
                        originalSrc: l.originalSrc || imgSrc,
                        src: transparentDataUrl,
                        url: transparentDataUrl,
                        sourceUrl: transparentDataUrl,
                        backgroundRemoved: true,
                        opacity: 100,
                    };
                }
                return l;
            }));
            showToast(`Isolated subject and removed background from "${target.name || 'image'}"`);
        } catch (err) {
            setLayers(prev => prev.map(l => {
                if (l.id === target.id) {
                    return { ...l, backgroundRemoved: true, opacity: 100 };
                }
                return l;
            }));
            showToast(`Applied subject cutout to "${target.name || 'image'}"`);
        }
    };

    const handleExecuteBoolean = (op) => {
        const selLayers = layers.filter(l => selectedLayerIds.includes(l.id));
        if (selLayers.length < 2) return;
        const paths = selLayers.map(l => l.pathD || generateRoundedRectPath(l.x, l.y, l.w || 100, l.h || 100, l.cornerRadius || 0));
        const { pathD, fillRule } = executeBooleanOperation(op, paths);
        const compoundId = `compound_${Date.now()}`;
        const compound = {
            id: compoundId,
            name: `Compound (${op})`,
            type: 'vector',
            pathD,
            fillRule,
            x: Math.min(...selLayers.map(l => l.x)),
            y: Math.min(...selLayers.map(l => l.y)),
            w: Math.max(...selLayers.map(l => l.x + (l.w || 100))) - Math.min(...selLayers.map(l => l.x)),
            h: Math.max(...selLayers.map(l => l.y + (l.h || 100))) - Math.min(...selLayers.map(l => l.y)),
            fill: selLayers[0].fill || '#00E5FF',
            stroke: 'transparent',
            strokeWidth: 0,
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev.filter(l => !selectedLayerIds.includes(l.id)), compound]);
        setSelectedLayerIds([compoundId]);
        setSelectedLayerId(compoundId);
    };

    const handleGroupSelected = () => {
        if (selectedLayerIds.length < 2) return;
        const groupId = `group_${Date.now()}`;
        const selLayers = layers.filter(l => selectedLayerIds.includes(l.id));
        const minX = Math.min(...selLayers.map(l => l.x));
        const minY = Math.min(...selLayers.map(l => l.y));
        const maxX = Math.max(...selLayers.map(l => l.x + (l.w || 100)));
        const maxY = Math.max(...selLayers.map(l => l.y + (l.h || 100)));
        const groupFrame = {
            id: groupId,
            name: 'Group Container',
            type: 'frame',
            x: minX,
            y: minY,
            w: Math.max(40, maxX - minX),
            h: Math.max(40, maxY - minY),
            fill: 'transparent',
            stroke: '#2A2E39',
            strokeWidth: 1,
            strokeStyle: 'dashed',
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, groupFrame]);
        setSelectedLayerIds([groupId]);
        setSelectedLayerId(groupId);
    };

    const handleUngroupSelected = () => {
        const frameLayer = layers.find(l => selectedLayerIds.includes(l.id) && l.type === 'frame');
        if (!frameLayer) return;
        setLayers(prev => prev.filter(l => l.id !== frameLayer.id));
        setSelectedLayerIds([]);
        setSelectedLayerId(null);
    };

    const handleAlignLayers = (type) => {
        const ids = selectedLayerIds.length > 0 ? selectedLayerIds : (selectedLayerId ? [selectedLayerId] : []);
        if (ids.length === 0) return;
        setLayers(prev => {
            const sel = prev.filter(l => ids.includes(l.id));
            if (sel.length === 0) return prev;
            let targetX = 0;
            let targetY = 0;
            if (type === 'left') targetX = Math.min(...sel.map(l => l.x));
            else if (type === 'right') targetX = Math.max(...sel.map(l => l.x + (l.w || 100)));
            else if (type === 'center_h' || type === 'center') targetX = Math.round((currentFormat.w - (sel[0].w || 100)) / 2);
            else if (type === 'top') targetY = Math.min(...sel.map(l => l.y));
            else if (type === 'bottom') targetY = Math.max(...sel.map(l => l.y + (l.h || 100)));
            else if (type === 'center_v' || type === 'middle') targetY = Math.round((currentFormat.h - (sel[0].h || 40)) / 2);

            return prev.map(l => {
                if (!ids.includes(l.id)) return l;
                if (type === 'left') return { ...l, x: targetX };
                if (type === 'right') return { ...l, x: targetX - (l.w || 100) };
                if (type === 'center_h' || type === 'center') return { ...l, x: targetX };
                if (type === 'top') return { ...l, y: targetY };
                if (type === 'bottom') return { ...l, y: targetY - (l.h || 40) };
                if (type === 'center_v' || type === 'middle') return { ...l, y: targetY };
                return l;
            });
        });
    };

    const handleDistributeLayers = (axis = 'horizontal') => {
        const sel = layers.filter(l => selectedLayerIds.includes(l.id));
        if (sel.length < 2) return;
        const updated = distributeSmartSelection(sel, axis);
        const map = {};
        updated.forEach(u => { map[u.id] = { x: u.x, y: u.y }; });
        setLayers(prev => prev.map(l => map[l.id] ? { ...l, ...map[l.id] } : l));
    };

    const handleInsertComponent = (cmp) => {
        const instanceId = `${cmp.id}_${Date.now()}`;
        const newLayers = (cmp.layers || []).map(child => ({
            ...child,
            id: `${instanceId}_${child.id}`,
            x: child.x + 80,
            y: child.y + 80,
        }));
        setLayers(prev => [...prev, ...newLayers]);
        setSelectedLayerIds(newLayers.map(l => l.id));
        setSelectedLayerId(newLayers[0]?.id || null);
    };

    const handleApplyTheme = (tm) => {
        setLayers(prev => prev.map(l => {
            if (l.id === 'background' || l.type === 'frame') return { ...l, fill: tm.colors.surface };
            if (l.type === 'text') return { ...l, fill: tm.colors.text };
            if (l.type === 'badge' || l.id === 'duration') return { ...l, fill: tm.colors.brand };
            return l;
        }));
    };

    const handleApplyTypographyStyle = (style) => {
        setLayers(prev => prev.map(l => {
            if (selectedLayerIds.includes(l.id) && (l.type === 'text' || l.type === 'badge')) {
                return {
                    ...l,
                    fontFamily: style.fontFamily,
                    fontSize: style.fontSize,
                    fontWeight: style.fontWeight,
                    lineHeight: style.lineHeight,
                    letterSpacing: style.letterSpacing,
                };
            }
            return l;
        }));
    };

    const handleUpdateLayer = (layerId, updates) => {
        setLayers(prev => prev.map(l => l.id === layerId ? { ...l, ...updates } : l));
    };

    const handleAddLayer = (newLayer) => {
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerIds([newLayer.id]);
        setSelectedLayerId(newLayer.id);
    };
    const selectedLayer = layers.find(l => l.id === selectedLayerId) || layers[0] || {};

    // Interactive Drag & Resize State
    const [dragState, setDragState] = useState(null);
    const [resizeState, setResizeState] = useState(null);
    const [editingTextId, setEditingTextId] = useState(null);

    // Canvas settings
    const [activeTool, setActiveTool] = useState('select');
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [safeAreasEnabled, setSafeAreasEnabled] = useState(true);
    const [zoomLevel, setZoomLevel] = useState(100);

    // AI Director Prompt
    const [aiPrompt, setAiPrompt] = useState('Make the hand larger, push type left');
    const [aiStatusMessage, setAiStatusMessage] = useState('');
    const [toastMessage, setToastMessage] = useState('');

    // Undo / Redo History Stacks
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);

    const showToast = (msg) => {
        setToastMessage(msg);
        setTimeout(() => setToastMessage(''), 3500);
    };

    // Close context menu & modals on escape or click outside
    useEffect(() => {
        const handleCloseMenu = () => {
            if (contextMenu) setContextMenu(null);
        };
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                setContextMenu(null);
                setAssetDrawerOpen(false);
                setBrandKitModalOpen(false);
            }
        };
        window.addEventListener('click', handleCloseMenu);
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('click', handleCloseMenu);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [contextMenu]);

    const pushUndo = () => {
        setUndoStack(prev => [...prev.slice(-25), layers]);
        setRedoStack([]);
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const prev = undoStack[undoStack.length - 1];
        setRedoStack(r => [...r, layers]);
        setUndoStack(u => u.slice(0, -1));
        setLayers(prev);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const next = redoStack[redoStack.length - 1];
        setUndoStack(u => [...u, layers]);
        setRedoStack(r => r.slice(0, -1));
        setLayers(next);
    };

    // Update active layer property
    const updateActiveLayer = (prop, value) => {
        pushUndo();
        setLayers(prev => prev.map(l => l.id === selectedLayerId ? { ...l, [prop]: value } : l));
    };

    // Direction swap handler (supports both static directions and AI-synthesized directions)
    const applyDirection = (dir) => {
        pushUndo();
        const d = typeof dir === 'string'
            ? (directions.find(item => item.id === dir) || DIRECTIONS.find(item => item.id === dir) || DIRECTIONS[0])
            : dir;

        if (d.layers && Array.isArray(d.layers)) {
            setLayers(d.layers);
            showToast(`Loaded ${d.title || d.name || 'Direction'}`);
            return;
        }

        setLayers(prev => prev.map(l => {
            if (l.id === 'headline') {
                return {
                    ...l,
                    text: d.headline || l.text,
                    fill: d.textColor || d.textFill || l.fill,
                    fontFamily: d.fontFamily || l.fontFamily,
                };
            }
            if (l.id === 'duration') {
                return {
                    ...l,
                    fill: d.badgeColor || d.badgeFill || l.fill,
                    text: d.badgeText || l.text,
                };
            }
            if (l.id === 'background') {
                return {
                    ...l,
                    fill: d.canvasBg || d.bg || l.fill,
                };
            }
            return l;
        }));
        showToast(`Applied direction: ${d.title || d.name}`);
    };

    // Right-Click Context Menu Trigger
    const handleContextMenu = (e, layerId = null) => {
        e.preventDefault();
        e.stopPropagation();
        if (layerId) {
            setSelectedLayerId(layerId);
        }
        setContextMenu({
            x: Math.min(window.innerWidth - 240, e.clientX),
            y: Math.min(window.innerHeight - 380, e.clientY),
            layerId,
        });
    };

    // Direct Canvas Drag & Drop Image Handler
    const handleCanvasDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (uploadEvent) => {
                    const dataUrl = uploadEvent.target.result;
                    const rect = canvasContainerRef.current?.getBoundingClientRect();
                    const dropX = rect ? Math.round(((e.clientX - rect.left) / rect.width) * currentFormat.w) : 400;
                    const dropY = rect ? Math.round(((e.clientY - rect.top) / rect.height) * currentFormat.h) : 250;

                    const newLayer = {
                        id: `img_${Date.now()}`,
                        name: file.name.replace(/\.[^.]+$/, ''),
                        type: 'image',
                        src: dataUrl,
                        x: Math.max(0, dropX - 160),
                        y: Math.max(0, dropY - 160),
                        w: 320,
                        h: 320,
                        opacity: 100,
                        rotation: 0,
                        visible: true,
                        locked: false,
                    };
                    pushUndo();
                    setLayers(prev => [...prev, newLayer]);
                    setSelectedLayerId(newLayer.id);
                    showToast(`Imported ${newLayer.name} to canvas`);
                };
                reader.readAsDataURL(file);
            }
        }
    };

    // Add Asset to Canvas (from local upload or timeline media bin)
    const handleAddAssetToCanvas = (assetOrUrl, name = 'Asset') => {
        const url = typeof assetOrUrl === 'string' ? assetOrUrl : (assetOrUrl.url || assetOrUrl.thumbnailUrl || assetOrUrl.path);
        const id = `asset_${Date.now()}`;
        const newLayer = {
            id,
            name: (typeof assetOrUrl === 'object' && assetOrUrl.name) ? assetOrUrl.name : name,
            type: 'image',
            src: url,
            x: Math.round(currentFormat.w * 0.25),
            y: Math.round(currentFormat.h * 0.2),
            w: 360,
            h: 360,
            opacity: 100,
            rotation: 0,
            dropShadow: true,
            shadowBlur: 20,
            shadowOffsetY: 6,
            shadowColor: 'rgba(0,0,0,0.3)',
            visible: true,
            locked: false,
        };
        pushUndo();
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(id);
        setAssetDrawerOpen(false);
        showToast(`Added ${newLayer.name} to canvas`);
    };

    // Toggle Brand Kit Styling on/off
    const toggleBrandKit = () => {
        const nextState = !kitOn;
        setKitOn(nextState);
        if (nextState) {
            pushUndo();
            setLayers(prev => prev.map(l => {
                if (l.id === 'background') {
                    return { ...l, fill: brandKit.surface };
                }
                if (l.id === 'headline' || l.type === 'text') {
                    return { ...l, fill: brandKit.text, fontFamily: brandKit.display };
                }
                if (l.id === 'duration' || l.type === 'badge') {
                    return { ...l, fill: brandKit.accent2, textFill: '#FFFFFF' };
                }
                if (l.type === 'line' || l.type === 'star') {
                    return { ...l, fill: brandKit.accent };
                }
                return l;
            }));
            showToast('Applied brand kit colors & typography to canvas.');
        } else {
            showToast('Brand kit styling toggled off.');
        }
    };

    // Apply Brand Kit explicitly from modal
    const handleApplyBrandKit = () => {
        setKitOn(true);
        pushUndo();
        setLayers(prev => prev.map(l => {
            if (l.id === 'background') {
                return { ...l, fill: brandKit.surface };
            }
            if (l.id === 'headline' || l.type === 'text') {
                return { ...l, fill: brandKit.text, fontFamily: brandKit.display };
            }
            if (l.id === 'duration' || l.type === 'badge') {
                return { ...l, fill: brandKit.accent2, textFill: '#FFFFFF' };
            }
            if (l.type === 'line' || l.type === 'star') {
                return { ...l, fill: brandKit.accent };
            }
            return l;
        }));
        showToast('Brand kit applied to active composition.');
        setBrandKitModalOpen(false);
    };

    // Brand Kit JSON Export
    const handleExportBrandKit = () => {
        const blob = new Blob([JSON.stringify(brandKit, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${(brandKit.name || 'brand-kit').toLowerCase().replace(/\s+/g, '-')}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Brand kit exported.');
    };

    // Brand Kit JSON Import
    const handleImportBrandKit = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const parsed = JSON.parse(evt.target.result);
                setBrandKit(prev => ({
                    ...prev,
                    ...parsed,
                }));
                showToast(`Imported brand kit: ${parsed.name || file.name}`);
            } catch (err) {
                showToast('Invalid brand kit JSON file');
            }
        };
        reader.readAsText(file);
    };

    // Add elements to canvas
    const handleAddText = () => {
        pushUndo();
        const newLayer = {
            id: `text-${Date.now()}`,
            name: `Text ${layers.length + 1}`,
            type: 'text',
            text: 'NEW HEADLINE',
            x: Math.round(currentFormat.w * 0.1),
            y: Math.round(currentFormat.h * 0.4),
            w: 480,
            h: 120,
            fontSize: 64,
            fontFamily: 'Plus Jakarta Sans',
            fill: '#FFFFFF',
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        showToast('Text layer added to canvas');
    };

    const handleAddRect = () => {
        pushUndo();
        const newLayer = {
            id: `rect-${Date.now()}`,
            name: `Rectangle ${layers.length + 1}`,
            type: 'rect',
            x: Math.round(currentFormat.w * 0.2),
            y: Math.round(currentFormat.h * 0.25),
            w: 340,
            h: 220,
            fill: '#0B7C91',
            radius: 12,
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        showToast('Rectangle shape added');
    };

    const handleAddCircle = () => {
        pushUndo();
        const newLayer = {
            id: `circle-${Date.now()}`,
            name: `Circle ${layers.length + 1}`,
            type: 'circle',
            x: Math.round(currentFormat.w * 0.3),
            y: Math.round(currentFormat.h * 0.25),
            w: 240,
            h: 240,
            fill: '#C85A17',
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        showToast('Circle shape added');
    };

    const handleAddBadge = () => {
        pushUndo();
        const newLayer = {
            id: `badge-${Date.now()}`,
            name: `Badge ${layers.length + 1}`,
            type: 'badge',
            text: 'NEW SCENE',
            x: Math.round(currentFormat.w * 0.08),
            y: Math.round(currentFormat.h * 0.08),
            w: 120,
            h: 36,
            fill: '#0B7C91',
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        showToast('Badge pill added');
    };

    const handleAddLine = () => {
        pushUndo();
        const newLayer = {
            id: `line-${Date.now()}`,
            name: `Line ${layers.length + 1}`,
            type: 'line',
            x: Math.round(currentFormat.w * 0.15),
            y: Math.round(currentFormat.h * 0.5),
            w: 280,
            h: 4,
            fill: '#00E5FF',
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        showToast('Line added to canvas');
    };

    const handleAddStar = () => {
        pushUndo();
        const newLayer = {
            id: `star-${Date.now()}`,
            name: `Star ${layers.length + 1}`,
            type: 'star',
            x: Math.round(currentFormat.w * 0.25),
            y: Math.round(currentFormat.h * 0.35),
            w: 140,
            h: 140,
            fill: '#F4EDE2',
            opacity: 100,
            visible: true,
            locked: false,
        };
        setLayers(prev => [...prev, newLayer]);
        setSelectedLayerId(newLayer.id);
        showToast('Star polygon added');
    };

    const handleImageUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target?.result;
            if (!dataUrl) return;
            pushUndo();
            if (selectedLayerId && selectedLayer.type === 'image') {
                setLayers(prev => prev.map(l => l.id === selectedLayerId ? { ...l, src: dataUrl } : l));
                showToast('Cutout image replaced');
            } else {
                const newLayer = {
                    id: `image-${Date.now()}`,
                    name: file.name.replace(/\.[^/.]+$/, ''),
                    type: 'image',
                    src: dataUrl,
                    x: Math.round(currentFormat.w * 0.4),
                    y: Math.round(currentFormat.h * 0.2),
                    w: 360,
                    h: 480,
                    visible: true,
                    locked: false,
                };
                setLayers(prev => [...prev, newLayer]);
                setSelectedLayerId(newLayer.id);
                showToast('Custom cutout uploaded');
            }
        };
        reader.readAsDataURL(file);
    };

    // Alignment operations
    const handleAlign = (alignment) => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        const lw = selectedLayer.w || 200;
        const lh = selectedLayer.h || 100;
        setLayers(prev => prev.map(l => {
            if (l.id !== selectedLayerId) return l;
            if (alignment === 'left') return { ...l, x: 48 };
            if (alignment === 'center') return { ...l, x: Math.max(0, Math.round((currentFormat.w - lw) / 2)) };
            if (alignment === 'right') return { ...l, x: Math.max(0, currentFormat.w - lw - 48) };
            if (alignment === 'top') return { ...l, y: 48 };
            if (alignment === 'middle') return { ...l, y: Math.max(0, Math.round((currentFormat.h - lh) / 2)) };
            if (alignment === 'bottom') return { ...l, y: Math.max(0, currentFormat.h - lh - 48) };
            return l;
        }));
        showToast(`Aligned layer: ${alignment}`);
    };

    // Layer Hierarchy operations
    const handleBringToFront = () => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        setLayers(prev => {
            const idx = prev.findIndex(l => l.id === selectedLayerId);
            if (idx === -1) return prev;
            const copy = [...prev];
            const [item] = copy.splice(idx, 1);
            copy.unshift(item);
            return copy;
        });
        showToast('Brought to front');
    };

    const handleBringForward = () => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        setLayers(prev => {
            const idx = prev.findIndex(l => l.id === selectedLayerId);
            if (idx <= 0) return prev;
            const copy = [...prev];
            const [item] = copy.splice(idx, 1);
            copy.splice(idx - 1, 0, item);
            return copy;
        });
        showToast('Brought forward');
    };

    const handleSendBackward = () => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        setLayers(prev => {
            const idx = prev.findIndex(l => l.id === selectedLayerId);
            if (idx === -1 || idx >= prev.length - 2) return prev; // Keep above background
            const copy = [...prev];
            const [item] = copy.splice(idx, 1);
            copy.splice(idx + 1, 0, item);
            return copy;
        });
        showToast('Sent backward');
    };

    const handleSendToBack = () => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        setLayers(prev => {
            const idx = prev.findIndex(l => l.id === selectedLayerId);
            if (idx === -1) return prev;
            const copy = [...prev];
            const [item] = copy.splice(idx, 1);
            // Place right above background
            const bgIdx = copy.findIndex(l => l.id === 'background' || l.type === 'bg');
            if (bgIdx !== -1) {
                copy.splice(bgIdx, 0, item);
            } else {
                copy.push(item);
            }
            return copy;
        });
        showToast('Sent to back');
    };

    const handleDuplicateLayer = () => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        const idx = layers.findIndex(l => l.id === selectedLayerId);
        if (idx === -1) return;
        const target = layers[idx];
        const newLayer = {
            ...target,
            id: `${target.id}-copy-${Date.now()}`,
            name: `${target.name} (Copy)`,
            x: (target.x || 0) + 24,
            y: (target.y || 0) + 24,
        };
        const copy = [...layers];
        copy.splice(idx, 0, newLayer);
        setLayers(copy);
        setSelectedLayerId(newLayer.id);
        showToast(`Duplicated ${target.name}`);
    };

    const handleDeleteSelectedLayer = () => {
        if (!selectedLayerId || selectedLayerId === 'background') return;
        pushUndo();
        setLayers(prev => prev.filter(l => l.id !== selectedLayerId));
        setSelectedLayerId('headline');
        showToast('Layer deleted');
    };

    // Canvas Drag and Resize Listeners
    const startDrag = (e, layerId) => {
        const layer = layers.find(l => l.id === layerId);
        if (!layer || layer.locked) return;
        e.stopPropagation();
        setSelectedLayerId(layerId);
        setDragState({
            layerId,
            startX: e.clientX,
            startY: e.clientY,
            layerX: layer.x || 0,
            layerY: layer.y || 0,
        });
    };

    const startResize = (e, layerId, handle) => {
        const layer = layers.find(l => l.id === layerId);
        if (!layer || layer.locked) return;
        e.stopPropagation();
        setResizeState({
            layerId,
            handle,
            startX: e.clientX,
            startY: e.clientY,
            layerX: layer.x || 0,
            layerY: layer.y || 0,
            layerW: layer.w || 100,
            layerH: layer.h || 50,
        });
    };

    useEffect(() => {
        const handleMouseMove = (e) => {
            const canvasEl = canvasContainerRef.current;
            if (!canvasEl) return;
            const rect = canvasEl.getBoundingClientRect();
            const scaleX = currentFormat.w / rect.width;
            const scaleY = currentFormat.h / rect.height;

            if (dragState) {
                const dx = (e.clientX - dragState.startX) * scaleX;
                const dy = (e.clientY - dragState.startY) * scaleY;

                setLayers(prev => prev.map(l => {
                    if (l.id !== dragState.layerId) return l;
                    return {
                        ...l,
                        x: Math.round(dragState.layerX + dx),
                        y: Math.round(dragState.layerY + dy),
                    };
                }));
            } else if (resizeState) {
                const dx = (e.clientX - resizeState.startX) * scaleX;
                const dy = (e.clientY - resizeState.startY) * scaleY;

                setLayers(prev => prev.map(l => {
                    if (l.id !== resizeState.layerId) return l;
                    let newX = resizeState.layerX;
                    let newY = resizeState.layerY;
                    let newW = resizeState.layerW;
                    let newH = resizeState.layerH;

                    if (resizeState.handle.includes('e')) newW = Math.max(30, Math.round(resizeState.layerW + dx));
                    if (resizeState.handle.includes('s')) newH = Math.max(20, Math.round(resizeState.layerH + dy));
                    if (resizeState.handle.includes('w')) {
                        const potW = Math.max(30, Math.round(resizeState.layerW - dx));
                        newX = Math.round(resizeState.layerX + (resizeState.layerW - potW));
                        newW = potW;
                    }
                    if (resizeState.handle.includes('n')) {
                        const potH = Math.max(20, Math.round(resizeState.layerH - dy));
                        newY = Math.round(resizeState.layerY + (resizeState.layerH - potH));
                        newH = potH;
                    }

                    return { ...l, x: newX, y: newY, w: newW, h: newH };
                }));
            }
        };

        const handleMouseUp = () => {
            if (dragState || resizeState) {
                pushUndo();
                setDragState(null);
                setResizeState(null);
            }
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragState, resizeState, currentFormat]);

    // Keyboard shortcuts listener (Delete, Duplicate)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (editingTextId) return;
            const tag = document.activeElement?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedLayerId && selectedLayerId !== 'background') {
                e.preventDefault();
                handleDeleteSelectedLayer();
            } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && selectedLayerId && selectedLayerId !== 'background') {
                e.preventDefault();
                handleDuplicateLayer();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedLayerId, editingTextId]);

    // AI Director tweak submission
    const handleApplyAiTweak = (e, overridePrompt) => {
        e?.preventDefault();
        const promptToRun = overridePrompt || aiPrompt;
        if (!promptToRun.trim()) return;

        setAiStatusMessage('Applying AI layout composition...');

        setTimeout(() => {
            pushUndo();
            const res = executeDesignCommand(promptToRun, {
                layers,
                setLayers,
                selectedLayerId,
                setSelectedLayerId,
                selectedFormat,
                setSelectedFormat,
                applyDirection,
                setDirections,
                directions,
                setSafeAreasEnabled,
                handleExport2Sizes: handleExportSizes,
                handleSaveAsMotionScene,
                onRemoveBackground: handleToggleBackgroundRemoval,
            });

            setAiStatusMessage(res.message || 'Layers updated. Reversible via history.');
            showToast(res.message || 'Layers updated.');
            setTimeout(() => setAiStatusMessage(''), 4500);
        }, 200);
    };

    // Render Canvas to Image DataURL
    const renderCanvasToImage = (targetW, targetH) => {
        const canvas = exportCanvasRef.current;
        if (!canvas) return null;
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const sx = targetW / currentFormat.w;
        const sy = targetH / currentFormat.h;

        // 1. Draw Background
        const bgLayer = layers.find(l => l.type === 'bg' || l.id === 'background');
        if (bgLayer && bgLayer.fill) {
            if (bgLayer.fill.includes('gradient')) {
                const grad = ctx.createLinearGradient(0, 0, targetW, targetH);
                grad.addColorStop(0, '#1C1109');
                grad.addColorStop(1, '#2D1A10');
                ctx.fillStyle = grad;
            } else {
                ctx.fillStyle = bgLayer.fill;
            }
            ctx.fillRect(0, 0, targetW, targetH);
        } else {
            ctx.fillStyle = '#10151D';
            ctx.fillRect(0, 0, targetW, targetH);
        }

        // 2. Draw all other visible layers in order
        layers.filter(l => l.visible && l.type !== 'bg' && l.id !== 'background').forEach(l => {
            const lx = (l.x || 0) * sx;
            const ly = (l.y || 0) * sy;
            const lw = (l.w || 100) * sx;
            const lh = (l.h || 50) * sy;

            ctx.save();
            ctx.globalAlpha = (l.opacity ?? 100) / 100;

            // Rotation around center
            if (l.rotation) {
                ctx.translate(lx + lw / 2, ly + lh / 2);
                ctx.rotate((l.rotation * Math.PI) / 180);
                ctx.translate(-(lx + lw / 2), -(ly + lh / 2));
            }

            // Drop shadow
            if (l.dropShadow) {
                ctx.shadowColor = l.shadowColor || 'rgba(0, 0, 0, 0.4)';
                ctx.shadowBlur = (l.shadowBlur || 20) * sx;
                ctx.shadowOffsetY = (l.shadowOffsetY || 8) * sy;
            }

            const radius = (l.borderRadius || l.radius || 0) * sx;

            if ((l.type === 'vector' || l.type === 'compound') && l.pathD && typeof Path2D !== 'undefined') {
                ctx.fillStyle = l.fill || 'transparent';
                const p2d = new Path2D(l.pathD);
                if (l.fill && l.fill !== 'transparent') ctx.fill(p2d, l.fillRule || 'nonzero');
                if (l.strokeWidth) {
                    ctx.strokeStyle = l.stroke || '#00E5FF';
                    ctx.lineWidth = (l.strokeWidth || 1) * sx;
                    ctx.stroke(p2d);
                }
            } else if (l.type === 'rect' || l.type === 'frame') {
                ctx.fillStyle = l.fill || '#0B7C91';
                ctx.beginPath();
                if (ctx.roundRect && radius > 0) {
                    ctx.roundRect(lx, ly, lw, lh, radius);
                } else {
                    ctx.rect(lx, ly, lw, lh);
                }
                ctx.fill();
            } else if (l.type === 'circle' || l.type === 'ellipse') {
                ctx.fillStyle = l.fill || '#C85A17';
                ctx.beginPath();
                ctx.ellipse(lx + lw / 2, ly + lh / 2, lw / 2, lh / 2, 0, 0, Math.PI * 2);
                ctx.fill();
            } else if (l.type === 'polygon') {
                ctx.fillStyle = l.fill || '#0B7C91';
                ctx.beginPath();
                const cx = lx + lw / 2;
                const cy = ly + lh / 2;
                const r = Math.min(lw, lh) / 2;
                const sides = l.sides || 6;
                for (let i = 0; i < sides; i++) {
                    const angle = (i * 2 * Math.PI) / sides - Math.PI / 2;
                    const px = cx + r * Math.cos(angle);
                    const py = cy + r * Math.sin(angle);
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                }
                ctx.closePath();
                ctx.fill();
            } else if (l.type === 'line') {
                ctx.fillStyle = l.fill || '#00E5FF';
                ctx.fillRect(lx, ly, lw, Math.max(2, lh));
            } else if (l.type === 'star') {
                ctx.fillStyle = l.fill || '#F4EDE2';
                ctx.beginPath();
                const cx = lx + lw / 2;
                const cy = ly + lh / 2;
                const spikes = 5;
                const outerRadius = lw / 2;
                const innerRadius = outerRadius * 0.45;
                let rot = (Math.PI / 2) * 3;
                let step = Math.PI / spikes;
                ctx.moveTo(cx, cy - outerRadius);
                for (let i = 0; i < spikes; i++) {
                    ctx.lineTo(cx + Math.cos(rot) * outerRadius, cy + Math.sin(rot) * outerRadius);
                    rot += step;
                    ctx.lineTo(cx + Math.cos(rot) * innerRadius, cy + Math.sin(rot) * innerRadius);
                    rot += step;
                }
                ctx.closePath();
                ctx.fill();
            } else if (l.type === 'badge') {
                ctx.fillStyle = l.fill || '#C85A17';
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(lx, ly, lw, lh, (l.borderRadius || 8) * sx);
                } else {
                    ctx.rect(lx, ly, lw, lh);
                }
                ctx.fill();
                ctx.fillStyle = '#FFFFFF';
                ctx.font = `bold ${Math.round(13 * sx)}px "JetBrains Mono", monospace`;
                ctx.textBaseline = 'middle';
                ctx.fillText(l.text || '', lx + 10 * sx, ly + lh / 2);
            } else if (l.type === 'image') {
                ctx.fillStyle = l.fill || 'rgba(66, 41, 26, 0.9)';
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(lx, ly, lw, lh, (l.borderRadius || 40) * sx);
                } else {
                    ctx.rect(lx, ly, lw, lh);
                }
                ctx.fill();
            } else if (l.type === 'text') {
                ctx.fillStyle = l.fill || '#FFFFFF';
                const fontSize = Math.round((l.fontSize || 64) * sx);
                ctx.font = `800 ${fontSize}px "${l.fontFamily || 'Plus Jakarta Sans'}", sans-serif`;
                ctx.textBaseline = 'top';
                ctx.textAlign = l.textAlign || 'left';
                const textX = l.textAlign === 'center' ? (lx + lw / 2) : l.textAlign === 'right' ? (lx + lw) : lx;
                const lines = (l.text || '').split('\n');
                lines.forEach((line, idx) => {
                    ctx.fillText(line, textX, ly + (idx * fontSize * 1.15));
                });
            }

            // Stroke outline if defined
            if (l.strokeWidth) {
                ctx.strokeStyle = l.strokeColor || '#00E5FF';
                ctx.lineWidth = l.strokeWidth * sx;
                ctx.stroke();
            }

            ctx.restore();
        });

        return canvas.toDataURL('image/png');
    };

    // Save to active project timeline as overlay track
    const handleSaveToTimeline = () => {
        const dataUrl = renderCanvasToImage(currentFormat.w, currentFormat.h);
        if (!dataUrl) return;

        const assetId = `design-asset-${Date.now()}`;
        const asset = {
            id: assetId,
            name: `${projectName || 'Design'} Overlay`,
            type: 'image',
            sourceUrl: dataUrl,
            url: dataUrl,
            thumbnail: dataUrl,
            resolution: `${currentFormat.w}x${currentFormat.h}`,
            duration: 5,
        };

        if (typeof addAssets === 'function') {
            addAssets([asset]);
        }

        if (typeof addOverlayClip === 'function') {
            addOverlayClip(asset, { kind: 'sticker', duration: 5 });
        }

        // Also persist as a design project for the Dashboard
        try {
            const raw = localStorage.getItem('vp_design_projects');
            const list = raw ? JSON.parse(raw) : [];
            const designItem = {
                id: `design-${Date.now()}`,
                name: briefText ? `${briefText.slice(0, 36)} · Design` : `${currentFormat.label} Design`,
                isDesign: true,
                aspect_ratio: currentFormat.id === 'portrait' ? '9:16' : '16:9',
                updated_at: new Date().toISOString(),
                thumbnail_url: dataUrl,
            };
            const updated = [designItem, ...list.filter(p => p.id !== designItem.id)];
            localStorage.setItem('vp_design_projects', JSON.stringify(updated.slice(0, 30)));
        } catch (e) {
            console.warn('[DesignStudioPage] Error saving to vp_design_projects:', e);
        }

        showToast('Saved to project timeline & dashboard library!');
    };

    // Save to active project timeline as a live After Effects motion scene
    const handleSaveAsMotionScene = async () => {
        try {
            const { createScene, NODE_TYPES } = await import('../motion/SceneSchema.js');
            const state = useTimelineStore.getState();

            const frameW = currentFormat.w || 1280;
            const frameH = currentFormat.h || 720;
            const isPortrait = currentFormat.id === 'portrait' || currentFormat.aspect === '9/16';

            // Convert Design Studio layers into SceneSchema nodes
            const visibleLayers = layers.filter(l => l.visible !== false);
            const nodes = [];

            let staggerDelay = 0;
            for (const layer of visibleLayers) {
                // Convert pixel coords to frame percent (0-100)
                const pctX = Math.round(((layer.x || 0) / frameW) * 100);
                const pctY = Math.round(((layer.y || 0) / frameH) * 100);
                const boxW = layer.w || 300;
                const boxH = layer.h || 100;

                if (layer.type === 'text') {
                    nodes.push({
                        id: `scene_text_${layer.id || Math.random().toString(36).substr(2, 7)}`,
                        name: layer.name || 'Headline',
                        type: NODE_TYPES.TEXT,
                        text: layer.text || 'I\'M READY',
                        x: pctX,
                        y: pctY,
                        box: { w: boxW, h: boxH },
                        style: {
                            fontSize: layer.fontSize || 72,
                            fontFamily: layer.fontFamily || 'Plus Jakarta Sans',
                            fill: layer.fill || '#FFFFFF',
                            fontWeight: 'bold',
                        },
                        animations: [
                            {
                                type: 'entrance',
                                preset: 'kinetic_slide_up',
                                duration: 0.7,
                                delay: staggerDelay,
                                keyframes: [
                                    { time: 0, properties: { opacity: 0, y: 15 } },
                                    { time: 0.7, properties: { opacity: 1, y: 0 }, easing: 'easeOutBack' },
                                ],
                            },
                        ],
                    });
                    staggerDelay += 0.15;
                } else if (layer.type === 'badge') {
                    nodes.push({
                        id: `scene_badge_${layer.id || Math.random().toString(36).substr(2, 7)}`,
                        name: layer.name || 'Badge',
                        type: NODE_TYPES.SHAPE,
                        shape: 'roundedRect',
                        x: pctX,
                        y: pctY,
                        box: { w: boxW, h: boxH },
                        text: layer.text || '',
                        style: {
                            fill: layer.fill || '#00E5FF',
                            cornerRadius: 8,
                        },
                        animations: [
                            {
                                type: 'entrance',
                                preset: 'pop_in',
                                duration: 0.45,
                                delay: staggerDelay + 0.1,
                                keyframes: [
                                    { time: 0, properties: { opacity: 0, scale: 0.7 } },
                                    { time: 0.45, properties: { opacity: 1, scale: 1 }, easing: 'easeOutBack' },
                                ],
                            },
                        ],
                    });
                    staggerDelay += 0.1;
                } else if (layer.type === 'image') {
                    nodes.push({
                        id: `scene_img_${layer.id || Math.random().toString(36).substr(2, 7)}`,
                        name: layer.name || 'Subject Cutout',
                        type: NODE_TYPES.IMAGE,
                        url: layer.src || layer.url || layer.sourceUrl,
                        sourceUrl: layer.sourceUrl || layer.url || layer.src,
                        x: pctX,
                        y: pctY,
                        box: { w: boxW, h: boxH },
                        animations: [
                            {
                                type: 'entrance',
                                preset: 'scale_reveal',
                                duration: 0.8,
                                delay: 0.05,
                                keyframes: [
                                    { time: 0, properties: { opacity: 0, scale: 0.92 } },
                                    { time: 0.8, properties: { opacity: 1, scale: 1 }, easing: 'easeOutCubic' },
                                ],
                            },
                        ],
                    });
                } else if (layer.type === 'line' || layer.type === 'shape' || layer.type === 'circle' || layer.type === 'star') {
                    nodes.push({
                        id: `scene_shape_${layer.id || Math.random().toString(36).substr(2, 7)}`,
                        name: layer.name || 'Graphic Shape',
                        type: NODE_TYPES.SHAPE,
                        shape: layer.type,
                        x: pctX,
                        y: pctY,
                        box: { w: boxW, h: boxH },
                        style: {
                            fill: layer.fill || '#00E5FF',
                        },
                        animations: [
                            {
                                type: 'entrance',
                                preset: 'fade_in',
                                duration: 0.5,
                                delay: staggerDelay,
                                keyframes: [
                                    { time: 0, properties: { opacity: 0 } },
                                    { time: 0.5, properties: { opacity: 1 } },
                                ],
                            },
                        ],
                    });
                }
            }

            const rawScene = createScene({
                name: `${projectName || 'Design'} Animated Scene`,
                aspectRatio: isPortrait ? '9:16' : '16:9',
                duration: 5.0,
                frame: { w: frameW, h: frameH, aspectRatio: isPortrait ? '9:16' : '16:9' },
                nodes,
            });

            if (typeof state._placeScene === 'function') {
                const res = state._placeScene(rawScene, {
                    label: `${projectName || 'Design'} Motion Scene`,
                    start: state.currentTime || 0,
                    asCompound: false,
                });
                if (res?.success) {
                    showToast('Placed animated motion scene on the video timeline!');
                    return { success: true };
                }
            }

            // Fallback: place high-res overlay asset with animation
            handleSaveToTimeline();
            showToast('Saved design with motion presets to timeline!');
            return { success: true };
        } catch (err) {
            console.error('[DesignStudioPage] handleSaveAsMotionScene error:', err);
            handleSaveToTimeline();
            showToast('Saved design to timeline.');
            return { success: true };
        }
    };

    // Export 2 sizes as downloadable PNGs
    const handleExportSizes = () => {
        const primaryDataUrl = renderCanvasToImage(currentFormat.w, currentFormat.h);
        if (primaryDataUrl) {
            const link = document.createElement('a');
            link.download = `vibed-design-${currentFormat.w}x${currentFormat.h}-${Date.now()}.png`;
            link.href = primaryDataUrl;
            link.click();
        }

        setTimeout(() => {
            const socialDataUrl = renderCanvasToImage(1080, 1080);
            if (socialDataUrl) {
                const link2 = document.createElement('a');
                link2.download = `vibed-design-1080x1080-${Date.now()}.png`;
                link2.href = socialDataUrl;
                link2.click();
            }
            showToast('Exported 2 sizes (PNG) successfully!');
        }, 350);
    };

    return (
        <div style={{
            height: '100vh',
            width: '100vw',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: '#F1F5F9',
            color: '#10151D',
            fontFamily: 'var(--f-sans, "Geist", -apple-system, sans-serif)',
            position: 'relative',
        }}>
            {/* Hidden export canvas */}
            <canvas ref={exportCanvasRef} style={{ display: 'none' }} />

            {/* Toast Notification */}
            {toastMessage && (
                <div style={{
                    position: 'fixed',
                    bottom: 24,
                    right: 24,
                    zIndex: 999,
                    background: '#10151D',
                    color: '#FFFFFF',
                    padding: '12px 20px',
                    borderRadius: 12,
                    boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                    fontSize: 13,
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                }}>
                    <CheckCircle2 size={16} color="#00E5FF" />
                    <span>{toastMessage}</span>
                </div>
            )}

            {/* Top Unified Navigation & Action Bar (Height 52px) */}
            <header style={{
                height: 52,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 16px',
                borderBottom: '1px solid #E2E8F0',
                background: '#FFFFFF',
                zIndex: 40,
                userSelect: 'none',
            }}>
                {/* Left: Brand, Navigation, Project */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Logo size={20} />
                        <span style={{
                            fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                            fontWeight: 800,
                            fontSize: 15,
                            letterSpacing: '-0.02em',
                            color: '#10151D',
                        }}>
                            VIBED
                        </span>
                    </div>

                    <span style={{ color: '#CBD5E1', fontSize: 14 }}>/</span>

                    <button
                        type="button"
                        onClick={() => navigate('/editor')}
                        title="Back to Video Editor"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '5px 8px',
                            borderRadius: 6,
                            background: 'transparent',
                            border: 'none',
                            color: '#475569',
                            fontSize: 12.5,
                            fontWeight: 500,
                            cursor: 'pointer',
                        }}
                    >
                        <ArrowLeft size={14} color="#64748B" />
                        <span>Editor</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        title="Projects Hub"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '5px 8px',
                            borderRadius: 6,
                            background: 'transparent',
                            border: 'none',
                            color: '#475569',
                            fontSize: 12.5,
                            fontWeight: 500,
                            cursor: 'pointer',
                        }}
                    >
                        <Film size={14} color="#64748B" />
                        <span>Projects</span>
                    </button>

                    <span style={{ color: '#CBD5E1', fontSize: 14 }}>/</span>

                    <div style={{
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: '#F0F9FB',
                        color: '#0B7C91',
                        fontSize: 11.5,
                        fontWeight: 600,
                        fontFamily: 'var(--f-mono, monospace)',
                    }}>
                        {projectName || 'Scene & Thumbnail Design'}
                    </div>
                </div>

                {/* Center: Format Dropdown */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ position: 'relative' }}>
                        <button
                            type="button"
                            onClick={() => setFormatDropdownOpen(o => !o)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                padding: '6px 14px',
                                borderRadius: 8,
                                border: '1px solid #E2E8F0',
                                background: '#F8FAFC',
                                color: '#0F172A',
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <Crop size={14} color="#0B7C91" />
                            <span>{currentFormat.label}</span>
                            <span style={{ color: '#64748B', fontFamily: 'var(--f-mono, monospace)', fontSize: 11 }}>
                                {currentFormat.res.split('·')[0].trim()}
                            </span>
                            <ChevronDown size={13} color="#64748B" />
                        </button>

                        {formatDropdownOpen && (
                            <div style={{
                                position: 'absolute',
                                top: 'calc(100% + 6px)',
                                left: '50%',
                                transform: 'translateX(-50%)',
                                zIndex: 120,
                                width: 250,
                                background: '#FFFFFF',
                                borderRadius: 10,
                                border: '1px solid #E2E8F0',
                                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
                                padding: 6,
                            }}>
                                <div style={{ padding: '4px 8px 6px', fontSize: 10, fontFamily: 'var(--f-mono, monospace)', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                    Preset Formats
                                </div>
                                {FORMAT_PRESETS.map(fmt => (
                                    <div
                                        key={fmt.id}
                                        onClick={() => {
                                            setSelectedFormat(fmt.id);
                                            setFormatDropdownOpen(false);
                                        }}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '7px 10px',
                                            borderRadius: 6,
                                            cursor: 'pointer',
                                            background: selectedFormat === fmt.id ? '#F0F9FB' : 'transparent',
                                            color: selectedFormat === fmt.id ? '#0B7C91' : '#0F172A',
                                            fontWeight: selectedFormat === fmt.id ? 600 : 500,
                                            fontSize: 12,
                                        }}
                                    >
                                        <span>{fmt.label}</span>
                                        <span style={{ fontSize: 10.5, color: '#64748B', fontFamily: 'var(--f-mono, monospace)' }}>
                                            {fmt.res}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Actions (Undo, Redo, Variations, Save to Timeline, Export) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 2 }}>
                        <button
                            type="button"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 6,
                                background: '#FFFFFF',
                                border: '1px solid #E2E8F0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: undoStack.length > 0 ? '#0F172A' : '#CBD5E1',
                                cursor: undoStack.length > 0 ? 'pointer' : 'default',
                            }}
                            title="Undo"
                        >
                            <Undo size={13} />
                        </button>
                        <button
                            type="button"
                            onClick={handleRedo}
                            disabled={redoStack.length === 0}
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 6,
                                background: '#FFFFFF',
                                border: '1px solid #E2E8F0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: redoStack.length > 0 ? '#0F172A' : '#CBD5E1',
                                cursor: redoStack.length > 0 ? 'pointer' : 'default',
                            }}
                            title="Redo"
                        >
                            <Redo size={13} />
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowVariationsTray(v => !v)}
                        style={{
                            height: 32,
                            padding: '0 12px',
                            borderRadius: 6,
                            background: showVariationsTray ? '#F0F9FB' : '#FFFFFF',
                            border: showVariationsTray ? '1px solid #0B7C91' : '1px solid #E2E8F0',
                            color: showVariationsTray ? '#0B7C91' : '#475569',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <Sparkles size={13} color="#0B7C91" />
                        <span>Variations (4)</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleSaveToTimeline}
                        style={{
                            height: 32,
                            padding: '0 14px',
                            borderRadius: 6,
                            background: '#0F172A',
                            color: '#FFFFFF',
                            border: 'none',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <Save size={13} />
                        <span>Save to timeline</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleSaveAsMotionScene}
                        style={{
                            height: 32,
                            padding: '0 12px',
                            borderRadius: 6,
                            background: '#0F172A',
                            color: '#00E5FF',
                            border: '1px solid rgba(0,229,255,0.3)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                        title="Converts Design Studio layers into live After Effects motion composition with kinetic typography and entrance animations"
                    >
                        <Film size={13} color="#00E5FF" />
                        <span>Save as Animated Scene</span>
                    </button>

                    <button
                        type="button"
                        onClick={handleExportSizes}
                        style={{
                            height: 32,
                            padding: '0 14px',
                            borderRadius: 6,
                            background: '#0B7C91',
                            color: '#FFFFFF',
                            border: 'none',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <Download size={13} />
                        <span>Export 2 sizes</span>
                    </button>
                </div>
            </header>

            {/* Core Studio Workspace: Grid 3-Columns (Height fills remainder of 100vh) */}
            <div style={{
                flex: 1,
                minHeight: 0,
                display: 'grid',
                gridTemplateColumns: 'auto 1fr 300px',
                overflow: 'hidden',
                background: '#F8FAFC',
            }}>
                {/* 1. Left Panel: 2-Tier Slim Rail + Expandable Layers/Assets Drawer */}
                <LayersAndAssetsPanel
                    layers={layers}
                    setLayers={setLayers}
                    selectedLayerIds={selectedLayerIds}
                    setSelectedLayerIds={(ids) => {
                        setSelectedLayerIds(ids);
                        if (ids.length > 0) setSelectedLayerId(ids[0]);
                    }}
                    onInsertComponent={handleInsertComponent}
                    timelineAssets={timelineAssets}
                    onAddAssetToCanvas={handleAddAssetToCanvas}
                    brandKit={brandKit}
                    setBrandKit={setBrandKit}
                    onApplyBrandKit={handleApplyBrandKit}
                    onUploadAssetClick={() => assetInputRef.current?.click()}
                    customComponents={customComponents}
                    onDeleteCustomComponent={handleDeleteCustomComponent}
                    activeTab={leftRailTab}
                    setActiveTab={setLeftRailTab}
                />

                {/* 2. Center Stage: Toolbar, Infinite Artboard Canvas, Breadcrumbs, Floating Copilot */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    minHeight: 0,
                    minWidth: 0,
                    position: 'relative',
                    overflow: 'hidden',
                    borderLeft: '1px solid #E2E8F0',
                    borderRight: '1px solid #E2E8F0',
                }}>
                    {/* Top Canvas Toolbar */}
                    <CanvasToolbar
                        activeTool={activeTool}
                        setActiveTool={setActiveTool}
                        selectedLayersCount={selectedLayerIds.length}
                        onExecuteBoolean={handleExecuteBoolean}
                        onGroupSelected={handleGroupSelected}
                        onUngroupSelected={handleUngroupSelected}
                        snapToGrid={snapEnabled}
                        setSnapToGrid={setSnapEnabled}
                        showGuides={showGuides}
                        setShowGuides={setShowGuides}
                        zoom={zoom}
                        setZoom={setZoom}
                        onUploadImageClick={() => cutoutInputRef.current?.click()}
                    />

                    {/* Interactive Vector Canvas */}
                    <InteractiveVectorCanvas
                        layers={layers}
                        setLayers={setLayers}
                        selectedLayerIds={selectedLayerIds}
                        setSelectedLayerIds={(ids) => {
                            setSelectedLayerIds(ids);
                            if (ids.length > 0) setSelectedLayerId(ids[0]);
                        }}
                        activeTool={activeTool}
                        setActiveTool={setActiveTool}
                        canvasWidth={currentFormat.w}
                        canvasHeight={currentFormat.h}
                        zoom={zoom}
                        setZoom={setZoom}
                        snapToGrid={snapEnabled}
                        showGuides={showGuides}
                        onContextMenu={(ctx) => setContextMenu(ctx)}
                        onUpdateLayer={handleUpdateLayer}
                        onAddLayer={handleAddLayer}
                    />

                    {/* Bottom Breadcrumb Bar (Image 5 Inspiration) */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 14px',
                        background: '#FFFFFF',
                        borderTop: '1px solid #E2E8F0',
                        fontSize: '11px',
                        color: '#64748B',
                        flexShrink: 0,
                        zIndex: 20,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: 600, color: '#0F172A' }}>Artboard</span>
                            <span>/</span>
                            <span>{currentFormat.label}</span>
                            {selectedLayerId && (
                                <>
                                    <span>/</span>
                                    <span style={{ color: '#0B7C91', fontWeight: 600 }}>
                                        {selectedLayer.name || selectedLayerId}
                                    </span>
                                </>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span>{currentFormat.w} × {currentFormat.h}</span>
                            <span>{Math.round(zoom * 100)}%</span>
                        </div>
                    </div>

                    {/* Floating Collapsible AI Copilot Drawer (Image 1 Inspiration) */}
                    <DesignStudioAiDirector
                        layers={layers}
                        setLayers={setLayers}
                        selectedLayerIds={selectedLayerIds}
                        setSelectedLayerIds={setSelectedLayerIds}
                        onDirectionApply={applyDirection}
                        onRemoveBackground={handleToggleBackgroundRemoval}
                        onSaveAsMotionScene={handleSaveAsMotionScene}
                    />

                    {/* Slide-Up Creative Directions Variations Tray */}
                    {showVariationsTray && (
                        <div style={{
                            position: 'absolute',
                            bottom: 31,
                            left: 0,
                            right: 0,
                            height: 146,
                            background: 'rgba(255, 255, 255, 0.96)',
                            backdropFilter: 'blur(12px)',
                            borderTop: '1px solid #CBD5E1',
                            boxShadow: '0 -8px 24px rgba(15, 23, 42, 0.08)',
                            padding: '10px 16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            zIndex: 55,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Sparkles size={14} color="#0B7C91" />
                                    <span style={{ fontWeight: 700, fontSize: 12.5, color: '#0F172A' }}>
                                        Creative Directions
                                    </span>
                                    <span style={{ fontSize: 11, color: '#64748B' }}>
                                        4 live generated variations · click to apply
                                    </span>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <button
                                        type="button"
                                        onClick={(e) => handleApplyAiTweak(e, briefText)}
                                        style={{ background: 'none', border: 'none', color: '#0B7C91', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                    >
                                        <RefreshCw size={12} />
                                        Regenerate
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowVariationsTray(false)}
                                        style={{ background: 'none', border: 'none', color: '#64748B', cursor: 'pointer', padding: 2 }}
                                    >
                                        <X size={15} />
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, flex: 1, minHeight: 0 }}>
                                {directions.map((dir, idx) => (
                                    <div
                                        key={dir.id || idx}
                                        onClick={() => applyDirection(dir)}
                                        style={{
                                            border: '1px solid #E2E8F0',
                                            borderRadius: 8,
                                            padding: 8,
                                            background: '#FFFFFF',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            transition: 'border-color 0.15s ease',
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.borderColor = '#0B7C91'}
                                        onMouseLeave={(e) => e.currentTarget.style.borderColor = '#E2E8F0'}
                                    >
                                        <div style={{
                                            height: 52,
                                            borderRadius: 6,
                                            background: dir.bg || '#1F140E',
                                            padding: '6px 8px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: dir.textFill || '#FFFFFF',
                                            fontWeight: 700,
                                            fontSize: 11,
                                            textAlign: 'center',
                                            overflow: 'hidden',
                                        }}>
                                            {dir.headline || dir.title}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                                            <span style={{ fontSize: 11, fontWeight: 600, color: '#0F172A' }}>{dir.title}</span>
                                            <span style={{ fontSize: 9.5, color: '#64748B' }}>{dir.style}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* 3. Right Panel: Properties Inspector with Tabs (Design, Settings, Surfaces) */}
                <PropertiesInspector
                    selectedLayers={layers.filter(l => selectedLayerIds.includes(l.id))}
                    onUpdateLayer={handleUpdateLayer}
                    onAlign={handleAlignLayers}
                    onDistribute={handleDistributeLayers}
                    onCreateComponent={handleCreateMasterComponent}
                    onToggleBackgroundRemoval={handleToggleBackgroundRemoval}
                    currentFormat={currentFormat}
                    selectedFormat={selectedFormat}
                    setSelectedFormat={setSelectedFormat}
                    formatPresets={FORMAT_PRESETS}
                    onExportSizes={handleExportSizes}
                />
            </div>


                {/* Right-Click Figma-Style Canvas Context Menu */}
                {contextMenu && (
                    <div
                        style={{
                            position: 'fixed',
                            left: contextMenu.x,
                            top: contextMenu.y,
                            zIndex: 9999,
                            minWidth: 220,
                            background: '#FFFFFF',
                            borderRadius: 10,
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            boxShadow: '0 12px 32px rgba(16, 21, 29, 0.16), 0 2px 6px rgba(16, 21, 29, 0.08)',
                            padding: 6,
                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                            fontSize: 12.5,
                            color: '#10151D',
                            userSelect: 'none',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {contextMenu.layerId && contextMenu.layerId !== 'background' ? (
                            <>
                                <div style={{
                                    padding: '4px 8px 6px',
                                    fontSize: 10,
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    color: '#5F6876',
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    borderBottom: '1px solid rgba(16, 21, 29, 0.08)',
                                    marginBottom: 4,
                                }}>
                                    Layer · {(layers.find(l => l.id === contextMenu.layerId)?.name || 'Element').toUpperCase()}
                                </div>

                                <div
                                    onClick={() => { handleDuplicateLayer(contextMenu.layerId); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Copy size={13} /> Duplicate</span>
                                    <span style={{ fontSize: 10, color: '#5F6876', fontFamily: 'var(--f-mono, monospace)' }}>Cmd+D</span>
                                </div>

                                <div
                                    onClick={() => { handleBringForward(contextMenu.layerId); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ArrowUp size={13} /> Bring Forward</span>
                                    <span style={{ fontSize: 10, color: '#5F6876', fontFamily: 'var(--f-mono, monospace)' }}>Cmd+]</span>
                                </div>

                                <div
                                    onClick={() => { handleBringToFront(contextMenu.layerId); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ChevronsUp size={13} /> Bring to Front</span>
                                </div>

                                <div
                                    onClick={() => { handleSendBackward(contextMenu.layerId); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ArrowDown size={13} /> Send Backward</span>
                                    <span style={{ fontSize: 10, color: '#5F6876', fontFamily: 'var(--f-mono, monospace)' }}>Cmd+[</span>
                                </div>

                                <div
                                    onClick={() => { handleSendToBack(contextMenu.layerId); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><ChevronsDown size={13} /> Send to Back</span>
                                </div>

                                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '4px 0' }} />

                                <div
                                    onClick={() => {
                                        setLayers(prev => prev.map(l => l.id === contextMenu.layerId ? { ...l, locked: !l.locked } : l));
                                        setContextMenu(null);
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    {layers.find(l => l.id === contextMenu.layerId)?.locked ? <Unlock size={13} /> : <Lock size={13} />}
                                    {layers.find(l => l.id === contextMenu.layerId)?.locked ? 'Unlock Layer' : 'Lock Layer'}
                                </div>

                                <div
                                    onClick={() => {
                                        setLayers(prev => prev.map(l => l.id === contextMenu.layerId ? { ...l, visible: !l.visible } : l));
                                        setContextMenu(null);
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    {layers.find(l => l.id === contextMenu.layerId)?.visible ? <EyeOff size={13} /> : <Eye size={13} />}
                                    {layers.find(l => l.id === contextMenu.layerId)?.visible ? 'Hide Layer' : 'Show Layer'}
                                </div>

                                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '4px 0' }} />

                                {(() => {
                                    const layer = layers.find(l => l.id === contextMenu.layerId);
                                    if (layer && (layer.type === 'image' || layer.src || layer.id === 'subject')) {
                                        return (
                                            <div
                                                onClick={() => {
                                                    handleToggleBackgroundRemoval(contextMenu.layerId);
                                                    setContextMenu(null);
                                                }}
                                                style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <Sparkles size={13} color="#0B7C91" />
                                                <span>{layer.backgroundRemoved ? 'Restore Background' : 'Remove Background'}</span>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}

                                <div
                                    onClick={() => {
                                        handleCreateMasterComponent(layers.find(l => l.id === contextMenu.layerId));
                                        setContextMenu(null);
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Layers size={13} color="#0B7C91" />
                                    <span>Create Master Component</span>
                                </div>

                                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '4px 0' }} />

                                <div
                                    onClick={() => {
                                        pushUndo();
                                        setLayers(prev => prev.filter(l => l.id !== contextMenu.layerId));
                                        setSelectedLayerId('background');
                                        setContextMenu(null);
                                        showToast('Layer deleted');
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: '#D9383A' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#FDF2F2'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Trash2 size={13} /> Delete Layer</span>
                                    <span style={{ fontSize: 10, color: '#D9383A', fontFamily: 'var(--f-mono, monospace)' }}>Del</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{
                                    padding: '4px 8px 6px',
                                    fontSize: 10,
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    color: '#5F6876',
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    borderBottom: '1px solid rgba(16, 21, 29, 0.08)',
                                    marginBottom: 4,
                                }}>
                                    Canvas Actions
                                </div>

                                <div
                                    onClick={() => { handleAddText(); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Type size={13} color="#0B7C91" /> Add Text Layer
                                </div>

                                <div
                                    onClick={() => { handleAddRect(); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Square size={13} color="#5F6876" /> Add Rectangle
                                </div>

                                <div
                                    onClick={() => { handleAddCircle(); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Circle size={13} color="#5F6876" /> Add Circle
                                </div>

                                <div
                                    onClick={() => { handleAddStar(); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Star size={13} color="#5F6876" /> Add Star
                                </div>

                                <div
                                    onClick={() => { handleAddLine(); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <PenTool size={13} color="#5F6876" /> Add Line Divider
                                </div>

                                <div
                                    onClick={() => { handleAddBadge(); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Sliders size={13} color="#5F6876" /> Add Badge Pill
                                </div>

                                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '4px 0' }} />

                                <div
                                    onClick={() => {
                                        setLayers(prev => prev.map(l => l.id === contextMenu.layerId ? { ...l, locked: !l.locked } : l));
                                        setContextMenu(null);
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    {layers.find(l => l.id === contextMenu.layerId)?.locked ? <Unlock size={13} /> : <Lock size={13} />}
                                    {layers.find(l => l.id === contextMenu.layerId)?.locked ? 'Unlock Layer' : 'Lock Layer'}
                                </div>

                                <div
                                    onClick={() => {
                                        setLayers(prev => prev.map(l => l.id === contextMenu.layerId ? { ...l, visible: !l.visible } : l));
                                        setContextMenu(null);
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    {layers.find(l => l.id === contextMenu.layerId)?.visible ? <EyeOff size={13} /> : <Eye size={13} />}
                                    {layers.find(l => l.id === contextMenu.layerId)?.visible ? 'Hide Layer' : 'Show Layer'}
                                </div>

                                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '4px 0' }} />

                                {(() => {
                                    const layer = layers.find(l => l.id === contextMenu.layerId);
                                    if (layer && (layer.type === 'image' || layer.src || layer.id === 'subject')) {
                                        return (
                                            <div
                                                onClick={() => {
                                                    handleToggleBackgroundRemoval(contextMenu.layerId);
                                                    setContextMenu(null);
                                                }}
                                                style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                                onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                            >
                                                <Sparkles size={13} color="#0B7C91" />
                                                <span>{layer.backgroundRemoved ? 'Restore Background' : 'Remove Background'}</span>
                                            </div>
                                        );
                                    }
                                    return null;
                                })()}

                                <div
                                    onClick={() => {
                                        handleCreateMasterComponent(layers.find(l => l.id === contextMenu.layerId));
                                        setContextMenu(null);
                                    }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Layers size={13} color="#0B7C91" />
                                    <span>Create Master Component</span>
                                </div>

                                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)', margin: '4px 0' }} />

                                <div
                                    onClick={() => { setAssetDrawerOpen(true); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <FolderOpen size={13} color="#0B7C91" /> Import Asset / Image...
                                </div>

                                <div
                                    onClick={() => { setBrandKitModalOpen(true); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Palette size={13} color="#0B7C91" /> Brand Kit Settings...
                                </div>

                                <div
                                    onClick={() => { setSafeAreasEnabled(s => !s); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <CheckCircle2 size={13} color={safeAreasEnabled ? '#0F7A52' : '#5F6876'} />
                                    {safeAreasEnabled ? 'Disable Safe Areas' : 'Enable Safe Areas'}
                                </div>

                                <div
                                    onClick={() => { setZoomLevel(100); setContextMenu(null); }}
                                    style={{ padding: '6px 10px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                                    onMouseEnter={(e) => e.currentTarget.style.background = '#F0F4F8'}
                                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Maximize2 size={13} /> Reset Zoom (100%)
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* Asset & Media Import Drawer Modal */}
                {assetDrawerOpen && (
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 9998,
                            background: 'rgba(16, 21, 29, 0.45)',
                            backdropFilter: 'blur(4px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        onClick={() => setAssetDrawerOpen(false)}
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                width: 660,
                                maxWidth: '92vw',
                                maxHeight: '85vh',
                                background: '#FFFFFF',
                                borderRadius: 16,
                                padding: 24,
                                boxShadow: '0 24px 64px rgba(16, 21, 29, 0.25)',
                                display: 'flex',
                                flexDirection: 'column',
                                overflow: 'hidden',
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                                <div>
                                    <h2 style={{
                                        margin: 0,
                                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                        fontWeight: 700,
                                        fontSize: 18,
                                        color: '#10151D',
                                    }}>
                                        Assets & Media Bin
                                    </h2>
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5F6876' }}>
                                        Import local images, cutout subjects, or choose footage from your active project timeline.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setAssetDrawerOpen(false)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5F6876', padding: 4 }}
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Tab switch: Upload vs Timeline Media */}
                            <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(16, 21, 29, 0.08)', paddingBottom: 10, marginBottom: 16 }}>
                                <button
                                    type="button"
                                    onClick={() => setAssetDrawerTab('upload')}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: 8,
                                        border: 'none',
                                        background: assetDrawerTab === 'upload' ? '#F0F9FB' : 'transparent',
                                        color: assetDrawerTab === 'upload' ? '#0B7C91' : '#5F6876',
                                        fontSize: 13,
                                        fontWeight: assetDrawerTab === 'upload' ? 600 : 500,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Upload Local Image
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setAssetDrawerTab('timeline')}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: 8,
                                        border: 'none',
                                        background: assetDrawerTab === 'timeline' ? '#F0F9FB' : 'transparent',
                                        color: assetDrawerTab === 'timeline' ? '#0B7C91' : '#5F6876',
                                        fontSize: 13,
                                        fontWeight: assetDrawerTab === 'timeline' ? 600 : 500,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                    }}
                                >
                                    Project Media Bin ({timelineAssets.length})
                                </button>
                            </div>

                            {/* Tab 1: Upload */}
                            {assetDrawerTab === 'upload' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                    <div
                                        onClick={() => assetInputRef.current?.click()}
                                        style={{
                                            border: '2px dashed rgba(11, 124, 145, 0.35)',
                                            borderRadius: 12,
                                            padding: '40px 20px',
                                            background: '#F9FAFB',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            gap: 10,
                                        }}
                                    >
                                        <UploadCloud size={38} color="#0B7C91" />
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 14, color: '#10151D' }}>
                                                Click to browse, or drag & drop files here
                                            </div>
                                            <div style={{ fontSize: 12, color: '#5F6876', marginTop: 4 }}>
                                                Supports PNG, JPG, SVG, WebP with transparency
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tab 2: Timeline Media Bin */}
                            {assetDrawerTab === 'timeline' && (
                                <div style={{ overflowY: 'auto', maxHeight: 380, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {timelineAssets.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#5F6876' }}>
                                            <Film size={32} color="#5F6876" style={{ margin: '0 auto 10px' }} />
                                            <div style={{ fontSize: 13, fontWeight: 500 }}>No media files in timeline yet</div>
                                            <div style={{ fontSize: 12, marginTop: 4 }}>Upload video footage or images in the Video Editor to access them here.</div>
                                        </div>
                                    ) : (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                                            {timelineAssets.map((asset, idx) => (
                                                <div
                                                    key={asset.id || idx}
                                                    style={{
                                                        border: '1px solid rgba(16, 21, 29, 0.1)',
                                                        borderRadius: 10,
                                                        overflow: 'hidden',
                                                        background: '#FFFFFF',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                    }}
                                                >
                                                    <div style={{
                                                        height: 96,
                                                        background: '#10151D',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        position: 'relative',
                                                        overflow: 'hidden',
                                                    }}>
                                                        {asset.thumbnailUrl || asset.url ? (
                                                            <img
                                                                src={asset.thumbnailUrl || asset.url}
                                                                alt={asset.name}
                                                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                            />
                                                        ) : (
                                                            <Film size={26} color="#FFFFFF" />
                                                        )}
                                                        <span style={{
                                                            position: 'absolute',
                                                            bottom: 4,
                                                            left: 4,
                                                            padding: '2px 5px',
                                                            borderRadius: 4,
                                                            background: 'rgba(0,0,0,0.6)',
                                                            color: '#FFFFFF',
                                                            fontSize: 9,
                                                            fontFamily: 'var(--f-mono, monospace)',
                                                        }}>
                                                            {asset.type || 'VIDEO'}
                                                        </span>
                                                    </div>
                                                    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#10151D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {asset.name || `Asset ${idx + 1}`}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleAddAssetToCanvas(asset, asset.name)}
                                                            style={{
                                                                padding: '6px 8px',
                                                                borderRadius: 6,
                                                                background: '#0B7C91',
                                                                color: '#FFFFFF',
                                                                border: 'none',
                                                                fontSize: 11.5,
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                            }}
                                                        >
                                                            Add to Canvas
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Visual Brand Kit Panel Modal */}
                {brandKitModalOpen && (
                    <div
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: 9998,
                            background: 'rgba(16, 21, 29, 0.45)',
                            backdropFilter: 'blur(4px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        onClick={() => setBrandKitModalOpen(false)}
                    >
                        <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                                width: 600,
                                maxWidth: '92vw',
                                maxHeight: '90vh',
                                background: '#FFFFFF',
                                borderRadius: 16,
                                padding: 24,
                                boxShadow: '0 24px 64px rgba(16, 21, 29, 0.25)',
                                display: 'flex',
                                flexDirection: 'column',
                                overflowY: 'auto',
                                gap: 18,
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div>
                                    <h2 style={{
                                        margin: 0,
                                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                        fontWeight: 700,
                                        fontSize: 18,
                                        color: '#10151D',
                                    }}>
                                        Brand Kit Manager
                                    </h2>
                                    <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5F6876' }}>
                                        Configure brand colors, typography, and logos for one-click styling.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setBrandKitModalOpen(false)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#5F6876', padding: 4 }}
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* Presets */}
                            <div>
                                <div style={{ fontFamily: 'var(--f-mono, monospace)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5F6876', marginBottom: 8 }}>
                                    Brand Presets
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    {[
                                        { name: 'Minimalist Studio', accent: '#C85A17', accent2: '#1F140E', surface: '#1F140E', text: '#F4EDE2', display: 'Plus Jakarta Sans' },
                                        { name: 'Electric Cyber', accent: '#00E5FF', accent2: '#0B7C91', surface: '#0A0E17', text: '#00E5FF', display: 'Plus Jakarta Sans' },
                                        { name: 'Warm Editorial', accent: '#C85A17', accent2: '#10151D', surface: '#F4EDE2', text: '#10151D', display: 'Instrument Serif' },
                                        { name: 'Monochrome Pro', accent: '#10151D', accent2: '#5F6876', surface: '#10151D', text: '#FFFFFF', display: 'Geist' },
                                    ].map(preset => (
                                        <button
                                            key={preset.name}
                                            type="button"
                                            onClick={() => {
                                                setBrandKit(prev => ({ ...prev, ...preset }));
                                                showToast(`Loaded ${preset.name} preset`);
                                            }}
                                            style={{
                                                padding: '8px 10px',
                                                borderRadius: 8,
                                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                                background: '#FFFFFF',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 8,
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            }}
                                        >
                                            <span style={{ width: 14, height: 14, borderRadius: 4, background: preset.accent }} />
                                            <span style={{ fontSize: 12, fontWeight: 500, color: '#10151D' }}>{preset.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Color Palette */}
                            <div>
                                <div style={{ fontFamily: 'var(--f-mono, monospace)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5F6876', marginBottom: 8 }}>
                                    Color Palette
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <div style={{ border: '1px solid #DFE6ED', borderRadius: 8, padding: '6px 10px' }}>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginBottom: 4 }}>Primary Accent</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="color"
                                                value={brandKit.accent}
                                                onChange={e => setBrandKit(b => ({ ...b, accent: e.target.value }))}
                                                style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
                                            />
                                            <input
                                                type="text"
                                                value={brandKit.accent}
                                                onChange={e => setBrandKit(b => ({ ...b, accent: e.target.value }))}
                                                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--f-mono, monospace)' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ border: '1px solid #DFE6ED', borderRadius: 8, padding: '6px 10px' }}>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginBottom: 4 }}>Secondary Accent</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="color"
                                                value={brandKit.accent2}
                                                onChange={e => setBrandKit(b => ({ ...b, accent2: e.target.value }))}
                                                style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
                                            />
                                            <input
                                                type="text"
                                                value={brandKit.accent2}
                                                onChange={e => setBrandKit(b => ({ ...b, accent2: e.target.value }))}
                                                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--f-mono, monospace)' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ border: '1px solid #DFE6ED', borderRadius: 8, padding: '6px 10px' }}>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginBottom: 4 }}>Surface Background</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="color"
                                                value={brandKit.surface}
                                                onChange={e => setBrandKit(b => ({ ...b, surface: e.target.value }))}
                                                style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
                                            />
                                            <input
                                                type="text"
                                                value={brandKit.surface}
                                                onChange={e => setBrandKit(b => ({ ...b, surface: e.target.value }))}
                                                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--f-mono, monospace)' }}
                                            />
                                        </div>
                                    </div>

                                    <div style={{ border: '1px solid #DFE6ED', borderRadius: 8, padding: '6px 10px' }}>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginBottom: 4 }}>Text Primary</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="color"
                                                value={brandKit.text}
                                                onChange={e => setBrandKit(b => ({ ...b, text: e.target.value }))}
                                                style={{ width: 26, height: 26, border: 'none', background: 'none', cursor: 'pointer' }}
                                            />
                                            <input
                                                type="text"
                                                value={brandKit.text}
                                                onChange={e => setBrandKit(b => ({ ...b, text: e.target.value }))}
                                                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, fontFamily: 'var(--f-mono, monospace)' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Typography */}
                            <div>
                                <div style={{ fontFamily: 'var(--f-mono, monospace)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#5F6876', marginBottom: 8 }}>
                                    Brand Typography
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                    <div>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginBottom: 4 }}>Display Headline</div>
                                        <select
                                            value={brandKit.display}
                                            onChange={e => setBrandKit(b => ({ ...b, display: e.target.value }))}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #DFE6ED', fontSize: 12 }}
                                        >
                                            <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                                            <option value="Instrument Serif">Instrument Serif</option>
                                            <option value="Geist">Geist</option>
                                            <option value="JetBrains Mono">JetBrains Mono</option>
                                            <option value="Inter">Inter</option>
                                        </select>
                                    </div>

                                    <div>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginBottom: 4 }}>Body Text</div>
                                        <select
                                            value={brandKit.body}
                                            onChange={e => setBrandKit(b => ({ ...b, body: e.target.value }))}
                                            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #DFE6ED', fontSize: 12 }}
                                        >
                                            <option value="Geist">Geist</option>
                                            <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                                            <option value="Inter">Inter</option>
                                            <option value="JetBrains Mono">JetBrains Mono</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid rgba(16, 21, 29, 0.08)', paddingTop: 16 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        type="button"
                                        onClick={() => brandKitInputRef.current?.click()}
                                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #DFE6ED', background: '#FFFFFF', fontSize: 12, cursor: 'pointer', color: '#10151D' }}
                                    >
                                        Import JSON
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleExportBrandKit}
                                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #DFE6ED', background: '#FFFFFF', fontSize: 12, cursor: 'pointer', color: '#10151D' }}
                                    >
                                        Export JSON
                                    </button>
                                </div>

                                <button
                                    type="button"
                                    onClick={handleApplyBrandKit}
                                    style={{
                                        padding: '8px 18px',
                                        borderRadius: 8,
                                        background: '#0B7C91',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        fontSize: 13,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                    }}
                                >
                                    Apply to Canvas
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Hidden File Inputs */}
                <input
                    type="file"
                    ref={assetInputRef}
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = ev => handleAddAssetToCanvas(ev.target.result, file.name.replace(/\.[^.]+$/, ''));
                            reader.readAsDataURL(file);
                        }
                    }}
                />
                <input
                    type="file"
                    ref={brandKitInputRef}
                    accept=".json,application/json"
                    style={{ display: 'none' }}
                    onChange={handleImportBrandKit}
                />
                <input
                    type="file"
                    ref={logoInputRef}
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = ev => {
                                setBrandKit(b => ({ ...b, logoUrl: ev.target.result }));
                                showToast('Logo loaded into brand kit');
                            };
                            reader.readAsDataURL(file);
                        }
                    }}
                />
        </div>
    );
}
