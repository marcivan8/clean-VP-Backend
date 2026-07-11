import React from "react";

export interface PromptBarProps {
  value?: string;
  onChange?: (next: string) => void;
  /** Fired on Enter / send-button press with the current value. */
  onSubmit?: (value: string) => void;
  placeholder?: string;
  /** Busy state — violet pulsing dot, disabled input, "···" send glyph. */
  busy?: boolean;
  /** Quick-fill suggestion chips shown above the bar. */
  suggestions?: string[];
  /** Node rendered just left of the input (e.g. an attach IconButton). */
  leftAccessory?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * Vibed's signature conversational input — a lit glass capsule for plain-language editing direction.
 * @startingPoint section="Studio" subtitle="Conversational edit prompt bar" viewport="700x180"
 */
export function PromptBar(props: PromptBarProps): JSX.Element;
