import React, { useMemo } from 'react';
import useTimelineStore from '../../store/useTimelineStore';
import { AlertTriangle } from 'lucide-react';

const FatigueAlert = () => {
    const { currentTime, pacingSegments, isPlaying } = useTimelineStore();

    // Memoize the segment mapping to avoid calculation on every frame
    const segmentsWithTime = useMemo(() => {
        if (!pacingSegments || pacingSegments.length === 0) return [];
        let timeCursor = 0;
        return pacingSegments.map(seg => {
            const start = timeCursor;
            const end = timeCursor + seg.duration;
            timeCursor = end;
            return { ...seg, start, end };
        });
    }, [pacingSegments]);

    if (!isPlaying || segmentsWithTime.length === 0) return null;

    // Find active segment
    const activeSegment = segmentsWithTime.find(s => currentTime >= s.start && currentTime < s.end);

    // Alert if pacing is slow
    const isBoring = activeSegment?.type === 'slow' || activeSegment?.type === 'long_take';

    if (!isBoring) return null;

    return (
        <div className="absolute top-4 right-4 flex items-center gap-2 bg-red-500/90 text-white px-3 py-2 rounded-lg shadow-lg z-20 animate-pulse">
            <AlertTriangle className="w-5 h-5" />
            <div>
                <p className="font-bold text-xs uppercase tracking-wider">Pacing Alert</p>
                <p className="text-[10px] opacity-90">Scene is dragging ({activeSegment.duration.toFixed(0)}s)</p>
            </div>
        </div>
    );
};

export default FatigueAlert;
