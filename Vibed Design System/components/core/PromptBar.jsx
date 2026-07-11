import React from "react";

/**
 * PromptBar — Vibed's signature conversational input. A lit glass capsule
 * where the user types plain-language editing direction.
 */
export function PromptBar({
  value = "",
  onChange,
  onSubmit,
  placeholder = "Describe an edit…",
  busy = false,
  suggestions = [],
  leftAccessory = null,
  style = {},
}) {
  const [focus, setFocus] = React.useState(false);
  const submit = () => { if (onSubmit && value.trim() && !busy) onSubmit(value); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, ...style }}>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onChange && onChange(s)}
              style={{
                fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
                color: "var(--text-muted)", background: "var(--surface-card)",
                border: "1px solid var(--border-hairline)", borderRadius: "var(--radius-pill)",
                padding: "5px 12px", cursor: "pointer", transition: "all var(--dur-base) var(--ease-out)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.borderColor = "var(--border-hairline)"; }}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 12px 12px 18px",
        borderRadius: "var(--radius-xl)",
        background: "var(--surface-card-strong)",
        backdropFilter: "var(--blur-glass)",
        WebkitBackdropFilter: "var(--blur-glass)",
        border: "1px solid",
        borderColor: focus ? "var(--accent)" : "var(--border-hairline)",
        boxShadow: focus
          ? "0 0 0 3px rgba(0,229,255,0.12), var(--shadow-lg), var(--shadow-glass-top)"
          : "var(--shadow-md), var(--shadow-glass-top)",
        transition: "all var(--dur-base) var(--ease-out)",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: busy ? "var(--violet-500)" : "var(--cyan-500)",
          boxShadow: busy ? "0 0 8px rgba(138,43,226,0.9)" : "var(--glow-dot)",
          animation: busy ? "vibedPulse 1.1s var(--ease-in-out) infinite" : "none" }} />
        {leftAccessory}
        <input
          value={value}
          onChange={(e) => onChange && onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder={placeholder}
          disabled={busy}
          style={{
            flex: 1, border: "none", outline: "none", background: "transparent",
            fontFamily: "var(--f-sans)", fontSize: 15, color: "var(--text-strong)",
          }}
        />
        <button
          onClick={submit}
          aria-label="Send"
          disabled={busy || !value.trim()}
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 38, height: 38, borderRadius: "var(--radius-md)", border: "none",
            cursor: busy || !value.trim() ? "default" : "pointer",
            background: value.trim() && !busy ? "var(--accent)" : "var(--ink-700)",
            color: value.trim() && !busy ? "var(--accent-contrast)" : "var(--text-faint)",
            boxShadow: value.trim() && !busy ? "0 0 20px rgba(0,229,255,0.35)" : "none",
            transition: "all var(--dur-base) var(--ease-out)", flexShrink: 0,
            fontFamily: "var(--f-mono)", fontSize: 16, fontWeight: 700,
          }}
        >
          {busy ? "···" : "↑"}
        </button>
      </div>
      <style>{`@keyframes vibedPulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>
    </div>
  );
}
