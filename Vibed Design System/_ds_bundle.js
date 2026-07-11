/* @ds-bundle: {"format":3,"namespace":"VibedDesignSystem_013733","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"PromptBar","sourcePath":"components/core/PromptBar.jsx"},{"name":"Slider","sourcePath":"components/core/Slider.jsx"},{"name":"Switch","sourcePath":"components/core/Switch.jsx"},{"name":"Tabs","sourcePath":"components/core/Tabs.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"5a02f59734e7","components/core/Badge.jsx":"1dd4f631850b","components/core/Button.jsx":"d0bbcf3f7fcb","components/core/Card.jsx":"e55b3e3fa088","components/core/Icon.jsx":"a7615cdbe979","components/core/IconButton.jsx":"b94fa218ffe8","components/core/Input.jsx":"e58e63020ec1","components/core/PromptBar.jsx":"e17eb381762d","components/core/Slider.jsx":"fd485381d5bf","components/core/Switch.jsx":"117535cc4b40","components/core/Tabs.jsx":"266e3c1699df","components/core/Tag.jsx":"c236184f47bf","ui_kits/studio/studio-app.jsx":"89a71ad3cd78","ui_kits/studio/studio-parts.jsx":"87fb31740386","ui_kits/studio/studio-screens.jsx":"a2537c11a687"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.VibedDesignSystem_013733 = window.VibedDesignSystem_013733 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Avatar — circular, glass ring. Image or initials. */
function Avatar({
  src,
  name = "",
  size = 36,
  status = null,
  style = {},
  ...rest
}) {
  const initials = name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const statusColors = {
    online: "var(--cyan-500)",
    render: "var(--violet-500)",
    rec: "var(--rec)",
    away: "var(--warning)"
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: "relative",
      display: "inline-flex",
      flexShrink: 0,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      overflow: "hidden",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--grad-accent-soft)",
      border: "1px solid var(--border-strong)",
      color: "var(--text-strong)",
      fontFamily: "var(--f-mono)",
      fontSize: size * 0.36,
      letterSpacing: "0.02em"
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials || "?"), status && /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: -1,
      bottom: -1,
      width: Math.max(8, size * 0.26),
      height: Math.max(8, size * 0.26),
      borderRadius: "50%",
      background: statusColors[status] || "var(--text-faint)",
      border: "2px solid var(--bg)",
      boxShadow: `0 0 6px ${statusColors[status] || "transparent"}`
    }
  }));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Status badge with a glowing dot — the studio "LED" indicator. */
function Badge({
  children,
  tone = "cyan",
  dot = true,
  style = {},
  ...rest
}) {
  const tones = {
    cyan: {
      color: "var(--cyan-400)",
      dotColor: "var(--cyan-500)",
      glow: "0 0 8px rgba(0,229,255,0.9)"
    },
    violet: {
      color: "var(--violet-400)",
      dotColor: "var(--violet-500)",
      glow: "0 0 8px rgba(138,43,226,0.9)"
    },
    success: {
      color: "var(--success)",
      dotColor: "var(--success)",
      glow: "0 0 8px rgba(52,211,153,0.8)"
    },
    warning: {
      color: "var(--warning)",
      dotColor: "var(--warning)",
      glow: "0 0 8px rgba(251,191,36,0.8)"
    },
    danger: {
      color: "var(--danger)",
      dotColor: "var(--danger)",
      glow: "0 0 8px rgba(251,106,106,0.8)"
    },
    rec: {
      color: "var(--rec)",
      dotColor: "var(--rec)",
      glow: "0 0 8px rgba(255,59,92,0.9)"
    },
    neutral: {
      color: "var(--text-muted)",
      dotColor: "var(--text-faint)",
      glow: "none"
    }
  };
  const t = tones[tone] || tones.cyan;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
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
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: t.dotColor,
      boxShadow: t.glow
    }
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vibed primary action / glass / ghost button.
 * Mono-uppercase label, soft lift + neon glow on hover.
 */
