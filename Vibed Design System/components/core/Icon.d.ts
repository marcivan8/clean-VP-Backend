import React from "react";

export interface IconProps {
  /**
   * Icon name.
   * - Lucide: kebab-case, e.g. "scissors", "wand-2", "skip-forward"
   * - Phosphor: kebab-case stem only — the duotone suffix is added automatically,
   *   e.g. "scissors" → <ph-scissors-duotone>
   */
  name: string;
  /**
   * Icon set to use.
   * - "lucide" (default) — product UI: sidebar, timeline, settings, toolbar.
   * - "phosphor" — hero/marketing only. Never use alongside Lucide in product chrome.
   */
  set?: "lucide" | "phosphor";
  size?: number;
  /** Lucide only — default 1.75. */
  strokeWidth?: number;
  color?: string;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Icons" subtitle="Lucide line icon or Phosphor duotone" viewport="200x200"
 *
 * Lucide (default) — thin 1.75px stroke, currentColor. Use in all product UI.
 * Phosphor duotone — heavier two-tone fill, for hero/marketing surfaces only.
 *
 * ```jsx
 * // Product UI (Lucide)
 * <Icon name="scissors" size={20} />
 * <Icon name="wand-2" size={18} color="var(--accent)" />
 *
 * // Marketing hero (Phosphor duotone)
 * <Icon name="film-strip" size={64} set="phosphor" color="var(--accent)" />
 * ```
 *
 * Key Lucide glyphs for Vibed:
 *   scissors · skip-back · skip-forward · repeat · mic · film · crop
 *   captions · wand-2 · sparkles · layers · volume-2 · play · pause
 *   download · palette · settings · chevron-right · plus · x · search
 */
export function Icon(props: IconProps): JSX.Element;
