/**
 * TimelineValidator.js
 *
 * Validates timeline state invariants after every AI action.
 *
 * Philosophy: AI can propose anything — the timeline cannot break these rules.
 * This module is the boundary between "AI suggested it" and "the engine accepted it".
 *
 * Usage:
 *   import { validateTimeline, assertTimeline } from './TimelineValidator.js';
 *
 *   // In tests:
 *   expect(validateTimeline(state).valid).toBe(true);
 *
 *   // In production (MediaExecutionEngine.verifyExecution):
 *   assertTimeline(useTimelineStore.getState(), 'after-filler-removal');
 *
 * validateTimeline returns { valid, errors, warnings }.
 *   errors   — hard violations that indicate corrupted state (overlaps, zero-duration clips, etc.)
 *   warnings — soft violations worth surfacing but not blocking on
 *
 * assertTimeline is the runtime helper: it logs and returns the boolean.
 */

// Float tolerance — treats differences < 1 ms as equal.
// FFmpeg timestamp rounding can produce values like 0.000999 instead of 0.001.
const EPSILON = 0.001;

// Track types where clip-overlap is a hard error.
// Caption tracks intentionally allow stacking (multiple captions at the same time
// for multi-speaker scenarios), so they are excluded.
const OVERLAP_CHECKED_TYPES = new Set(['video', 'audio', 'music']);

// Track types where clips reference a media asset.
// Caption/overlay clips are generated in-memory and have no assetId.
const ASSET_CHECKED_TYPES = new Set(['video', 'audio', 'music']);

