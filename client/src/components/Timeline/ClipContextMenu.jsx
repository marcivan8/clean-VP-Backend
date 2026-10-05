import React from 'react';
import ReactDOM from 'react-dom';
import {
    Scissors, Copy, Trash2, Zap, Volume2, VolumeX,
    FastForward, ChevronRight, Sparkles, Wind, Heart, ClipboardPaste
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useTimelineStore from '../../store/useTimelineStore';
import { audioEngineAPI } from '../../audio-engine/AudioEngineAPI.js';
import { findGapAt } from '../../timeline/rippleDelete.js';
import { TRANSITION_TYPES, TRANSITION_DEFAULT_DURATION, normalizeTransitionType } from '../../motion/TransitionFX.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const Separator = () => (
    <div className="my-1 border-t" style={{ borderColor: 'var(--line-soft)' }} />
);

const Item = ({ icon: Icon, label, hint, danger, disabled, onClick, children, trailing }) => (
    <button
        className={[
            'w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[12px] rounded transition-colors',
            disabled
                ? 'opacity-30 cursor-not-allowed'
                : danger
                    ? 'hover:bg-red-500/20 text-red-400'
                    : 'hover:bg-white/8 text-foreground',
        ].join(' ')}
        disabled={disabled}
        onClick={disabled ? undefined : onClick}
    >
        {Icon && <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />}
        <span className="flex-1">{label}</span>
        {hint && <span className="text-[10px] opacity-40 font-mono">{hint}</span>}
        {trailing && (
            <span onClick={e => e.stopPropagation()} className="flex items-center shrink-0">
                {trailing}
            </span>
        )}
        {children}
    </button>
);

// Small heart toggle used to favorite a transition type — bookmarks the type
// itself (not a custom preset) via routes/favoritesRoutes.js. Manages its own
// membership check against the favoritedTransitionTypes set passed down from
// the menu root so repeated opens reflect the latest state.
const FavoriteTransitionToggle = ({ transitionType, favorited, onToggle }) => {
    const { t } = useTranslation('editor');
    return (
    <button
        title={favorited ? t('timeline.removeFromFavorites') : t('timeline.favoriteThisTransition')}
        onClick={e => { e.stopPropagation(); onToggle(transitionType, favorited); }}
        className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
    >
        <Heart
            className="w-3 h-3"
            style={{ color: favorited ? '#ff3a6e' : 'rgba(255,255,255,0.35)' }}
            fill={favorited ? '#ff3a6e' : 'none'}
        />
    </button>
    );
};

const SpeedRow = ({ clip, trackId, onClose }) => {
    const { t } = useTranslation('editor');
    const speeds = [0.25, 0.5, 1, 1.5, 2];
    const current = clip?.speed ?? 1;
    const disabled = !clip;
    return (
        <div className={`px-3 py-1.5 flex items-center gap-1.5 ${disabled ? 'opacity-30 pointer-events-none' : ''}`}>
            <FastForward className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="text-[12px] flex-1">{t('timeline.speed')}</span>
            <div className="flex gap-1">
                {speeds.map(s => (
                    <button
                        key={s}
                        className={[
                            'text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors',
                            current === s
                                ? 'bg-primary text-primary-foreground'
                                : 'bg-white/10 hover:bg-white/20 text-foreground',
                        ].join(' ')}
                        onClick={() => {
                            useTimelineStore.getState().setClipSpeed(trackId, clip.id, s);
                            onClose();
                        }}
                    >
                        {s}×
                    </button>
                ))}
            </div>
        </div>
    );
};

// ── Main component ────────────────────────────────────────────────────────────

/**
 * `clip` may be null when the menu is opened by right-clicking empty timeline
 * space with nothing selected: every clip action is then shown greyed out.
 * `spot` ({ trackId, time }) is passed only for empty-space right-clicks. It
 * adds "Paste here" at the clicked time, and makes "Ripple Delete" close the
 * empty gap that was right-clicked (whatever is selected) — the clicked spot
 * is what the user is pointing at. Right-click a clip to ripple-delete a clip.
 */
