/**
 * client/src/components/ScenePanel.jsx
 *
 * R95 — PHASE 5: the scene editor.
 *
 * A generated graphic is a SCENE (motion/SceneSchema.js): a group holding
 * text with a real box, shapes measured from that text, motion per layer.
 * This panel is where a person opens one and changes it — the words, the
 * size, the colour, where it sits, how long it lasts, what is hidden — rather
 * than re-prompting and hoping for something closer.
 *
 * Every edit goes through `useTimelineStore.editSceneNode`, which patches the
 * scene, checks it again (so a change cannot push text off the frame
 * unnoticed), and diffs the result onto the clips as ONE undo. Dragging the
 * same layer on the player writes back into the scene too
 * (`_mirrorClipToScene`), so the two ways of editing cannot disagree.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    Layers, ChevronRight, ChevronDown, Eye, EyeOff, Trash2,
    Type, Square, Image as ImageIcon, Film, AlertTriangle, Wand2,
} from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { listNodes, NODE_TYPES } from '../motion/SceneSchema.js';
import { validateScene, safeZoneForAspect, describeIssues } from '../motion/SceneValidator.js';

const field = 'w-full bg-white/5 border border-border rounded px-2 py-1 text-xs text-foreground outline-none';
const label = 'text-[10px] uppercase tracking-wider text-muted-foreground';

const ICONS = {
    [NODE_TYPES.GROUP]: Layers,
    [NODE_TYPES.TEXT]: Type,
    [NODE_TYPES.CAPTION]: Type,
    [NODE_TYPES.SHAPE]: Square,
    [NODE_TYPES.IMAGE]: ImageIcon,
    [NODE_TYPES.VIDEO]: Film,
    [NODE_TYPES.STICKER]: ImageIcon,
};

/** The layers of one scene, groups first, each with its children under it. */
function LayerRow({ entry, sceneId, selectedId, onSelect, collapsed, onToggle, t }) {
    const { node, depth } = entry;
    const Icon = ICONS[node.type] || Square;
    const isGroup = node.type === NODE_TYPES.GROUP;
    const isSelected = node.id === selectedId;
    const title = node.content ? String(node.content).slice(0, 40) : node.name;

    return (
        <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 10}px` }}>
            {isGroup ? (
                <button type="button" onClick={() => onToggle(node.id)} aria-label={t('scenePanel.toggleGroup')}
                    className="p-0.5 text-muted-foreground hover:text-foreground">
                    {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
            ) : <span className="w-4" />}
            <button type="button" onClick={() => onSelect(node.id)}
                className={`flex-1 min-w-0 flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-left ${isSelected ? 'bg-primary/15 text-primary' : 'hover:bg-white/5 text-foreground'}`}>
                <Icon className="w-3 h-3 shrink-0 opacity-70" />
                <span className={`truncate ${node.hidden ? 'line-through opacity-50' : ''}`}>{title}</span>
                {node.origin?.role && <span className="text-[9px] text-muted-foreground shrink-0">{node.origin.role}</span>}
            </button>
            {!isGroup && (
                <>
                    <button type="button"
                        onClick={() => useTimelineStore.getState().setSceneNodeHidden(sceneId, node.id, !node.hidden)}
                        aria-label={node.hidden ? t('scenePanel.show') : t('scenePanel.hide')}
                        title={node.hidden ? t('scenePanel.show') : t('scenePanel.hide')}
                        className="p-1 text-muted-foreground hover:text-foreground">
                        {node.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    </button>
                    <button type="button"
                        onClick={() => useTimelineStore.getState().deleteSceneNode(sceneId, node.id)}
                        aria-label={t('scenePanel.deleteLayer')} title={t('scenePanel.deleteLayer')}
                        className="p-1 text-muted-foreground hover:text-amber-400">
                        <Trash2 className="w-3 h-3" />
                    </button>
                </>
            )}
        </div>
    );
}

/** The properties of the selected layer. Text commits on blur, not per keystroke. */
function NodeEditor({ sceneId, node, t }) {
    // Keyed on the node by the parent, so an edit made elsewhere (the player,
    // the assistant, undo) remounts this with fresh values.
    const [draft, setDraft] = useState({
        content: node.content ?? '',
        fontSize: node.style?.fontSize ?? '',
        color: node.style?.color ?? '#ffffff',
        x: node.transform?.x ?? 50,
        y: node.transform?.y ?? 50,
        duration: node.duration ?? 0,
    });
    const [note, setNote] = useState('');

    const commit = useCallback((patch) => {
        try {
            const result = useTimelineStore.getState().editSceneNode(sceneId, node.id, patch);
            if (!result?.success) { setNote(result?.error || t('scenePanel.editFailed')); return; }
            // Say when the check moved something, so a nudge is never silent.
            setNote(result.fixes?.length ? result.fixes[0].message : '');
        } catch (err) {
            console.error('[ScenePanel] edit failed:', err);
            setNote(err.message);
        }
    }, [sceneId, node.id, t]);

    const isText = node.type === NODE_TYPES.TEXT || node.type === NODE_TYPES.CAPTION;
    /**
     * Commit a number only if one was actually typed. `Number('')` is 0, so an
     * emptied box would otherwise commit zero: a font size of 0 (an invisible
     * layer the validator does not flag), or a position snapped to the top-left
     * corner. A blank box means "I have not decided", so the value stands.
     */
    const commitNumber = (raw, build) => {
        const text = String(raw ?? '').trim();
        if (!text || !Number.isFinite(Number(text))) return;
        commit(build(Number(text)));
    };

    return (
        <div className="space-y-2 p-2 rounded bg-secondary/30 border border-border/60">
            {isText && (
                <label className="block space-y-1">
                    <span className={label}>{t('scenePanel.words')}</span>
                    <textarea rows={2} className={field} value={draft.content}
                        onChange={e => setDraft({ ...draft, content: e.target.value })}
                        onBlur={e => commit({ content: e.target.value })} />
                </label>
            )}
            <div className="grid grid-cols-2 gap-2">
                {isText && (
                    <label className="block space-y-1">
                        <span className={label}>{t('scenePanel.size')}</span>
                        <input className={field} type="number" min="8" max="400" value={draft.fontSize}
                            onChange={e => setDraft({ ...draft, fontSize: e.target.value })}
                            onBlur={e => commitNumber(e.target.value, v => ({ style: { fontSize: Math.max(1, v) } }))} />
                    </label>
                )}
                {isText && (
                    <label className="block space-y-1">
                        <span className={label}>{t('scenePanel.colour')}</span>
                        <input className={`${field} h-[26px] p-0.5`} type="color" value={draft.color}
                            onChange={e => setDraft({ ...draft, color: e.target.value })}
                            onBlur={e => commit({ style: { color: e.target.value } })} />
                    </label>
                )}
                <label className="block space-y-1">
                    <span className={label}>{t('scenePanel.across')}</span>
                    <input className={field} type="number" step="1" value={draft.x}
                        onChange={e => setDraft({ ...draft, x: e.target.value })}
                        onBlur={e => commitNumber(e.target.value, v => ({ transform: { x: v } }))} />
                </label>
                <label className="block space-y-1">
                    <span className={label}>{t('scenePanel.down')}</span>
                    <input className={field} type="number" step="1" value={draft.y}
                        onChange={e => setDraft({ ...draft, y: e.target.value })}
                        onBlur={e => commitNumber(e.target.value, v => ({ transform: { y: v } }))} />
                </label>
                <label className="block space-y-1">
                    <span className={label}>{t('scenePanel.seconds')}</span>
                    <input className={field} type="number" step="0.1" min="0.1" value={draft.duration}
                        onChange={e => setDraft({ ...draft, duration: e.target.value })}
                        onBlur={e => commitNumber(e.target.value, v => ({ duration: Math.max(0.1, v) }))} />
                </label>
            </div>
            {note && <p className="text-[10px] text-amber-400">{note}</p>}
        </div>
    );
}

export default function ScenePanel() {
    const { t } = useTranslation('editor');
    const { scenes, tracks, activeClipId, aspectRatio, assets } = useTimelineStore(useShallow(state => ({
        scenes: state.scenes,
        tracks: state.tracks,
        activeClipId: state.activeClipId,
        aspectRatio: state.aspectRatio,
        assets: state.assets,
    })));
    const [selectedId, setSelectedId] = useState(null);
    const [collapsed, setCollapsed] = useState({});
    const [pickedSceneId, setPickedSceneId] = useState(null);

    const sceneIds = useMemo(() => Object.keys(scenes || {}), [scenes]);

    // The design of whatever is selected on the timeline, else the one picked
    // here, else the only one there is.
    const sceneId = useMemo(() => {
        const fromClip = (tracks || []).flatMap(tr => tr.clips || []).find(c => c.id === activeClipId)?.sceneId;
        if (fromClip && scenes?.[fromClip]) return fromClip;
        if (pickedSceneId && scenes?.[pickedSceneId]) return pickedSceneId;
        return sceneIds.length === 1 ? sceneIds[0] : null;
    }, [tracks, activeClipId, scenes, pickedSceneId, sceneIds]);

    const scene = sceneId ? scenes[sceneId] : null;

    const rows = useMemo(() => {
        if (!scene) return [];
        const hiddenUnder = new Set();
        return listNodes(scene).filter(entry => {
            const parentId = entry.parent?.id;
            if (parentId && (collapsed[parentId] || hiddenUnder.has(parentId))) {
                hiddenUnder.add(entry.node.id);
                return false;
            }
            return true;
        });
    }, [scene, collapsed]);

    const selected = useMemo(() => (scene && selectedId ? listNodes(scene).find(e => e.node.id === selectedId)?.node : null), [scene, selectedId]);

    const report = useMemo(() => {
        if (!scene) return null;
        try {
            return validateScene(scene, { safeZone: safeZoneForAspect(aspectRatio), assets });
        } catch (err) {
            console.error('[ScenePanel] validation failed:', err);
            return null;
        }
    }, [scene, aspectRatio, assets]);

    const onSelect = useCallback((nodeId) => {
        setSelectedId(nodeId);
        // Select its clip too, so the player highlights the same thing.
        const clip = (useTimelineStore.getState().tracks || []).flatMap(tr => tr.clips || []).find(c => c.sceneNodeId === nodeId);
        if (clip) useTimelineStore.getState().setActiveClip(clip.id);
    }, []);

    const onToggle = useCallback((groupId) => setCollapsed(c => ({ ...c, [groupId]: !c[groupId] })), []);

    if (sceneIds.length === 0) {
        return (
            <section className="p-4 border-b border-border/50">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5 mb-2">
                    <Layers className="w-3 h-3" /> {t('scenePanel.title')}
                </div>
                <p className="text-[11px] text-muted-foreground">{t('scenePanel.empty')}</p>
            </section>
        );
    }

    const warnings = (report?.issues || []).filter(i => i.severity !== 'info');

    return (
        <section className="p-4 border-b border-border/50">
            <div className="flex items-center justify-between mb-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> {t('scenePanel.title')}
                </div>
                {sceneIds.length > 1 && (
                    <select value={sceneId || ''} onChange={e => { setPickedSceneId(e.target.value); setSelectedId(null); }}
                        aria-label={t('scenePanel.whichDesign')}
                        className="bg-background border border-border rounded px-1.5 py-0.5 text-[11px] max-w-[55%] truncate">
                        <option value="">{t('scenePanel.pick')}</option>
                        {sceneIds.map(id => <option key={id} value={id}>{scenes[id]?.name || id}</option>)}
                    </select>
                )}
            </div>

            {!scene && <p className="text-[11px] text-muted-foreground">{t('scenePanel.pickHint')}</p>}

            {scene && (
                <>
                    <p className="text-[10px] text-muted-foreground mb-2">
                        {scene.name}
                        {scene.meta?.tone ? ` · ${scene.meta.tone}` : ''}
                        {scene.meta?.placeholders ? ` · ${t('scenePanel.placeholders', { count: scene.meta.placeholders })}` : ''}
                    </p>

                    {Array.isArray(scene.meta?.rationale) && scene.meta.rationale.length > 0 && (
                        <p className="text-[10px] text-muted-foreground mb-2 flex items-start gap-1">
                            <Wand2 className="w-3 h-3 shrink-0 mt-px text-primary" />
                            <span>{scene.meta.rationale.slice(0, 2).join(' ')}</span>
                        </p>
                    )}

                    <div className="space-y-0.5 mb-3 max-h-56 overflow-y-auto">
                        {rows.map(entry => (
                            <LayerRow key={entry.node.id} entry={entry} sceneId={sceneId}
                                selectedId={selectedId} onSelect={onSelect}
                                collapsed={!!collapsed[entry.node.id]} onToggle={onToggle} t={t} />
                        ))}
                    </div>

                    {selected && selected.type !== NODE_TYPES.GROUP && (
                        <NodeEditor key={`${sceneId}:${selected.id}:${selected.content}:${selected.style?.fontSize}:${selected.transform?.x}:${selected.transform?.y}:${selected.duration}`}
                            sceneId={sceneId} node={selected} t={t} />
                    )}

                    {warnings.length > 0 && (
                        <p className="mt-2 text-[10px] text-amber-400 flex items-start gap-1">
                            <AlertTriangle className="w-3 h-3 shrink-0 mt-px" />
                            <span>{describeIssues(warnings, 2)}</span>
                        </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-3">{t('scenePanel.footnote')}</p>
                </>
            )}
        </section>
    );
}
