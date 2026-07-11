---
name: vibed-design
description: Use this skill to generate well-branded interfaces and assets for Vibed, either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the README.md file within this skill, and explore the other available files.
If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.
If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Vibed in one breath
A conversational video-editing platform with a polished "Pro DAW" aesthetic — cinematic dark studio grounds, glowing neon **cyan `#00E5FF`** + **violet `#8A2BE2`** accents, glassmorphic panels over blurred aurora glows, film grain, and a premium type stack (Instrument Serif display · Geist body · JetBrains Mono technical/eyebrow). Calm, precise, craft-literate voice. No emoji.

## Map
- `styles.css` — link this one file to get all tokens + fonts.
- `tokens/` — colors, typography, spacing, effects, base utilities (`.glass-panel`, `.aurora`, `.film-grain`, `.eyebrow`, `.traffic-dot`).
- `fonts/` — self-hosted woff2 (Geist, Instrument Serif, JetBrains Mono).
- `assets/logo.png` — the lightning mark.
- `guidelines/` — foundation specimen cards.
- `components/core/` — React primitives (Button, IconButton, Badge, Tag, Input, Switch, Slider, Card, Avatar, Tabs, Icon, PromptBar).
- `ui_kits/studio/` — interactive studio recreation.
- `readme.md` — full design guide (CONTENT FUNDAMENTALS, VISUAL FOUNDATIONS, ICONOGRAPHY).

When building, read `readme.md` first, then reuse tokens and components rather than inventing new colors or patterns.