const ClipContextMenu = ({ clip, trackId, position, onClose, spot = null }) => {
    const { t } = useTranslation('editor');
    const menuRef = React.useRef(null);
    const [pos, setPos] = React.useState(position);
    const copiedAttributes = useTimelineStore(s => s.copiedAttributes);
    const clipboard = useTimelineStore(s => s.clipboard);
    const noClip = !clip;
    const gap = spot ? findGapAt(useTimelineStore.getState().tracks, spot.trackId, spot.time) : null;
    const [favoritedTransitions, setFavoritedTransitions] = React.useState(() => new Set());

    // Load favorited transition types once per menu open — cheap, and keeps the
    // heart icons accurate even if favorited elsewhere in the session.
    React.useEffect(() => {
        let cancelled = false;
        audioEngineAPI.getFavorites()
            .then(({ transitionTypes }) => { if (!cancelled) setFavoritedTransitions(new Set(transitionTypes || [])); })
            .catch(err => console.error('[ClipContextMenu] getFavorites failed:', err.message));
        return () => { cancelled = true; };
    }, []);

    const toggleTransitionFavorite = React.useCallback(async (transitionType, wasFavorited) => {
        setFavoritedTransitions(prev => {
            const next = new Set(prev);
            if (wasFavorited) next.delete(transitionType); else next.add(transitionType);
            return next;
        });
        try {
            if (wasFavorited) {
                await audioEngineAPI.removeFavorite({ transitionType });
            } else {
                await audioEngineAPI.addFavorite({ transitionType });
            }
        } catch (err) {
            console.error('[ClipContextMenu] toggleTransitionFavorite failed:', err.message);
            setFavoritedTransitions(prev => {
                const next = new Set(prev);
                if (wasFavorited) next.add(transitionType); else next.delete(transitionType);
                return next;
            });
        }
    }, []);

    // Adjust position to keep menu inside viewport
    React.useLayoutEffect(() => {
        if (!menuRef.current) return;
        const { width, height } = menuRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        setPos({
            x: Math.min(position.x, vw - width - 8),
            y: Math.min(position.y, vh - height - 8),
        });
    }, [position]);

    // Close on outside click or Escape
    React.useEffect(() => {
        const onDown = (e) => {
            if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
        };
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const store = () => useTimelineStore.getState();
    const currentTime = useTimelineStore.getState().currentTime;
    const canSplit = !noClip &&
        currentTime > clip.start + 0.1 &&
        currentTime < clip.start + clip.duration - 0.1;

    const isMuted = !noClip && (clip.volume ?? 1) === 0;
    const hasTransition = !noClip && !!clip.transition;

    const run = (fn) => { fn(); onClose(); };

    const menu = (
        <div
            ref={menuRef}
            className="fixed z-[9999] w-52 rounded-xl border shadow-2xl py-1.5 select-none"
            style={{
                left: pos.x,
                top: pos.y,
                background: 'var(--bg-2, #1a1a1a)',
                borderColor: 'var(--line-soft, rgba(255,255,255,0.1))',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
            onContextMenu={(e) => e.preventDefault()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Clip name header */}
            <div className="px-3 pb-1 pt-0.5">
                <p className="text-[10px] font-mono opacity-40 truncate">{noClip ? t('timeline.noClipSelected') : clip.name}</p>
            </div>
            <Separator />

            {/* Clipboard group */}
            <Item
                icon={Copy}
                label={t('timeline.copy')}
                hint="⌘C"
                disabled={noClip}
                onClick={() => run(() => store().copyClip(clip.id))}
            />
            {spot && (
                <Item
                    icon={ClipboardPaste}
                    label={t('timeline.pasteHere')}
                    disabled={!clipboard}
                    onClick={() => run(() => store().pasteClipAt(spot.trackId, spot.time))}
                />
            )}
            <Separator />

            {/* Edit group */}
            <Item
                icon={Scissors}
                label={t('timeline.splitAtPlayhead')}
                hint="⌘B"
                disabled={!canSplit}
                onClick={() => run(() => store().splitClip(trackId, clip.id, currentTime))}
            />
            <Item
                icon={Copy}
                label={t('timeline.duplicate')}
                hint="⌘D"
                disabled={noClip}
                onClick={() => run(() => store().duplicateClip(trackId, clip.id))}
            />
            <Item
                icon={Copy}
                label={t('timeline.copyAttributes')}
                disabled={noClip}
                onClick={() => run(() => store().copyAttributes(clip.id))}
            />
            {copiedAttributes && (
                <Item
                    icon={Copy}
                    label={t('timeline.pasteAttributes')}
                    disabled={noClip}
                    onClick={() => run(() => store().pasteAttributes(trackId, clip.id))}
                />
            )}

            <Separator />

            {/* Delete group */}
            {spot ? (
                // Empty-space menu: ripple-delete the gap that was right-clicked.
                <Item
                    icon={Zap}
                    label={t('timeline.rippleDelete')}
                    hint={gap ? `${(gap[1] - gap[0]).toFixed(1)}s` : undefined}
                    danger
                    disabled={!gap}
                    onClick={() => run(() => store().rippleDeleteGap(spot.trackId, spot.time))}
                />
            ) : (
                <Item
                    icon={Zap}
                    label={t('timeline.rippleDelete')}
                    danger
                    disabled={noClip}
                    onClick={() => run(() => store().rippleDeleteClip(trackId, clip.id))}
                />
            )}
            <Item
                icon={Trash2}
                label={t('timeline.delete')}
                hint="⌫"
                danger
                disabled={noClip}
                onClick={() => run(() => store().deleteClipWithMagnet(trackId, clip.id))}
            />

            <Separator />

            {/* Transitions (R89 pack). Set on this clip = played at its END,
                centred on the cut into the next clip. */}
            {TRANSITION_TYPES.map(type => (
                <Item
                    key={type}
                    icon={Wind}
                    label={t(`transitions.${type}`)}
                    disabled={noClip}
                    hint={!noClip && normalizeTransitionType(clip.transition?.type) === type ? '✓' : undefined}
                    onClick={() => run(() => store().addTransition(clip.id, type, TRANSITION_DEFAULT_DURATION[type]))}
                    trailing={
                        <FavoriteTransitionToggle
                            transitionType={type}
                            favorited={favoritedTransitions.has(type)}
                            onToggle={toggleTransitionFavorite}
                        />
                    }
                />
            ))}
            {hasTransition && (
                <Item
                    icon={Wind}
                    label={t('timeline.removeTransition')}
                    onClick={() => run(() => store().updateClip(trackId, clip.id, { transition: null }))}
                />
            )}

            <Separator />

            {/* Speed row */}
            <SpeedRow clip={clip} trackId={trackId} onClose={onClose} />

            {/* Mute toggle */}
            <Item
                icon={isMuted ? Volume2 : VolumeX}
                label={isMuted ? t('timeline.unmuteClip') : t('timeline.muteClip')}
                disabled={noClip}
                onClick={() => run(() =>
                    store().updateClip(trackId, clip.id, { volume: isMuted ? 1 : 0 })
                )}
            />

            <Separator />

            {/* Add filter */}
            <Item
                icon={Sparkles}
                label={t('timeline.cinematicFilter')}
                disabled={noClip}
                onClick={() => run(() => store().addFilter(clip.id, 'cinematic', 0.8))}
            />
        </div>
    );

    return ReactDOM.createPortal(menu, document.body);
};

export default ClipContextMenu;
