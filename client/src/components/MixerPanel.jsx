import React from 'react';
import useTimelineStore from '../store/useTimelineStore';
import { Volume2, VolumeX, Mic, Music } from 'lucide-react';

const MixerPanel = () => {
    const { tracks, activeClipId, updateClip } = useTimelineStore();

    // Group items by track? 
    // Or just show faders for all tracks?
    // Since track doesn't have volume, but CLIP does...
    // We will show "Active Selection" volume for now, 
    // AND we can iterate over tracks and show a master volume for each track (if we added track volume to store).
    // For now, let's just control the ACTIVE CLIP volume.

    const activeTrack = tracks.find(t => t.clips.some(c => c.id === activeClipId));
    const activeClip = activeTrack?.clips.find(c => c.id === activeClipId);

    const handleVolumeChange = (val) => {
        if (!activeClip) return;
        updateClip(activeTrack.id, activeClip.id, { volume: parseFloat(val) });
    };

    if (!activeClip) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <Music className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-xs">Select a clip to mix audio</p>
            </div>
        );
    }

    // Determine type icon
    const Icon = activeTrack.type === 'audio' ? Music : activeTrack.type === 'text' ? VolumeX : Mic;
    const isMuted = activeClip.volume === 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-muted-foreground uppercase tracking-wider font-bold">Audio Mixer</div>
                <div className="text-[10px] text-green-400 font-mono">{activeTrack.name}</div>
            </div>

            <div className="bg-black/40 rounded-xl p-4 border border-border flex flex-col items-center gap-4">

                {/* Meter (Mock) */}
                <div className="w-full flex justify-between items-end h-24 gap-1 px-4">
                    {[...Array(8)].map((_, i) => (
                        <div key={i} className="flex-1 bg-secondary rounded-sm overflow-hidden flex flex-col justify-end h-full">
                            <div
                                className="w-full bg-green-500 transition-all duration-75"
                                style={{
                                    height: `${Math.random() * (activeClip.volume * 80) + 10}%`,
                                    opacity: isMuted ? 0.2 : 1
                                }}
                            />
                        </div>
                    ))}
                </div>

                {/* Fader */}
                <div className="w-full space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>-∞</span>
                        <span>0dB</span>
                        <span>+6dB</span>
                    </div>
                    <input
                        type="range"
                        min="0" max="2" step="0.01"
                        value={activeClip.volume || 1.0}
                        onChange={(e) => handleVolumeChange(e.target.value)}
                        className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                    />
                </div>

                {/* Controls */}
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => handleVolumeChange(isMuted ? 1.0 : 0)}
                        className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-red-500/20 text-red-500' : 'bg-secondary hover:bg-white/10'}`}
                    >
                        {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                    </button>
                    <div className="text-xl font-mono font-bold w-12 text-center">
                        {Math.round(activeClip.volume * 100)}%
                    </div>
                </div>

            </div>

            {/* Tips */}
            <div className="p-3 bg-secondary/30 rounded-lg text-xs text-muted-foreground">
                <p>💡 Tip: Use volume automation to dip music during speech.</p>
            </div>

        </div>
    );
};

export default MixerPanel;
