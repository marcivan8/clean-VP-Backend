/**
 * NOT MOUNTED TODAY (R166)
 *
 * TimelineVisualShelf.jsx
 *
 * Superseded by TransitionBox.jsx per user request to put timeline transitions into
 * a floating/collapsible transition box that can be toggled without cluttering the timeline.
 */

import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { ArrowDownToLine, Sparkles, Wind } from 'lucide-react';
import { TIMELINE_EFFECTS } from '../../motion/TimelineVisualEffects.js';
import { TRANSITION_TYPES, TRANSITION_DEFAULT_DURATION } from '../../motion/TransitionFX.js';
import useTimelineStore from '../../store/useTimelineStore.js';

const DragChip = ({ id, data, children, title, onClick }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, data });
    return (
        <button ref={setNodeRef} type="button" {...listeners} {...attributes} onClick={onClick} title={title}
            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border text-[10px] cursor-grab active:cursor-grabbing hover:border-primary/70 hover:bg-primary/10"
            style={{ borderColor: 'var(--line-soft)', color: 'var(--fg-2)', opacity: isDragging ? 0.45 : 1,
                transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0)` : undefined, touchAction: 'none' }}>
            {children}
        </button>
    );
};

const applyEffectToSelectedClip = (effect) => {
    const store = useTimelineStore.getState();
    const activeId = store.activeClipId;
    for (const track of store.tracks) {
        const clip = track.clips.find(item => item.id === activeId);
        if (!clip || track.type !== 'video') continue;
        const effects = (clip.effects || []).filter(item => item.id !== effect.id);
        store.updateClip(track.id, clip.id, { effects: [...effects, { ...effect, enabled: true }] });
        return;
    }
};

const applyEffectToTimeline = (effect) => {
    const store = useTimelineStore.getState();
    const targets = store.tracks.filter(track => track.type === 'video')
        .flatMap(track => (track.clips || []).map(clip => ({ track, clip })));
    if (!targets.length) return;
    store.beginEditGesture?.();
    for (const { track, clip } of targets) {
        const effects = (clip.effects || []).filter(item => item.id !== effect.id);
        store.updateClip(track.id, clip.id, { effects: [...effects, { ...effect, enabled: true }] }, { skipHistory: true });
    }
    store.endEditGesture?.(true);
};

export default function TimelineVisualShelf() {
    return (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b overflow-x-auto custom-scrollbar"
            style={{ background: 'var(--bg-2)', borderColor: 'var(--line-soft)' }}>
            <span className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider" style={{ color: 'var(--fg-4)' }}><Wind size={11} /> Transitions</span>
            {TRANSITION_TYPES.map(type => (
                <DragChip key={type} id={`timeline-transition-${type}`}
                    data={{ type: 'timeline-transition', transitionType: type }} title={`Drag to a cut to add ${type}`}
                    onClick={() => {
                        const store = useTimelineStore.getState();
                        if (store.activeClipId) store.addTransition(store.activeClipId, type, TRANSITION_DEFAULT_DURATION[type]);
                    }}>
                    {type.replaceAll('-', ' ')}
                </DragChip>
            ))}
            <span className="shrink-0 w-px h-5 mx-1" style={{ background: 'var(--line-soft)' }} />
            <span className="shrink-0 flex items-center gap-1 text-[9px] uppercase tracking-wider" style={{ color: 'var(--fg-4)' }}><Sparkles size={11} /> Effects {TIMELINE_EFFECTS.length}</span>
            {TIMELINE_EFFECTS.map(effect => (
                <div key={effect.id} className="shrink-0 flex items-center gap-1">
                    <DragChip id={`timeline-effect-${effect.id}`}
                        data={{ type: 'timeline-effect', effect }} title={`Drag ${effect.name} onto a clip or video track`}
                        onClick={() => applyEffectToSelectedClip(effect)}>
                        {effect.name}
                    </DragChip>
                    <button type="button" onClick={() => applyEffectToTimeline(effect)} title={`Apply ${effect.name} across all video clips`}
                        className="p-1 rounded hover:bg-primary/15" style={{ color: 'var(--fg-4)' }}>
                        <ArrowDownToLine size={11} />
                    </button>
                </div>
            ))}
        </div>
    );
}
