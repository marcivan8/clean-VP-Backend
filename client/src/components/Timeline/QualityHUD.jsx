import React from 'react';
import useTimelineStore from '../../store/useTimelineStore';
import classNames from 'classnames';

/**
 * QualityHUD (The "Virality Heatmap")
 * Visualizes pacing velocity: Red (Slow/Boring) vs Green (Fast/Viral).
 * Renders as a background layer on the timeline track.
 */
const QualityHUD = ({ segments, duration }) => {
    if (!segments || segments.length === 0) return null;

    return (
        <div className="absolute top-0 left-0 h-1 z-0 w-full flex opacity-50 pointer-events-none">
            {segments.map((seg, idx) => {
                // Calculate width percentage
                const widthPercent = (seg.duration / duration) * 100;

                // Color Code
                // Fast (<3s) = Green (Good)
                // Medium (3-10s) = Yellow
                // Slow (>10s) = Red (Bad pacing)
                let colorClass = 'bg-yellow-500';
                if (seg.type === 'fast') colorClass = 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]';
                if (seg.type === 'slow' || seg.type === 'long_take') colorClass = 'bg-red-500';

                return (
                    <div
                        key={idx}
                        className={classNames("h-full transition-all", colorClass)}
                        style={{ width: `${widthPercent}%` }}
                        title={`Pacing: ${seg.type} (${seg.duration.toFixed(1)}s)`}
                    />
                );
            })}
        </div>
    );
};

export default QualityHUD;
