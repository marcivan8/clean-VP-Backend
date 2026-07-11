# Vibed Design System Skill

## When to use
Load this skill when:
- Building any UI for Vibed (production components or throwaway prototypes)
- Writing copy or UI text for any Vibed surface
- Creating marketing pages, landing sections, or onboarding flows
- Debugging visual inconsistencies in existing components
- Deciding which component, color, or pattern to use

**Standing rule:** Always use this design system for any UI/UX work on Vibed.
Never invent new colors, radii, or patterns outside what's documented here.

---

## Brand in one breath

Vibed is a **"Pro DAW"** aesthetic: cinematic dark studio grounds, glowing neon
**cyan `#00E5FF`** + **violet `#8A2BE2`** accent pair, glassmorphic panels floating
over blurred aurora glows, film grain, and a premium type stack
(Instrument Serif display · Geist body · JetBrains Mono eyebrow/technical).
Calm, precise, craft-literate. No emoji. No exclamation marks in product UI.

---

## Setup

### HTML / static prototypes
```html
<!-- All tokens + fonts in one import -->
<link rel="stylesheet" href="path/to/styles.css">

<!-- Lucide icons (product UI) -->
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>
<script>document.addEventListener('DOMContentLoaded', () => lucide.createIcons())</script>

<!-- Phosphor icons (hero/marketing ONLY — never in product UI) -->
<script src="https://unpkg.com/@phosphor-icons/web@2.1.1/src/duotone/index.js"></script>
```

### React (production)
Import the DS component bundle and tokens. All 12 core components are available under
`window.VibedDesignSystem_013733.<Component>` when `_ds_bundle.js` is loaded.
In production React code, import components directly from `components/core/`.
Tokens live in `tokens/` — link `styles.css` once at the app root.

---

## Color tokens (`tokens/colors.css`)

### Brand accents
```css
--cyan-500: #00E5FF;   /* PRIMARY accent — active states, glows, traffic dots */
--cyan-400: #5CEEFF;   /* lighter tint */
--cyan-600: #00B8CC;   /* darker */
--violet-500: #8A2BE2; /* SECONDARY accent — gradient partner, render state */
--violet-400: #A857EC;
--violet-600: #6E1FB8;
```

### Neutral ramp (dark studio — default theme)
```css
--ink-950: #0A0A0B;    /* deepest ground — page background */
--ink-900: #121214;    /* panel ground */
--ink-850: #18181B;
--ink-800: #1F1F23;    /* raised surface */
--ink-700: #2A2A30;    /* hairline / stroke base */
--ink-600: #3A3A42;
--paper-0:  #FFFFFF;
--paper-50: #FAFAFA;   /* crisp off-white — primary text */
```

### Semantic (use these, not raw ramp values)
```css
--bg:                var(--ink-950);
--bg-raised:         var(--ink-900);
--surface-card:      rgba(250,250,250,0.04);   /* glass fill */
--surface-card-strong: rgba(250,250,250,0.07);
--border-hairline:   rgba(250,250,250,0.10);
--border-strong:     rgba(250,250,250,0.16);

--text-strong:  var(--paper-50);               /* headings */
--text-body:    rgba(250,250,250,0.78);         /* body copy */
--text-muted:   rgba(250,250,250,0.55);         /* secondary */
--text-faint:   rgba(250,250,250,0.38);         /* disabled */

--accent:   var(--cyan-500);
--accent-2: var(--violet-500);
--accent-contrast: #04161A;                     /* text ON cyan fill */
```

### Status
```css
--success: #34D399;
--warning: #FBBF24;
--danger:  #FB6A6A;
--rec:     #FF3B5C;   /* record red */
```

### Gradients
```css
--grad-aurora: radial-gradient(60% 60% at 30% 20%, rgba(0,229,255,0.45), transparent 70%),
               radial-gradient(55% 55% at 75% 80%, rgba(138,43,226,0.40), transparent 70%);
--grad-accent: linear-gradient(120deg, var(--cyan-500), var(--violet-500));
--grad-accent-soft: linear-gradient(120deg, rgba(0,229,255,0.18), rgba(138,43,226,0.18));
```

### Warm theme (marketing / daylight contexts)
Apply `.theme-warm` to the root element to switch to cream `#F4F1EC` / charcoal `#16181B`.
All semantic tokens remap automatically.

