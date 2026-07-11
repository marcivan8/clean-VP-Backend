Vibed's signature element — a lit glass capsule where the user types plain-language editing direction ("tighten the intro, add captions"). A glowing dot shows live/busy state; suggestion chips offer quick fills.

```jsx
<PromptBar
  value={text} onChange={setText} onSubmit={runEdit}
  busy={rendering}
  placeholder="Describe an edit…"
  suggestions={["Add captions", "Punch in on speaker", "Warm the grade"]}
/>
```

Controlled. `busy` switches the dot to a violet pulse and disables input. Submits on Enter or the send button.