function Button({
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
    sm: {
      padding: "6px 12px",
      fontSize: 12
    },
    md: {
      padding: "9px 16px",
      fontSize: 13
    },
    lg: {
      padding: "12px 22px",
      fontSize: 14
    }
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
    transition: "transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out), border-color var(--dur-base) var(--ease-out), background var(--dur-base) var(--ease-out)",
    ...sizes[size]
  };
  const variants = {
    primary: {
      color: "var(--accent-contrast)",
      background: "var(--accent)",
      boxShadow: "0 0 24px rgba(0,229,255,0.30), var(--shadow-glass-top)"
    },
    glass: {
      color: "var(--text-strong)",
      background: "var(--surface-card-strong)",
      borderColor: "var(--border-hairline)",
      backdropFilter: "var(--blur-glass)",
      WebkitBackdropFilter: "var(--blur-glass)",
      boxShadow: "var(--shadow-glass-top)"
    },
    ghost: {
      color: "var(--text-muted)",
      background: "transparent"
    },
    danger: {
      color: "#fff",
      background: "var(--danger)",
      boxShadow: "0 0 20px rgba(251,106,106,0.25)"
    }
  };
  const [hover, setHover] = React.useState(false);
  const [press, setPress] = React.useState(false);
  const hoverFx = !disabled && hover ? variant === "primary" ? {
    boxShadow: "0 0 34px rgba(0,229,255,0.45), var(--shadow-glass-top)",
    transform: press ? "scale(0.99)" : "translateY(-1px)"
  } : variant === "ghost" ? {
    color: "var(--text-strong)",
    background: "var(--surface-card)",
    transform: press ? "scale(0.99)" : "translateY(-1px)"
  } : {
    borderColor: "var(--border-strong)",
    boxShadow: "var(--shadow-lg), var(--glow-cyan-soft), var(--shadow-glass-top)",
    transform: press ? "scale(0.99)" : "translateY(-1px)"
  } : {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPress(false);
    },
    onMouseDown: () => setPress(true),
    onMouseUp: () => setPress(false),
    style: {
      ...base,
      ...variants[variant],
      ...hoverFx,
      ...style
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Card — glass fill, hairline stroke, lit top edge, elevation. */
function Card({
  children,
  padding = 20,
  interactive = false,
  glow = false,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const hoverFx = interactive && hover ? {
    transform: "translateY(-2px)",
    borderColor: "var(--border-strong)",
    boxShadow: "var(--shadow-lg)" + (glow ? ", var(--glow-cyan-soft)" : "") + ", var(--shadow-glass-top)"
  } : {};
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Icon({
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
          attrs: {
            width: size,
            height: size,
            "stroke-width": strokeWidth
          },
          nameAttr: "data-lucide"
        });
      } catch (e) {/* lucide not ready */}
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
        ...style
      },
      "aria-hidden": "true",
      ...rest
    });
  }
  return /*#__PURE__*/React.createElement("span", _extends({
    ref: ref,
    "aria-hidden": "true",
    style: {
      display: "inline-flex",
      width: size,
      height: size,
      color,
      lineHeight: 0,
      flexShrink: 0,
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Round icon-only button — toolbar / transport affordance. */
function IconButton({
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
      color: active ? "var(--accent)" : "var(--text-muted)"
    },
    solid: {
      background: "var(--accent)",
      border: "1px solid transparent",
      color: "var(--accent-contrast)",
      boxShadow: "0 0 20px rgba(0,229,255,0.3)"
    }
  };
  const hoverFx = !disabled && hover && !active ? {
    color: "var(--text-strong)",
    background: "var(--surface-card)",
    borderColor: "var(--border-hairline)"
  } : {};
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
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
      ...style
    }
  }, rest), icon);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Glass text input with focus glow. */
function Input({
  label,
  hint,
  iconLeft = null,
  error = false,
  style = {},
  containerStyle = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7,
      ...containerStyle
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "10px 12px",
      borderRadius: "var(--radius-md)",
      background: "var(--surface-card)",
      border: "1px solid",
      borderColor: error ? "var(--danger)" : focus ? "var(--accent)" : "var(--border-hairline)",
      boxShadow: focus ? "0 0 0 3px rgba(0,229,255,0.12)" : "none",
      transition: "all var(--dur-base) var(--ease-out)"
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-muted)",
      display: "inline-flex"
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      border: "none",
      outline: "none",
      background: "transparent",
      fontFamily: "var(--f-sans)",
      fontSize: 14,
      color: "var(--text-strong)",
      ...style
    }
  }, rest))), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: error ? "var(--danger)" : "var(--text-faint)"
    }
  }, hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/core/PromptBar.jsx
