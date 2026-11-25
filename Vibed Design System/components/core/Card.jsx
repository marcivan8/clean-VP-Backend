import React from "react";

/** Card — glass fill, hairline stroke, lit top edge, elevation. */
export function Card({ children, padding = 20, interactive = false, glow = false, className = "", onClick, onKeyDown, onKeyUp, onMouseEnter: onCardMouseEnter, onMouseLeave: onCardMouseLeave, style = {}, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const actionable = interactive && typeof onClick === "function";

  const hoverFx = interactive && hover
    ? {
        transform: "translateY(-2px)",
        borderColor: "var(--border-strong)",
        boxShadow: "var(--shadow-lg)" + (glow ? ", var(--glow-cyan-soft)" : "") + ", var(--shadow-glass-top)",
      }
    : {};

  return (
    <div
      className={`ds-card ${className}`.trim()}
      role={actionable ? "button" : undefined}
      tabIndex={actionable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        if (actionable && event.key === "Enter") onClick(event);
        if (actionable && event.key === " ") event.preventDefault();
        onKeyDown?.(event);
      }}
      onKeyUp={(event) => {
        if (actionable && event.key === " ") { event.preventDefault(); onClick(event); }
        onKeyUp?.(event);
      }}
      onMouseEnter={(event) => { setHover(true); onCardMouseEnter?.(event); }}
      onMouseLeave={(event) => { setHover(false); onCardMouseLeave?.(event); }}
      style={{
        position: "relative",
        padding,
        background: "var(--surface-card)",
        backdropFilter: "var(--blur-glass)",
        WebkitBackdropFilter: "var(--blur-glass)",
        border: "1px solid var(--border-hairline)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md), var(--shadow-glass-top)" + (glow ? ", var(--glow-cyan-soft)" : ""),
        cursor: interactive ? "pointer" : "default",
        transition: "all var(--dur-base) var(--ease-out)",
        ...hoverFx,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
