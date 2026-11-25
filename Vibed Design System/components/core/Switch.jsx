import React from "react";

/** Accessible controlled toggle. onChange receives the new boolean value. */
export function Switch({
  checked = false,
  onChange,
  disabled = false,
  label,
  size = "md",
  id: suppliedId,
  className = "",
  style = {},
  ...rest
}) {
  const generatedId = React.useId();
  const id = suppliedId || generatedId;
  const dimensions = size === "sm"
    ? { trackWidth: 34, trackHeight: 20, thumbSize: 14, thumbOff: 2, thumbOn: 16 }
    : { trackWidth: 40, trackHeight: 22, thumbSize: 16, thumbOff: 2, thumbOn: 20 };

  return (
    <label
      htmlFor={id}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <input
        {...rest}
        id={id}
        className="ds-switch-input"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : rest["aria-label"]}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      <span
        aria-hidden="true"
        className={`ds-switch-track ${className}`.trim()}
        style={{
          position: "relative",
          width: dimensions.trackWidth,
          height: dimensions.trackHeight,
          borderRadius: "var(--radius-pill)",
          background: checked ? "var(--accent)" : "var(--ink-700)",
          border: "1px solid",
          borderColor: checked ? "transparent" : "var(--border-hairline)",
          boxShadow: checked ? "0 0 16px rgba(0,229,255,0.4)" : "none",
          transition: "all var(--dur-base) var(--ease-out)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? dimensions.thumbOn : dimensions.thumbOff,
            width: dimensions.thumbSize,
            height: dimensions.thumbSize,
            borderRadius: "50%",
            background: checked ? "var(--accent-contrast)" : "var(--paper-50)",
            transition: "left var(--dur-base) var(--ease-out)",
            boxShadow: "var(--shadow-sm)",
          }}
        />
      </span>
      {label && (
        <span style={{ fontFamily: "var(--f-sans)", fontSize: 14, color: "var(--text-body)" }}>
          {label}
        </span>
      )}
    </label>
  );
}