try { (() => {
/**
 * PromptBar — Vibed's signature conversational input. A lit glass capsule
 * where the user types plain-language editing direction.
 */
function PromptBar({
  value = "",
  onChange,
  onSubmit,
  placeholder = "Describe an edit…",
  busy = false,
  suggestions = [],
  leftAccessory = null,
  style = {}
}) {
  const [focus, setFocus] = React.useState(false);
  const submit = () => {
    if (onSubmit && value.trim() && !busy) onSubmit(value);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10,
      ...style
    }
  }, suggestions.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, suggestions.map((s, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => onChange && onChange(s),
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
      color: "var(--text-muted)",
      background: "var(--surface-card)",
      border: "1px solid var(--border-hairline)",
      borderRadius: "var(--radius-pill)",
      padding: "5px 12px",
      cursor: "pointer",
      transition: "all var(--dur-base) var(--ease-out)"
    },
    onMouseEnter: e => {
      e.currentTarget.style.color = "var(--accent)";
      e.currentTarget.style.borderColor = "var(--border-strong)";
    },
    onMouseLeave: e => {
      e.currentTarget.style.color = "var(--text-muted)";
      e.currentTarget.style.borderColor = "var(--border-hairline)";
    }
  }, s))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 12px 12px 18px",
      borderRadius: "var(--radius-xl)",
      background: "var(--surface-card-strong)",
      backdropFilter: "var(--blur-glass)",
      WebkitBackdropFilter: "var(--blur-glass)",
      border: "1px solid",
      borderColor: focus ? "var(--accent)" : "var(--border-hairline)",
      boxShadow: focus ? "0 0 0 3px rgba(0,229,255,0.12), var(--shadow-lg), var(--shadow-glass-top)" : "var(--shadow-md), var(--shadow-glass-top)",
      transition: "all var(--dur-base) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 8,
      height: 8,
      borderRadius: "50%",
      flexShrink: 0,
      background: busy ? "var(--violet-500)" : "var(--cyan-500)",
      boxShadow: busy ? "0 0 8px rgba(138,43,226,0.9)" : "var(--glow-dot)",
      animation: busy ? "vibedPulse 1.1s var(--ease-in-out) infinite" : "none"
    }
  }), leftAccessory, /*#__PURE__*/React.createElement("input", {
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    onKeyDown: e => {
      if (e.key === "Enter") submit();
    },
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    placeholder: placeholder,
    disabled: busy,
    style: {
      flex: 1,
      border: "none",
      outline: "none",
      background: "transparent",
      fontFamily: "var(--f-sans)",
      fontSize: 15,
      color: "var(--text-strong)"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: submit,
    "aria-label": "Send",
    disabled: busy || !value.trim(),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 38,
      height: 38,
      borderRadius: "var(--radius-md)",
      border: "none",
      cursor: busy || !value.trim() ? "default" : "pointer",
      background: value.trim() && !busy ? "var(--accent)" : "var(--ink-700)",
      color: value.trim() && !busy ? "var(--accent-contrast)" : "var(--text-faint)",
      boxShadow: value.trim() && !busy ? "0 0 20px rgba(0,229,255,0.35)" : "none",
      transition: "all var(--dur-base) var(--ease-out)",
      flexShrink: 0,
      fontFamily: "var(--f-mono)",
      fontSize: 16,
      fontWeight: 700
    }
  }, busy ? "···" : "↑")), /*#__PURE__*/React.createElement("style", null, `@keyframes vibedPulse{0%,100%{opacity:1}50%{opacity:.4}}`));
}
Object.assign(__ds_scope, { PromptBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/PromptBar.jsx", error: String((e && e.message) || e) }); }

// components/core/Slider.jsx
try { (() => {
/** Slider — cyan→violet filled track with glowing thumb. For scrubbing / params. */
function Slider({
  value = 0,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  showValue = false,
  format,
  style = {}
}) {
  const pct = (value - min) / (max - min) * 100;
  const handle = e => onChange && onChange(Number(e.target.value));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8,
      ...style
    }
  }, (label || showValue) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center"
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, label), showValue && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 12,
      color: "var(--text-body)"
    }
  }, format ? format(value) : value)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 18,
      display: "flex",
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      height: 4,
      borderRadius: 999,
      background: "var(--ink-700)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      width: `${pct}%`,
      height: 4,
      borderRadius: 999,
      background: "var(--grad-accent)",
      boxShadow: "var(--glow-cyan-soft)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: `calc(${pct}% - 7px)`,
      width: 14,
      height: 14,
      borderRadius: "50%",
      background: "var(--paper-50)",
      boxShadow: "0 0 10px rgba(0,229,255,0.6), var(--shadow-sm)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("input", {
    type: "range",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: handle,
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      width: "100%",
      margin: 0,
      opacity: 0,
      height: 18,
      cursor: "pointer"
    }
  })));
}
Object.assign(__ds_scope, { Slider });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Slider.jsx", error: String((e && e.message) || e) }); }

