import React, { useEffect, useState } from 'react';
import useTimelineStore from '../store/useTimelineStore';
import useJobStore from '../store/useJobStore';
import { Bug, AlertTriangle, CheckCircle2, Bot } from 'lucide-react';

const DebugPanel = ({ onClose }) => {
    const state = useTimelineStore();
    const [liveTime, setLiveTime] = useState(0);

    useEffect(() => {
        let rafId;
        const tick = () => {
            const player = useTimelineStore.getState().playerRef?.current;
            if (player && player.playback) {
                setLiveTime(player.playback.time);
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, []);

    const player = state.playerRef?.current;
    const playerDuration = player?.playback?.duration || 0;
    
    // Mismatch Calculation:
    // If player duration differs significantly from timeline duration
    const isMismatch = Math.abs(state.duration - playerDuration) > 0.05;

    const exportClips = state.tracks.flatMap(t => t.clips.map(c => ({
        id: c.id,
        trackId: t.id,
        type: c.type,
        start: c.start,
        duration: c.duration,
        end: c.start + c.duration,
        url: c.url?.substring(0, 30) + '...' // trim URL so JSON doesn't explode
    })));
    
    const activeJob = useJobStore(state => state.getActiveJob());

    const debugData = {
        ai_pipeline: {
            activeJobId: activeJob?.id || 'none',
            state: activeJob?.state || 'IDLE',
            progress: activeJob?.progress ? `${activeJob.progress.toFixed(0)}%` : '0%',
            intent: activeJob?.intent?.intent || 'none',
        },
        metrics: {
            timelineDuration: state.duration.toFixed(3),
            playerDuration: playerDuration.toFixed(3),
            currentTime: liveTime.toFixed(3),
            tracksCount: state.tracks.length,
            totalClips: exportClips.length,
        },
        clips: exportClips
    };

    return (
        <div className="fixed bottom-4 right-4 z-[9999] w-96 bg-black/95 border border-red-500/50 rounded-lg shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex items-center justify-between p-2 bg-red-900/50 border-b border-red-500/30">
                <div className="flex items-center gap-2 text-red-400 font-bold text-xs uppercase tracking-wider">
                    <Bug className="w-3 h-3" /> System Debug
                </div>
                <div className="flex items-center gap-2">
                    {isMismatch ? (
                        <span className="flex items-center gap-1 text-[10px] text-red-400 font-bold bg-red-500/20 px-2 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3" /> DESYNC
                        </span>
                    ) : (
                        <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold bg-green-500/20 px-2 py-0.5 rounded">
                            <CheckCircle2 className="w-3 h-3" /> SYNCED
                        </span>
                    )}
                    {activeJob && (
                        <span className="flex items-center gap-1 text-[10px] text-purple-400 font-bold bg-purple-500/20 px-2 py-0.5 rounded">
                            <Bot className="w-3 h-3" /> AI {activeJob.state}
                        </span>
                    )}
                    <button onClick={onClose} className="text-red-400 hover:text-white px-1">✕</button>
                </div>
            </div>
            <div className="p-3 overflow-y-auto max-h-[60vh] font-mono text-[11px] text-green-400 leading-tight">
                <pre>{JSON.stringify(debugData, null, 2)}</pre>
            </div>
        </div>
    );
};

export default DebugPanel;
