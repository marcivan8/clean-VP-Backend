import React from "react";

export type ButtonVariant = "primary" | "glass" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = cyan glow fill; `glass` = blurred panel; `ghost` = text-only; `danger` = red. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading icon node (e.g. a Lucide <svg/>). */
  iconLeft?: React.ReactNode;
  /** Optional trailing icon node. */
  iconRight?: React.ReactNode;
  disabled?: boolean;
  /** Stretch to fill container width. */
  full?: boolean;
}

/**
 * Vibed action button — mono-uppercase label with a soft lift + neon glow on hover.
 * @startingPoint section="Core" subtitle="Primary / glass / ghost action button" viewport="700x150"
 */
export function Button(props: ButtonProps): JSX.Element;