// components/core/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Toggle switch — cyan glow when on. */
function Switch({
  checked = false,
  onChange,
  disabled = false,
  label,
  style = {},
  ...rest
}) {
  const toggle = () => {
    if (!disabled && onChange) onChange(!checked);
  };
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", _extends({
    role: "switch",
    "aria-checked": checked,
    onClick: toggle,
    style: {
      position: "relative",
      width: 40,
      height: 22,
      borderRadius: 999,
      background: checked ? "var(--accent)" : "var(--ink-700)",
      border: "1px solid",
      borderColor: checked ? "transparent" : "var(--border-hairline)",
      boxShadow: checked ? "0 0 16px rgba(0,229,255,0.4)" : "none",
      transition: "all var(--dur-base) var(--ease-out)",
      flexShrink: 0
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: checked ? 20 : 2,
      width: 16,
      height: 16,
      borderRadius: "50%",
      background: checked ? "var(--accent-contrast)" : "var(--paper-50)",
      transition: "left var(--dur-base) var(--ease-out)",
      boxShadow: "var(--shadow-sm)"
    }
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-sans)",
      fontSize: 14,
      color: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Switch.jsx", error: String((e && e.message) || e) }); }

// components/core/Tabs.jsx
try { (() => {
/** Segmented NLE-style tabs. */
function Tabs({
  tabs = [],
  value,
  onChange,
  size = "md",
  style = {}
}) {
  const active = value ?? (tabs[0] && tabs[0].id);
  const pad = size === "sm" ? "5px 12px" : "8px 16px";
  const fs = size === "sm" ? 11 : 12;
  return /*#__PURE__*/React.createElement("div", {
    role: "tablist",
    style: {
      display: "inline-flex",
      gap: 2,
      padding: 3,
      borderRadius: "var(--radius-md)",
      background: "var(--surface-card)",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--shadow-glass-top)",
      ...style
    }
  }, tabs.map(t => {
    const on = t.id === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.id,
      role: "tab",
      "aria-selected": on,
      onClick: () => onChange && onChange(t.id),
      style: {
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
        transition: "all var(--dur-base) var(--ease-out)"
      }
    }, t.icon, t.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Technical metadata tag — codec, timecode, tool label. Square, dense. */
function Tag({
  children,
  active = false,
  icon = null,
  onRemove = null,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", _extends({
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: active ? "var(--accent)" : "var(--text-body)",
      padding: "5px 9px",
      borderRadius: "var(--radius-sm)",
      border: "1px solid",
      borderColor: active ? "var(--border-strong)" : "var(--border-hairline)",
      background: active ? "var(--surface-card-strong)" : "var(--surface-card)",
      transition: "all var(--dur-base) var(--ease-out)",
      ...style
    }
  }, rest), icon, children, onRemove && /*#__PURE__*/React.createElement("button", {
    onClick: onRemove,
    "aria-label": "Remove",
    style: {
      border: "none",
      background: "none",
      cursor: "pointer",
      padding: 0,
      marginLeft: 2,
      color: hover ? "var(--text-strong)" : "var(--text-faint)",
      fontFamily: "var(--f-mono)",
      fontSize: 12,
      lineHeight: 1
    }
  }, "\u2715"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// ui_kits/studio/studio-app.jsx
try { (() => {
/* Vibed Studio — app state machine wiring screens together. */

const VDS3 = window.VibedDesignSystem_013733;
const SCRIPTED = [{
  match: /caption/i,
  text: "Added burned-in captions across the interview track, synced to the dialogue. Styled with the studio preset.",
  edits: [{
    icon: "captions",
    label: "Captions"
  }, {
    icon: "wand-2",
    label: "Auto-sync"
  }],
  clip: {
    track: "captions",
    label: "CC · synced",
    accent: true
  }
}, {
  match: /(warm|grade|color|colour)/i,
  text: "Applied a warm grade — lifted shadows toward amber and pulled +6 on temperature. Preview updated.",
  edits: [{
    icon: "palette",
    label: "Warm LUT"
  }, {
    icon: "sun",
    label: "+6 temp"
  }],
  clip: {
    track: "video",
    label: "Grade",
    accent: true
  }
}, {
  match: /(punch|speaker|zoom|close)/i,
  text: "Punched in on the speaker for the 00:18–00:31 range with a slow push. Reframed to a medium close-up.",
  edits: [{
    icon: "crop",
    label: "Reframe"
  }, {
    icon: "move",
    label: "Slow push"
  }],
  clip: {
    track: "video",
    label: "Push-in",
    accent: true
  }
}, {
  match: /(tighten|trim|cut|beat|short)/i,
  text: "Tightened the opening — removed 4.2s of dead air before the first line and trimmed two filler pauses.",
  edits: [{
    icon: "scissors",
    label: "−4.2s"
  }, {
    icon: "git-merge",
    label: "2 cuts"
  }],
  clip: {
    track: "video",
    label: "Tightened",
    accent: true
  }
}];
function StudioApp() {
  const [screen, setScreen] = React.useState("picker");
  const [project, setProject] = React.useState(null);
  const [tool, setTool] = React.useState("edit");
  const [playing, setPlaying] = React.useState(false);
  const [pos, setPos] = React.useState(18.4);
  const dur = 132;
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [messages, setMessages] = React.useState([{
    role: "assistant",
    text: "Imported 38 clips and built a rough cut. What would you like to change first?"
  }]);
  const [clips, setClips] = React.useState({
    video: [{
      label: "Establishing",
      len: 2
    }, {
      label: "Interview A",
      len: 4,
      accent: true
    }, {
      label: "B-roll",
      len: 2
    }, {
      label: "Interview B",
      len: 3
    }],
    audio: [{
      label: "Room tone",
      len: 5
    }, {
      label: "Score",
      len: 6,
      accent: false
    }],
    captions: [{
      label: "CC · auto",
      len: 7
    }]
  });

  // playback tick
  React.useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPos(p => p >= dur ? 0 : p + 0.25), 100);
    return () => clearInterval(id);
  }, [playing]);
  const openProject = p => {
    setProject(p);
    setScreen("editor");
  };
  const submit = text => {
    const value = (text || draft).trim();
    if (!value) return;
    setMessages(m => [...m, {
      role: "user",
      text: value
    }]);
    setDraft("");
    setBusy(true);
    setTimeout(() => {
      const rule = SCRIPTED.find(r => r.match.test(value)) || {
        text: "Done — applied that change and re-conformed the timeline. Take a look at the preview.",
        edits: [{
          icon: "check",
          label: "Applied"
        }],
        clip: {
          track: "video",
          label: "Edit",
          accent: true
        }
      };
      setMessages(m => [...m, {
        role: "assistant",
        text: rule.text,
        edits: rule.edits
      }]);
      if (rule.clip) {
        setClips(c => {
          const next = {
            ...c,
            video: [...c.video],
            audio: [...c.audio],
            captions: [...c.captions]
          };
          next[rule.clip.track] = [...next[rule.clip.track], {
            label: rule.clip.label,
            len: 2,
            accent: rule.clip.accent
          }];
          return next;
        });
      }
      setBusy(false);
    }, 1400);
  };
  if (screen === "picker") {
    return /*#__PURE__*/React.createElement(window.ProjectPicker, {
      onOpen: openProject
    });
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "film-grain"
  }), /*#__PURE__*/React.createElement(window.TopBar, {
    project: project ? project.name : "Untitled",
    onBack: () => setScreen("picker"),
    collaborators: [{
      name: "Ana Ruiz",
      status: "online"
    }, {
      name: "Theo Vance",
      status: "render"
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(window.ToolRail, {
    active: tool,
    onSelect: setTool
  }), /*#__PURE__*/React.createElement(window.PreviewStage, {
    playing: playing,
    onTogglePlay: () => setPlaying(p => !p),
    pos: pos,
    dur: dur,
    onSeek: setPos
  }), /*#__PURE__*/React.createElement(window.ConversationPanel, {
    messages: messages,
    draft: draft,
    setDraft: setDraft,
    onSubmit: submit,
    busy: busy
  })), /*#__PURE__*/React.createElement(window.Timeline, {
    clips: clips,
    pos: pos,
    dur: dur
  }));
}
Object.assign(window, {
  StudioApp
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/studio/studio-app.jsx", error: String((e && e.message) || e) }); }

// ui_kits/studio/studio-parts.jsx
try { (() => {
/* Vibed Studio — shared UI parts. Exposed on window for cross-file use. */

const VDS = window.VibedDesignSystem_013733;
function toTimecode(sec) {
  const f = Math.floor(sec % 1 * 24).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  return `${m}:${s}:${f}`;
}

/* ---- Top transport / project bar -------------------------------- */
function TopBar({
  project,
  onBack,
  collaborators
}) {
  const {
    IconButton,
    Icon,
    Badge,
    Avatar
  } = VDS;
  return /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 16,
      height: 56,
      padding: "0 16px",
      flexShrink: 0,
      borderBottom: "1px solid var(--border-hairline)",
      background: "rgba(10,10,11,0.7)",
      backdropFilter: "var(--blur-glass)",
      position: "relative",
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo.png",
    width: "26",
    height: "26",
    alt: "Vibed"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-display)",
      fontSize: 20,
      color: "var(--text-strong)"
    }
  }, "Vibed")), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 1,
      height: 22,
      background: "var(--border-hairline)"
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      border: "none",
      background: "none",
      cursor: "pointer",
      fontFamily: "var(--f-sans)",
      fontSize: 14,
      color: "var(--text-body)",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevron-left",
    size: 16
  }), project), /*#__PURE__*/React.createElement(Badge, {
    tone: "violet"
  }, "Rendering \xB7 38%"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center"
    }
  }, collaborators.map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: c.name,
    style: {
      marginLeft: i ? -8 : 0
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: c.name,
    status: c.status,
    size: 28
  })))), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "share-2",
      size: 18
    }),
    label: "Share"
  }), /*#__PURE__*/React.createElement(VDS.Button, {
    variant: "glass",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "download",
      size: 15
    })
  }, "Export")));
}

