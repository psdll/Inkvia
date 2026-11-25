"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildMediaPreviewCandidates, buildMediaProxyUrl } from "@/lib/media-url";
import { isMediaLibraryCapablePath } from "@/lib/media-library-events";
import { scheduleIdleBatches } from "@/lib/browser/idle-batches";

/**
 * 产品库图片保活层（隐形）。
 *
 * 目的：产品库面板在工具页内渲染，跨路由会卸载重建；重建时若图片要重新走代理/OSS，
 * 就会"重新加载、很慢"。本组件挂在 app-shell（布局层），永不随路由卸载，后台用隐藏
 * <img> 把产品**缩略图**焊在浏览器资源缓存里。面板重建时请求同一组 URL → 命中浏览器
 * 内存缓存，不再发网络请求 → 秒出。
 *
 * 内存安全：只保活缩略图（与面板网格显示同一档：360px），且 <img> 渲染为 1px，只占
 * 缓存字节（每张几十 KB），不强制全尺寸解码。
 */

type KeeperItem = {
  id: number;
  fileUrl: string;
  thumbnailUrl: string | null;
};

// 与 media-library-panel 的 pickPreviewCandidates(image) 首选项保持一致
function primaryThumbUrl(item: KeeperItem): string {
  const previews = buildMediaPreviewCandidates(item.fileUrl || item.thumbnailUrl || "", {
    width: 360,
    height: 360,
    mode: "cover",
  });
  const first = item.thumbnailUrl || previews[0] || "";
  return buildMediaProxyUrl(first) || first;
}

export function ProductCacheKeeper() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [activated, setActivated] = React.useState(false);
  const [urls, setUrls] = React.useState<string[]>([]);
  const [warmedCount, setWarmedCount] = React.useState(0);
  const fetchedRef = React.useRef(false);

  // 首次进工具页 + 已登录才激活；激活后保持
  React.useEffect(() => {
    if (isMediaLibraryCapablePath(pathname) && user && !activated) setActivated(true);
  }, [pathname, user, activated]);

  // 只拉一次共享产品列表，算出缩略图 URL
  React.useEffect(() => {
    if (!activated || !user || fetchedRef.current) return;
    fetchedRef.current = true;
    const controller = new AbortController();
    fetch(`/api/media-library?scope=shared&kind=image&pageSize=96`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("加载失败"))))
      .then((json) => {
        const items: KeeperItem[] = Array.isArray(json?.items) ? json.items : [];
        const nextUrls = Array.from(new Set(items.map(primaryThumbUrl).filter(Boolean)));
        setWarmedCount(0);
        setUrls(nextUrls);
      })
      .catch(() => {
        fetchedRef.current = false; // 允许下次重试
      });
    return () => controller.abort();
  }, [activated, user]);

  React.useEffect(() => {
    if (!urls.length) return;
    let warmed = 0;
    let cancelWarming: (() => void) | null = null;

    const start = () => {
      if (cancelWarming || warmed >= urls.length) return;
      const base = warmed;
      cancelWarming = scheduleIdleBatches(urls.length - base, (count) => {
        warmed = Math.min(urls.length, base + count);
        setWarmedCount(warmed);
        if (warmed >= urls.length) cancelWarming = null;
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        cancelWarming?.();
        cancelWarming = null;
        return;
      }
      start();
    };

    setWarmedCount(0);
    if (document.visibilityState !== "hidden") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelWarming?.();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [urls]);

  if (!activated || urls.length === 0) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: -9999,
        top: 0,
        width: 1,
        height: 1,
        overflow: "hidden",
        opacity: 0,
        pointerEvents: "none",
      }}
    >
      {urls.slice(0, warmedCount).map((url) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={url} src={url} alt="" width={1} height={1} loading="eager" decoding="async" fetchPriority="low" />
      ))}
    </div>
  );
}
