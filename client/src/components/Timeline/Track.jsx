import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import Clip from './Clip';
import { Video, Music, Type, Volume2, VolumeX, Headphones, X } from 'lucide-react';
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

// Desktop heights (unchanged from before this component became responsive).
const TRACK_H_VIDEO_AUDIO = 80; // h-20
const TRACK_H_TEXT        = 32; // h-8
// Mobile: the timeline container is only 144px tall (h-36) total, minus the
// 24px ruler — an 80px video/audio track left room for barely one track
// before scrolling was required, and clips rendered oversized relative to a
// phone screen. ~35% shorter keeps more tracks visible at once and clips feel
// proportionate to the rest of the mobile UI.
const TRACK_H_VIDEO_AUDIO_MOBILE = 52;
const TRACK_H_TEXT_MOBILE        = 22;

const Track = ({ track, labelWidth = 128, compact = false }) => {
    const { t } = useTranslation('editor');
    const { zoomLevel, duration } = useTimelineStore(useShallow(state => ({
        zoomLevel: state.zoomLevel,
        duration:  state.duration,
    })));
    const { setNodeRef, isOver } = useDroppable({
        id: track.id,
        data: { trackId: track.id }
    });

    const isText = track.type === 'text';
    const trackHeight = isText
        ? (compact ? TRACK_H_TEXT_MOBILE        : TRACK_H_TEXT)
        : (compact ? TRACK_H_VIDEO_AUDIO_MOBILE : TRACK_H_VIDEO_AUDIO);

    return (
        <div className="flex w-full mb-1 group">
            {/* Track Header — width driven by labelWidth (responsive, see
                Timeline.jsx's labelW) rather than a fixed Tailwind class, so it
                never desyncs from the ruler/playhead math that assumes the same
                value. */}
            <div
                className={classNames(
                    "bg-card border-r border-border flex flex-col justify-center px-2 shrink-0 select-none group/header relative",
                    isText ? "py-0.5 gap-0.5" : "py-1 gap-1",
                    track.type === 'video' && 'border-l-2 border-l-blue-500/50',
                    track.type === 'audio' && 'border-l-2 border-l-orange-500/50'
                )}
                style={{ width: `${labelWidth}px` }}
            >
                <div className="flex items-center gap-2 justify-between w-full">
                    <div className="flex items-center gap-1.5 overflow-hidden">
                        <TrackIcon type={track.type} />
                        <span className="text-[10px] font-medium text-muted-foreground truncate">{track.name}</span>
                    </div>
                    {/* Delete track — visible on header hover only */}
                    <button
                        onClick={() => useTimelineStore.getState().removeTrack(track.id)}
                        className="opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 w-4 h-4 rounded flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 text-muted-foreground"
                        title={t('timeline.deleteTrack')}
                    >
                        <X className="w-2.5 h-2.5" />
                    </button>
                </div>
                
                {/* Controls — audio/video tracks only */}
                {!isText && (
                    <div className="flex items-center gap-1 mt-0.5">
                        <button
                            onClick={() => useTimelineStore.getState().toggleTrackMute(track.id)}
                            className={classNames(
                                "w-5 h-5 rounded flex items-center justify-center transition-colors",
                                track.muted ? "bg-red-500/20 text-red-500" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                            )}
                            title={t('timeline.muteTrack')}
                        >
                            {track.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                        </button>
                        <button
                            onClick={() => useTimelineStore.getState().toggleTrackSolo(track.id)}
                            className={classNames(
                                "w-5 h-5 rounded flex items-center justify-center transition-colors",
                                track.solo ? "bg-yellow-500/20 text-yellow-500" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-white"
                            )}
                            title={t('timeline.soloTrack')}
                        >
                            <Headphones className="w-3 h-3" />
                        </button>
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
                )}
            </div>

            {/* Track Content Area — text tracks are slimmer (no waveform).
                Height comes from trackHeight (compact on mobile) rather than a
                fixed h-8/h-20 class, since Clip.jsx is absolutely positioned to
                fill this element (top-0 bottom-0) — shrinking it here is what
                actually makes clips smaller on mobile. */}
            <div
                ref={setNodeRef}
                className={classNames(
                    "flex-1 relative border-b border-white/5 transition-colors",
                    isOver ? "bg-white/5" : "bg-black/20 group-hover:bg-black/30"
                )}
                style={{ width: `${duration * zoomLevel}px`, minWidth: '100%', height: `${trackHeight}px` }}
            >
                {/* Grid Lines (Optional) */}
                <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(90deg,transparent_99%,#fff_100%)] bg-[length:100px_100%]"></div>

                {track.clips.map(clip => (
                    <Clip key={clip.id} clip={clip} trackId={track.id} />
                ))}
            </div>
        </div>
    );
};

export default Track;
