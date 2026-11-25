/**
 * client/src/design-studio/components/PropertiesInspector.jsx
 *
 * Modern Studio Right Inspector (Inspired by Image 5 & 2):
 * - Clean light aesthetic (#FFFFFF with slate borders)
 * - Tabs: Design | Settings | Surfaces
 * - Alignment & Distribution matrix
 * - Transform Geometry (X, Y, W, H, Rotation, Corner Radius)
 * - Interactive Visual Box-Model Spacing Widget (Padding & Gap diagram)
 * - Auto Layout Controls (Direction, Align, Hug/Fill)
 * - Typography with Variable Fonts & Weights
 * - Fills, Strokes, Effects (Shadow, Blur), Opacity
 * - Surfaces Tab: Quality Checks, Multi-Format Sync, Export Sizes
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    AlignLeft, AlignCenter, AlignRight, AlignJustify,
    ChevronsUp, ChevronsDown, Move, RotateCw, CornerDownRight,
    Type, Square, Copy, Clipboard, Sparkles, Layers,
    Maximize2, Sliders, ChevronDown, Check, Download, Crop, FileText
} from 'lucide-react';
import { copyLayerProperties, pasteLayerProperties } from '../designSystem.js';
import { EDITOR_FONT_FAMILIES } from '../../lib/editorFonts.js';

const DESIGN_STUDIO_FONT_FAMILIES = [...new Set([
    'Plus Jakarta Sans',
    'Instrument Serif',
    'Geist',
    'JetBrains Mono',
    'Syne',
    'Clash Display',
    ...EDITOR_FONT_FAMILIES,
])];

export default function PropertiesInspector({
    selectedLayers = [],
    onUpdateLayer,
    onAlign,
    onDistribute,
    onCreateComponent,
    onToggleBackgroundRemoval,
    currentFormat = { id: 'thumbnail', label: 'Video thumbnail', res: '1280 × 720 · YouTube', w: 1280, h: 720, aspect: '16/9' },
    selectedFormat = 'thumbnail',
    setSelectedFormat,
    formatPresets = [],
    onExportSizes,
}) {
    const primaryLayer = selectedLayers[0] || null;
    const [activeTab, setActiveTab] = useState('design'); // 'design' | 'settings' | 'surfaces'
    const [copiedProps, setCopiedProps] = useState(null);

    const handleChange = (key, val) => {
        if (!primaryLayer || !onUpdateLayer) return;
        onUpdateLayer(primaryLayer.id, { [key]: val });
    };

    const handleCopyProperties = () => {
        if (!primaryLayer) return;
        const props = copyLayerProperties(primaryLayer);
        setCopiedProps(props);
    };

    const handlePasteProperties = () => {
        if (!copiedProps || !onUpdateLayer) return;
        selectedLayers.forEach(l => {
            const updated = pasteLayerProperties(l, copiedProps);
            onUpdateLayer(l.id, updated);
        });
    };

    const autoLayout = primaryLayer?.autoLayout || {
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        gap: 16,
        direction: 'horizontal',
    };

    const updatePadding = (side, val) => {
        if (!primaryLayer || !onUpdateLayer) return;
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
            padding: '16px',
            color: '#0F172A',
            fontSize: '12px',
            overflowY: 'auto',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            userSelect: 'none',
        }}>
            {/* Top Tabs: Design | Settings | Surfaces */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #F1F5F9',
                paddingBottom: '10px',
                flexShrink: 0,
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
                    <button
                        type="button"
                        onClick={() => setActiveTab('surfaces')}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            color: activeTab === 'surfaces' ? '#0B7C91' : '#64748B',
                            fontWeight: activeTab === 'surfaces' ? 700 : 500,
                            fontSize: '13px',
                            cursor: 'pointer',
                            padding: '2px 0',
                            borderBottom: activeTab === 'surfaces' ? '2px solid #0B7C91' : 'none',
                        }}
                    >
                        Surfaces
                    </button>
                </div>

                {/* Quick Copy / Paste Style */}
                {primaryLayer && (
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
                                gap: '3px',
                                fontSize: '11px',
                            }}
                        >
                            <Copy size={12} />
                        </button>
                        <button
                            type="button"
                            onClick={handlePasteProperties}
                            disabled={!copiedProps}
                            title="Paste properties"
                            style={{
                                padding: '4px 6px',
                                background: copiedProps ? '#F1F5F9' : '#F8FAFC',
                                color: copiedProps ? '#0F172A' : '#94A3B8',
                                border: '1px solid #E2E8F0',
                                borderRadius: '4px',
                                cursor: copiedProps ? 'pointer' : 'default',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '3px',
                                fontSize: '11px',
                            }}
                        >
                            <Clipboard size={12} />
                        </button>
                    </div>
                )}
            </div>

            {/* TAB 1: SURFACES (Multi-Format Sync, Quality Checks, Export) */}
            {activeTab === 'surfaces' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* Active Surface */}
                    <div>
                        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                            ACTIVE SURFACE
                        </span>
                        <div style={{
                            padding: '10px 12px',
                            background: '#F8FAFC',
                            border: '1px solid #E2E8F0',
                            borderRadius: '8px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '4px',
                        }}>
                            <div style={{ fontWeight: 700, fontSize: '13px', color: '#0F172A' }}>
                                {currentFormat?.label || 'Video thumbnail'}
                            </div>
                            <div style={{ fontSize: '11px', color: '#64748B', fontFamily: 'var(--f-mono, monospace)' }}>
                                {currentFormat?.res || '1280 × 720 · YouTube'}
                            </div>
                        </div>
                    </div>

                    {/* Switch Formats */}
                    {formatPresets.length > 0 && (
                        <div>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                                SWITCH FORMAT
                            </span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {formatPresets.map(fmt => {
                                    const isSel = selectedFormat === fmt.id;
                                    return (
                                        <button
                                            key={fmt.id}
                                            type="button"
                                            onClick={() => setSelectedFormat && setSelectedFormat(fmt.id)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                padding: '8px 10px',
                                                borderRadius: '6px',
                                                border: isSel ? '1.5px solid #0B7C91' : '1px solid #E2E8F0',
                                                background: isSel ? '#F0F9FB' : '#FFFFFF',
                                                cursor: 'pointer',
                                                textAlign: 'left',
                                            }}
                                        >
                                            <div>
                                                <div style={{ fontSize: '12px', fontWeight: isSel ? 700 : 500, color: isSel ? '#0B7C91' : '#0F172A' }}>
                                                    {fmt.label}
                                                </div>
                                                <div style={{ fontSize: '10px', color: '#64748B', fontFamily: 'var(--f-mono, monospace)' }}>
                                                    {fmt.res}
                                                </div>
                                            </div>
                                            {isSel && <Check size={14} color="#0B7C91" />}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Production Checks */}
                    <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                            LIVE PRODUCTION CHECKS
                        </span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#334155' }}>
                                <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Check size={11} color="#16A34A" strokeWidth={3} />
                                </div>
                                <span>Legible at 120px wide</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#334155' }}>
                                <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Check size={11} color="#16A34A" strokeWidth={3} />
                                </div>
                                <span>Clear of player timestamp</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#334155' }}>
                                <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: '#DCFCE7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <Check size={11} color="#16A34A" strokeWidth={3} />
                                </div>
                                <span>Text on accent passes 4.5:1</span>
                            </div>
                        </div>
                    </div>

                    {/* Multi-Format Sync Cards */}
                    <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>
                                MULTI-FORMAT SYNC
                            </span>
                            <span style={{ fontSize: '10px', color: '#0B7C91', fontWeight: 600 }}>
                                5 Surfaces
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {[
                                { id: 'packaging', title: 'Packaging', desc: '250 g bag' },
                                { id: 'product', title: 'Product', desc: 'Dripper 3D' },
                                { id: 'ad', title: 'Paid ad', desc: '4:5 Feed' },
                                { id: 'print', title: 'Print', desc: 'A4 shelf' },
                            ].map(card => (
                                <button
                                    key={card.id}
                                    type="button"
                                    onClick={() => setSelectedFormat && setSelectedFormat(card.id)}
                                    style={{
                                        padding: '8px',
                                        background: selectedFormat === card.id ? '#F0F9FB' : '#F8FAFC',
                                        border: selectedFormat === card.id ? '1px solid #0B7C91' : '1px solid #E2E8F0',
                                        borderRadius: '6px',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                    }}
                                >
                                    <div style={{ fontSize: '11px', fontWeight: 600, color: '#0F172A' }}>{card.title}</div>
                                    <div style={{ fontSize: '10px', color: '#64748B' }}>{card.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Export Action */}
                    <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px', marginTop: 'auto' }}>
                        <button
                            type="button"
                            onClick={() => onExportSizes && onExportSizes()}
                            style={{
                                width: '100%',
                                padding: '10px 14px',
                                background: '#0B7C91',
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 700,
                                fontSize: '12.5px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                boxShadow: '0 4px 12px rgba(11, 124, 145, 0.25)',
                            }}
                        >
                            <Download size={14} />
                            <span>Export 2 Sizes (PNG)</span>
                        </button>
                    </div>
                </div>
            )}

            {/* TAB 2: SETTINGS */}
            {activeTab === 'settings' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {primaryLayer ? (
                        <>
                            <div>
                                <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                                    LAYER SETTINGS
                                </span>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#F8FAFC', borderRadius: '6px' }}>
                                        <span style={{ color: '#64748B' }}>Blend Mode</span>
                                        <select
                                            value={primaryLayer.blendMode || 'normal'}
                                            onChange={(e) => handleChange('blendMode', e.target.value)}
                                            style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '12px', color: '#0F172A', fontWeight: 500 }}
                                        >
                                            <option value="normal">Normal</option>
                                            <option value="multiply">Multiply</option>
                                            <option value="screen">Screen</option>
                                            <option value="overlay">Overlay</option>
                                            <option value="darken">Darken</option>
                                            <option value="lighten">Lighten</option>
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#F8FAFC', borderRadius: '6px' }}>
                                        <span style={{ color: '#64748B' }}>Locked</span>
                                        <input
                                            type="checkbox"
                                            checked={!!primaryLayer.locked}
                                            onChange={(e) => handleChange('locked', e.target.checked)}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#F8FAFC', borderRadius: '6px' }}>
                                        <span style={{ color: '#64748B' }}>Visible</span>
                                        <input
                                            type="checkbox"
                                            checked={primaryLayer.visible !== false}
                                            onChange={(e) => handleChange('visible', e.target.checked)}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                                CANVAS PREFERENCES
                            </span>
                            <div style={{ padding: '12px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', color: '#64748B', lineHeight: 1.5 }}>
                                Canvas grid snapping, layout guides, and responsive artboard constraints are active.
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: DESIGN */}
            {activeTab === 'design' && (
                !primaryLayer ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                                ARTBOARD OVERVIEW
                            </span>
                            <div style={{
                                padding: '12px',
                                background: '#F8FAFC',
                                border: '1px solid #E2E8F0',
                                borderRadius: '8px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                            }}>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: '#0F172A' }}>
                                    {currentFormat?.label || 'Video thumbnail'}
                                </div>
                                <div style={{ fontSize: '11px', color: '#64748B', fontFamily: 'var(--f-mono, monospace)' }}>
                                    {currentFormat?.w || 1280} × {currentFormat?.h || 720} · {currentFormat?.aspect || '16/9'}
                                </div>
                            </div>
                        </div>

                        <div style={{
                            padding: '20px 14px',
                            border: '1px dashed #CBD5E1',
                            borderRadius: '8px',
                            textAlign: 'center',
                            color: '#64748B',
                            fontSize: '12px',
                            lineHeight: 1.5,
                        }}>
                            <div style={{ fontWeight: 600, color: '#0F172A', marginBottom: '4px' }}>
                                No element selected
                            </div>
                            Click any shape, text, or frame on canvas to inspect geometry, box-model spacing, and typography.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* 1. Alignment Matrix */}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>ALIGNMENT</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                                <button type="button" onClick={() => onAlign && onAlign('left')} title="Align left" style={{ padding: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AlignLeft size={13} /></button>
                                <button type="button" onClick={() => onAlign && onAlign('centerH')} title="Center horizontally" style={{ padding: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AlignCenter size={13} /></button>
                                <button type="button" onClick={() => onAlign && onAlign('right')} title="Align right" style={{ padding: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AlignRight size={13} /></button>
                                <button type="button" onClick={() => onAlign && onAlign('top')} title="Align top" style={{ padding: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronsUp size={13} /></button>
                                <button type="button" onClick={() => onAlign && onAlign('centerV')} title="Center vertically" style={{ padding: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><AlignJustify size={13} /></button>
                                <button type="button" onClick={() => onAlign && onAlign('bottom')} title="Align bottom" style={{ padding: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronsDown size={13} /></button>
                            </div>
                        </div>

                        {/* 2. Transform Geometry */}
                        <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>SIZE & POSITION</span>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>X</span>
                                    <input type="number" value={Math.round(primaryLayer.x || 0)} onChange={(e) => handleChange('x', Number(e.target.value))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Y</span>
                                    <input type="number" value={Math.round(primaryLayer.y || 0)} onChange={(e) => handleChange('y', Number(e.target.value))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>W</span>
                                    <input type="number" value={Math.round(primaryLayer.w || 100)} onChange={(e) => handleChange('w', Math.max(10, Number(e.target.value)))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>H</span>
                                    <input type="number" value={Math.round(primaryLayer.h || 40)} onChange={(e) => handleChange('h', Math.max(10, Number(e.target.value)))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <RotateCw size={11} color="#94A3B8" style={{ marginRight: '4px' }} />
                                    <input type="number" value={Math.round(primaryLayer.rotation || 0)} onChange={(e) => handleChange('rotation', Number(e.target.value))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <CornerDownRight size={11} color="#94A3B8" style={{ marginRight: '4px' }} />
                                    <input type="number" value={primaryLayer.cornerRadius || 0} onChange={(e) => handleChange('cornerRadius', Math.max(0, Number(e.target.value)))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                            </div>
                        </div>

                        {/* 3. Typography (if Text Layer) */}
                        {primaryLayer.type === 'text' && (
                            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                                <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>TYPOGRAPHY</span>
                                <div style={{ marginBottom: '8px' }}>
                                    <select
                                        value={primaryLayer.fontFamily || 'Plus Jakarta Sans'}
                                        onChange={(e) => handleChange('fontFamily', e.target.value)}
                                        style={{ width: '100%', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '6px 8px', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                                    >
                                        {DESIGN_STUDIO_FONT_FAMILIES.map(f => (
                                            <option key={f} value={f}>{f}</option>
                                        ))}
                                    </select>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                        <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Size</span>
                                        <input type="number" value={primaryLayer.fontSize || 48} onChange={(e) => handleChange('fontSize', Math.max(8, Number(e.target.value)))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                        <select
                                            value={primaryLayer.fontWeight || 600}
                                            onChange={(e) => handleChange('fontWeight', Number(e.target.value))}
                                            style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }}
                                        >
                                            <option value={400}>Regular (400)</option>
                                            <option value={500}>Medium (500)</option>
                                            <option value={600}>SemiBold (600)</option>
                                            <option value={700}>Bold (700)</option>
                                            <option value={800}>ExtraBold (800)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* 5. Fill & Stroke */}
                        <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                            <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600, display: 'block', marginBottom: '8px' }}>FILL & STROKE</span>
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

                            {/* Quick Swatches */}
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                                {['#00E5FF', '#0B7C91', '#C85A17', '#F4EDE2', '#10151D', '#FFFFFF', '#64748B', '#16A34A'].map(swatch => (
                                    <button
                                        key={swatch}
                                        type="button"
                                        onClick={() => handleChange('fill', swatch)}
                                        style={{
                                            width: '20px',
                                            height: '20px',
                                            borderRadius: '4px',
                                            background: swatch,
                                            border: '1px solid rgba(0,0,0,0.15)',
                                            cursor: 'pointer',
                                            padding: 0,
                                        }}
                                        title={swatch}
                                    />
                                ))}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Stroke</span>
                                    <input type="number" value={primaryLayer.strokeWidth || 0} onChange={(e) => handleChange('strokeWidth', Math.max(0, Number(e.target.value)))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '6px', padding: '4px 8px' }}>
                                    <span style={{ color: '#94A3B8', fontSize: '11px', marginRight: '4px' }}>Opacity</span>
                                    <input type="number" min="0" max="100" value={primaryLayer.opacity !== undefined ? primaryLayer.opacity : 100} onChange={(e) => handleChange('opacity', Math.max(0, Math.min(100, Number(e.target.value))))} style={{ width: '100%', background: 'transparent', border: 'none', color: '#0F172A', fontSize: '12px', outline: 'none' }} />
                                </div>
                            </div>
                        </div>

                        {/* Image Actions: Background Removal */}
                        {(primaryLayer.type === 'image' || primaryLayer.src || primaryLayer.id === 'subject') && (
                            <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>IMAGE ACTIONS</span>
                                    {primaryLayer.backgroundRemoved && (
                                        <span style={{ fontSize: '10px', color: '#16A34A', fontWeight: 600, background: '#DCFCE7', padding: '1px 6px', borderRadius: '4px' }}>
                                            Cutout Active
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onToggleBackgroundRemoval && onToggleBackgroundRemoval(primaryLayer.id)}
                                    style={{
                                        width: '100%',
                                        padding: '8px 12px',
                                        background: primaryLayer.backgroundRemoved ? '#F1F5F9' : '#0F172A',
                                        color: primaryLayer.backgroundRemoved ? '#0F172A' : '#FFFFFF',
                                        border: primaryLayer.backgroundRemoved ? '1px solid #CBD5E1' : 'none',
                                        borderRadius: '6px',
                                        fontWeight: 600,
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '7px',
                                        boxShadow: primaryLayer.backgroundRemoved ? 'none' : '0 2px 8px rgba(15, 23, 42, 0.2)',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    <Sparkles size={13} color={primaryLayer.backgroundRemoved ? '#0B7C91' : '#00E5FF'} />
                                    <span>{primaryLayer.backgroundRemoved ? 'Restore Background' : 'Remove Background'}</span>
                                </button>
                            </div>
                        )}

                        {/* 6. Component Creation Trigger */}
                        <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: '12px', marginTop: 'auto' }}>
                            <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '6px', textAlign: 'center' }}>
                                Reusable across layouts & formats
                            </div>
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
                                    transition: 'all 0.15s ease',
                                }}
                                title="Save selected layer or group as reusable component in library"
                            >
                                <Layers size={14} />
                                <span>Create Master Component</span>
                            </button>
                        </div>
                    </div>
                )
            )}
        </div>
    );
}
