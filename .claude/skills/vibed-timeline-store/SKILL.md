# Vibed Timeline & Store Skill

## When to use
Load when working on:
- Clip mutations (add, remove, split, trim, move)
- Keyframe animations
- Undo/redo system
- Project save/load/autosave
- Timeline invariant validation
- Store subscriptions and selectors

## Store architecture

Vibed uses **six Zustand stores**. Only `useTimelineStore` should be mutated by the
AI pipeline. The others are UI/session state.

### useTimelineStore (primary — `client/src/store/useTimelineStore.js`)

```js
{
  // Timeline data
  tracks: Track[],             // legacy flat representation — sync'd from manager
  manager: TimelineManager,    // entity-based engine (source of truth)
  captions: Word[],            // Whisper word-level timestamps [{word, start, end}]
  captionsFilePath: string,    // GCS path to VTT/JSON captions file
  contentAnalysis: object,     // ContentAnalyzer result (segments, structure, editMode)

  // Current asset
  uploadedFile: File | null,
  uploadedFilePath: string,    // GCS path: raw/{userId}/{projectId}/{filename}

  // Project identity
  projectId: string | null,    // Supabase project ID (null = unsaved)
  projectName: string,         // display name

  // Actions
  addClip(trackId, clip), removeClip(trackId, clipId),
  updateClip(trackId, clipId, updates),
  splitClip(trackId, clipId, splitTime),
  trimClip(trackId, clipId, trimFrom, amount),
  duplicateClip(trackId, clipId),
  rippleDelete(atTime),
  setClipSpeed(trackId, clipId, speed),
  setAspectRatio(ratio),
  addTransition(clipId, type, duration),
  addFilter(clipId, filterType, intensity),
  addTextOverlay(text, position, duration, style),
  applyColorGrade(clipId, adjustments),
  undo(), redo(),
  saveProject(),               // writes to localStorage ('vp_autosave')
  setProjectId(id),
  setProjectName(name),
}
```

### useJobStore (`client/src/store/useJobStore.js`)
Tracks BullMQ job lifecycle. JOB_STATES FSM:
`pending → running → done | failed | timeout`

TERMINAL_STATES = ['done', 'failed', 'timeout']

### useAIStore (`client/src/store/useAIStore.js`)
AI panel state: thinking flag, message history, streaming chunks.

### useEditorStore (`client/src/store/useEditorStore.js`)
Editor UI: selected clip ID, panel widths, active sidebar tab.

### useSessionStore (`client/src/store/useSessionStore.js`)
Session ID (X-Session-ID header value), Supabase auth user.

### useUserPreferences (`client/src/store/useUserPreferences.js`)
Persisted preferences: theme, language, default export settings.

## TimelineManager (entity-based engine — `client/src/timeline/index.js`)

The `manager` field in `useTimelineStore` is a `TimelineManager` instance.
It maintains entities: **clips**, **layers**, **effects**, **transitions**, **placements**.

```js
// Always wrap multi-step AI mutations in a transaction
manager.beginTransaction();
  manager.addClip(clip);
  manager.removeClip(clipId);
  // ... more mutations
manager.commitTransaction();

// Then sync back to the legacy tracks array
store.setState({ tracks: manager.toLegacyTracks() });

// Then validate
validateTimeline(store.getState().tracks);
```

`toLegacyTracks()` converts the entity graph into the flat `Track[]` array
that the UI and export pipeline consume.

`fromLegacyTracks(tracks)` rebuilds the entity graph from a saved flat array
(used during localStorage restore on mount).

## Timeline entity types (`client/src/timeline/TimelineSchema.js`)

```js
ENTITY_TYPES = { CLIP, LAYER, EFFECT, TRANSITION, PLACEMENT }
CLIP_TYPES   = { VIDEO, AUDIO, IMAGE, TEXT }
LAYER_TYPES  = { VIDEO, AUDIO, TEXT, OVERLAY }
EFFECT_TYPES = { COLOR_GRADE, BRIGHTNESS, CONTRAST, SATURATION,
                  BLUR_GAUSSIAN, BLUR_MOTION, ... }
```

## Clip object shape (legacy tracks representation)

```js
{
  id: string,           // placement ID (unique per track position)
  clipId: string,       // clip entity ID
  assetId: string,      // asset entity ID
  name: string,         // original filename (used to reconstruct GCS path)
  url: string,          // GCS signed URL — MUST be populated before export
  sourceUrl: string,    // alias for url in some code paths
  gcsPath: string,      // raw/{userId}/{projectId}/{filename}
  start: number,        // timeline position in seconds
  duration: number,     // display duration in seconds
  offset: number,       // source file seek point in seconds
  speed: number,        // playback rate (1.0 = normal)
  volume: number,       // 0–1
  type: string,         // CLIP_TYPES value
  keyframes: {
    scale?:   [{ time: number, value: number, easing: string }],
    x?:       [{ time: number, value: number, easing: string }],
    y?:       [{ time: number, value: number, easing: string }],
    opacity?: [{ time: number, value: number, easing: string }],
  }
}
```

**Keyframe times are clip-local** (0 = clip start), not absolute timeline positions.

## Autosave flow

1. `saveProject()` in `useTimelineStore` writes to `localStorage('vp_autosave')`
2. `useSupabasePersistence` hook (mounted in IDELayout) subscribes to `tracks` changes
   via `useTimelineStore.subscribe(state => state.tracks, callback)`
3. On change: reads `localStorage('vp_autosave')`, debounces 3s, then calls
   `createProject()` or `updateProject()` in Supabase
4. On new project (no `projectId`): creates record, calls `setProjectId(newId)`

## Undo/redo (`client/src/timeline/TimelineHistory.js`)

- Stack stored in localStorage (size-capped to prevent quota overflow)
- `undo()` and `redo()` are store actions that restore full `tracks` snapshots
- AI mutations should NOT push multiple history entries — wrap in one transaction
  so undo reverts the entire AI edit atomically

## Timeline invariants (checked by `TimelineValidator.validateTimeline()`)

```
✓ clip.duration > 0
✓ clip.start >= 0
✓ No overlapping clips on the same track
✓ No duplicate clip IDs within a track
✓ No orphan clipId references (clip entity must exist in manager)
✓ Every clip.url is non-empty (warn if undefined — fatal for export)
```

Any violation throws and must be surfaced — never silently swallowed.
