# Vibed AI Marketing Studio — Product Direction

Saved for a future product/design session.

## Goal

Let a company create a polished marketing video from a brief, script, and brand kit, with AI handling the production and a workflow simple enough for people who do not know editing or motion graphics.

## UI direction

Build this as a distinct **Create a video** workflow alongside Vibed's existing timeline editor. The default experience should be storyboard-led and timeline-free:

- **Brief and chat:** collect the goal, audience, script, platform, and brand kit; summarize understanding and ask about essential gaps.
- **Video preview:** show the current assembled result and update it as scenes change.
- **Scene details:** allow simple edits to copy, narration, visual, duration, and motion using named choices rather than technical keyframes.
- **Storyboard strip:** represent the video as ordered scene cards (for example Hook → Problem → Product → Proof → Call to action). Let users reorder scenes, replace visuals, edit copy, and make simple duration changes.
- **Review and export:** surface checks for script coverage, readability, safe areas, brand consistency, audio, and render integrity before delivery.

## Interaction principles

- Users can direct changes in natural language, such as “make the opening faster” or “make this feel more premium.”
- Show the proposed storyboard before expensive asset or motion generation; make approval checkpoints configurable.
- Keep revisions focused on affected scenes and preserve already-approved content.
- Save the result as a normal editable Vibed project so advanced users can continue in the timeline editor.
- Keep the timeline as an optional advanced surface. Consider a node graph later for motion designers and reusable branded animations, not as the default interface.

## Suggested first vertical slice

Focus on 30–60 second product marketing videos: brief + brand kit → structured storyboard → user edits/approval → render with existing graphics and motion → automated checks → editable project and export.

Use existing models and Vibed's current graphics, motion, and rendering capabilities first. Evaluate where quality breaks down before considering custom model training.
