import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Menu, FolderOpen, Pencil, Settings } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore';
import MobileSheet, { SheetRow } from './MobileSheet';

/**
 * MobileEditorMenu — the mobile header's ☰ button and its sheet.
 * Before this, the mobile hamburger only toggled an unused `showSidebar`
 * flag (a dim overlay, no menu). Now: My projects, Rename project, Settings.
 *
 * Props: onOpenSettings() — IDELayout opens the Settings tab in the media sheet.
 */
export default function MobileEditorMenu({ onOpenSettings }) {
    const { t } = useTranslation('editor');
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const close = () => { setOpen(false); setRenaming(false); };

    const startRename = () => {
        setName(useTimelineStore.getState().projectName || '');
        setRenaming(true);
    };

    // Same steps as the desktop header's commitRename (IDELayout).
    const saveName = async (e) => {
        e?.preventDefault?.();
        const { projectName, projectId, setProjectName } = useTimelineStore.getState();
        const trimmed = name.trim() || t('ideLayout.untitledProject');
        if (trimmed !== projectName) {
            setSaving(true);
            setProjectName(trimmed);
            if (projectId) {
                try {
                    const { renameProject } = await import('../lib/projectsApi.js');
                    await renameProject(projectId, trimmed);
                } catch (err) {
                    console.error('[MobileEditorMenu] rename failed:', err);
                }
            }
            setSaving(false);
        }
        close();
    };

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={t('mobileUi.menu')}
                aria-haspopup="dialog"
                className="md:hidden -ml-2 inline-flex items-center justify-center"
                style={{ width: 44, height: 44, border: 0, background: 'transparent', color: 'var(--fg-2)' }}
            >
                <Menu className="w-5 h-5" />
            </button>

            <MobileSheet open={open} title={renaming ? t('mobileUi.rename') : t('mobileUi.menu')} onClose={close}>
                {renaming ? (
                    <form onSubmit={saveName} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <label htmlFor="mobile-project-name" style={{ fontSize: 12.5, color: 'var(--fg-2)' }}>{t('mobileUi.renameLabel')}</label>
                        <input
                            id="mobile-project-name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                            maxLength={120}
                            style={{
                                height: 48, boxSizing: 'border-box', padding: '0 14px', borderRadius: 'var(--r-sm)',
                                border: '1px solid var(--accent)', background: 'var(--bg)', color: 'var(--fg)',
                                fontFamily: 'var(--f-sans)', fontSize: 16, outline: 'none',
                            }}
                        />
                        <button
                            type="submit"
                            disabled={saving}
                            style={{ height: 48, borderRadius: 'var(--r-sm)', border: 0, background: 'var(--accent)', color: '#fff', fontFamily: 'var(--f-sans)', fontSize: 15, fontWeight: 600 }}
                        >
                            {t('mobileUi.save')}
                        </button>
                    </form>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <SheetRow icon={<FolderOpen size={20} />} label={t('mobileUi.myProjects')} sub={t('mobileUi.myProjectsSub')} onClick={() => { close(); navigate('/dashboard'); }} />
                        <SheetRow icon={<Pencil size={20} />} label={t('mobileUi.rename')} onClick={startRename} />
                        <SheetRow icon={<Settings size={20} />} label={t('mobileUi.settings')} sub={t('mobileUi.settingsSub')} onClick={() => { close(); onOpenSettings?.(); }} />
                    </div>
                )}
            </MobileSheet>
        </>
    );
}
