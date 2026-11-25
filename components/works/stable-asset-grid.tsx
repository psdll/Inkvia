"use client";

import * as React from "react";

type Row<T> = { groupKey: string; groupCount: number; key: string; groupLabel: string | null; firstGroup: boolean; items: T[] };

// Keep tiles under one parent so changing columns never remounts visible media.
export function StableAssetGrid<T extends { id: number }>({ rows, columns, scrollParent, renderHeading, renderItem, footer, onRangeChanged }: {
  rows: Row<T>[];
  columns: number;
  scrollParent: HTMLElement;
  renderHeading: (row: Row<T>) => React.ReactNode;
  renderItem: (item: T, rowIndex: number) => React.ReactNode;
  footer: React.ReactNode;
  onRangeChanged: (range: { startIndex: number; endIndex: number }) => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = React.useState({ width: 0, height: 900, top: 0 });
  React.useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const offset = element.getBoundingClientRect().top - scrollParent.getBoundingClientRect().top + scrollParent.scrollTop;
      const next = { width: element.clientWidth, height: scrollParent.clientHeight, top: Math.max(0, scrollParent.scrollTop - offset) };
      setGeometry(previous => previous.width === next.width && previous.height === next.height && previous.top === next.top ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); observer.observe(scrollParent);
    scrollParent.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => { observer.disconnect(); scrollParent.removeEventListener("scroll", measure); };
  }, [scrollParent]);
  const layout = React.useMemo(() => {
    const size = Math.max(1, (geometry.width - (columns - 1) * 10) / columns);
    let height = 0;
    const positioned = rows.map((row, index) => {
      const headingTop = height + (row.groupLabel && !row.firstGroup ? 32 : 0);
      const top = row.groupLabel ? headingTop + 32 : height;
      height = top + size + 10;
      return { row, index, headingTop, top, bottom: height };
    });
    return { positioned, size, height };
  }, [rows, columns, geometry.width]);
  const visible = layout.positioned.filter(row => row.bottom >= geometry.top - 480 && row.headingTop <= geometry.top + geometry.height + 960);
  const first = visible[0]?.index ?? 0;
  const last = visible[visible.length - 1]?.index ?? 0;
  React.useEffect(() => { onRangeChanged({ startIndex: first, endIndex: last }); }, [first, last, onRangeChanged]);
  return <div ref={container} className="relative" style={{ height: layout.height + 72 }}>
    {geometry.width > 0 && visible.flatMap(({ row, index, headingTop, top }) => [
      ...(row.groupLabel ? [<div key={`heading:${row.key}`} className="absolute left-0 right-0" style={{ top: headingTop }}>{renderHeading(row)}</div>] : []),
      ...row.items.map((item, column) => <div key={`asset:${item.id}`} className="absolute" style={{ top, left: column * (layout.size + 10), width: layout.size, height: layout.size }}>{renderItem(item, index)}</div>),
    ])}
    <div className="absolute left-0 right-0" style={{ top: layout.height }}>{footer}</div>
  </div>;
}
