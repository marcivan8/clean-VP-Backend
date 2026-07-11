import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import Clip from './Clip';
import Waveform from './Waveform';
import { Video, Music, Type, Volume2, VolumeX, Headphones } from 'lucide-react';
import classNames from 'classnames';
import useTimelineStore from '../../store/useTimelineStore';

const TrackIcon = ({ type }) => {
    switch (type) {
        case 'video': return <Video className="w-3 h-3 text-blue-300" />;
        case 'audio': return <Music className="w-3 h-3 text-orange-300" />;
        case 'text': return <Type className="w-3 h-3 text-green-300" />;
        default: return null;
    }
};

const CLIP_ZONE_HEIGHT = 30; // px — compact clip strip for video/audio tracks

const Track = ({ track }) => {
    const { zoomLevel, duration, waveforms } = useTimelineStore(useShallow(state => ({
        zoomLevel: state.zoomLevel,
        duration:  state.duration,
        waveforms: state.waveforms,
    })));
    const { setNodeRef, isOver } = useDroppable({
        id: track.id,
        data: { trackId: track.id }
    });

    const isTextTrack = track.type === 'text';
    const waveformData = !isTextTrack
        ? (waveforms?.[track.id] ?? waveforms?.['video_main'] ?? null)
        : null;

    return (
        <div className="flex w-full mb-1 group">
            {/* Track Header */}
            <div className={classNames(
                "w-32 bg-card border-r border-border flex flex-col justify-center px-2 py-1 gap-1 shrink-0 select-none group/header relative",
                track.type === 'video' && 'border-l-2 border-l-blue-500/50',
                track.type === 'audio' && 'border-l-2 border-l-orange-500/50'
            )}>
                <div className="flex items-center gap-2 justify-between w-full">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                        <TrackIcon type={track.type} />
                        <span className="text-[10px] font-medium text-muted-foreground truncate">{track.name}</span>
                    </div>
                </div>
                
                {/* Controls that appear on hover or when active */}
                <div className="flex items-center gap-1 mt-0.5">
                    <button 
                        onClick={() => useTimelineStore.getState().toggleTrackMute(track.id)}
                        className={classNames(
                            "w-5 h-5 rounded flex items-center justify-center transition-colors",
                            track.muted ? "bg-red-500/20 text-red-500" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                        )}
                        title="Mute Track"
                    >
                        {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                    </button>
                    <button 
                        onClick={() => useTimelineStore.getState().toggleTrackSolo(track.id)}
                        className={classNames(
                            "w-5 h-5 rounded flex items-center justify-center transition-colors",
                            track.solo ? "bg-yellow-500/20 text-yellow-500" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                        )}
                        title="Solo Track"
                    >
                        <Headphones className="w-3 h-3" />
                    </button>
                    {/* Volume Slider Popover/Hover */}
                    <div className="flex-1 px-1 pointer-events-auto opacity-0 group-hover/header:opacity-100 transition-opacity flex items-center">
                        <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.05" 
                            value={track.volume ?? 1} 
                            onChange={(e) => useTimelineStore.getState().setTrackVolume(track.id, parseFloat(e.target.value))}
                            className="w-full h-1 bg-secondary rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white cursor-pointer"
                        />
                    </div>
                </div>
            </div>

            {/* Track Content Area */}
            <div
                ref={setNodeRef}
                className={classNames(
                    "flex-1 relative h-20 border-b border-white/5 transition-colors flex flex-col",
                    isOver ? "bg-white/5" : "bg-black/20 group-hover:bg-black/30"
                )}
                style={{ width: `${duration * zoomLevel}px`, minWidth: '100%' }}
            >
                {/* Grid Lines */}
                <div className="absolute inset-0 pointer-events-none opacity-10 z-0 bg-[linear-gradient(90deg,transparent_99%,#fff_100%)] bg-[length:100px_100%]" />

                {isTextTrack ? (
                    /* Text tracks: clips fill the full height */
                    <div className="relative flex-1 z-10">
                        {track.clips.map(clip => (
                            <Clip key={clip.id} clip={clip} trackId={track.id} />
                        ))}
                    </div>
                ) : (
                    <>
                        {/* Compact clip strip */}
                        <div className="relative z-10 shrink-0" style={{ height: CLIP_ZONE_HEIGHT }}>
                            {track.clips.map(clip => (
                                <Clip key={clip.id} clip={clip} trackId={track.id} />
                            ))}
                        </div>

                        {/* Continuous waveform strip */}
                        <div
                            className="flex-1 relative overflow-hidden"
                            style={{ background: 'rgb(8, 10, 20)' }}
                        >
                            {waveformData && (
                                <Waveform
                                    peaks={waveformData.peaks}
                                    duration={waveformData.duration}
                                    offset={0}
                                    zoomLevel={zoomLevel}
                                    waveColor={
                                        track.type === 'audio'
                                            ? 'rgba(251, 146, 60, 0.85)'
                                            : 'rgba(52, 211, 153, 0.85)'
                                    }
                                    bgColor="rgb(8, 10, 20)"
                                />
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Track;
