"use client";

import * as React from "react";
import styles from "./agent-mark.module.css";

const STROKE = "M21 30V40Q21 50 31 50H43";

/**
 * Agent 标识：logo 轮廓始终完整可见，动效只在轮廓上流动——
 * 空闲时每隔几秒掠过一道高光，运行时一段亮色连续流动并带拖尾，完成时圆点轻弹一次。
 */
export default function AgentMark({ state, size = 18 }: {
  state: "idle" | "thinking" | "done";
  size?: number;
}) {
  const gradientId = React.useId();
  const paint = `url(#${gradientId})`;
  return (
    // viewBox 裁到 logo 实际范围，小尺寸下不再显得空
    <svg width={size} height={size} viewBox="7 8 48 48" fill="none" aria-hidden="true" className={styles.mark} data-state={state}>
      <defs>
        <linearGradient id={gradientId} x1="14" y1="10" x2="48" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2EE6A8" />
          <stop offset="1" stopColor="#8A7BFF" />
        </linearGradient>
      </defs>
      <path className={styles.base} d={STROKE} stroke={paint} strokeWidth="9" strokeLinecap="round" />
      <path className={styles.trail} d={STROKE} stroke={paint} strokeWidth="9" strokeLinecap="round" pathLength="100" />
      <path className={styles.flow} d={STROKE} stroke={paint} strokeWidth="9" strokeLinecap="round" pathLength="100" />
      <path className={styles.glint} d={STROKE} stroke="#fff" strokeWidth="3.5" strokeLinecap="round" pathLength="100" />
      <circle className={styles.drop} cx="21" cy="16" r="6.5" fill={paint} />
    </svg>
  );
}
