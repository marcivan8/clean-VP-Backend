import React, { useState } from 'react';
import { Plus, Search, User, X, MoreHorizontal, Image as ImageIcon, Camera, FilePlus2, Palette, CreditCard, LogOut, Pencil, Copy, Trash2, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Logo } from './Logo.jsx';
import MobileSheet, { SheetRow } from './MobileSheet.jsx';
import { aiOpsMeter } from '../lib/planLimits.js';

/**
 * MobileHome — the dashboard on phones (< 768 px), from the redesign's Home
 * and New video screens. Pure presentation: DashboardPage owns the data and
 * the actions, and keeps its rename / delete / limit dialogs.
 */

function formatDuration(secs) {
    if (!secs) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

const iconBtn = {
    width: 44, height: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent', border: 0, borderRadius: 12, color: 'var(--fg-2)', padding: 0, flexShrink: 0,
};

/** A sheet row whose whole surface is a file input (taps hit the input itself on Android/iOS). */
function FilePickRow({ icon, label, sub, accept, capture, onFile, disabled }) {
    return (
        <div style={{
            position: 'relative', display: 'flex', alignItems: 'center', gap: 14, minHeight: 60, padding: '0 12px',
            borderRadius: 14, border: '1px solid var(--line)', background: 'var(--bg-3)', color: 'var(--fg)',
            opacity: disabled ? 0.5 : 1,
        }}>
            <span aria-hidden="true" style={{ color: 'var(--accent)', display: 'inline-flex' }}>{icon}</span>
            <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
                <span style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{sub}</span>
            </span>
            <input
                type="file"
                accept={accept}
                capture={capture}
                aria-label={label}
                disabled={disabled}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) onFile(file);
                }}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 0 }}
            />
        </div>
    );
}

function ProjectRow({ project, onOpen, onMore, t, formatWhen }) {
    const portrait = (project.aspect_ratio ?? '16:9') === '9:16';
    return (
        <li style={{ display: 'flex', alignItems: 'center', gap: 4, borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
            <button
                type="button"
                onClick={() => onOpen(project.id)}
                style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, padding: 10, background: 'transparent', border: 0, color: 'var(--fg)', textAlign: 'left', cursor: 'pointer' }}
            >
                <span style={{ width: 48, height: 64, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: 'var(--bg-3)', border: '1px solid var(--line)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {project.thumbnail_url
                        ? <img src={project.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        : <Logo size={20} variant="gradient" />}
                </span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</span>
                    <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formatDuration(project.duration)} · {t('mobileHome.edited', { when: formatWhen(project.updated_at) })}
                    </span>
                </span>
                <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, padding: '4px 8px', borderRadius: 8, color: 'var(--fg-2)', background: 'var(--line)', whiteSpace: 'nowrap' }}>
                    {portrait ? '9:16' : '16:9'}
                </span>
            </button>
            <button type="button" aria-label={t('mobileHome.more', { name: project.name })} onClick={() => onMore(project)} style={{ ...iconBtn, marginRight: 4 }}>
                <MoreHorizontal size={20} />
            </button>
        </li>
    );
}

