import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useTranslation } from 'react-i18next';
import {
    Sparkles, Wind, X, Search, Zap, MoveRight, CircleDot,
    SlidersHorizontal, ArrowDownToLine, Trash2, Heart, Check
} from 'lucide-react';
import { TRANSITION_TYPES, TRANSITION_DEFAULT_DURATION } from '../../motion/TransitionFX.js';
import { TIMELINE_EFFECTS } from '../../motion/TimelineVisualEffects.js';
import useTimelineStore from '../../store/useTimelineStore.js';
import { audioEngineAPI } from '../../audio-engine/AudioEngineAPI.js';

const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'motion', label: 'Motion' },
    { id: 'wipes', label: 'Wipes' },
    { id: 'energy', label: 'Energy' },
    { id: 'effects', label: 'Effects' },
];

const TRANSITION_METADATA = {
    'flash':         { category: 'energy', icon: '⚡', desc: 'Instant white highlight cut' },
    'dip':           { category: 'energy', icon: '🌑', desc: 'Smooth dip through black' },
    'color-flash':   { category: 'energy', icon: '🎨', desc: 'Dynamic color pop cut' },
    'soft-blur':     { category: 'energy', icon: '🌫️', desc: 'Soft focus cross-cut' },
    'whip-left':     { category: 'motion', icon: '⬅️', desc: 'Fast directional whip pan' },
    'whip-right':    { category: 'motion', icon: '➡️', desc: 'Fast directional whip pan' },
    'push-left':     { category: 'motion', icon: '◀️', desc: 'Slide push to next scene' },
    'push-right':    { category: 'motion', icon: '▶️', desc: 'Slide push to next scene' },
    'zoom-punch':    { category: 'motion', icon: '🔍', desc: 'Dynamic focal zoom push' },
    'circle-wipe':   { category: 'wipes',  icon: '⭕', desc: 'Radial iris wipe' },
    'bar-wipe':      { category: 'wipes',  icon: '⏸️', desc: 'Vertical shutter wipe' },
    'blinds':        { category: 'wipes',  icon: '🪟', desc: 'Venetian blind slats' },
    'diagonal-wipe': { category: 'wipes',  icon: '📐', desc: '45-degree angle slice' },
    'glitch':        { category: 'motion', icon: '👾', desc: 'Digital chromatic glitch' },
    'speed-lines':   { category: 'energy', icon: '💨', desc: 'Manga speed line burst' },
};

export const DraggableTransitionTile = ({
    type,
    duration,
    label,
    isApplied,
    isFavorited,
    onApply,
    onToggleFavorite
}) => {
    const meta = TRANSITION_METADATA[type] || { category: 'motion', icon: '✨', desc: 'Cut transition' };
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `timeline-transition-${type}`,
        data: { type: 'timeline-transition', transitionType: type }
    });

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        touchAction: 'none',
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 9999 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={() => onApply?.(type)}
            className={`group relative flex flex-col p-2.5 rounded-lg border text-left cursor-grab active:cursor-grabbing transition-all select-none ${
                isApplied
                    ? 'bg-primary/20 border-primary ring-1 ring-primary/40'
                    : 'bg-white/[0.03] border-white/10 hover:border-primary/50 hover:bg-white/[0.06]'
            }`}
            title={`Drag to a cut marker or click to apply ${label}`}
        >
            <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-base select-none">{meta.icon}</span>
                <div className="flex items-center gap-1">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/40 text-muted-foreground">
                        {duration}s
                    </span>
                    {onToggleFavorite && (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite(type, isFavorited);
                            }}
                            className={`p-0.5 rounded hover:bg-white/10 transition-colors ${
                                isFavorited ? 'text-red-400' : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100'
                            }`}
                            title={isFavorited ? 'Remove favorite' : 'Add to favorites'}
                        >
                            <Heart size={11} className={isFavorited ? 'fill-current' : ''} />
                        </button>
                    )}
                </div>
            </div>

            <div className="text-[12px] font-medium text-foreground truncate flex items-center gap-1">
                {label}
                {isApplied && <Check size={12} className="text-primary shrink-0" />}
            </div>
            <div className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                {meta.desc}
            </div>

            <div className="mt-2 pt-1 border-t border-white/5 flex items-center justify-between text-[9px] text-muted-foreground/70">
                <span className="group-hover:text-primary transition-colors flex items-center gap-0.5">
                    Drag to cut ↗
                </span>
                <span className="opacity-0 group-hover:opacity-100 transition-opacity">Click to apply</span>
            </div>
        </div>
    );
};

