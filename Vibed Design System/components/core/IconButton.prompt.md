Square icon-only button for studio chrome — toolbars, the transport bar, panel headers. Goes cyan + lit-stroke when `active`.

```jsx
<IconButton icon={<Icon name="play" />} label="Play" variant="solid" />
<IconButton icon={<Icon name="scissors" />} label="Cut" active />
```

Variants: `glass` (default, transparent → lifts on hover) and `solid` (cyan fill). Always pass `label` for accessibility + tooltip.
