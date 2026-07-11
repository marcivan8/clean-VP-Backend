import React from "react";

/**
 * Icon — Lucide line icons (product UI) and Phosphor duotone (hero/marketing).
 *
 * Rules:
 *  - `set="lucide"` (default) — use everywhere in the product editor, sidebar,
 *    timeline, settings. Thin 1.75px stroke, currentColor.
 *  - `set="phosphor"` — use ONLY for landing-page heroes, onboarding, and
 *    marketing moments. Never mix into product chrome alongside Lucide.
 *
 * Lucide requires window.lucide (UMD) on the page.
 * Phosphor requires @phosphor-icons/web duotone UMD on the page —
 *   it registers <ph-*> custom elements automatically.
 */
export function Icon({
  name,
  size = 18,
  strokeWidth = 1.75,
  color = "currentColor",
  set = "lucide",
  style = {},
  ...rest
}) {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!ref.current) return;

    if (set === "lucide") {
      if (typeof window === "undefined" || !window.lucide) return;
      ref.current.innerHTML = "";
      const el = document.createElement("i");
      el.setAttribute("data-lucide", name);
      ref.current.appendChild(el);
      try {
        window.lucide.createIcons({
          attrs: { width: size, height: size, "stroke-width": strokeWidth },
          nameAttr: "data-lucide",
        });
      } catch (e) { /* lucide not ready */ }
    }

    // Phosphor custom elements register themselves; nothing to do after mount.
  }, [name, size, strokeWidth, set]);

  if (set === "phosphor") {
    // Phosphor duotone custom element — <ph-scissors-duotone> etc.
    const tag = `ph-${name}-duotone`;
    return React.createElement(tag, {
      style: {
        display: "inline-flex",
        fontSize: size,
        color,
        "--ph-color": color,
        "--ph-fill-color": color,
        ...style,
      },
      "aria-hidden": "true",
      ...rest,
    });
  }

  return (
    <span
      ref={ref}
      aria-hidden="true"
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        color,
        lineHeight: 0,
        flexShrink: 0,
        ...style,
      }}
      {...rest}
    />
  );
}