/* ---- Left tool rail --------------------------------------------- */
function ToolRail({
  active,
  onSelect
}) {
  const {
    IconButton,
    Icon
  } = VDS;
  const tools = [{
    id: "edit",
    icon: "scissors",
    label: "Edit"
  }, {
    id: "generate",
    icon: "sparkles",
    label: "Generate"
  }, {
    id: "captions",
    icon: "captions",
    label: "Captions"
  }, {
    id: "color",
    icon: "palette",
    label: "Color"
  }, {
    id: "audio",
    icon: "volume-2",
    label: "Audio"
  }, {
    id: "layers",
    icon: "layers",
    label: "Layers"
  }];
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      width: 60,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      padding: "14px 0",
      borderRight: "1px solid var(--border-hairline)",
      background: "rgba(18,18,20,0.5)",
      position: "relative",
      zIndex: 4
    }
  }, tools.map(t => /*#__PURE__*/React.createElement(IconButton, {
    key: t.id,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: t.icon,
      size: 19
    }),
    label: t.label,
    active: active === t.id,
    onClick: () => onSelect(t.id),
    size: 40
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "settings",
      size: 19
    }),
    label: "Settings",
    size: 40
  })));
}

/* ---- Center preview stage --------------------------------------- */
function PreviewStage({
  playing,
  onTogglePlay,
  pos,
  dur,
  onSeek
}) {
  const {
    IconButton,
    Icon,
    Slider,
    Tag
  } = VDS;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      padding: 18,
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: 1,
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--shadow-lg), var(--shadow-glass-top)",
      background: "radial-gradient(120% 90% at 30% 20%, #123042, #0a0a0b 70%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "radial-gradient(40% 55% at 62% 58%, rgba(0,229,255,0.18), transparent 60%), radial-gradient(45% 50% at 25% 75%, rgba(138,43,226,0.16), transparent 65%)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "film-grain",
    style: {
      position: "absolute",
      opacity: 0.06
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      textAlign: "center",
      color: "var(--text-faint)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "clapperboard",
    size: 34
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      marginTop: 8
    }
  }, "Scene 04 \xB7 Interview")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 12,
      left: 12,
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Tag, null, "4K \xB7 ProRes"), /*#__PURE__*/React.createElement(Tag, null, toTimecode(pos))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 12,
      right: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--text-body)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "traffic-dot rec"
  }), "REC 00:42"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "skip-back",
      size: 18
    }),
    label: "Start"
  }), /*#__PURE__*/React.createElement(IconButton, {
    variant: "solid",
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: playing ? "pause" : "play",
      size: 18
    }),
    label: playing ? "Pause" : "Play",
    onClick: onTogglePlay
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "skip-forward",
      size: 18
    }),
    label: "End"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 12,
      color: "var(--text-body)"
    }
  }, toTimecode(pos)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(Slider, {
    value: pos,
    max: dur,
    step: 0.04,
    onChange: onSeek
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 12,
      color: "var(--text-faint)"
    }
  }, toTimecode(dur))));
}