---

## Typography tokens (`tokens/typography.css`)

### Font families
```css
--f-display: "Instrument Serif", serif;    /* editorial display — roman + italic */
--f-sans:    "Geist", ui-sans-serif;       /* body, UI, buttons */
--f-mono:    "JetBrains Mono", monospace;  /* eyebrows, timecodes, technical chrome */
--f-sans-features: "ss01" 1, "ss02" 1, "cv11" 1; /* always apply to Geist */
```

### Type scale
```css
--fs-display-xl: 96px;  /* hero */
--fs-display-lg: 72px;
--fs-display-md: 54px;
--fs-display-sm: 40px;  /* section headers */
--fs-h1: 32px;
--fs-h2: 26px;
--fs-h3: 21px;
--fs-lg: 18px;
--fs-body: 16px;
--fs-sm: 14px;
--fs-xs: 13px;
--fs-eyebrow: 12px;     /* mono eyebrow ONLY */
```

### Letter spacing
```css
--ls-display: -0.02em;  /* tighten large serif */
--ls-eyebrow: 0.18em;   /* heavily tracked mono */
--ls-mono-ui: 0.06em;   /* UI mono labels */
```

### Casing rules
- **Eyebrows, tags, technical chrome → UPPERCASE mono** (`JetBrains Mono`, `--ls-eyebrow`)
- **Headlines → sentence case** in Instrument Serif, one `<em>` word for editorial lift
- **Body + buttons → sentence case** Geist, short verb phrases

---

## Spacing & radius tokens (`tokens/spacing.css`)

### 8px grid
```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
--space-12: 48px; --space-16: 64px; --space-20: 80px; --space-24: 96px;
```

### Radii
```css
--radius-xs: 4px;    /* dense data chips */
--radius-sm: 6px;    /* tags */
--radius-md: 10px;   /* buttons, inputs */
--radius-lg: 14px;   /* cards */
--radius-xl: 20px;   /* panels */
--radius-2xl: 28px;
--radius-pill: 999px; /* badges, avatars, toggles ONLY */
```

---

## Effects tokens (`tokens/effects.css`)

### Shadows
```css
--shadow-sm: 0 1px 2px rgba(0,0,0,0.4);
--shadow-md: 0 8px 24px rgba(0,0,0,0.45);     /* card elevation */
--shadow-lg: 0 20px 50px rgba(0,0,0,0.55);    /* panel elevation */
--shadow-xl: 0 32px 80px rgba(0,0,0,0.6);
--shadow-glass-top: inset 0 1px 0 rgba(250,250,250,0.08); /* lit-glass top edge */
```

### Glow blooms (neon halos)
```css
--glow-cyan:      0 0 0 1px rgba(0,229,255,0.35), 0 0 24px rgba(0,229,255,0.30);
--glow-cyan-soft: 0 0 18px rgba(0,229,255,0.22);
--glow-violet:    0 0 0 1px rgba(138,43,226,0.35), 0 0 24px rgba(138,43,226,0.30);
--glow-dot:       0 0 8px rgba(0,229,255,0.9), 0 0 2px rgba(0,229,255,1);
```

### Backdrop blur
```css
--blur-glass:        blur(20px) saturate(160%);  /* glass panel backdrop */
--blur-glass-strong: blur(40px) saturate(180%);  /* menus, heavy modals */
--blur-aurora:       blur(120px);                /* ambient aurora spheres */
```

### Motion
```css
--ease-out:    cubic-bezier(0.22, 1, 0.36, 1);    /* default — "soft landing" */
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* playful affordances ONLY */
--dur-fast: 120ms;   /* presses, micro-interactions */
--dur-base: 200ms;   /* default transitions */
--dur-slow: 360ms;   /* panel entrances, modals */
```

---

## Utility classes (`tokens/base.css`)

### `.display`
Instrument Serif, `--lh-tight`, `--ls-display`, `--text-strong`.
Wrap a word in `<em>` for editorial italic lift: *"Edit by talking."*

### `.eyebrow`
JetBrains Mono, 12px, `--ls-eyebrow`, uppercase, `--text-muted`.
Use for section labels, technical metadata categories.

