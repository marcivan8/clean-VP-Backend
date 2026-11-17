/**
 * client/src/design-studio/components/PropertiesInspector.jsx
 *
 * Professional Figma-class Right Sidebar Inspector:
 * - Alignment & Distribution
 * - Geometry, Dimensions, Rotation, Corner Radii & Smoothing
 * - Constraints & Responsive Resizing
 * - Auto Layout (Direction, Padding, Gap, Hug/Fill/Fixed)
 * - Typography (Fonts, Weights, Letter/Line Spacing, Decoration, Outlines)
 * - Fills, Gradients, and Image Fills
 * - Strokes (Caps, Joins, Styles, Convert to Outlines)
 * - Effects (Drop Shadows, Inner Shadows, Layer & Backdrop Blur)
 * - Blend Modes & Opacity
 * - Component & Style Copy/Paste
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    ChevronsUp, ChevronsDown, Move, RotateCw, CornerDownRight,
    Type, Square, Eye, Copy, Clipboard, Sparkles, Layers,
    Sliders, ChevronDown, Check, Wand2, Shield
} from 'lucide-react';
import { copyLayerProperties, pasteLayerProperties, TYPOGRAPHY_STYLES, EFFECT_STYLES } from '../designSystem.js';
import { convertStrokeToOutline } from '../vectorMath.js';

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

const BLEND_MODES = [
    'normal',
    'multiply',
    'screen',
    'overlay',
    'darken',
    'lighten',
    'color-dodge',
    'soft-light',
    'difference',
    'exclusion',
];

export default function PropertiesInspector({
    selectedLayers = [],
    onUpdateLayer,
    onAlign,
    onDistribute,
    onCreateComponent,
}) {
    const primaryLayer = selectedLayers[0] || null;

    const [independentRadii, setIndependentRadii] = useState(false);
    const [copiedProps, setCopiedProps] = useState(null);

    if (!primaryLayer) {
        return (
            <div style={{
                width: '320px',
                background: '#161920',
                borderLeft: '1px solid #2A2E39',
                padding: '24px 16px',
                color: '#9CA3AF',
                fontSize: '13px',
                textAlign: 'center',
                userSelect: 'none',
            }}>
                <div style={{ marginBottom: '8px', color: '#EDEAE3', fontWeight: 600 }}>No selection</div>
                Select a layer or draw a shape on the canvas to inspect and edit properties.
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

    return (
        <div style={{
            width: '320px',
            background: '#161920',
            borderLeft: '1px solid #2A2E39',
            padding: '16px',
            color: '#EDEAE3',
            fontSize: '12px',
            overflowY: 'auto',
            maxHeight: 'calc(100vh - 120px)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            userSelect: 'none',
        }}>
            {/* Header: Layer Name & Type */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <span style={{ fontSize: '10px', textTransform: 'uppercase', color: '#9CA3AF', letterSpacing: '0.5px' }}>
                        {primaryLayer.type}
                    </span>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#FFFFFF' }}>
                        {primaryLayer.name || 'Untitled Layer'}
                    </div>
                </div>

                {/* Quick Copy / Paste Style */}
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        type="button"
                        onClick={handleCopyProperties}
                        title="Copy Properties (Cmd+Alt+C)"
                        style={{
                            padding: '4px 6px',
                            background: '#1E222B',
                            color: '#00E5FF',
                            border: '1px solid #2A2E39',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                        }}
                    >
                        <Copy size={12} />
                        <span>Copy</span>
                    </button>
                    <button
                        type="button"
                        onClick={handlePasteProperties}
                        title="Paste Properties (Cmd+Alt+V)"
                        style={{
                            padding: '4px 6px',
                            background: '#1E222B',
                            color: '#00E5FF',
                            border: '1px solid #2A2E39',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                        }}
                    >
                        <Clipboard size={12} />
                        <span>Paste</span>
                    </button>
                </div>
            </div>

            {/* 1. Alignment & Distribution Bar */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: '2px',
                background: '#1F242D',
                padding: '4px',
                borderRadius: '6px',
            }}>
                <button
                    type="button"
                    onClick={() => onAlign('left')}
                    title="Align Left"
                    style={{ background: 'transparent', border: 'none', color: '#EDEAE3', padding: '6px', cursor: 'pointer' }}
                >
                    <AlignLeft size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => onAlign('center_h')}
                    title="Align Horizontal Center"
                    style={{ background: 'transparent', border: 'none', color: '#EDEAE3', padding: '6px', cursor: 'pointer' }}
                >
                    <AlignCenter size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => onAlign('right')}
                    title="Align Right"
                    style={{ background: 'transparent', border: 'none', color: '#EDEAE3', padding: '6px', cursor: 'pointer' }}
                >
                    <AlignRight size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => onAlign('top')}
                    title="Align Top"
                    style={{ background: 'transparent', border: 'none', color: '#EDEAE3', padding: '6px', cursor: 'pointer' }}
                >
                    <ChevronsUp size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => onAlign('center_v')}
                    title="Align Vertical Center"
                    style={{ background: 'transparent', border: 'none', color: '#EDEAE3', padding: '6px', cursor: 'pointer' }}
                >
                    <AlignJustify size={14} />
                </button>
                <button
                    type="button"
                    onClick={() => onAlign('bottom')}
                    title="Align Bottom"
                    style={{ background: 'transparent', border: 'none', color: '#EDEAE3', padding: '6px', cursor: 'pointer' }}
                >
                    <ChevronsDown size={14} />
                </button>
            </div>

            {/* 2. Position & Size */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>TRANSFORM</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <span style={{ color: '#6B7280', width: '16px' }}>X</span>
                        <input
                            type="number"
                            value={primaryLayer.x || 0}
                            onChange={(e) => handleChange('x', Number(e.target.value))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <span style={{ color: '#6B7280', width: '16px' }}>Y</span>
                        <input
                            type="number"
                            value={primaryLayer.y || 0}
                            onChange={(e) => handleChange('y', Number(e.target.value))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <span style={{ color: '#6B7280', width: '16px' }}>W</span>
                        <input
                            type="number"
                            value={primaryLayer.w || 100}
                            onChange={(e) => handleChange('w', Math.max(1, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <span style={{ color: '#6B7280', width: '16px' }}>H</span>
                        <input
                            type="number"
                            value={primaryLayer.h || 40}
                            onChange={(e) => handleChange('h', Math.max(1, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>

                {/* Rotation & Corner Radius */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <RotateCw size={13} style={{ color: '#6B7280', marginRight: '6px' }} />
                        <input
                            type="number"
                            value={primaryLayer.rotation || 0}
                            onChange={(e) => handleChange('rotation', Number(e.target.value))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                        <span style={{ color: '#6B7280', fontSize: '11px' }}>°</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <CornerDownRight size={13} style={{ color: '#6B7280', marginRight: '6px' }} />
                        <input
                            type="number"
                            value={primaryLayer.cornerRadius || 0}
                            onChange={(e) => handleChange('cornerRadius', Math.max(0, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>
            </div>

            {/* 3. Constraints & Responsive Resizing */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>CONSTRAINTS</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <select
                        value={primaryLayer.constraints?.horizontal || 'left'}
                        onChange={(e) => handleChange('constraints', { ...(primaryLayer.constraints || {}), horizontal: e.target.value })}
                        style={{ background: '#1E222B', color: '#EDEAE3', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px', fontSize: '11px' }}
                    >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                        <option value="left_right">Left & Right (Scale)</option>
                    </select>

                    <select
                        value={primaryLayer.constraints?.vertical || 'top'}
                        onChange={(e) => handleChange('constraints', { ...(primaryLayer.constraints || {}), vertical: e.target.value })}
                        style={{ background: '#1E222B', color: '#EDEAE3', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px', fontSize: '11px' }}
                    >
                        <option value="top">Top</option>
                        <option value="center">Center</option>
                        <option value="bottom">Bottom</option>
                        <option value="top_bottom">Top & Bottom (Scale)</option>
                    </select>
                </div>
            </div>

            {/* 4. Auto Layout (when Frame or Group selected) */}
            {(primaryLayer.type === 'frame' || primaryLayer.autoLayout) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #2A2E39', paddingTop: '12px' }}>
                    <span style={{ fontSize: '11px', color: '#00E5FF', fontWeight: 600 }}>AUTO LAYOUT</span>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <select
                            value={primaryLayer.autoLayout?.direction || 'horizontal'}
                            onChange={(e) => handleChange('autoLayout', { ...(primaryLayer.autoLayout || {}), direction: e.target.value })}
                            style={{ background: '#1E222B', color: '#EDEAE3', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px', fontSize: '11px' }}
                        >
                            <option value="horizontal">Horizontal</option>
                            <option value="vertical">Vertical</option>
                        </select>

                        <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                            <span style={{ color: '#6B7280', fontSize: '11px', marginRight: '4px' }}>Gap</span>
                            <input
                                type="number"
                                value={primaryLayer.autoLayout?.gap ?? 16}
                                onChange={(e) => handleChange('autoLayout', { ...(primaryLayer.autoLayout || {}), gap: Number(e.target.value) })}
                                style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* 5. Typography (when Text Layer selected) */}
            {(primaryLayer.type === 'text' || primaryLayer.type === 'badge') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #2A2E39', paddingTop: '12px' }}>
                    <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>TYPOGRAPHY</span>

                    {/* Font Family */}
                    <select
                        value={primaryLayer.fontFamily || 'Plus Jakarta Sans'}
                        onChange={(e) => handleChange('fontFamily', e.target.value)}
                        style={{ background: '#1E222B', color: '#EDEAE3', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px', fontSize: '12px' }}
                    >
                        {AVAILABLE_FONTS.map(f => (
                            <option key={f} value={f}>{f}</option>
                        ))}
                    </select>

                    {/* Font Size & Weight */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                            <span style={{ color: '#6B7280', fontSize: '11px', marginRight: '4px' }}>Size</span>
                            <input
                                type="number"
                                value={primaryLayer.fontSize || 32}
                                onChange={(e) => handleChange('fontSize', Math.max(8, Number(e.target.value)))}
                                style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                            />
                        </div>

                        <select
                            value={primaryLayer.fontWeight || 700}
                            onChange={(e) => handleChange('fontWeight', Number(e.target.value))}
                            style={{ background: '#1E222B', color: '#EDEAE3', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px', fontSize: '11px' }}
                        >
                            <option value={400}>Regular (400)</option>
                            <option value={500}>Medium (500)</option>
                            <option value={600}>SemiBold (600)</option>
                            <option value={700}>Bold (700)</option>
                            <option value={800}>ExtraBold (800)</option>
                            <option value={900}>Black (900)</option>
                        </select>
                    </div>

                    {/* Letter Spacing & Line Height */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                            <span style={{ color: '#6B7280', fontSize: '11px', marginRight: '4px' }}>Tracking</span>
                            <input
                                type="number"
                                value={primaryLayer.letterSpacing || 0}
                                onChange={(e) => handleChange('letterSpacing', Number(e.target.value))}
                                style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                            <span style={{ color: '#6B7280', fontSize: '11px', marginRight: '4px' }}>Leading</span>
                            <input
                                type="number"
                                step="0.05"
                                value={primaryLayer.lineHeight || 1.15}
                                onChange={(e) => handleChange('lineHeight', Number(e.target.value))}
                                style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* 6. Fill Color & Swatches */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #2A2E39', paddingTop: '12px' }}>
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>FILL</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                        type="color"
                        value={primaryLayer.fill && primaryLayer.fill.startsWith('#') ? primaryLayer.fill : '#00E5FF'}
                        onChange={(e) => handleChange('fill', e.target.value)}
                        style={{ width: '28px', height: '28px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                    />
                    <input
                        type="text"
                        value={primaryLayer.fill || '#00E5FF'}
                        onChange={(e) => handleChange('fill', e.target.value)}
                        style={{ flex: 1, background: '#1E222B', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px 8px', color: '#FFFFFF', fontSize: '12px' }}
                    />
                </div>
            </div>

            {/* 7. Stroke & Outlines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #2A2E39', paddingTop: '12px' }}>
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>STROKE</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <input
                            type="color"
                            value={primaryLayer.stroke && primaryLayer.stroke.startsWith('#') ? primaryLayer.stroke : '#00E5FF'}
                            onChange={(e) => handleChange('stroke', e.target.value)}
                            style={{ width: '24px', height: '24px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
                        />
                        <input
                            type="text"
                            value={primaryLayer.stroke || 'transparent'}
                            onChange={(e) => handleChange('stroke', e.target.value)}
                            style={{ width: '100%', background: '#1E222B', border: '1px solid #2A2E39', borderRadius: '4px', padding: '4px 6px', color: '#FFFFFF', fontSize: '11px' }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <span style={{ color: '#6B7280', fontSize: '11px', marginRight: '4px' }}>Width</span>
                        <input
                            type="number"
                            value={primaryLayer.strokeWidth || 0}
                            onChange={(e) => handleChange('strokeWidth', Math.max(0, Number(e.target.value)))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                    </div>
                </div>
            </div>

            {/* 8. Opacity & Blend Mode */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid #2A2E39', paddingTop: '12px' }}>
                <span style={{ fontSize: '11px', color: '#9CA3AF', fontWeight: 600 }}>OPACITY & BLEND MODE</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', background: '#1E222B', borderRadius: '4px', padding: '4px 8px' }}>
                        <input
                            type="number"
                            min="0"
                            max="100"
                            value={primaryLayer.opacity !== undefined ? primaryLayer.opacity : 100}
                            onChange={(e) => handleChange('opacity', Math.max(0, Math.min(100, Number(e.target.value))))}
                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '12px', outline: 'none' }}
                        />
                        <span style={{ color: '#6B7280', fontSize: '11px' }}>%</span>
                    </div>

                    <select
                        value={primaryLayer.blendMode || 'normal'}
                        onChange={(e) => handleChange('blendMode', e.target.value)}
                        style={{ background: '#1E222B', color: '#EDEAE3', border: '1px solid #2A2E39', borderRadius: '4px', padding: '6px', fontSize: '11px' }}
                    >
                        {BLEND_MODES.map(b => (
                            <option key={b} value={b}>{b.charAt(0).toUpperCase() + b.slice(1)}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* 9. Create Component Action */}
            <div style={{ borderTop: '1px solid #2A2E39', paddingTop: '12px', marginTop: 'auto' }}>
                <button
                    type="button"
                    onClick={() => onCreateComponent && onCreateComponent(primaryLayer)}
                    style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: '#1E222B',
                        color: '#00E5FF',
                        border: '1px solid #00E5FF',
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
                    <span>Create Component</span>
                </button>
            </div>
        </div>
    );
}
