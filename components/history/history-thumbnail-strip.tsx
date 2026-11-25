"use client";

import * as React from "react";
import { Virtuoso, type ItemProps, type VirtuosoHandle } from "react-virtuoso";

export const HISTORY_VIRTUALIZE_THRESHOLD = 40;

export type HistoryThumbnailStripHandle = {
  scrollToIndex(index: number): void;
};

export type HistoryThumbnailStripProps<T> = {
  items: T[];
  getKey: (item: T, index: number) => React.Key;
  renderItem: (item: T, index: number) => React.ReactNode;
  hasMore?: boolean;
  onEndReached?: () => void;
  onScrollerRef?: (element: HTMLElement | null) => void;
  virtualizeThreshold?: number;
};

function CenteredVirtuosoItem<T>({ item: _item, style, ...props }: ItemProps<T>) {
  return (
    <div
      {...props}
      style={{ ...style, display: "inline-flex", alignItems: "center", height: "100%", verticalAlign: "top" }}
    />
  );
}

function HistoryThumbnailStripInner<T>(
  {
    items,
    getKey,
    renderItem,
    hasMore = false,
    onEndReached,
    onScrollerRef,
    virtualizeThreshold,
  }: HistoryThumbnailStripProps<T>,
  ref: React.ForwardedRef<HistoryThumbnailStripHandle>,
) {
  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);
  const directScrollerRef = React.useRef<HTMLDivElement | null>(null);
  const resolvedVirtualizeThreshold = virtualizeThreshold ?? HISTORY_VIRTUALIZE_THRESHOLD;
  const directMode = !hasMore && items.length <= resolvedVirtualizeThreshold;

  React.useImperativeHandle(ref, () => ({
    scrollToIndex(index: number) {
      if (index < 0 || index >= items.length) return;
      if (!directMode) {
        virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "auto" });
        return;
      }
      const scroller = directScrollerRef.current;
      const element = scroller?.querySelector<HTMLElement>(`[data-history-index="${index}"]`);
      if (!scroller || !element) return;
      const scrollerRect = scroller.getBoundingClientRect();
      const itemRect = element.getBoundingClientRect();
      if (itemRect.left < scrollerRect.left) {
        scroller.scrollLeft -= scrollerRect.left - itemRect.left;
      } else if (itemRect.right > scrollerRect.right) {
        scroller.scrollLeft += itemRect.right - scrollerRect.right;
      }
    },
  }), [directMode, items.length]);

  if (directMode) {
    return (
      <div
        ref={(element) => {
          directScrollerRef.current = element;
          onScrollerRef?.(element);
        }}
        className="no-scrollbar flex h-[78px] box-border items-center gap-2.5 overflow-x-auto overflow-y-hidden"
        onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollWidth - element.scrollLeft - element.clientWidth <= 160) onEndReached?.();
        }}
      >
        {items.map((item, index) => (
          <div key={getKey(item, index)} data-history-index={index} className="shrink-0">
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <Virtuoso
      ref={virtuosoRef}
      className="no-scrollbar"
      data={items}
      horizontalDirection
      computeItemKey={(index, item) => getKey(item, index)}
      components={{ Item: CenteredVirtuosoItem }}
      itemContent={(index, item) => <div className="pr-2.5">{renderItem(item, index)}</div>}
      endReached={() => onEndReached?.()}
      increaseViewportBy={{ top: 160, bottom: 320 }}
      minOverscanItemCount={{ top: 3, bottom: 6 }}
      scrollerRef={(element) => onScrollerRef?.(element instanceof HTMLElement ? element : null)}
      style={{ boxSizing: "border-box", height: 78, overflowY: "hidden" }}
    />
  );
}

export const HistoryThumbnailStrip = React.forwardRef(HistoryThumbnailStripInner) as <T>(
  props: HistoryThumbnailStripProps<T> & React.RefAttributes<HistoryThumbnailStripHandle>,
) => React.ReactElement;
