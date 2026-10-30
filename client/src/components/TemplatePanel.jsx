import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';
import { TEMPLATE_KINDS, drawTemplate, templateParams } from '../motion/TemplateGraphics.js';
import { ICON_NAMES } from '../motion/IconLibrary.js';
import { VECTOR_ILLUSTRATIONS, VECTOR_ILLUSTRATION_BACKGROUNDS } from '../motion/VectorIllustrationLibrary.js';
import { evaluateMotionCompatibility } from '../agent/AnimationCompatibilityEvaluator.js';

/**
 * R89 (to-do A5) — insert animated templates at the playhead, and edit the
 * selected one. The drawing is motion/TemplateGraphics.js (preview and export).
 */
const field = 'w-full bg-white/5 border border-border rounded px-2 py-1 text-xs text-foreground outline-none';

const IllustrationSwatch = ({ illustration }) => {
    const ref = useRef(null);
    useEffect(() => {
        const canvas = ref.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawTemplate(ctx, 'icon', illustration, 1.2, 3, {});
    }, [illustration]);
    return <canvas ref={ref} width={48} height={48} aria-hidden="true" className="w-9 h-9 shrink-0" />;
};

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
            {/* R92: vector shapes */}
            {['highlight-box', 'underline', 'circle-callout', 'burst'].includes(kind) && (<>
                {color('color')}
                <div className="grid grid-cols-2 gap-2">{text('thickness', { number: true })}{kind === 'burst' ? text('rays', { number: true }) : null}</div>
            </>)}
            {kind === 'arrow' && (<>
                {color('color')}
                <label className="block">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('templates.fields.direction')}</span>
                    <select value={draft.direction || 'right'} onChange={e => commit({ direction: e.target.value })}
                        className="mt-1 w-full bg-background border border-border rounded px-2 py-1 text-xs">
                        {['right', 'left', 'up', 'down'].map(d => <option key={d} value={d}>{t(`templates.directions.${d}`)}</option>)}
                    </select>
                </label>
                {text('thickness', { number: true })}
            </>)}
            {kind === 'progress-bar' && (<>{text('label')}{text('value', { number: true })}{color('color')}</>)}
            {kind === 'bar-chart' && (<>{text('values')}{text('labels')}{color('color')}{color('accent')}</>)}
            {kind === 'icon' && (<>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Illustration</span>
                    <select className={field} value={draft.icon || 'sparkle'} onChange={e => commit({ icon: e.target.value })}>
                        {ICON_NAMES.map(name => <option key={name} value={name}>{name.replaceAll('-', ' ')}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Treatment</span>
                    <select className={field} value={draft.treatment || 'solo'} onChange={e => commit({ treatment: e.target.value })}>
                        {[['solo', 'Minimal'], ['badge', 'Badge'], ['frame', 'Framed'], ['burst', 'Burst']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                    </select>
                </label>
                <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Background</span>
                    <select className={field} value={draft.background || 'soft-glow'} onChange={e => commit({ background: e.target.value })}>
                        {VECTOR_ILLUSTRATION_BACKGROUNDS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                    </select>
                </label>
                {color('accent')}
            </>)}
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
    const editingStyle = useTimelineStore(state => state.editingStyle);
    const [illustrationQuery, setIllustrationQuery] = useState('');
    const illustrations = VECTOR_ILLUSTRATIONS.filter(item => item.name.toLowerCase().includes(illustrationQuery.trim().toLowerCase())
        || item.category.toLowerCase().includes(illustrationQuery.trim().toLowerCase()));
    const add = (kind, params = {}) => {
        try {
            const adapted = evaluateMotionCompatibility(editingStyle, 'template', kind, params).adaptedParams || params;
            const r = useTimelineStore.getState().addTemplateClip(kind, adapted);
            if (!r?.success) console.warn('[TemplatePanel]', r?.error);
        } catch (err) {
            console.error('[TemplatePanel] add failed:', err);
        }
    };
    return (
        <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Vector illustrations ({VECTOR_ILLUSTRATIONS.length})</div>
            <input
                className={`${field} mb-2`}
                type="search"
                value={illustrationQuery}
                onChange={e => setIllustrationQuery(e.target.value)}
                placeholder="Search illustrations"
                aria-label="Search vector illustrations"
            />
            <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto mb-3 pr-1">
                {illustrations.map(item => (
                    <button key={item.id} type="button" title={`${item.category} · ${item.name}`} onClick={() => add('icon', { icon: item.icon, treatment: item.treatment, background: item.background })}
                        className="px-2 py-1.5 rounded text-[10px] text-left transition-colors border border-border hover:bg-white/5 text-muted-foreground flex items-center gap-1.5">
                        <IllustrationSwatch illustration={item} />
                        <span className="min-w-0"><span className="block text-foreground leading-tight">{item.name}</span>
                            <span className="block opacity-60 mt-0.5">{item.category}</span></span>
                    </button>
                ))}
                {!illustrations.length && <div className="col-span-2 text-xs text-muted-foreground py-3">No illustrations found.</div>}
            </div>
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
