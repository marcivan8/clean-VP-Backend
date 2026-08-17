/**
 * client/src/motion/ClipGrouping.js
 *
 * R66 — the clip-grouping model this project has never had. R65's four
 * composite Motion Graphics Components (LowerThird/Callout/QuoteCard/
 * CTAWidget) shipped as ordinary, INDEPENDENT clips added together — an
 * explicitly stated scope limit at the time ("moving the background bar
 * doesn't move the text with it yet"). This closes it.
 *
 * PURE, like every other file in this directory: given a flat `tracks` array
 * (the same legacy-projection shape every other motion module already
 * consumes) and a `groupId`, these functions compute WHAT SHOULD CHANGE, as
 * plain update/spec descriptors. They never call `updateClip`/`addClip`/
 * dispatch anything themselves — that is `useTimelineStore.js`'s job
 * (`moveClipGroup`/`duplicateClipGroup`/`removeClipGroup`), for the identical
 * reason `Compositor.js`/`CaptionCompiler.js`/`ComponentLibrary.js` all keep
 * the "what" pure and separate from the "how": a pure function is
 * unit-testable without a store, a DOM, or React.
 *
 * ─── THE MODEL ──────────────────────────────────────────────────────────
 * A group is nothing but N clips — possibly on different tracks (a
 * LowerThird's bar lives on the 'overlay' track, its title on 'text') —
 * that share the same `clip.groupId` string. There is no separate group
 * ENTITY, deliberately, for the same reason `MotionLayer` is a VIEW over a
 * clip rather than a new entity type (see `ClipAdapter.js`'s header): a new
 * top-level entity bucket would need every track/clip consumer in the app
 * repointed before it did anything, which is this codebase's most-repeated
 * failure mode (R33/R37/R46/R52/R55/R55c/R61/R63 — eight-plus instances).
 * `groupId` rides along as one more optional clip field, exactly like
 * `animations`/`words`/`captionStyle` before it (R58) — and needs the SAME
 * persistence-contract care: it has been added to BOTH `toLegacyTracks()`
 * and `fromLegacyTracks()` in `TimelineStateManager.js`, or it would
 * silently vanish on reload — exactly the failure `ClipAdapter.js`'s header
 * already warns about, and exactly what §1 of this file's regression test
 * checks for.
 *
 * A lone clip is never "in a group of one" — `groupId` is `null` for an
 * ungrouped clip everywhere in this codebase, not a group containing itself.
 */

let _groupSeq = 0;
export function nextGroupId() {
    _groupSeq += 1;
    return `group-${Date.now().toString(36)}-${_groupSeq.toString(36)}`;
}

/**
 * Stamp a shared groupId onto a set of clip-bearing placements (the shape
 * `ComponentLibrary.buildComponent()` returns: `{ trackType, clip, asset? }`).
 * Only actually groups when there's more than one placement — a single clip
 * has nothing to be grouped WITH.
 */
export function assignGroupId(placements) {
    if (!Array.isArray(placements) || placements.length < 2) return placements;
    const groupId = nextGroupId();
    return placements.map(p => ({ ...p, clip: { ...p.clip, groupId } }));
}

/** Flatten `tracks` into `{ trackId, clip }` pairs whose clip.groupId matches. */
export function clipsInGroup(tracks, groupId) {
    if (!groupId || !Array.isArray(tracks)) return [];
    const out = [];
    for (const track of tracks) {
        if (!track || !Array.isArray(track.clips)) continue;
        for (const clip of track.clips) {
            if (clip && clip.groupId === groupId) out.push({ trackId: track.id, clip });
        }
    }
    return out;
}

/**
 * Compute the updates to move every member of a group by the SAME delta.
 * `deltaStart` shifts every member's timeline position together (a group
 * can't be pulled apart in time); `deltaX`/`deltaY` shift on-canvas position
 * together (a group can't be pulled apart in space). Any delta may be
 * omitted/zero — a pure timeline drag only needs `deltaStart`, a pure
 * on-canvas drag only needs `deltaX`/`deltaY`.
 *
 * Positions never go negative (matches every other clip-move path in this
 * app — `updateClip`'s own `start` handling has no floor of its own, but
 * every existing CALLER clamps at 0; this does the same so a group is no
 * different from an ungrouped clip in that respect).
 *
 * @returns {Array<{trackId, clipId, updates}>} ready for `updateClip(trackId, clipId, updates)`
 */
export function computeGroupMoveUpdates(tracks, groupId, { deltaStart = 0, deltaX = 0, deltaY = 0 } = {}) {
    const members = clipsInGroup(tracks, groupId);
    if (members.length === 0) return [];
    return members
        .map(({ trackId, clip }) => {
            const updates = {};
            if (deltaStart) updates.start = Math.max(0, (Number(clip.start) || 0) + deltaStart);
            if (deltaX) updates.x = (Number(clip.x) || 0) + deltaX;
            if (deltaY) updates.y = (Number(clip.y) || 0) + deltaY;
            return { trackId, clipId: clip.id, updates };
        })
        .filter(u => Object.keys(u.updates).length > 0);
}

/**
 * Compute new clip specs to duplicate a whole group as ONE unit, preserving
 * every member's relative start offset. The duplicate gets its OWN new
 * groupId — it is a new, independent group, not a second copy welded to the
 * original; dragging the copy must never move the original and vice versa.
 *
 * @returns {Array<{trackId, clip}>} full clip objects ready for `addClip(trackId, clip)`
 */
export function computeGroupDuplicateSpecs(tracks, groupId, { startOffset = 0 } = {}) {
    const members = clipsInGroup(tracks, groupId);
    if (members.length === 0) return [];
    const newGroupId = nextGroupId();
    const stamp = Date.now().toString(36);
    return members.map(({ trackId, clip }, i) => ({
        trackId,
        clip: {
            ...clip,
            id: `${clip.id}-copy-${stamp}-${i}`,
            groupId: newGroupId,
            start: Math.max(0, (Number(clip.start) || 0) + startOffset),
        },
    }));
}

export default { nextGroupId, assignGroupId, clipsInGroup, computeGroupMoveUpdates, computeGroupDuplicateSpecs };
