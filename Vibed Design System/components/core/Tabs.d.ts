import React from "react";

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  /** Controlled active tab id. Falls back to first tab. */
  value?: string;
  onChange?: (id: string) => void;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}

/** Segmented NLE-style tab control — active segment fills cyan with a glow. */
export function Tabs(props: TabsProps): JSX.Element;
