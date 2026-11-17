/**
 * client/src/design-studio/components/LayersAndAssetsPanel.jsx
 *
 * Modern 2-Tier Studio Sidebar (Inspired by Images 4 & 5):
 * - Slim Left Icon Rail (48px) with active indicator
 * - Expandable Content Drawer (240px)
 * - Hierarchical Layers Tree with disclosure carets, type icons, inline visibility & lock
 * - Components & Assets Library
 * - Theme Tokens & Variables
 *
 * Strictly zero emojis. Light studio aesthetic.
 */

import React, { useState } from 'react';
import {
    Layers, Eye, EyeOff, Lock, Unlock, Trash2, ArrowUp, ArrowDown,
    Component, Palette, Type, Square, Circle, Image as ImageIcon,
    Star, Minus, Frame, Folder, ChevronDown, ChevronRight,
    Search, Plus, Check, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { STARTER_COMPONENTS, THEME_MODES, TYPOGRAPHY_STYLES } from '../designSystem.js';

export default function LayersAndAssetsPanel({
    layers = [],
    setLayers,
    selectedLayerIds = [],
    setSelectedLayerIds,
    onInsertComponent,
    onApplyTheme,
    onApplyTypographyStyle,
}) {
    const [activeTab, setActiveTab] = useState('layers'); // 'layers' | 'components' | 'tokens'
    const [drawerExpanded, setDrawerExpanded] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTheme, setSelectedTheme] = useState('light');

    // Get icon for layer type
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

    // Layer reordering
    const handleMoveLayer = (layerId, direction, e) => {
        e.stopPropagation();
        setLayers(prev => {
            const idx = prev.findIndex(l => l.id === layerId);
            if (idx === -1) return prev;
            const updated = [...prev];
            const [item] = updated.splice(idx, 1);

            if (direction === 'up') updated.splice(Math.min(updated.length, idx + 1), 0, item);
            else if (direction === 'down') updated.splice(Math.max(0, idx - 1), 0, item);
            else if (direction === 'front') updated.push(item);
            else if (direction === 'back') updated.unshift(item);

            return updated;
        });
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

    return (
        <div style={{
            display: 'flex',
            height: '100%',
            minHeight: '620px',
            background: '#FFFFFF',
            borderRight: '1px solid #E2E8F0',
            borderRadius: '12px 0 0 12px',
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
            }}>
                {[
                    { id: 'layers', label: 'Layers', icon: Layers },
                    { id: 'components', label: 'Components', icon: Component },
                    { id: 'tokens', label: 'Styles', icon: Palette },
                ].map(tab => {
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
                    width: '230px',
                    display: 'flex',
                    flexDirection: 'column',
                    background: '#FFFFFF',
                    fontSize: '12px',
                    color: '#0F172A',
                }}>
                    {/* Header */}
                    <div style={{
                        padding: '12px 14px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid #F1F5F9',
                    }}>
                        <span style={{ fontWeight: 700, fontSize: '12.5px', textTransform: 'uppercase', letterSpacing: '0.4px', color: '#1E293B' }}>
                            {activeTab}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>
                            {activeTab === 'layers' ? `${layers.length} items` : ''}
                        </span>
                    </div>

                    {/* Search Bar (for layers or components) */}
                    {activeTab === 'layers' && (
                        <div style={{ padding: '8px 12px', borderBottom: '1px solid #F1F5F9' }}>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                background: '#F8FAFC',
                                border: '1px solid #E2E8F0',
                                borderRadius: '6px',
                                padding: '4px 8px',
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
                        </div>
                    )}

                    {/* Content List */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
                        {/* 1. LAYERS TAB (Nested tree style, Image 4 & 5) */}
                        {activeTab === 'layers' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {[...filteredLayers].reverse().map(layer => {
                                    const isSelected = selectedLayerIds.includes(layer.id);
                                    const IconComp = getLayerIcon(layer.type);

                                    return (
                                        <div
                                            key={layer.id}
                                            onClick={(e) => {
                                                const isShift = e.shiftKey || e.metaKey || e.ctrlKey;
                                                if (isShift) {
                                                    setSelectedLayerIds(prev =>
                                                        prev.includes(layer.id)
                                                            ? prev.filter(id => id !== layer.id)
                                                            : [...prev, layer.id]
                                                    );
                                                } else {
                                                    setSelectedLayerIds([layer.id]);
                                                }
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
                                                opacity: layer.visible ? 1 : 0.45,
                                                transition: 'all 0.12s ease',
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                                {layer.type === 'frame' ? (
                                                    <ChevronDown size={13} color="#64748B" />
                                                ) : (
                                                    <div style={{ width: '13px' }} />
                                                )}
                                                <IconComp size={14} color={isSelected ? '#0B7C91' : '#64748B'} />
                                                <span style={{
                                                    fontSize: '12px',
                                                    fontWeight: isSelected ? 600 : 400,
                                                    color: isSelected ? '#0B7C91' : '#1E293B',
                                                    whiteSpace: 'nowrap',
                                                    textOverflow: 'ellipsis',
                                                    overflow: 'hidden',
                                                    maxWidth: '110px',
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

                        {/* 2. COMPONENTS TAB */}
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
                                            <span style={{ fontWeight: 600, color: '#0F172A', fontSize: '12px' }}>{cmp.name}</span>
                                            <span style={{ fontSize: '10px', color: '#0B7C91', fontWeight: 600 }}>{cmp.category}</span>
                                        </div>
                                        <span style={{ fontSize: '11px', color: '#64748B' }}>
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

                        {/* 3. TOKENS & STYLES TAB */}
                        {activeTab === 'tokens' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px' }}>
                                <div>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                        THEME MODE
                                    </span>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                                        {Object.values(THEME_MODES).map(tm => (
                                            <button
                                                key={tm.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedTheme(tm.id);
                                                    onApplyTheme(tm);
                                                }}
                                                style={{
                                                    padding: '6px 4px',
                                                    background: selectedTheme === tm.id ? '#0B7C91' : '#F1F5F9',
                                                    color: selectedTheme === tm.id ? '#FFFFFF' : '#1E293B',
                                                    border: '1px solid #E2E8F0',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    fontSize: '10px',
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {tm.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                        TYPOGRAPHY TOKENS
                                    </span>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {Object.values(TYPOGRAPHY_STYLES).map(style => (
                                            <button
                                                key={style.id}
                                                type="button"
                                                onClick={() => onApplyTypographyStyle(style)}
                                                style={{
                                                    padding: '6px 8px',
                                                    background: '#F8FAFC',
                                                    border: '1px solid #E2E8F0',
                                                    borderRadius: '4px',
                                                    cursor: 'pointer',
                                                    textAlign: 'left',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    color: '#0F172A',
                                                }}
                                            >
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '11px' }}>{style.name}</div>
                                                    <div style={{ fontSize: '10px', color: '#64748B' }}>
                                                        {style.fontFamily} · {style.fontSize}px
                                                    </div>
                                                </div>
                                                <span style={{ fontSize: '10px', color: '#0B7C91', fontWeight: 600 }}>Apply</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
