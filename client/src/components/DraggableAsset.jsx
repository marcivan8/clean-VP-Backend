import React, { useState, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Video, Music, Image as ImageIcon, Trash2, Loader2, Plus } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore';
import useDeviceType from '../hooks/useDeviceType';

const PHASES = ['uploading', 'processing', 'ready'];
const PHASE_LABELS = { uploading: 'Uploading', processing: 'Processing', ready: 'Ready' };

const ProxyingOverlay = ({ asset }) => {
    const [showLargeFileMsg, setShowLargeFileMsg] = useState(false);

    useEffect(() => {
        const elapsed = Date.now() - (asset.uploadStartTime || Date.now());
        const remaining = Math.max(0, 10000 - elapsed);
        const t = setTimeout(() => setShowLargeFileMsg(true), remaining);
        return () => clearTimeout(t);
    }, [asset.uploadStartTime]);

    const phase = asset.uploadPhase || 'uploading';
    const phaseIdx = PHASES.indexOf(phase);

    return (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(1px)' }}>
            <div className="flex flex-col items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(0,0,0,0.55)' }}>
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
                {/* Step dots */}
                <div className="flex items-center gap-1">
                    {PHASES.map((p, i) => (
                        <React.Fragment key={p}>
                            <span className="w-1.5 h-1.5 rounded-full transition-colors" style={{ background: i <= phaseIdx ? 'var(--accent)' : 'rgba(255,255,255,0.2)' }} />
                            {i < PHASES.length - 1 && <span className="w-2 h-px" style={{ background: i < phaseIdx ? 'var(--accent)' : 'rgba(255,255,255,0.15)' }} />}
                        </React.Fragment>
                    ))}
                </div>
                <span className="text-[8px] font-mono uppercase tracking-widest" style={{ color: 'var(--fg-3)' }}>
                    {PHASE_LABELS[phase]}
                </span>
                {showLargeFileMsg && (
                    <span className="text-[7px] text-center leading-tight mt-0.5 px-1" style={{ color: 'var(--fg-4)', maxWidth: 90 }}>
                        Creating a lightweight preview so editing stays fast
                    </span>
                )}
            </div>
        </div>
    );
};

// Helper to format duration like 1:05
const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const DraggableAsset = ({ asset, listView = false, gradientColors = ["#3B5BE4","#5B3BE4"], isActive = false }) => {
    const { isTouch } = useDeviceType();
    const [addedOverlay, setAddedOverlay] = useState(false);
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: `asset-${asset.id}`,
        data: {
            type: 'asset',
            asset: asset // Pass full asset data for the drop handler
        }
    });

    const removeAsset = useTimelineStore(state => state.removeAsset);

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
        opacity: 0.8
    } : undefined;

    const Icon = asset.type === 'video' ? Video : asset.type === 'audio' ? Music : ImageIcon;
    const dur = asset.sourceDuration || asset.duration || 0;
    const mm = Math.floor(dur / 60).toString().padStart(2, '0');
    const ss = Math.floor(dur % 60).toString().padStart(2, '0');

    if (listView) {
        return (
            <div
                ref={setNodeRef}
                {...listeners}
                {...attributes}
                style={{ ...style, background: isActive ? "color-mix(in oklch, oklch(0.66 0.16 268) 14%, transparent)" : "transparent", cursor: "grab" }}
                className="flex items-center gap-2.5 px-3 py-1.5 mx-1 rounded-md transition-colors hover:bg-[rgba(255,255,255,0.04)] active:cursor-grabbing"
            >
                <div className="w-[22px] h-[22px] rounded-[4px] shrink-0 overflow-hidden flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${gradientColors[0]}, ${gradientColors[1]})` }}>
                    {asset.thumbnail
                        ? <img src={asset.thumbnail} className="w-full h-full object-cover" />
                        : <Icon className="w-3 h-3 text-white opacity-70" />
                    }
                    {asset.isProxying && <Loader2 className="w-3 h-3 text-white animate-spin absolute" />}
                </div>
                <span className="flex-1 truncate" style={{ fontFamily: "var(--f-sans)", fontSize: 12, color: isActive ? "var(--fg)" : "var(--fg-2)" }}>{asset.name}</span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--fg-4)", flexShrink: 0 }}>{mm}:{ss}</span>
            </div>
        );
    }

    return (
        <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            style={style}
            onClick={() => {
                if (isTouch && !asset.isProxying) {
                    useTimelineStore.getState().addAssetToTimeline(asset);
                    setAddedOverlay(true);
                    setTimeout(() => setAddedOverlay(false), 1000);
                }
            }}
            className="aspect-video bg-secondary/30 border border-border rounded-md relative group overflow-hidden cursor-grab active:cursor-grabbing hover:border-primary/50 transition-colors"
        >
            {/* Delete Button */}
            <button
                className="absolute top-1 right-1 z-50 p-1 bg-black/60 hover:bg-red-500/80 rounded-full opacity-0 group-hover:opacity-100 transition-all scale-90 hover:scale-100 pointer-events-auto cursor-pointer"
                onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (confirm("Delete this asset?")) {
                        removeAsset(asset.id);
                    }
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                }}
                title="Delete Asset"
            >
                <Trash2 className="w-3 h-3 text-white" />
            </button>

            {/* Thumbnail Image or Placeholder */}
            {asset.thumbnail ? (
                <img src={asset.thumbnail} alt={asset.name} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
            ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                    <Icon className="w-8 h-8 text-primary opacity-50" />
                </div>
            )}

            {/* Badges (Duration, Resolution) */}
            <div className="absolute top-1 left-1 flex flex-col gap-1 pointer-events-none">
                {asset.duration > 0 && (
                    <span className="bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded backdrop-blur-sm w-fit font-mono">
                        {formatTime(asset.duration)}
                    </span>
                )}
                {asset.resolution && (
                    <span className="bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded backdrop-blur-sm w-fit font-mono">
                        {asset.resolution.w}p
                    </span>
                )}
            </div>

            <div className="absolute bottom-0 inset-x-0 bg-black/60 p-2">
                <p className="text-[10px] text-white truncate" title={asset.name}>{asset.name}</p>
            </div>

            {/* Proxying Overlay */}
            {asset.isProxying && (
                <ProxyingOverlay asset={asset} />
            )}

            {/* Hint Overlay (Desktop) / Add Button (Mobile) */}
            {!isTouch && (
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[10px] text-white font-medium">Drag to Timeline</span>
                </div>
            )}
            
            {isTouch && !asset.isProxying && (
                <div className="absolute inset-0 bg-black/40 opacity-0 active:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                    <Plus className="w-8 h-8 text-white drop-shadow-md" />
                </div>
            )}
            
            {addedOverlay && (
                <div className="absolute inset-0 bg-green-500/80 flex items-center justify-center z-20 transition-all">
                    <span className="text-white text-xs font-bold shadow-sm">Added!</span>
                </div>
            )}
        </div>
    );
};

export default DraggableAsset;
