import React from 'react';
import ReactDOM from 'react-dom';
import {
    Scissors, Copy, Trash2, Zap, Volume2, VolumeX,
    FastForward, ChevronRight, Sparkles, Wind
} from 'lucide-react';
import useTimelineStore from '../../store/useTimelineStore';

// ── Helpers ──────────────────────────────────────────────────────────────────

const Separator = () => (
    <div className="my-1 border-t" style={{ borderColor: 'var(--line-soft)' }} />
);

const Item = ({ icon: Icon, label, hint, danger, disabled, onClick, children }) => (
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
        {children}
    </button>
);

const SpeedRow = ({ clip, trackId, onClose }) => {
    const speeds = [0.25, 0.5, 1, 1.5, 2];
    const current = clip.speed ?? 1;
    return (
        <div className="px-3 py-1.5 flex items-center gap-1.5">
            <FastForward className="w-3.5 h-3.5 shrink-0 opacity-70" />
            <span className="text-[12px] flex-1">Speed</span>
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

const ClipContextMenu = ({ clip, trackId, position, onClose }) => {
    const menuRef = React.useRef(null);
    const [pos, setPos] = React.useState(position);
    const copiedAttributes = useTimelineStore(s => s.copiedAttributes);

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
    const canSplit =
        currentTime > clip.start + 0.1 &&
        currentTime < clip.start + clip.duration - 0.1;

    const isMuted = (clip.volume ?? 1) === 0;
    const hasTransition = !!clip.transition;

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
                <p className="text-[10px] font-mono opacity-40 truncate">{clip.name}</p>
            </div>
            <Separator />

            {/* Edit group */}
            <Item
                icon={Scissors}
                label="Split at Playhead"
                hint="⌘B"
                disabled={!canSplit}
                onClick={() => run(() => store().splitClip(trackId, clip.id, currentTime))}
            />
            <Item
                icon={Copy}
                label="Duplicate"
                hint="⌘D"
                onClick={() => run(() => store().duplicateClip(trackId, clip.id))}
            />
            <Item
                icon={Copy}
                label="Copy Attributes"
                onClick={() => run(() => store().copyAttributes(clip.id))}
            />
            {copiedAttributes && (
                <Item
                    icon={Copy}
                    label="Paste Attributes"
                    onClick={() => run(() => store().pasteAttributes(trackId, clip.id))}
                />
            )}

            <Separator />

            {/* Delete group */}
            <Item
                icon={Zap}
                label="Ripple Delete"
                danger
                onClick={() => run(() => store().rippleDeleteClip(trackId, clip.id))}
            />
            <Item
                icon={Trash2}
                label="Delete"
                hint="⌫"
                danger
                onClick={() => run(() => store().removeClip(trackId, clip.id))}
            />

            <Separator />

            {/* Transitions */}
            <Item
                icon={Wind}
                label="Fade Out"
                onClick={() => run(() => store().addTransition(clip.id, 'fade', 1.0))}
            />
            <Item
                icon={Wind}
                label="Crossfade"
                onClick={() => run(() => store().addTransition(clip.id, 'crossfade', 1.0))}
            />
            {hasTransition && (
                <Item
                    icon={Wind}
                    label="Remove Transition"
                    onClick={() => run(() => store().updateClip(trackId, clip.id, { transition: null }))}
                />
            )}

            <Separator />

            {/* Speed row */}
            <SpeedRow clip={clip} trackId={trackId} onClose={onClose} />

            {/* Mute toggle */}
            <Item
                icon={isMuted ? Volume2 : VolumeX}
                label={isMuted ? 'Unmute Clip' : 'Mute Clip'}
                onClick={() => run(() =>
                    store().updateClip(trackId, clip.id, { volume: isMuted ? 1 : 0 })
                )}
            />

            <Separator />

            {/* Add filter */}
            <Item
                icon={Sparkles}
                label="Cinematic Filter"
                onClick={() => run(() => store().addFilter(clip.id, 'cinematic', 0.8))}
            />
        </div>
    );

    return ReactDOM.createPortal(menu, document.body);
};

export default ClipContextMenu;
