Vibed's action button — a mono-uppercase, tracked-out label that lifts and blooms a neon glow on hover; the primary studio affordance.

```jsx
<Button variant="primary" onClick={generate}>Generate cut</Button>
<Button variant="glass" iconLeft={<Icon name="download" />}>Export</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

Variants: `primary` (cyan glow fill — one per view), `glass` (blurred panel, for secondary toolbar actions), `ghost` (text-only), `danger` (destructive). Sizes `sm | md | lg`. Pass `full` to stretch, `iconLeft`/`iconRight` for Lucide glyphs.
