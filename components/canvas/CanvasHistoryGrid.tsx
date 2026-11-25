"use client";

import * as React from "react";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import { buildCanvasHistoryRows, type CanvasHistoryAsset } from "@/lib/assets/canvas-history";

export type HistoryScrollPosition = { id?: number; offset: number; top: number };
export type HistoryGridHandle = { scrollToTop: () => void };
type Props = {
  items: CanvasHistoryAsset[];
  tileSize: number;
  viewKey: string;
  positions: Map<string, HistoryScrollPosition>;
  onLoadMore?: () => void;
  children: (item: CanvasHistoryAsset) => React.ReactNode;
  footer: React.ReactNode;
  renderDate?: (date: string, ids: number[]) => React.ReactNode;
};
const gap = 12, headingHeight = 44, footerHeight = 72, overscan = 480;

// Tiles share one parent and keep their asset IDs as keys, even when resizing
// changes their rows. Row-based virtualizers remount images that move rows.
export const CanvasHistoryGrid = React.forwardRef<HistoryGridHandle, Props>(function CanvasHistoryGrid(
  { items, tileSize, viewKey, positions, onLoadMore, children, footer, renderDate }, ref
) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = React.useState(0);
  const columns = Math.max(1, Math.floor((viewport.width + gap) / (tileSize + gap)));
  const grouped = React.useMemo(() => {
    const rows = buildCanvasHistoryRows(items, columns);
    const rowById = new Map<number, number>();
    rows.forEach((row, index) => row.items.forEach(item => rowById.set(item.id, index)));
    const dateIds = new Map<string, number[]>();
    let date = "";
    for (const row of rows) {
      if (row.date) date = row.date;
      if (!dateIds.has(date)) dateIds.set(date, []);
      for (const item of row.items) dateIds.get(date)!.push(item.id);
    }
    return { rows, rowById, dateIds };
  }, [items, columns]);
  const layout = React.useMemo(() => {
    const size = Math.max(1, (viewport.width - gap * (columns - 1)) / columns);
    let height = 0;
    const rows = grouped.rows.map(row => {
      const top = height;
      const imageTop = top + (row.date ? headingHeight : 0);
      height = imageTop + size + gap;
      return { ...row, top, imageTop, bottom: height };
    });
    return { rows, rowById: grouped.rowById, size, height };
  }, [grouped, columns, viewport.width]);

  const committed = React.useRef<{ layout: typeof layout; viewKey: string; height: number } | null>(null);
  const geometryChanged = committed.current?.layout !== layout || committed.current?.viewKey !== viewKey || committed.current?.height !== viewport.height;
  const saved = positions.get(viewKey);
  const savedRow = saved?.id === undefined ? undefined : layout.rows[layout.rowById.get(saved.id) ?? -1];
  const maxTop = Math.max(0, layout.height + footerHeight - viewport.height);
  const top = Math.min(maxTop, Math.max(0, geometryChanged ? savedRow ? savedRow.top + saved!.offset : saved?.top ?? 0 : scrollTop));

  const firstRowAt = (offset: number) => {
    let low = 0, high = layout.rows.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (layout.rows[middle].bottom <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.min(low, Math.max(0, layout.rows.length - 1));
  };
  const remember = (value: number) => {
    const row = layout.rows[firstRowAt(value)];
    positions.set(viewKey, { id: row?.items[0]?.id, offset: value - (row?.top ?? 0), top: value });
    if (positions.size > 24) positions.delete(positions.keys().next().value!);
  };

  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setViewport(previous => {
      const width = element.clientWidth, height = element.clientHeight;
      return previous.width === width && previous.height === height ? previous : { width, height };
    });
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    if (!viewport.width || !viewport.height) return;
    // Set the new range and scroll offset before paint, without removing the
    // scroller or inserting a loading frame between the two layouts.
    committed.current = { layout, viewKey, height: viewport.height };
    if (scroller.current) scroller.current.scrollTop = top;
    setScrollTop(top); remember(top);
  }, [layout, viewKey, viewport.height, top]);

  React.useImperativeHandle(ref, () => ({ scrollToTop: () => {
    if (scroller.current) scroller.current.scrollTop = 0;
    remember(0); setScrollTop(0);
  } }));

  React.useEffect(() => {
    if (viewport.height && layout.height - top - viewport.height < overscan) onLoadMore?.();
  }, [layout.height, top, viewport.height, onLoadMore]);

  const visibleRows = layout.rows.slice(firstRowAt(Math.max(0, top - overscan)), firstRowAt(top + viewport.height + overscan) + 1);
  return <><div ref={scroller} className="history-grid-scroll" onScroll={event => {
    const value = event.currentTarget.scrollTop;
    remember(value); setScrollTop(value);
  }}>
    <div className="history-grid-space" style={{ height: layout.height + footerHeight }}>
      {viewport.width > 0 && visibleRows.flatMap(row => [
        ...(row.date ? [<h3 key={`date:${row.date}`} className="history-grid-date" style={{ top: row.top }}>{renderDate ? renderDate(row.date, grouped.dateIds.get(row.date) || []) : row.date}</h3>] : []),
        ...row.items.map((item, column) => <div key={item.id} className="history-grid-cell" style={{ top: row.imageTop, left: column * (layout.size + gap), width: layout.size, height: layout.size }}>{children(item)}</div>),
      ])}
      <div className="history-grid-end" style={{ top: layout.height }}>{footer}</div>
    </div>
  </div><ScrollToTopButton scrollContainerRef={scroller} position="absolute" onScrollToTop={() => {
    if (scroller.current) {
      scroller.current.scrollTop = 0;
      scroller.current.dispatchEvent(new Event("scroll"));
    }
    remember(0); setScrollTop(0);
  }} /></>;
});
