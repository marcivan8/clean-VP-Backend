/**
 * Logo.jsx — Vibed brand mark (single source of truth)
 *
 * 9-bar audio waveform with cyan-to-violet gradient.
 * Matches the design system logo-mark.svg exactly.
 *
 * Props:
 *   size     — width/height in px (default 28)
 *   variant  — 'gradient' | 'white' | 'black'
 *              gradient: full cyan→violet colour (use on dark backgrounds, default)
 *              white:    all bars #FAFAFA (use when contrast requires it)
 *              black:    all bars #101114 (use on light backgrounds)
 */

import React from 'react';

const BARS = [
    { x: 2.5,  y: 15,   h: 70 },
    { x: 13.5, y: 25,   h: 50 },
    { x: 24.5, y: 33,   h: 34 },
    { x: 35.5, y: 39.5, h: 21 },
    { x: 46.5, y: 43,   h: 14 },
    { x: 57.5, y: 39.5, h: 21 },
    { x: 68.5, y: 33,   h: 34 },
    { x: 79.5, y: 25,   h: 50 },
    { x: 90.5, y: 15,   h: 70 },
];

// Gradient colours from design system (cyan → violet)
const GRADIENT_COLORS = [
    '#00E5FF',
    '#17CDFB',
    '#2EB5F7',
    '#459DF3',
    '#5B85EF',
    '#726DEB',
    '#8855E7',
    '#9F3DE3',
    '#8A2BE2',
];

export const Logo = ({ size = 28, variant = 'gradient' }) => {
    const fill = (i) => {
        if (variant === 'white') return '#FAFAFA';
        if (variant === 'black') return '#101114';
        return GRADIENT_COLORS[i];
    };

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="Vibed"
        >
            {BARS.map((bar, i) => (
                <rect
                    key={i}
                    x={bar.x}
                    y={bar.y}
                    width="7"
                    height={bar.h}
                    rx="3.5"
                    fill={fill(i)}
                />
            ))}
        </svg>
    );
};

export default Logo;
