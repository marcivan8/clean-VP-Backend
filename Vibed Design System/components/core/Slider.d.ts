import React from "react";

export interface SliderProps {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (next: number) => void;
  /** Mono-uppercase label above the track. */
  label?: string;
  /** Show the current value at top-right. */
  showValue?: boolean;
  /** Format the displayed value (e.g. timecode). */
  format?: (v: number) => string;
  style?: React.CSSProperties;
}

/** Parameter / scrub slider — cyan→violet filled track with a glowing thumb. */
export function Slider(props: SliderProps): JSX.Element;
