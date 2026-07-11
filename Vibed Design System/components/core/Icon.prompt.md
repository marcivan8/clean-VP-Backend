Renders a single icon. Use Lucide for all product UI; Phosphor duotone for hero/marketing only. Never mix both in the same surface.

```jsx
// Default — Lucide, product UI
<Icon name="scissors" size={20} />
<Icon name="wand-2" size={18} color="var(--accent)" />
<Icon name="sparkles" size={16} color="var(--text-muted)" />

// Phosphor duotone — marketing/hero only
<Icon name="film-strip" size={64} set="phosphor" color="var(--accent)" />
<Icon name="waveform" size={48} set="phosphor" />
```

## Props

| Prop | Default | Notes |
|---|---|---|
| `name` | required | Lucide: kebab-case (`"wand-2"`). Phosphor: stem only (`"film-strip"`) — duotone suffix added automatically. |
| `set` | `"lucide"` | `"phosphor"` for hero/marketing only. |
| `size` | `18` | px. Use 16/18/20 in UI, 24 for primary buttons. Phosphor: 40–80 in marketing. |
| `strokeWidth` | `1.75` | Lucide only. 1.5 for dense chrome, 2 for emphasis. |
| `color` | `"currentColor"` | CSS color. Phosphor: also sets `--ph-color` and `--ph-fill-color`. |

## Key Lucide glyphs for Vibed
`scissors` · `skip-back` · `skip-forward` · `repeat` · `mic` · `film` · `crop` · `captions` · `wand-2` · `sparkles` · `layers` · `volume-2` · `play` · `pause` · `download` · `palette`

## Setup
Lucide: `<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.js"></script>` then `lucide.createIcons()`.
Phosphor: `<script src="https://unpkg.com/@phosphor-icons/web@2.1.1/src/duotone/index.js"></script>` — registers `<ph-*>` elements automatically.
