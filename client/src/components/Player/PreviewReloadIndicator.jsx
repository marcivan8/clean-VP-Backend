import React from 'react';
import { Loader2 } from 'lucide-react';
import { trackEvent } from '../../utils/trackEvent.js';

/**
 * Tells the user that the Revideo preview is rebuilding after a timeline
 * change, instead of leaving a frozen or black canvas with no explanation.
 *
 * Two kinds of rebuild:
 *  - 'variables': the tracks changed (every AI edit does this). The player
 *    element calls playback.reload() and recalculates the whole scene. The
 *    old frame stays on the canvas while it does, so only the label is shown.
 *  - 'remount': the <Player> key changed (aspect ratio, or empty <-> media).
 *    A new canvas starts black, so a copy of the last frame is kept on top
 *    until the new player draws its first frame.
 *
 * The rebuild is over at the first render after the recalculation, which is
 * when the canvas shows the new timeline. A rebuild that takes 5 s or more is
 * sent to PostHog as 'editor_preview_reload_slow'.
 *
 * A class component because getSnapshotBeforeUpdate is the only point where
 * the old player canvas is still in the DOM during a key change.
 */

const SHOW_AFTER_MS = 400;
const SLOW_RELOAD_MS = 5000;

function findPlayerCanvas(surface) {
    return surface?.querySelector('revideo-player')?.shadowRoot?.querySelector('canvas') || null;
}

function copyCanvas(source) {
    if (!source || !source.width || !source.height) return null;
    try {
        const copy = document.createElement('canvas');
        copy.width = source.width;
        copy.height = source.height;
        copy.getContext('2d')?.drawImage(source, 0, 0);
        Object.assign(copy.style, { width: '100%', height: '100%', objectFit: 'contain', display: 'block' });
        return copy;
    } catch {
        return null;
    }
}

export default class PreviewReloadIndicator extends React.Component {
    state = { visible: false, snapshot: null };

    reload = null;
    player = null;
    unsubscribeRender = null;
    unsubscribeRecalc = null;
    showTimer = null;
    dismissTimer = null;

    attachPlayer(player) {
        this.unsubscribeRender?.();
        this.unsubscribeRecalc?.();
        this.player = player;
        this.unsubscribeRender = player?.onRender?.subscribe?.(this.handleRender) || null;
        this.unsubscribeRecalc = player?.onRecalculated?.subscribe?.(this.handleRecalculated) || null;
    }

    getSnapshotBeforeUpdate(prevProps) {
        if (prevProps.playerKey === this.props.playerKey) return null;
        return copyCanvas(findPlayerCanvas(this.props.surfaceRef?.current));
    }

    componentDidUpdate(prevProps, _prevState, snapshot) {
        if (prevProps.playerKey !== this.props.playerKey) {
            this.begin('remount', snapshot);
        } else if (prevProps.variablesJson !== this.props.variablesJson && this.player && !this.reload) {
            this.begin('variables', null);
        }
    }

    componentWillUnmount() {
        this.unsubscribeRender?.();
        this.unsubscribeRecalc?.();
        clearTimeout(this.showTimer);
        clearTimeout(this.dismissTimer);
    }

    begin(reason, snapshot) {
        this.reload = { reason, startedAt: performance.now() };
        clearTimeout(this.showTimer);
        clearTimeout(this.dismissTimer);
        this.setState({ visible: false, snapshot });
        this.showTimer = setTimeout(() => {
            if (this.reload) this.setState({ visible: true });
        }, SHOW_AFTER_MS);
        // Safety timeout: never leave indicator visible indefinitely if a render is dropped
        this.dismissTimer = setTimeout(() => {
            if (this.reload) {
                this.reload = null;
                this.setState({ visible: false, snapshot: null });
            }
        }, 5000);
    }

    handleRecalculated = () => {
        if (!this.reload || !this.player) return;
        try {
            this.player.requestRender?.();
        } catch {
            // ignore
        }
    };

    // The variables change marks the player for recalculation synchronously,
    // so a render with requestedRecalculation still set belongs to a frame
    // that was already in flight, not to the new timeline.
    handleRender = () => {
        if (!this.reload || !this.player || this.player.requestedRecalculation) return;
        const { reason, startedAt } = this.reload;
        this.reload = null;
        clearTimeout(this.showTimer);
        clearTimeout(this.dismissTimer);
        const durationMs = Math.round(performance.now() - startedAt);
        if (durationMs >= SLOW_RELOAD_MS) {
            trackEvent('editor_preview_reload_slow', {
                reason,
                duration_ms: durationMs,
                clip_count: this.props.clipCount ?? null,
            });
        }
        this.setState({ visible: false, snapshot: null });
    };

    mountSnapshot = (el) => {
        const { snapshot } = this.state;
        if (el && snapshot && el.firstChild !== snapshot) el.replaceChildren(snapshot);
    };

    render() {
        const { visible, snapshot } = this.state;
        if (!visible && !snapshot) return null;
        return (
            <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
                {snapshot && <div ref={this.mountSnapshot} className="absolute inset-0 bg-black" />}
                {visible && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="absolute left-1/2 top-3 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-xl"
                        style={{
                            background: 'rgba(14,15,17,0.9)',
                            border: '0.5px solid var(--line-strong)',
                            color: 'var(--fg-2)',
                            fontFamily: 'var(--f-mono)',
                            fontSize: 10,
                            letterSpacing: '0.06em',
                        }}
                    >
                        <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--accent)' }} />
                        {this.props.label}
                    </div>
                )}
            </div>
        );
    }
}
