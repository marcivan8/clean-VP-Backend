A glass text input with a mono-uppercase label and a cyan focus ring.

```jsx
<Input label="Project name" placeholder="Untitled cut" />
<Input iconLeft={<Icon name="search" size={16} />} placeholder="Search clips" />
<Input label="Email" error hint="Enter a valid address" />
```

Pass `label`, `hint`, `iconLeft`, `error`. Forwards all native input props (`value`, `onChange`, `type`…).
