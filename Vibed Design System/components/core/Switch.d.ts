import React from "react";

export interface SwitchProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  disabled?: boolean;
  /** Optional trailing label. */
  label?: string;
  style?: React.CSSProperties;
}

/** Toggle switch — glows cyan when on. */
export function Switch(props: SwitchProps): JSX.Element;
