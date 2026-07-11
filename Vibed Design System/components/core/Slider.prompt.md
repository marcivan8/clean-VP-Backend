A parameter / scrub slider with a cyan→violet filled track and a glowing thumb. For grade params, volume, and timeline scrubbing.

```jsx
<Slider label="Exposure" value={exp} min={-100} max={100} onChange={setExp} showValue />
<Slider value={pos} max={dur} onChange={seek} format={toTimecode} showValue />
```

Controlled via `value` + `onChange`. `format` customizes the readout (e.g. timecode).
