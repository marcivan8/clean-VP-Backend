/**
 * client/src/design-studio/components/InteractiveVectorCanvas.jsx
 *
 * High-performance Interactive Vector Canvas with Multi-selection,
 * 8-handle transform bounding box, rotation, marquee drag-select,
 * vector shape drawing (Rect, Ellipse, Line, Polygon, Star, Pen, Pencil),
 * smart spacing handles, and SVG rendering with gradients and filters.
 *
 * Strictly zero emojis.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    generateRoundedRectPath,
    generatePolygonPath,
    generateStarPath,
    generateBézierPath,
    simplifyFreehandPath,
    getBoundsOfPoints
} from '../vectorMath.js';
import { distributeSmartSelection } from '../autoLayout.js';

export default function InteractiveVectorCanvas({
    layers = [],
    setLayers,
    selectedLayerIds = [],
    setSelectedLayerIds,
    activeTool = 'select',
    setActiveTool,
    canvasWidth = 1280,
    canvasHeight = 720,
    zoom = 0.75,
    setZoom,
    snapToGrid = false,
    showGuides = false,
    onContextMenu,
    onUpdateLayer,
    onAddLayer,
}) {
    const containerRef = useRef(null);
    const svgRef = useRef(null);

    // Viewport pan & keyboard space navigation
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isSpacePressed, setIsSpacePressed] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) {
                e.preventDefault();
                setIsSpacePressed(true);
            }
        };
        const handleKeyUp = (e) => {
            if (e.code === 'Space') {
                setIsSpacePressed(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, []);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleWheel = (e) => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
                if (setZoom) {
                    setZoom(prev => Math.min(3.0, Math.max(0.15, Number((prev * zoomFactor).toFixed(2)))));
                }
            } else {
                setPan(prev => ({
                    x: prev.x - e.deltaX,
                    y: prev.y - e.deltaY,
                }));
            }
        };

        el.addEventListener('wheel', handleWheel, { passive: false });
        return () => el.removeEventListener('wheel', handleWheel);
    }, [setZoom]);

    // Active interaction states: 'idle' | 'marquee' | 'moving' | 'resizing' | 'rotating' | 'drawing' | 'pen' | 'pencil' | 'panning'
    const [interaction, setInteraction] = useState('idle');
    const [marquee, setMarquee] = useState(null); // { startX, startY, currentX, currentY }
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [initialLayersSnapshot, setInitialLayersSnapshot] = useState([]);
    const [resizeHandle, setResizeHandle] = useState(null); // 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
    const [rotationCenter, setRotationCenter] = useState({ cx: 0, cy: 0 });

    // Drawing state for new shapes
    const [drawingShape, setDrawingShape] = useState(null); // { type, startX, startY, currentX, currentY }

    // Pen tool active path anchors
    const [penAnchors, setPenAnchors] = useState([]);

    // Pencil freehand points
    const [pencilPoints, setPencilPoints] = useState([]);

    // Vector network edit mode (double-clicked vector layer)
    const [vectorEditLayerId, setVectorEditLayerId] = useState(null);

    // Compute unified bounding box for all selected layers
    const selectedLayers = layers.filter(l => selectedLayerIds.includes(l.id));

    let selectionBounds = null;
    if (selectedLayers.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        selectedLayers.forEach(l => {
            const lx = l.x;
            const ly = l.y;
            const lw = l.w || 100;
            const lh = l.h || 40;
            if (lx < minX) minX = lx;
            if (ly < minY) minY = ly;
            if (lx + lw > maxX) maxX = lx + lw;
            if (ly + lh > maxY) maxY = ly + lh;
        });
        selectionBounds = {
            x: minX,
            y: minY,
            w: Math.max(10, maxX - minX),
            h: Math.max(10, maxY - minY),
            cx: (minX + maxX) / 2,
            cy: (minY + maxY) / 2,
        };
    }

    // Convert screen coordinates to canvas space
    const getCanvasPoint = useCallback((e) => {
        if (!svgRef.current) return { x: 0, y: 0 };
        const rect = svgRef.current.getBoundingClientRect();
        const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX) ?? 0;
        const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY) ?? 0;

        const x = (clientX - rect.left) / zoom;
        const y = (clientY - rect.top) / zoom;

        if (snapToGrid) {
            return {
                x: Math.round(x / 8) * 8,
                y: Math.round(y / 8) * 8,
            };
        }
        return { x: Math.round(x), y: Math.round(y) };
    }, [zoom, snapToGrid]);

    // ── Mouse Down Handler ────────────────────────────────────────────────────

    const handlePointerDown = (e) => {
        if (e.button === 2) return; // Right-click handled by onContextMenu

        // Hand tool, spacebar drag, or middle mouse drag
        if (activeTool === 'hand' || isSpacePressed || e.button === 1) {
            setInteraction('panning');
            setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
            return;
        }

        const pt = getCanvasPoint(e);
        const isShift = e.shiftKey || e.metaKey || e.ctrlKey;

        // Tool: Pen
        if (activeTool === 'pen') {
            if (penAnchors.length > 0) {
                const first = penAnchors[0];
                const distToFirst = Math.hypot(pt.x - first.x, pt.y - first.y);
                if (distToFirst < 16) {
                    // Close path and add vector layer
                    const finalPathD = generateBézierPath(penAnchors, true);
                    const bounds = getBoundsOfPoints(penAnchors);
                    onAddLayer({
                        id: `vector_${Date.now()}`,
                        name: 'Vector Path',
                        type: 'vector',
                        pathD: finalPathD,
                        x: bounds.minX,
                        y: bounds.minY,
                        w: bounds.width,
                        h: bounds.height,
                        fill: 'transparent',
                        stroke: '#00E5FF',
                        strokeWidth: 2,
                        opacity: 100,
                        visible: true,
                        locked: false,
                        anchors: [...penAnchors],
                    });
                    setPenAnchors([]);
                    setActiveTool('select');
                    return;
                }
            }
            setPenAnchors(prev => [...prev, { x: pt.x, y: pt.y }]);
            return;
        }

        // Tool: Pencil
        if (activeTool === 'pencil') {
            setInteraction('pencil');
            setPencilPoints([pt]);
            return;
        }

        // Tool: Drawing Geometric Shapes (Rect, Ellipse, Line, Polygon, Star, Frame)
        if (['rect', 'ellipse', 'line', 'polygon', 'star', 'frame'].includes(activeTool)) {
            setInteraction('drawing');
            setDrawingShape({
                type: activeTool,
                startX: pt.x,
                startY: pt.y,
                currentX: pt.x,
                currentY: pt.y,
            });
            return;
        }

        // Tool: Text
        if (activeTool === 'text') {
            onAddLayer({
                id: `text_${Date.now()}`,
                name: 'Text',
                type: 'text',
                x: pt.x,
                y: pt.y,
                w: 240,
                h: 48,
                text: 'Type something',
                fontFamily: 'Plus Jakarta Sans',
                fontSize: 28,
                fontWeight: 600,
                fill: '#EDEAE3',
                opacity: 100,
                visible: true,
                locked: false,
            });
            setActiveTool('select');
            return;
        }

        // If clicking canvas background in select mode -> Start Marquee selection
        setInteraction('marquee');
        setMarquee({ startX: pt.x, startY: pt.y, currentX: pt.x, currentY: pt.y });
        if (!isShift) {
            setSelectedLayerIds([]);
        }
    };

    // ── Mouse Move Handler ────────────────────────────────────────────────────

    const handlePointerMove = (e) => {
        if (interaction === 'panning') {
            setPan({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y,
            });
            return;
        }
        const pt = getCanvasPoint(e);

        if (interaction === 'marquee' && marquee) {
            setMarquee(prev => ({ ...prev, currentX: pt.x, currentY: pt.y }));

            // Live bounding box check for marquee selection
            const minX = Math.min(marquee.startX, pt.x);
            const maxX = Math.max(marquee.startX, pt.x);
            const minY = Math.min(marquee.startY, pt.y);
            const maxY = Math.max(marquee.startY, pt.y);

            const intersecting = layers.filter(l => {
                if (l.locked || !l.visible) return false;
                const lx = l.x;
                const ly = l.y;
                const lw = l.w || 100;
                const lh = l.h || 40;
                return lx < maxX && lx + lw > minX && ly < maxY && ly + lh > minY;
            }).map(l => l.id);

            setSelectedLayerIds(intersecting);
            return;
        }

        if (interaction === 'pencil') {
            setPencilPoints(prev => [...prev, pt]);
            return;
        }

        if (interaction === 'drawing' && drawingShape) {
            setDrawingShape(prev => ({ ...prev, currentX: pt.x, currentY: pt.y }));
            return;
        }

        if (interaction === 'moving' && selectedLayers.length > 0) {
            const dx = pt.x - dragStart.x;
            const dy = pt.y - dragStart.y;

            setLayers(prev => prev.map(l => {
                const init = initialLayersSnapshot.find(s => s.id === l.id);
                if (init && selectedLayerIds.includes(l.id)) {
                    return {
                        ...l,
                        x: Math.round(init.x + dx),
                        y: Math.round(init.y + dy),
                    };
                }
                return l;
            }));
            return;
        }

        if (interaction === 'resizing' && resizeHandle && selectionBounds) {
            const dx = pt.x - dragStart.x;
            const dy = pt.y - dragStart.y;

            setLayers(prev => prev.map(l => {
                const init = initialLayersSnapshot.find(s => s.id === l.id);
                if (!init || !selectedLayerIds.includes(l.id)) return l;

                let newW = init.w;
                let newH = init.h;
                let newX = init.x;
                let newY = init.y;

                if (resizeHandle.includes('e')) newW = Math.max(10, init.w + dx);
                if (resizeHandle.includes('s')) newH = Math.max(10, init.h + dy);
                if (resizeHandle.includes('w')) {
                    newW = Math.max(10, init.w - dx);
                    newX = init.x + dx;
                }
                if (resizeHandle.includes('n')) {
                    newH = Math.max(10, init.h - dy);
                    newY = init.y + dy;
                }

                // If Shift key held, maintain aspect ratio
                if (e.shiftKey && init.w > 0 && init.h > 0) {
                    const aspect = init.w / init.h;
                    newH = Math.round(newW / aspect);
                }

                return {
                    ...l,
                    x: Math.round(newX),
                    y: Math.round(newY),
                    w: Math.round(newW),
                    h: Math.round(newH),
                };
            }));
            return;
        }

        if (interaction === 'rotating' && selectionBounds) {
            const angleRad = Math.atan2(pt.y - rotationCenter.cy, pt.x - rotationCenter.cx);
            let angleDeg = Math.round(angleRad * (180 / Math.PI));
            if (e.shiftKey) {
                angleDeg = Math.round(angleDeg / 15) * 15; // 15-degree increment snap
            }

            setLayers(prev => prev.map(l => {
                if (selectedLayerIds.includes(l.id)) {
                    return { ...l, rotation: angleDeg };
                }
                return l;
            }));
            return;
        }
    };

    // ── Mouse Up Handler ──────────────────────────────────────────────────────

    const handlePointerUp = () => {
        if (interaction === 'panning') {
            setInteraction('idle');
            return;
        }
        if (interaction === 'marquee') {
            setMarquee(null);
        }

        if (interaction === 'pencil' && pencilPoints.length > 1) {
            const pathD = simplifyFreehandPath(pencilPoints);
            const bounds = getBoundsOfPoints(pencilPoints);
            onAddLayer({
                id: `draw_${Date.now()}`,
                name: 'Freehand Path',
                type: 'vector',
                pathD,
                x: bounds.minX,
                y: bounds.minY,
                w: bounds.width,
                h: bounds.height,
                fill: 'transparent',
                stroke: '#00E5FF',
                strokeWidth: 3,
                opacity: 100,
                visible: true,
                locked: false,
            });
            setPencilPoints([]);
            setActiveTool('select');
        }

        if (interaction === 'drawing' && drawingShape) {
            const x = Math.min(drawingShape.startX, drawingShape.currentX);
            const y = Math.min(drawingShape.startY, drawingShape.currentY);
            const w = Math.max(20, Math.abs(drawingShape.currentX - drawingShape.startX));
            const h = Math.max(20, Math.abs(drawingShape.currentY - drawingShape.startY));

            const newId = `${drawingShape.type}_${Date.now()}`;
            let layerData = {
                id: newId,
                name: `${drawingShape.type.charAt(0).toUpperCase() + drawingShape.type.slice(1)}`,
                type: drawingShape.type,
                x,
                y,
                w,
                h,
                opacity: 100,
                visible: true,
                locked: false,
            };

            switch (drawingShape.type) {
                case 'rect':
                    layerData.fill = '#00E5FF';
                    layerData.cornerRadius = 0;
                    break;
                case 'ellipse':
                    layerData.fill = '#C85A17';
                    break;
                case 'line':
                    layerData.stroke = '#EDEAE3';
                    layerData.strokeWidth = 2;
                    layerData.fill = 'transparent';
                    break;
                case 'polygon':
                    layerData.sides = 6;
                    layerData.fill = '#0B7C91';
                    break;
                case 'star':
                    layerData.points = 5;
                    layerData.fill = '#00E5FF';
                    layerData.innerRatio = 0.5;
                    break;
                case 'frame':
                    layerData.fill = '#161920';
                    layerData.stroke = '#2A2E39';
                    layerData.strokeWidth = 1;
                    layerData.autoLayout = {
                        enabled: true,
                        direction: 'horizontal',
                        gap: 16,
                        padding: 16,
                        alignItems: 'center',
                        justifyContent: 'start',
                    };
                    break;
                default:
                    layerData.fill = '#00E5FF';
            }

            onAddLayer(layerData);
            setDrawingShape(null);
            setActiveTool('select');
            setSelectedLayerIds([newId]);
        }

        setInteraction('idle');
        setResizeHandle(null);
    };

    // Layer Click / Drag start
    const handleLayerPointerDown = (e, layer) => {
        e.stopPropagation();
        if (layer.locked || !layer.visible) return;

        const pt = getCanvasPoint(e);
        const isShift = e.shiftKey || e.metaKey || e.ctrlKey;

        let nextSelected = [...selectedLayerIds];
        if (isShift) {
            if (nextSelected.includes(layer.id)) {
                nextSelected = nextSelected.filter(id => id !== layer.id);
            } else {
                nextSelected.push(layer.id);
            }
        } else if (!nextSelected.includes(layer.id)) {
            nextSelected = [layer.id];
        }

        setSelectedLayerIds(nextSelected);
        setInteraction('moving');
        setDragStart(pt);
        setInitialLayersSnapshot(layers.map(l => ({ ...l })));
    };

    // Resize handle click
    const handleResizeHandleDown = (e, handle) => {
        e.stopPropagation();
        const pt = getCanvasPoint(e);
        setInteraction('resizing');
        setResizeHandle(handle);
        setDragStart(pt);
        setInitialLayersSnapshot(layers.map(l => ({ ...l })));
    };

    // Rotation handle click
    const handleRotationHandleDown = (e) => {
        e.stopPropagation();
        if (!selectionBounds) return;
        setInteraction('rotating');
        setRotationCenter({ cx: selectionBounds.cx, cy: selectionBounds.cy });
        setInitialLayersSnapshot(layers.map(l => ({ ...l })));
    };

    // Smart spacing handle click
    const handleSmartSpacingClick = (e) => {
        e.stopPropagation();
        const updated = distributeSmartSelection(selectedLayers, 'auto');
        setLayers(prev => prev.map(l => {
            const match = updated.find(u => u.id === l.id);
            return match ? { ...l, x: match.x, y: match.y } : l;
        }));
    };

    const dotSpacing = Math.max(12, Math.round(24 * zoom));
    const dotOffsetX = Math.round(pan.x % dotSpacing);
    const dotOffsetY = Math.round(pan.y % dotSpacing);

    return (
        <div
            ref={containerRef}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                flex: 1,
                minHeight: 0,
                background: '#F8FAFC',
                backgroundImage: 'radial-gradient(#CBD5E1 1.2px, transparent 1.2px)',
                backgroundSize: `${dotSpacing}px ${dotSpacing}px`,
                backgroundPosition: `${dotOffsetX}px ${dotOffsetY}px`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                cursor: (activeTool === 'hand' || isSpacePressed)
                    ? (interaction === 'panning' ? 'grabbing' : 'grab')
                    : (activeTool === 'pen' || activeTool === 'pencil' ? 'crosshair' : 'default'),
                userSelect: 'none',
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        >
            {/* Transformed Artboard Stage */}
            <div style={{
                transform: `translate(${pan.x}px, ${pan.y}px)`,
                transition: interaction === 'panning' ? 'none' : 'transform 0.04s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
            {/* SVG Canvas Board */}
            <svg
                ref={svgRef}
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                style={{
                    width: `${canvasWidth * zoom}px`,
                    height: `${canvasHeight * zoom}px`,
                    background: '#FFFFFF',
                    boxShadow: '0 20px 48px -12px rgba(16, 21, 29, 0.16), 0 0 0 1px rgba(16, 21, 29, 0.08)',
                    borderRadius: '8px',
                    overflow: 'visible',
                }}
                onContextMenu={(e) => {
                    e.preventDefault();
                    if (onContextMenu) {
                        onContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            layerId: selectedLayerIds[0] || null,
                        });
                    }
                }}
            >
                {/* SVG Definitions for Gradients, Blur, and Shadows */}
                <defs>
                    {/* Turbulence Noise Filter */}
                    <filter id="noiseFilter" x="0" y="0" width="100%" height="100%">
                        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
                        <feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.15 0" />
                    </filter>

                    {/* Standard Drop Shadow Filter */}
                    <filter id="cardShadow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="12" stdDeviation="16" floodColor="#000000" floodOpacity="0.5" />
                    </filter>
                    <filter id="cyanGlowShadow" x="-30%" y="-30%" width="160%" height="160%">
                        <feDropShadow dx="0" dy="0" stdDeviation="12" floodColor="#00E5FF" floodOpacity="0.6" />
                    </filter>
                </defs>

                {/* Optional Layout Grid Overlay */}
                {showGuides && (
                    <g opacity={0.15}>
                        {[...Array(12)].map((_, i) => (
                            <rect
                                key={`col_${i}`}
                                x={32 + i * (canvasWidth - 64) / 12 + 6}
                                y={0}
                                width={(canvasWidth - 64) / 12 - 12}
                                height={canvasHeight}
                                fill="#00E5FF"
                            />
                        ))}
                    </g>
                )}

                {/* Render All Layers */}
                {layers.map(layer => {
                    if (!layer.visible) return null;
                    const isSelected = selectedLayerIds.includes(layer.id);
                    const lw = layer.w || 100;
                    const lh = layer.h || 40;
                    const rot = layer.rotation || 0;
                    const opacity = (layer.opacity !== undefined ? layer.opacity : 100) / 100;
                    const blendMode = layer.blendMode || 'normal';

                    return (
                        <g
                            key={layer.id}
                            transform={`translate(${layer.x}, ${layer.y}) rotate(${rot}, ${lw / 2}, ${lh / 2})`}
                            style={{
                                cursor: layer.locked ? 'not-allowed' : 'pointer',
                                opacity,
                                mixBlendMode: blendMode,
                            }}
                            onPointerDown={(e) => handleLayerPointerDown(e, layer)}
                        >
                            {/* Shape: Rectangle / Frame */}
                            {(layer.type === 'rect' || layer.type === 'frame') && (
                                <path
                                    d={generateRoundedRectPath(0, 0, lw, lh, layer.cornerRadius || 0, layer.smoothCorners)}
                                    fill={layer.fill || '#00E5FF'}
                                    stroke={layer.stroke || 'transparent'}
                                    strokeWidth={layer.strokeWidth || 0}
                                    strokeDasharray={layer.strokeStyle === 'dashed' ? '8,4' : layer.strokeStyle === 'dotted' ? '3,3' : undefined}
                                />
                            )}

                            {/* Shape: Ellipse / Circle */}
                            {layer.type === 'ellipse' && (
                                <ellipse
                                    cx={lw / 2}
                                    cy={lh / 2}
                                    rx={lw / 2}
                                    ry={lh / 2}
                                    fill={layer.fill || '#C85A17'}
                                    stroke={layer.stroke || 'transparent'}
                                    strokeWidth={layer.strokeWidth || 0}
                                />
                            )}

                            {/* Shape: Line */}
                            {layer.type === 'line' && (
                                <line
                                    x1={0}
                                    y1={lh / 2}
                                    x2={lw}
                                    y2={lh / 2}
                                    stroke={layer.stroke || '#EDEAE3'}
                                    strokeWidth={layer.strokeWidth || 2}
                                    strokeLinecap={layer.strokeCap || 'round'}
                                />
                            )}

                            {/* Shape: Polygon */}
                            {layer.type === 'polygon' && (
                                <path
                                    d={generatePolygonPath(lw / 2, lh / 2, Math.min(lw, lh) / 2, layer.sides || 6)}
                                    fill={layer.fill || '#0B7C91'}
                                    stroke={layer.stroke || 'transparent'}
                                    strokeWidth={layer.strokeWidth || 0}
                                />
                            )}

                            {/* Shape: Star */}
                            {layer.type === 'star' && (
                                <path
                                    d={generateStarPath(
                                        lw / 2,
                                        lh / 2,
                                        Math.min(lw, lh) / 2,
                                        (Math.min(lw, lh) / 2) * (layer.innerRatio || 0.45),
                                        layer.points || 5
                                    )}
                                    fill={layer.fill || '#00E5FF'}
                                    stroke={layer.stroke || 'transparent'}
                                    strokeWidth={layer.strokeWidth || 0}
                                />
                            )}

                            {/* Shape: Vector Path (Pen / Pencil / Booleans) */}
                            {layer.type === 'vector' && (
                                <path
                                    d={layer.pathD}
                                    fill={layer.fill || 'transparent'}
                                    fillRule={layer.fillRule || 'nonzero'}
                                    stroke={layer.stroke || '#00E5FF'}
                                    strokeWidth={layer.strokeWidth || 2}
                                    strokeLinecap={layer.strokeCap || 'round'}
                                    strokeLinejoin={layer.strokeJoin || 'round'}
                                />
                            )}

                            {/* Layer: Text */}
                            {layer.type === 'text' && (
                                <text
                                    x={layer.textAlign === 'center' ? lw / 2 : layer.textAlign === 'right' ? lw : 0}
                                    y={Number(layer.fontSize || 32)}
                                    fill={layer.fill || '#EDEAE3'}
                                    fontFamily={layer.fontFamily || 'Plus Jakarta Sans'}
                                    fontSize={layer.fontSize || 32}
                                    fontWeight={layer.fontWeight || 700}
                                    letterSpacing={layer.letterSpacing !== undefined ? `${layer.letterSpacing}px` : undefined}
                                    textAnchor={layer.textAlign === 'center' ? 'middle' : layer.textAlign === 'right' ? 'end' : 'start'}
                                    textDecoration={layer.textDecoration || 'none'}
                                    style={{
                                        userSelect: 'none',
                                        textTransform: layer.textTransform || 'none',
                                    }}
                                >
                                    {(layer.text || '').split('\n').map((line, idx) => (
                                        <tspan
                                            key={idx}
                                            x={layer.textAlign === 'center' ? lw / 2 : layer.textAlign === 'right' ? lw : 0}
                                            dy={idx === 0 ? 0 : `${Number(layer.fontSize || 32) * (layer.lineHeight || 1.15)}px`}
                                        >
                                            {line}
                                        </tspan>
                                    ))}
                                </text>
                            )}

                            {/* Layer: Image Fill */}
                            {layer.type === 'image' && layer.src && (
                                <image
                                    href={layer.src}
                                    width={lw}
                                    height={lh}
                                    preserveAspectRatio={layer.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice'}
                                />
                            )}

                            {/* Layer: Duration / Pill Badge */}
                            {layer.type === 'badge' && (
                                <g>
                                    <rect
                                        width={lw}
                                        height={lh}
                                        rx={layer.cornerRadius || 6}
                                        fill={layer.fill || '#C85A17'}
                                    />
                                    <text
                                        x={lw / 2}
                                        y={lh / 2 + 4}
                                        fill="#FFFFFF"
                                        fontSize={12}
                                        fontFamily="JetBrains Mono"
                                        fontWeight={700}
                                        textAnchor="middle"
                                    >
                                        {layer.text || '0:30'}
                                    </text>
                                </g>
                            )}
                        </g>
                    );
                })}

                {/* Live Drawing Shape Preview */}
                {interaction === 'drawing' && drawingShape && (
                    <rect
                        x={Math.min(drawingShape.startX, drawingShape.currentX)}
                        y={Math.min(drawingShape.startY, drawingShape.currentY)}
                        width={Math.abs(drawingShape.currentX - drawingShape.startX)}
                        height={Math.abs(drawingShape.currentY - drawingShape.startY)}
                        fill="rgba(0, 229, 255, 0.15)"
                        stroke="#00E5FF"
                        strokeWidth={1.5}
                        strokeDasharray="4,4"
                    />
                )}

                {/* Live Pencil Freehand Preview */}
                {interaction === 'pencil' && pencilPoints.length > 1 && (
                    <path
                        d={simplifyFreehandPath(pencilPoints)}
                        fill="transparent"
                        stroke="#00E5FF"
                        strokeWidth={3}
                        strokeLinecap="round"
                    />
                )}

                {/* Live Pen Tool Anchors Preview */}
                {activeTool === 'pen' && penAnchors.length > 0 && (
                    <g>
                        <path
                            d={generateBézierPath(penAnchors, false)}
                            fill="transparent"
                            stroke="#00E5FF"
                            strokeWidth={2}
                            strokeDasharray="4,4"
                        />
                        {penAnchors.map((anc, idx) => (
                            <circle
                                key={idx}
                                cx={anc.x}
                                cy={anc.y}
                                r={5}
                                fill="#00E5FF"
                                stroke="#0D0F12"
                                strokeWidth={2}
                            />
                        ))}
                    </g>
                )}

                {/* Selection Marquee Box */}
                {interaction === 'marquee' && marquee && (
                    <rect
                        x={Math.min(marquee.startX, marquee.currentX)}
                        y={Math.min(marquee.startY, marquee.currentY)}
                        width={Math.abs(marquee.currentX - marquee.startX)}
                        height={Math.abs(marquee.currentY - marquee.startY)}
                        fill="rgba(11, 124, 145, 0.15)"
                        stroke="#0B7C91"
                        strokeWidth={1}
                        strokeDasharray="4,4"
                    />
                )}

                {/* Selection Bounding Box & Transform Handles */}
                {selectionBounds && selectedLayers.length > 0 && (
                    <g transform={`translate(${selectionBounds.x}, ${selectionBounds.y})`}>
                        {/* Layer Label Pill (Image 5 Inspiration) */}
                        {selectedLayers[0] && (
                            <g transform="translate(0, -22)">
                                <rect
                                    x={0}
                                    y={0}
                                    width={Math.min(220, Math.max(64, (selectedLayers[0].name || selectedLayers[0].id).length * 7.5 + 16))}
                                    height={18}
                                    rx={4}
                                    fill="#0B7C91"
                                />
                                <text
                                    x={8}
                                    y={12.5}
                                    fill="#FFFFFF"
                                    fontSize={10}
                                    fontFamily="Plus Jakarta Sans"
                                    fontWeight={600}
                                >
                                    {selectedLayers[0].name || selectedLayers[0].id}
                                </text>
                            </g>
                        )}

                        {/* Outer Selection Border */}
                        <rect
                            x={0}
                            y={0}
                            width={selectionBounds.w}
                            height={selectionBounds.h}
                            fill="none"
                            stroke="#0B7C91"
                            strokeWidth={1.5}
                            pointerEvents="none"
                        />

                        {/* 8 Resize Handles (Corner & Edge) */}
                        {[
                            { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
                            { id: 'n', x: selectionBounds.w / 2, y: 0, cursor: 'ns-resize' },
                            { id: 'ne', x: selectionBounds.w, y: 0, cursor: 'nesw-resize' },
                            { id: 'e', x: selectionBounds.w, y: selectionBounds.h / 2, cursor: 'ew-resize' },
                            { id: 'se', x: selectionBounds.w, y: selectionBounds.h, cursor: 'nwse-resize' },
                            { id: 's', x: selectionBounds.w / 2, y: selectionBounds.h, cursor: 'ns-resize' },
                            { id: 'sw', x: 0, y: selectionBounds.h, cursor: 'nesw-resize' },
                            { id: 'w', x: 0, y: selectionBounds.h / 2, cursor: 'ew-resize' },
                        ].map(h => (
                            <rect
                                key={h.id}
                                x={h.x - 4}
                                y={h.y - 4}
                                width={8}
                                height={8}
                                fill="#FFFFFF"
                                stroke="#0B7C91"
                                strokeWidth={1.5}
                                style={{ cursor: h.cursor }}
                                onPointerDown={(e) => handleResizeHandleDown(e, h.id)}
                            />
                        ))}

                        {/* Top Rotation Handle */}
                        <g transform={`translate(${selectionBounds.w / 2}, -20)`}>
                            <line x1={0} y1={0} x2={0} y2={20} stroke="#0B7C91" strokeWidth={1} />
                            <circle
                                cx={0}
                                cy={0}
                                r={4.5}
                                fill="#FFFFFF"
                                stroke="#0B7C91"
                                strokeWidth={1.5}
                                style={{ cursor: 'grab' }}
                                onPointerDown={handleRotationHandleDown}
                            />
                        </g>

                        {/* Smart Selection & Spacing Handle (when 2+ elements selected) */}
                        {selectedLayers.length >= 2 && (
                            <g
                                transform={`translate(${selectionBounds.w / 2}, ${selectionBounds.h + 16})`}
                                style={{ cursor: 'pointer' }}
                                onClick={handleSmartSpacingClick}
                            >
                                <rect
                                    x={-44}
                                    y={-10}
                                    width={88}
                                    height={20}
                                    rx={10}
                                    fill="#0B7C91"
                                />
                                <text
                                    x={0}
                                    y={3.5}
                                    fill="#FFFFFF"
                                    fontSize={10}
                                    fontFamily="Plus Jakarta Sans"
                                    fontWeight={700}
                                    textAnchor="middle"
                                >
                                    Tidy Spacing
                                </text>
                            </g>
                        )}
                    </g>
                )}
            </svg>
            </div>

            {/* Floating Bottom Canvas Controls (Images 1 & 3 Inspiration) */}
            <div style={{
                position: 'absolute',
                bottom: '16px',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '999px',
                padding: '4px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                zIndex: 10,
            }}>
                <button
                    type="button"
                    onClick={() => setActiveTool(activeTool === 'hand' ? 'select' : 'hand')}
                    style={{
                        padding: '4px 8px',
                        background: activeTool === 'hand' ? '#F0F9FB' : 'transparent',
                        color: activeTool === 'hand' ? '#0B7C91' : '#64748B',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 600,
                    }}
                >
                    Pan
                </button>
                <div style={{ width: '1px', height: '14px', background: '#E2E8F0' }} />
                <button
                    type="button"
                    onClick={() => {
                        setPan({ x: 0, y: 0 });
                        if (setZoom) setZoom(0.75);
                    }}
                    title="Reset canvas pan and zoom"
                    style={{
                        padding: '4px 8px',
                        background: 'transparent',
                        color: '#64748B',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '11px',
                        fontWeight: 500,
                    }}
                >
                    Reset View
                </button>
                <div style={{ width: '1px', height: '14px', background: '#E2E8F0' }} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#1E293B', minWidth: '36px', textAlign: 'center' }}>
                    {Math.round(zoom * 100)}%
                </span>
            </div>
        </div>
    );
}
