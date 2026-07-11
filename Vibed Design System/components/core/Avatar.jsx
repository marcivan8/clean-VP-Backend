import React from "react";

/** Avatar — circular, glass ring. Image or initials. */
export function Avatar({ src, name = "", size = 36, status = null, style = {}, ...rest }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const statusColors = {
    online: "var(--cyan-500)",
    render: "var(--violet-500)",
    rec: "var(--rec)",
    away: "var(--warning)",
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", flexShrink: 0, ...style }} {...rest}>
      <span style={{
        width: size, height: size, borderRadius: "50%", overflow: "hidden",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "var(--grad-accent-soft)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-strong)",
        fontFamily: "var(--f-mono)", fontSize: size * 0.36, letterSpacing: "0.02em",
      }}>
        {src ? (
          <img src={src} alt={name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          initials || "?"
        )}
      </span>
      {status && (
        <span style={{
          position: "absolute", right: -1, bottom: -1,
          width: Math.max(8, size * 0.26), height: Math.max(8, size * 0.26),
          borderRadius: "50%",
          background: statusColors[status] || "var(--text-faint)",
          border: "2px solid var(--bg)",
          boxShadow: `0 0 6px ${statusColors[status] || "transparent"}`,
        }} />
      )}
    </span>
  );
}
