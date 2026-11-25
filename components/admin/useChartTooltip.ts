"use client";

import * as React from "react";

/** Update the moving target at frame rate; CSS easing lets the overlay catch up. */
export function useChartTooltip() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const bounds = React.useRef<DOMRect | null>(null);
  const size = React.useRef({ width: 0, height: 0 });
  const position = React.useRef({ x: 0, y: 0 });
  const frame = React.useRef<number | null>(null);

  const paint = React.useCallback(() => {
    frame.current = null;
    const container = containerRef.current;
    const tooltip = tooltipRef.current;
    if (!container || !tooltip) return;
    const rect =
      bounds.current ?? (bounds.current = container.getBoundingClientRect());
    const { x, y } = position.current;
    const { width, height } = size.current;
    const gap = 10;
    const maxX = Math.max(0, rect.width - width);
    // Small sparklines can show the overlay above their plot, inside the viewport.
    const minY = height > rect.height ? Math.min(0, gap - rect.top) : 0;
    const maxY =
      height > rect.height
        ? window.innerHeight - rect.top - height - gap
        : rect.height - height;
    const left = x + gap + width <= rect.width ? x + gap : x - width - gap;
    const top = y + gap <= maxY ? y + gap : y - height - gap;
    tooltip.style.transform = `translate3d(${Math.max(0, Math.min(left, maxX))}px, ${Math.max(minY, Math.min(top, maxY))}px, 0)`;
  }, []);

  const schedule = React.useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(paint);
  }, [paint]);
  const move = React.useCallback(
    (event: { clientX: number; clientY: number }) => {
      const container = containerRef.current;
      if (!container) return;
      const rect =
        bounds.current ?? (bounds.current = container.getBoundingClientRect());
      position.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      schedule();
    },
    [schedule],
  );
  const place = React.useCallback(
    (fraction: number, top = 8) => {
      const container = containerRef.current;
      if (!container) return;
      const rect =
        bounds.current ?? (bounds.current = container.getBoundingClientRect());
      position.current = { x: fraction * rect.width, y: top };
      schedule();
    },
    [schedule],
  );
  const reset = React.useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    bounds.current = null;
  }, []);

  React.useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    size.current = { width: tooltip.offsetWidth, height: tooltip.offsetHeight };
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    paint();
  });
  React.useEffect(() => {
    const invalidate = () => {
      bounds.current = null;
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(invalidate);
    if (containerRef.current) observer?.observe(containerRef.current);
    window.addEventListener("resize", invalidate);
    window.addEventListener("scroll", invalidate, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", invalidate);
      window.removeEventListener("scroll", invalidate, true);
      reset();
    };
  });

  return { containerRef, tooltipRef, move, place, reset };
}
