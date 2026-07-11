# Vibed AI Pipeline Skill

## When to use
Load when:
- Adding a new AI command (end-to-end: intent → execution)
- Debugging intent parsing or plan generation
- Modifying the action plan → execution flow
- Working on long-form editing modes
- Adding a new engine type or store action

## Full pipeline

```
User message (string)
    │
    ▼
IntentParser.parse(message)
    ├─ localParse()  — fast NLP_MAP keyword matching
    ├─ FallbackParser.parse() — regex patterns as safety net
    └─ GPT-4o structured output (when local parse returns null)
    │
    ▼
IntentValidator.validate(intent)
    │
    ▼
if intent.type === INTENT_TYPES.ANALYZE or LONG_FORM_BUILD:
    ContentAnalyzer.analyze(state)          ← GPT-4o, segments + structure
    LongFormEditPlanner.buildPlan(result)   ← returns atomic step array
else:
    EditPlanner.createPlan(intent)          ← returns step array

    │
    ▼
UserApprovalAgent (if plan requires approval before execution)
    │
    ▼
For each step in plan:
    CommandCompiler.compile(step)
        → { engine: ENGINE_TYPES.*, action: string, args: {} }
    │
    ▼
    MediaExecutionEngine.execute(command, job)
        ├─ ENGINE_TYPES.STORE      → executeStoreAction(command, job)
        │       → VideoEditorTools.[action](args)
        │       → manager.beginTransaction()
        │       → [mutations]
        │       → manager.commitTransaction()
        │       → validateTimeline()
        │
        ├─ ENGINE_TYPES.FFMPEG     → executeFFmpegCommand(command, job)
        │       → HTTP POST to Railway FFmpeg routes
        │       → enqueues BullMQ job, polls for result
        │
        ├─ ENGINE_TYPES.API        → executeApiCall(command, job)
        │       → OpenAI / external API calls
        │       → retries 429s with exponential backoff
        │
        └─ ENGINE_TYPES.MEDIABUNNY → executeMediaBunnyCommand(command, job)
                → MediaBunny split / speed / trim / convert / extract
    │
    ▼
AgentFeedbackService.emit(result)   ← streams step result to UI
```

## Adding a new AI command — complete checklist

1. **`agent/CommandConstants.js`**
   - Add to `INTENT_TYPES` if it's a new top-level intent
   - Add to `OPERATIONS` if it's a new operation within an existing intent

2. **`agent/IntentParser.js`**
   - Add keyword(s) to `NLP_MAP`
   - Add case to `localParse()` switch

3. **`agent/FallbackParser.js`**
   - Add regex pattern to catch natural-language variations

4. **`agent/IntentValidator.js`**
   - Add any required field checks for the new intent type

5. **`agent/EditPlanner.js`** (or `LongFormEditPlanner.js` for long-form)
   - Add case in `createPlan()` / `_buildAtomicSteps()`
   - Add `_build[ActionName]Steps()` method

6. **`agent/CommandCompiler.js`**
   - Add entry to `COMMAND_REGISTRY` mapping action → ENGINE_TYPE + handler

7. **`agent/VideoEditorTools.js`** (for ENGINE_TYPES.STORE)
   - Implement the store operation
   - Use `manager.beginTransaction()` … `commitTransaction()`
   - Call `validateTimeline()` at the end

8. **`agent/TimelineValidator.js`**
   - Add invariant checks relevant to the new action if needed

9. **`client/src/timeline/TimelineSchema.js`**
   - Add any new ENTITY_TYPES, CLIP_TYPES, or EFFECT_TYPES if needed

## ENGINE_TYPES (from `agent/CommandConstants.js`)
```js
ENGINE_TYPES = {
  STORE:       'store',       // direct Zustand store mutations
  FFMPEG:      'ffmpeg',      // server-side FFmpeg processing via BullMQ
  API:         'api',         // OpenAI / external API calls
  MEDIABUNNY:  'mediabunny',  // MediaBunny media processing service
}
```

## STORE actions (handled by `executeStoreAction`)
```
addClip(trackId, clip)
removeClip(trackId, clipId)
updateClip(trackId, clipId, updates)
splitClip(trackId, clipId, splitTime)
trimClip(trackId, clipId, trimFrom, amount)
duplicateClip(trackId, clipId)
rippleDelete(atTime)
setClipSpeed(trackId, clipId, speed)
setAspectRatio(ratio)
addTransition(clipId, type, duration)
addFilter(clipId, filterType, intensity)
addTextOverlay(text, position, duration, style)
applyColorGrade(clipId, adjustments)
createBrollTrack(clips)
moveClipToTrack(clipId, fromTrackId, toTrackId)
undo()
redo()
chat(message)       ← no-op execution, returns message to UI
```

## Long-form edit modes (`agent/LongFormEditPlanner.js`)

```js
EDIT_MODES = {
  CLEAN_EDIT:          // podcast / interview / talking-head
                       // removes silence, filler words, aligns to word boundaries
  YOUTUBE_OPTIMIZED:   // YouTube pacing: hook, chapters, B-roll cues, outro
  FULL_BUILD:          // complete edit: silence removal + zoom + captions + audio norm
}
```

Selected by `ContentAnalyzer.analyze()` → `result.editMode`.
`LongFormVideoProcessor.js` executes the atomic steps produced by the planner.

## Orchestrator layer (`agent/orchestrator/`)
Manages multi-step autonomous editing sessions:
- `OrchestratorFSM.js` — FSM states: idle → planning → executing → awaiting_approval → done
- `OrchestratorController.js` — drives the FSM, delegates to agents
- `OrchestratorEvents.js` — event definitions for cross-agent communication
- `OrchestratorConfig.js` — timeouts, retry limits, concurrency settings

## GPT usage
| Component | Model | Temperature | Purpose |
|-----------|-------|-------------|---------|
| IntentParser (fallback) | gpt-4o | 0 | Intent classification |
| EditPlanner | gpt-4o | 0 | Structured action plan |
| ContentAnalyzer | gpt-4o | 0 | Segment + structure analysis |
| LongFormEditPlanner | gpt-4o | 0 | Atomic step generation |
| CreativeDirector | gpt-4o | 0.3 | Style suggestions |
| ContextGenerator | gpt-4o | 0 | Prompt context assembly |

All structured outputs go through the OpenAI `response_format: { type: "json_object" }`
or function-calling interface — never parse free-form GPT text for action plans.

## Key rules
- **Never** call `addClip()` in a `forEach` loop — batch via `beginTransaction()`
- **Always** run `validateTimeline()` after any AI mutation
- **Always** check that `captions` is non-empty before running caption-dependent actions
  (use `TranscriptionManager.isReady()`)
- The `chat` action is a no-op in the engine — it returns `args.message` to the UI
  without touching the timeline
- `ExecutionSupervisor` will time out steps that hang — implement progress events
  in long-running operations
