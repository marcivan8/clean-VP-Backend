import React from "react";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icon node (e.g. <Icon name="play" />). */
  icon: React.ReactNode;
  /** Accessible label (also the tooltip title). */
  label: string;
  variant?: "glass" | "solid";
  /** Square px size. Default 36. */
  size?: number;
  /** Active/selected state — cyan icon + lit stroke. */
  active?: boolean;
  disabled?: boolean;
}

/** Square icon-only button for toolbars and the transport bar. */
export function IconButton(props: IconButtonProps): JSX.Element;
