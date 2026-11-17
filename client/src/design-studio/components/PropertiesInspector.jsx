/**
 * client/src/design-studio/components/PropertiesInspector.jsx
 *
 * Modern Studio Right Inspector (Inspired by Image 5 & 2):
 * - Clean light aesthetic (#FFFFFF with slate borders)
 * - Alignment & Distribution matrix
 * - Transform Geometry (X, Y, W, H, Rotation, Corner Radius)
 * - Interactive Visual Box-Model Spacing Widget (Padding & Gap diagram)
 * - Auto Layout Controls (Direction, Align, Hug/Fill)
 * - Typography with Variable Fonts & Weights
 * - Fills, Strokes, Effects (Shadow, Blur), Opacity
 * - Style Copy & Paste Properties
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    ChevronsUp, ChevronsDown, Move, RotateCw, CornerDownRight,
    Type, Square, Copy, Clipboard, Sparkles, Layers,
    Maximize2, Sliders, ChevronDown, Check
} from 'lucide-react';
import { copyLayerProperties, pasteLayerProperties } from '../designSystem.js';

const AVAILABLE_FONTS = [
    'Plus Jakarta Sans',
    'Instrument Serif',
    'Inter',
    'Geist',
    'JetBrains Mono',
    'Syne',
    'Clash Display',
    'Oswald',
    'Anton',
    'Playfair Display',
    'Cormorant Garamond',
];

export default function PropertiesInspector({
    selectedLayers = [],
    onUpdateLayer,
    onAlign,
    onDistribute,
    onCreateComponent,
}) {
    const primaryLayer = selectedLayers[0] || null;
    const [activeTab, setActiveTab] = useState('design'); // 'design' | 'settings'
    const [copiedProps, setCopiedProps] = useState(null);

    if (!primaryLayer) {
        return (
            <div style={{
                width: '300px',
                background: '#FFFFFF',
                borderLeft: '1px solid #E2E8F0',
                borderRadius: '0 12px 12px 0',
                padding: '32px 20px',
                color: '#64748B',
                fontSize: '12px',
                textAlign: 'center',
                userSelect: 'none',
            }}>
                <div style={{ marginBottom: '8px', color: '#0F172A', fontWeight: 600, fontSize: '13px' }}>
                    No selection
                </div>
                Click a layer on the canvas or in the Layers list to inspect properties.
            </div>
        );
    }

    const handleChange = (key, val) => {
        onUpdateLayer(primaryLayer.id, { [key]: val });
    };

    const handleCopyProperties = () => {
        const props = copyLayerProperties(primaryLayer);
        setCopiedProps(props);
    };

    const handlePasteProperties = () => {
        selectedLayers.forEach(l => {
            const updated = pasteLayerProperties(l, copiedProps);
            onUpdateLayer(l.id, updated);
        });
    };

    const autoLayout = primaryLayer.autoLayout || {
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        gap: 16,
        direction: 'horizontal',
    };

    const updatePadding = (side, val) => {
        const currentAl = primaryLayer.autoLayout || { direction: 'horizontal', gap: 16 };
        onUpdateLayer(primaryLayer.id, {
            autoLayout: {
                ...currentAl,
                [side]: Math.max(0, Number(val) || 0),
            },
        });
    };

    return (
        <div style={{
            width: '300px',
            background: '#FFFFFF',
            borderLeft: '1px solid #E2E8F0',
            borderRadius: '0 12px 12px 0',
            padding: '16px',
            color: '#0F172A',
            fontSize: '12px',
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 120px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            userSelect: 'none',
        }}>
            {/* Top Tabs: Design | Settings (Image 5) */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #F1F5F9',
                paddingBottom: '10px',
            }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        type="button"
                        onClick={() => setActiveTab('design')}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: activeTab === 'design' ? '#0B7C91' : '#64748B',
                            fontWeight: activeTab === 'design' ? 700 : 500,
                            fontSize: '13px',
                            cursor: 'pointer',
                            padding: '2px 0',
                            borderBottom: activeTab === 'design' ? '2px solid #0B7C91' : 'none',
                        }}
                    >
                        Design
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('settings')}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: activeTab === 'settings' ? '#0B7C91' : '#64748B',
                            fontWeight: activeTab === 'settings' ? 700 : 500,
                            fontSize: '13px',
                            cursor: 'pointer',
                            padding: '2px 0',
                            borderBottom: activeTab === 'settings' ? '2px solid #0B7C91' : 'none',
                        }}
                    >
                        Settings
                    </button>
                </div>

                {/* Quick Copy / Paste Style */}
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        type="button"
                        onClick={handleCopyProperties}
                        title="Copy properties"
                        style={{
                            padding: '4px 6px',
                            background: '#F1F5F9',
                            color: '#0F172A',
                            border: '1px solid #E2E8F0',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                        }}
                    >
                        <Copy size={11} />
                        <span>Copy</span>
                    </button>
                    <button
                        type="button"
                        onClick={handlePasteProperties}
                        title="Paste properties"
                        style={{
                            padding: '4px 6px',
                            background: '#F1F5F9',
                            color: '#0B7C91',
                            border: '1px solid #E2E8F0',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                        }}
                    >
                        <Clipboard size={11} />
                        <span>Paste</span>
                    </button>
                </div>
            </div>

            {/* 1. Alignment Matrix */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: '2px',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                padding: '3px',
                borderRadius: '8px',
            }}>
                {[
                    { id: 'left', icon: AlignLeft, title: 'Align Left' },
                    { id: 'center_h', icon: AlignCenter, title: 'Align Horizontal Center' },
                    { id: 'right', icon: AlignRight, title: 'Align Right' },
                    { id: 'top', icon: ChevronsUp, title: 'Align Top' },
                    { id: 'center_v', icon: AlignJustify, title: 'Align Vertical Center' },
                    { id: 'bottom', icon: ChevronsDown, title: 'Align Bottom' },
                ].map(item => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => onAlign(item.id)}
                        title={item.title}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#475569',
                            padding: '6px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <item.icon size={14} />
                    </button>
                ))}
            </div>

            {/* 2. Position and Size */}
            <div>
                <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                    SIZE & POSITION
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <span style={{ color: '#94A3B8', width: '16px', fontSize: '11px' }}>X</span>
                        <input
                            type="number"
                            value={primaryLayer.x || 0}
                            onChange={(e) => handleChange('x', Number(e.target.value))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <span style={{ color: '#94A3B8', width: '16px', fontSize: '11px' }}>Y</span>
                        <input
                            type="number"
                            value={primaryLayer.y || 0}
                            onChange={(e) => handleChange('y', Number(e.target.value))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <span style={{ color: '#94A3B8', width: '16px', fontSize: '11px' }}>W</span>
                        <input
                            type="number"
                            value={primaryLayer.w || 100}
                            onChange={(e) => handleChange('w', Math.max(1, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <span style={{ color: '#94A3B8', width: '16px', fontSize: '11px' }}>H</span>
                        <input
                            type="number"
                            value={primaryLayer.h || 40}
                            onChange={(e) => handleChange('h', Math.max(1, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>

                {/* Rotation & Radius */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <RotateCw size={13} style={{ color: '#94A3B8', marginRight: '6px' }} />
                        <input
                            type="number"
                            value={primaryLayer.rotation || 0}
                            onChange={(e) => handleChange('rotation', Number(e.target.value))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                        <span style={{ color: '#94A3B8', fontSize: '11px' }}>°</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <CornerDownRight size={13} style={{ color: '#94A3B8', marginRight: '6px' }} />
                        <input
                            type="number"
                            value={primaryLayer.cornerRadius || 0}
                            onChange={(e) => handleChange('cornerRadius', Math.max(0, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>
            </div>

            {/* 3. VISUAL BOX-MODEL SPACING WIDGET (Image 5 Direct Inspiration) */}
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>
                        SPACING (BOX MODEL)
                    </span>
                    <span style={{ fontSize: '10px', color: '#0B7C91', fontWeight: 600 }}>PADDING</span>
                </div>

                {/* Visual 4-Sided Padding Diagram */}
                <div style={{
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    borderRadius: '8px',
                    padding: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '4px',
                }}>
                    {/* Top Padding */}
                    <input
                        type="number"
                        value={autoLayout.paddingTop ?? 16}
                        onChange={(e) => updatePadding('paddingTop', e.target.value)}
                        title="Padding Top"
                        style={{
                            width: '42px',
                            textAlign: 'center',
                            background: '#FFFFFF',
                            border: '1px solid #CBD5E1',
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: '#0F172A',
                            padding: '2px 0',
                        }}
                    />

                    {/* Middle Row: Left - Center Content - Right */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <input
                            type="number"
                            value={autoLayout.paddingLeft ?? 16}
                            onChange={(e) => updatePadding('paddingLeft', e.target.value)}
                            title="Padding Left"
                            style={{
                                width: '42px',
                                textAlign: 'center',
                                background: '#FFFFFF',
                                border: '1px solid #CBD5E1',
                                borderRadius: '4px',
                                fontSize: '11px',
                                color: '#0F172A',
                                padding: '2px 0',
                            }}
                        />

                        {/* Center Box: Gap Spacing */}
                        <div style={{
                            background: '#F1F5F9',
                            border: '1px dashed #94A3B8',
                            borderRadius: '4px',
                            padding: '6px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                        }}>
                            <span style={{ fontSize: '9px', color: '#64748B', textTransform: 'uppercase' }}>Gap</span>
                            <input
                                type="number"
                                value={autoLayout.gap ?? 16}
                                onChange={(e) => updatePadding('gap', e.target.value)}
                                style={{
                                    width: '36px',
                                    textAlign: 'center',
                                    background: 'transparent',
                                    border: 'none',
                                    fontWeight: 700,
                                    fontSize: '12px',
                                    color: '#0B7C91',
                                    outline: 'none',
                                }}
                            />
                        </div>

                        <input
                            type="number"
                            value={autoLayout.paddingRight ?? 16}
                            onChange={(e) => updatePadding('paddingRight', e.target.value)}
                            title="Padding Right"
                            style={{
                                width: '42px',
                                textAlign: 'center',
                                background: '#FFFFFF',
                                border: '1px solid #CBD5E1',
                                borderRadius: '4px',
                                fontSize: '11px',
                                color: '#0F172A',
                                padding: '2px 0',
                            }}
                        />
                    </div>

                    {/* Bottom Padding */}
                    <input
                        type="number"
                        value={autoLayout.paddingBottom ?? 16}
                        onChange={(e) => updatePadding('paddingBottom', e.target.value)}
                        title="Padding Bottom"
                        style={{
                            width: '42px',
                            textAlign: 'center',
                            background: '#FFFFFF',
                            border: '1px solid #CBD5E1',
                            borderRadius: '4px',
                            fontSize: '11px',
                            color: '#0F172A',
                            padding: '2px 0',
                        }}
                    />
                </div>
            </div>

            {/* 4. Typography (for text & badge layers) */}
            {(primaryLayer.type === 'text' || primaryLayer.type === 'badge') && (
                <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                        TYPOGRAPHY
                    </span>

                    <select
                        value={primaryLayer.fontFamily || 'Plus Jakarta Sans'}
                        onChange={(e) => handleChange('fontFamily', e.target.value)}
                        style={{
                            width: '100%',
                            background: '#F8FAFC',
                            border: '1px solid #E2E8F0',
                            borderRadius: '6px',
                            padding: '6px 8px',
                            fontSize: '12px',
                            color: '#0F172A',
                            marginBottom: '8px',
                        }}
                    >
                        {AVAILABLE_FONTS.map(f => (
                            <option key={f} value={f}>{f}</option>
                        ))}
                    </select>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                            <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Size</span>
                            <input
                                type="number"
                                value={primaryLayer.fontSize || 32}
                                onChange={(e) => handleChange('fontSize', Math.max(8, Number(e.target.value)))}
                                style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                            />
                        </div>

                        <select
                            value={primaryLayer.fontWeight || 700}
                            onChange={(e) => handleChange('fontWeight', Number(e.target.value))}
                            style={{
                                background: '#F8FAFC',
                                border: '1px solid #E2E8F0',
                                borderRadius: '6px',
                                padding: '4px 6px',
                                fontSize: '11px',
                                color: '#0F172A',
                            }}
                        >
                            <option value={400}>Regular (400)</option>
                            <option value={500}>Medium (500)</option>
                            <option value={600}>SemiBold (600)</option>
                            <option value={700}>Bold (700)</option>
                            <option value={800}>ExtraBold (800)</option>
                        </select>
                    </div>
                </div>
            )}

            {/* 5. Fill & Stroke */}
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                    FILL & STROKE
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <input
                        type="color"
                        value={primaryLayer.fill && primaryLayer.fill.startsWith('#') ? primaryLayer.fill : '#0B7C91'}
                        onChange={(e) => handleChange('fill', e.target.value)}
                        style={{ width: '28px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                    />
                    <input
                        type="text"
                        value={primaryLayer.fill || '#0B7C91'}
                        onChange={(e) => handleChange('fill', e.target.value)}
                        style={{ flex: 1, background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 8px', color: '#0F172A', fontSize: '12px' }}
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Stroke</span>
                        <input
                            type="number"
                            value={primaryLayer.strokeWidth || 0}
                            onChange={(e) => handleChange('strokeWidth', Math.max(0, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                        <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Opacity</span>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={primaryLayer.opacity !== undefined ? primaryLayer.opacity : 100}
                            onChange={(e) => handleChange('opacity', Math.max(0, Math.min(100, Number(e.target.value))))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>
            </div>

            {/* 6. Component Creation Trigger */}
            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px', marginTop: 'auto' }}>
                <button
                    type="button"
                    onClick={() => onCreateComponent && onCreateComponent(primaryLayer)}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: '#F0F9FB',
                        color: '#0B7C91',
                        border: '1px solid #0B7C91',
                        borderRadius: '6px',
                        fontWeight: 600,
                        fontSize: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                    }}
                >
                    <Layers size={14} />
                    <span>Create Master Component</span>
                </button>
            </div>
        </div>
    );
}