/* ---- Bottom timeline -------------------------------------------- */
function Timeline({
  clips,
  pos,
  dur
}) {
  const {
    Icon
  } = VDS;
  const tracks = [{
    name: "V1",
    icon: "film",
    items: clips.video
  }, {
    name: "A1",
    icon: "audio-lines",
    items: clips.audio
  }, {
    name: "CC",
    icon: "captions",
    items: clips.captions
  }];
  const playhead = pos / dur * 100;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: 168,
      flexShrink: 0,
      borderTop: "1px solid var(--border-hairline)",
      background: "rgba(18,18,20,0.6)",
      padding: "10px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 7,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      marginBottom: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 10,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--text-faint)"
    }
  }, "Timeline"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 10,
      color: "var(--text-faint)"
    }
  }, clips.video.length + clips.audio.length, " clips \xB7 ", Math.round(dur / 60), "m")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `calc(34px + ${playhead}% * 0.93)`,
      width: 1.5,
      background: "var(--cyan-500)",
      boxShadow: "var(--glow-cyan-soft)",
      zIndex: 3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: -2,
      left: -4,
      width: 9,
      height: 9,
      borderRadius: "50%",
      background: "var(--cyan-500)",
      boxShadow: "var(--glow-dot)"
    }
  })), tracks.map(tr => /*#__PURE__*/React.createElement("div", {
    key: tr.name,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 26,
      display: "flex",
      alignItems: "center",
      gap: 0,
      fontFamily: "var(--f-mono)",
      fontSize: 10,
      color: "var(--text-faint)"
    }
  }, tr.name), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      gap: 4,
      height: "100%"
    }
  }, tr.items.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: c.len,
      minWidth: 0,
      borderRadius: 5,
      padding: "4px 8px",
      display: "flex",
      alignItems: "center",
      gap: 6,
      overflow: "hidden",
      border: "1px solid",
      borderColor: c.accent ? "var(--border-strong)" : "var(--border-hairline)",
      background: c.accent ? "var(--grad-accent-soft)" : "var(--surface-card-strong)",
      boxShadow: c.accent ? "var(--glow-cyan-soft)" : "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: tr.icon,
    size: 12,
    color: "var(--text-muted)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 10,
      color: "var(--text-body)",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      overflow: "hidden"
    }
  }, c.label))))))));
}
Object.assign(window, {
  TopBar,
  ToolRail,
  PreviewStage,
  Timeline,
  toTimecode
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/studio/studio-parts.jsx", error: String((e && e.message) || e) }); }

// ui_kits/studio/studio-screens.jsx
try { (() => {
/* Vibed Studio — conversation panel + screens. */

const VDS2 = window.VibedDesignSystem_013733;

/* ---- Conversation / edit-history panel + prompt ----------------- */
function ConversationPanel({
  messages,
  draft,
  setDraft,
  onSubmit,
  busy
}) {
  const {
    PromptBar,
    Icon,
    Avatar
  } = VDS2;
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 372,
      flexShrink: 0,
      display: "flex",
      flexDirection: "column",
      borderLeft: "1px solid var(--border-hairline)",
      background: "rgba(18,18,20,0.45)",
      position: "relative",
      zIndex: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      padding: "16px 18px",
      borderBottom: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "traffic-dot"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 12,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: "var(--text-strong)"
    }
  }, "Director"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      color: "var(--text-faint)"
    }
  }, messages.filter(m => m.role === "user").length, " prompts")), /*#__PURE__*/React.createElement("div", {
    ref: scrollRef,
    style: {
      flex: 1,
      overflowY: "auto",
      padding: 18,
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, messages.map((m, i) => /*#__PURE__*/React.createElement(MessageBubble, {
    key: i,
    m: m
  })), busy && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      color: "var(--text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "traffic-dot violet",
    style: {
      animation: "vibedPulse 1.1s ease-in-out infinite"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 12,
      letterSpacing: "0.06em"
    }
  }, "Applying edit\u2026"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 16,
      borderTop: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement(PromptBar, {
    value: draft,
    onChange: setDraft,
    onSubmit: onSubmit,
    busy: busy,
    placeholder: "Describe an edit\u2026",
    suggestions: messages.length <= 2 ? ["Add captions", "Punch in on speaker", "Warm the grade"] : []
  })), /*#__PURE__*/React.createElement("style", null, `@keyframes vibedPulse{0%,100%{opacity:1}50%{opacity:.4}}`));
}
function MessageBubble({
  m
}) {
  const {
    Icon,
    Tag
  } = VDS2;
  if (m.role === "user") {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        alignSelf: "flex-end",
        maxWidth: "86%"
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: "var(--grad-accent-soft)",
        border: "1px solid var(--border-strong)",
        borderRadius: "14px 14px 4px 14px",
        padding: "10px 14px",
        fontFamily: "var(--f-sans)",
        fontSize: 14,
        color: "var(--text-strong)",
        lineHeight: 1.45
      }
    }, m.text));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "92%",
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-hairline)",
      borderRadius: "4px 14px 14px 14px",
      padding: "12px 14px",
      boxShadow: "var(--shadow-glass-top)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      marginBottom: 7
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 14,
    color: "var(--accent)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 10,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "var(--text-muted)"
    }
  }, "Vibed")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--f-sans)",
      fontSize: 14,
      color: "var(--text-body)",
      lineHeight: 1.5
    }
  }, m.text), m.edits && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      marginTop: 10
    }
  }, m.edits.map((e, i) => /*#__PURE__*/React.createElement(Tag, {
    key: i,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: e.icon,
      size: 12
    })
  }, e.label)))));
}

