import React from "react";

/**
 * Vibed primary action / glass / ghost button.
 * Mono-uppercase label, soft lift + neon glow on hover.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  iconLeft = null,
  iconRight = null,
  disabled = false,
  full = false,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: { padding: "6px 12px", fontSize: 12 },
    md: { padding: "9px 16px", fontSize: 13 },
    lg: { padding: "12px 22px", fontSize: 14 },
  };

  const base = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontFamily: "var(--f-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    fontWeight: 500,
    lineHeight: 1,
    border: "1px solid transparent",
    borderRadius: "var(--radius-md)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1,
    width: full ? "100%" : "auto",
    transition:
      "transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out)",
    ...sizes[size],
  };

  const variants = {
    primary: {
      color: "var(--accent-contrast)",
      background: "var(--accent)",
      boxShadow: "0 0 24px rgba(0,229,255,0.30), var(--shadow-glass-top)",
    },
    glass: {
      color: "var(--text-strong)",
      background: "var(--surface-card-strong)",
      borderColor: "var(--border-hairline)",
      backdropFilter: "var(--blur-glass)",
      WebkitBackdropFilter: "var(--blur-glass)",
      boxShadow: "var(--shadow-glass-top)",
    },
    ghost: {
      color: "var(--text-muted)",
      background: "transparent",
    },
    danger: {
      color: "#fff",
      background: "var(--danger)",
      boxShadow: "0 0 20px rgba(251,106,106,0.25)",
    },
  };

  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);

  const hoverFx = !disabled && hover
    ? variant === "primary"
      ? { boxShadow: "0 0 34px rgba(0,229,255,0.45), var(--shadow-glass-top)", transform: press ? "scale(0.99)" : "translateY(-1px)" }
      : variant === "ghost"
      ? { color: "var(--text-strong)", background: "var(--surface-card)", transform: press ? "scale(0.99)" : "translateY(-1px)" }
      : { borderColor: "var(--border-strong)", boxShadow: "var(--shadow-lg), var(--glow-cyan-soft), var(--shadow-glass-top)", transform: press ? "scale(0.99)" : "translateY(-1px)" }
    : {};

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPress(false); }}
      onMouseDown={() => setPress(true)}
      onMouseUp={() => setPress(false)}
      style={{ ...base, ...variants[variant], ...hoverFx, ...style }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
