import React from "react";

/** Round icon-only button — toolbar / transport affordance. */
export function IconButton({
  icon,
  label,
  variant = "glass",
  size = 36,
  active = false,
  disabled = false,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);

  const variants = {
    glass: {
      background: active ? "var(--surface-card-strong)" : "transparent",
      border: "1px solid",
      borderColor: active ? "var(--border-strong)" : "transparent",
      color: active ? "var(--accent)" : "var(--text-muted)",
    },
    solid: {
      background: "var(--accent)",
      border: "1px solid transparent",
      color: "var(--accent-contrast)",
      boxShadow: "0 0 20px rgba(0,229,255,0.3)",
    },
  };

  const hoverFx = !disabled && hover && !active
    ? { color: "var(--text-strong)", background: "var(--surface-card)", borderColor: "var(--border-hairline)" }
    : {};

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "var(--radius-md)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "all var(--dur-base) var(--ease-out)",
        ...variants[variant],
        ...hoverFx,
        ...style,
      }}
      {...rest}
    >
      {icon}
    </button>
  );
}
