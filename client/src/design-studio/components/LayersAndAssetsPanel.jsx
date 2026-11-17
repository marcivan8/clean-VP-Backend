/**
 * client/src/design-studio/components/LayersAndAssetsPanel.jsx
 *
 * Professional Figma-class Left Sidebar:
 * - Layers Stack (ordering, visibility, locking, delete, nesting)
 * - Reusable Components Library (Buttons, Badges, Cards, Instances)
 * - Design Tokens & Theme Variables (Dark, Light, Editorial)
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    Layers, Eye, EyeOff, Lock, Unlock, Trash2, ArrowUp, ArrowDown,
    ChevronsUp, ChevronsDown, Component, Palette, Type, Folder,
    FileText, Plus, Check, Sparkles
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
    const [selectedTheme, setSelectedTheme] = useState('dark');

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

    return (
        <div style={{
            width: '260px',
            background: '#161920',
            borderRight: '1px solid #2A2E39',
            display: 'flex',
            flexDirection: 'column',
            userSelect: 'none',
            fontSize: '12px',
            color: '#EDEAE3',
        }}>
            {/* Top Navigation Tabs */}
            <div style={{
                display: 'flex',
                borderBottom: '1px solid #2A2E39',
                background: '#12141A',
            }}>
                {[
                    { id: 'layers', label: 'Layers', icon: Layers },
                    { id: 'components', label: 'Assets', icon: Component },
                    { id: 'tokens', label: 'Tokens', icon: Palette },
                ].map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            flex: 1,
                            padding: '10px 8px',
                            background: activeTab === tab.id ? '#161920' : 'transparent',
                            color: activeTab === tab.id ? '#00E5FF' : '#9CA3AF',
                            border: 'none',
                            borderBottom: activeTab === tab.id ? '2px solid #00E5FF' : '2px solid transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                            fontWeight: 600,
                            fontSize: '11px',
                        }}
                    >
                        <tab.icon size={13} />
                        <span>{tab.label}</span>
                    </button>
                ))}
            </div>

            {/* TAB CONTENT */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {/* 1. LAYERS TAB */}
                {activeTab === 'layers' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        {layers.length === 0 ? (
                            <div style={{ padding: '24px 12px', textAlign: 'center', color: '#6B7280' }}>
                                No layers on canvas
                            </div>
                        ) : (
                            // Render layers in reverse order so top visual layer is at top of stack list
                            [...layers].reverse().map(layer => {
                                const isSelected = selectedLayerIds.includes(layer.id);
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
                                            background: isSelected ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
                                            border: isSelected ? '1px solid rgba(0, 229, 255, 0.3)' : '1px solid transparent',
                                            cursor: 'pointer',
                                            opacity: layer.visible ? 1 : 0.45,
                                        }}
                                    >
                                        {/* Layer Name & Type Icon */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                                            <span style={{ fontSize: '10px', color: isSelected ? '#00E5FF' : '#6B7280', textTransform: 'uppercase' }}>
                                                {layer.type.slice(0, 4)}
                                            </span>
                                            <span style={{
                                                fontSize: '12px',
                                                fontWeight: isSelected ? 600 : 400,
                                                color: isSelected ? '#FFFFFF' : '#EDEAE3',
                                                whiteSpace: 'nowrap',
                                                textOverflow: 'ellipsis',
                                                overflow: 'hidden',
                                                maxWidth: '100px',
                                            }}>
                                                {layer.name || layer.id}
                                            </span>
                                        </div>

                                        {/* Layer Action Icons: Ordering, Visibility, Lock, Delete */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                                            {/* Move Up */}
                                            <button
                                                type="button"
                                                onClick={(e) => handleMoveLayer(layer.id, 'up', e)}
                                                title="Bring Forward"
                                                style={{ background: 'transparent', border: 'none', color: '#6B7280', padding: '2px', cursor: 'pointer' }}
                                            >
                                                <ArrowUp size={11} />
                                            </button>
                                            {/* Move Down */}
                                            <button
                                                type="button"
                                                onClick={(e) => handleMoveLayer(layer.id, 'down', e)}
                                                title="Send Backward"
                                                style={{ background: 'transparent', border: 'none', color: '#6B7280', padding: '2px', cursor: 'pointer' }}
                                            >
                                                <ArrowDown size={11} />
                                            </button>
                                            {/* Visibility Toggle */}
                                            <button
                                                type="button"
                                                onClick={(e) => handleToggleVisibility(layer.id, e)}
                                                title={layer.visible ? 'Hide layer' : 'Show layer'}
                                                style={{ background: 'transparent', border: 'none', color: layer.visible ? '#9CA3AF' : '#4B5563', padding: '2px', cursor: 'pointer' }}
                                            >
                                                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                                            </button>
                                            {/* Lock Toggle */}
                                            <button
                                                type="button"
                                                onClick={(e) => handleToggleLock(layer.id, e)}
                                                title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                                                style={{ background: 'transparent', border: 'none', color: layer.locked ? '#00E5FF' : '#4B5563', padding: '2px', cursor: 'pointer' }}
                                            >
                                                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                                            </button>
                                            {/* Delete */}
                                            <button
                                                type="button"
                                                onClick={(e) => handleDeleteLayer(layer.id, e)}
                                                title="Delete layer"
                                                style={{ background: 'transparent', border: 'none', color: '#6B7280', padding: '2px', cursor: 'pointer' }}
                                            >
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {/* 2. COMPONENTS TAB */}
                {activeTab === 'components' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>STARTER COMPONENTS</span>
                        {STARTER_COMPONENTS.map(cmp => (
                            <div
                                key={cmp.id}
                                style={{
                                    background: '#1E222B',
                                    border: '1px solid #2A2E39',
                                    borderRadius: '8px',
                                    padding: '10px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '6px',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 600, color: '#FFFFFF' }}>{cmp.name}</span>
                                    <span style={{ fontSize: '10px', color: '#00E5FF' }}>{cmp.category}</span>
                                </div>
                                <span style={{ fontSize: '11px', color: '#6B7280' }}>
                                    {cmp.w} x {cmp.h} px · {cmp.layers.length} layers
                                </span>
                                <button
                                    type="button"
                                    onClick={() => onInsertComponent(cmp)}
                                    style={{
                                        marginTop: '4px',
                                        padding: '6px 10px',
                                        background: '#0B7C91',
                                        color: '#FFFFFF',
                                        border: 'none',
                                        borderRadius: '4px',
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
                                    <span>Insert on Canvas</span>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 3. DESIGN TOKENS & VARIABLES TAB */}
                {activeTab === 'tokens' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Theme Modes */}
                        <div>
                            <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
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
                                            background: selectedTheme === tm.id ? '#0B7C91' : '#1E222B',
                                            color: selectedTheme === tm.id ? '#FFFFFF' : '#EDEAE3',
                                            border: '1px solid #2A2E39',
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

                        {/* Color Variables */}
                        <div>
                            <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                ACTIVE COLOR VARIABLES
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {Object.entries(THEME_MODES[selectedTheme].colors).map(([name, hex]) => (
                                    <div
                                        key={name}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            padding: '4px 6px',
                                            background: '#1E222B',
                                            borderRadius: '4px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ width: '14px', height: '14px', borderRadius: '3px', background: hex, border: '1px solid #333' }} />
                                            <span style={{ fontSize: '11px', color: '#EDEAE3' }}>{name}</span>
                                        </div>
                                        <span style={{ fontSize: '10px', color: '#6B7280', fontFamily: 'JetBrains Mono' }}>{hex}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Typography Styles */}
                        <div>
                            <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                                TYPOGRAPHY STYLES
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {Object.values(TYPOGRAPHY_STYLES).map(style => (
                                    <button
                                        key={style.id}
                                        type="button"
                                        onClick={() => onApplyTypographyStyle(style)}
                                        style={{
                                            padding: '6px 8px',
                                            background: '#1E222B',
                                            border: '1px solid #2A2E39',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            color: '#EDEAE3',
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '11px' }}>{style.name}</div>
                                            <div style={{ fontSize: '10px', color: '#6B7280' }}>
                                                {style.fontFamily} · {style.fontSize}px · {style.fontWeight}
                                            </div>
                                        </div>
                                        <span style={{ fontSize: '10px', color: '#00E5FF' }}>Apply</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
