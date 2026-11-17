/**
 * DashboardPage.jsx
 *
 * Project management hub for authenticated Vibed users.
 * Route: /dashboard
 *
 * Design: strictly Vibed Design System tokens — no arbitrary colors.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { ensureMediaSession } from '../utils/mediaSession.js';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo.jsx';
import {
    Lock, Search, Sparkles, Film, Palette, Users, ArrowRight, ArrowUpRight,
    ShieldCheck, Menu, X,
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient.js';
import { captureEvent } from '../lib/posthog.js';

async function createCheckout(plan) {
    captureEvent('checkout_started', { plan: plan || 'unknown' });
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { window.location.href = '/auth'; return; }
    const res = await fetch('/api/checkout/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan }),
    });
    if (!res.ok) { console.error('[checkout] failed', await res.text()); return; }
    const { url } = await res.json();
    window.location.href = url;
}
import {
    listProjects,
    createProject,
    renameProject,
    deleteProject,
    duplicateProject,
} from '../lib/projectsApi.js';
import useTimelineStore from '../store/useTimelineStore.js';
import { useUserPlan } from '../hooks/useUserPlan.js';
import { atLimit, planLimitLabel, getProjectLimit } from '../lib/planLimits.js';
import MobileHome from '../components/MobileHome.jsx';
import PlanSheet from '../components/PlanSheet.jsx';
import { useAiOpsUsage } from '../hooks/useAiOpsUsage.js';
import { setPendingNewVideo } from '../utils/pendingNewVideo.js';

/** Empty timeline state for a new project (same shape the editor autosaves). */
function blankProjectSkeleton() {
    return {
        version: '1.2',
        timestamp: Date.now(),
        tracks: [],
        duration: 60,
        aspectRatio: '16:9',
        zoomLevel: 10,
        pacingSegments: [],
        beatMarkers: [],
        captions: [],
        transcripts: {},
        captionsFilePath: null,
        transcriptionAttempted: false,
        assets: [],
        uploadedFilePath: null,
    };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso, t, lang) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60)     return t('formatDate.justNow');
    if (diff < 3600)   return t('formatDate.minutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400)  return t('formatDate.hoursAgo',   { count: Math.floor(diff / 3600) });
    if (diff < 604800) return t('formatDate.daysAgo',    { count: Math.floor(diff / 86400) });
    return d.toLocaleDateString(lang || 'en', { month: 'short', day: 'numeric', year: diff > 31536000 ? 'numeric' : undefined });
}

