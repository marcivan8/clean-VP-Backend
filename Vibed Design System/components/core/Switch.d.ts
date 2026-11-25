import React from "react";

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  /** Optional trailing label. */
  label?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  name?: string;
  value?: string;
  style?: React.CSSProperties;
}

/** Accessible controlled toggle. onChange receives the new boolean value. */
export function Switch(props: SwitchProps): JSX.Element;
