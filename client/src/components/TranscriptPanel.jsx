import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useTimelineStore from '../store/useTimelineStore';
import { Scissors } from 'lucide-react';
import classNames from 'classnames';

function fmtTime(s) {
    const m = Math.floor(s / 60);
    const sec = (s % 60).toFixed(1).padStart(4, '0');
    return `${m}:${sec}`;
}

// Distinct per-speaker palette — extend if you need more than 6 speakers
const SPEAKER_PALETTE = [
    { text: '#60a5fa', bg: 'rgba(96,165,250,0.18)'  },  // blue
    { text: '#34d399', bg: 'rgba(52,211,153,0.18)'  },  // green
    { text: '#f472b6', bg: 'rgba(244,114,182,0.18)' },  // pink
    { text: '#fb923c', bg: 'rgba(251,146,60,0.18)'  },  // orange
    { text: '#a78bfa', bg: 'rgba(167,139,250,0.18)' },  // purple
    { text: '#fbbf24', bg: 'rgba(251,191,36,0.18)'  },  // amber
];

const TranscriptPanel = () => {
    const { captions, currentTime, seek, cutSourceRange } =
        useTimelineStore(useShallow(s => ({
            captions:       s.captions,
            currentTime:    s.currentTime,
            seek:           s.seek,
            cutSourceRange: s.cutSourceRange,
        })));

    const [selection, setSelection] = useState(null);
    const isSelecting = useRef(false);

    const selRange = selection
        ? [Math.min(selection.anchorIdx, selection.focusIdx),
           Math.max(selection.anchorIdx, selection.focusIdx)]
        : null;

    // ── Speaker colour map ────────────────────────────────────────────────────
    const speakerColors = useMemo(() => {
        const speakers = [...new Set(captions.map(w => w.speaker).filter(Boolean))].sort();
        return Object.fromEntries(speakers.map((s, i) => [s, SPEAKER_PALETTE[i % SPEAKER_PALETTE.length]]));
    }, [captions]);

    const hasSpeakers = Object.keys(speakerColors).length > 0;

    // ── Playhead tracking ─────────────────────────────────────────────────────
    const activeIdx = captions.findLastIndex(w => w.start <= currentTime);
    const activeRef = useRef(null);
    useEffect(() => {
        if (activeRef.current && activeIdx >= 0) {
            activeRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [activeIdx]);

    // ── Mouse-drag word selection ─────────────────────────────────────────────
    const onWordMouseDown = useCallback((e, idx) => {
        e.preventDefault();
        isSelecting.current = true;
        setSelection({ anchorIdx: idx, focusIdx: idx });
    }, []);

    const onWordMouseEnter = useCallback((idx) => {
        if (!isSelecting.current) return;
        setSelection(prev => prev ? { ...prev, focusIdx: idx } : null);
    }, []);

    const onWordMouseUp = useCallback((e, idx) => {
        if (!isSelecting.current) return;
        isSelecting.current = false;
        if (selection?.anchorIdx === idx && selection?.focusIdx === idx) {
            seek(captions[idx]?.start ?? 0);
            setSelection(null);
        }
    }, [selection, seek, captions]);

    useEffect(() => {
        const clear = () => { isSelecting.current = false; };
        window.addEventListener('mouseup', clear);
        return () => window.removeEventListener('mouseup', clear);
    }, []);

    // ── Cut selected words ────────────────────────────────────────────────────
    const cutRange = useCallback(() => {
        if (!selRange || !captions.length) return;
        const srcStart = captions[selRange[0]].start;
        const srcEnd   = captions[selRange[1]].end;
        cutSourceRange(srcStart, srcEnd);
        setSelection(null);
    }, [selRange, captions, cutSourceRange]);

    // ── Empty state ───────────────────────────────────────────────────────────
    if (!captions || captions.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
                <p className="text-xs text-muted-foreground">No transcript yet.</p>
                <p className="text-[10px] text-muted-foreground/60">
                    Run auto-captions or ask the AI to transcribe your clip.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full select-none" style={{ minHeight: 0 }}>

            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b shrink-0"
                 style={{ borderColor: 'var(--line-soft)' }}>
                <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground"
                      style={{ fontFamily: 'var(--f-mono)' }}>
                    TRANSCRIPT · {captions.length} words
                </span>
                {selRange && (
                    <button
                        onClick={cutRange}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-400 transition-colors"
                    >
                        <Scissors className="w-3 h-3" />
                        Cut {selRange[1] - selRange[0] + 1} word{selRange[1] > selRange[0] ? 's' : ''}
                    </button>
                )}
            </div>

            {/* Speaker legend */}
            {hasSpeakers && (
                <div className="flex flex-wrap gap-2 px-3 py-2 border-b shrink-0"
                     style={{ borderColor: 'var(--line-soft)' }}>
                    {Object.entries(speakerColors).map(([speaker, color]) => (
                        <span key={speaker}
                              className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                              style={{ color: color.text, background: color.bg, border: `1px solid ${color.text}40` }}>
                            {speaker}
                        </span>
                    ))}
                </div>
            )}

            {/* Word cloud — scrollable */}
            <div className="flex-1 overflow-y-auto px-3 py-3 leading-relaxed" style={{ minHeight: 0 }}>
                {captions.map((word, i) => {
                    const isActive   = i === activeIdx;
                    const isSelected = selRange && i >= selRange[0] && i <= selRange[1];
                    const color      = word.speaker ? speakerColors[word.speaker] : null;

                    // Show speaker label when speaker changes
                    const prevSpeaker = i > 0 ? captions[i - 1].speaker : null;
                    const showLabel   = hasSpeakers && word.speaker && word.speaker !== prevSpeaker;

                    return (
                        <React.Fragment key={i}>
                            {showLabel && (
                                <div className="w-full mt-3 mb-1 text-[9px] font-mono uppercase tracking-widest"
                                     style={{ color: color?.text ?? 'var(--fg-4)' }}>
                                    {word.speaker}
                                </div>
                            )}
                            <span
                                ref={isActive ? activeRef : null}
                                onMouseDown={e => onWordMouseDown(e, i)}
                                onMouseEnter={() => onWordMouseEnter(i)}
                                onMouseUp={e => onWordMouseUp(e, i)}
                                title={fmtTime(word.start)}
                                className={classNames(
                                    'inline cursor-pointer rounded px-0.5 py-px text-sm transition-colors duration-75',
                                    isSelected
                                        ? 'bg-primary/30 text-white'
                                        : isActive
                                        ? 'bg-white/15 text-white'
                                        : 'hover:bg-white/10'
                                )}
                                style={!isSelected && !isActive && color
                                    ? { color: color.text }
                                    : !isSelected && !isActive
                                    ? { color: 'var(--fg-3)' }
                                    : undefined}
                            >
                                {word.word}{' '}
                            </span>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Selection info bar */}
            {selRange && (
                <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground font-mono shrink-0"
                     style={{ borderColor: 'var(--line-soft)' }}>
                    {fmtTime(captions[selRange[0]].start)} → {fmtTime(captions[selRange[1]].end)}
                    &nbsp;·&nbsp;
                    {(captions[selRange[1]].end - captions[selRange[0]].start).toFixed(1)}s
                </div>
            )}
        </div>
    );
};

export default TranscriptPanel;
