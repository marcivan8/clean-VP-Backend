import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../../store/useTimelineStore';
import { authFetch } from '../../utils/authFetch';
import { pollJobResult } from '../../utils/jobPoller';
import { Volume2, Mic, Settings2, Sliders, Activity, Loader2 } from 'lucide-react';

const MixerPanel = () => {
    const {
        tracks,
        activeClipId,
        updateClip,
        updateTrackVolume,
        toggleTrackMute,
        toggleTrackSolo,
        audioLevels
    } = useTimelineStore(useShallow(state => ({
        tracks:            state.tracks,
        activeClipId:      state.activeClipId,
        updateClip:        state.updateClip,
        updateTrackVolume: state.updateTrackVolume,
        toggleTrackMute:   state.toggleTrackMute,
        toggleTrackSolo:   state.toggleTrackSolo,
        audioLevels:       state.audioLevels,
    })));

    const [processing, setProcessing] = React.useState({});
    const volumeRef = React.useRef(null);

    // Local slider state while the user is dragging — avoids updating the store (and
    // therefore playerVariables) on every mouse-move event. Without this, each tick
    // of the range input triggers a Revideo scene reload which jumps the playhead.
    const [localVolume, setLocalVolume] = React.useState(null);

    // Reset local volume when the selected clip changes so the slider stays in sync.
    React.useEffect(() => { setLocalVolume(null); }, [activeClipId]);

    // TASK 8: Scroll to volume/fade controls when an audio clip is selected
    React.useEffect(() => {
        if (!activeClipId) return;
        // Small delay to let the tab switch + render complete first
        const t = setTimeout(() => {
            volumeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        return () => clearTimeout(t);
    }, [activeClipId]);

    let activeClip = null;
    let activeTrackId = null;
    if (activeClipId) {
        for (const track of tracks) {
            const clip = track.clips.find(c => c.id === activeClipId);
            if (clip) { activeClip = clip; activeTrackId = track.id; break; }
        }
    }

    const updateActive = (updates) => {
        if (activeTrackId && activeClip) updateClip(activeTrackId, activeClip.id, updates);
    };

    const runAudioProcess = async (type) => {
        if (!activeClip) return;
        const store = useTimelineStore.getState();

        // Derive the server-side GCS path from the active clip's asset.
        // Priority: raw GCS path embedded in sourceUrl > global uploadedFilePath fallback.
        // Using uploadedFilePath alone is wrong for multi-clip projects — it always
        // points to whichever file was uploaded last, not the currently selected clip.
        const asset = store.assets.find(a => a.id === activeClip.assetId);
        let filename = null;
        if (asset?.sourceUrl) {
            // sourceUrl format: 'https://storage.googleapis.com/BUCKET/raw/userId/file.mp4'
            const match = asset.sourceUrl.match(/storage\.googleapis\.com\/[^/]+\/(.+)/);
            if (match) filename = match[1]; // yields 'raw/userId/file.mp4'
        }
        if (!filename) filename = store.uploadedFilePath || null;
        if (!filename) {
            console.error(`[MixerPanel] ${type}: no server-side path for clip "${activeClip.id}" — cannot process`);
            return;
        }

        setProcessing(p => ({ ...p, [type]: true }));
        try {
            const endpoint = type === 'denoise' ? '/api/audio/denoise' : '/api/audio/normalize';
            const res = await authFetch(endpoint, {
                method: 'POST',
                body: JSON.stringify({ filename }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `${type} failed (${res.status})`);
            }
            const data = await res.json();
            if (data.jobId) {
                const result = await pollJobResult(data.jobId);
                if (result?.url) {
                    // Update asset proxyUrl so the player picks up the processed file
                    if (asset) store.updateAsset(asset.id, { proxyUrl: result.url });
                    updateActive({ [type]: true });
                }
            }
        } catch (err) {
            console.error(`[MixerPanel] ${type} failed:`, err.message);
        } finally {
            setProcessing(p => ({ ...p, [type]: false }));
        }
    };

    // Text tracks don't carry audio — exclude them from the mixer
    const audioTracks = tracks.filter(t => t.type !== 'text');

    return (
        <div className="flex flex-col h-full bg-gray-900/50 p-4 border-l border-white/5 font-sans overflow-hidden">

            {/* 1. INSPECTOR SECTION */}
            <div className="mb-6 border-b border-white/10 pb-6 flex-shrink-0">
                <div className="flex items-center gap-2 mb-4">
                    <Settings2 className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-medium text-white/90 uppercase tracking-wide">Audio Inspector</h3>
                </div>

                {!activeClip ? (
                    <div className="bg-white/5 rounded-lg p-6 text-center border border-dashed border-white/10">
                        <Activity className="w-6 h-6 mx-auto mb-2 text-white/20" />
                        <p className="text-xs text-white/40">Select a clip to edit audio properties.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-black/40 rounded-lg p-3 border border-white/5">
                            <h4 className="text-xs font-bold text-white/70 mb-3 truncate">{activeClip.name}</h4>

                            {/* Volume */}
                            <div ref={volumeRef} className="mb-4">
                                <div className="flex justify-between text-xs mb-1">
                                    <span className="text-white/50">Gain</span>
                                    <span className="text-primary font-mono">
                                        {(((localVolume ?? activeClip.volume) ?? 1.0) * 100).toFixed(0)}%
                                    </span>
                                </div>
                                <input
                                    type="range" min="0" max="2" step="0.05"
                                    value={(localVolume ?? activeClip.volume) ?? 1.0}
                                    onChange={(e) => setLocalVolume(parseFloat(e.target.value))}
                                    onMouseUp={(e) => {
                                        const val = parseFloat(e.target.value);
                                        setLocalVolume(null);
                                        updateActive({ volume: val });
                                    }}
                                    onTouchEnd={() => {
                                        if (localVolume !== null) {
                                            const val = localVolume;
                                            setLocalVolume(null);
                                            updateActive({ volume: val });
                                        }
                                    }}
                                    className="w-full accent-primary h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer"
                                />
                            </div>

                            {/* Fades */}
                            <div className="grid grid-cols-2 gap-3 mb-4">
                                <div>
                                    <label className="text-[10px] text-white/50 block mb-1">Fade In (s)</label>
                                    <input
                                        type="number" min="0" max="10" step="0.1"
                                        value={activeClip.fadeIn ?? 0}
                                        onChange={(e) => updateActive({ fadeIn: parseFloat(e.target.value) })}
                                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-white/50 block mb-1">Fade Out (s)</label>
                                    <input
                                        type="number" min="0" max="10" step="0.1"
                                        value={activeClip.fadeOut ?? 0}
                                        onChange={(e) => updateActive({ fadeOut: parseFloat(e.target.value) })}
                                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white focus:border-primary focus:outline-none"
                                    />
                                </div>
                            </div>

                            {/* Effects Buttons */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => runAudioProcess('denoise')}
                                    disabled={!!processing.denoise}
                                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${activeClip.denoise ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-white/5 text-gray-400 border border-transparent hover:bg-white/10'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {processing.denoise
                                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Processing…</>
                                        : <><Mic className="w-3 h-3" /> Denoise</>
                                    }
                                </button>
                                <button
                                    onClick={() => runAudioProcess('enhance')}
                                    disabled={!!processing.enhance}
                                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors flex items-center justify-center gap-1 ${activeClip.enhance ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30' : 'bg-white/5 text-gray-400 border border-transparent hover:bg-white/10'} disabled:opacity-50 disabled:cursor-not-allowed`}
                                >
                                    {processing.enhance
                                        ? <><Loader2 className="w-3 h-3 animate-spin" /> Processing…</>
                                        : <><Activity className="w-3 h-3" /> Enhance</>
                                    }
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 2. TRACK MIXER */}
            <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
                <div className="flex items-center gap-2 mb-3 px-1">
                    <Sliders className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-medium text-white/90 uppercase tracking-wide">Track Mixer</h3>
                </div>

                <div className="space-y-2">
                    {audioTracks.map(track => {
                        const isMuted = track.muted;
                        const isSolo = track.solo;
                        const level = audioLevels[track.id] || 0;
                        const meterWidth = Math.min(100, level * 100 * 2);

                        return (
                            <div key={track.id} className="bg-black/30 border border-white/5 rounded-lg p-3 hover:border-white/10 transition-colors">
                                <div className="flex justify-between items-center mb-2">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <div className={`w-1.5 h-1.5 rounded-full ${track.type === 'audio' ? 'bg-orange-500' : 'bg-blue-500'}`} />
                                        <span className="text-xs font-medium text-gray-300 truncate max-w-[120px]" title={track.name}>
                                            {track.name}
                                        </span>
                                    </div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => toggleTrackSolo(track.id)}
                                            className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${isSolo ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                                            title="Solo"
                                        >S</button>
                                        <button
                                            onClick={() => toggleTrackMute(track.id)}
                                            className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-500 hover:text-gray-300'}`}
                                            title="Mute"
                                        >M</button>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    <Volume2 className="w-3 h-3 text-gray-500" />
                                    <input
                                        type="range" min="0" max="1.5" step="0.01"
                                        value={track.volume}
                                        onChange={(e) => updateTrackVolume(track.id, parseFloat(e.target.value))}
                                        className="flex-1 accent-white h-1 bg-white/10 rounded-full appearance-none cursor-pointer"
                                    />
                                    <span className="text-[10px] w-8 text-right font-mono text-gray-400">
                                        {(track.volume * 100).toFixed(0)}%
                                    </span>
                                </div>

                                <div className="mt-2 h-1 bg-black/50 rounded-full overflow-hidden w-full">
                                    <div
                                        className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 transition-all duration-100"
                                        style={{ width: `${meterWidth}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default MixerPanel;
