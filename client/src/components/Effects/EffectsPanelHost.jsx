/**
 * client/src/components/Effects/EffectsPanelHost.jsx
 *
 * R166 — the one-line mount for EffectsPanel.
 *
 * EffectsPanel takes `targetId` and `playhead` as props. Passing them from
 * IDELayout would mean subscribing that component to `currentTime`, and
 * IDELayout deliberately does NOT: it reads the playhead imperatively
 * (`useTimelineStore.getState().currentTime`) precisely so the whole editor
 * layout does not re-render on every animation frame. A host component keeps
 * that subscription inside this subtree, which is the same shape TransformPanel
 * already uses — the panel reads the store itself and takes no props.
 *
 * `playbackEngine` is deliberately NOT passed. It is the handle to the client
 * WebGL runtime (engine/PlaybackEngine.js), which R165 found is reachable from
 * nothing and which is staying that way. `useEffects` guards every use of it
 * (`if (playbackEngine)`), so effects are added, ordered, parameterised and
 * keyframed through timelineManager, and the preview renders them through
 * motion/TimelineVisualEffects' CSS/SVG path exactly as it does for effects the
 * AI applies. Nothing here revives a canvas.
 */

import React from 'react';
import useTimelineStore from '../../store/useTimelineStore';
import EffectsPanel from './EffectsPanel.jsx';

export default function EffectsPanelHost() {
    const activeClipId = useTimelineStore(s => s.activeClipId);
    const currentTime = useTimelineStore(s => s.currentTime);

    return (
        <EffectsPanel
            targetId={activeClipId || null}
            playhead={Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0}
        />
    );
}
