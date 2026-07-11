import React from "react";

/** Segmented NLE-style tabs. */
export function Tabs({ tabs = [], value, onChange, size = "md", style = {} }) {
  const active = value ?? (tabs[0] && tabs[0].id);
  const pad = size === "sm" ? "5px 12px" : "8px 16px";
  const fs = size === "sm" ? 11 : 12;

  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: "var(--radius-md)",
        background: "var(--surface-card)",
        border: "1px solid var(--border-hairline)",
        boxShadow: "var(--shadow-glass-top)",
        ...style,
      }}
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange && onChange(t.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: pad,
              fontFamily: "var(--f-mono)",
              fontSize: fs,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
              color: on ? "var(--accent-contrast)" : "var(--text-muted)",
              background: on ? "var(--accent)" : "transparent",
              boxShadow: on ? "0 0 16px rgba(0,229,255,0.3)" : "none",
              transition: "all var(--dur-base) var(--ease-out)",
            }}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
