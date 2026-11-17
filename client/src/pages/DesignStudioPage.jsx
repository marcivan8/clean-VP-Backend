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
    const { projectName, addOverlayClip, assets: timelineAssets = [] } = useTimelineStore();

    // Sidebar Collapse state (Option A)
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
            display: 'flex',
            minHeight: '100vh',
            background: '#EDEAE3',
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

            {/* Left Collapsible Creative Tool Shelf */}
            <aside style={{
                width: sidebarCollapsed ? 64 : 240,
                transition: 'width 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
                flexShrink: 0,
                background: '#FFFFFF',
                borderRight: '1px solid rgba(16, 21, 29, 0.09)',
                padding: sidebarCollapsed ? '20px 8px' : '20px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
                position: 'sticky',
                top: 0,
                height: '100vh',
                overflowY: 'auto',
                overflowX: 'hidden',
                zIndex: 30,
                boxShadow: '2px 0 12px rgba(16, 21, 29, 0.03)',
            }}>
                {/* Brand Logo & Collapse Toggle */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: sidebarCollapsed ? 'center' : 'space-between',
                    padding: '0 4px',
                }}>
                    {!sidebarCollapsed ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Logo size={22} />
                            <span style={{
                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                fontWeight: 800,
                                fontSize: 16,
                                letterSpacing: '-0.02em',
                                color: '#10151D',
                            }}>
                                VIBED
                            </span>
                        </div>
                    ) : (
                        <Logo size={22} />
                    )}
                    <button
                        type="button"
                        onClick={() => setSidebarCollapsed(c => !c)}
                        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#5F6876',
                            cursor: 'pointer',
                            padding: 6,
                            borderRadius: 6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
                    </button>
                </div>

                {/* Section 1: Navigation Links */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {!sidebarCollapsed && (
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: '#5F6876',
                            padding: '0 8px 4px',
                        }}>
                            Navigation
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={() => navigate('/editor')}
                        title="Back to Video Editor"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'transparent',
                            border: 'none',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <ArrowLeft size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Back to Editor</span>}
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/dashboard')}
                        title="Projects Hub"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 8,
                            background: 'transparent',
                            border: 'none',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Film size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Projects</span>}
                    </button>
                </div>

                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)' }} />

                {/* Section 2: Creative Tool Shelf */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {!sidebarCollapsed && (
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: '#5F6876',
                            padding: '0 8px 4px',
                        }}>
                            Add to Canvas
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={handleAddText}
                        title="Add Text Layer"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Type size={16} color="#0B7C91" />
                        {!sidebarCollapsed && <span>Add Text</span>}
                    </button>
                    <button
                        type="button"
                        onClick={handleAddRect}
                        title="Add Rectangle"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Square size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Rectangle</span>}
                    </button>
                    <button
                        type="button"
                        onClick={handleAddCircle}
                        title="Add Circle"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Circle size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Circle</span>}
                    </button>
                    <button
                        type="button"
                        onClick={handleAddBadge}
                        title="Add Badge Pill"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Sliders size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Badge Pill</span>}
                    </button>
                    <button
                        type="button"
                        onClick={handleAddStar}
                        title="Add Star"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Star size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Star</span>}
                    </button>
                    <button
                        type="button"
                        onClick={handleAddLine}
                        title="Add Line"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <PenTool size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Line Divider</span>}
                    </button>
                    <button
                        type="button"
                        onClick={() => setAssetDrawerOpen(true)}
                        title="Open Assets & Media Drawer"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F0F9FB',
                            border: '1px solid rgba(11, 124, 145, 0.25)',
                            color: '#0B7C91',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <FolderOpen size={16} color="#0B7C91" />
                        {!sidebarCollapsed && <span>Assets & Media</span>}
                    </button>
                    <button
                        type="button"
                        onClick={() => setBrandKitModalOpen(true)}
                        title="Manage Brand Kit"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '9px 10px',
                            borderRadius: 8,
                            background: '#F8F9FA',
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                            color: '#10151D',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                            justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                        }}
                    >
                        <Palette size={16} color="#5F6876" />
                        {!sidebarCollapsed && <span>Brand Kit</span>}
                    </button>
                </div>

                <div style={{ height: 1, background: 'rgba(16, 21, 29, 0.08)' }} />

                {/* Section 3: Brand Directions Quick-Swap */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {!sidebarCollapsed && (
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: '#5F6876',
                            padding: '0 8px 4px',
                        }}>
                            Directions
                        </div>
                    )}
                    {DIRECTIONS.map(dir => (
                        <button
                            key={dir.id}
                            type="button"
                            onClick={() => applyDirection(dir)}
                            title={dir.title}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '8px 10px',
                                borderRadius: 8,
                                background: 'transparent',
                                border: '1px solid rgba(16, 21, 29, 0.06)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                            }}
                        >
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: dir.accentColor, flexShrink: 0 }} />
                            {!sidebarCollapsed && (
                                <span style={{ fontSize: 12, fontWeight: 500, color: '#10151D', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {dir.title}
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Delete Selected Layer Action */}
                {selectedLayerId && selectedLayerId !== 'background' && (
                    <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                        <button
                            type="button"
                            onClick={handleDeleteSelectedLayer}
                            title="Delete Selected Layer"
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 10px',
                                borderRadius: 8,
                                background: '#FFF1F0',
                                border: '1px solid #FFCCC7',
                                color: '#CF1322',
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: 'pointer',
                                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                            }}
                        >
                            <Trash2 size={15} />
                            {!sidebarCollapsed && <span>Delete Layer</span>}
                        </button>
                    </div>
                )}
            </aside>

            {/* Main Stage & Studio Work Area */}
            <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {/* Top Context & Action Bar */}
                <header style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 28px',
                    borderBottom: '1px solid rgba(16, 21, 29, 0.08)',
                    background: '#FFFFFF',
                    position: 'sticky',
                    top: 0,
                    zIndex: 25,
                    boxShadow: '0 2px 10px rgba(16, 21, 29, 0.03)',
                }}>
                    <div>
                        <div style={{
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 11,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            color: '#0B7C91',
                            fontWeight: 600,
                            marginBottom: 2,
                        }}>
                            {projectName ? `${projectName} · Scene & Thumbnail Design` : 'PROJECT · FIGMA STUDIO'}
                        </div>
                        <h1 style={{
                            fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                            fontSize: 24,
                            fontWeight: 800,
                            margin: 0,
                            color: '#10151D',
                            letterSpacing: '-0.025em',
                            lineHeight: 1.2,
                        }}>
                            Design Studio
                        </h1>
                    </div>

                    {/* Mode & Action Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* Segmented Mode: Generate | Manual */}
                        <div style={{
                            display: 'flex',
                            background: '#F0EFEA',
                            padding: 3,
                            borderRadius: 10,
                            border: '1px solid rgba(16, 21, 29, 0.08)',
                        }}>
                            <button
                                type="button"
                                onClick={() => setEditMode('generate')}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 8,
                                    border: 'none',
                                    background: editMode === 'generate' ? '#10151D' : 'transparent',
                                    color: editMode === 'generate' ? '#FFFFFF' : '#5F6876',
                                    fontSize: 13,
                                    fontWeight: editMode === 'generate' ? 600 : 500,
                                    cursor: 'pointer',
                                    boxShadow: editMode === 'generate' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none',
                                }}
                            >
                                Generate
                            </button>
                            <button
                                type="button"
                                onClick={() => setEditMode('edit')}
                                style={{
                                    padding: '6px 14px',
                                    borderRadius: 8,
                                    border: 'none',
                                    background: editMode === 'edit' ? '#10151D' : 'transparent',
                                    color: editMode === 'edit' ? '#FFFFFF' : '#5F6876',
                                    fontSize: 13,
                                    fontWeight: editMode === 'edit' ? 600 : 500,
                                    cursor: 'pointer',
                                    boxShadow: editMode === 'edit' ? '0 2px 6px rgba(0,0,0,0.1)' : 'none',
                                }}
                            >
                                Manual
                            </button>
                        </div>

                        {/* Undo / Redo */}
                        <div style={{ display: 'flex', gap: 4 }}>
                            <button
                                type="button"
                                onClick={handleUndo}
                                disabled={undoStack.length === 0}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#FFFFFF',
                                    border: '1px solid rgba(16, 21, 29, 0.12)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: undoStack.length > 0 ? '#10151D' : 'rgba(16, 21, 29, 0.3)',
                                    cursor: undoStack.length > 0 ? 'pointer' : 'default',
                                }}
                                title="Undo"
                            >
                                <Undo size={15} />
                            </button>
                            <button
                                type="button"
                                onClick={handleRedo}
                                disabled={redoStack.length === 0}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#FFFFFF',
                                    border: '1px solid rgba(16, 21, 29, 0.12)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: redoStack.length > 0 ? '#10151D' : 'rgba(16, 21, 29, 0.3)',
                                    cursor: redoStack.length > 0 ? 'pointer' : 'default',
                                }}
                                title="Redo"
                            >
                                <Redo size={15} />
                            </button>
                        </div>

                        {/* Brand Kit Quick Toggle & Settings */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <button
                                type="button"
                                onClick={toggleBrandKit}
                                style={{
                                    height: 36,
                                    padding: '0 12px',
                                    borderRadius: 8,
                                    background: kitOn ? '#F0F9FB' : '#FFFFFF',
                                    border: kitOn ? '1px solid #0B7C91' : '1px solid rgba(16, 21, 29, 0.12)',
                                    color: kitOn ? '#0B7C91' : '#5F6876',
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}
                                title="Toggle Brand Kit styling on/off"
                            >
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: kitOn ? '#0B7C91' : '#5F6876' }} />
                                {kitOn ? 'Kit on' : 'Kit off'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setBrandKitModalOpen(true)}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 8,
                                    background: '#FFFFFF',
                                    border: '1px solid rgba(16, 21, 29, 0.12)',
                                    color: '#5F6876',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                }}
                                title="Configure Brand Kit"
                            >
                                <Palette size={15} />
                            </button>
                        </div>

                        {/* Assets Drawer Quick Button */}
                        <button
                            type="button"
                            onClick={() => setAssetDrawerOpen(true)}
                            style={{
                                height: 36,
                                padding: '0 12px',
                                borderRadius: 8,
                                background: '#FFFFFF',
                                border: '1px solid rgba(16, 21, 29, 0.12)',
                                color: '#10151D',
                                fontSize: 12.5,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                            }}
                            title="Open Assets & Media Drawer"
                        >
                            <FolderOpen size={15} color="#0B7C91" />
                            Assets
                        </button>

                        {/* Save to Timeline (Primary Integration) */}
                        <button
                            type="button"
                            onClick={handleSaveToTimeline}
                            style={{
                                height: 38,
                                padding: '0 16px',
                                borderRadius: 8,
                                background: '#10151D',
                                color: '#FFFFFF',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 7,
                                boxShadow: '0 2px 8px rgba(16, 21, 29, 0.18)',
                            }}
                        >
                            <Save size={15} />
                            Save to timeline
                        </button>

                        {/* Export Sizes */}
                        <button
                            type="button"
                            onClick={handleExportSizes}
                            style={{
                                height: 38,
                                padding: '0 14px',
                                borderRadius: 8,
                                background: '#0B7C91',
                                color: '#FFFFFF',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 7,
                                boxShadow: '0 2px 8px rgba(11, 124, 145, 0.25)',
                            }}
                        >
                            <Download size={15} />
                            Export sizes
                        </button>
                    </div>
                </header>

                {/* Workspace Canvas & Panels */}
                <div style={{ padding: '24px 28px 60px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Top Section: Brief & Format Controller */}
                    <section style={{
                        border: '1px solid rgba(16, 21, 29, 0.08)',
                        borderRadius: 16,
                        background: '#FFFFFF',
                        padding: '18px 20px',
                        boxShadow: '0 2px 8px rgba(16, 21, 29, 0.03)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <h2 style={{
                                margin: 0,
                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                fontWeight: 700,
                                fontSize: 16,
                                color: '#10151D',
                            }}>
                                Format & Brief
                            </h2>
                            <span style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 11,
                                color: '#5F6876',
                            }}>
                                {currentFormat.res}
                            </span>
                        </div>

                        {/* Format Pills */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                            {FORMAT_PRESETS.map(fmt => {
                                const isSel = selectedFormat === fmt.id;
                                return (
                                    <button
                                        key={fmt.id}
                                        type="button"
                                        onClick={() => setSelectedFormat(fmt.id)}
                                        style={{
                                            minHeight: 36,
                                            padding: '0 14px',
                                            borderRadius: 999,
                                            border: isSel ? '1.5px solid #0B7C91' : '1px solid rgba(16, 21, 29, 0.12)',
                                            background: isSel ? '#F0F9FB' : '#FFFFFF',
                                            color: isSel ? '#0B7C91' : '#5F6876',
                                            fontSize: 13,
                                            fontWeight: isSel ? 600 : 400,
                                            cursor: 'pointer',
                                            transition: 'all 0.15s ease',
                                        }}
                                    >
                                        {fmt.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Prompt & Generation Strip */}
                        <form onSubmit={(e) => handleApplyAiTweak(e, briefText)} style={{ display: 'flex', gap: 10, alignItems: 'center', width: '100%' }}>
                            <input
                                type="text"
                                value={briefText}
                                onChange={e => setBriefText(e.target.value)}
                                placeholder='e.g. create a simple thumbnail with text saying "goodbye"'
                                style={{
                                    flex: 1,
                                    height: 40,
                                    padding: '0 16px',
                                    borderRadius: 8,
                                    border: '1px solid rgba(16, 21, 29, 0.14)',
                                    background: '#F8F9FA',
                                    color: '#10151D',
                                    fontSize: 13,
                                    outline: 'none',
                                }}
                            />
                            <button
                                type="submit"
                                style={{
                                    height: 40,
                                    padding: '0 18px',
                                    borderRadius: 8,
                                    background: '#10151D',
                                    color: '#FFFFFF',
                                    border: 'none',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}
                            >
                                <Sparkles size={14} color="#00E5FF" />
                                Generate four
                            </button>
                        </form>
                    </section>

                    {/* Middle Row: Professional Figma-grade 3-Pane Studio Workspace */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '260px 1fr 320px',
                        gap: '16px',
                        alignItems: 'start',
                        background: '#12141A',
                        padding: '16px',
                        borderRadius: '16px',
                        border: '1px solid #2A2E39',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    }}>
                        {/* 1. Left Panel: Layers, Components & Design Tokens */}
                        <LayersAndAssetsPanel
                            layers={layers}
                            setLayers={setLayers}
                            selectedLayerIds={selectedLayerIds}
                            setSelectedLayerIds={(ids) => {
                                setSelectedLayerIds(ids);
                                if (ids.length > 0) setSelectedLayerId(ids[0]);
                            }}
                            onInsertComponent={handleInsertComponent}
                            onApplyTheme={handleApplyTheme}
                            onApplyTypographyStyle={handleApplyTypographyStyle}
                        />

                        {/* 2. Center Stage: Canvas Toolbar, Interactive Vector Canvas & AI Director */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%', minWidth: 0 }}>
                            <div style={{
                                background: '#161920',
                                border: '1px solid #2A2E39',
                                borderRadius: '12px',
                                overflow: 'hidden',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                            }}>
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
                                    snapToGrid={snapEnabled}
                                    showGuides={showGuides}
                                    onContextMenu={(ctx) => setContextMenu(ctx)}
                                    onUpdateLayer={handleUpdateLayer}
                                    onAddLayer={handleAddLayer}
                                />
                            </div>

                            {/* Conversational AI Director ("Or just say it") */}
                            <DesignStudioAiDirector
                                layers={layers}
                                setLayers={setLayers}
                                selectedLayerIds={selectedLayerIds}
                                setSelectedLayerIds={setSelectedLayerIds}
                                onDirectionApply={applyDirection}
                            />
                        </div>

                        {/* 3. Right Panel: Properties Inspector */}
                        <PropertiesInspector
                            selectedLayers={layers.filter(l => selectedLayerIds.includes(l.id))}
                            onUpdateLayer={handleUpdateLayer}
                            onAlign={handleAlignLayers}
                            onDistribute={handleDistributeLayers}
                            onCreateComponent={(layer) => {
                                showToast(`Created master component "${layer.name || 'Component'}"`);
                            }}
                        />
                    </div>

                    {/* Creative Directions Preview Strip (4 Synthesized Thumbnail Variants) */}
                    <section style={{
                        border: '1px solid rgba(16, 21, 29, 0.08)',
                        borderRadius: 16,
                        background: '#FFFFFF',
                        padding: '18px 22px',
                        boxShadow: '0 2px 8px rgba(16, 21, 29, 0.03)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Sparkles size={16} color="#0B7C91" />
                                <h2 style={{
                                    margin: 0,
                                    fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                    fontWeight: 700,
                                    fontSize: 16,
                                    color: '#10151D',
                                }}>
                                    Creative Directions
                                </h2>
                                <span style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 11,
                                    color: '#5F6876',
                                    marginLeft: 6,
                                }}>
                                    4 live generated variations · click to apply
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={(e) => handleApplyAiTweak(e, briefText)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#0B7C91',
                                    fontSize: 12.5,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                }}
                            >
                                <RefreshCw size={13} />
                                Regenerate four
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                            {directions.map((dir, idx) => (
                                <div
                                    key={dir.id || idx}
                                    onClick={() => applyDirection(dir)}
                                    style={{
                                        border: '1px solid rgba(16, 21, 29, 0.12)',
                                        borderRadius: 12,
                                        padding: 12,
                                        background: '#FFFFFF',
                                        cursor: 'pointer',
                                        transition: 'all 0.18s ease',
                                        boxShadow: '0 2px 8px rgba(16, 21, 29, 0.03)',
                                    }}
                                >
                                    <div style={{
                                        height: 72,
                                        borderRadius: 8,
                                        background: dir.bg || '#1F140E',
                                        padding: '10px 12px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        justifyContent: 'space-between',
                                        marginBottom: 10,
                                        border: '1px solid rgba(0,0,0,0.12)',
                                    }}>
                                        <div style={{
                                            color: dir.textFill || '#FFFFFF',
                                            fontFamily: `"${dir.fontFamily || 'Plus Jakarta Sans'}", sans-serif`,
                                            fontWeight: 800,
                                            fontSize: 14,
                                            lineHeight: 1.15,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            letterSpacing: '-0.02em',
                                        }}>
                                            {dir.layers?.find(l => l.id === 'headline')?.text || dir.headline || 'HEADLINE'}
                                        </div>
                                        <div style={{
                                            display: 'inline-block',
                                            alignSelf: 'flex-start',
                                            padding: '2px 6px',
                                            borderRadius: 4,
                                            background: dir.badgeFill || '#C85A17',
                                            color: '#FFFFFF',
                                            fontSize: 9.5,
                                            fontFamily: 'var(--f-mono, monospace)',
                                            fontWeight: 700,
                                        }}>
                                            {dir.badgeText || '0:38'}
                                        </div>
                                    </div>
                                    <div style={{ fontWeight: 600, fontSize: 13, color: '#10151D' }}>{dir.title || dir.name}</div>
                                    <div style={{ fontSize: 11.5, color: '#5F6876', marginTop: 2 }}>{dir.desc || dir.style}</div>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Checks Row */}
                    <section style={{
                        border: '1px solid rgba(16, 21, 29, 0.08)',
                        borderRadius: 16,
                        background: '#FFFFFF',
                        padding: '16px 24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 16,
                        boxShadow: '0 2px 8px rgba(16, 21, 29, 0.03)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 20 }}>
                            <h2 style={{
                                margin: 0,
                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                fontWeight: 700,
                                fontSize: 16,
                                color: '#10151D',
                            }}>
                                Checks
                            </h2>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#5F6876' }}>
                                <Check size={14} color="#0F7A52" strokeWidth={2.5} />
                                Legible at 120px wide
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#5F6876' }}>
                                <Check size={14} color="#0F7A52" strokeWidth={2.5} />
                                Clear of the player's timestamp
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#5F6876' }}>
                                <Check size={14} color="#0F7A52" strokeWidth={2.5} />
                                Text on accent passes 4.5:1
                            </span>
                        </div>

                        <button
                            type="button"
                            onClick={handleExportSizes}
                            style={{
                                padding: '10px 18px',
                                borderRadius: 8,
                                background: '#0B7C91',
                                color: '#FFFFFF',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 8,
                                boxShadow: '0 2px 8px rgba(11, 124, 145, 0.25)',
                            }}
                        >
                            <Download size={15} />
                            Export 2 sizes
                        </button>
                    </section>

                    {/* The same brief, other surfaces Section */}
                    <section style={{
                        border: '1px solid rgba(16, 21, 29, 0.08)',
                        borderRadius: 16,
                        background: '#FFFFFF',
                        padding: 24,
                        boxShadow: '0 2px 8px rgba(16, 21, 29, 0.03)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                            <h2 style={{
                                margin: 0,
                                fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                fontWeight: 700,
                                fontSize: 17,
                                color: '#10151D',
                            }}>
                                The same brief, other surfaces
                            </h2>
                            <span style={{
                                fontSize: 13,
                                color: '#0B7C91',
                                fontWeight: 600,
                            }}>
                                Multi-Format Sync
                            </span>
                        </div>
                        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#5F6876' }}>
                            One brand kit, one brief, one subject. Each surface gets its own layout rather than the same picture cropped — and each opens in this same editor.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
                            {[
                                { id: 'packaging', title: 'Packaging', desc: '250 g bag · 3 label options', bg: 'linear-gradient(170deg, #F4EDE2 0%, #DCD2C2 100%)' },
                                { id: 'product', title: 'Product design', desc: 'Dripper render · 4 angles', bg: '#1C1109' },
                                { id: 'ad', title: 'Paid ad', desc: '1:1 and 4:5 · 2 variants', bg: '#C85A17' },
                                { id: 'print', title: 'Print', desc: 'A4 shelf card · CMYK', bg: '#F5EFEB' },
                                { id: 'social', title: 'Social graphic', desc: '1080x1080 square format', isAdd: true },
                            ].map((card, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => setSelectedFormat(card.id)}
                                    style={{
                                        border: selectedFormat === card.id ? '1.5px solid #0B7C91' : '1px solid rgba(16, 21, 29, 0.10)',
                                        borderRadius: 12,
                                        overflow: 'hidden',
                                        background: '#FFFFFF',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    <div style={{
                                        height: 110,
                                        background: card.bg || '#F8F9FA',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: card.isAdd ? '#0B7C91' : '#FFFFFF',
                                    }}>
                                        {card.isAdd && <Plus size={24} />}
                                    </div>
                                    <div style={{ padding: '10px 12px' }}>
                                        <div style={{ fontWeight: 600, fontSize: 13, color: '#10151D' }}>{card.title}</div>
                                        <div style={{ fontSize: 11, color: '#5F6876', marginTop: 2 }}>{card.desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
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
            </main>
        </div>
    );
}
