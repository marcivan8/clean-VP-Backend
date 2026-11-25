import React from "react";

/** Segmented NLE-style tabs. */
export function Tabs({ tabs = [], value, onChange, size = "md", style = {} }) {
  const active = value ?? (tabs[0] && tabs[0].id);
  const tabsRef = React.useRef([]);
  const pad = size === "sm" ? "5px 12px" : "8px 16px";
  const fs = size === "sm" ? 11 : 12;
  const focusTab = (index, direction = 1) => {
    if (!tabs.length) return;
    let nextIndex = (index + tabs.length) % tabs.length;
    for (let attempt = 0; attempt < tabs.length && tabs[nextIndex].disabled; attempt += 1) {
      nextIndex = (nextIndex + direction + tabs.length) % tabs.length;
    }
    if (tabs[nextIndex].disabled) return;
    tabsRef.current[nextIndex]?.focus();
    onChange?.(tabs[nextIndex].id);
  };

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
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
      {tabs.map((t, index) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            ref={(node) => { tabsRef.current[index] = node; }}
            type="button"
            className="ds-tab"
            role="tab"
            id={t.id ? `ds-tab-${t.id}` : undefined}
            aria-controls={t.panelId}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") { event.preventDefault(); focusTab(index + 1, 1); }
              else if (event.key === "ArrowLeft") { event.preventDefault(); focusTab(index - 1, -1); }
              else if (event.key === "Home") { event.preventDefault(); focusTab(0); }
              else if (event.key === "End") { event.preventDefault(); focusTab(tabs.length - 1); }
            }}
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
              color: on ? "var(--ink-950)" : "var(--text-muted)",
              background: on ? "var(--accent-2)" : "transparent",
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
