"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 全局 TanStack Query 客户端。
//
// 默认策略:
//   - staleTime: 30s  → 30 秒内不重发同一 query (切 tab 直接命中缓存)
//   - gcTime: 5min    → 离开后 5 分钟回来还能用旧数据 (instant UX)
//   - refetchOnWindowFocus: false → admin 不需要切回窗口就重拉
//   - retry: 1 → 失败重试一次,避免短抖动
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // 服务端每次新建,避免请求间共享缓存
    return makeQueryClient();
  }
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

export function AppQueryClientProvider({ children }: { children: React.ReactNode }) {
  const client = getQueryClient();
  React.useEffect(() => {
    const clearSettings = () => {
      void client.cancelQueries({ queryKey: ["settings"] });
      client.removeQueries({ queryKey: ["settings"] });
    };
    window.addEventListener("auth:logout", clearSettings);
    return () => window.removeEventListener("auth:logout", clearSettings);
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
