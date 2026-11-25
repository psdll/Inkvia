"use client";

import * as React from "react";

// 全站只在这里注册一次 media-cache-sw.js。
// 旧版散落在 inspiration-discovery / media-library-panel / UserWorksPanel 三处的注册已删除。
// 这样保证：员工无论从哪个页面进入，SW 都能正常激活并对所有页面的图片请求生效。
export function ServiceWorkerRegistration() {
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // 仅在安全上下文（https / localhost / 127.0.0.1）注册——SW 在 http 公网下被浏览器拒绝
    const isSecure =
      window.location.protocol === "https:" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isSecure) return;
    void navigator.serviceWorker.register("/media-cache-sw.js").catch(() => undefined);
  }, []);

  return null;
}
