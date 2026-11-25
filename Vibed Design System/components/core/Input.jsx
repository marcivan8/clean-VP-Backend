import React from "react";

/** Glass text input with focus glow. */
export function Input({
  label,
  hint,
  iconLeft = null,
  error = false,
  id: suppliedId,
  className = "",
  hintId: suppliedHintId,
  onFocus: onInputFocus,
  onBlur: onInputBlur,
  "aria-describedby": suppliedDescribedBy,
  "aria-invalid": suppliedAriaInvalid,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const generatedId = React.useId();
  const id = suppliedId || generatedId;
  const hintId = suppliedHintId || `${id}-hint`;
  const [focus, setFocus] = React.useState(false);
  const hasError = Boolean(error);
  const hintText = typeof error === "string" ? error : hint;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, ...containerStyle }}>
      {label && (
        <label htmlFor={id} style={{
          fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em",
          textTransform: "uppercase", color: "var(--text-muted)",
        }}>{label}</label>
      )}
      <span className="ds-input-shell" style={{
        display: "flex", alignItems: "center", gap: 9,
        padding: "10px 12px",
        borderRadius: "var(--radius-md)",
        background: "var(--surface-card)",
        border: "1px solid",
        borderColor: hasError ? "var(--danger)" : focus ? "var(--accent)" : "var(--border-hairline)",
        boxShadow: focus ? "0 0 0 3px rgba(0,229,255,0.12)" : "none",
        transition: "all var(--dur-base) var(--ease-out)",
      }}>
        {iconLeft && <span style={{ color: "var(--text-muted)", display: "inline-flex" }}>{iconLeft}</span>}
        <input
          id={id}
          className={`ds-input ${className}`.trim()}
          aria-invalid={hasError || suppliedAriaInvalid || undefined}
          aria-describedby={[suppliedDescribedBy, hintText && hintId].filter(Boolean).join(" ") || undefined}
          aria-errormessage={hasError ? hintId : undefined}
          onFocus={(event) => { setFocus(true); onInputFocus?.(event); }}
          onBlur={(event) => { setFocus(false); onInputBlur?.(event); }}
          style={{
            flex: 1, border: "none", background: "transparent",
            fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-strong)",
            ...style,
          }}
          {...rest}
        />
      </span>
      {hintText && (
        <span id={hintId} style={{ fontSize: 12, color: hasError ? "var(--danger)" : "var(--text-faint)" }}>{hintText}</span>
      )}
    </div>
  );
}