function formatDuration(secs) {
    if (!secs) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ── 3-dot menu ────────────────────────────────────────────────────────────────

function ContextMenu({ projectId, projectName, onRename, onDuplicate, onDelete, onClose, anchorRect }) {
    const ref = useRef(null);
    const { t } = useTranslation('dashboard');

    useEffect(() => {
        function handler(e) {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    // Close rather than track — a fixed-position portal menu has no live
    // relationship to the trigger button's position once the page scrolls or
    // resizes (the whole point of the portal below is that it no longer
    // shares a DOM/scroll ancestor with the card), so closing is simpler and
    // safer than trying to re-measure and follow it.
    useEffect(() => {
        window.addEventListener('scroll', onClose, true);
        window.addEventListener('resize', onClose);
        return () => {
            window.removeEventListener('scroll', onClose, true);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    const item = (label, action, danger = false) => (
        <button
            key={label}
            onClick={e => { e.stopPropagation(); action(); onClose(); }}
            style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 14px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                color: danger ? '#FF5A5A' : 'var(--fg-2)',
                fontFamily: 'var(--f-sans)',
                borderRadius: 'var(--r-xs)',
                transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--glass-2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
            {label}
        </button>
    );

    // `.card` sets `backdrop-filter` (client/src/index.css) purely for the
    // frosted-glass look, but per spec a `backdrop-filter`/`filter` other than
    // `none` also creates a NEW STACKING CONTEXT on that element. This menu
    // used to be `position:absolute` *inside* the card, so its `zIndex:100`
    // only ever won against other elements INSIDE that same card's stacking
    // context — it could never rise above a SIBLING card, no matter how high
    // the number, because stacking contexts are compared as one sealed unit
    // at the level where they're created (the grid). The menu is taller than
    // the remaining space below the "···" button, so it visibly overflows
    // into the next row/column, and that sibling card — painted after it in
    // DOM order, with no competing z-index of its own to lose to — covers it.
    // (This CSS-spec trap is specific to desktop; the same rule in index.css
    // strips `backdrop-filter` on mobile for GPU cost, so mobile didn't hit
    // this exact mechanism — but the same absolute-positioned-inside-a-card
    // shape is fragile regardless, hence fixing it structurally here rather
    // than only patching the desktop symptom.)
    //
    // Portaling to `document.body` and switching to `position:fixed` at the
    // trigger button's actual screen coordinates sidesteps the whole class of
    // problem: the menu no longer has ANY stacking-context or overflow
    // ancestor in common with sibling cards. Same pattern already used by
    // Timeline/ClipContextMenu.jsx elsewhere in this codebase.
    const menu = (
        <div
            ref={ref}
            style={{
                position: 'fixed',
                // Right-align to the button, same as the old `right: 0`, but
                // clamped so it can never render off the left edge of the
                // viewport on a narrow (mobile) card.
                left: Math.max(8, anchorRect.right - 160),
                // Clamp so a "···" near the bottom of the page/grid opens
                // UPWARD instead of getting clipped by the viewport edge.
                top: Math.min(anchorRect.bottom + 6, window.innerHeight - 176),
                zIndex: 9999,
                minWidth: 160,
                background: 'var(--bg-2)',
                border: '0.5px solid var(--glass-stroke)',
                borderRadius: 'var(--r-sm)',
                padding: '6px 4px',
                boxShadow: '0 16px 40px -12px rgba(0,0,0,0.6)',
            }}
        >
            {item(t('contextMenu.rename'),    () => onRename(projectId, projectName))}
            {item(t('contextMenu.duplicate'), () => onDuplicate(projectId, projectName))}
            <div style={{ height: 1, background: 'var(--line)', margin: '4px 10px' }} />
            {item(t('contextMenu.delete'),    () => onDelete(projectId), true)}
        </div>
    );

    return ReactDOM.createPortal(menu, document.body);
}

// ── project card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, onOpen, onRename, onDuplicate, onDelete, isMobile }) {
    const [menuOpen, setMenuOpen] = useState(false);
    // Screen-space rect of the "···" trigger, captured at open time — the
    // portaled ContextMenu below is `position:fixed` and has no other way to
    // know where its own trigger button is (see the portal comment on
    // ContextMenu itself for why it can no longer just be `position:absolute`
    // inside this card).
    const [anchorRect, setAnchorRect] = useState(null);
    const triggerRef = useRef(null);
    const { t, i18n } = useTranslation('dashboard');
    const isLandscape = (project.aspect_ratio ?? '16:9') !== '9:16';

    return (
        <div
            className="card"
            style={{
                display: 'flex',
                flexDirection: 'column',
                overflow: 'visible',
                cursor: 'pointer',
                transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                boxShadow: 'var(--shadow-card)',
                position: 'relative',
            }}
            onClick={() => onOpen(project.id)}
            onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 1px 0 rgba(255,255,255,0.06) inset, 0 32px 72px -24px rgba(0,0,0,0.7), 0 8px 24px -6px rgba(0,0,0,0.5)';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = 'var(--shadow-card)';
            }}
        >
            {/* Thumbnail — always SQUARE.
                It used to take the project's own aspect ratio (56.25% for 16:9,
                177.78% for 9:16), so a mixed library produced cards of wildly
                different heights and a ragged, gap-filled grid — a portrait card
                was more than 3× the height of a landscape one. A uniform square
                tile packs the grid predictably and scales to mobile without a
                separate ratio rule. The format isn't lost, it moves to a badge
                below, which is cheaper than paying for it in layout. */}
            <div style={{
                width: '100%',
                paddingTop: '100%',
                background: 'var(--bg-3)',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: 'var(--r-lg) var(--r-lg) 0 0',
            }}>
                {project.thumbnail_url ? (
                    <img
                        src={project.thumbnail_url}
                        alt={project.name}
                        style={{
                            position: 'absolute', inset: 0,
                            width: '100%', height: '100%', objectFit: 'cover',
                        }}
                        onError={e => { e.currentTarget.style.display = 'none'; }}
                    />
                ) : (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Logo size={32} variant="gradient" />
                    </div>
                )}

                {/* Format badge & subtle design badge */}
                <div style={{
                    position: 'absolute', left: 8, bottom: 8,
                    display: 'flex', alignItems: 'center', gap: 6,
                    pointerEvents: 'none',
                }}>
                    <span style={{
                        padding: '2px 6px',
                        borderRadius: 'var(--r-xs)',
                        background: 'rgba(0,0,0,0.55)',
                        backdropFilter: 'blur(6px)',
                        WebkitBackdropFilter: 'blur(6px)',
                        border: '0.5px solid rgba(255,255,255,0.14)',
                        fontFamily: 'var(--f-mono)',
                        fontSize: 9,
                        letterSpacing: '0.04em',
                        color: 'var(--fg-2)',
                    }}>
                        {isLandscape ? '16:9' : '9:16'}
                    </span>
                    {project.isDesign && (
                        <span style={{
                            padding: '2px 6px',
                            borderRadius: 'var(--r-xs)',
                            background: 'rgba(0, 229, 255, 0.14)',
                            backdropFilter: 'blur(6px)',
                            WebkitBackdropFilter: 'blur(6px)',
                            border: '0.5px solid rgba(0, 229, 255, 0.38)',
                            fontFamily: 'var(--f-mono)',
                            fontSize: 9,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            color: '#00E5FF',
                            textTransform: 'uppercase',
                        }}>
                            design
                        </span>
                    )}
                </div>
            </div>

            {/* Card body */}
            <div style={{ padding: isMobile ? '10px 12px' : '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: isMobile ? 4 : 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span className="h-card" style={{ flex: 1, fontSize: isMobile ? 12 : 14, fontWeight: 500 }}>
                        {project.name}
                    </span>

                    {/* 3-dot menu trigger */}
                    <div style={{ position: 'relative' }}>
                        <button
                            ref={triggerRef}
                            onClick={e => {
                                e.stopPropagation();
                                if (!menuOpen) setAnchorRect(triggerRef.current.getBoundingClientRect());
                                setMenuOpen(v => !v);
                            }}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '4px 6px',
                                borderRadius: 'var(--r-xs)',
                                color: 'var(--fg-3)',
                                lineHeight: 1,
                                fontSize: 16,
                                transition: 'background 0.12s, color 0.12s',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'var(--glass-2)';
                                e.currentTarget.style.color = 'var(--fg)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'none';
                                e.currentTarget.style.color = 'var(--fg-3)';
                            }}
                        >
                            ···
                        </button>
                        {menuOpen && anchorRect && (
                            <ContextMenu
                                projectId={project.id}
                                projectName={project.name}
                                onRename={onRename}
                                onDuplicate={onDuplicate}
                                onDelete={onDelete}
                                onClose={() => setMenuOpen(false)}
                                anchorRect={anchorRect}
                            />
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="caption" style={{ fontSize: 12 }}>
                        {formatDuration(project.duration)}
                    </span>
                    <span className="caption" style={{ marginLeft: 'auto', fontSize: 12 }}>
                        {formatDate(project.updated_at, t, i18n.language)}
                    </span>
                </div>
            </div>
        </div>
    );
}

// ── new project modal ─────────────────────────────────────────────────────────

function NewProjectModal({ onClose, onCreate, modalWidth }) {
    const [name, setName]       = useState('');
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation('dashboard');

    async function handleCreate() {
        setLoading(true);
        await onCreate(name.trim() || t('newModal.namePlaceholder'));
        setLoading(false);
    }

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(14,15,17,0.8)',
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div
                className="card"
                style={{
                    width: modalWidth || 420,
                    padding: modalWidth ? 24 : 32,
                    display: 'flex', flexDirection: 'column', gap: 20,
                    boxShadow: '0 32px 80px -24px rgba(0,0,0,0.8)',
                }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="eyebrow">{t('newModal.eyebrow')}</span>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.02em' }}>
                        {t('newModal.title')}
                    </h2>
                </div>

                {/* Name */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <label className="caption" style={{ fontSize: 12, color: 'var(--fg-3)', letterSpacing: '0.04em', textTransform: 'uppercase', fontFamily: 'var(--f-mono)' }}>
                        {t('newModal.nameLabel')}
                    </label>
                    <input
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                        placeholder={t('newModal.namePlaceholder')}
                        style={{
                            background: 'var(--bg-3)',
                            border: '0.5px solid var(--glass-stroke)',
                            borderRadius: 'var(--r-sm)',
                            padding: '10px 14px',
                            color: 'var(--fg)',
                            fontFamily: 'var(--f-sans)',
                            fontSize: 14,
                            outline: 'none',
                            transition: 'border-color 0.15s',
                        }}
                        onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                        onBlur={e  => e.currentTarget.style.borderColor = 'var(--glass-stroke)'}
                    />
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" style={{ height: 40, padding: '0 18px', fontSize: 14 }} onClick={onClose}>
                        {t('newModal.cancel')}
                    </button>
                    <button
                        className="btn btn-primary"
                        style={{ height: 40, padding: '0 20px', fontSize: 14, opacity: loading ? 0.6 : 1 }}
                        onClick={handleCreate}
                        disabled={loading}
                    >
                        {loading ? t('newModal.creating') : t('newModal.create')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── rename modal ──────────────────────────────────────────────────────────────

function RenameModal({ projectId, currentName, onClose, onSave, modalWidth }) {
    const [name, setName]   = useState(currentName);
    const [saving, setSaving] = useState(false);
    const { t } = useTranslation('dashboard');

    async function handleSave() {
        if (!name.trim()) return;
        setSaving(true);
        await onSave(projectId, name.trim());
        setSaving(false);
        onClose();
    }

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(14,15,17,0.8)',
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div
                className="card"
                style={{ width: modalWidth || 380, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
            >
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--fg)', letterSpacing: '-0.015em' }}>{t('renameModal.title')}</h2>
                <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSave()}
                    style={{
                        background: 'var(--bg-3)',
                        border: '0.5px solid var(--glass-stroke)',
                        borderRadius: 'var(--r-sm)',
                        padding: '10px 14px',
                        color: 'var(--fg)',
                        fontFamily: 'var(--f-sans)',
                        fontSize: 14,
                        outline: 'none',
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onBlur={e  => e.currentTarget.style.borderColor = 'var(--glass-stroke)'}
                />
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 14 }} onClick={onClose}>{t('renameModal.cancel')}</button>
                    <button
                        className="btn btn-primary"
                        style={{ height: 38, padding: '0 18px', fontSize: 14, opacity: saving ? 0.6 : 1 }}
                        onClick={handleSave}
                        disabled={saving}
                    >
                        {saving ? t('renameModal.saving') : t('renameModal.save')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── delete confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ projectId, projectName, onClose, onConfirm, modalWidth }) {
    const [deleting, setDeleting] = useState(false);
    const { t } = useTranslation('dashboard');

    async function handle() {
        setDeleting(true);
        await onConfirm(projectId);
        setDeleting(false);
        onClose();
    }

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(14,15,17,0.8)',
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div
                className="card"
                style={{ width: modalWidth || 360, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}
            >
                <div>
                    <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>{t('deleteModal.title')}</h2>
                    <p className="body" style={{ margin: 0, fontSize: 14 }}>
                        {t('deleteModal.body', { name: projectName })}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost" style={{ height: 38, padding: '0 16px', fontSize: 14 }} onClick={onClose}>{t('deleteModal.cancel')}</button>
                    <button
                        style={{
                            height: 38, padding: '0 18px', fontSize: 14,
                            background: '#FF5A5A', color: '#fff',
                            border: 'none', borderRadius: 999, cursor: 'pointer',
                            fontFamily: 'var(--f-sans)', fontWeight: 500,
                            opacity: deleting ? 0.6 : 1,
                            transition: 'opacity 0.15s',
                        }}
                        onClick={handle}
                        disabled={deleting}
                    >
                        {deleting ? t('deleteModal.deleting') : t('deleteModal.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── plan limit modal ──────────────────────────────────────────────────────────

function PlanLimitModal({ plan, onClose, onUpgrade, modalWidth }) {
    const { t } = useTranslation('dashboard');
    const nextPlan = plan === 'free' ? 'Creator' : 'Pro';
    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 200,
                background: 'rgba(14,15,17,0.85)',
                backdropFilter: 'blur(12px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={e => e.target === e.currentTarget && onClose()}
        >
            <div
                className="card"
                style={{ width: modalWidth || 380, padding: 24, display: 'flex', flexDirection: 'column', gap: 20, textAlign: 'center' }}
            >
                {/* Icon */}
                <div style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: 'linear-gradient(135deg, rgba(0,229,255,0.15), rgba(138,43,226,0.15))',
                    border: '0.5px solid rgba(0,229,255,0.25)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto',
                }}>
                    <Lock size={20} color="var(--accent)" />
                </div>

                {/* Copy */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--fg)' }}>
                        {t('limitModal.title')}
                    </h2>
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)', lineHeight: 1.6 }}
                       dangerouslySetInnerHTML={{ __html: t('limitModal.body', { plan, limit: planLimitLabel(plan), next: nextPlan }) }}
                    />
                </div>

                {/* Plan comparison */}
                <div style={{
                    background: 'var(--glass)',
                    border: '0.5px solid var(--glass-stroke)',
                    borderRadius: 'var(--r-md)',
                    padding: '14px 18px',
                    display: 'flex',
                    justifyContent: 'space-around',
                    gap: 16,
                }}>
                    {[
                        { label: 'Creator', projects: t('limitModal.creatorProjects') },
                        { label: 'Pro',     projects: t('limitModal.proProjects') },
                    ].map(({ label, projects }) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                            <div style={{
                                fontFamily: 'var(--f-mono)', fontSize: 10,
                                letterSpacing: '0.12em', textTransform: 'uppercase',
                                color: 'var(--fg-3)', marginBottom: 4,
                            }}>{label}</div>
                            <div style={{
                                fontSize: 14, fontWeight: 600,
                                color: label === nextPlan ? 'var(--accent)' : 'var(--fg-2)',
                            }}>{projects}</div>
                        </div>
                    ))}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        className="btn btn-ghost"
                        style={{ flex: 1, height: 40, fontSize: 14 }}
                        onClick={onClose}
                    >
                        {t('limitModal.maybeLater')}
                    </button>
                    <button
                        className="btn btn-primary"
                        style={{ flex: 2, height: 40, fontSize: 14 }}
                        onClick={onUpgrade}
                    >
                        {t('limitModal.upgradeTo', { plan: nextPlan })}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
    const navigate  = useNavigate();
    const location  = useLocation();
    const { t, i18n } = useTranslation('dashboard');
    const { setProjectId, setProjectName, loadProject } = useTimelineStore();
    const { plan }  = useUserPlan();

    const [projects,    setProjects]  = useState([]);
    const [loading,     setLoading]   = useState(true);
    const [user,        setUser]      = useState(null);

    const [showNew,       setShowNew]       = useState(false);
    const [showLimitModal, setShowLimitModal] = useState(false);
    const [renameModal,   setRenameModal]   = useState(null); // { id, name }
    const [deleteModal,   setDeleteModal]   = useState(null); // { id, name }
    const [search,        setSearch]        = useState('');
    const [projectFilter, setProjectFilter] = useState('all'); // 'all' | 'video' | 'design'
    const [showMobileSearch, setShowMobileSearch] = useState(false);
    // Mobile Home: New video sheet, plan sheet ('plans' from the usage meter).
    const [newVideoOpen,  setNewVideoOpen]  = useState(false);
    const [creatingVideo, setCreatingVideo] = useState(false);
    const [createVideoError, setCreateVideoError] = useState(false);
    const [draftVideoProject, setDraftVideoProject] = useState(null);
    const [plansSheetOpen, setPlansSheetOpen] = useState(false);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // ── responsive ────────────────────────────────────────────────────────────
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
    // Phones (< 768, the editor's mobile breakpoint) get the mobile Home.
    const [isPhone, setIsPhone] = useState(() => window.innerWidth < 768);
    // Usage meter (phones only, so desktop makes no extra request).
    const { used: aiOpsUsed } = useAiOpsUsage(location.key, isPhone);
    useEffect(() => {
        const handler = () => { setIsMobile(window.innerWidth < 640); setIsPhone(window.innerWidth < 768); };
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    // ── auth guard ────────────────────────────────────────────────────────────
    useEffect(() => {
        supabase.auth.getUser().then(({ data: { user } }) => {
            if (!user) { navigate('/auth', { replace: true }); return; }
            setUser(user);
        });
    }, [navigate]);

    // ── load projects (both video and design projects) ─────────────────────────
    const load = useCallback(async () => {
        setLoading(true);
        // Media cookie first: project thumbnails are owner-only.
        const [list] = await Promise.all([listProjects(), ensureMediaSession()]);

        // Load design projects from localStorage
        let designList = [];
        try {
            const raw = localStorage.getItem('vp_design_projects');
            if (raw) {
                designList = JSON.parse(raw);
            } else {
                designList = [
                    {
                        id: 'design-kettle-drum',
                        name: 'Kettle Drum Launch · Thumbnail',
                        isDesign: true,
                        aspect_ratio: '16:9',
                        updated_at: new Date(Date.now() - 3600000 * 5).toISOString(),
                        thumbnail_url: null,
                    }
                ];
                localStorage.setItem('vp_design_projects', JSON.stringify(designList));
            }
        } catch (e) {
            console.warn('[DashboardPage] Failed to parse design projects:', e);
        }

        setProjects([...(Array.isArray(list) ? list : []), ...designList]);
        setLoading(false);
    }, []);

    // Re-fetch on mount and whenever we navigate back to this page (e.g. from editor)
    // so newly captured thumbnails and other changes are reflected.
    useEffect(() => {
        if (user) load();
    }, [user, load, location.key]);

    // ── first-run: land new signups directly in "create a new project" ────────
    // A brand-new account with zero projects used to land on an empty
    // dashboard with nothing to do but notice the "+" card — a dead first
    // impression right after signup. This auto-opens the same New Project
    // flow the "+" card and the nav button trigger, so the action a new user
    // actually needs is already in front of them instead of one more click
    // away. Scoped to accounts created in the last 15 minutes (generous
    // enough to cover the email-confirmation redirect, which can land here
    // a minute or two after the original signup) so it can never re-fire for
    // a returning user who simply deleted all their projects — that account
    // is always older than 15 minutes by the time it happens.
    const autoPromptShownRef = useRef(false);
    useEffect(() => {
        if (loading || autoPromptShownRef.current) return;
        if (projects.length > 0 || !user?.created_at) return;
        const accountAgeMs = Date.now() - new Date(user.created_at).getTime();
        if (accountAgeMs >= 0 && accountAgeMs < 15 * 60 * 1000) {
            autoPromptShownRef.current = true;
            requestNewProject();
        }
        // requestNewProject is a plain declaration, so it is a new function on
        // every render and listing it would re-run this effect constantly. The
        // ref above already makes it fire exactly once, so there is nothing a
        // fresh reference would change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, projects.length, user]);

    // ── actions ───────────────────────────────────────────────────────────────

    /** Open the "New project" modal only if the user hasn't hit their plan limit. */
    function requestNewProject() {
        if (atLimit(plan, projects.length)) {
            setShowLimitModal(true);
        } else {
            setDraftVideoProject(null);
            setNewVideoOpen(false);
            setShowNew(true);
        }
    }

    /**
     * Mobile media is selected after project naming. Reuse that newly-created
     * project, then hand the picked files to the editor's normal upload path.
     */
    async function handlePickVideo(picked) {
        // R145: the picker is multi-select; all chosen media lands in the
        // already-named project on the same timeline.
        const files = Array.isArray(picked) ? picked.filter(Boolean) : (picked ? [picked] : []);
        if (!files.length || creatingVideo) return;
        const draft = draftVideoProject;
        if (!draft?.id) {
            setNewVideoOpen(false);
            setShowNew(true);
            return;
        }
        setCreateVideoError(false);
        setCreatingVideo(true);
        try {
            loadProject(draft.skeleton);
            setProjectId(draft.id);
            setProjectName(draft.name);
            try { localStorage.setItem('vp_autosave', JSON.stringify(draft.skeleton)); } catch { /* storage full */ }
            setPendingNewVideo(draft.id, files);
            setDraftVideoProject(null);
            setNewVideoOpen(false);
            navigate(`/editor/${draft.id}`);
        } catch (err) {
            console.error('[Dashboard] new video failed:', err);
            setCreateVideoError(true);
        } finally {
            setCreatingVideo(false);
        }
    }

    async function handleCreate(name) {
        // Double-check limit (guards against race where projects loaded after click)
        if (atLimit(plan, projects.length)) {
            setShowNew(false);
            setShowLimitModal(true);
            return;
        }

        // Spin up a blank project skeleton
        const skeleton = blankProjectSkeleton();

        const id = await createProject(name, skeleton);
        if (!id) { alert('Failed to create project — please try again.'); return; }

        // On phones, project naming comes first. Keep the project context while
        // the person chooses media on the dedicated short-creation screen; once
        // they continue, the same project opens in the editor for upload.
        if (isPhone) {
            setDraftVideoProject({ id, name, skeleton });
            setCreateVideoError(false);
            setShowNew(false);
            setNewVideoOpen(true);
            return;
        }

        // Clear old editor state, set new project context, navigate to editor
        loadProject(skeleton);
        setProjectId(id);
        setProjectName(name);
        try { localStorage.setItem('vp_autosave', JSON.stringify(skeleton)); } catch { /* private mode or quota: the project still opens, just without the autosave hint */ }

        setShowNew(false);
        navigate(`/editor/${id}`);
    }

    async function handleOpen(projectId) {
        const found = projects.find(p => p.id === projectId);
        if (found?.isDesign) {
            navigate(`/design?projectId=${projectId}`);
            return;
        }
        navigate(`/editor/${projectId}`);
    }

    async function handleRename(projectId, newName) {
        const found = projects.find(p => p.id === projectId);
        if (found?.isDesign) {
            try {
                const raw = localStorage.getItem('vp_design_projects');
                if (raw) {
                    const list = JSON.parse(raw).map(p => p.id === projectId ? { ...p, name: newName } : p);
                    localStorage.setItem('vp_design_projects', JSON.stringify(list));
                }
            } catch (e) {
                console.warn('[DashboardPage] rename design project error:', e);
            }
            setProjects(ps => ps.map(p => p.id === projectId ? { ...p, name: newName } : p));
            return;
        }
        await renameProject(projectId, newName);
        setProjects(ps => ps.map(p => p.id === projectId ? { ...p, name: newName } : p));
    }

    async function handleDuplicate(projectId, projectName) {
        if (atLimit(plan, projects.length)) { setShowLimitModal(true); return; }
        const found = projects.find(p => p.id === projectId);
        if (found?.isDesign) {
            const copy = {
                ...found,
                id: `design-${Date.now()}`,
                name: `${projectName} (Copy)`,
                updated_at: new Date().toISOString(),
            };
            try {
                const raw = localStorage.getItem('vp_design_projects');
                const list = raw ? JSON.parse(raw) : [];
                list.unshift(copy);
                localStorage.setItem('vp_design_projects', JSON.stringify(list));
            } catch (e) {
                console.warn('[DashboardPage] duplicate design project error:', e);
            }
            await load();
            return;
        }
        await duplicateProject(projectId, `${projectName} (Copy)`);
        await load();
    }

    async function handleDelete(projectId) {
        const found = projects.find(p => p.id === projectId);
        if (found?.isDesign) {
            try {
                const raw = localStorage.getItem('vp_design_projects');
                if (raw) {
                    const list = JSON.parse(raw).filter(p => p.id !== projectId);
                    localStorage.setItem('vp_design_projects', JSON.stringify(list));
                }
            } catch (e) {
                console.warn('[DashboardPage] delete design project error:', e);
            }
            setProjects(ps => ps.filter(p => p.id !== projectId));
            return;
        }
        await deleteProject(projectId);
        setProjects(ps => ps.filter(p => p.id !== projectId));
    }

    async function handleSignOut() {
        await supabase.auth.signOut();
        navigate('/', { replace: true });
    }

    // ── filtered list ─────────────────────────────────────────────────────────
    const filtered = projects.filter(p => {
        if (projectFilter === 'video' && p.isDesign) return false;
        if (projectFilter === 'design' && !p.isDesign) return false;
        if (search.trim() && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    // ─────────────────────────────────────────────────────────────────────────

    const modalWidth = isMobile ? 'calc(100vw - 32px)' : undefined;

    const modals = (
        <>
            {/* ── Modals ── */}
            {showNew && (
                <NewProjectModal
                    onClose={() => setShowNew(false)}
                    onCreate={handleCreate}
                    modalWidth={modalWidth}
                />
            )}
            {renameModal && (
                <RenameModal
                    projectId={renameModal.id}
                    currentName={renameModal.name}
                    onClose={() => setRenameModal(null)}
                    onSave={handleRename}
                    modalWidth={modalWidth}
                />
            )}
            {deleteModal && (
                <DeleteConfirm
                    projectId={deleteModal.id}
                    projectName={deleteModal.name}
                    onClose={() => setDeleteModal(null)}
                    onConfirm={handleDelete}
                    modalWidth={modalWidth}
                />
            )}
            {showLimitModal && isPhone && (
                <PlanSheet open reason="projects" plan={plan} onClose={() => setShowLimitModal(false)} />
            )}
            {showLimitModal && !isPhone && (
                <PlanLimitModal
                    plan={plan}
                    onClose={() => setShowLimitModal(false)}
                    onUpgrade={() => {
                        // FIX: this used to `navigate('/success')` directly —
                        // that page requires a `checkout_id` query param and
                        // immediately bounces back to /dashboard when it's
                        // missing (see SuccessPage.jsx), so clicking "Upgrade"
                        // here silently did nothing. createCheckout() (defined
                        // above, already used correctly by HomePage.jsx's
                        // pricing section) actually starts a checkout session
                        // and redirects to it; /success is where THAT redirect
                        // lands after a real purchase completes.
                        setShowLimitModal(false);
                        createCheckout(plan === 'free' ? 'creator' : 'pro');
                    }}
                    modalWidth={modalWidth}
                />
            )}
        </>
    );

    if (isPhone) {
        return (
            <>
                <MobileHome
                    projects={projects}
                    loading={loading}
                    user={user}
                    plan={plan}
                    aiOpsUsed={aiOpsUsed}
                    formatWhen={(iso) => {
                        const when = formatDate(iso, t, i18n.language);
                        // Relative phrases follow "edited": "edited 2 hours ago", not "edited 2 Hours"/"Il y a".
                        const relative = iso && (Date.now() - new Date(iso)) / 1000 < 604800;
                        return relative ? when.charAt(0).toLocaleLowerCase(i18n.language) + when.slice(1) : when;
                    }}
                    creating={creatingVideo}
                    createError={createVideoError}
                    newVideoOpen={newVideoOpen}
                    onNewVideoOpenChange={(open) => {
                        if (open) requestNewProject();
                        else { setNewVideoOpen(false); setDraftVideoProject(null); }
                    }}
                    onPickVideo={handlePickVideo}
                    onEmptyProject={() => { setNewVideoOpen(false); setDraftVideoProject(null); setShowNew(true); }}
                    onOpen={handleOpen}
                    onRename={(id, name) => setRenameModal({ id, name })}
                    onDuplicate={handleDuplicate}
                    onDelete={(id, name) => setDeleteModal({ id, name })}
                    onStyle={() => navigate('/style')}
                    onMarketplace={() => navigate('/marketplace')}
                    onDesign={() => navigate('/design')}
                    onBilling={() => navigate('/account')}
                    onSignOut={handleSignOut}
                    onSeePlans={() => setPlansSheetOpen(true)}
                />
                <PlanSheet open={plansSheetOpen} reason="plans" plan={plan} used={aiOpsUsed} onClose={() => setPlansSheetOpen(false)} onBilling={() => navigate('/account')} />
                {modals}
            </>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)' }}>

            {/* ── Fixed Floating Liquid Glass Top Navigation Bar ── */}
            <nav style={{
                position: 'fixed', top: 16, left: 0, right: 0, zIndex: 100,
                display: 'flex', justifyContent: 'center', pointerEvents: 'none',
            }}>
                <div className={`nav-pill${mobileMenuOpen ? ' nav-pill-open' : ''}`} style={{
                    pointerEvents: 'auto',
                    display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16,
                    padding: isMobile ? '8px 12px' : '8px 18px',
                    borderRadius: 999,
                    maxWidth: 'calc(100vw - 24px)',
                    background: 'var(--glass-2)',
                    border: '0.5px solid var(--glass-stroke)',
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    boxShadow: '0 12px 36px -6px rgba(0,0,0,0.6)',
                    transition: 'all 0.3s ease',
                }}>
                    {/* Logo & Brand */}
                    <div
                        onClick={() => navigate('/dashboard')}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flexShrink: 0 }}
                    >
                        <Logo size={22} variant="gradient" />
                        <span style={{ fontWeight: 700, fontSize: 14.5, letterSpacing: '-0.02em', color: 'var(--fg)' }}>
                            Vibed
                        </span>
                    </div>

                    {/* Desktop Navigation Links */}
                    <div className="nav-only-desktop font-medium" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <button
                            onClick={() => navigate('/dashboard')}
                            style={{
                                background: 'rgba(255, 255, 255, 0.09)',
                                border: '1px solid rgba(255, 255, 255, 0.16)',
                                color: '#FFFFFF',
                                fontSize: 13,
                                fontWeight: 600,
                                padding: '6px 14px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 7,
                                boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
                            }}
                        >
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00E5FF', boxShadow: '0 0 8px rgba(0, 229, 255, 0.6)' }} />
                            Projects
                        </button>

                        <button
                            onClick={() => navigate('/marketplace')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg-3)',
                                fontSize: 13,
                                padding: '6px 12px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                        >
                            Marketplace
                        </button>

                        <button
                            onClick={() => navigate('/design')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg-3)',
                                fontSize: 13,
                                padding: '6px 12px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                        >
                            Design Studio
                        </button>

                        <button
                            onClick={() => navigate('/style')}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--fg-3)',
                                fontSize: 13,
                                padding: '6px 12px',
                                borderRadius: 999,
                                cursor: 'pointer',
                                transition: 'color 0.15s',
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
                        >
                            Style
                        </button>
                    </div>

                    {/* Pro Status Badge & Quota Stats (Strictly NO EMOJIS) */}
                    <div className="nav-only-desktop" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        {plan === 'pro' ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '4px 12px', borderRadius: 999,
                                background: 'rgba(0, 229, 255, 0.08)',
                                border: '0.5px solid rgba(0, 229, 255, 0.35)',
                                boxShadow: '0 0 14px rgba(0, 229, 255, 0.14)',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700,
                                    letterSpacing: '0.12em', color: '#00E5FF', textTransform: 'uppercase',
                                }}>PRO</span>
                                <span style={{ color: 'rgba(255, 255, 255, 0.35)', fontSize: 11 }}>·</span>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.04em',
                                    color: '#FFFFFF', whiteSpace: 'nowrap', fontWeight: 600,
                                }}>
                                    {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                                </span>
                            </div>
                        ) : plan === 'creator' ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '4px 12px', borderRadius: 999,
                                background: 'rgba(0, 229, 255, 0.08)',
                                border: '0.5px solid rgba(0, 229, 255, 0.35)',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 700,
                                    letterSpacing: '0.10em', color: '#00E5FF', textTransform: 'uppercase',
                                }}>CREATOR</span>
                                <span style={{ color: 'rgba(255, 255, 255, 0.35)', fontSize: 11 }}>·</span>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10.5, color: '#FFFFFF', whiteSpace: 'nowrap', fontWeight: 600,
                                }}>
                                    {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                                </span>
                            </div>
                        ) : (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '4px 10px', borderRadius: 999,
                                background: 'var(--glass)',
                                border: '0.5px solid var(--glass-stroke)',
                            }}>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10, fontWeight: 600,
                                    letterSpacing: '0.08em', color: 'var(--fg-3)', textTransform: 'uppercase',
                                }}>FREE</span>
                                <span style={{
                                    fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--fg-4)',
                                }}>
                                    {projects.length} / 2
                                </span>
                                <button
                                    onClick={() => setShowLimitModal(true)}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--accent)',
                                        textDecoration: 'underline', padding: 0,
                                    }}
                                >
                                    Upgrade
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Search — desktop compact pill */}
                    {!isMobile && (
                        <div style={{ position: 'relative', width: 140 }}>
                            <span style={{
                                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                                color: 'var(--fg-4)', fontSize: 12, pointerEvents: 'none', userSelect: 'none',
                            }}>
                                <Search size={12} />
                            </span>
                            <input
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder={t('search')}
                                style={{
                                    background: 'var(--bg-3)',
                                    border: '0.5px solid var(--glass-stroke)',
                                    borderRadius: 999,
                                    padding: '5px 10px 5px 26px',
                                    color: 'var(--fg)',
                                    fontFamily: 'var(--f-sans)',
                                    fontSize: 12,
                                    width: '100%',
                                    boxSizing: 'border-box',
                                    outline: 'none',
                                    transition: 'border-color 0.15s, width 0.2s',
                                }}
                                onFocus={e => {
                                    e.currentTarget.style.borderColor = 'var(--accent)';
                                    e.currentTarget.parentElement.style.width = '200px';
                                }}
                                onBlur={e => {
                                    e.currentTarget.style.borderColor = 'var(--glass-stroke)';
                                    e.currentTarget.parentElement.style.width = '140px';
                                }}
                            />
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
                        {/* New project */}
                        <button
                            className="btn btn-primary"
                            style={{ height: 32, padding: '0 14px', fontSize: 12.5 }}
                            onClick={requestNewProject}
                        >
                            {isMobile ? t('newProjectShort') : t('newProject')}
                        </button>

                        {/* Billing link */}
                        <button
                            title="Billing & subscription"
                            onClick={() => navigate('/account')}
                            className="btn btn-ghost nav-only-desktop"
                            style={{ height: 32, padding: '0 12px', fontSize: 12.5 }}
                        >
                            Billing
                        </button>

                        {/* Avatar / sign out */}
                        <button
                            title={t('signout')}
                            onClick={handleSignOut}
                            style={{
                                width: 28, height: 28,
                                borderRadius: '50%',
                                background: 'var(--accent-soft)',
                                border: '0.5px solid var(--glass-stroke)',
                                cursor: 'pointer',
                                color: 'var(--fg-2)',
                                fontFamily: 'var(--f-mono)',
                                fontSize: 11,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                textTransform: 'uppercase',
                                flexShrink: 0,
                            }}
                        >
                            {(user?.email?.[0] ?? '?').toUpperCase()}
                        </button>

                        {/* Mobile: hamburger toggle */}
                        <button
                            className="nav-only-mobile"
                            onClick={() => setMobileMenuOpen(o => !o)}
                            aria-label="Toggle menu"
                            style={{
                                background: 'none', border: 'none', color: 'var(--fg-2)',
                                cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center',
                            }}
                        >
                            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
                        </button>
                    </div>
                </div>
            </nav>

            {/* Mobile Expanded Menu */}
            {mobileMenuOpen && (
                <div style={{
                    position: 'fixed', top: 76, left: 16, right: 16, zIndex: 99,
                    background: 'var(--bg-2)', border: '0.5px solid var(--glass-stroke)',
                    borderRadius: 'var(--r-lg)', padding: '16px', display: 'flex', flexDirection: 'column', gap: 10,
                    boxShadow: '0 20px 48px rgba(0,0,0,0.8)',
                }}>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/dashboard'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'rgba(255, 255, 255, 0.08)', border: 'none', color: '#FFFFFF', fontSize: 14, fontWeight: 600, borderRadius: 8 }}>Projects</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/marketplace'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14 }}>Marketplace</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/design'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14 }}>Design Studio</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/style'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg)', fontSize: 14 }}>Style</button>
                    <button onClick={() => { setMobileMenuOpen(false); navigate('/account'); }} style={{ textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: 14 }}>Billing</button>
                </div>
            )}

            {/* ── Mobile search bar (slides in below nav) ── */}
            {isMobile && showMobileSearch && (
                <div style={{
                    padding: '8px 16px',
                    marginTop: 76,
                    background: 'rgba(14,15,17,0.95)',
                    borderBottom: '0.5px solid var(--line)',
                }}>
                    <div style={{ position: 'relative' }}>
                        <span style={{
                            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                            color: 'var(--fg-4)', fontSize: 13, pointerEvents: 'none',
                        }}>⌕</span>
                        <input
                            autoFocus
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={t('search')}
                            style={{
                                width: '100%', boxSizing: 'border-box',
                                background: 'var(--bg-3)',
                                border: '0.5px solid var(--accent)',
                                borderRadius: 999,
                                padding: '9px 14px 9px 34px',
                                color: 'var(--fg)',
                                fontFamily: 'var(--f-sans)',
                                fontSize: 14,
                                outline: 'none',
                            }}
                        />
                    </div>
                </div>
            )}

            {/* ── Body ── */}
            <main style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '88px 16px 40px' : '108px 28px 60px' }}>

                {/* Page header */}
                <div style={{ marginBottom: isMobile ? 20 : 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
                    <div>
                        <h1 style={{
                            margin: '0 0 4px',
                            fontFamily: 'var(--f-display, "Plus Jakarta Sans", sans-serif)',
                            fontSize: isMobile ? 22 : 28,
                            fontWeight: 800,
                            letterSpacing: '-0.025em',
                            color: 'var(--fg)',
                        }}>
                            {t('title', 'Projects')}
                        </h1>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <p className="body" style={{ margin: 0, fontSize: 13 }}>
                                {loading ? t('loading', 'Loading projects…') : (t('count', { count: filtered.length }) || (filtered.length === 1 ? '1 project' : `${filtered.length} projects`))}
                            </p>
                            {!loading && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
                                    {[
                                        { id: 'all', label: `All (${projects.length})` },
                                        { id: 'video', label: `Video (${projects.filter(p => !p.isDesign).length})` },
                                        { id: 'design', label: `Design (${projects.filter(p => p.isDesign).length})` },
                                    ].map(f => (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => setProjectFilter(f.id)}
                                            style={{
                                                padding: '3px 10px',
                                                borderRadius: 999,
                                                border: projectFilter === f.id ? '1px solid #00E5FF' : '0.5px solid var(--glass-stroke)',
                                                background: projectFilter === f.id ? 'rgba(0, 229, 255, 0.12)' : 'transparent',
                                                color: projectFilter === f.id ? '#00E5FF' : 'var(--fg-3)',
                                                fontFamily: 'var(--f-mono)',
                                                fontSize: 10.5,
                                                fontWeight: projectFilter === f.id ? 700 : 500,
                                                cursor: 'pointer',
                                                transition: 'all 0.15s ease',
                                            }}
                                        >
                                            {f.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Mobile: plan pill next to title */}
                    {isMobile && !loading && (
                        <div style={{
                            fontFamily: 'var(--f-mono)', fontSize: 10,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: atLimit(plan, projects.length) ? 'var(--accent)' : 'var(--fg-3)',
                            padding: '3px 8px',
                            borderRadius: 999,
                            border: `0.5px solid ${atLimit(plan, projects.length) ? 'rgba(0,229,255,0.3)' : 'var(--glass-stroke)'}`,
                            background: atLimit(plan, projects.length) ? 'rgba(0,229,255,0.06)' : 'transparent',
                            whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                            {projects.length}/{getProjectLimit(plan) === Infinity ? '∞' : getProjectLimit(plan)} · {plan}
                        </div>
                    )}
                </div>

                {/* Loading skeleton */}
                {loading && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: isMobile ? 12 : 20,
                    }}>
                        {[...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="card"
                                style={{
                                    height: isMobile ? 160 : 220,
                                    animation: 'pulse-soft 1.6s ease-in-out infinite',
                                    animationDelay: `${i * 0.12}s`,
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* Empty state */}
                {!loading && filtered.length === 0 && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                        justifyContent: 'center', gap: 16,
                        paddingTop: isMobile ? 48 : 80,
                        paddingBottom: isMobile ? 48 : 80,
                        textAlign: 'center',
                    }}>
                        <div style={{ opacity: 0.4 }}><Logo size={40} variant="gradient" /></div>
                        <div>
                            <p style={{ margin: '0 0 6px', fontSize: isMobile ? 16 : 18, fontWeight: 600, color: 'var(--fg)' }}>
                                {search ? t('empty.noMatch') : t('empty.noProjects')}
                            </p>
                            <p className="body" style={{ margin: 0, fontSize: 13 }}>
                                {search ? t('empty.noMatchSub') : t('empty.noProjectsSub')}
                            </p>
                        </div>
                        {!search && (
                            <button className="btn btn-primary" style={{ height: 40, padding: '0 20px' }} onClick={requestNewProject}>
                                {t('empty.createFirst')}
                            </button>
                        )}
                    </div>
                )}

                {/* Project grid */}
                {!loading && filtered.length > 0 && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(200px, 1fr))',
                        gap: isMobile ? 12 : 20,
                    }}>
                        {/* "New project" quick-add card */}
                        <button
                            onClick={() => {
                                if (projectFilter === 'design') {
                                    navigate('/design');
                                } else {
                                    requestNewProject();
                                }
                            }}
                            style={{
                                background: 'var(--glass)',
                                border: '0.5px dashed var(--glass-stroke)',
                                borderRadius: 'var(--r-lg)',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 8,
                                minHeight: isMobile ? 120 : 180,
                                color: 'var(--fg-3)',
                                transition: 'background 0.18s, border-color 0.18s, color 0.18s',
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.background = 'var(--glass-2)';
                                e.currentTarget.style.borderColor = 'var(--accent)';
                                e.currentTarget.style.color = 'var(--fg-2)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.background = 'var(--glass)';
                                e.currentTarget.style.borderColor = 'var(--glass-stroke)';
                                e.currentTarget.style.color = 'var(--fg-3)';
                            }}
                        >
                            <span style={{ fontSize: isMobile ? 22 : 28, lineHeight: 1 }}>+</span>
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: isMobile ? 9 : 11, letterSpacing: '0.10em', textTransform: 'uppercase' }}>
                                {t('quickAdd')}
                            </span>
                        </button>

                        {filtered.map(project => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                onOpen={handleOpen}
                                onRename={(id, name) => setRenameModal({ id, name })}
                                onDuplicate={handleDuplicate}
                                onDelete={(id) => setDeleteModal({ id, name: project.name })}
                                isMobile={isMobile}
                            />
                        ))}
                    </div>
                )}
            </main>

            {modals}
        </div>
    );
}