export default function MobileHome({
    projects, loading, user, plan, aiOpsUsed, formatWhen,
    creating, createError, newVideoOpen, onNewVideoOpenChange, onPickVideo, onEmptyProject,
    onOpen, onRename, onDuplicate, onDelete, onStyle, onBilling, onSignOut, onSeePlans,
}) {
    const { t } = useTranslation('dashboard');
    const [search, setSearch] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [accountOpen, setAccountOpen] = useState(false);
    const [rowMenu, setRowMenu] = useState(null); // project

    const query = search.trim().toLowerCase();
    const list = query ? projects.filter(p => p.name.toLowerCase().includes(query)) : projects;
    const meter = aiOpsMeter(aiOpsUsed, plan);

    return (
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)' }}>
            {/* ── Header ── */}
            <header style={{ position: 'sticky', top: 0, zIndex: 20, height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px 0 16px', paddingTop: 'env(safe-area-inset-top)', background: 'var(--bg)' }}>
                {searchOpen ? (
                    <>
                        <label htmlFor="mobile-home-search" className="sr-only">{t('mobileHome.search')}</label>
                        <input
                            id="mobile-home-search"
                            autoFocus
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder={t('search')}
                            style={{ flex: 1, height: 40, boxSizing: 'border-box', padding: '0 12px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg-3)', color: 'var(--fg)', fontSize: 16, fontFamily: 'var(--f-sans)', outline: 'none' }}
                        />
                        <button type="button" aria-label={t('mobileHome.closeSearch')} onClick={() => { setSearchOpen(false); setSearch(''); }} style={iconBtn}>
                            <X size={20} />
                        </button>
                    </>
                ) : (
                    <>
                        <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Logo size={22} variant="gradient" />
                            <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em' }}>Vibed</span>
                        </span>
                        {projects.length > 0 && (
                            <button type="button" aria-label={t('mobileHome.search')} onClick={() => setSearchOpen(true)} style={iconBtn}>
                                <Search size={20} />
                            </button>
                        )}
                        <button type="button" aria-label={t('mobileHome.account')} onClick={() => setAccountOpen(true)} style={iconBtn}>
                            <User size={20} />
                        </button>
                    </>
                )}
            </header>

            {/* ── Main ── */}
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 18, padding: '8px 16px 24px' }}>
                <button
                    type="button"
                    onClick={() => onNewVideoOpenChange(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 16px', borderRadius: 18, border: 0, background: 'var(--accent)', color: '#fff', textAlign: 'left', cursor: 'pointer' }}
                >
                    <span aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(255,255,255,0.16)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Plus size={24} strokeWidth={2.2} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobileHome.newVideo')}</span>
                        <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.88)' }}>{t('mobileHome.newVideoSub')}</span>
                    </span>
                </button>

                {(loading || projects.length > 0) && (
                    <h2 style={{ margin: 0, fontFamily: 'var(--f-mono)', fontSize: 10.5, fontWeight: 500, letterSpacing: '0.12em', color: 'var(--fg-2)', textTransform: 'uppercase' }}>
                        {t('mobileHome.recent')}
                    </h2>
                )}

                {loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-busy="true">
                        {[0, 1, 2].map(i => (
                            <div key={i} style={{ height: 86, borderRadius: 14, background: 'var(--bg-2)', border: '1px solid var(--line)' }} className="animate-pulse" />
                        ))}
                    </div>
                ) : projects.length === 0 ? (
                    <div style={{ padding: '40px 8px', textAlign: 'center' }}>
                        <p style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>{t('mobileHome.emptyTitle')}</p>
                        <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)' }}>{t('mobileHome.emptyBody')}</p>
                    </div>
                ) : list.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--fg-2)' }}>{t('mobileHome.noMatch', { query: search.trim() })}</p>
                ) : (
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {list.map(p => (
                            <ProjectRow key={p.id} project={p} onOpen={onOpen} onMore={setRowMenu} t={t} formatWhen={formatWhen} />
                        ))}
                    </ul>
                )}
            </main>

            {/* ── AI operations meter ── */}
            {aiOpsUsed !== null && (
                <footer style={{ position: 'sticky', bottom: 0, flexShrink: 0, padding: '12px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                        <span style={{ fontSize: 13, color: 'var(--fg-2)' }}>{t('mobileHome.aiOps')}</span>
                        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: meter.exhausted ? 'var(--coral)' : 'var(--fg)' }}>
                            {meter.unlimited ? t('mobileHome.unlimited') : `${meter.used} / ${meter.limit}`}
                        </span>
                    </div>
                    {!meter.unlimited && (
                        <div aria-hidden="true" style={{ height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                            <div style={{ width: `${Math.round(meter.ratio * 100)}%`, height: '100%', background: meter.exhausted ? 'var(--coral)' : 'var(--accent)' }} />
                        </div>
                    )}
                    <button type="button" onClick={meter.unlimited ? onBilling : onSeePlans} style={{ alignSelf: 'flex-start', minHeight: 32, padding: 0, border: 0, background: 'transparent', color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>
                        {meter.unlimited ? t('mobileHome.billing') : t('mobileHome.seePlans')}
                    </button>
                </footer>
            )}

            {/* ── New video ── */}
            <MobileSheet open={newVideoOpen} title={t('mobileHome.pickTitle')} onClose={() => { if (!creating) onNewVideoOpenChange(false); }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <FilePickRow icon={<ImageIcon size={22} />} label={t('mobileHome.pickVideo')} sub={t('mobileHome.pickVideoSub')} accept="video/*" onFile={onPickVideo} disabled={creating} />
                    <FilePickRow icon={<Camera size={22} />} label={t('mobileHome.record')} sub={t('mobileHome.recordSub')} accept="video/*" capture="environment" onFile={onPickVideo} disabled={creating} />
                </div>
                {creating && (
                    <p role="status" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--fg-2)' }}>
                        <Loader2 size={16} className="animate-spin" style={{ color: 'var(--accent)' }} /> {t('mobileHome.creating')}
                    </p>
                )}
                {createError && !creating && (
                    <p role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--coral)' }}>{t('mobileHome.createFailed')}</p>
                )}
                <button type="button" onClick={onEmptyProject} disabled={creating} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '0 4px', border: 0, background: 'transparent', color: 'var(--fg-2)', fontSize: 14, alignSelf: 'flex-start' }}>
                    <FilePlus2 size={18} aria-hidden="true" /> {t('mobileHome.emptyProject')}
                </button>
            </MobileSheet>

            {/* ── Account ── */}
            <MobileSheet open={accountOpen} title={user?.email || t('mobileHome.account')} onClose={() => setAccountOpen(false)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <SheetRow icon={<Palette size={20} />} label={t('yourStyle')} onClick={() => { setAccountOpen(false); onStyle(); }} />
                    <SheetRow icon={<CreditCard size={20} />} label={t('mobileHome.billing')} onClick={() => { setAccountOpen(false); onBilling(); }} />
                    <SheetRow icon={<LogOut size={20} />} label={t('signout')} onClick={() => { setAccountOpen(false); onSignOut(); }} danger />
                </div>
            </MobileSheet>

            {/* ── Row menu ── */}
            <MobileSheet open={!!rowMenu} title={rowMenu?.name || ''} onClose={() => setRowMenu(null)}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <SheetRow icon={<Pencil size={20} />} label={t('contextMenu.rename')} onClick={() => { const p = rowMenu; setRowMenu(null); onRename(p.id, p.name); }} />
                    <SheetRow icon={<Copy size={20} />} label={t('contextMenu.duplicate')} onClick={() => { const p = rowMenu; setRowMenu(null); onDuplicate(p.id, p.name); }} />
                    <SheetRow icon={<Trash2 size={20} />} label={t('contextMenu.delete')} onClick={() => { const p = rowMenu; setRowMenu(null); onDelete(p.id, p.name); }} danger />
                </div>
            </MobileSheet>
        </div>
    );
}
