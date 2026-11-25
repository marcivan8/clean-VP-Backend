import React from "react";

/** Technical metadata tag — codec, timecode, tool label. Square, dense. */
export function Tag({ children, active = false, icon = null, onRemove = null, style = {}, ...rest }) {
  const [hover, setHover] = React.useState(false);
  return (
    <span
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--f-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: active ? "var(--accent)" : "var(--text-body)",
        padding: "5px 9px",
        borderRadius: "var(--radius-sm)",
        border: "1px solid",
        borderColor: active ? "var(--border-strong)" : "var(--border-hairline)",
        background: active ? "var(--surface-card-strong)" : "var(--surface-card)",
        transition: "all var(--dur-base) var(--ease-out)",
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
      {onRemove && (
        <button
          type="button"
          className="ds-tag-remove"
          onClick={onRemove}
          aria-label={`Remove ${typeof children === "string" ? children : "tag"}`}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            border: "none", background: "none", cursor: "pointer", padding: 0, marginLeft: 2,
            color: hover ? "var(--text-strong)" : "var(--text-faint)", fontFamily: "var(--f-mono)", fontSize: 12, lineHeight: 1,
          }}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="m3 3 6 6M9 3 3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  );
}
