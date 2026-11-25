"use client";

import * as React from "react";
import { createPortal } from "react-dom";

const useIsoLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

// Keep the React tree and editor instance mounted while its DOM changes hosts.
export function PromptEditorPortal({ target, children }: {
  target: HTMLDivElement | null;
  children: React.ReactNode;
}) {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const element = document.createElement("div");
    element.className = "h-full min-h-0";
    setContainer(element);
    return () => element.remove();
  }, []);
  useIsoLayoutEffect(() => {
    if (container && target) target.appendChild(container);
  }, [container, target]);
  return container ? createPortal(children, container) : null;
}
