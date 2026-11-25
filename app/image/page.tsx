// 路由入口。实际 UI 在 image-tool.tsx —— 该组件还被 /studio 以带 props 方式复用，
// 而 page.tsx 只能导出 default + 框架配置项，故组件单独放普通模块。
"use client";

import * as React from "react";
import ImageTool from "./image-tool";
import { AtomicPageReveal } from "@/components/layout/atomic-page-reveal";

export default function ImagePage() {
  const [ready, setReady] = React.useState(false);
  return <AtomicPageReveal ready={ready}><ImageTool onInitialReady={() => setReady(true)} /></AtomicPageReveal>;
}
