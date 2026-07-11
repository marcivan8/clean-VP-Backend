import React from "react";

/** Slider — cyan→violet filled track with glowing thumb. For scrubbing / params. */
export function Slider({ value = 0, min = 0, max = 100, step = 1, onChange, label, showValue = false, format, style = {} }) {
  const pct = ((value - min) / (max - min)) * 100;
  const handle = (e) => onChange && onChange(Number(e.target.value));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
      {(label || showValue) && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {label && <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-muted)" }}>{label}</span>}
          {showValue && <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, color: "var(--text-body)" }}>{format ? format(value) : value}</span>}
        </div>
      )}
      <div style={{ position: "relative", height: 18, display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 999, background: "var(--ink-700)" }} />
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: 4, borderRadius: 999, background: "var(--grad-accent)", boxShadow: "var(--glow-cyan-soft)" }} />
        <div style={{ position: "absolute", left: `calc(${pct}% - 7px)`, width: 14, height: 14, borderRadius: "50%", background: "var(--paper-50)", boxShadow: "0 0 10px rgba(0,229,255,0.6), var(--shadow-sm)", pointerEvents: "none" }} />
        <input
          type="range"
          min={min} max={max} step={step} value={value} onChange={handle}
          style={{ position: "absolute", left: 0, right: 0, width: "100%", margin: 0, opacity: 0, height: 18, cursor: "pointer" }}
        />
      </div>
    </div>
  );
}
