import React from 'react';

/**
 * Landing icon set — one 24x24 grid, 1.8 stroke, round caps and joins.
 *
 * The page previously mixed four stroke weights across nine sizes with some
 * icons filled and some stroked; this keeps every glyph on one system. Colour
 * comes from `currentColor`, so the caller sets it with `color`.
 */

const S = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' };

const PATHS = {
    check: <path d="M20 6.6 9.2 17.4 4 12.2" {...S} strokeWidth={2.1} />,
    checkCircle: (
        <>
            <circle cx="12" cy="12" r="8.7" {...S} strokeWidth={1.8} />
            <path d="m8.2 12.3 2.7 2.7 5-5.6" {...S} strokeWidth={1.9} />
        </>
    ),
    bolt: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" fill="currentColor" />,
    clock: (
        <>
            <circle cx="12" cy="12" r="8.7" {...S} strokeWidth={1.8} />
            <path d="M12 6.9v5.4l3.4 2" {...S} strokeWidth={1.8} />
        </>
    ),
    arrowRight: <path d="M4.3 12h15M13.2 6.2 19 12l-5.8 5.8" {...S} strokeWidth={1.9} />,
    play: <path d="M9.2 6.4v11.2L18.6 12z" fill="currentColor" />,
    upload: (
        <>
            <path d="M12 15.8V4.2m0 0L7.9 8.3M12 4.2l4.1 4.1" {...S} strokeWidth={1.8} />
            <path d="M4.4 15.6v2.3a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-2.3" {...S} strokeWidth={1.8} />
        </>
    ),
    plus: <path d="M12 5.4v13.2M5.4 12h13.2" {...S} strokeWidth={1.9} />,
    star: <path d="m12 3.1 2.7 5.5 6 .9-4.35 4.24 1.03 6L12 16.9l-5.38 2.84 1.03-6L3.3 9.5l6-.9z" fill="currentColor" />,
    shield: (
        <>
            <path d="M12 3.1 19 6v5.6c0 4.3-3 7.2-7 8.6-4-1.4-7-4.3-7-8.6V6z" {...S} strokeWidth={1.8} />
            <path d="m9.3 12 1.9 1.9 3.8-4.2" {...S} strokeWidth={1.8} />
        </>
    ),
    users: (
        <>
            <circle cx="9.4" cy="8.8" r="3.4" {...S} strokeWidth={1.8} />
            <path d="M3.6 19.4c.9-3.2 3.1-5 5.8-5s4.9 1.8 5.8 5" {...S} strokeWidth={1.8} />
            <path d="M16.1 6.1a3.4 3.4 0 0 1 0 5.4m1.3 3.3c1.8.7 3 2.2 3.5 4.1" {...S} strokeWidth={1.8} />
        </>
    ),
    scissors: (
        <>
            <circle cx="6.6" cy="17.4" r="2.6" {...S} strokeWidth={1.8} />
            <circle cx="17.4" cy="17.4" r="2.6" {...S} strokeWidth={1.8} />
            <path d="M8.7 15.5 18.6 4.3M15.3 15.5 5.4 4.3" {...S} strokeWidth={1.8} />
        </>
    ),
    crop: <path d="M5.6 3.4v12.8a2 2 0 0 0 2 2h12.8M3.4 6.2h12.8a2 2 0 0 1 2 2v12.8" {...S} strokeWidth={1.8} />,
    captions: (
        <>
            <rect x="3.2" y="4.9" width="17.6" height="14.2" rx="3.2" {...S} strokeWidth={1.8} />
            <path d="M7 13.2h10M7 16.1h6" {...S} strokeWidth={1.9} />
        </>
    ),
    sparkle: (
        <>
            <path d="M10.4 2.8 12.3 8l5.2 1.9-5.2 1.9-1.9 5.2-1.9-5.2L3.3 9.9 8.5 8z" {...S} strokeWidth={1.8} />
            <path d="m18 14.2 1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z" fill="currentColor" />
        </>
    ),
    exportOut: (
        <>
            <path d="M14.6 4.4h5v5M19.6 4.4 12 12" {...S} strokeWidth={1.8} />
            <path d="M18.2 14v4.6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.4a2 2 0 0 1 2-2h4.6" {...S} strokeWidth={1.8} />
        </>
    ),
};

export const ICON_NAMES = Object.keys(PATHS);

const Icon = ({ name, size = 18, color = 'currentColor', style = null }) => {
    const glyph = PATHS[name];
    if (!glyph) {
        console.error(`[LandingIcons] unknown icon "${name}"`);
        return null;
    }
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            aria-hidden="true"
            focusable="false"
            style={{ color, flex: 'none', ...(style || {}) }}
        >
            {glyph}
        </svg>
    );
};

export default Icon;
