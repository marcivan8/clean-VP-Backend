# Vibed — Design System

**Vibed is a conversational video editing platform.** You direct edits in plain language — "tighten the intro, add captions, warm the grade" — and the timeline updates in real time. The product wears a polished **"Pro DAW"** (digital audio workstation) aesthetic: cinematic elegance fused with technical precision. Think a professional NLE / color suite that happens to be driven by conversation.

This design system encodes that identity: the cinematic dark studio environment, the glowing neon cyan/violet accent pair, the glassmorphic panels floating over aurora glows, film grain, and a premium high-contrast type stack.

---

## Sources

- `uploads/logo.png` — the Vibed lightning-bolt mark (provided; copied to `assets/logo.png`).
- Brand identity brief supplied by the user (typography, color, visual language). No codebase or Figma was attached — the system is built from the written brand spec plus the logo. **If a Vibed codebase or Figma exists, attach it so the UI kit can be reconciled against real product screens.**

---

## Brand at a glance

- **Typography** — Display: *Instrument Serif* (editorial, mixes roman + italic). Body/UI: *Geist* (geometric sans, `ss01/ss02/cv11` features). Technical/eyebrow: *JetBrains Mono* (uppercase, heavily tracked).
- **Color** — Pitch-dark grounds (`#0A0A0B`, `#121214`) + crisp off-white text. Primary accent neon **cyan `#00E5FF`**, secondary **violet `#8A2BE2`**. A warm cream theme (`#F4F1EC` / ink `#16181B`) is the alternative.
- **Visual language** — Aurora glow grounds, glassmorphic panels (`backdrop-filter: blur(20px) saturate(160%)`), film grain overlay, glowing "traffic dot" indicators, segmented NLE-style tabs, soft lifts on hover.

---

## CONTENT FUNDAMENTALS

How Vibed writes.

**Voice — the confident studio assistant.** Calm, precise, never hyped. Vibed speaks like a seasoned editor sitting next to you: it knows the craft vocabulary (cut, grade, b-roll, J-cut, ProRes, LUT) and uses it naturally, but never shows off. Direction in, result out.

**Tense & person.** Address the user as **you**; the product is **Vibed** or implicit ("Generating your cut…"). Imperative verbs lead UI copy and prompts — *Generate a rough cut. Trim to the beat. Punch in on the speaker.* System status is present-continuous and matter-of-fact — *Rendering · 00:42 left*, *Captions synced*.

**Casing.**
- **Eyebrows, tags, technical chrome → UPPERCASE mono**, tracked out (`STUDIO`, `4K · PRORES`, `00:42:18`). This is the signature "instrument panel" texture.
- **Headlines → sentence case** in Instrument Serif, often with one *italicized* word for editorial lift: "Edit by *talking*." "A rough cut in *one sentence*."
- **Body & buttons → sentence case** Geist. Buttons are short verb phrases ("Generate cut", "Add captions", "Export").

**Tone examples.**
- Hero: *"Edit by talking. Vibed turns plain-language direction into a finished cut."*
- Empty state: *"No clips yet. Drop footage or describe the scene you want."*
- Prompt placeholder: *"Tighten the opening and add captions…"*
- Progress: *"Conforming timeline · 12 edits applied"*
- Success toast: *"Export ready — 4K ProRes, 1:48."*
- Error: *"Couldn't reach the render node. Retrying in 5s."* (plain, blameless, actionable).

**Punctuation & symbols.** Middots (`·`) separate technical metadata. Em dashes for asides. Timecodes as `HH:MM:SS:FF`. No exclamation marks in product UI. **No emoji** — the "icon" vocabulary is glowing dots, mono labels, and line icons, never emoji.

**Numbers.** Always concrete and craft-accurate: resolutions (4K, 1080p), codecs (ProRes, H.264), timecodes, durations (1:48), counts ("12 edits applied"). Never vague filler stats.

---

## VISUAL FOUNDATIONS

The look, answered concretely.

