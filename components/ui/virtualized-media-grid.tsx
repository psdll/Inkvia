"use client";

import * as React from "react";
import { VirtuosoGrid, type VirtuosoGridHandle } from "react-virtuoso";

const VIRTUALIZE_THRESHOLD = 200;

type GridContext = {
  footer?: React.ReactNode;
};

function GridFooter({ context }: { context?: GridContext }) {
  return context?.footer ? <>{context.footer}</> : null;
}

const GRID_COMPONENTS = { Footer: GridFooter };

export type VirtualizedMediaGridProps<T> = {
  items: T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => React.ReactNode;
  gridClassName: string;
  containerClassName?: string;
  disableVirtualization?: boolean;
  forceVirtualized?: boolean;
  handleRef?: React.Ref<VirtuosoGridHandle>;
  endReached?: (index: number) => void;
  footer?: React.ReactNode;
  increaseViewportBy?: number | { bottom: number; top: number };
};

export function VirtualizedMediaGrid<T>({
  items,
  getKey,
  renderItem,
  gridClassName,
  containerClassName,
  disableVirtualization,
  forceVirtualized,
  handleRef,
  endReached,
  footer,
  increaseViewportBy
}: VirtualizedMediaGridProps<T>) {
  const useVirtual = !disableVirtualization && (forceVirtualized || items.length >= VIRTUALIZE_THRESHOLD);

  if (!useVirtual) {
    return (
      <div className={containerClassName}>
        <div className={gridClassName}>
          {items.map((item, index) => (
            <React.Fragment key={getKey(item, index)}>{renderItem(item, index)}</React.Fragment>
          ))}
        </div>
        {footer}
      </div>
    );
  }

  return (
    <VirtuosoGrid
      ref={handleRef}
      data={items}
      overscan={400}
      className={containerClassName}
      listClassName={gridClassName}
      computeItemKey={(index, item) => getKey(item, index)}
      itemContent={(index, item) => renderItem(item, index)}
      endReached={endReached}
      increaseViewportBy={increaseViewportBy}
      context={{ footer }}
      components={footer ? GRID_COMPONENTS : undefined}
      style={{ height: "100%" }}
    />
  );
}

export { VIRTUALIZE_THRESHOLD };
