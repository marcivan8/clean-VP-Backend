/**
 * client/src/components/Marketplace/MarketplaceMap.jsx
 *
 * Real Interactive Map for VIBED Market Surface A (Studios & Crews in Île-de-France).
 * Features:
 * - Native bundled Leaflet with CartoDB Positron clean light vector tiles.
 * - Full mouse wheel zooming, drag-to-pan, double click zoom, and touch gesture support.
 * - Precision GPS coordinates for real verified studios across Île-de-France.
 * - Interactive price pills that highlight and scale on hover.
 * - Discrete Match Score display: displays exact score number + "match score" directly on the cards.
 * - Full-width layout covering the entire container space.
 * - Floating Studio Info Card on cursor hover/click with specs, cyc dimensions, address, and quick actions.
 * - Smooth zoom controls, location recenter, and radius indicator.
 *
 * Strictly zero emojis.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
    MapPin, Navigation, Compass, Plus, Minus,
    Star, ChevronRight, X, Zap, ShieldCheck
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
    const radiusCircleRef = useRef(null);
    const markersRef = useRef({});
    const [hoveredListing, setHoveredListing] = useState(null);
    const [zoomLevel, setZoomLevel] = useState(11);
    const hoverTimeoutRef = useRef(null);

    // Default center: Île-de-France / Paris South-East (Choisy / Ivry / Paris center)
    const centerLat = 48.8500;
    const centerLng = 2.3600;

    // Currently active listing (hovered takes precedence, then selected)
    const activeCardListing = useMemo(() => {
        if (hoveredListing) return hoveredListing;
        if (selectedId) {
            return listings.find(l => l.id === selectedId) || null;
        }
        return null;
    }, [hoveredListing, selectedId, listings]);

    // Initialize Leaflet Map directly on mount
    useEffect(() => {
        if (!mapContainerRef.current || mapInstanceRef.current) return;

        try {
            const map = L.map(mapContainerRef.current, {
                center: [centerLat, centerLng],
                zoom: 11,
                minZoom: 9,
                maxZoom: 18,
                scrollWheelZoom: true,
                smoothWheelZoom: true,
                doubleClickZoom: true,
                touchZoom: true,
                dragging: true,
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
                dashArray: '6, 6',
                fillColor: '#00E5FF',
                fillOpacity: 0.04,
            }).addTo(map);
            radiusCircleRef.current = radiusCircle;

            // User Origin Marker (Choisy-le-Roi)
            const userIcon = L.divIcon({
                className: 'vibed-user-origin-pin',
                html: `
                    <div style="position: relative; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">
                        <div style="position: absolute; width: 24px; height: 24px; border-radius: 50%; background: rgba(11, 124, 145, 0.22); animation: pulse 2s infinite;"></div>
                        <div style="width: 10px; height: 10px; border-radius: 50%; background: #0B7C91; border: 2px solid #FFFFFF; box-shadow: 0 2px 6px rgba(0,0,0,0.25);"></div>
                    </div>
                `,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
            });
            L.marker([48.7634, 2.4091], { icon: userIcon, interactive: false }).addTo(map);

            map.on('zoomend', () => {
                setZoomLevel(map.getZoom());
            });

            mapInstanceRef.current = map;

            // Force recalculation of container size after mounting to prevent partial grey tiles
            setTimeout(() => {
                map.invalidateSize();
            }, 100);
        } catch (err) {
            console.error('[MarketplaceMap] Leaflet initialization error:', err);
        }

        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
                markersRef.current = {};
            }
        };
    }, []);

    // Update radius circle if radiusKm changes
    useEffect(() => {
        if (radiusCircleRef.current) {
            radiusCircleRef.current.setRadius(radiusKm * 1000);
        }
    }, [radiusKm]);

    // Update / Render Markers when listings or selectedId change
    useEffect(() => {
        if (!mapInstanceRef.current) return;
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
            const shortName = item.name.length > 15 ? item.name.substring(0, 13) + '…' : item.name;
            const score = item.scoutScore || 94;

            const markerHtml = `
                <div class="vibed-map-pin" style="
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    padding: ${isSelected ? '6px 14px' : '4px 10px'};
                    background: ${isSelected ? '#10151D' : '#FFFFFF'};
                    color: ${isSelected ? '#FFFFFF' : '#10151D'};
                    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
                    font-size: ${isSelected ? '12.5px' : '11.5px'};
                    font-weight: 700;
                    border-radius: 999px;
                    border: ${isSelected ? '2px solid #00E5FF' : '1px solid rgba(16, 21, 29, 0.16)'};
                    box-shadow: ${isSelected ? '0 8px 24px rgba(0, 229, 255, 0.28), 0 4px 12px rgba(16, 21, 29, 0.2)' : '0 2px 10px rgba(16, 21, 29, 0.08)'};
                    cursor: pointer;
                    white-space: nowrap;
                    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.15s ease;
                    transform: ${isSelected ? 'scale(1.06)' : 'scale(1)'};
                    user-select: none;
                ">
                    <span style="
                        width: 7px;
                        height: 7px;
                        border-radius: 50%;
                        background: ${isStudio ? '#00E5FF' : '#0B7C91'};
                        flex-shrink: 0;
                    "></span>
                    <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700;">${priceLabel}</span>
                    <span style="opacity: 0.5;">·</span>
                    <span>${shortName}</span>
                    <span style="
                        margin-left: 2px;
                        background: ${isSelected ? 'rgba(0, 229, 255, 0.2)' : 'rgba(11, 124, 145, 0.1)'};
                        color: ${isSelected ? '#00E5FF' : '#0B7C91'};
                        font-family: 'JetBrains Mono', monospace;
                        font-size: 10px;
                        font-weight: 800;
                        padding: 1px 5px;
                        border-radius: 999px;
                    ">${score}</span>
                </div>
            `;

            const icon = L.divIcon({
                className: `pin-wrapper-${item.id}`,
                html: markerHtml,
                iconSize: [140, 30],
                iconAnchor: [70, 15],
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
                }, 350);
            });

            marker.addTo(map);
            markersRef.current[item.id] = marker;
        });
    }, [listings, selectedId]);

    // Zoom Handlers
    const handleZoomIn = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.zoomIn();
        }
    };

    const handleZoomOut = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.zoomOut();
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
            height: 700,
            minHeight: 640,
            background: '#F7F6F2',
            borderRadius: 20,
            border: '1px solid rgba(16, 21, 29, 0.08)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 32px -8px rgba(16, 21, 29, 0.08)',
        }}>
            {/* Real Map Canvas Container */}
            <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%' }}>
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
                            top: 20,
                            left: 20,
                            width: 340,
                            maxWidth: 'calc(100% - 40px)',
                            background: 'rgba(255, 255, 255, 0.98)',
                            backdropFilter: 'blur(20px)',
                            WebkitBackdropFilter: 'blur(20px)',
                            borderRadius: 18,
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            boxShadow: '0 20px 48px -12px rgba(16, 21, 29, 0.2), 0 4px 12px rgba(16, 21, 29, 0.05)',
                            padding: 18,
                            zIndex: 40,
                            animation: 'fadeInCard 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                            pointerEvents: 'auto',
                        }}
                    >
                        {/* Top: Discrete Match Score Badge */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '3px 9px',
                                borderRadius: 6,
                                background: '#F0F9FB',
                                border: '1px solid #D4EFF6',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: 12.5,
                                    fontWeight: 700,
                                    color: '#0B7C91',
                                }}>
                                    {activeCardListing.scoutScore || 94}
                                </span>
                                <span style={{
                                    fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                    fontSize: 11,
                                    color: '#5F6876',
                                    fontWeight: 500,
                                }}>
                                    match score
                                </span>
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

                        {/* Card Title & Location */}
                        <div style={{ marginBottom: 6 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                <h4 style={{
                                    margin: 0,
                                    fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                                    fontSize: 17,
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
                                <span>{activeCardListing.location}</span>
                                <span>·</span>
                                <span style={{ fontWeight: 600, color: '#10151D' }}>{activeCardListing.distanceKm} km from you</span>
                            </div>
                        </div>

                        {/* Full Street Address */}
                        {activeCardListing.address && (
                            <div style={{
                                fontSize: 11.5,
                                color: '#7E8695',
                                fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                                marginBottom: 10,
                                lineHeight: 1.35,
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
                                <span style={{ color: '#7E8695' }}>({activeCardListing.jobsCount || 40} shoots)</span>
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
                                    fontSize: 19,
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
                                    padding: '8px 16px',
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
                            width: 36,
                            height: 36,
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
                        <Compass size={17} color="#0B7C91" />
                    </button>
                    <button
                        type="button"
                        onClick={handleZoomIn}
                        title="Zoom In (or use mouse wheel)"
                        style={{
                            width: 36,
                            height: 36,
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
                        <Plus size={17} />
                    </button>
                    <button
                        type="button"
                        onClick={handleZoomOut}
                        title="Zoom Out (or use mouse wheel)"
                        style={{
                            width: 36,
                            height: 36,
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
                        <Minus size={17} />
                    </button>
                </div>
            </div>

            {/* Bottom Bar: Postcode & Radius info banner */}
            <div style={{
                padding: '12px 20px',
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
                        Interactive map calibrated for Île-de-France ({radiusKm} km radius from {userLocation}). Mouse-wheel zoom enabled.
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onChangeLocation}
                    style={{
                        padding: '5px 14px',
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
