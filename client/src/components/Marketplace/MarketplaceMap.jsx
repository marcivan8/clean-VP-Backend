/**
 * client/src/components/Marketplace/MarketplaceMap.jsx
 *
 * Real Interactive Map for VIBED Market Surface A (Studios & Crews in Île-de-France).
 * Features:
 * - Dynamic Leaflet / CartoDB Positron light vector tiles (clean warm grayscale, no API key needed).
 * - Instant fallback vector cartography for Paris & Greater Île-de-France.
 * - Precision GPS coordinates for real verified studios across Île-de-France.
 * - Interactive price pills that highlight and scale on hover.
 * - Elevated Floating Studio Info Card on cursor hover/click with specs, cyc dimensions, address, and quick actions.
 * - Smooth zoom controls, location recenter, and radius indicator.
 *
 * Strictly zero emojis.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
    MapPin, Navigation, Compass, Layers, Plus, Minus,
    ShieldCheck, CheckCircle2, ArrowRight, Clock, Star,
    ExternalLink, Zap, ChevronRight, X
} from 'lucide-react';

export default function MarketplaceMap({
    listings = [],
    selectedId = null,
    onSelectListing = () => {},
    radiusKm = 25,
    userLocation = 'Choisy-le-Roi',
    onChangeLocation = () => {},
    onQuickBook = () => {},
}) {
    const mapContainerRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markersRef = useRef({});
    const [leafletReady, setLeafletReady] = useState(false);
    const [hoveredListing, setHoveredListing] = useState(null);
    const [zoomLevel, setZoomLevel] = useState(11);
    const hoverTimeoutRef = useRef(null);

    // Default center: Île-de-France / Paris South-East (Choisy / Ivry / Paris center)
    const centerLat = 48.8450;
    const centerLng = 2.3700;

    // Currently active listing (hovered takes precedence, then selected)
    const activeCardListing = useMemo(() => {
        if (hoveredListing) return hoveredListing;
        if (selectedId) {
            return listings.find(l => l.id === selectedId) || null;
        }
        return null;
    }, [hoveredListing, selectedId, listings]);

    // Dynamically inject Leaflet CSS & JS
    useEffect(() => {
        let isMounted = true;

        if (typeof window === 'undefined') return;

        // Inject Leaflet CSS if missing
        if (!document.getElementById('leaflet-css-vibed')) {
            const link = document.createElement('link');
            link.id = 'leaflet-css-vibed';
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);
        }

        // If Leaflet is already loaded
        if (window.L) {
            if (isMounted) setLeafletReady(true);
            return;
        }

        // Inject Leaflet JS
        if (!document.getElementById('leaflet-js-vibed')) {
            const script = document.createElement('script');
            script.id = 'leaflet-js-vibed';
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.async = true;
            script.onload = () => {
                if (isMounted) setLeafletReady(true);
            };
            script.onerror = () => {
                console.warn('[MarketplaceMap] Could not load Leaflet CDN, using precision vector fallback.');
            };
            document.head.appendChild(script);
        } else {
            const existingScript = document.getElementById('leaflet-js-vibed');
            existingScript.addEventListener('load', () => {
                if (isMounted) setLeafletReady(true);
            });
        }

        return () => {
            isMounted = false;
        };
    }, []);

    // Initialize Leaflet Map
    useEffect(() => {
        if (!leafletReady || !mapContainerRef.current || mapInstanceRef.current || !window.L) {
            return;
        }

        try {
            const L = window.L;
            const map = L.map(mapContainerRef.current, {
                center: [centerLat, centerLng],
                zoom: 11,
                minZoom: 9,
                maxZoom: 16,
                zoomControl: false,
                attributionControl: false,
            });

            // CartoDB Positron: clean warm/light minimalist tile set matching VIBED's design system
            L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                subdomains: 'abcd',
                maxZoom: 19,
            }).addTo(map);

            // Radius Circle around user location (Choisy-le-Roi: 48.7634, 2.4091)
            const radiusCircle = L.circle([48.7634, 2.4091], {
                radius: radiusKm * 1000,
                color: '#0B7C91',
                weight: 1.5,
                dashArray: '5, 5',
                fillColor: '#00E5FF',
                fillOpacity: 0.04,
            }).addTo(map);

            // User Origin Marker (Choisy-le-Roi)
            const userIcon = L.divIcon({
                className: 'vibed-user-origin-pin',
                html: `
                    <div style="position: relative; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;">
                        <div style="position: absolute; width: 22px; height: 22px; border-radius: 50%; background: rgba(11, 124, 145, 0.2); animation: pulse 2s infinite;"></div>
                        <div style="width: 10px; height: 10px; border-radius: 50%; background: #0B7C91; border: 2px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.25);"></div>
                    </div>
                `,
                iconSize: [22, 22],
                iconAnchor: [11, 11],
            });
            L.marker([48.7634, 2.4091], { icon: userIcon, interactive: false }).addTo(map);

            map.on('zoomend', () => {
                setZoomLevel(map.getZoom());
            });

            mapInstanceRef.current = map;
        } catch (err) {
            console.warn('[MarketplaceMap] Leaflet initialization failed:', err);
        }

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
                markersRef.current = {};
            }
        };
    }, [leafletReady]);

    // Update / Render Markers when listings or selectedId change
    useEffect(() => {
        if (!mapInstanceRef.current || !window.L) return;
        const L = window.L;
        const map = mapInstanceRef.current;

        // Clear existing markers
        Object.values(markersRef.current).forEach(marker => marker.remove());
        markersRef.current = {};

        // Add markers for all listings with coordinates
        listings.forEach(item => {
            if (!item.lat || !item.lng) return;

            const isSelected = selectedId === item.id;
            const isStudio = item.type === 'studio';
            const priceLabel = `€${item.priceHalfDay}`;
            const shortName = item.name.length > 14 ? item.name.substring(0, 12) + '…' : item.name;

            const markerHtml = `
                <div class="vibed-map-pin" style="
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: ${isSelected ? '6px 12px' : '4px 10px'};
                    background: ${isSelected ? '#10151D' : '#FFFFFF'};
                    color: ${isSelected ? '#FFFFFF' : '#10151D'};
                    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: ${isSelected ? '12.5px' : '11.5px'};
                    font-weight: 700;
                    border-radius: 999px;
                    border: ${isSelected ? '2px solid #00E5FF' : '1px solid rgba(16, 21, 29, 0.15)'};
                    box-shadow: ${isSelected ? '0 8px 24px rgba(0, 229, 255, 0.25), 0 4px 12px rgba(16, 21, 29, 0.18)' : '0 2px 10px rgba(16, 21, 29, 0.08)'};
                    cursor: pointer;
                    white-space: nowrap;
                    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
                    transform-origin: center;
                ">
                    <span style="
                        width: 7px;
                        height: 7px;
                        border-radius: 50%;
                        background: ${isStudio ? '#00E5FF' : '#0B7C91'};
                        flex-shrink: 0;
                    "></span>
                    <span style="font-family: 'JetBrains Mono', monospace; font-weight: 600;">${priceLabel}</span>
                    <span style="opacity: 0.7; font-weight: 500; font-size: 11px;">·</span>
                    <span>${shortName}</span>
                </div>
            `;

            const icon = L.divIcon({
                className: `pin-wrapper-${item.id}`,
                html: markerHtml,
                iconSize: [120, 28],
                iconAnchor: [60, 14],
            });

            const marker = L.marker([item.lat, item.lng], { icon, riseOnHover: true });

            marker.on('click', () => {
                onSelectListing(item.id);
                setHoveredListing(item);
            });

            marker.on('mouseover', () => {
                if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                setHoveredListing(item);
            });

            marker.on('mouseout', () => {
                hoverTimeoutRef.current = setTimeout(() => {
                    setHoveredListing(null);
                }, 300);
            });

            marker.addTo(map);
            markersRef.current[item.id] = marker;
        });
    }, [listings, selectedId, leafletReady]);

    // Zoom Handlers
    const handleZoomIn = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.zoomIn();
        } else {
            setZoomLevel(z => Math.min(z + 1, 15));
        }
    };

    const handleZoomOut = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.zoomOut();
        } else {
            setZoomLevel(z => Math.max(z - 1, 9));
        }
    };

    const handleResetCenter = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.setView([centerLat, centerLng], 11, { animate: true });
        }
    };

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            minHeight: 620,
            background: '#F7F6F2',
            borderRadius: 20,
            border: '1px solid rgba(16, 21, 29, 0.08)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 30px -10px rgba(16, 21, 29, 0.08)',
        }}>
            {/* Real Map Canvas Container */}
            <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%', minHeight: 560 }}>
                {/* Leaflet DOM Node */}
                <div
                    ref={mapContainerRef}
                    style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        zIndex: 1,
                    }}
                />

                {/* Precision Vector Fallback (displayed if Leaflet is loading or offline) */}
                {!leafletReady && (
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'linear-gradient(180deg, #F5F7FA 0%, #EBF0F5 100%)',
                        zIndex: 0,
                    }}>
                        <svg
                            viewBox="0 0 500 500"
                            preserveAspectRatio="xMidYMid meet"
                            style={{ width: '100%', height: '100%', display: 'block' }}
                        >
                            <defs>
                                <linearGradient id="fallbackRiver" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stopColor="#D4E4ED" stopOpacity="0.8" />
                                    <stop offset="100%" stopColor="#C4D8E2" stopOpacity="0.9" />
                                </linearGradient>
                            </defs>
                            {/* Grid lines */}
                            <g opacity="0.35">
                                <line x1="100" y1="0" x2="100" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                                <line x1="250" y1="0" x2="250" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                                <line x1="400" y1="0" x2="400" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                                <line x1="0" y1="150" x2="500" y2="150" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                                <line x1="0" y1="300" x2="500" y2="300" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                                <line x1="0" y1="420" x2="500" y2="420" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                            </g>
                            {/* Seine River curve */}
                            <path
                                d="M -20,230 C 120,210 180,270 280,285 C 380,305 440,240 520,220 L 520,250 C 440,270 380,335 280,315 C 180,295 120,235 -20,255 Z"
                                fill="url(#fallbackRiver)"
                            />
                            {/* User Radius */}
                            <circle cx="250" cy="280" r="170" fill="rgba(11, 124, 145, 0.04)" stroke="#0B7C91" strokeWidth="1.5" strokeDasharray="4 4" />
                            <circle cx="250" cy="280" r="5" fill="#0B7C91" />
                        </svg>

                        {/* Interactive Pins Overlay for Fallback */}
                        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                            {listings.map(item => {
                                const isSelected = selectedId === item.id;
                                const isHovered = hoveredListing?.id === item.id;
                                const pin = item.mapPin || { x: 50, y: 50, label: `€${item.priceHalfDay}` };

                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => onSelectListing(item.id)}
                                        onMouseEnter={() => {
                                            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                                            setHoveredListing(item);
                                        }}
                                        onMouseLeave={() => {
                                            hoverTimeoutRef.current = setTimeout(() => setHoveredListing(null), 300);
                                        }}
                                        style={{
                                            position: 'absolute',
                                            left: `${pin.x}%`,
                                            top: `${pin.y}%`,
                                            transform: 'translate(-50%, -50%)',
                                            pointerEvents: 'auto',
                                            cursor: 'pointer',
                                            zIndex: isSelected ? 30 : isHovered ? 25 : 10,
                                        }}
                                    >
                                        <div style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: isSelected ? '6px 12px' : '4px 10px',
                                            background: isSelected ? '#10151D' : isHovered ? '#10151D' : '#FFFFFF',
                                            color: (isSelected || isHovered) ? '#FFFFFF' : '#10151D',
                                            fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            borderRadius: 999,
                                            border: isSelected ? '2px solid #00E5FF' : '1px solid rgba(16, 21, 29, 0.15)',
                                            boxShadow: isSelected
                                                ? '0 6px 18px rgba(0, 229, 255, 0.25)'
                                                : '0 2px 8px rgba(0,0,0,0.08)',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            <span style={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: '50%',
                                                background: '#00E5FF',
                                            }} />
                                            <span>€{item.priceHalfDay}</span>
                                            <span style={{ opacity: 0.6 }}>·</span>
                                            <span>{item.name}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Floating Studio Info Card on Hover/Selection */}
                {activeCardListing && (
                    <div
                        onMouseEnter={() => {
                            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
                        }}
                        onMouseLeave={() => {
                            setHoveredListing(null);
                        }}
                        style={{
                            position: 'absolute',
                            top: 16,
                            left: 16,
                            width: 320,
                            maxWidth: 'calc(100% - 32px)',
                            background: 'rgba(255, 255, 255, 0.98)',
                            backdropFilter: 'blur(16px)',
                            WebkitBackdropFilter: 'blur(16px)',
                            borderRadius: 16,
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            boxShadow: '0 16px 40px -10px rgba(16, 21, 29, 0.18), 0 4px 12px rgba(16, 21, 29, 0.05)',
                            padding: 16,
                            zIndex: 40,
                            animation: 'fadeInCard 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                            pointerEvents: 'auto',
                        }}
                    >
                        {/* Card Header: Studio Name & Close button */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 6 }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                    <h4 style={{
                                        margin: 0,
                                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                        fontSize: 16,
                                        fontWeight: 800,
                                        color: '#10151D',
                                        letterSpacing: '-0.02em',
                                    }}>
                                        {activeCardListing.name}
                                    </h4>
                                    <span style={{
                                        background: '#E6F8F9',
                                        color: '#0B7C91',
                                        fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                        fontSize: 10,
                                        fontWeight: 700,
                                        padding: '2px 6px',
                                        borderRadius: 999,
                                    }}>
                                        PRO
                                    </span>
                                </div>
                                <div style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 12,
                                    color: '#5F6876',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                }}>
                                    <MapPin size={12} color="#0B7C91" />
                                    <span>{activeCardListing.location || activeCardListing.address}</span>
                                    <span>·</span>
                                    <span style={{ fontWeight: 600, color: '#10151D' }}>{activeCardListing.distanceKm} km</span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setHoveredListing(null)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#8E95A2',
                                    cursor: 'pointer',
                                    padding: 2,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                <X size={15} />
                            </button>
                        </div>

                        {/* Full Address details */}
                        {activeCardListing.address && (
                            <div style={{
                                fontSize: 11,
                                color: '#7E8695',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                marginBottom: 10,
                                lineHeight: 1.3,
                            }}>
                                {activeCardListing.address}
                            </div>
                        )}

                        {/* Cyclorama / Technical Dimensions Badge */}
                        {activeCardListing.dimensions && (
                            <div style={{
                                background: '#F4F6F8',
                                border: '1px solid rgba(16, 21, 29, 0.06)',
                                borderRadius: 8,
                                padding: '6px 10px',
                                fontSize: 12,
                                color: '#10151D',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                fontWeight: 500,
                                marginBottom: 10,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                            }}>
                                <Zap size={13} color="#0B7C91" />
                                <span>{activeCardListing.dimensions}</span>
                            </div>
                        )}

                        {/* Rating, Jobs and Reply Metrics */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 0',
                            borderTop: '1px solid rgba(16, 21, 29, 0.06)',
                            borderBottom: '1px solid rgba(16, 21, 29, 0.06)',
                            marginBottom: 12,
                            fontSize: 12,
                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Star size={13} fill="#0B7C91" color="#0B7C91" />
                                <span style={{ fontWeight: 700, color: '#10151D' }}>
                                    {typeof activeCardListing.rating === 'number' ? activeCardListing.rating.toFixed(2) : activeCardListing.rating}
                                </span>
                                <span style={{ color: '#7E8695' }}>({activeCardListing.jobsCount || 20} shoots)</span>
                            </div>
                            <div style={{
                                fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                fontSize: 11,
                                color: '#0F7A52',
                                fontWeight: 600,
                            }}>
                                {activeCardListing.replyTime || 'replies in 30 min'}
                            </div>
                        </div>

                        {/* Pricing & Call to Action Footer */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <div>
                                <div style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 18,
                                    fontWeight: 700,
                                    color: '#10151D',
                                    lineHeight: 1,
                                }}>
                                    €{activeCardListing.priceHalfDay}
                                </div>
                                <div style={{ fontSize: 10.5, color: '#7E8695', fontFamily: 'var(--f-sans, "Geist", sans-serif)' }}>
                                    half-day · all in
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => onSelectListing(activeCardListing.id)}
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '8px 14px',
                                    borderRadius: 999,
                                    background: '#10151D',
                                    color: '#FFFFFF',
                                    border: 'none',
                                    fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(16, 21, 29, 0.15)',
                                    transition: 'all 0.15s ease',
                                }}
                            >
                                <span>View listing</span>
                                <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Top Right Map Controls: Compass / Recenter, Zoom In, Zoom Out */}
                <div style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    zIndex: 25,
                }}>
                    <button
                        type="button"
                        onClick={handleResetCenter}
                        title="Recenter Map"
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: '#FFFFFF',
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#10151D',
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <Compass size={16} color="#0B7C91" />
                    </button>
                    <button
                        type="button"
                        onClick={handleZoomIn}
                        title="Zoom In"
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: '#FFFFFF',
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#10151D',
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <Plus size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={handleZoomOut}
                        title="Zoom Out"
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            background: '#FFFFFF',
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#10151D',
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <Minus size={16} />
                    </button>
                </div>
            </div>

            {/* Bottom Bar: Postcode & Radius info banner */}
            <div style={{
                padding: '12px 18px',
                background: '#FFFFFF',
                borderTop: '1px solid rgba(16, 21, 29, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                zIndex: 25,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MapPin size={15} color="#0B7C91" />
                    <span style={{
                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                        fontSize: 12,
                        color: '#5F6876',
                    }}>
                        Interactive map calibrated for Île-de-France ({radiusKm} km radius from {userLocation}).
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onChangeLocation}
                    style={{
                        padding: '5px 12px',
                        borderRadius: 999,
                        background: '#EDF0F4',
                        border: '1px solid rgba(16, 21, 29, 0.08)',
                        color: '#10151D',
                        fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                    }}
                >
                    Change origin
                </button>
            </div>
        </div>
    );
}
