import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import Clip from './Clip';
import ClipContextMenu from './ClipContextMenu';
import { Video, Music, Type, Volume2, VolumeX, Headphones, X } from 'lucide-react';
import classNames from 'classnames';
import useTimelineStore from '../../store/useTimelineStore';
import { getAssetDropTime } from '../../timeline/assetDropPosition.js';
import MobileSheet, { SheetLabel, SheetRow } from '../MobileSheet';

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

/**
 * Mobile track header: a slim icon strip instead of the desktop header
 * (name + mute/solo/volume), which didn't fit a phone ('Vid…'). Tapping the
 * icon opens the track options sheet: mute, solo, volume, delete. A muted or
 * solo track shows it on the strip so the state is never hidden.
 */
const STRIP_COLORS = { video: 'var(--accent)', audio: 'var(--coral)', text: 'var(--mint)', image: 'var(--accent)' };
const TrackStrip = ({ track, width }) => {
    const { t } = useTranslation('editor');
    const [open, setOpen] = React.useState(false);
    const isText = track.type === 'text';
    const color = STRIP_COLORS[track.type] || 'var(--fg-3)';
    const typeLabel = track.type === 'audio' ? t('mobileUi.trackAudio') : isText ? t('mobileUi.trackText') : t('mobileUi.trackVideo');
    const Icon = track.type === 'audio' ? Music : isText ? Type : Video;
    const st = () => useTimelineStore.getState();
    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label={`${t('mobileUi.trackOptions')}: ${track.name || typeLabel}`}
                aria-haspopup="dialog"
                className="shrink-0 select-none flex flex-col items-center justify-center relative"
                style={{
                    width: `${width}px`, padding: 0, border: 0, borderRight: '1px solid var(--line-soft)',
                    background: 'var(--bg-2)', color, touchAction: 'manipulation', cursor: 'pointer',
                }}
            >
                <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 4, bottom: 4, width: 2, borderRadius: 1, background: color, opacity: 0.7 }} />
                {track.muted ? <VolumeX className="w-3.5 h-3.5" style={{ color: 'var(--coral)' }} /> : <Icon className="w-3.5 h-3.5" />}
                {track.solo && !isText && <Headphones className="w-2.5 h-2.5 mt-0.5" style={{ color: 'var(--fg)' }} />}
            </button>
            <MobileSheet open={open} title={track.name || typeLabel} onClose={() => setOpen(false)}>
                {!isText && (
                    <>
                        <SheetRow
                            icon={track.muted ? <Volume2 size={20} /> : <VolumeX size={20} />}
                            label={track.muted ? t('mobileUi.unmute') : t('mobileUi.mute')}
                            onClick={() => st().toggleTrackMute(track.id)}
                        />
                        <SheetRow
                            icon={<Headphones size={20} />}
                            label={track.solo ? t('mobileUi.unsolo') : t('mobileUi.solo')}
                            onClick={() => st().toggleTrackSolo(track.id)}
                        />
                        <SheetLabel>{t('mobileUi.volume')}</SheetLabel>
                        <input
                            type="range" min="0" max="1" step="0.05"
                            aria-label={t('mobileUi.volume')}
                            value={track.volume ?? 1}
                            onChange={(e) => st().setTrackVolume(track.id, parseFloat(e.target.value))}
                            style={{ width: '100%', height: 32, accentColor: 'var(--accent)' }}
                        />
                    </>
                )}
                <SheetRow
                    icon={<X size={20} />}
                    label={t('mobileUi.deleteTrack')}
                    danger
                    onClick={() => { setOpen(false); st().removeTrack(track.id); }}
                />
            </MobileSheet>
        </>
    );
};

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
    const [assetDropX, setAssetDropX] = React.useState(null);
    const onLaneDragOver = (event) => {
        const types = Array.from(event.dataTransfer?.types || []);
        if (!types.includes('application/x-vibed-asset-id') && !types.includes('text/plain')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        const rect = event.currentTarget.getBoundingClientRect();
        setAssetDropX(Math.max(0, event.clientX - rect.left));
    };
    const onLaneDragLeave = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setAssetDropX(null);
    };
    const onLaneDrop = (event) => {
        const assetId = event.dataTransfer?.getData('application/x-vibed-asset-id')
            || event.dataTransfer?.getData('text/plain');
        if (!assetId) return;
        event.preventDefault();
        event.stopPropagation();
        setAssetDropX(null);

        const state = useTimelineStore.getState();
        const asset = state.assets.find(item => item.id === assetId);
        if (!asset) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const start = getAssetDropTime({
            clientX: event.clientX,
            laneLeft: rect.left,
            zoomLevel: state.zoomLevel,
            currentTime: state.currentTime,
        });
        const clipDuration = asset.type === 'image' ? 5 : (asset.duration || asset.sourceDuration || 10);
        const overlaps = (state.tracks.find(item => item.id === track.id)?.clips || []).some(clip =>
            start < clip.start + clip.duration - 0.01 && start + clipDuration > clip.start + 0.01
        );
        const trackId = overlaps
            ? state.addTrack(asset.type === 'audio' ? 'audio' : 'video')
            : track.id;
        state.addClip(trackId, {
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            assetId: asset.id,
            start,
            duration: clipDuration,
            name: asset.name,
            color: asset.type === 'audio' ? 'bg-orange-500' : 'bg-blue-500',
            url: asset.url,
            sourceUrl: asset.sourceUrl || asset.url,
            speed: 1,
            volume: 1,
            metadata: { fps: asset.fps, resolution: asset.resolution },
        });
    };

    // Right-click on empty lane space (desktop): the clip menu for the current
    // selection, plus "Paste here" at the clicked time. Clip.jsx's own
    // onContextMenu stops propagation, so this only fires off-clip.
    const [emptyMenu, setEmptyMenu] = React.useState(null);
    const handleLaneContextMenu = (e) => {
        if (compact) return; // mobile has its own clip toolbar
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const time = Math.max(0, (e.clientX - rect.left) / (zoomLevel || 1));
        const st = useTimelineStore.getState();
        const selId = st.activeClipId || st.selectedClipIds[st.selectedClipIds.length - 1] || null;
        let target = null;
        if (selId) {
            for (const tr of st.tracks) {
                const c = tr.clips.find(cl => cl.id === selId);
                if (c) { target = { clip: c, trackId: tr.id }; break; }
            }
        }
        setEmptyMenu({ x: e.clientX, y: e.clientY, time, target });
    };

    const isText = track.type === 'text';
    const trackHeight = isText
        ? (compact ? TRACK_H_TEXT_MOBILE        : TRACK_H_TEXT)
        : (compact ? TRACK_H_VIDEO_AUDIO_MOBILE : TRACK_H_VIDEO_AUDIO);

    return (
        <div className="flex w-full mb-1 group">
            {compact && <TrackStrip track={track} width={labelWidth} />}
            {/* Track Header (desktop) — width driven by labelWidth (responsive, see
                Timeline.jsx's labelW) rather than a fixed Tailwind class, so it
                never desyncs from the ruler/playhead math that assumes the same
                value. */}
            {!compact && (
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

            )}

            {/* Track Content Area — text tracks are slimmer (no waveform).
                Height comes from trackHeight (compact on mobile) rather than a
                fixed h-8/h-20 class, since Clip.jsx is absolutely positioned to
                fill this element (top-0 bottom-0) — shrinking it here is what
                actually makes clips smaller on mobile. */}
            <div
                ref={setNodeRef}
                data-timeline-track={track.id}
                className={classNames(
                    "flex-1 relative border-b border-white/5 transition-colors",
                    isOver ? "bg-white/5" : "bg-black/20 group-hover:bg-black/30"
                )}
                style={{ width: `${duration * zoomLevel}px`, minWidth: '100%', height: `${trackHeight}px` }}
                onContextMenu={handleLaneContextMenu}
                onDragOver={onLaneDragOver}
                onDragLeave={onLaneDragLeave}
                onDrop={onLaneDrop}
            >
                {/* Grid Lines (Optional) */}
                <div className="absolute inset-0 pointer-events-none opacity-10 bg-[linear-gradient(90deg,transparent_99%,#fff_100%)] bg-[length:100px_100%]"></div>

                {track.clips.map(clip => (
                    <Clip key={clip.id} clip={clip} trackId={track.id} />
                ))}
                {assetDropX !== null && (
                    <div
                        data-testid="asset-drop-indicator"
                        className="absolute top-0 bottom-0 z-[60] w-0.5 bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)] pointer-events-none"
                        style={{ left: `${assetDropX}px` }}
                    >
                        <span className="absolute -top-1 -left-[3px] h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(103,232,249,0.9)]" />
                    </div>
                )}
            </div>
            {emptyMenu && (
                <ClipContextMenu
                    clip={emptyMenu.target?.clip || null}
                    trackId={emptyMenu.target?.trackId || track.id}
                    position={{ x: emptyMenu.x, y: emptyMenu.y }}
                    spot={{ trackId: track.id, time: emptyMenu.time }}
                    onClose={() => setEmptyMenu(null)}
                />
            )}
        </div>
    );
};

export default Track;