### `.glass-panel`
Semi-transparent glass surface: `--surface-card` fill + `--blur-glass` backdrop-filter
+ `--border-hairline` stroke + `--radius-lg` + `--shadow-md` + `--shadow-glass-top`.
**Use for:** panels, cards, modals, toolbars, menus.
**Don't use for:** plain body text containers.

### `.glass-button-pro`
Mono-uppercase button in JetBrains Mono, 13px. Hover: lifts + brightens stroke + cyan soft glow.

### `.aurora`
Full-bleed aurora ground. Place as first child of any full-screen section:
```html
<div style="position:relative; overflow:hidden">
  <div class="aurora"></div>
  <!-- content above -->
</div>
```
Produces: cyan sphere top-left + violet sphere bottom-right, both blurred at 120px.

### `.film-grain`
`position: fixed`, full viewport, `z-index: 9999`, SVG fractal noise,
`mix-blend-mode: overlay`, `opacity: 0.045`. Add **once** at the app root only.

### `.traffic-dot`
7px glowing circle. Default: cyan. Variants: `.violet` (render), `.rec` (record red).
Always pair with a JetBrains Mono label. Signature instrument-panel motif.

---

## Components (`components/core/`)

### Button
```jsx
<Button variant="primary">Generate cut</Button>
<Button variant="glass" iconLeft={<Icon name="download" />}>Export</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="danger">Delete clip</Button>
```
- `variant`: `primary` (cyan glow fill — **one per view max**), `glass`, `ghost`, `danger`
- `size`: `sm | md | lg`
- Props: `full` (stretch width), `iconLeft`, `iconRight`, `disabled`

### IconButton
```jsx
<IconButton icon={<Icon name="play" />} label="Play" />
<IconButton icon={<Icon name="scissors" />} label="Cut" active />
<IconButton icon={<Icon name="wand-2" />} label="AI Edit" variant="solid" />
```
- `variant`: `glass` (default) | `solid` (cyan fill)
- `active`: persistent cyan glow + bright stroke
- Always pass `label` — aria-label + tooltip

### Icon
```jsx
<Icon name="wand-2" size={18} />
<Icon name="scissors" size={16} color="var(--accent)" />
<Icon name="film-strip" size={64} set="phosphor" />  {/* hero/marketing ONLY */}
```
- `set`: `"lucide"` (default, all product UI) | `"phosphor"` (hero/marketing ONLY — never mix)
- Sizing: 16 micro · 18 default · 20 toolbar · 24 primary buttons · 40–80 Phosphor marketing
- `strokeWidth`: 1.75 default · 1.5 dense chrome · 2 emphasis
- Key Vibed glyphs: `scissors`, `wand-2`, `sparkles`, `captions`, `film`, `mic`, `layers`,
  `volume-2`, `play`, `pause`, `skip-back`, `skip-forward`, `repeat`, `crop`, `download`, `palette`

### Badge
```jsx
<Badge tone="cyan">Live</Badge>
<Badge tone="rec">Rec</Badge>
<Badge tone="neutral" dot={false}>Draft</Badge>
```
- `tone`: `cyan` · `violet` · `success` · `warning` · `danger` · `rec` · `neutral`
- `dot={false}`: removes the glowing LED indicator

### Tag
```jsx
<Tag>4K · ProRes</Tag>
<Tag active icon={<Icon name="captions" size={13} />}>Captions</Tag>
<Tag onRemove={() => drop(id)}>b-roll</Tag>
```
- Dense mono metadata chip, `--radius-sm` (sharper than Badge pill)
- `active`: fills cyan; `onRemove`: adds ✕ for filter chips

### Card
```jsx
<Card>content</Card>
<Card interactive glow onClick={open}>clip title</Card>
```
- `interactive`: lift + lit-stroke on hover
- `glow`: persistent cyan bloom

### Input
```jsx
<Input label="Project name" placeholder="Untitled cut" value={v} onChange={set} />
<Input iconLeft={<Icon name="search" size={16} />} placeholder="Search clips" />
<Input label="Email" error hint="Enter a valid address" />
```
- Passes through all native `<input>` props
- Props: `label`, `hint`, `error`, `iconLeft`

