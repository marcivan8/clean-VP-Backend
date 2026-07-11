import React from "react";

/** Glass text input with focus glow. */
export function Input({
  label,
  hint,
  iconLeft = null,
  error = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 7, ...containerStyle }}>
      {label && (
        <span style={{
          fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--text-muted)",
        }}>{label}</span>
      )}
      <span style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        background: "var(--surface-card)",
        border: "1px solid",
        borderColor: error ? "var(--danger)" : focus ? "var(--accent)" : "var(--border-hairline)",
        boxShadow: focus ? "0 0 0 3px rgba(0,229,255,0.12)" : "none",
        transition: "all var(--dur-base) var(--ease-out)",
      }}>
        {iconLeft && <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{iconLeft}</span>}
        <input
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-strong)",
            ...style,
          }}
          {...rest}
        />
      </span>
      {hint && (
        <span style={{ fontSize: 12, color: error ? "var(--danger)" : "var(--text-faint)" }}>{hint}</span>
      )}
    </label>
  );
}
