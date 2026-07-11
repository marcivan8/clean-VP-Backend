import React from "react";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Selected state — cyan text + lit stroke. */
  active?: boolean;
  /** Optional leading icon node. */
  icon?: React.ReactNode;
  /** If provided, renders a removable ✕ affordance. */
  onRemove?: () => void;
  children: React.ReactNode;
}

/** Dense, square mono tag for technical metadata (codecs, timecodes, tool labels). */
export function Tag(props: TagProps): JSX.Element;
