import React, { useEffect, useState } from 'react';
import { Plus, Search, User, X, MoreHorizontal, Image as ImageIcon, Camera, FilePlus2, Palette, CreditCard, LogOut, Pencil, Copy, Trash2, Loader2, ArrowLeft, ChevronRight } from 'lucide-react';
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

// Large mobile selections can contain dozens of long video files. Creating a
// preview URL and asking Safari to inspect every video before upload adds work
// without helping the user choose; keep previews for the first few items and
// retain a lightweight file tile for every remaining selection.
const MAX_SELECTION_PREVIEWS = 8;

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
                multiple={!capture}
                onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    e.target.value = '';
                    if (files.length) onFile(files);
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
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [filePreviews, setFilePreviews] = useState([]);

    const appendSelectedFiles = (input) => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (files.length) setSelectedFiles(current => [...current, ...files]);
    };

    useEffect(() => {
        const urls = selectedFiles.slice(0, MAX_SELECTION_PREVIEWS).map(file => URL.createObjectURL(file));
        setFilePreviews(urls);
        return () => urls.forEach(url => { if (url) URL.revokeObjectURL(url); });
    }, [selectedFiles]);

    const query = search.trim().toLowerCase();
    const list = query ? projects.filter(p => p.name.toLowerCase().includes(query)) : projects;
    const meter = aiOpsMeter(aiOpsUsed, plan);

    if (newVideoOpen) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', background: 'radial-gradient(100% 45% at 100% 50%, rgba(112,35,170,.16), transparent 70%), var(--bg)', color: 'var(--fg)', fontFamily: 'var(--f-sans)' }}>
                <header style={{ height: 56, flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 16px', paddingTop: 'env(safe-area-inset-top)' }}>
                    <button type="button" onClick={() => { setSelectedFiles([]); onNewVideoOpenChange(false); }} aria-label={t('mobileHome.back', 'Back')} style={{ ...iconBtn, width: 36 }}><ArrowLeft size={20} /></button>
                    <span style={{ marginLeft: 10, display: 'flex', alignItems: 'center', gap: 8 }}><Logo size={21} variant="gradient" /><strong style={{ fontSize: 14, letterSpacing: '.02em' }}>VIBED</strong></span>
                </header>
                <main style={{ flex: 1, padding: '10px 20px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <h1 style={{ margin: '0 0 5px', fontSize: 29, lineHeight: 1.12, letterSpacing: '-.04em', fontWeight: 750 }}>{t('mobileHome.makeShort', 'Make a short')}</h1>
                        <p style={{ margin: 0, color: 'var(--fg-2)', fontSize: 14, lineHeight: 1.5 }}>{t('mobileHome.makeShortSub', 'Pick clips and photos. We’ll cut, caption and frame them for you.')}</p>
                    </div>
                    <label style={{ position: 'relative', minHeight: 88, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14, borderRadius: 18, border: '1px solid rgba(0,210,225,.55)', background: 'linear-gradient(110deg, rgba(0,190,205,.14), rgba(122,42,190,.18))', color: 'var(--fg)', textAlign: 'left', cursor: 'pointer' }}>
                        <span style={{ width: 50, height: 50, borderRadius: 14, display: 'grid', placeItems: 'center', color: '#66edf4', border: '1px solid rgba(0,210,225,.45)', background: 'rgba(0,210,225,.08)' }}><Plus size={23} /></span>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><strong style={{ fontSize: 16 }}>{t('mobileHome.chooseMedia', 'Choose photos or videos')}</strong><span style={{ color: 'var(--fg-2)', fontSize: 12.5 }}>{t('mobileHome.chooseMediaSub', 'Pick as many as you want')}</span></span>
                        {/* Keep the native input tappable on iOS. A display:none input
                            opened through ref.click() can silently fail in Safari. */}
                        <input type="file" accept="video/*,image/*" multiple aria-label={t('mobileHome.chooseMedia', 'Choose photos or videos')} onChange={e => appendSelectedFiles(e.currentTarget)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                    </label>
                    {selectedFiles.length > 0 && <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '.1em', color: 'var(--fg-3)' }}><span>{t('mobileHome.selected', 'SELECTED')}</span><span style={{ color: '#69e6ed' }}>{selectedFiles.length} {t('mobileHome.items', 'items')}</span></div>
                        <div style={{ display: 'flex', gap: 9, overflowX: 'auto', paddingBottom: 2 }}>
                            {selectedFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} style={{ position: 'relative', width: 76, height: 112, flex: 'none', borderRadius: 13, overflow: 'hidden', border: '1px solid rgba(0,210,225,.55)', background: 'linear-gradient(145deg,#18242c,#24152d)', display: 'grid', placeItems: 'center' }}>
                                {filePreviews[index] ? (file.type?.startsWith('image/') ? <img src={filePreviews[index]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <video src={filePreviews[index]} muted playsInline preload="none" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />) : <span style={{ color: '#79eaf0' }}>{file.type?.startsWith('image/') ? <ImageIcon size={20} /> : <Camera size={20} />}</span>}
                                <button type="button" aria-label={`${t('mobileHome.removeFile', 'Remove')} ${file.name}`} onClick={() => setSelectedFiles(files => files.filter((_, i) => i !== index))} style={{ position: 'absolute', top: 5, right: 5, width: 23, height: 23, display: 'grid', placeItems: 'center', borderRadius: 99, border: '1px solid rgba(255,255,255,.4)', background: 'rgba(0,0,0,.7)', color: 'white' }}><X size={14} /></button>
                                <span style={{ position: 'absolute', left: 5, right: 5, bottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '3px 5px', borderRadius: 6, background: 'rgba(0,0,0,.68)', color: 'white', fontSize: 9 }}>{file.name}</span>
                            </div>)}
                            <label aria-label={t('mobileHome.addMore', 'Add more media')} style={{ position: 'relative', width: 76, height: 112, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: 13, border: '1px dashed var(--line-strong)', background: 'rgba(255,255,255,.02)', color: 'var(--fg-3)', cursor: 'pointer' }}><Plus size={20} /><input type="file" accept="video/*,image/*" multiple aria-label={t('mobileHome.addMore', 'Add more media')} onChange={e => appendSelectedFiles(e.currentTarget)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} /></label>
                        </div>
                    </>}
                    <button type="button" disabled={!selectedFiles.length || creating} onClick={() => onPickVideo(selectedFiles)} style={{ minHeight: 54, marginTop: 2, border: 0, borderRadius: 999, background: selectedFiles.length ? '#f7f8fb' : 'var(--bg-3)', color: selectedFiles.length ? '#090b10' : 'var(--fg-3)', fontSize: 16, fontWeight: 700, cursor: selectedFiles.length ? 'pointer' : 'default' }}>
                        {creating ? t('mobileHome.creating', 'Creating…') : <>{t('mobileHome.continue', 'Continue')} <span style={{ marginLeft: 8 }}>→</span></>}
                    </button>
                    <div style={{ marginTop: -7, textAlign: 'center', color: 'var(--fg-3)', fontFamily: 'var(--f-mono)', fontSize: 10.5 }}>{meter.unlimited ? t('mobileHome.unlimited', 'Unlimited AI edits') : t('mobileHome.aiEditsLeft', { count: Math.max(0, meter.limit - meter.used), defaultValue: '{{count}} AI edits left' })}</div>
                    {createError && <p role="alert" style={{ margin: 0, color: 'var(--coral)', fontSize: 13 }}>{t('mobileHome.createFailed')}</p>}
                    {(loading || projects.length > 0) && <h2 style={{ margin: '8px 0 -5px', fontFamily: 'var(--f-mono)', fontSize: 10.5, fontWeight: 500, letterSpacing: '.14em', color: 'var(--fg-3)' }}>{t('mobileHome.recent')}</h2>}
                    {!loading && projects.slice(0, 3).map(project => <button key={project.id} type="button" onClick={() => onOpen(project.id)} style={{ width: '100%', minHeight: 74, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 11, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--bg-2)', color: 'var(--fg)', textAlign: 'left' }}>
                        <span style={{ width: 43, height: 56, flex: 'none', overflow: 'hidden', borderRadius: 8, background: 'var(--bg-3)' }}>{project.thumbnail_url ? <img src={project.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Logo size={18} variant="gradient" /></span>}</span>
                        <span style={{ flex: 1, minWidth: 0 }}><strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{project.name}</strong><small style={{ color: 'var(--fg-3)', fontFamily: 'var(--f-mono)' }}>{formatDuration(project.duration)} · {t('mobileHome.edited', { when: formatWhen(project.updated_at) })}</small></span><ChevronRight size={18} color="var(--fg-3)" />
                    </button>)}
                </main>
            </div>
        );
    }

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
                    onClick={() => { setSelectedFiles([]); onNewVideoOpenChange(true); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 16px', borderRadius: 18, border: 0, background: '#f7f8fb', color: '#090b10', textAlign: 'left', cursor: 'pointer' }}
                >
                    <span aria-hidden="true" style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(0,0,0,0.07)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Plus size={24} strokeWidth={2.2} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 17, fontWeight: 600 }}>{t('mobileHome.newVideo')}</span>
                        <span style={{ fontSize: 13, color: '#4c5563' }}>{t('mobileHome.newVideoSub')}</span>
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
                    <FilePickRow icon={<ImageIcon size={22} />} label={t('mobileHome.pickVideo')} sub={t('mobileHome.pickVideoSub')} accept="video/*,image/*" onFile={onPickVideo} disabled={creating} />
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