**Overall mood.** Cinematic, nocturnal, precise. A dark color-suite at night with two neon lights glowing off-screen. Everything is calm and matte until an accent or a render lights up.

**Color & vibe of imagery.** Footage/thumbnails read cool and filmic — slight teal-shadow, gentle contrast, never oversaturated. Imagery sits inside glass frames with thin strokes. The warm theme inverts to cream paper with deep-ink text for daylight/marketing contexts.

**Backgrounds.** Not flat. The default ground is `#0A0A0B`/`#121214` with an **aurora**: two massive spheres — cyan top-left, violet bottom-right — blurred at `filter: blur(120px)`, ~45–55% opacity, bleeding ambient light into the dark. A **film grain** overlay (`feTurbulence`, ~4.5% opacity, `mix-blend-mode: overlay`) sits over everything to bridge software and cinema. No literal photographic page backgrounds; no repeating illustration patterns.

**Gradients.** Used sparingly and purposefully: the cyan→violet `--grad-accent` for active fills, progress, and key strokes; soft aurora radials for ambient ground. Avoid generic purple SaaS gradients on flat cards — gradients glow, they don't decorate.

**Glass & transparency.** The core surface idiom. `.glass-panel` = semi-transparent fill (`rgba(250,250,250,0.04–0.07)`) + `backdrop-filter: blur(20px) saturate(160%)` + a **razor-thin** stroke (`rgba(250,250,250,0.10)`) + an inset top highlight (`inset 0 1px 0 rgba(250,250,250,0.08)`) so the edge reads as lit glass. Blur is reserved for raised surfaces (panels, menus, toolbars) — not body text containers.

**Borders & strokes.** Always hairline (1px) and low-opacity white (dark theme) or low-opacity ink (warm theme). Strokes *separate* without weight. On hover/active, strokes brighten toward `--border-strong` rather than thickening.

**Shadows.** Two systems. (1) **Elevation** — soft, large, dark (`0 20px 50px rgba(0,0,0,0.55)`) lifting glass off the ground. (2) **Glow blooms** — colored neon halos (`0 0 24px rgba(0,229,255,0.3)`) on primary actions, active dots, and selected clips. Combine the inset top-highlight with elevation for the signature "lit pane."

**Corner radii.** Medium-soft, technical, never pill-everything. Buttons/inputs `10px`, cards `14px`, panels `20px`. Pills (`999px`) only for chips/toggles/avatars. Sharp 4px on dense data chips.

**Cards.** A card = glass fill + hairline stroke + `14px` radius + elevation shadow + inset top highlight. No heavy drop shadows, no colored left-border accents, no flat white boxes.

**Hover states.** Lift + glow. `translateY(-1px)`, stroke brightens, a soft cyan glow blooms. Text/icon-only targets shift opacity up (e.g. muted→strong). Never a hard background-color swap.

**Press states.** Settle, don't bounce hard: `translateY(0) scale(0.99)`. Quick (`120ms`).

**Animation.** Smooth, expensive-feeling, restrained. Signature easing `cubic-bezier(0.22, 1, 0.36, 1)` ("soft landing"). Durations 120–360ms. Fades and short translations; a gentle spring (`0.34,1.56,0.64,1`) only for playful affordances. Glowing dots may pulse slowly. **No** infinite bouncing, no decorative looping on content.

**Layout rules.** Studio chrome is fixed: top transport bar, left tool rail, bottom timeline/inspector — content scrolls within. Marketing layouts are centered, generous, on the aurora ground. 8px spacing grid throughout; technical density in tool UI, generous breathing room in marketing.

**Traffic dots.** A signature motif: small glowing 7px dots (cyan = live/ready, violet = render, red = rec) paired with mono labels, acting as status LEDs on an instrument panel.

---

## ICONOGRAPHY

Vibed uses **two icon sets with strict context rules** — never mix more than two in a single surface. Stroke weight and corner-radius differences between sets are subtle but break the interface coherence at scale.

