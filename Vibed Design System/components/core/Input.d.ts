import React from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Mono-uppercase field label rendered above the input. */
  label?: string;
  /** Helper or error text below. */
  hint?: string;
  iconLeft?: React.ReactNode;
  /** Error state — red border + red hint. */
  error?: boolean;
  containerStyle?: React.CSSProperties;
}

/** Glass text input with a cyan focus ring. */
export function Input(props: InputProps): JSX.Element;
