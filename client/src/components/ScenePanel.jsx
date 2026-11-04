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
import {
    Layers, ChevronRight, ChevronDown, Eye, EyeOff, Trash2, ScanEye, LoaderCircle,
    Type, Square, Image as ImageIcon, Film, AlertTriangle, Wand2,
} from 'lucide-react';

import useTimelineStore from '../store/useTimelineStore';
import { listNodes, NODE_TYPES } from '../motion/SceneSchema.js';
import { validateScene, safeZoneForAspect, describeIssues } from '../motion/SceneValidator.js';
import { authFetch } from '../utils/authFetch.js';
import { captureReviewFrame } from '../motion/captureReviewFrame.js';

const field = 'w-full bg-white/5 border border-border rounded px-2 py-1 text-xs text-foreground outline-none';
const label = 'text-[10px] uppercase tracking-wider text-muted-foreground';

async function motionContactSheets(frames) {
    const beats = [...new Set(frames.map(frame => frame.beat))].sort((a, b) => a - b);
    const cellWidth = 440;
    const firstImage = new Image();
    firstImage.src = frames[0]?.image;
    await firstImage.decode();
    const imageHeight = Math.max(180, Math.round(cellWidth * firstImage.height / firstImage.width));
    const headerHeight = 30;
    const rowHeight = imageHeight + headerHeight;
    const phases = ['enter', 'hold', 'exit'];
    const sheets = [];
    for (const beat of beats) {
        const canvas = document.createElement('canvas');
        canvas.width = cellWidth * 3;
        canvas.height = rowHeight;
        const context = canvas.getContext('2d');
        context.fillStyle = '#0b0d12';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = '600 14px system-ui, sans-serif';
        for (let column = 0; column < phases.length; column++) {
            const frame = frames.find(item => item.beat === beat && item.phase === phases[column]);
            const x = column * cellWidth;
            context.fillStyle = '#11151d';
            context.fillRect(x, 0, cellWidth, headerHeight);
            context.fillStyle = '#cbd5e1';
            context.fillText(`BEAT ${beat} · ${phases[column].toUpperCase()}`, x + 12, 20);
            if (!frame) continue;
            const image = new Image();
            image.src = frame.image;
            await image.decode();
            context.drawImage(image, x, headerHeight, cellWidth, imageHeight);
        }
        const sample = frames.find(frame => frame.beat === beat);
        sheets.push({ beat, label: sample?.label || '', time: sample?.time || 0, image: canvas.toDataURL('image/jpeg', 0.82) });
    }
    return sheets;
}

