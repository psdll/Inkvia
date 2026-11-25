"use client";

import * as React from "react";
import { useStore } from "@xyflow/react";

// Keep node headings the same screen size from 50% upward; below that they shrink
// with the node. Zoom changes within a capped range do not rerender the heading.
export function CanvasNodeHeading({ children, fixedScreenSize = false, ...props }: React.HTMLAttributes<HTMLDivElement> & { fixedScreenSize?: boolean }) {
  const scale = useStore(state => fixedScreenSize ? 1 / state.transform[2] : Math.min(2, 1 / state.transform[2]));
  return <div {...props} style={{ ...props.style, transform: `scale(${scale})`, transformOrigin: "bottom left", width: `${100 / scale}%` }}>{children}</div>;
}
