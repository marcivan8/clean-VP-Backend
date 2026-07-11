# Vibed Studio — UI Kit

An interactive, high-fidelity recreation of **Vibed's conversational video-editing studio**. Built entirely from the Vibed brand spec (no production codebase or Figma was provided — see CAVEATS in the root `readme.md`). It composes the design-system primitives in `components/core/` rather than re-implementing them.

## Run
Open `index.html`. It loads the compiled `_ds_bundle.js`, Lucide icons, and the three JSX modules below.

## Flow (interactive)
1. **Project picker** — the dark "Edit by *talking*" landing with recent-project cards over an aurora ground. Click any card (or **New project**) to enter the studio.
2. **Studio** — full editor: top transport/collab bar, left tool rail, center video preview with working play/scrub transport, right **Director** conversation panel, and a live multi-track timeline.
3. **Talk to edit** — type into the prompt bar (or use a suggestion chip) and send. Vibed replies with a scripted edit summary and **adds a clip to the timeline**. Try: *"add captions"*, *"warm the grade"*, *"punch in on the speaker"*, *"tighten the opening"*.

## Files
- `index.html` — mounts the app; declares the `@dsCard` (group **Studio**) and a `@startingPoint`.
- `studio-parts.jsx` — `TopBar`, `ToolRail`, `PreviewStage`, `Timeline` + `toTimecode` helper.
- `studio-screens.jsx` — `ConversationPanel`, `MessageBubble`, `ProjectPicker`.
- `studio-app.jsx` — `StudioApp` state machine (screen routing, playback tick, scripted edit responses).

## Notes / fidelity
- The video preview is a **cinematic placeholder** (aurora + grain), not real footage — no footage assets were supplied.
- Edit responses are scripted client-side for the demo; there's no real render backend.
- Icons are **Lucide** (substitution — flagged in the root readme).
