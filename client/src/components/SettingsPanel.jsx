import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../store/useTimelineStore';

const SettingsPanel = () => {
    const { t } = useTranslation('editor');
    const { aspectRatio, setAspectRatio } = useTimelineStore(useShallow(state => ({
        aspectRatio:    state.aspectRatio,
        setAspectRatio: state.setAspectRatio,
    })));

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">{t('settings.title')}</div>
            </div>

            {/* Project Settings */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">{t('settings.projectSettings')}</h3>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{t('settings.aspectRatio')}</label>
                    <select
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value)}
                        className="w-full bg-secondary text-foreground text-xs p-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="16:9">16:9 ({t('settings.landscape')})</option>
                        <option value="9:16">9:16 ({t('settings.portrait')})</option>
                        <option value="1:1">1:1 ({t('settings.square')})</option>
                        <option value="4:3">4:3 ({t('settings.standard')})</option>
                    </select>
                </div>

                <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{t('settings.previewQuality')}</label>
                    <select
                        value={useTimelineStore.getState().previewQuality ?? 'high'}
                        onChange={(e) => useTimelineStore.getState().setPreviewQuality(e.target.value)}
                        className="w-full bg-secondary text-foreground text-xs p-2 rounded-md border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                    >
                        <option value="high">{t('settings.qualityHigh')}</option>
                        <option value="low">{t('settings.qualityLow')}</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground">{t('settings.qualityHint')}</p>
                </div>
            </div>

            <div className="h-px bg-border my-2" />

            {/* Keyboard Shortcuts */}
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">{t('settings.shortcuts')}</h3>

                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-muted-foreground">{t('settings.shortcutUndo')}</div>
                    <div className="text-foreground font-mono text-right">Ctrl + Z</div>

                    <div className="text-muted-foreground">{t('settings.shortcutRedo')}</div>
                    <div className="text-foreground font-mono text-right">Ctrl + Y</div>

                    <div className="text-muted-foreground">{t('settings.shortcutSplit')}</div>
                    <div className="text-foreground font-mono text-right">S</div>

                    <div className="text-muted-foreground">{t('settings.shortcutDelete')}</div>
                    <div className="text-foreground font-mono text-right">Del / Backspace</div>

                    <div className="text-muted-foreground">{t('settings.shortcutPlay')}</div>
                    <div className="text-foreground font-mono text-right">Space</div>
                </div>
            </div>

            <div className="h-px bg-border my-2" />

            <div className="p-3 rounded-md bg-secondary/50 text-[10px] text-muted-foreground">
                <p>{t('settings.version')}</p>
                <p className="mt-1">{t('settings.appName')}</p>
            </div>
        </div>
    );
};

export default SettingsPanel;
