import { create } from 'zustand';
import useTimelineStore from '../store/useTimelineStore.js';
import { timelineManager, ACTION_TYPES } from '../timeline/TimelineStateManager.js';

/**
 * Versions of a short, as the mobile flow makes them.
 *
 * Every finished run records one, so "go back to the one before" is possible
 * without the user having to think in undo steps.
 *
 * Why not TimelineHistory's versions: it HAS a createVersion/listVersions/
 * loadVersion API, and nothing listens to the VERSION_LOADED it emits, so
 * loadVersion updates TimelineHistory's own copy of the state and the store
 * the UI renders from never changes. Building on it would have meant a second
 * source of truth for the timeline alongside the store's undo stack, and two
 * things that can disagree about what the timeline currently is. This uses the
 * snapshot shape the store's own undo already round-trips.
 */

const MAX_VERSIONS = 12;

/** The same shape undo/redo stores, so restoring uses the same path. */
function snapshot() {
    const s = useTimelineStore.getState();
    return {
        _timelineState: timelineManager.getState(),
        currentTime: s.currentTime,
        activeClipId: s.activeClipId,
        selectedClipIds: [...(s.selectedClipIds || [])],
        aspectRatio: s.aspectRatio,
        scenes: s.scenes,
        _extraState: { captions: s.captions, duration: s.duration },
    };
}

const useVersionsStore = create((set, get) => ({
    versions: [],          // newest first
    currentId: null,

    /**
     * Record what the project looks like right now.
     * @param {string} label  what produced it, in the user's words
     */
    capture: (label) => {
        const v = {
            id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            label: String(label || '').trim() || 'Edit',
            createdAt: Date.now(),
            duration: useTimelineStore.getState().duration || 0,
            snap: snapshot(),
        };
        set((s) => ({
            versions: [v, ...s.versions].slice(0, MAX_VERSIONS),
            currentId: v.id,
        }));
        return v;
    },

    /**
     * Put the project back to a version. Undoable: the state being left is
     * pushed onto the normal undo stack first, so this is not a trapdoor.
     */
    restore: (id) => {
        const v = get().versions.find(x => x.id === id);
        if (!v) return false;

        const store = useTimelineStore.getState();
        store.saveToHistory();

        if (v.snap._timelineState) {
            timelineManager.dispatch(
                { type: ACTION_TYPES.LOAD_STATE, payload: { state: v.snap._timelineState } },
                { skipHistory: true },
            );
        }
        useTimelineStore.setState({
            currentTime: v.snap.currentTime,
            activeClipId: v.snap.activeClipId,
            selectedClipIds: v.snap.selectedClipIds,
            tracks: timelineManager.toLegacyTracks(),
            aspectRatio: v.snap.aspectRatio || store.aspectRatio,
            scenes: v.snap.scenes ?? store.scenes,
            ...(v.snap._extraState || {}),
        });
        set({ currentId: id });
        return true;
    },

    /** A new project starts with no history of its own. */
    clear: () => set({ versions: [], currentId: null }),
}));

export default useVersionsStore;
