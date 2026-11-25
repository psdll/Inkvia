"use client";

import * as React from "react";

export type AutoPaginateSnapshot = {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
};

// 写进 state 的 scrollTop 量化步长：滚动期间同一桶内不触发父组件重渲染。
const SNAPSHOT_SCROLL_QUANT = 200;
// 追加分页失败时，先自动退避重试几次（瞬时抖动自愈），都失败再落到手动「重试加载」。
const AUTO_RETRY_MAX = 3;

type UseAutoPaginateOptions = {
  scrollRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  hasMore: boolean;
  currentPage: number;
  loadPage: (page: number) => Promise<boolean>;
  resetKey?: string;
  onScrollFrame?: (snapshot: AutoPaginateSnapshot) => void;
  preloadPx?: number;
  minScrollableScreens?: number;
};

export function useAutoPaginate({
  scrollRef,
  enabled,
  hasMore,
  currentPage,
  loadPage,
  resetKey,
  onScrollFrame,
  preloadPx = 1600,
  minScrollableScreens = 1.5,
}: UseAutoPaginateOptions) {
  const [snapshot, setSnapshot] = React.useState<AutoPaginateSnapshot>({
    scrollTop: 0,
    viewportHeight: 0,
    contentHeight: 0,
  });
  const [appendInFlight, setAppendInFlight] = React.useState(false);
  const [failedAppendPage, setFailedAppendPage] = React.useState<number | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const appendInFlightRef = React.useRef(false);
  const currentPageRef = React.useRef(currentPage);
  const loadPageRef = React.useRef(loadPage);
  const onScrollFrameRef = React.useRef(onScrollFrame);
  const autoRetryRef = React.useRef(0);
  const autoRetryTimerRef = React.useRef<number | null>(null);
  const appendPageRef = React.useRef<(page?: number) => Promise<boolean>>(() => Promise.resolve(false));
  const generationRef = React.useRef(0);
  const previousResetKeyRef = React.useRef(resetKey);

  React.useEffect(() => {
    if (previousResetKeyRef.current === resetKey) return;
    previousResetKeyRef.current = resetKey;
    generationRef.current += 1;
    if (autoRetryTimerRef.current != null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    autoRetryRef.current = 0;
    appendInFlightRef.current = false;
    setAppendInFlight(false);
    setFailedAppendPage(null);
  }, [resetKey]);

  React.useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  React.useEffect(() => {
    loadPageRef.current = loadPage;
  }, [loadPage]);

  React.useEffect(() => {
    onScrollFrameRef.current = onScrollFrame;
  }, [onScrollFrame]);

  const readSnapshot = React.useCallback((): AutoPaginateSnapshot | null => {
    const node = scrollRef.current;
    if (!node) return null;
    return {
      scrollTop: node.scrollTop,
      viewportHeight: node.clientHeight,
      contentHeight: node.scrollHeight,
    };
  }, [scrollRef]);

  const appendPage = React.useCallback(
    async (page?: number) => {
      if (!enabled || !hasMore || appendInFlightRef.current) return false;
      const generation = generationRef.current;
      const nextPage = page ?? failedAppendPage ?? currentPageRef.current + 1;
      appendInFlightRef.current = true;
      setAppendInFlight(true);
      try {
        const ok = await loadPageRef.current(nextPage);
        if (generation !== generationRef.current) return false;
        if (ok) {
          autoRetryRef.current = 0;
          setFailedAppendPage(null);
          return true;
        }
        // 失败先自动退避重试，期间不显示手动按钮（failedAppendPage 仍为 null）；
        // 重试用尽才标记 failedAppendPage → 显示手动「重试加载」。
        if (autoRetryRef.current < AUTO_RETRY_MAX) {
          autoRetryRef.current += 1;
          setFailedAppendPage(null);
          if (autoRetryTimerRef.current != null) window.clearTimeout(autoRetryTimerRef.current);
          autoRetryTimerRef.current = window.setTimeout(() => {
            if (generation !== generationRef.current) return;
            autoRetryTimerRef.current = null;
            void appendPageRef.current(nextPage);
          }, 800 * autoRetryRef.current);
        } else {
          setFailedAppendPage(nextPage);
        }
        return false;
      } finally {
        if (generation === generationRef.current) {
          appendInFlightRef.current = false;
          setAppendInFlight(false);
        }
      }
    },
    [enabled, failedAppendPage, hasMore]
  );

  React.useEffect(() => {
    appendPageRef.current = appendPage;
  }, [appendPage]);

  const maybeAppend = React.useCallback(
    (next: AutoPaginateSnapshot) => {
      if (!enabled || !hasMore || failedAppendPage != null || appendInFlightRef.current) return;
      const nearBottom = next.scrollTop + next.viewportHeight > next.contentHeight - preloadPx;
      const underfilled = next.contentHeight < next.viewportHeight * minScrollableScreens;
      if (nearBottom || underfilled) {
        void appendPage(currentPageRef.current + 1);
      }
    },
    [appendPage, enabled, failedAppendPage, hasMore, minScrollableScreens, preloadPx]
  );

  const commitSnapshot = React.useCallback(
    (next: AutoPaginateSnapshot) => {
      // onScrollFrame（顶栏折叠等需要细粒度）和触底检测每帧都用真实值，保持灵敏。
      onScrollFrameRef.current?.(next);
      maybeAppend(next);
      // 但写进 state 的 scrollTop 按 200px 量化：滚动期间多数帧落在同一桶里，snapshot
      // 不变 → 父组件不再每帧重渲染（之前 60fps 全树重渲染是滚动「吃力」的主因）。
      // 消费方（瀑布流可视窗口）只需粗粒度的 scrollTop，200px 远小于 overscan，不会漏卡。
      const quantTop = Math.floor(next.scrollTop / SNAPSHOT_SCROLL_QUANT) * SNAPSHOT_SCROLL_QUANT;
      setSnapshot((prev) =>
        prev.scrollTop === quantTop &&
        prev.viewportHeight === next.viewportHeight &&
        prev.contentHeight === next.contentHeight
          ? prev
          : { scrollTop: quantTop, viewportHeight: next.viewportHeight, contentHeight: next.contentHeight }
      );
    },
    [maybeAppend]
  );

  const handleScroll = React.useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const next = readSnapshot();
      if (next) commitSnapshot(next);
    });
  }, [commitSnapshot, readSnapshot]);

  React.useEffect(() => {
    const next = readSnapshot();
    if (next) commitSnapshot(next);
  }, [commitSnapshot, readSnapshot, enabled, hasMore, currentPage, snapshot.contentHeight]);

  React.useEffect(() => {
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      if (autoRetryTimerRef.current != null) window.clearTimeout(autoRetryTimerRef.current);
    };
  }, []);

  return {
    scrollTop: snapshot.scrollTop,
    viewportHeight: snapshot.viewportHeight,
    contentHeight: snapshot.contentHeight,
    appendInFlight,
    failedAppendPage,
    onScroll: handleScroll,
    retryAppend: () => {
      autoRetryRef.current = 0;
      return appendPage(failedAppendPage ?? currentPageRef.current + 1);
    },
  };
}
