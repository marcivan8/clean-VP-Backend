/**
 * client/src/design-studio/components/LayersAndAssetsPanel.jsx
 *
 * Professional 2-Tier Studio Sidebar:
 * - Slim Left Icon Rail (48px) with 4 primary tabs:
 *   1. Layers (hierarchical tree, search, visibility, lock, delete)
 *   2. Assets & Media (upload local file + project media bin with 1-click insert)
 *   3. Brand Kit (color palette, brand presets, typography, apply to canvas)
 *   4. Components (reusable UI & vector starter components)
 * - Expandable Content Drawer (240px)
 *
 * Strictly zero emojis. Light studio aesthetic.
 */

import React, { useState } from 'react';
import {
    Layers, FolderOpen, Palette, Component, Eye, EyeOff, Lock, Unlock,
    Trash2, Type, Square, Circle, Image as ImageIcon, Star, Minus,
    Frame, Search, Plus, Check, PanelLeftClose, PanelLeftOpen,
    UploadCloud, Film, ArrowUpRight, GripVertical
} from 'lucide-react';
import { STARTER_COMPONENTS } from '../designSystem.js';

function ComponentPreview({ component }) {
    const width = Math.max(1, component.w || 1);
    const height = Math.max(1, component.h || 1);
    return (
        <div style={{ height: '72px', borderRadius: '6px', background: '#10151D', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
            <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                {(component.layers || []).map(layer => {
                    const x = Number(layer.x) || 0;
                    const y = Number(layer.y) || 0;
                    const w = Math.max(1, Number(layer.w) || 1);
                    const h = Math.max(1, Number(layer.h) || 1);
                    if (layer.type === 'image' && layer.src) {
                        return <image key={layer.id} href={layer.src} x={x} y={y} width={w} height={h} preserveAspectRatio={layer.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'} />;
                    }
                    if (layer.type === 'ellipse') {
                        return <ellipse key={layer.id} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={layer.fill || 'transparent'} stroke={layer.stroke || 'none'} strokeWidth={layer.strokeWidth || 0} />;
                    }
                    if (layer.type === 'text') {
                        const textX = x + (layer.textAlign === 'center' ? w / 2 : layer.textAlign === 'right' ? w : 0);
                        return <text key={layer.id} x={textX} y={y + Number(layer.fontSize || 12)} fill={layer.fill || '#F7F9FC'} fontFamily={layer.fontFamily || 'Geist'} fontSize={layer.fontSize || 12} fontWeight={layer.fontWeight || 500} textAnchor={layer.textAlign === 'center' ? 'middle' : layer.textAlign === 'right' ? 'end' : 'start'}>{String(layer.text || '').split('\n').map((line, index) => <tspan key={index} x={textX} dy={index ? Number(layer.fontSize || 12) * (layer.lineHeight || 1.15) : 0}>{line}</tspan>)}</text>;
                    }
                    if (layer.type === 'line') {
                        return <line key={layer.id} x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke={layer.stroke || '#F7F9FC'} strokeWidth={layer.strokeWidth || 1} />;
                    }
                    if (layer.type === 'polygon' && layer.sides === 3) {
                        return <path key={layer.id} d={`M ${x + w / 2} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`} fill={layer.fill || '#F7F9FC'} />;
                    }
                    if (layer.type === 'vector' && layer.pathD) {
                        return <path key={layer.id} d={layer.pathD} transform={`translate(${x} ${y})`} fill={layer.fill || 'none'} stroke={layer.stroke || '#F7F9FC'} strokeWidth={layer.strokeWidth || 1} />;
                    }
                    return <rect key={layer.id} x={x} y={y} width={w} height={h} rx={layer.cornerRadius || 0} fill={layer.fill || (layer.type === 'image' ? '#303A48' : 'transparent')} stroke={layer.stroke || 'none'} strokeWidth={layer.strokeWidth || 0} />;
                })}
            </svg>
        </div>
    );
}

export default function LayersAndAssetsPanel({
    layers = [],
    setLayers,
    onReorderLayers,
    onBeforeLayerChange,
    selectedLayerIds = [],
    setSelectedLayerIds,
    onInsertComponent,
    mediaAssets = [],
    onAddAssetToCanvas,
    onDeleteMediaAsset,
    brandKit = {
        name: 'VIBED Studio Kit',
        accent: '#00E5FF',
        accent2: '#C85A17',
        surface: '#1F140E',
        text: '#F4EDE2',
        display: 'Plus Jakarta Sans',
        body: 'Geist',
        mono: 'JetBrains Mono',
    },
    setBrandKit,
    onApplyBrandKit,
    onUploadAssetClick,
    customComponents = [],
    onDeleteCustomComponent,
    onAddBackground,
    activeTab: externalActiveTab,
    setActiveTab: setExternalActiveTab,
}) {
    const [internalTab, setInternalTab] = useState('layers');
    const activeTab = externalActiveTab !== undefined ? externalActiveTab : internalTab;
    const setActiveTab = setExternalActiveTab || setInternalTab;
    const [drawerExpanded, setDrawerExpanded] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [componentQuery, setComponentQuery] = useState('');
    const [componentCategory, setComponentCategory] = useState('All');

    // Layer type icon helper
    const getLayerIcon = (type) => {
        switch (type) {
            case 'text': return Type;
            case 'rect': return Square;
            case 'circle':
            case 'ellipse': return Circle;
            case 'line': return Minus;
            case 'star': return Star;
            case 'image': return ImageIcon;
            case 'frame': return Frame;
            default: return Square;
        }
    };

    // Toggle layer visibility
    const handleToggleVisibility = (layerId, e) => {
        e.stopPropagation();
        onBeforeLayerChange?.();
        setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
    };

    // Toggle layer lock
    const handleToggleLock = (layerId, e) => {
        e.stopPropagation();
        onBeforeLayerChange?.();
        setLayers(prev => prev.map(l => l.id === layerId ? { ...l, locked: !l.locked } : l));
    };

    // Delete layer
    const handleDeleteLayer = (layerId, e) => {
        e.stopPropagation();
        onBeforeLayerChange?.();
        setLayers(prev => prev.filter(l => l.id !== layerId));
        setSelectedLayerIds(prev => prev.filter(id => id !== layerId));
    };

    const filteredLayers = layers.filter(l =>
        !searchQuery || (l.name || l.id).toLowerCase().includes(searchQuery.toLowerCase())
    );

    const TABS = [
        { id: 'layers', label: 'Layers', icon: Layers },
        { id: 'assets', label: 'Assets & Media', short: 'Media', icon: FolderOpen },
        { id: 'brandkit', label: 'Brand Kit', short: 'Brand', icon: Palette },
        { id: 'components', label: 'Components', icon: Component },
    ];

    const BRAND_PRESETS = [
        { name: 'Minimalist Studio', accent: '#C85A17', accent2: '#1F140E', surface: '#1F140E', text: '#F4EDE2', display: 'Plus Jakarta Sans' },
        { name: 'Electric Cyber', accent: '#00E5FF', accent2: '#0B7C91', surface: '#0A0E17', text: '#00E5FF', display: 'Plus Jakarta Sans' },
        { name: 'Warm Editorial', accent: '#C85A17', accent2: '#10151D', surface: '#F4EDE2', text: '#10151D', display: 'Instrument Serif' },
        { name: 'Monochrome Pro', accent: '#10151D', accent2: '#5F6876', surface: '#10151D', text: '#FFFFFF', display: 'Geist' },
    ];

    const allLibraryComponents = [...customComponents, ...STARTER_COMPONENTS];
    const componentCategories = ['All', ...new Set(allLibraryComponents.map(component => component.category || 'Other'))];
    const filterLibrary = (component) => {
        const query = componentQuery.trim().toLowerCase();
        const searchable = [component.name, component.category, component.description, ...(component.tags || [])].filter(Boolean).join(' ').toLowerCase();
        return (componentCategory === 'All' || (component.category || 'Other') === componentCategory)
            && (!query || searchable.includes(query));
    };
    const filteredCustomComponents = customComponents.filter(filterLibrary);
    const filteredStarterComponents = STARTER_COMPONENTS.filter(filterLibrary);

    return (
        <div style={{
            display: 'flex',
            height: '100%',
            background: '#FFFFFF',
            borderRight: '1px solid #E2E8F0',
            overflow: 'hidden',
            userSelect: 'none',
        }}>
            {/* 1. Left rail. R170: each icon carries its name; an icon-only rail
                hid the Components library (132 components and icons) from
                people who did not hover the fourth icon. */}
            <div style={{
                width: '60px',
                background: '#F8FAFC',
                borderRight: '1px solid #E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '12px 0',
                gap: '8px',
                flexShrink: 0,
            }}>
                {TABS.map(tab => {
                    const isActive = activeTab === tab.id;
                    const IconComp = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                                if (activeTab === tab.id && drawerExpanded) {
                                    setDrawerExpanded(false);
                                } else {
                                    setActiveTab(tab.id);
                                    setDrawerExpanded(true);
                                }
                            }}
                            title={tab.label}
                            aria-label={tab.label}
                            aria-pressed={isActive && drawerExpanded}
                            style={{
                                position: 'relative',
                                width: '52px',
                                minHeight: '46px',
                                padding: '5px 0',
                                flexDirection: 'column',
                                gap: '3px',
                                borderRadius: '8px',
                                background: isActive ? '#FFFFFF' : 'transparent',
                                color: isActive ? '#0B7C91' : '#64748B',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            {isActive && (
                                <div style={{
                                    position: 'absolute',
                                    left: '-6px',
                                    top: '8px',
                                    bottom: '8px',
                                    width: '3px',
                                    borderRadius: '0 2px 2px 0',
                                    background: '#0B7C91',
                                }} />
                            )}
                            <IconComp size={18} />
                            <span style={{ fontSize: '9.5px', fontWeight: isActive ? 700 : 500, lineHeight: 1 }}>{tab.short || tab.label}</span>
                        </button>
                    );
                })}

                {/* Drawer Collapse / Expand toggle at bottom */}
                <div style={{ marginTop: 'auto' }}>
                    <button
                        type="button"
                        onClick={() => setDrawerExpanded(!drawerExpanded)}
                        title={drawerExpanded ? 'Collapse panel' : 'Expand panel'}
                        style={{
                            width: '36px',
                            height: '36px',
                            background: 'transparent',
                            color: '#94A3B8',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        {drawerExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
                    </button>
                </div>
            </div>

            {/* 2. Expandable Content Drawer (240px) */}
            {drawerExpanded && (
                <div style={{
                    width: '240px',
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#FFFFFF',
                    fontSize: '12px',
                    color: '#0F172A',
                    overflow: 'hidden',
                }}>
                    {/* Drawer Header */}
                    <div style={{
                        padding: '12px 14px',
                        borderBottom: '1px solid #F1F5F9',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0,
                    }}>
                        <span style={{
                            fontFamily: 'var(--f-mono, monospace)',
                            fontWeight: 700,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                            fontSize: '11px',
                            color: '#475569',
                        }}>
                            {activeTab === 'layers' && 'Layers'}
                            {activeTab === 'assets' && 'Assets & Media'}
                            {activeTab === 'brandkit' && 'Brand Kit'}
                            {activeTab === 'components' && 'Components'}
                        </span>
                    </div>

                    {/* Drawer Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
                        {/* 1. LAYERS TAB */}
                        {activeTab === 'layers' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {/* Search Filter */}
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    background: '#F8FAFC',
                                    border: '1px solid #E2E8F0',
                                    borderRadius: '6px',
                                    padding: '5px 8px',
                                    marginBottom: '4px',
                                }}>
                                    <Search size={13} color="#94A3B8" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Filter layers..."
                                        style={{
                                            border: 'none',
                                            background: 'transparent',
                                            outline: 'none',
                                            fontSize: '11.5px',
                                            color: '#0F172A',
                                            width: '100%',
                                        }}
                                    />
                                </div>

                                {/* Layer Rows */}
                                {filteredLayers.slice().reverse().map(layer => {
                                    const isSelected = selectedLayerIds.includes(layer.id);
                                    const isBackground = layer.id === 'background' || layer.type === 'bg';
                                    const IconComp = getLayerIcon(layer.type);
                                    return (
                                        <div
                                            key={layer.id}
                                            draggable={!searchQuery && !isBackground}
                                            onDragStart={(event) => {
                                                event.dataTransfer.effectAllowed = 'move';
                                                event.dataTransfer.setData('text/plain', layer.id);
                                            }}
                                            onDragOver={(event) => {
                                                if (!searchQuery && !isBackground) event.preventDefault();
                                            }}
                                            onDrop={(event) => {
                                                event.preventDefault();
                                                const fromId = event.dataTransfer.getData('text/plain');
                                                if (fromId && fromId !== layer.id && !searchQuery && onReorderLayers) onReorderLayers(fromId, layer.id);
                                            }}
                                            onClick={() => {
                                                setSelectedLayerIds([layer.id]);
                                            }}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '6px 8px',
                                                borderRadius: '6px',
                                                background: isSelected ? '#F0F9FB' : 'transparent',
                                                border: isSelected ? '1px solid #0B7C91' : '1px solid transparent',
                                                cursor: isBackground ? 'default' : (searchQuery ? 'pointer' : 'grab'),
                                                transition: 'background 0.12s ease',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                                                {!isBackground && <GripVertical size={12} color="#94A3B8" aria-hidden="true" />}
                                                <IconComp size={13} color={isSelected ? '#0B7C91' : '#64748B'} />
                                                <span style={{
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    fontSize: '11.5px',
                                                    fontWeight: isSelected ? 600 : 400,
                                                    color: isSelected ? '#0B7C91' : '#1E293B',
                                                }}>
                                                    {layer.name || layer.id}
                                                </span>
                                            </div>

                                            {/* Action Icons */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleToggleVisibility(layer.id, e)}
                                                    title={layer.visible ? 'Hide' : 'Show'}
                                                    style={{ background: 'transparent', border: 'none', color: '#94A3B8', padding: '2px', cursor: 'pointer' }}
                                                >
                                                    {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleToggleLock(layer.id, e)}
                                                    title={layer.locked ? 'Unlock' : 'Lock'}
                                                    style={{ background: 'transparent', border: 'none', color: layer.locked ? '#0B7C91' : '#94A3B8', padding: '2px', cursor: 'pointer' }}
                                                >
                                                    {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleDeleteLayer(layer.id, e)}
                                                    title="Delete"
                                                    style={{ background: 'transparent', border: 'none', color: '#DC2626', padding: '2px', cursor: 'pointer' }}
                                                >
                                                    <Trash2 size={11} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}

                                {!layers.some(l => l.id === 'background' || l.type === 'bg') && onAddBackground && (
                                    <button
                                        type="button"
                                        onClick={onAddBackground}
                                        style={{
                                            marginTop: '6px',
                                            padding: '7px 10px',
                                            borderRadius: '6px',
                                            border: '1px dashed #CBD5E1',
                                            background: '#F8FAFC',
                                            color: '#0B7C91',
                                            fontSize: '11.5px',
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '6px',
                                            cursor: 'pointer',
                                            transition: 'background 0.15s ease',
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = '#F0F9FB'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = '#F8FAFC'}
                                    >
                                        <Plus size={12} />
                                        <span>Add Background Layer</span>
                                    </button>
                                )}
                            </div>
                        )}

                        {/* 2. ASSETS & MEDIA TAB */}
                        {activeTab === 'assets' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {/* Upload Local File Trigger */}
                                <div
                                    onClick={() => onUploadAssetClick && onUploadAssetClick()}
                                    style={{
                                        border: '1.5px dashed #CBD5E1',
                                        borderRadius: '8px',
                                        padding: '16px 12px',
                                        background: '#F8FAFC',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        textAlign: 'center',
                                        gap: '6px',
                                    }}
                                >
                                    <UploadCloud size={24} color="#0B7C91" />
                                    <span style={{ fontSize: '11.5px', fontWeight: 600, color: '#0F172A' }}>
                                        Upload Image or Asset
                                    </span>
                                    <span style={{ fontSize: '10px', color: '#64748B' }}>
                                        PNG, JPG, SVG, WebP
                                    </span>
                                </div>

                                {/* Design Studio's independent media bin */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                                            STUDIO MEDIA ({mediaAssets.length})
                                        </span>
                                    </div>

                                    {mediaAssets.length === 0 ? (
                                        <div style={{ padding: '16px 8px', textAlign: 'center', color: '#94A3B8', fontSize: '11px', lineHeight: 1.4 }}>
                                            No images in this Studio project yet. Upload an image to add it here.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {mediaAssets.map((asset, i) => (
                                                <div
                                                    key={asset.id || i}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        padding: '6px',
                                                        borderRadius: '6px',
                                                        background: '#F8FAFC',
                                                        border: '1px solid #E2E8F0',
                                                    }}
                                                >
                                                    <div style={{
                                                        width: '36px',
                                                        height: '36px',
                                                        borderRadius: '4px',
                                                        background: '#0F172A',
                                                        overflow: 'hidden',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        flexShrink: 0,
                                                    }}>
                                                        {asset.thumbnailUrl || asset.url ? (
                                                            <img src={asset.thumbnailUrl || asset.url} alt={asset.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        ) : (
                                                            <Film size={14} color="#FFFFFF" />
                                                        )}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: '11.5px', fontWeight: 600, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {asset.name || 'Studio Image'}
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => onAddAssetToCanvas && onAddAssetToCanvas(asset, asset.name)}
                                                            style={{
                                                                marginTop: '2px',
                                                                padding: '2px 6px',
                                                                background: '#F0F9FB',
                                                                color: '#0B7C91',
                                                                border: '1px solid #0B7C91',
                                                                borderRadius: '4px',
                                                                fontSize: '10px',
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                            }}
                                                        >
                                                            Add to Canvas
                                                        </button>
                                                    </div>
                                                    {onDeleteMediaAsset && (
                                                        <button
                                                            type="button"
                                                            aria-label={`Remove ${asset.name || 'image'} from Studio media`}
                                                            title="Remove from Studio media"
                                                            onClick={() => onDeleteMediaAsset(asset.id)}
                                                            style={{ padding: 5, border: 'none', borderRadius: 5, background: '#FEF2F2', color: '#B91C1C', cursor: 'pointer' }}
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 3. BRAND KIT TAB */}
                        {activeTab === 'brandkit' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                                {/* Brand Presets */}
                                <div>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                        PRESETS
                                    </span>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                        {BRAND_PRESETS.map(preset => (
                                            <button
                                                key={preset.name}
                                                type="button"
                                                onClick={() => setBrandKit && setBrandKit(prev => ({ ...prev, ...preset }))}
                                                style={{
                                                    padding: '6px 8px',
                                                    borderRadius: '6px',
                                                    border: '1px solid #E2E8F0',
                                                    background: '#F8FAFC',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                }}
                                            >
                                                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: preset.accent, flexShrink: 0 }} />
                                                <span style={{ fontSize: '10.5px', fontWeight: 500, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {preset.name}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Color Palette */}
                                <div>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                        COLOR PALETTE
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {[
                                            { key: 'accent', label: 'Primary Accent' },
                                            { key: 'accent2', label: 'Secondary Accent' },
                                            { key: 'surface', label: 'Surface Background' },
                                            { key: 'text', label: 'Text Color' },
                                        ].map(item => (
                                            <div key={item.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', background: '#F8FAFC', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                                                <span style={{ fontSize: '11px', color: '#64748B' }}>{item.label}</span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <input
                                                        type="color"
                                                        value={brandKit[item.key] || '#00E5FF'}
                                                        onChange={(e) => setBrandKit && setBrandKit(b => ({ ...b, [item.key]: e.target.value }))}
                                                        style={{ width: '22px', height: '22px', border: 'none', background: 'transparent', cursor: 'pointer' }}
                                                    />
                                                    <span style={{ fontSize: '10px', fontFamily: 'var(--f-mono, monospace)', color: '#0F172A' }}>
                                                        {brandKit[item.key]}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Brand Typography */}
                                <div>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                        TYPOGRAPHY
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <div>
                                            <span style={{ fontSize: '10px', color: '#64748B', display: 'block', marginBottom: '2px' }}>Headline Font</span>
                                            <select
                                                value={brandKit.display || 'Plus Jakarta Sans'}
                                                onChange={(e) => setBrandKit && setBrandKit(b => ({ ...b, display: e.target.value }))}
                                                style={{ width: '100%', padding: '5px', borderRadius: '5px', border: '1px solid #E2E8F0', fontSize: '11px', background: '#F8FAFC' }}
                                            >
                                                <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                                                <option value="Instrument Serif">Instrument Serif</option>
                                                <option value="Geist">Geist</option>
                                                <option value="JetBrains Mono">JetBrains Mono</option>
                                                <option value="Inter">Inter</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Apply Action */}
                                <button
                                    type="button"
                                    onClick={() => onApplyBrandKit && onApplyBrandKit()}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        background: '#0B7C91',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        borderRadius: '6px',
                                        fontWeight: 600,
                                        fontSize: '11.5px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        boxShadow: '0 2px 6px rgba(11, 124, 145, 0.25)',
                                    }}
                                >
                                    <Check size={13} />
                                    <span>Apply Kit to Canvas</span>
                                </button>
                            </div>
                        )}

                        {/* 4. COMPONENTS TAB */}
                        {activeTab === 'components' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                                    <label htmlFor="component-library-search" style={{ fontSize: '10px', fontFamily: 'var(--f-mono, monospace)', fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Find a component or icon</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 8px' }}>
                                        <Search size={13} color="#94A3B8" />
                                        <input id="component-library-search" type="search" value={componentQuery} onChange={(event) => setComponentQuery(event.target.value)} placeholder="Search components and icons…" style={{ minWidth: 0, width: '100%', border: 'none', outline: 'none', background: 'transparent', fontSize: '11px', color: '#0F172A' }} />
                                    </div>
                                    <select aria-label="Filter component category" value={componentCategory} onChange={(event) => setComponentCategory(event.target.value)} style={{ width: '100%', padding: '7px 8px', border: '1px solid #E2E8F0', borderRadius: '6px', background: '#FFFFFF', color: '#334155', fontSize: '11px' }}>
                                        {componentCategories.map(category => <option key={category} value={category}>{category === 'All' ? 'All categories' : category}</option>)}
                                    </select>
                                    <span style={{ fontSize: '10px', color: '#64748B' }}>{filteredCustomComponents.length + filteredStarterComponents.length} components and icons · inserted as editable layers</span>
                                    <span style={{ fontSize: '10px', color: '#64748B', lineHeight: 1.4 }}>Lucide icon vectors are free to use under the ISC license. <a href="https://lucide.dev/icons" target="_blank" rel="noreferrer" style={{ color: '#0B7C91', fontWeight: 600 }}>Browse Lucide</a></span>
                                </div>

                                {/* Custom Components Section */}
                                {filteredCustomComponents.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 2px' }}>
                                            <span style={{ fontSize: '10px', fontFamily: 'var(--f-mono, monospace)', fontWeight: 700, color: '#0B7C91', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                                                Your Components ({filteredCustomComponents.length})
                                            </span>
                                        </div>
                                        {filteredCustomComponents.map(cmp => (
                                            <div
                                                key={cmp.id}
                                                style={{
                                                    background: '#FFFFFF',
                                                    border: '1px solid #00E5FF44',
                                                    borderRadius: '8px',
                                                    padding: '8px 10px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '4px',
                                                    boxShadow: '0 2px 8px rgba(0, 229, 255, 0.08)',
                                                }}
                                            >
                                                <ComponentPreview component={cmp} />
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <span style={{ fontWeight: 600, color: '#0F172A', fontSize: '11.5px' }}>{cmp.name}</span>
                                                    <span style={{ fontSize: '9px', color: '#16A34A', background: '#DCFCE7', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>MASTER</span>
                                                </div>
                                                <span style={{ fontSize: '10.5px', color: '#64748B' }}>
                                                    {cmp.w} x {cmp.h} px · {(cmp.layers || []).length} layer{(cmp.layers || []).length > 1 ? 's' : ''}
                                                </span>
                                                <div style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => onInsertComponent(cmp)}
                                                        style={{
                                                            flex: 1,
                                                            padding: '4px 8px',
                                                            background: '#0B7C91',
                                                            color: '#FFFFFF',
                                                            border: 'none',
                                                            borderRadius: '5px',
                                                            cursor: 'pointer',
                                                            fontWeight: 600,
                                                            fontSize: '11px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            gap: '4px',
                                                        }}
                                                    >
                                                        <Plus size={12} />
                                                    <span>Insert editable layers</span>
                                                    </button>
                                                    {onDeleteCustomComponent && (
                                                        <button
                                                            type="button"
                                                            onClick={() => onDeleteCustomComponent(cmp.id)}
                                                            style={{
                                                                padding: '4px 7px',
                                                                background: '#FEE2E2',
                                                                color: '#EF4444',
                                                                border: 'none',
                                                                borderRadius: '5px',
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                            }}
                                                            title="Delete custom component"
                                                        >
                                                            <Trash2 size={12} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* System Starter Components */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    <span style={{ fontSize: '10px', fontFamily: 'var(--f-mono, monospace)', fontWeight: 700, color: '#64748B', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 2px' }}>
                                        Built-in Components & Icons ({filteredStarterComponents.length})
                                    </span>
                                    {filteredStarterComponents.map(cmp => (
                                        <div
                                            key={cmp.id}
                                            style={{
                                                background: '#F8FAFC',
                                                border: '1px solid #E2E8F0',
                                                borderRadius: '8px',
                                                padding: '10px',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '4px',
                                            }}
                                        >
                                            <ComponentPreview component={cmp} />
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <span style={{ fontWeight: 600, color: '#0F172A', fontSize: '11.5px' }}>{cmp.name}</span>
                                                <span style={{ fontSize: '9.5px', color: '#0B7C91', fontWeight: 600 }}>{cmp.category}</span>
                                            </div>
                                            {cmp.description && <span style={{ fontSize: '10px', color: '#64748B', lineHeight: 1.4 }}>{cmp.description}</span>}
                                            <span style={{ fontSize: '10.5px', color: '#64748B' }}>
                                                {cmp.w} × {cmp.h} px · {cmp.layers.length} editable {cmp.category === 'Icons · Lucide' ? 'vector paths' : 'layers'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => onInsertComponent(cmp)}
                                                style={{
                                                    marginTop: '4px',
                                                    padding: '5px 8px',
                                                    background: '#0B7C91',
                                                    color: '#FFFFFF',
                                                    border: 'none',
                                                    borderRadius: '5px',
                                                    cursor: 'pointer',
                                                    fontWeight: 600,
                                                    fontSize: '11px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: '4px',
                                                }}
                                            >
                                                <Plus size={12} />
                                                <span>Insert editable layers</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
