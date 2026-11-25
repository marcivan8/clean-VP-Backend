/**
 * client/src/market/ui.jsx — small shared pieces for the market operations
 * surfaces (R100). Styling lives in ./market.css.
 */
import React from 'react';
import { clockState } from './opsMath.js';
import { cx } from './uiUtils.js';
import './market.css';

export function Card({ tone, className, children, ...rest }) {
    return <section className={cx('mk-card', tone && `is-${tone}`, className)} {...rest}>{children}</section>;
}

export function Eyebrow({ tone, children, as = 'div' }) {
    return React.createElement(as, { className: cx('mk-eyebrow', tone && `is-${tone}`) }, children);
}

export function CardHead({ title, tone, right }) {
    return (
        <div className="mk-card-head">
            <Eyebrow tone={tone} as="h2">{title}</Eyebrow>
            {right}
        </div>
    );
}

export function Chip({ tone, children }) {
    return <span className={cx('mk-chip', tone && `is-${tone}`)}>{children}</span>;
}

export function Pill({ tone, children }) {
    return <span className={cx('mk-pill', tone && `is-${tone}`)}>{children}</span>;
}

/** "19 h" or "69 h of 72", coloured by how close the queue target is. */
export function ClockChip({ waited, target, showTarget = false }) {
    const state = clockState(waited, target);
    const tone = state === 'breach' || state === 'urgent' ? 'red' : state === 'warning' ? 'amber' : 'plain';
    return <Chip tone={tone}>{showTarget ? `${waited} h of ${target}` : `${waited} h`}</Chip>;
}

export function Btn({ tone, size, block, className, children, ...rest }) {
    return (
        <button type="button" className={cx('mk-btn', tone && `is-${tone}`, size && `is-${size}`, block && 'is-block', className)} {...rest}>
            {children}
        </button>
    );
}

export function Row({ label, value, valueClass }) {
    return (
        <div className="mk-row">
            <span className="mk-row-label">{label}</span>
            <span className={cx('mk-row-value', valueClass)}>{value}</span>
        </div>
    );
}

export function Stat({ label, value, sub, tone, mono, cardTone }) {
    return (
        <Card tone={cardTone}>
            <Eyebrow>{label}</Eyebrow>
            <div className={cx('mk-stat-value', mono && 'is-mono', tone && `is-${tone}`)}>{value}</div>
            <div className="mk-stat-sub">{sub}</div>
        </Card>
    );
}

export function PageHead({ kicker, kickerTone, title, lede, right, split, back }) {
    return (
        <header className={cx('mk-head', split && 'mk-head-split')}>
            <div>
                {back}
                <div className={cx('mk-kicker', kickerTone && `is-${kickerTone}`)}>{kicker}</div>
                <h1 className="mk-title">{title}</h1>
                {lede && <p className="mk-lede">{lede}</p>}
            </div>
            {right}
        </header>
    );
}

/** Sidebar shell shared by the talent interface and the Trust desk. */
export function Shell({ eyebrow, brand, items, active, onSelect, footer, children }) {
    return (
        <div className="mk mk-shell">
            <nav className="mk-side" aria-label={brand}>
                <div className="mk-brand-eyebrow">{eyebrow}</div>
                <div className="mk-brand">{brand}</div>
                {items.map((it) => (
                    <button
                        key={it.id}
                        type="button"
                        className={cx('mk-nav', active === it.id && 'is-on')}
                        aria-current={active === it.id ? 'page' : undefined}
                        onClick={() => onSelect(it.id)}
                    >
                        <span>{it.label}</span>
                        {it.count != null && it.count > 0 && <span className={cx('mk-count', it.tone && `is-${it.tone}`)}>{it.count}</span>}
                    </button>
                ))}
                {footer && <div className="mk-side-foot">{footer}</div>}
            </nav>
            <main className="mk-main"><div className="mk-page">{children}</div></main>
        </div>
    );
}

