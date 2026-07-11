import React from "react";

export type BadgeTone = "cyan" | "violet" | "success" | "warning" | "danger" | "rec" | "neutral";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** Show the leading glowing dot. Default true. */
  dot?: boolean;
  children: React.ReactNode;
}

/** Pill status badge with a glowing "LED" dot and mono-uppercase label. */
export function Badge(props: BadgeProps): JSX.Element;