export const DraggableEffectTile = ({ effect, onApply, onApplyAll }) => {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: `timeline-effect-${effect.id}`,
        data: { type: 'timeline-effect', effect }
    });

    const style = {
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        touchAction: 'none',
        opacity: isDragging ? 0.35 : 1,
        zIndex: isDragging ? 9999 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...listeners}
            {...attributes}
            onClick={() => onApply?.(effect)}
            className="group relative flex items-center justify-between p-2 rounded-lg border bg-white/[0.03] border-white/10 hover:border-primary/50 hover:bg-white/[0.06] text-left cursor-grab active:cursor-grabbing transition-all select-none"
            title={`Drag ${effect.name} onto any video clip`}
        >
            <div className="min-w-0 pr-2">
                <div className="text-[11px] font-medium text-foreground truncate">{effect.name}</div>
                <div className="text-[9px] text-muted-foreground/80 truncate">Filter effect</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onApplyAll?.(effect);
                    }}
                    className="p-1 rounded bg-black/40 hover:bg-primary/20 hover:text-primary transition-colors text-muted-foreground"
                    title={`Apply ${effect.name} to all video clips`}
                >
                    <ArrowDownToLine size={11} />
                </button>
            </div>
        </div>
    );
};

export default function TransitionBox({ isOpen, onClose }) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [favoritedTransitions, setFavoritedTransitions] = useState(new Set());
    const boxRef = useRef(null);

    const store = useTimelineStore();
    const activeClipId = store.activeClipId;

    // Find active clip & current transition
    const activeClipInfo = useMemo(() => {
        if (!activeClipId) return null;
        for (const track of store.tracks || []) {
            const clip = track.clips?.find(c => c.id === activeClipId);
            if (clip && track.type === 'video') {
                return { clip, trackId: track.id };
            }
        }
        return null;
    }, [activeClipId, store.tracks]);

    // Load favorited transitions
    useEffect(() => {
        let isCancelled = false;
        audioEngineAPI.getFavorites?.()
            .then(res => {
                if (!isCancelled && res?.transitionTypes) {
                    setFavoritedTransitions(new Set(res.transitionTypes));
                }
            })
            .catch(() => {});
        return () => { isCancelled = true; };
    }, []);

    // Close on escape
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && isOpen) onClose?.();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e) => {
            if (boxRef.current && !boxRef.current.contains(e.target)) {
                // If clicked on the transition toggle button itself, allow toggle handler
                if (e.target.closest('[data-transition-toggle]')) return;
                onClose?.();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    const handleApplyTransition = (type) => {
        if (!activeClipInfo) return;
        const duration = TRANSITION_DEFAULT_DURATION[type] || 0.4;
        store.addTransition(activeClipInfo.clip.id, type, duration);
    };

    const handleRemoveTransition = () => {
        if (!activeClipInfo) return;
        store.updateClip(activeClipInfo.trackId, activeClipInfo.clip.id, { transition: null });
    };

    const handleToggleFavorite = async (type, wasFavorited) => {
        setFavoritedTransitions(prev => {
            const next = new Set(prev);
            if (wasFavorited) next.delete(type); else next.add(type);
            return next;
        });
        try {
            if (wasFavorited) await audioEngineAPI.removeFavorite({ transitionType: type });
            else await audioEngineAPI.addFavorite({ transitionType: type });
        } catch {
            // Revert on failure
            setFavoritedTransitions(prev => {
                const next = new Set(prev);
                if (wasFavorited) next.add(type); else next.delete(type);
                return next;
            });
        }
    };

    const handleApplyEffectToSelected = (effect) => {
        if (!activeClipInfo) return;
        const effects = (activeClipInfo.clip.effects || []).filter(e => e.id !== effect.id);
        store.updateClip(activeClipInfo.trackId, activeClipInfo.clip.id, {
            effects: [...effects, { ...effect, enabled: true }]
        });
    };

    const handleApplyEffectToAll = (effect) => {
        const targets = (store.tracks || []).filter(t => t.type === 'video')
            .flatMap(track => (track.clips || []).map(clip => ({ track, clip })));
        if (!targets.length) return;
        store.beginEditGesture?.();
        for (const { track, clip } of targets) {
            const effects = (clip.effects || []).filter(e => e.id !== effect.id);
            store.updateClip(track.id, clip.id, {
                effects: [...effects, { ...effect, enabled: true }]
            }, { skipHistory: true });
        }
        store.endEditGesture?.(true);
    };

    // Filter transitions
    const filteredTransitions = useMemo(() => {
        const query = search.trim().toLowerCase();
        return TRANSITION_TYPES.filter(type => {
            const meta = TRANSITION_METADATA[type];
            const name = t(`transitions.${type}`, type.replace('-', ' ')).toLowerCase();
            const matchesCat = selectedCategory === 'all' || meta?.category === selectedCategory;
            const matchesQuery = !query || name.includes(query) || type.includes(query);
            return matchesCat && matchesQuery;
        });
    }, [search, selectedCategory, t]);

    // Filter effects
    const filteredEffects = useMemo(() => {
        if (selectedCategory !== 'all' && selectedCategory !== 'effects') return [];
        const query = search.trim().toLowerCase();
        return TIMELINE_EFFECTS.filter(e => {
            return !query || e.name.toLowerCase().includes(query) || e.id.toLowerCase().includes(query);
        });
    }, [search, selectedCategory]);

    if (!isOpen) return null;

    return (
        <div
            ref={boxRef}
            className="absolute left-3 top-11 z-50 w-[420px] max-w-[calc(100vw-24px)] max-h-[460px] flex flex-col rounded-xl border shadow-2xl backdrop-blur-xl animate-in fade-in-0 zoom-in-95 duration-150"
            style={{
                background: 'rgba(18, 19, 24, 0.96)',
                borderColor: 'var(--line-soft, rgba(255, 255, 255, 0.12))',
                boxShadow: '0 20px 40px -8px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.06)'
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-md bg-primary/15 text-primary">
                        <Wind size={14} />
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
                        {t('timeline.transitionsBox', 'Transitions & Effects')}
                    </span>
                    <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full bg-white/5">
                        {filteredTransitions.length}
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onClose}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
                    title="Close (Esc)"
                >
                    <X size={15} />
                </button>
            </div>

            {/* Search & Category Filter */}
            <div className="p-3 border-b border-white/5 space-y-2 shrink-0">
                <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t('timeline.searchTransitions', 'Search transitions or effects…')}
                        className="w-full bg-white/[0.04] border border-white/10 rounded-md pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/60 transition-colors"
                    />
                    {search && (
                        <button
                            type="button"
                            onClick={() => setSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-0.5">
                    {CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            type="button"
                            onClick={() => setSelectedCategory(cat.id)}
                            className={`px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap transition-colors ${
                                selectedCategory === cat.id
                                    ? 'bg-primary/20 text-primary border border-primary/40'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent'
                            }`}
                        >
                            {cat.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3">
                {/* Transitions Section */}
                {filteredTransitions.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                            <span>Transitions ({filteredTransitions.length})</span>
                            <span className="text-[9px] lowercase font-normal text-muted-foreground/60">
                                drag onto cut marker
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {filteredTransitions.map(type => (
                                <DraggableTransitionTile
                                    key={type}
                                    type={type}
                                    duration={TRANSITION_DEFAULT_DURATION[type] || 0.4}
                                    label={t(`transitions.${type}`, type.replace('-', ' '))}
                                    isApplied={activeClipInfo?.clip?.transition?.type === type}
                                    isFavorited={favoritedTransitions.has(type)}
                                    onApply={handleApplyTransition}
                                    onToggleFavorite={handleToggleFavorite}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Timeline Effects Section */}
                {filteredEffects.length > 0 && (
                    <div className="pt-2 border-t border-white/5">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-2">
                            <span>Timeline Effects ({filteredEffects.length})</span>
                            <span className="text-[9px] lowercase font-normal text-muted-foreground/60">
                                drag onto clip
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                            {filteredEffects.map(effect => (
                                <DraggableEffectTile
                                    key={effect.id}
                                    effect={effect}
                                    onApply={handleApplyEffectToSelected}
                                    onApplyAll={handleApplyEffectToAll}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {filteredTransitions.length === 0 && filteredEffects.length === 0 && (
                    <div className="py-8 text-center text-xs text-muted-foreground">
                        No transitions or effects matching "{search}"
                    </div>
                )}
            </div>

            {/* Footer Status Bar */}
            <div className="px-3.5 py-2 border-t border-white/10 bg-white/[0.02] flex items-center justify-between text-[11px] shrink-0">
                {activeClipInfo ? (
                    <div className="flex items-center justify-between w-full">
                        <span className="text-muted-foreground truncate max-w-[220px]">
                            Clip: <strong className="text-foreground">{activeClipInfo.clip.id}</strong>
                            {activeClipInfo.clip.transition && (
                                <span className="ml-1 text-primary">
                                    ({activeClipInfo.clip.transition.type} {activeClipInfo.clip.transition.duration}s)
                                </span>
                            )}
                        </span>
                        {activeClipInfo.clip.transition ? (
                            <button
                                type="button"
                                onClick={handleRemoveTransition}
                                className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-red-400 hover:bg-red-500/15 transition-colors"
                            >
                                <Trash2 size={11} /> Remove transition
                            </button>
                        ) : (
                            <span className="text-[10px] text-muted-foreground/60">Click any transition to apply</span>
                        )}
                    </div>
                ) : (
                    <div className="text-[10px] text-muted-foreground/70 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/70 animate-pulse" />
                        Drag any item onto a cut marker or select a clip
                    </div>
                )}
            </div>
        </div>
    );
}
