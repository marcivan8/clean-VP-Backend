import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Inner padding in px. Default 20. */
  padding?: number;
  /** Lift + lit stroke on hover; cursor pointer. */
  interactive?: boolean;
  /** Add a persistent soft cyan glow bloom. */
  glow?: boolean;
  children: React.ReactNode;
}

/**
 * Glass card — semi-transparent fill, backdrop blur, hairline stroke, lit top edge, soft elevation.
 * @startingPoint section="Core" subtitle="Glass surface card" viewport="700x220"
 */
export function Card(props: CardProps): JSX.Element;
