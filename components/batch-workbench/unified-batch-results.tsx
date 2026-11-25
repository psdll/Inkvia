"use client";
import { UiText, useUiLocale } from "@/i18n/ui";


import * as React from "react";
import { Image as ImageIcon, Layers3, Loader2, Video } from "lucide-react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ScrollToTopButton } from "@/components/ui/scroll-to-top-button";
import {
  mergeBatchResultEntries,
  useBatchResultRegistryState,
} from "@/components/batch-workbench/batch-result-registry";

const SHANGHAI_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatShanghaiDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    SHANGHAI_DATE_FORMATTER
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function UnifiedBatchResults() {
  const { text, locale, error } = useUiLocale();
  const { sources, scrollRevision } = useBatchResultRegistryState();
  const entries = React.useMemo(() => mergeBatchResultEntries(sources), [sources]);
  const virtuosoRef = React.useRef<VirtuosoHandle | null>(null);
  const scrollerRef = React.useRef<HTMLElement | null>(null);
  const scrollAnimationFrameRef = React.useRef<number | null>(null);
  const previousScrollRevisionRef = React.useRef(scrollRevision);
  const loadingMore = sources.some((source) => source.loadingMore);
  const hasMore = sources.some((source) => source.hasMore);
  const initialLoading = sources.some((source) => source.initialLoading);
  const initialError = sources.find((source) => source.initialError)?.initialError;

  const scrollToStart = React.useCallback(() => {
    if (!entries.length) return;

    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
      scrollAnimationFrameRef.current = null;
    }

    const alignFirstItem = () => {
      virtuosoRef.current?.scrollToIndex({
        index: 0, align: "start", behavior: "auto",
      });
    };
    const scroller = scrollerRef.current;
    if (
      !scroller
      || scroller.scrollTop <= 0
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      alignFirstItem();
      return;
    }

    const startScrollTop = scroller.scrollTop;
    const duration = Math.min(900, Math.max(360, Math.sqrt(startScrollTop) * 8));
    const startTime = window.performance.now();
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const easedProgress = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - ((-2 * progress + 2) ** 3) / 2;
      const nextScrollTop = Math.max(0, Math.round(startScrollTop * (1 - easedProgress)));
      scroller.scrollTo({ top: nextScrollTop, behavior: "auto" });
      if (progress < 1) {
        scrollAnimationFrameRef.current = window.requestAnimationFrame(animate);
        return;
      }
      scrollAnimationFrameRef.current = null;
      alignFirstItem();
    };
    scrollAnimationFrameRef.current = window.requestAnimationFrame(animate);
  }, [entries.length]);

  React.useEffect(() => () => {
    if (scrollAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
  }, []);

  React.useEffect(() => {
    if (previousScrollRevisionRef.current === scrollRevision) return;
    previousScrollRevisionRef.current = scrollRevision;
    window.requestAnimationFrame(scrollToStart);
  }, [scrollRevision, scrollToStart]);

  const loadMore = React.useCallback(() => {
    sources.forEach((source) => {
      if (source.hasMore && !source.loadingMore) source.loadMore();
    });
  }, [sources]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col p-4" data-batch-unified-results="true">
      {initialLoading || initialError ? (
        <p role="status" className="shrink-0 pb-4 text-xs text-[var(--app-muted)]">
          {initialLoading ? <UiText id="batch.m22f02437089f" /> : error(initialError)}
        </p>
      ) : null}
      {entries.length ? (
        <Virtuoso
          ref={virtuosoRef}
          data={entries}
          computeItemKey={(_index, entry) => entry.key}
          scrollerRef={(element) => {
            scrollerRef.current = element instanceof HTMLElement ? element : null;
          }}
          className="min-h-0 min-w-0 flex-1"
          increaseViewportBy={{ top: 480, bottom: 760 }}
          endReached={loadMore}
          itemContent={(index, entry) => {
            const dateLabel = formatShanghaiDate(entry.createdAt);
            const previousDate = index > 0
              ? formatShanghaiDate(entries[index - 1]?.createdAt || "")
              : "";
            const showDateDivider = Boolean(dateLabel && dateLabel !== previousDate);
            const displayDate = dateLabel && locale === "en"
              ? new Date(entry.createdAt).toLocaleDateString("en-US", { timeZone: "Asia/Shanghai", dateStyle: "medium" })
              : dateLabel;
            return (
              <section
                data-batch-result-mode={entry.mode}
                data-batch-result-kind={entry.mediaKind}
                className="border-b border-[var(--border)] pb-6 pt-6 first:pt-0 last:border-b-0"
              >
                {showDateDivider ? (
                  <div className="mb-4 flex items-center gap-3 px-1" aria-label={text("workspaceFollowup.mc3c2d0191422", { v0: displayDate })}>
                    <h2 className="shrink-0 text-sm font-semibold text-[var(--app-fg)]">{displayDate}</h2>
                    <span className="h-px min-w-0 flex-1 bg-[var(--border)]" aria-hidden="true" />
                  </div>
                ) : null}
                <div className="mb-3 flex items-center gap-2 px-1">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 text-[11px] text-[var(--app-muted)]">
                    {entry.mediaKind === "video"
                      ? <Video className="h-3.5 w-3.5" aria-hidden="true" />
                      : <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />}
                    {entry.mediaKind === "video" ? <UiText id="batch.mc20f7618d330" /> : <UiText id="batch.md24c10d37db0" />}
                  </span>
                  {entry.pinned ? (
                    <span className="text-[11px] text-[var(--app-muted)]"><UiText id="batch.m66bc937eea47" /></span>
                  ) : null}
                </div>
                {entry.content}
              </section>
            );
          }}
          components={{
            Footer: () => {
              if (loadingMore) {
                return (
                  <div className="flex h-12 items-center justify-center gap-2 text-xs text-[var(--app-muted)]">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /><UiText id="batch.m940d702e1839" /></div>
                );
              }
              if (!hasMore) {
                return (
                  <div className="flex h-14 items-center justify-center text-xs text-[var(--app-muted)]"><UiText id="batch.mb260c7cec88e" /></div>
                );
              }
              return null;
            },
          }}
        />
      ) : !initialLoading && !initialError ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[color-mix(in_srgb,var(--primary-bg)_14%,transparent)] text-[var(--primary-bg)]">
            <Layers3 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-sm font-semibold text-[var(--app-fg)]"><UiText id="batch.m57f7754770d3" /></h3>
          <p className="mt-2 max-w-sm text-xs leading-5 text-[var(--app-muted)]"><UiText id="batch.m42c53766497b" /></p>
        </div>
      ) : null}
      {entries.length ? (
        <ScrollToTopButton
          scrollContainerRef={scrollerRef}
          onScrollToTop={scrollToStart}
        />
      ) : null}
    </div>
  );
}
