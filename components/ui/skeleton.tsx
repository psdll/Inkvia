"use client";

import * as React from "react";

// 通用骨架占位组件。比 spinner 更接近真实布局,
// 在 stale-while-revalidate 等待数据时让用户"感觉"页面已经在渲染。

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`animate-pulse rounded bg-[var(--app-muted)]/15 ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({
  lines = 3,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? "w-1/2" : "w-full"}`}
        />
      ))}
    </div>
  );
}

// admin 概览页/数据分析页的"卡片骨架",4 列网格。
export function CardGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)]/40 p-4"
        >
          <Skeleton className="h-3 w-1/2 mb-3" />
          <Skeleton className="h-6 w-2/3 mb-2" />
          <Skeleton className="h-2 w-1/3" />
        </div>
      ))}
    </div>
  );
}

// 列表行骨架(财务、反馈、资产列表通用)。
export function RowsSkeleton({ rows = 5, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]/40 px-4 py-3 flex items-center gap-3"
        >
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-2 w-1/3" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