### Primary — Lucide (product UI)
**Lucide** (https://lucide.dev) is the default everywhere inside the editor, sidebar, timeline, and settings. Thin, consistent **1.75px stroke, rounded joins**, `currentColor`. Already available in the artifact environment — no CDN import needed in production code.

- **Style** — stroke only, never filled blobs. Inherits `currentColor` so active/accent states cost zero extra CSS.
- **Sizing** — 16px micro chrome · 18px default UI · 20px toolbar affordances · 24px primary tool buttons.
- **Key timeline/media glyphs** — `scissors`, `skip-back`, `skip-forward`, `repeat`, `mic`, `film`, `crop`, `captions`, `wand-2`, `sparkles`, `layers`, `volume-2`, `play`, `pause`, `download`, `palette`.
- **Load** — `https://unpkg.com/lucide@latest/dist/umd/lucide.js` + `lucide.createIcons()`. The `Icon` component in `components/core/` wraps this.

### Secondary — Phosphor Duotone (hero / marketing only)
**Phosphor Icons** duotone weight (https://phosphoricons.com) is reserved for **landing page hero sections, onboarding flows, and marketing moments** where more visual mass than a thin stroke is warranted. The two-tone fill picks up the cyan/violet gradient naturally.

- **Never use Phosphor inside the product UI** — the filled style clashes with Lucide's line aesthetic.
- **Load** — `https://unpkg.com/@phosphor-icons/web@2.1.1/src/duotone/index.js` (UMD, registers `<ph-*>` custom elements).
- **Sizing** — 40–80px in marketing contexts. Color via CSS `--ph-color` and `--ph-fill-color` custom properties.

### Non-icon indicators
Glowing **traffic dots** (`.traffic-dot`) and **JetBrains Mono text labels** carry a lot of the iconographic signalling in the studio chrome — keep these; they are part of the brand identity. **No emoji. No unicode-glyph icons** beyond the middot `·` separator.

### Logo assets
See `assets/` — the Waveform V mark in gradient, white, and ink variants (SVG + PNG). Wordmark and lockup PNGs also available. On dark grounds pair the gradient mark with the Instrument Serif "Vibed" wordmark in off-white.

---

## INDEX — what's in this system

**Root**
- `styles.css` — global entry point (consumers link this). `@import` list only.
- `readme.md` — this guide.
- `SKILL.md` — Agent-Skill manifest for downloadable use.

**`tokens/`** — `fonts.css` · `colors.css` · `typography.css` · `spacing.css` · `effects.css` · `base.css` (resets + signature utilities: `.glass-panel`, `.glass-button-pro`, `.aurora`, `.film-grain`, `.eyebrow`, `.traffic-dot`).

**`fonts/`** — self-hosted woff2: Geist (variable), Instrument Serif (roman + italic), JetBrains Mono (variable).

**`assets/`** — `logo.png`.

**`guidelines/`** — foundation specimen cards (Type, Colors, Spacing, Brand) shown in the Design System tab.

**`components/core/`** — 12 reusable React primitives (one `.jsx` + `.d.ts` + `.prompt.md` each, plus `@dsCard` cards): `Button`, `IconButton`, `Badge`, `Tag`, `Input`, `Switch`, `Slider`, `Card`, `Avatar`, `Tabs`, `Icon` (Lucide wrapper), and the signature `PromptBar`.

**`ui_kits/studio/`** — interactive recreation of the Vibed conversational editing studio (`index.html` + `studio-parts.jsx` · `studio-screens.jsx` · `studio-app.jsx`).

**Design System tab** — 20 `@dsCard`s: Type (4), Colors (4), Spacing (2), Brand (4), Components (5), Studio (1).

> Components are consumed via `window.<Namespace>.<Component>` after loading `_ds_bundle.js`. The current namespace is **`VibedDesignSystem_013733`** (re-run `check_design_system` to confirm). Do not hand-edit `_ds_bundle.js`, `_ds_manifest.json`, `_adherence.oxlintrc.json` — they're generated.
