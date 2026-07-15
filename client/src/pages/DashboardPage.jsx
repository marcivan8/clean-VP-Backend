/**
 * DashboardPage.jsx
 *
 * Project management hub for authenticated Vibed users.
 * Route: /dashboard
 *
 * Design: strictly Vibed Design System tokens — no arbitrary colors.
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Logo } from '../components/Logo.jsx';
import { supabase } from '../lib/supabaseClient.js';

async function createCheckout(plan) {
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

function ContextMenu({ projectId, projectName, onRename, onDuplicate, onDelete, onClose }) {
    const ref = useRef(null);
    const { t } = useTranslation('dashboard');

    useEffect(() => {
        function handler(e) {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
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

    return (
        <div
            ref={ref}
            style={{
                position: 'absolute',
                top: 36,
                right: 0,
                zIndex: 100,
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
}

// ── project card ──────────────────────────────────────────────────────────────

function ProjectCard({ project, onOpen, onRename, onDuplicate, onDelete, isMobile }) {
    const [menuOpen, setMenuOpen] = useState(false);
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
            {/* Thumbnail */}
            <div style={{
                width: '100%',
                // Portrait thumbnails: full 9:16 ratio on desktop, square on mobile
                // (otherwise in a 2-col grid each card would be 300px+ tall)
                paddingTop: isLandscape ? '56.25%' : (isMobile ? '100%' : '177.78%'),
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
                            onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}
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
                        {menuOpen && (
                            <ContextMenu
                                projectId={project.id}
                                projectName={project.name}
                                onRename={onRename}
                                onDuplicate={onDuplicate}
                                onDelete={onDelete}
                                onClose={() => setMenuOpen(false)}
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

function PlanLimitModal({ plan, limit, onClose, onUpgrade, modalWidth }) {
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
                    fontSize: 22,
                }}>
                    🔒
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
    const { t }     = useTranslation('dashboard');
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
    const [showMobileSearch, setShowMobileSearch] = useState(false);

    // ── responsive ────────────────────────────────────────────────────────────
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 640);
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

    // ── load projects ─────────────────────────────────────────────────────────
    const load = useCallback(async () => {
        setLoading(true);
        const list = await listProjects();
        setProjects(list);
        setLoading(false);
    }, []);

    // Re-fetch on mount and whenever we navigate back to this page (e.g. from editor)
    // so newly captured thumbnails and other changes are reflected.
    useEffect(() => {
        if (user) load();
    }, [user, load, location.key]);

    // ── actions ───────────────────────────────────────────────────────────────

    /** Open the "New project" modal only if the user hasn't hit their plan limit. */
    function requestNewProject() {
        if (atLimit(plan, projects.length)) {
            setShowLimitModal(true);
        } else {
            setShowNew(true);
        }
    }

    async function handleCreate(name, aspectRatio) {
        // Double-check limit (guards against race where projects loaded after click)
        if (atLimit(plan, projects.length)) {
            setShowNew(false);
            setShowLimitModal(true);
            return;
        }

        // Spin up a blank project skeleton
        const skeleton = {
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

        const id = await createProject(name, skeleton);
        if (!id) { alert('Failed to create project — please try again.'); return; }

        // Clear old editor state, set new project context, navigate to editor
        loadProject(skeleton);
        setProjectId(id);
        setProjectName(name);
        try { localStorage.setItem('vp_autosave', JSON.stringify(skeleton)); } catch (_) {}

        setShowNew(false);
        navigate(`/editor/${id}`);
    }

    async function handleOpen(projectId) {
        navigate(`/editor/${projectId}`);
    }

    async function handleRename(projectId, newName) {
        await renameProject(projectId, newName);
        setProjects(ps => ps.map(p => p.id === projectId ? { ...p, name: newName } : p));
    }

    async function handleDuplicate(projectId, projectName) {
        if (atLimit(plan, projects.length)) { setShowLimitModal(true); return; }
        await duplicateProject(projectId, `${projectName} (Copy)`);
        await load();
    }

    async function handleDelete(projectId) {
        await deleteProject(projectId);
        setProjects(ps => ps.filter(p => p.id !== projectId));
    }

    async function handleSignOut() {
        await supabase.auth.signOut();
        navigate('/', { replace: true });
    }

    // ── filtered list ─────────────────────────────────────────────────────────
    const filtered = search.trim()
        ? projects.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
        : projects;

    // ─────────────────────────────────────────────────────────────────────────

    const modalWidth = isMobile ? 'calc(100vw - 32px)' : undefined;

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)' }}>

            {/* ── Nav bar ── */}
            <header style={{
                position: 'sticky', top: 0, zIndex: 50,
                background: 'rgba(14,15,17,0.85)',
                backdropFilter: 'blur(20px) saturate(160%)',
                borderBottom: '0.5px solid var(--line)',
                padding: isMobile ? '0 16px' : '0 28px',
                display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 16,
                height: isMobile ? 52 : 56,
            }}>
                {/* Logo + wordmark */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <Logo size={22} variant="gradient" />
                    <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', color: 'var(--fg)' }}>Vibed</span>
                </div>

                {/* Breadcrumb — desktop only */}
                {!isMobile && <>
                    <span style={{ color: 'var(--line-strong)', fontSize: 18, lineHeight: 1 }}>/</span>
                    <span className="eyebrow" style={{ fontSize: 10 }}>{t('breadcrumb')}</span>
                </>}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Search — desktop only (mobile uses in-body search) */}
                {!isMobile && (
                    <div style={{ position: 'relative' }}>
                        <span style={{
                            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                            color: 'var(--fg-4)', fontSize: 13, pointerEvents: 'none', userSelect: 'none',
                        }}>⌕</span>
                        <input
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder={t('search')}
                            style={{
                                background: 'var(--bg-3)',
                                border: '0.5px solid var(--glass-stroke)',
                                borderRadius: 999,
                                padding: '7px 14px 7px 32px',
                                color: 'var(--fg)',
                                fontFamily: 'var(--f-sans)',
                                fontSize: 13,
                                width: 220,
                                outline: 'none',
                                transition: 'border-color 0.15s, width 0.2s',
                            }}
                            onFocus={e => {
                                e.currentTarget.style.borderColor = 'var(--accent)';
                                e.currentTarget.style.width = '280px';
                            }}
                            onBlur={e => {
                                e.currentTarget.style.borderColor = 'var(--glass-stroke)';
                                e.currentTarget.style.width = '220px';
                            }}
                        />
                    </div>
                )}

                {/* Plan usage pill — desktop only */}
                {!isMobile && !loading && (
                    <div style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10,
                        letterSpacing: '0.10em', textTransform: 'uppercase',
                        color: atLimit(plan, projects.length) ? 'var(--accent)' : 'var(--fg-3)',
                        padding: '4px 10px',
                        borderRadius: 999,
                        border: `0.5px solid ${atLimit(plan, projects.length) ? 'rgba(0,229,255,0.3)' : 'var(--glass-stroke)'}`,
                        background: atLimit(plan, projects.length) ? 'rgba(0,229,255,0.06)' : 'transparent',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                    }}>
                        {projects.length} / {getProjectLimit(plan) === Infinity ? '∞' : getProjectLimit(plan)} · {plan}
                    </div>
                )}

                {/* Mobile: search icon toggle */}
                {isMobile && (
                    <button
                        onClick={() => setShowMobileSearch(v => !v)}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: showMobileSearch ? 'var(--accent)' : 'var(--fg-3)',
                            fontSize: 18, padding: '6px', borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                        }}
                        aria-label="Search"
                    >⌕</button>
                )}

                {/* New project */}
                <button
                    className="btn btn-primary"
                    style={{ height: isMobile ? 34 : 36, padding: isMobile ? '0 12px' : '0 16px', fontSize: 13, flexShrink: 0 }}
                    onClick={requestNewProject}
                >
                    {isMobile ? t('newProjectShort') : t('newProject')}
                </button>

                {/* Avatar / sign out */}
                <button
                    title={t('signout')}
                    onClick={handleSignOut}
                    style={{
                        width: 30, height: 30,
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
            </header>

            {/* ── Mobile search bar (slides in below nav) ── */}
            {isMobile && showMobileSearch && (
                <div style={{
                    padding: '8px 16px',
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
            <main style={{ maxWidth: 1280, margin: '0 auto', padding: isMobile ? '20px 16px' : '40px 28px' }}>

                {/* Page header */}
                <div style={{ marginBottom: isMobile ? 20 : 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h1 style={{ margin: '0 0 4px', fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.025em', color: 'var(--fg)' }}>
                            {t('title')}
                        </h1>
                        <p className="body" style={{ margin: 0, fontSize: 13 }}>
                            {loading ? t('loading') : t('count', { count: projects.length })}
                        </p>
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
                        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(260px, 1fr))',
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
                        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fill, minmax(260px, 1fr))',
                        gap: isMobile ? 12 : 20,
                    }}>
                        {/* "New project" quick-add card */}
                        <button
                            onClick={requestNewProject}
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
            {showLimitModal && (
                <PlanLimitModal
                    plan={plan}
                    limit={getProjectLimit(plan)}
                    onClose={() => setShowLimitModal(false)}
                    onUpgrade={() => {
                        setShowLimitModal(false);
                        navigate('/success');
                    }}
                    modalWidth={modalWidth}
                />
            )}
        </div>
    );
}
