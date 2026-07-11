import React from "react";

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Image URL. Falls back to initials from `name`. */
  src?: string;
  name?: string;
  size?: number;
  /** Glowing status dot. */
  status?: "online" | "render" | "rec" | "away" | null;
}

/** Circular avatar with a glass ring; image or initials, optional glowing status dot. */
export function Avatar(props: AvatarProps): JSX.Element;
