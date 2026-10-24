/**
 * client/src/components/PanelRail.jsx
 *
 * R108 — the desktop panel switcher.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Eleven panels used to share one horizontally-scrolling strip of 10px icons
 * and 10px uppercase labels at the top of the left sidebar. Five of them were
 * past the fold at the default window width, reachable only by noticing a 3px
 * chevron and scrolling a tab bar — which is not a place anyone looks. Whole
 * features (Motion, Shorts, A/B iterations) were effectively invisible, and
 * this codebase has catalogued nine of those already: see ADR-001 on things
 * that are built and never reached.
 *
 * A vertical rail fixes the specific thing that was wrong. Eleven items read
 * down a column with no scrolling, at a size the eye lands on, and the icon
 * is the same shape in the same place every time, so it becomes muscle memory
 * rather than something to read.
 *
 * DESKTOP ONLY
 * ------------
 * Mobile keeps the horizontal strip: it lives inside a bottom sheet that is
 * already the full width of the screen, where a rail would cost the content
 * a column it cannot spare. IDELayout mounts exactly one of the two, by
 * `useDeviceType().isMobile` rather than by CSS, so there is never a second
 * copy of a `data-tour` / `data-hint` anchor in the DOM for the walkthrough
 * or a first-run hint to find first and measure at zero size (R105).
 */

import React from 'react';
import {
    Layers, Type, FileText, Palette, Zap, Smartphone,
    Repeat, Sparkles, Mic, Move, Settings, Lock,
} from 'lucide-react';
import classNames from 'classnames';

/**
 * The panels, in the order they are worked in: what you bring in, what you
 * say over it, how it looks, how it moves, what you cut it into, what you
 * ship. `settings` is pinned to the bottom, away from the rest.
 */
export const RAIL_TABS = [
    { id: 'media',      Icon: Layers },
    { id: 'captions',   Icon: Type },
    { id: 'transcript', Icon: FileText },
    { id: 'color',      Icon: Palette },
    { id: 'motion',     Icon: Zap },
    { id: 'assets',     Icon: Sparkles },
    { id: 'audio',      Icon: Mic },
    { id: 'transform',  Icon: Move },
    { id: 'shorts',     Icon: Smartphone, paid: true },
    { id: 'iterations', Icon: Repeat },
];

export const RAIL_FOOTER_TABS = [
    { id: 'settings', Icon: Settings },
];

/**
 * @param {string}   activeTab  the open panel's id
 * @param {boolean}  collapsed  the panel is hidden and only the rail shows
 * @param {Function} onSelect   (tabId) => void — called for every click,
 *                              including a click on the already-active icon,
 *                              which is what collapses the panel
 * @param {boolean}  isFree     show the lock badge on paid panels
 * @param {Function} t          i18n
 */
const PanelRail = ({ activeTab, collapsed, onSelect, isFree, t }) => {
    const railRef = React.useRef(null);

    /**
     * Arrow keys move between the icons; Home and End jump to the ends.
     *
     * `role="tablist"` promises this — a screen-reader user is told these are
     * tabs and then told to use the arrow keys, so Tab-through-eleven-buttons
     * is a broken promise rather than merely a missing nicety.
     *
     * Focus is MOVED, not activated: arrowing past a panel must not open it,
     * or a keyboard user mounting ten panels to reach the eleventh would be
     * the fastest way to make the app feel broken. Enter and Space open the
     * focused one, which buttons already do.
     *
     * The event is stopped once handled, because ←/→ also step the playhead
     * a frame at a time from the window-level handler in IDELayout. Both are
     * right; the one with focus wins.
     */
    const onKeyDown = (event) => {
        const keys = ['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key) || event.metaKey || event.ctrlKey || event.altKey) return;
        const buttons = Array.from(railRef.current?.querySelectorAll('button') || []);
        if (buttons.length === 0) return;
        const from = buttons.indexOf(document.activeElement);
        if (from < 0) return;

        event.preventDefault();
        event.stopPropagation();
        const last = buttons.length - 1;
        let to = from;
        if (event.key === 'Home') to = 0;
        else if (event.key === 'End') to = last;
        else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') to = from === last ? 0 : from + 1;
        else to = from === 0 ? last : from - 1;
        buttons[to].focus();
    };

    /**
     * Which button holds the rail's single tab stop.
     *
     * Normally the open panel. But IDELayout can set `activeTab` to a panel
     * that is not in the rail at all (`marketplace`, `interview`, opened from
     * elsewhere), and then no button would match — leaving the rail with no
     * tab stop and no way in from the keyboard. The first icon takes it then.
     */
    const allIds = [...RAIL_TABS, ...RAIL_FOOTER_TABS].map((tab) => tab.id);
    const focusId = allIds.includes(activeTab) ? activeTab : allIds[0];

    const renderButton = ({ id, Icon, paid }) => {
        const active = !collapsed && activeTab === id;
        const label = t(`ideLayout.tabs.${id}`);
        return (
            <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-expanded={active}
                aria-label={label}
                // Roving tabindex: the rail is ONE tab stop, and the arrow
                // keys move inside it. Eleven stops between the canvas and
                // whatever is next is not navigation, it is an obstacle.
                tabIndex={id === focusId ? 0 : -1}
                // R105 anchors. These live here on desktop and on the mobile
                // strip on mobile — never both at once, see the file header.
                data-tour={`tab-${id}`}
                data-hint={`tab-${id}`}
                onClick={() => onSelect(id)}
                // No `title`: the browser's own tooltip would fire a second,
                // slower label a beat after this one.
                className={classNames('panel-rail-btn', active && 'active')}
            >
                <Icon className="w-[18px] h-[18px]" strokeWidth={1.6} />
                {paid && isFree && <Lock className="panel-rail-lock" />}
                <span className="panel-rail-label">{label}</span>
            </button>
        );
    };

    return (
        <nav
            role="tablist"
            aria-orientation="vertical"
            aria-label={t('ideLayout.panelsRail', 'Panels')}
            className="panel-rail"
            data-tour="panel-rail"
            data-hint="panel-rail"
            ref={railRef}
            onKeyDown={onKeyDown}
        >
            <div className="panel-rail-group">
                {RAIL_TABS.map(renderButton)}
            </div>
            <div className="panel-rail-group panel-rail-footer">
                {RAIL_FOOTER_TABS.map(renderButton)}
            </div>
        </nav>
    );
};

export default PanelRail;
