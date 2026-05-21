import React, { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Video, Music, Image as ImageIcon, Trash2, Loader2, Plus } from 'lucide-react';
import useTimelineStore from '../store/useTimelineStore';
import useDeviceType from '../hooks/useDeviceType';

// Helper to format duration like 1:05
const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const DraggableAsset = ({ asset }) => {
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
                <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center pointer-events-none z-10 backdrop-blur-[2px]">
                    <Loader2 className="w-5 h-5 text-primary animate-spin mb-1" />
                    <span className="text-[8px] text-primary/80 font-bold uppercase tracking-widest text-center px-2">Optimizing<br/>Preview</span>
                </div>
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
