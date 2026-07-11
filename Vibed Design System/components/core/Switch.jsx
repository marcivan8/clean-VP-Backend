import React from "react";

/** Toggle switch — cyan glow when on. */
export function Switch({ checked = false, onChange, disabled = false, label, style = {}, ...rest }) {
  const toggle = () => { if (!disabled && onChange) onChange(!checked); };
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, ...style }}>
      <span
        role="switch"
        aria-checked={checked}
        onClick={toggle}
        style={{
          position: "relative",
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--accent)" : "var(--ink-700)",
          border: "1px solid",
          borderColor: checked ? "transparent" : "var(--border-hairline)",
          boxShadow: checked ? "0 0 16px rgba(0,229,255,0.4)" : "none",
          transition: "all var(--dur-base) var(--ease-out)",
          flexShrink: 0,
        }}
        {...rest}
      >
        <span style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: checked ? "var(--accent-contrast)" : "var(--paper-50)",
          transition: "left var(--dur-base) var(--ease-out)",
          boxShadow: "var(--shadow-sm)",
        }} />
      </span>
      {label && <span style={{ fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-body)" }}>{label}</span>}
    </label>
  );
}