/* ---- Project picker (landing) ----------------------------------- */
function ProjectPicker({
  onOpen
}) {
  const {
    Card,
    Badge,
    Button,
    Icon,
    Avatar
  } = VDS2;
  const projects = [{
    name: "Founder interview",
    meta: "4K · 12:04 · 38 clips",
    status: "cyan",
    statusLabel: "Ready",
    tint: "#123042"
  }, {
    name: "Product launch teaser",
    meta: "1080p · 0:48 · 14 clips",
    status: "violet",
    statusLabel: "Rendering",
    tint: "#2a1a42"
  }, {
    name: "Travel recap — Lisbon",
    meta: "4K · 3:22 · 61 clips",
    status: "neutral",
    statusLabel: "Draft",
    tint: "#0f2a2e"
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      minHeight: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "0 24px",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "aurora"
  }), /*#__PURE__*/React.createElement("div", {
    className: "film-grain"
  }), /*#__PURE__*/React.createElement("header", {
    style: {
      position: "relative",
      zIndex: 2,
      width: "100%",
      maxWidth: 1080,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "22px 0"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo.png",
    width: "30",
    height: "30",
    alt: "Vibed"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-display)",
      fontSize: 24,
      color: "var(--text-strong)"
    }
  }, "Vibed"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: "auto",
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--f-sans)",
      fontSize: 14,
      color: "var(--text-muted)"
    }
  }, "Projects"), /*#__PURE__*/React.createElement(Avatar, {
    name: "Ana Ruiz",
    status: "online",
    size: 30
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      zIndex: 2,
      width: "100%",
      maxWidth: 1080,
      marginTop: 36
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      color: "var(--accent)"
    }
  }, "\u25CF Studio"), /*#__PURE__*/React.createElement("h1", {
    className: "display",
    style: {
      fontSize: 60,
      margin: "12px 0 8px",
      maxWidth: 740
    }
  }, "Edit by ", /*#__PURE__*/React.createElement("em", {
    style: {
      fontStyle: "italic"
    }
  }, "talking"), "."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontFamily: "var(--f-sans)",
      fontSize: 17,
      color: "var(--text-muted)",
      maxWidth: 520,
      margin: 0
    }
  }, "Describe the cut you want \u2014 Vibed conforms the timeline, captions and color in real time."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      marginTop: 26
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 15
    }),
    onClick: () => onOpen(projects[0])
  }, "New project"), /*#__PURE__*/React.createElement(Button, {
    variant: "glass",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "upload",
      size: 15
    })
  }, "Import footage")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      margin: "40px 0 16px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, "Recent"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--border-hairline)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 16,
      paddingBottom: 40
    }
  }, projects.map(p => /*#__PURE__*/React.createElement(Card, {
    key: p.name,
    interactive: true,
    onClick: () => onOpen(p),
    padding: 0,
    style: {
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 124,
      position: "relative",
      background: `radial-gradient(110% 90% at 30% 20%, ${p.tint}, #0a0a0b 75%)`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "radial-gradient(50% 60% at 65% 60%, rgba(0,229,255,0.14), transparent 60%)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 10,
      left: 10
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: p.status,
    dot: p.status !== "neutral"
  }, p.statusLabel)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      right: 10,
      bottom: 10,
      width: 34,
      height: 34,
      borderRadius: "50%",
      background: "rgba(10,10,11,0.55)",
      backdropFilter: "blur(8px)",
      border: "1px solid var(--border-hairline)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 15,
    color: "var(--text-strong)"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--f-display)",
      fontSize: 21,
      color: "var(--text-strong)"
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--f-mono)",
      fontSize: 11,
      color: "var(--text-faint)",
      marginTop: 4
    }
  }, p.meta)))))));
}
Object.assign(window, {
  ConversationPanel,
  MessageBubble,
  ProjectPicker
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/studio/studio-screens.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.PromptBar = __ds_scope.PromptBar;

__ds_ns.Slider = __ds_scope.Slider;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Tag = __ds_scope.Tag;

})();
