"use client";

import * as React from "react";

// 只保存页面位置，不保存配置草稿、密钥或弹窗状态；各浏览器标签页独立。
export function useAdminPageSelection<T extends string>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(initial);
  React.useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`admin-page:${key}`);
      if (saved !== null) setValue(saved as T);
    } catch {}
  }, [key]);
  const select = React.useCallback((next: T) => {
    setValue(next);
    try { sessionStorage.setItem(`admin-page:${key}`, next); } catch {}
  }, [key]);
  return [value, select] as const;
}
