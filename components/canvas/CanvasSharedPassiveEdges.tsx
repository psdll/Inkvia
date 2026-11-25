"use client";

import * as React from "react";
import { createPortal } from "react-dom";

const SharedEdgeContext = React.createContext<{
  target: SVGSVGElement | null;
  setTarget: (target: SVGSVGElement | null) => void;
} | null>(null);

export function CanvasSharedEdgeProvider({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = React.useState<SVGSVGElement | null>(null);
  const value = React.useMemo(() => ({ target, setTarget }), [target]);
  return <SharedEdgeContext.Provider value={value}>{children}</SharedEdgeContext.Provider>;
}

export function CanvasSharedEdgeLayer({ canvasRef }: { canvasRef: React.RefObject<HTMLDivElement | null> }) {
  const shared = React.useContext(SharedEdgeContext);
  const [parent, setParent] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => {
    setParent(canvasRef.current?.querySelector<HTMLDivElement>(".react-flow__edges") ?? null);
  }, [canvasRef]);
  // A direct child inherits the existing bounded viewport's inverse transform.
  return parent && shared ? createPortal(<svg ref={shared.setTarget} data-canvas-shared-passive-edges style={{ zIndex: 0, pointerEvents: "none" }} />, parent) : null;
}

export function CanvasSharedPassiveEdge({ id, source, target, enabled, selected, children }: {
  id: string; source: string; target: string; enabled: boolean; selected?: boolean; children: React.ReactElement<React.SVGProps<SVGPathElement>>;
}) {
  const shared = React.useContext(SharedEdgeContext);
  if (!enabled || !shared?.target) return <>{children}</>;
  // Portal only the path: retain event ownership without adding one extra SVG
  // or wrapper per curve. Keyboard events still bubble to React Flow's owner.
  return createPortal(React.cloneElement(children, {
    "data-canvas-shared-passive-edge": true,
    "data-id": id,
    tabIndex: 0,
    role: "group",
    "aria-roledescription": "edge",
    "aria-label": `Edge from ${source} to ${target}`,
    "aria-selected": Boolean(selected),
    onKeyDown: event => { if (event.key === "Escape") event.currentTarget.blur(); },
  } as React.SVGProps<SVGPathElement>), shared.target);
}