/**
 * Core validator. Pure function — no side effects, no imports from the store.
 *
 * @param {object} state  Timeline store state (or any object with { tracks, assets, currentTime, duration })
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateTimeline(state) {
    const errors   = [];
    const warnings = [];

    // ── Guard ─────────────────────────────────────────────────────────────────
    if (!state || typeof state !== 'object') {
        errors.push('Timeline state is null or undefined');
        return { valid: false, errors, warnings };
    }

    const {
        tracks      = [],
        assets      = [],
        currentTime = 0,
        duration    = 0,
    } = state;

    // ── Timeline-level ────────────────────────────────────────────────────────

    if (typeof duration !== 'number' || isNaN(duration) || duration <= 0) {
        errors.push(`Timeline duration must be a positive number (got ${duration})`);
    }

    if (typeof currentTime !== 'number' || isNaN(currentTime) || currentTime < -EPSILON) {
        errors.push(`Playhead currentTime must be >= 0 (got ${currentTime})`);
    } else if (duration > 0 && currentTime > duration + EPSILON) {
        warnings.push(
            `Playhead is past timeline end (${currentTime.toFixed(3)}s > ${duration.toFixed(3)}s) — will clamp on next seek`
        );
    }

    // ── Track IDs must be unique ──────────────────────────────────────────────

    const seenTrackIds = new Set();
    for (const track of tracks) {
        if (!track.id) {
            errors.push(`A track of type "${track.type || 'unknown'}" is missing an id`);
        } else if (seenTrackIds.has(track.id)) {
            errors.push(`Duplicate track id: "${track.id}"`);
        } else {
            seenTrackIds.add(track.id);
        }
    }

    // ── Asset id lookup set (for orphan checks) ───────────────────────────────

    const assetIds = new Set((assets || []).map(a => a.id).filter(Boolean));

    // ── Per-track and per-clip checks ─────────────────────────────────────────

    const seenClipIds = new Set(); // globally unique across all tracks

    for (const track of tracks) {
        const trackLabel  = `Track "${track.id || '?'}" (type: ${track.type || 'unknown'})`;
        const clips       = [...(track.clips || [])].sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
        const checkOverlap = OVERLAP_CHECKED_TYPES.has(track.type);
        const checkAsset   = ASSET_CHECKED_TYPES.has(track.type);

        for (let i = 0; i < clips.length; i++) {
            const clip      = clips[i];
            const clipLabel = `Clip "${clip.name || clip.id || '?'}" on ${trackLabel}`;

            // ── Clip must have a non-empty id ────────────────────────────────
            if (!clip.id) {
                errors.push(`${clipLabel}: missing id`);
                continue; // can't do further checks without id
            }

            if (seenClipIds.has(clip.id)) {
                errors.push(`Duplicate clip id: "${clip.id}" — same id used on multiple tracks or twice on the same track`);
            } else {
                seenClipIds.add(clip.id);
            }

            // ── start ────────────────────────────────────────────────────────
            const start = clip.start;
            if (typeof start !== 'number' || isNaN(start)) {
                errors.push(`${clipLabel}: start is not a number (got ${JSON.stringify(start)})`);
            } else if (start < -EPSILON) {
                errors.push(`${clipLabel}: start is negative (${start.toFixed(4)}s)`);
            }

            // ── duration ─────────────────────────────────────────────────────
            const dur = clip.duration;
            if (typeof dur !== 'number' || isNaN(dur)) {
                errors.push(`${clipLabel}: duration is not a number (got ${JSON.stringify(dur)})`);
            } else if (dur <= EPSILON) {
                errors.push(`${clipLabel}: duration is zero or negative (${dur.toFixed(4)}s) — will be invisible on the timeline`);
            }

            // ── offset (source in-point) ──────────────────────────────────────
            const offset = clip.offset;
            if (offset !== undefined && offset !== null) {
                if (typeof offset !== 'number' || isNaN(offset)) {
                    errors.push(`${clipLabel}: offset is not a number (got ${JSON.stringify(offset)})`);
                } else if (offset < -EPSILON) {
                    errors.push(`${clipLabel}: offset is negative (${offset.toFixed(4)}s)`);
                }
            }

            // ── speed ─────────────────────────────────────────────────────────
            const speed = clip.speed;
            if (speed !== undefined && speed !== null) {
                if (typeof speed !== 'number' || isNaN(speed)) {
                    errors.push(`${clipLabel}: speed is not a number (got ${JSON.stringify(speed)})`);
                } else if (speed <= 0) {
                    errors.push(`${clipLabel}: speed must be > 0 (got ${speed})`);
                }
            }

            // ── volume ────────────────────────────────────────────────────────
            const vol = clip.volume;
            if (vol !== undefined && vol !== null) {
                if (typeof vol !== 'number' || isNaN(vol) || vol < 0) {
                    warnings.push(`${clipLabel}: volume is invalid (${JSON.stringify(vol)}) — expected a non-negative number`);
                }
            }

            // ── Clip extends beyond declared timeline duration ─────────────────
            if (typeof start === 'number' && typeof dur === 'number') {
                const clipEnd = start + dur;
                // 1-second grace period: silence/filler removal recalculates duration
                // asynchronously, so a brief window where clips extend past the header
                // value is expected and not a real error.
                if (clipEnd > duration + 1 + EPSILON) {
                    warnings.push(
                        `${clipLabel}: ends at ${clipEnd.toFixed(3)}s but timeline duration is ${duration.toFixed(3)}s`
                    );
                }
            }

            // ── Orphaned asset reference ──────────────────────────────────────
            if (checkAsset && clip.assetId && !assetIds.has(clip.assetId)) {
                warnings.push(
                    `${clipLabel}: assetId "${clip.assetId}" not found in assets[] — clip may fail to render`
                );
            }

            // ── Overlap with the next clip (same track, sorted by start) ───────
            if (checkOverlap && i < clips.length - 1 && typeof start === 'number' && typeof dur === 'number') {
                const next    = clips[i + 1];
                const thisEnd = start + dur;
                if (typeof next.start === 'number' && thisEnd > next.start + EPSILON) {
                    const overlapMs = Math.round((thisEnd - next.start) * 1000);
                    errors.push(
                        `${trackLabel}: clips "${clip.id}" and "${next.id}" overlap by ${overlapMs}ms ` +
                        `(first ends at ${thisEnd.toFixed(3)}s, next starts at ${next.start.toFixed(3)}s)`
                    );
                }
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Runtime assertion helper.
 *
 * Runs validateTimeline, logs all findings, and returns the validity boolean.
 * Hard errors are console.error (caught by Sentry in production).
 * Warnings are console.warn.
 *
 * @param {object} state   Timeline store state
 * @param {string} [label] Context label for log messages (e.g. 'after-filler-removal')
 * @returns {boolean}      true if no hard errors; false otherwise
 */
export function assertTimeline(state, label = '') {
    const { valid, errors, warnings } = validateTimeline(state);
    const prefix = label
        ? `[TimelineValidator] [${label}]`
        : '[TimelineValidator]';

    if (warnings.length > 0) {
        warnings.forEach(w => console.warn(`${prefix} ⚠️  ${w}`));
    }

    if (errors.length > 0) {
        errors.forEach(e => console.error(`${prefix} ❌ ${e}`));
        console.error(
            `${prefix} ${errors.length} invariant violation(s) detected. ` +
            `The AI edit completed but the timeline state may be inconsistent. ` +
            `You can undo (Cmd/Ctrl+Z) to restore the previous state.`
        );
    } else {
        // Only log the green line in dev — suppress in production to keep console clean.
        if (import.meta.env?.DEV) {
            console.log(`${prefix} ✅ Timeline valid (${warnings.length} warning(s))`);
        }
    }

    return valid;
}

/**
 * Export a simple boolean helper for tests:
 *   expect(isTimelineValid(state)).toBe(true)
 */
export const isTimelineValid = (state) => validateTimeline(state).valid;
