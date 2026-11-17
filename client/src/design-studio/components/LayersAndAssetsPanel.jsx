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
    UploadCloud, Film, ArrowUpRight
} from 'lucide-react';
import { STARTER_COMPONENTS } from '../designSystem.js';

export default function LayersAndAssetsPanel({
    layers = [],
    setLayers,
    selectedLayerIds = [],
    setSelectedLayerIds,
    onInsertComponent,
    timelineAssets = [],
    onAddAssetToCanvas,
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
}) {
    const [activeTab, setActiveTab] = useState('layers'); // 'layers' | 'assets' | 'brandkit' | 'components'
    const [drawerExpanded, setDrawerExpanded] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

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
        setLayers(prev => prev.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
    };

    // Toggle layer lock
    const handleToggleLock = (layerId, e) => {
        e.stopPropagation();
        setLayers(prev => prev.map(l => l.id === layerId ? { ...l, locked: !l.locked } : l));
    };

    // Delete layer
    const handleDeleteLayer = (layerId, e) => {
        e.stopPropagation();
        setLayers(prev => prev.filter(l => l.id !== layerId));
        setSelectedLayerIds(prev => prev.filter(id => id !== layerId));
    };

    const filteredLayers = layers.filter(l =>
        !searchQuery || (l.name || l.id).toLowerCase().includes(searchQuery.toLowerCase())
    );

    const TABS = [
        { id: 'layers', label: 'Layers', icon: Layers },
        { id: 'assets', label: 'Assets & Media', icon: FolderOpen },
        { id: 'brandkit', label: 'Brand Kit', icon: Palette },
        { id: 'components', label: 'Components', icon: Component },
    ];

    const BRAND_PRESETS = [
        { name: 'Minimalist Studio', accent: '#C85A17', accent2: '#1F140E', surface: '#1F140E', text: '#F4EDE2', display: 'Plus Jakarta Sans' },
        { name: 'Electric Cyber', accent: '#00E5FF', accent2: '#0B7C91', surface: '#0A0E17', text: '#00E5FF', display: 'Plus Jakarta Sans' },
        { name: 'Warm Editorial', accent: '#C85A17', accent2: '#10151D', surface: '#F4EDE2', text: '#10151D', display: 'Instrument Serif' },
        { name: 'Monochrome Pro', accent: '#10151D', accent2: '#5F6876', surface: '#10151D', text: '#FFFFFF', display: 'Geist' },
    ];

    return (
        <div style={{
            display: 'flex',
            height: '100%',
            background: '#FFFFFF',
            borderRight: '1px solid #E2E8F0',
            overflow: 'hidden',
            userSelect: 'none',
        }}>
            {/* 1. Slim Left Icon Rail (48px) */}
            <div style={{
                width: '48px',
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
                            style={{
                                position: 'relative',
                                width: '36px',
                                height: '36px',
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
                                    const IconComp = getLayerIcon(layer.type);
                                    return (
                                        <div
                                            key={layer.id}
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
                                                cursor: 'pointer',
                                                transition: 'background 0.12s ease',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
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

                                {/* Project Media Bin */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}>
                                            PROJECT MEDIA ({timelineAssets.length})
                                        </span>
                                    </div>

                                    {timelineAssets.length === 0 ? (
                                        <div style={{ padding: '16px 8px', textAlign: 'center', color: '#94A3B8', fontSize: '11px', lineHeight: 1.4 }}>
                                            No media in active project yet. Upload video or images in the Editor to use them here.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {timelineAssets.map((asset, i) => (
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
                                                            {asset.name || 'Project Asset'}
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {STARTER_COMPONENTS.map(cmp => (
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
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <span style={{ fontWeight: 600, color: '#0F172A', fontSize: '11.5px' }}>{cmp.name}</span>
                                            <span style={{ fontSize: '9.5px', color: '#0B7C91', fontWeight: 600 }}>{cmp.category}</span>
                                        </div>
                                        <span style={{ fontSize: '10.5px', color: '#64748B' }}>
                                            {cmp.w} x {cmp.h} px · {cmp.layers.length} layers
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
                                            <span>Insert</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
