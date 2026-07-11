The core surface — a glass card with backdrop blur, hairline stroke, lit top edge, and soft elevation. Use for clip tiles, panels, project cards, modals.

```jsx
<Card>
  <Badge tone="cyan">Ready</Badge>
  <h3>Opening sequence</h3>
</Card>
<Card interactive glow onClick={open}>…</Card>
```

`interactive` adds the lift+lit-stroke hover; `glow` keeps a persistent cyan bloom; `padding` controls inner spacing.
