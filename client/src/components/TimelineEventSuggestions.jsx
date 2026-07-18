/**
 * client/src/components/TimelineEventSuggestions.jsx
 *
 * Displays SFX recommendations tied to detected timeline events
 * (hard cuts, zoom punches, silences, scene changes, etc.).
 *
 * Props:
 *   events    — TimelineEvent[] from TimelineEventDetector
 *   sfxMap    — Record<TimelineEventType, SearchResult[]> — pre-fetched per event type
 *   onAddSFX  — (sfx, atTime) => void
 */

import React, { useState } from 'react';
import { Scissors, ZoomIn, Volume2, Star, Clock } from 'lucide-react';
import SoundCard from './SoundCard.jsx';

const EVENT_META = {
    HARD_CUT:      { icon: Scissors, color: '#ff3a6e', label: 'Hard Cut' },
    SOFT_CUT:      { icon: Scissors, color: '#4a9eff', label: 'Transition' },
    ZOOM_IN:       { icon: ZoomIn,   color: '#00e5ff', label: 'Zoom In' },
    ZOOM_OUT:      { icon: ZoomIn,   color: '#00e5ff', label: 'Zoom Out' },
    SILENCE_START: { icon: Volume2,  color: '#8a2be2', label: 'Silence Start' },
    SCENE_CHANGE:  { icon: Star,     color: '#ffd166', label: 'Scene Change' },
    CHAPTER_START: { icon: Star,     color: '#ffd166', label: 'Chapter' },
    AUDIO_PEAK:    { icon: Volume2,  color: '#ff6b6b', label: 'Audio Peak' },
};

function EventGroup({ event, sfxList, onAddSFX }) {
    const [expanded, setExpanded] = useState(false);
    const meta = EVENT_META[event.eventType] || EVENT_META.HARD_CUT;
    const Icon = meta.icon;
    const ts   = event.timelineTime != null ? `${event.timelineTime.toFixed(1)}s` : '';

    if (!sfxList || sfxList.length === 0) return null;

    return (
        <div style={{
            marginBottom:  8,
            background:    'rgba(255,255,255,0.03)',
            border:        '0.5px solid rgba(255,255,255,0.07)',
            borderRadius:  7,
            overflow:      'hidden',
        }}>
            {/* Header */}
            <button
                onClick={() => setExpanded(x => !x)}
                style={{
                    width:       '100%',
                    padding:     '7px 10px',
                    background:  'none',
                    border:      'none',
                    cursor:      'pointer',
                    display:     'flex',
                    alignItems:  'center',
                    gap:         7,
                    fontFamily:  'var(--f-sans)',
                }}
            >
                <Icon size={11} color={meta.color} />
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg)', flex: 1, textAlign: 'left' }}>
                    {meta.label}
                </span>
                {ts && (
                    <span style={{ fontSize: 10, color: 'var(--fg-3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Clock size={9} /> {ts}
                    </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--fg-3)' }}>
                    {sfxList.length} SFX {expanded ? '▲' : '▼'}
                </span>
            </button>

            {/* SFX list */}
            {expanded && (
                <div style={{ padding: '0 8px 8px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {sfxList.slice(0, 3).map((sfx, i) => (
                        <SoundCard
                            key={sfx.asset?.id || i}
                            sfx={sfx.asset || sfx}
                            onSelect={s => onAddSFX?.(s, event.timelineTime || 0)}
                            compact
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export default function TimelineEventSuggestions({ events = [], sfxMap = {}, onAddSFX }) {
    const groups = events.filter(e => sfxMap[e.eventType]?.length > 0);

    if (groups.length === 0) {
        return (
            <div style={{ padding: '12px 0', textAlign: 'center', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--f-sans)' }}>
                No event-based suggestions. Run silence detection or add cuts to get SFX ideas.
            </div>
        );
    }

    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fg-3)', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8, fontFamily: 'var(--f-sans)' }}>
                Event-based SFX · {groups.length} events
            </div>
            {groups.map((event, i) => (
                <EventGroup
                    key={`${event.eventType}_${event.timelineTime}_${i}`}
                    event={event}
                    sfxList={sfxMap[event.eventType] || []}
                    onAddSFX={onAddSFX}
                />
            ))}
        </div>
    );
}
