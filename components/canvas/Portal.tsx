"use client";

import * as React from "react";
import { createPortal } from "react-dom";

// 把弹窗渲染到 document.body：React Flow 画布视口用了 CSS transform，
// 在 transform 祖先内 position:fixed 会相对该容器定位（被缩放/平移/裁剪）。
// 通过 Portal 跳出 transform 上下文，弹窗才能正常全屏覆盖。
export default function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
