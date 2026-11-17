/**
 * client/src/design-studio/components/CanvasToolbar.jsx
 *
 * Professional Clean Light Canvas Toolbar (Inspired by Images 4 & 5).
 * Tools: Select, Hand, Frame, Shapes (Rect, Ellipse, Line, Polygon, Star),
 * Pen & Bézier, Pencil, Text, Image, Boolean Operations, and Layout Guides.
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import {
    MousePointer, Hand, Frame, Square, Circle, Minus, Hexagon,
    Star, PenTool, Edit3, Type, Image as ImageIcon,
    Magnet, Grid, ZoomIn, ZoomOut, FolderPlus, ChevronDown
} from 'lucide-react';

export default function CanvasToolbar({
    activeTool,
    setActiveTool,
    selectedLayersCount = 0,
    onExecuteBoolean,
    onGroupSelected,
    onUngroupSelected,
    snapToGrid,
    setSnapToGrid,
    showGuides,
    setShowGuides,
    zoom,
    setZoom,
    onUploadImageClick,
}) {
    const [shapeDropdownOpen, setShapeDropdownOpen] = useState(false);

    const isShapeTool = ['rect', 'ellipse', 'line', 'polygon', 'star'].includes(activeTool);

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: '#FFFFFF',
            borderBottom: '1px solid #E2E8F0',
            borderRadius: '12px 12px 0 0',
            userSelect: 'none',
        }}>
            {/* Primary Tool Buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {/* Select Tool */}
                <button
                    type="button"
                    onClick={() => setActiveTool('select')}
                    title="Select (V)"
                    style={{
                        padding: '6px 10px',
                        background: activeTool === 'select' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'select' ? '#0B7C91' : '#475569',
                        border: activeTool === 'select' ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                    }}
                >
                    <MousePointer size={15} />
                </button>

                {/* Hand Pan Tool */}
                <button
                    type="button"
                    onClick={() => setActiveTool('hand')}
                    title="Hand Tool (H)"
                    style={{
                        padding: '6px 10px',
                        background: activeTool === 'hand' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'hand' ? '#0B7C91' : '#475569',
                        border: activeTool === 'hand' ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Hand size={15} />
                </button>

                <div style={{ width: '1px', height: '18px', background: '#E2E8F0', margin: '0 4px' }} />

                {/* Frame Tool */}
                <button
                    type="button"
                    onClick={() => setActiveTool('frame')}
                    title="Frame (F)"
                    style={{
                        padding: '6px 10px',
                        background: activeTool === 'frame' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'frame' ? '#0B7C91' : '#475569',
                        border: activeTool === 'frame' ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Frame size={15} />
                </button>

                {/* Shapes Dropdown */}
                <div style={{ position: 'relative' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTool(isShapeTool ? activeTool : 'rect')}
                            title="Shapes (R)"
                            style={{
                                padding: '6px 8px',
                                background: isShapeTool ? '#F0F9FB' : 'transparent',
                                color: isShapeTool ? '#0B7C91' : '#475569',
                                border: isShapeTool ? '1px solid #0B7C91' : '1px solid transparent',
                                borderRadius: '6px 0 0 6px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            {activeTool === 'ellipse' && <Circle size={15} />}
                            {activeTool === 'line' && <Minus size={15} />}
                            {activeTool === 'polygon' && <Hexagon size={15} />}
                            {activeTool === 'star' && <Star size={15} />}
                            {(!isShapeTool || activeTool === 'rect') && <Square size={15} />}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShapeDropdownOpen(!shapeDropdownOpen)}
                            style={{
                                padding: '6px 4px',
                                background: isShapeTool ? '#F0F9FB' : 'transparent',
                                color: isShapeTool ? '#0B7C91' : '#475569',
                                border: isShapeTool ? '1px solid #0B7C91' : '1px solid transparent',
                                borderLeft: 'none',
                                borderRadius: '0 6px 6px 0',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                        >
                            <ChevronDown size={12} />
                        </button>
                    </div>

                    {shapeDropdownOpen && (
                        <div
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: '4px',
                                background: '#FFFFFF',
                                border: '1px solid #E2E8F0',
                                borderRadius: '8px',
                                padding: '4px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                zIndex: 100,
                                minWidth: '130px',
                                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                            }}
                            onMouseLeave={() => setShapeDropdownOpen(false)}
                        >
                            {[
                                { id: 'rect', label: 'Rectangle', icon: Square, shortcut: 'R' },
                                { id: 'ellipse', label: 'Ellipse', icon: Circle, shortcut: 'O' },
                                { id: 'line', label: 'Line', icon: Minus, shortcut: 'L' },
                                { id: 'polygon', label: 'Polygon', icon: Hexagon, shortcut: 'P' },
                                { id: 'star', label: 'Star', icon: Star, shortcut: 'S' },
                            ].map(item => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveTool(item.id);
                                        setShapeDropdownOpen(false);
                                    }}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        padding: '6px 8px',
                                        background: activeTool === item.id ? '#F0F9FB' : 'transparent',
                                        color: activeTool === item.id ? '#0B7C91' : '#1E293B',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                        textAlign: 'left',
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <item.icon size={14} />
                                        <span>{item.label}</span>
                                    </div>
                                    <span style={{ color: '#94A3B8', fontSize: '10px' }}>{item.shortcut}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Pen (Bézier) Tool */}
                <button
                    type="button"
                    onClick={() => setActiveTool('pen')}
                    title="Pen Tool (P)"
                    style={{
                        padding: '6px 10px',
                        background: activeTool === 'pen' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'pen' ? '#0B7C91' : '#475569',
                        border: activeTool === 'pen' ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <PenTool size={15} />
                </button>

                {/* Pencil (Freehand) Tool */}
                <button
                    type="button"
                    onClick={() => setActiveTool('pencil')}
                    title="Pencil Tool (Shift+P)"
                    style={{
                        padding: '6px 10px',
                        background: activeTool === 'pencil' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'pencil' ? '#0B7C91' : '#475569',
                        border: activeTool === 'pencil' ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Edit3 size={15} />
                </button>

                {/* Text Tool */}
                <button
                    type="button"
                    onClick={() => setActiveTool('text')}
                    title="Text (T)"
                    style={{
                        padding: '6px 10px',
                        background: activeTool === 'text' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'text' ? '#0B7C91' : '#475569',
                        border: activeTool === 'text' ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Type size={15} />
                </button>

                {/* Image Tool */}
                <button
                    type="button"
                    onClick={onUploadImageClick}
                    title="Place or Upload Image"
                    style={{
                        padding: '6px 10px',
                        background: 'transparent',
                        color: '#475569',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <ImageIcon size={15} />
                </button>
            </div>

            {/* Boolean Operations (Enabled when 2+ shapes selected) */}
            {selectedLayersCount >= 2 && (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#F8FAFC',
                    padding: '2px 6px',
                    borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                }}>
                    <span style={{ fontSize: '11px', color: '#64748B', paddingRight: '4px', fontWeight: 600 }}>
                        Boolean:
                    </span>
                    {['union', 'subtract', 'intersect', 'exclude'].map(op => (
                        <button
                            key={op}
                            type="button"
                            onClick={() => onExecuteBoolean(op)}
                            style={{
                                padding: '4px 6px',
                                background: 'transparent',
                                color: '#0B7C91',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                fontWeight: 600,
                                textTransform: 'capitalize',
                            }}
                        >
                            {op}
                        </button>
                    ))}
                </div>
            )}

            {/* Canvas Helpers: Snapping, Guides, Zoom */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {/* Group / Ungroup */}
                {selectedLayersCount >= 2 && (
                    <button
                        type="button"
                        onClick={onGroupSelected}
                        title="Group Selected (Cmd+G)"
                        style={{
                            padding: '5px 8px',
                            background: '#F8FAFC',
                            color: '#1E293B',
                            border: '1px solid #E2E8F0',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '11px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontWeight: 500,
                        }}
                    >
                        <FolderPlus size={13} />
                        <span>Group</span>
                    </button>
                )}

                {/* Snap to grid toggle */}
                <button
                    type="button"
                    onClick={() => setSnapToGrid(!snapToGrid)}
                    title={snapToGrid ? 'Snap enabled' : 'Snap disabled'}
                    style={{
                        padding: '6px',
                        background: snapToGrid ? '#F0F9FB' : 'transparent',
                        color: snapToGrid ? '#0B7C91' : '#94A3B8',
                        border: snapToGrid ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Magnet size={14} />
                </button>

                {/* Guides toggle */}
                <button
                    type="button"
                    onClick={() => setShowGuides(!showGuides)}
                    title={showGuides ? 'Hide layout guides' : 'Show layout guides'}
                    style={{
                        padding: '6px',
                        background: showGuides ? '#F0F9FB' : 'transparent',
                        color: showGuides ? '#0B7C91' : '#94A3B8',
                        border: showGuides ? '1px solid #0B7C91' : '1px solid transparent',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Grid size={14} />
                </button>

                {/* Zoom Controls */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#F8FAFC',
                    borderRadius: '6px',
                    padding: '2px 4px',
                    border: '1px solid #E2E8F0',
                }}>
                    <button
                        type="button"
                        onClick={() => setZoom(prev => Math.max(0.2, Math.round((prev - 0.1) * 10) / 10))}
                        title="Zoom out"
                        style={{
                            padding: '4px',
                            background: 'transparent',
                            color: '#475569',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                        }}
                    >
                        <ZoomOut size={13} />
                    </button>
                    <span style={{ fontSize: '11px', color: '#0F172A', minWidth: '38px', textAlign: 'center', fontWeight: 600 }}>
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        type="button"
                        onClick={() => setZoom(prev => Math.min(3, Math.round((prev + 0.1) * 10) / 10))}
                        title="Zoom in"
                        style={{
                            padding: '4px',
                            background: 'transparent',
                            color: '#475569',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                        }}
                    >
                        <ZoomIn size={13} />
                    </button>
                </div>
            </div>
        </div>
    );
}
