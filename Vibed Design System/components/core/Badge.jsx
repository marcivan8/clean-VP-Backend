import React from "react";

/** Status badge with a glowing dot — the studio "LED" indicator. */
export function Badge({ children, tone = "cyan", dot = true, style = {}, ...rest }) {
  const tones = {
    cyan: { color: "var(--cyan-400)", dotColor: "var(--cyan-500)", glow: "0 0 8px rgba(0,229,255,0.9)" },
    violet: { color: "var(--violet-400)", dotColor: "var(--violet-500)", glow: "0 0 8px rgba(138,43,226,0.9)" },
    success: { color: "var(--success)", dotColor: "var(--success)", glow: "0 0 8px rgba(52,211,153,0.8)" },
    warning: { color: "var(--warning)", dotColor: "var(--warning)", glow: "0 0 8px rgba(251,191,36,0.8)" },
    danger: { color: "var(--danger)", dotColor: "var(--danger)", glow: "0 0 8px rgba(251,106,106,0.8)" },
    rec: { color: "var(--rec)", dotColor: "var(--rec)", glow: "0 0 8px rgba(255,59,92,0.9)" },
    neutral: { color: "var(--text-muted)", dotColor: "var(--text-faint)", glow: "none" },
  };
  const t = tones[tone] || tones.cyan;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontFamily: "var(--f-mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color: t.color,
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        border: "1px solid var(--border-hairline)",
        background: "var(--surface-card-strong)",
        ...style,
      }}
      {...rest}
    >
      {dot && (
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: t.dotColor, boxShadow: t.glow }} />
      )}
      {children}
    </span>
  );
}
