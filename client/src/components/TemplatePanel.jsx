import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';
import { TEMPLATE_KINDS, templateParams } from '../motion/TemplateGraphics.js';

/**
 * R89 (to-do A5) — insert animated templates at the playhead, and edit the
 * selected one. The drawing is motion/TemplateGraphics.js (preview and export).
 */
const field = 'w-full bg-white/5 border border-border rounded px-2 py-1 text-xs text-foreground outline-none';

const TemplateEditor = ({ trackId, clip }) => {
    const { t } = useTranslation('editor');
    const kind = clip.template.kind;
    const p = templateParams(kind, clip.template.params);
    // Local text so typing does not write a history entry per keystroke. The
    // parent keys this editor on the clip and its params, so a change made
    // elsewhere (assistant, undo) remounts it with fresh values.
    const [draft, setDraft] = useState(p);

    const commit = (patch) => {
        const next = { ...draft, ...patch };
        setDraft(next);
        try {
            useTimelineStore.getState().updateTemplateParams(trackId, clip.id, patch);
        } catch (err) {
            console.error('[TemplatePanel] update failed:', err);
        }
    };
    const text = (key, opts = {}) => (
        <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.fields.${key}`)}</span>
            {opts.multiline ? (
                <textarea rows={opts.rows || 4} className={`${field} font-mono`} value={draft[key] ?? ''}
                    onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                    onBlur={e => commit({ [key]: e.target.value })} />
            ) : (
                <input className={field} type={opts.number ? 'number' : 'text'} value={draft[key] ?? ''}
                    onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                    onBlur={e => commit({ [key]: opts.number ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            )}
        </label>
    );
    const color = (key) => (
        <label className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.fields.${key}`)}</span>
            <input type="color" value={draft[key] || '#FFE500'} onChange={e => commit({ [key]: e.target.value })}
                className="w-7 h-7 rounded border border-border bg-transparent p-0.5 cursor-pointer" />
        </label>
    );

    return (
        <div className="space-y-2 pt-3 mt-3 border-t border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t(`templates.kinds.${kind}`)}</div>
            {kind === 'counter' && (<>
                {text('label')}
                <div className="grid grid-cols-3 gap-2">{text('from', { number: true })}{text('value', { number: true })}{text('total', { number: true })}</div>
                {color('accent')}
            </>)}
            {kind === 'price-pop' && (<>{text('text')}{text('sub')}{color('color')}</>)}
            {kind === 'logo-card' && (<>
                {text('label')}{text('sub')}{color('accent')}
                <LogoPicker value={draft.imageAssetId} onPick={(asset) => commit({ imageAssetId: asset?.id || null, imageUrl: asset ? (asset.url || asset.proxyUrl || null) : null })} />
            </>)}
            {kind === 'code-window' && (<>{text('title')}{text('code', { multiline: true, rows: 6 })}{text('cps', { number: true })}</>)}
        </div>
    );
};

const LogoPicker = ({ value, onPick }) => {
    const { t } = useTranslation('editor');
    const images = useTimelineStore(useShallow(s => (s.assets || []).filter(a => a.type === 'image')));
    return (
        <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.logo')}</span>
            <select className={field} value={value || ''} onChange={e => onPick(images.find(a => a.id === e.target.value) || null)}>
                <option value="">{t('templates.noLogo')}</option>
                {images.map(a => <option key={a.id} value={a.id}>{a.name || a.id}</option>)}
            </select>
        </label>
    );
};

const TemplatePanel = ({ selectedClip, selectedTrackId }) => {
    const { t } = useTranslation('editor');
    const add = (kind) => {
        try {
            const r = useTimelineStore.getState().addTemplateClip(kind);
            if (!r?.success) console.warn('[TemplatePanel]', r?.error);
        } catch (err) {
            console.error('[TemplatePanel] add failed:', err);
        }
    };
    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{t('templates.title')}</div>
            <div className="grid grid-cols-2 gap-1.5">
                {TEMPLATE_KINDS.map(kind => (
                    <button key={kind} type="button" onClick={() => add(kind)}
                        className="px-2 py-1.5 rounded text-[11px] text-left transition-colors border border-border hover:bg-white/5 text-muted-foreground">
                        {t(`templates.kinds.${kind}`)}
                    </button>
                ))}
            </div>
            {selectedClip?.type === 'template' && selectedClip.template && (
                <TemplateEditor key={`${selectedClip.id}:${JSON.stringify(selectedClip.template.params || {})}`} trackId={selectedTrackId} clip={selectedClip} />
            )}
        </div>
    );
};

export default TemplatePanel;
