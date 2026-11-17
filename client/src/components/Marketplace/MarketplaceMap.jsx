/**
 * client/src/components/Marketplace/MarketplaceMap.jsx
 *
 * Vector SVG interactive map for VIBED Market Surface A.
 * Recreates the geographic radius, pin pills, and distance contours
 * from screen "03 · Discover (map + Scout).png".
 *
 * Strictly zero emojis.
 */

import React, { useState } from 'react';
import { MapPin, Navigation, Compass, Layers, Maximize2 } from 'lucide-react';

export default function MarketplaceMap({
    listings = [],
    selectedId = null,
    onSelectListing = () => {},
    radiusKm = 25,
    userLocation = 'Choisy-le-Roi',
    onChangeLocation = () => {},
}) {
    const [mapMode, setMapMode] = useState('default'); // 'default' | 'draw' | 'travel30'
    const [hoveredId, setHoveredId] = useState(null);

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            minHeight: 580,
            background: 'linear-gradient(180deg, #F0F4F8 0%, #E9EFF5 100%)',
            borderRadius: 16,
            border: '1px solid rgba(16, 21, 29, 0.08)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 4px 20px -8px rgba(16, 21, 29, 0.06)',
        }}>
            {/* Map Canvas SVG */}
            <div style={{ position: 'relative', flex: 1, width: '100%', height: '100%' }}>
                <svg
                    viewBox="0 0 500 500"
                    preserveAspectRatio="xMidYMid meet"
                    style={{ width: '100%', height: '100%', display: 'block' }}
                >
                    <defs>
                        {/* River / Seine Gradient */}
                        <linearGradient id="riverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#D4E4ED" stopOpacity="0.75" />
                            <stop offset="100%" stopColor="#C4D8E2" stopOpacity="0.85" />
                        </linearGradient>

                        {/* Radial Radius Glow */}
                        <radialGradient id="radiusGlow" cx="50%" cy="50%" r="50%">
                            <stop offset="0%" stopColor="rgba(11, 124, 145, 0.06)" />
                            <stop offset="70%" stopColor="rgba(11, 124, 145, 0.03)" />
                            <stop offset="100%" stopColor="rgba(11, 124, 145, 0.00)" />
                        </radialGradient>
                    </defs>

                    {/* Subtle grid pattern */}
                    <g opacity="0.4">
                        <line x1="50" y1="0" x2="50" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="150" y1="0" x2="150" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="250" y1="0" x2="250" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="350" y1="0" x2="350" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="450" y1="0" x2="450" y2="500" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />

                        <line x1="0" y1="100" x2="500" y2="100" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="0" y1="200" x2="500" y2="200" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="0" y1="300" x2="500" y2="300" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                        <line x1="0" y1="400" x2="500" y2="400" stroke="#DFE6ED" strokeWidth="1" strokeDasharray="3 3" />
                    </g>

                    {/* Stylized River (Seine curve) */}
                    <path
                        d="M -20,220 C 120,200 180,260 280,280 C 380,300 440,240 520,220 L 520,250 C 440,270 380,330 280,310 C 180,290 120,230 -20,250 Z"
                        fill="url(#riverGradient)"
                    />

                    {/* Secondary waterways */}
                    <path
                        d="M 280,290 C 330,340 370,410 410,500"
                        stroke="#C4D8E2"
                        strokeWidth="10"
                        strokeLinecap="round"
                        fill="none"
                        opacity="0.6"
                    />

                    {/* Subtle Road Arteries */}
                    <path
                        d="M 250,50 L 250,450 M 50,250 L 450,250 M 100,100 L 400,400 M 100,400 L 400,100"
                        stroke="#E2E8F0"
                        strokeWidth="1.5"
                        fill="none"
                    />

                    {/* Concentric Search Radius */}
                    <circle
                        cx="250"
                        cy="250"
                        r="185"
                        fill="url(#radiusGlow)"
                        stroke="#0B7C91"
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                        opacity="0.65"
                    />
                    <circle
                        cx="250"
                        cy="250"
                        r="110"
                        fill="none"
                        stroke="#0B7C91"
                        strokeWidth="0.8"
                        strokeDasharray="2 4"
                        opacity="0.35"
                    />

                    {/* User Origin Center Marker (Choisy-le-Roi) */}
                    <circle cx="250" cy="250" r="5" fill="#0B7C91" />
                    <circle cx="250" cy="250" r="10" fill="none" stroke="#0B7C91" strokeWidth="1" opacity="0.4" />
                </svg>

                {/* HTML Interactive Price Pin Markers Overlay */}
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {listings.map(item => {
                        const isSelected = selectedId === item.id;
                        const isHovered = hoveredId === item.id;
                        const pin = item.mapPin || { x: 50, y: 50, label: `€${item.priceHalfDay}` };

                        return (
                            <div
                                key={item.id}
                                onClick={() => onSelectListing(item.id)}
                                onMouseEnter={() => setHoveredId(item.id)}
                                onMouseLeave={() => setHoveredId(null)}
                                style={{
                                    position: 'absolute',
                                    left: `${pin.x}%`,
                                    top: `${pin.y}%`,
                                    transform: 'translate(-50%, -50%)',
                                    pointerEvents: 'auto',
                                    cursor: 'pointer',
                                    zIndex: isSelected ? 30 : isHovered ? 25 : 10,
                                    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                                }}
                            >
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: isSelected ? '6px 12px' : '4px 10px',
                                    background: isSelected ? '#0B7C91' : isHovered ? '#10151D' : '#FFFFFF',
                                    color: (isSelected || isHovered) ? '#FFFFFF' : '#10151D',
                                    fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                                    fontSize: isSelected ? 13 : 12,
                                    fontWeight: isSelected ? 600 : 500,
                                    borderRadius: 999,
                                    border: isSelected ? '2px solid #FFFFFF' : '1px solid rgba(16, 21, 29, 0.12)',
                                    boxShadow: isSelected
                                        ? '0 6px 18px rgba(11, 124, 145, 0.35), 0 2px 6px rgba(0,0,0,0.1)'
                                        : '0 2px 8px rgba(0, 0, 0, 0.08)',
                                    whiteSpace: 'nowrap',
                                    userSelect: 'none',
                                }}>
                                    <span style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        background: isSelected ? '#9EF4FF' : item.availableOnRequestedDate ? '#0F7A52' : '#A35A00',
                                    }} />
                                    <span>{pin.label || `€${item.priceHalfDay}`}</span>
                                </div>
                            </div>
                        );
                    })}

                    {/* Nearby Cluster Pill (+8) */}
                    <div
                        style={{
                            position: 'absolute',
                            left: '32%',
                            top: '55%',
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: 'auto',
                            cursor: 'pointer',
                            zIndex: 8,
                        }}
                    >
                        <div style={{
                            padding: '3px 8px',
                            background: 'rgba(255, 255, 255, 0.92)',
                            color: '#5F6876',
                            fontFamily: 'var(--f-mono, "JetBrains Mono", monospace)',
                            fontSize: 11,
                            fontWeight: 500,
                            borderRadius: 999,
                            border: '1px solid rgba(16, 21, 29, 0.1)',
                            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.05)',
                        }}>
                            +8
                        </div>
                    </div>
                </div>

                {/* Top Right Map Controls */}
                <div style={{
                    position: 'absolute',
                    top: 14,
                    right: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    zIndex: 20,
                }}>
                    <button
                        type="button"
                        onClick={() => {}}
                        title="Reset Orientation"
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 8,
                            background: '#FFFFFF',
                            border: '1px solid rgba(16, 21, 29, 0.1)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#10151D',
                            cursor: 'pointer',
                            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.06)',
                        }}
                    >
                        <Compass size={16} />
                    </button>
                </div>

                {/* Bottom Left Mode Toggles: Draw area / Travel 30 min */}
                <div style={{
                    position: 'absolute',
                    bottom: 74,
                    left: 14,
                    display: 'flex',
                    gap: 8,
                    zIndex: 20,
                }}>
                    <button
                        type="button"
                        onClick={() => setMapMode(m => m === 'draw' ? 'default' : 'draw')}
                        style={{
                            padding: '6px 12px',
                            borderRadius: 999,
                            background: mapMode === 'draw' ? '#10151D' : '#FFFFFF',
                            color: mapMode === 'draw' ? '#FFFFFF' : '#10151D',
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        Draw area
                    </button>
                    <button
                        type="button"
                        onClick={() => setMapMode(m => m === 'travel30' ? 'default' : 'travel30')}
                        style={{
                            padding: '6px 12px',
                            borderRadius: 999,
                            background: mapMode === 'travel30' ? '#10151D' : '#FFFFFF',
                            color: mapMode === 'travel30' ? '#FFFFFF' : '#10151D',
                            border: '1px solid rgba(16, 21, 29, 0.12)',
                            fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        Travel 30 min
                    </button>
                </div>
            </div>

            {/* Bottom Bar: Postcode & Radius info banner */}
            <div style={{
                padding: '12px 16px',
                background: '#FFFFFF',
                borderTop: '1px solid rgba(16, 21, 29, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                zIndex: 20,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MapPin size={15} color="#0B7C91" />
                    <span style={{
                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                        fontSize: 12,
                        color: '#5F6876',
                    }}>
                        Radius ({radiusKm} km) drawn from your postcode ({userLocation}), not your live location.
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onChangeLocation}
                    style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: '#EDF0F4',
                        border: '1px solid rgba(16, 21, 29, 0.06)',
                        color: '#10151D',
                        fontFamily: 'var(--f-sans, "Geist", sans-serif)',
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                    }}
                >
                    Change
                </button>
            </div>
        </div>
    );
}
