Segmented, mono-uppercase tab control that mimics a professional NLE's mode switcher — the active segment fills cyan with a glow.

```jsx
<Tabs
  tabs={[{id:'edit',label:'Edit'},{id:'color',label:'Color'},{id:'audio',label:'Audio'}]}
  value={tab} onChange={setTab}
/>
```

Each tab is `{id, label, icon?}`. Controlled via `value` + `onChange`. `size` is `sm | md`.
