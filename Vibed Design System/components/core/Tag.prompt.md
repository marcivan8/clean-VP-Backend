A dense, square-cornered mono tag for technical metadata — codecs, timecodes, tool labels, filter chips.

```jsx
<Tag>4K · ProRes</Tag>
<Tag active icon={<Icon name="captions" size={13} />}>Captions</Tag>
<Tag onRemove={() => drop(id)}>b-roll</Tag>
```

`active` lights it cyan. Pass `onRemove` for a dismissable chip. Sharper 6px radius distinguishes it from the pill `Badge`.