### PromptBar ← signature Vibed element
```jsx
<PromptBar
  value={text} onChange={setText} onSubmit={run}
  busy={rendering}
  placeholder="Tighten the opening and add captions…"
  suggestions={["Add captions", "Punch in on speaker", "Warm the grade"]}
/>
```
- `busy`: violet pulsing dot + disabled input (rendering state)
- `suggestions`: quick-fill chips below the input
- Submits on Enter or the send button

### Switch
```jsx
<Switch checked={grain} onChange={setGrain} label="Film grain" />
```
- Controlled: `checked` + `onChange(next: boolean)`
- Glows cyan when on

### Slider
```jsx
<Slider label="Exposure" value={exp} min={-100} max={100} onChange={setExp} showValue />
<Slider value={pos} max={dur} onChange={seek} format={toTimecode} showValue />
```
- Cyan→violet filled track, glowing thumb
- `format`: custom value display function (e.g. timecode)

### Avatar
```jsx
<Avatar name="Ana Ruiz" status="online" />
<Avatar src="/u/12.jpg" size={28} />
```
- `status`: `online` (cyan) · `render` (violet) · `rec` (red) · `away` (amber)
- Falls back to initials from `name`

### Tabs
```jsx
<Tabs
  tabs={[{id:'edit',label:'Edit'},{id:'color',label:'Color'},{id:'audio',label:'Audio'}]}
  value={tab} onChange={setTab}
/>
```
- NLE-style segmented control; active fills cyan with glow
- Tab shape: `{ id, label, icon? }`; `size`: `sm | md`

---

## Voice & copy rules

| Context | Rule |
|---------|------|
| Eyebrows / chrome labels | UPPERCASE JetBrains Mono — `STUDIO`, `4K · PRORES`, `00:42:18` |
| Headlines | Sentence case Instrument Serif, one `<em>` word — *"Edit by talking."* |
| Buttons / CTAs | Short verb phrases, sentence case — `Generate cut`, `Add captions` |
| Progress / status | Present-continuous — `Rendering · 00:42 left`, `Captions synced` |
| Empty states | Actionable — `No clips yet. Drop footage or describe the scene you want.` |
| Errors | Plain, blameless, actionable — `Couldn't reach the render node. Retrying in 5s.` |
| Metadata separators | Middot `·` — `4K · ProRes · 1:48` |
| **Never** | Emoji · exclamation marks in product UI · vague time estimates |

---

## Visual do/don't

| ✅ Do | ❌ Don't |
|-------|---------|
| `.glass-panel` for all raised surfaces | Flat white/gray boxes |
| 1px hairline strokes, low-opacity | Thick borders or colored left-border accents |
| Hover: `translateY(-1px)` + stroke brightens + glow | Hard background-color swap on hover |
| Press: `translateY(0) scale(0.99)`, `120ms` | Bouncy or heavy press animations |
| `--ease-out` for all transitions | `linear` or `ease-in-out` for motion |
| `.aurora` div as page background | Flat `#0A0A0B` backgrounds in marketing |
| `.film-grain` once at the app root | Film grain repeated per-component |
| Lucide in all product UI | Phosphor inside the editor or studio panels |
| Phosphor duotone in hero sections only | Lucide at large sizes in marketing |
| One `primary` Button per view | Multiple cyan-filled primary buttons on a page |
| `--grad-accent` for active fills and progress | Generic purple gradients on flat cards |

---

## Logo assets (`assets/`)

| File | Use |
|------|-----|
| `logo-mark.svg` | Lightning mark SVG — scales freely |
| `logo-mark-white.svg` | On dark backgrounds |
| `logo-mark-black.svg` | On light / cream backgrounds |
| `logo-wordmark-dark.png` | Full wordmark on dark |
| `logo-wordmark-light.png` | Full wordmark on light |
| `logo-lockup-dark.png` | Mark + wordmark, dark |
| `logo-lockup-light.png` | Mark + wordmark, light |

On dark grounds: gradient SVG mark + Instrument Serif "Vibed" wordmark in `--text-strong`.

---

## Studio UI kit reference (`ui_kits/studio/`)

Interactive recreation of the full editor shell. Reference for layout proportions,
panel hierarchy, and transport bar design:
- `studio-parts.jsx` — TopBar, ToolRail, PreviewStage, Timeline + `toTimecode`
- `studio-screens.jsx` — ConversationPanel, MessageBubble, ProjectPicker
- `studio-app.jsx` — app state machine (screen routing, playback tick, AI responses)