function waitForPreviewFrame(surface) {
    return new Promise(resolve => {
        const raf = window.requestAnimationFrame || (callback => setTimeout(callback, 16));
        const timeout = setTimeout(resolve, 600);
        const videos = Array.from(surface?.querySelectorAll('video') || [])
            .filter(video => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
        let pending = videos.length;
        const finish = () => {
            if (pending > 0) pending--;
            if (pending === 0) {
                clearTimeout(timeout);
                resolve();
            }
        };
        // Let React apply the seek and the player paint its canvas before
        // waiting for any HTML video overlays to present their decoded frame.
        raf(() => raf(() => {
            if (!videos.length) return finish();
            videos.forEach(video => {
                if (typeof video.requestVideoFrameCallback === 'function') {
                    video.requestVideoFrameCallback(finish);
                } else if (!video.seeking) {
                    finish();
                } else {
                    video.addEventListener('seeked', finish, { once: true });
                }
            });
        }));
    });
}

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
    // Subscribe to the store fields independently. The panel can be mounted
    // before a scene exists; it must re-render when `designScene` adds one.
    const scenes = useTimelineStore(state => state.scenes || {});
    const tracks = useTimelineStore(state => state.tracks || []);
    const activeClipId = useTimelineStore(state => state.activeClipId);
    const aspectRatio = useTimelineStore(state => state.aspectRatio);
    const assets = useTimelineStore(state => state.assets || []);
    const [selectedId, setSelectedId] = useState(null);
    const [collapsed, setCollapsed] = useState({});
    const [pickedSceneId, setPickedSceneId] = useState(null);
    const [reviewing, setReviewing] = useState(false);
    const [review, setReview] = useState(null);
    const [reviewSamples, setReviewSamples] = useState([]);
    const [reviewError, setReviewError] = useState('');

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

    const reviewCurrentFrame = useCallback(async () => {
        if (!scene || reviewing) return;
        setReviewing(true);
        setReview(null);
        setReviewError('');
        const store = useTimelineStore.getState();
        const initialTime = store.currentTime;
        const wasPlaying = store.isPlaying;
        try {
            if (wasPlaying) store.setIsPlaying(false);
            const beatGroups = (scene.nodes || []).filter(node => node?.type === 'group' && node.duration > 0).slice(0, 8);
            const samples = (beatGroups.length ? beatGroups.map((group, index) => ({
                beat: Number.isFinite(Number(group.origin?.index)) ? Number(group.origin.index) + 1 : index + 1,
                label: group.name || group.origin?.beat || t('scenePanel.title'),
                start: Math.max(0, Number(scene.meta?.placedAt || 0) + Number(group.start || 0)),
                duration: Math.max(0.36, Number(group.duration || 0)),
            })) : [{ beat: 1, label: scene.name || t('scenePanel.title'), start: initialTime, duration: Math.max(0.36, Number(scene.duration || 1)) }])
                .flatMap(group => [
                    { beat: group.beat, label: group.label, phase: 'enter', time: group.start + group.duration * 0.12 },
                    { beat: group.beat, label: group.label, phase: 'hold', time: group.start + group.duration * 0.52 },
                    { beat: group.beat, label: group.label, phase: 'exit', time: group.start + group.duration * 0.88 },
                ]);
            const frames = [];
            for (const sample of samples) {
                useTimelineStore.getState().seek(sample.time);
                const player = useTimelineStore.getState().playerRef;
                try { player?.requestRender?.(); } catch { /* the seek already requested a render */ }
                const surface = document.querySelector('[data-scene-review-surface]');
                await waitForPreviewFrame(surface);
                const image = await captureReviewFrame(surface);
                frames.push({ ...sample, image });
            }
            const contactSheets = await motionContactSheets(frames);
            const groupedSamples = samples.map(sample => ({
                beat: sample.beat,
                label: sample.label,
                phases: frames.filter(frame => frame.beat === sample.beat).map(({ phase, time, image }) => ({ phase, time, image })),
            })).filter((sample, index, list) => list.findIndex(item => item.beat === sample.beat) === index);
            setReviewSamples(groupedSamples);
            const payload = {
                name: scene.name,
                tone: scene.meta?.tone,
                directions: scene.meta?.visualDirections || [],
                layers: listNodes(scene).map(({ node }) => ({
                    id: node.id,
                    type: node.type,
                    name: node.name,
                    text: node.content,
                    x: node.transform?.x,
                    y: node.transform?.y,
                    duration: node.duration,
                })),
            };
            const response = await authFetch('/api/motion/scene-review', {
                method: 'POST',
                body: JSON.stringify({ reviewMode: 'motion', frames: contactSheets, scene: payload }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || t('scenePanel.reviewFailed'));
            setReview(result);
        } catch (err) {
            setReviewError(err.code === 'SCENE_REVIEW_CAPTURE_BLOCKED'
                ? t('scenePanel.reviewCaptureBlocked')
                : err.message || t('scenePanel.reviewFailed'));
        } finally {
            useTimelineStore.getState().seek(initialTime);
            if (wasPlaying) useTimelineStore.getState().setIsPlaying(true);
            setReviewing(false);
        }
    }, [scene, reviewing, t]);

    const applySuggestedEdit = useCallback((finding, index) => {
        if (!sceneId || !finding?.edit?.nodeId) return;
        const patch = {};
        if (finding.edit.transform && typeof finding.edit.transform === 'object') patch.transform = finding.edit.transform;
        if (Number.isFinite(Number(finding.edit.style?.fontSize))) patch.style = { fontSize: Math.max(8, Math.min(400, Number(finding.edit.style.fontSize))) };
        if (Number.isFinite(Number(finding.edit.duration))) patch.duration = Math.max(0.2, Math.min(12, Number(finding.edit.duration)));
        if (!Object.keys(patch).length) return;
        const result = useTimelineStore.getState().editSceneNode(sceneId, finding.edit.nodeId, patch);
        if (!result?.success) { setReviewError(result?.error || t('scenePanel.reviewFailed')); return; }
        setReview(current => current ? ({
            ...current,
            findings: current.findings.map((item, itemIndex) => itemIndex === index ? { ...item, applied: true } : item),
        }) : current);
        setReviewError('');
    }, [sceneId, t]);

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

                    {Array.isArray(scene.meta?.visualDirections) && scene.meta.visualDirections.some(item => item.direction) && (
                        <div className="mb-3 rounded border border-border/60 bg-secondary/20 p-2 space-y-1.5">
                            {scene.meta.visualDirections.filter(item => item.direction).map(item => (
                                <p key={`${item.beat}-${item.kind}`} className="text-[10px] text-muted-foreground leading-relaxed">
                                    <span className="text-foreground/80">{item.beat}. {item.component ? `${item.component} / ${item.preset}` : item.kind}</span>
                                    <span> — {item.direction}</span>
                                </p>
                            ))}
                        </div>
                    )}

                    <div className="mb-3">
                        <button type="button" onClick={reviewCurrentFrame} disabled={reviewing}
                            className="w-full flex items-center justify-center gap-2 rounded border border-primary/30 bg-primary/10 hover:bg-primary/15 disabled:opacity-60 px-2.5 py-2 text-[11px] font-medium text-foreground">
                            {reviewing ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <ScanEye className="w-3.5 h-3.5" />}
                            {reviewing ? t('scenePanel.reviewing') : t(review?.findings?.some(finding => finding.applied) ? 'scenePanel.reviewAgain' : 'scenePanel.reviewButton')}
                        </button>
                        {reviewError && <p className="mt-2 text-[10px] text-amber-400">{reviewError}</p>}
                        {reviewSamples.length > 0 && <div className="mt-2 space-y-2">
                            {reviewSamples.map(sample => <div key={sample.beat} className="rounded border border-border/60 bg-black/30 p-1.5">
                                <p className="mb-1 truncate text-[9px] text-muted-foreground">{t('scenePanel.reviewFinding', { beat: sample.beat })} {sample.label}</p>
                                <div className="grid grid-cols-3 gap-1">
                                    {sample.phases.map(item => <figure key={item.phase} className="min-w-0">
                                        <img src={item.image} alt={t('scenePanel.reviewPhaseAlt', { phase: t(`scenePanel.phase_${item.phase}`), beat: sample.beat })} className="block w-full aspect-video rounded object-contain bg-black" />
                                        <figcaption className="pt-0.5 text-center text-[8px] uppercase text-muted-foreground">{t(`scenePanel.phase_${item.phase}`)} · {item.time.toFixed(1)}s</figcaption>
                                    </figure>)}
                                </div>
                            </div>)}
                        </div>}
                        {review && <div className="mt-2 rounded border border-border/60 bg-secondary/20 p-2 space-y-1.5">
                            <p className="text-[10px] text-foreground">{review.summary} <span className="text-muted-foreground">{t('scenePanel.reviewScore', { score: review.score })}</span></p>
                            {review.findings.map((finding, index) => <p key={`${finding.beat}-${index}`} className="text-[10px] text-muted-foreground leading-relaxed">
                                <span className={finding.severity === 'high' ? 'text-rose-400' : finding.severity === 'medium' ? 'text-amber-400' : 'text-primary'}>{t('scenePanel.reviewFinding', { beat: finding.beat })} </span>
                                {finding.issue} <span className="text-foreground/80">{finding.fix}</span>
                                {finding.edit && <button type="button" disabled={finding.applied} onClick={() => applySuggestedEdit(finding, index)} className="ml-1 text-primary hover:underline disabled:text-emerald-400 disabled:no-underline">
                                    {finding.applied ? t('scenePanel.reviewApplied') : t('scenePanel.reviewApply')}
                                </button>}
                            </p>)}
                            {!review.findings.length && <p className="text-[10px] text-muted-foreground">{t('scenePanel.reviewNoIssues')}</p>}
                        </div>}
                    </div>

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
