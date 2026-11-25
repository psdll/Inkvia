"use client";
import { UiText } from "@/i18n/ui";


import React, { useState, useRef, useCallback } from "react";

interface Category {
  key: string;
  label: string;
  beforeGradient: string;
  afterGradient: string;
  description: string;
}

const CATEGORIES: Category[] = [
  { key: "product", label: "产品", beforeGradient: "from-amber-700 via-orange-800 to-yellow-900", afterGradient: "from-amber-500 via-orange-400 to-yellow-300", description: "产品图片背景移除" },
  { key: "person", label: "人像", beforeGradient: "from-slate-700 via-gray-800 to-zinc-900", afterGradient: "from-pink-400 via-rose-300 to-fuchsia-300", description: "人像智能美化" },
  { key: "scene", label: "场景", beforeGradient: "from-emerald-800 via-green-900 to-teal-900", afterGradient: "from-emerald-400 via-teal-300 to-cyan-300", description: "场景风格迁移" },
  { key: "art", label: "艺术", beforeGradient: "from-indigo-800 via-purple-900 to-violet-900", afterGradient: "from-indigo-400 via-purple-400 to-violet-300", description: "AI 艺术风格化" },
];

export function BeforeAfterSection() {
  const [activeCategory, setActiveCategory] = useState(0);
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current || !isDragging.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(5, Math.min(95, (x / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  const handleMouseDown = useCallback(() => { isDragging.current = true; }, []);
  const handleMouseUp = useCallback(() => { isDragging.current = false; }, []);
  const handleMouseMove = useCallback((e: React.MouseEvent) => handleMove(e.clientX), [handleMove]);
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) handleMove(e.touches[0].clientX);
  }, [handleMove]);

  const cat = CATEGORIES[activeCategory];

  return (
    <section className="py-20 md:py-28">
      <div className="max-w-6xl mx-auto">
        {/* 标题 */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-bold text-[var(--app-fg)] dark:text-white mb-4"><UiText id="home.mb819a2a72366" /><span className="text-yellow-500 dark:text-yellow-400"><UiText id="home.ma47d53bff05a" /></span>
          </h2>
          <p className="text-base md:text-lg text-[var(--app-muted)] dark:text-white/40 max-w-xl mx-auto"><UiText id="home.m2ccb05594034" /></p>
        </div>

        {/* 分类标签 */}
        <div className="flex flex-wrap justify-center gap-3 mb-10">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.key}
              onClick={() => { setActiveCategory(i); setSliderPos(50); }}
              className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                i === activeCategory
                  ? "cta-button-yellow shadow-lg"
                  : "bg-[var(--panel-bg)] border border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] dark:bg-white/[0.06] dark:border-white/10 dark:text-white/70 dark:hover:bg-white/[0.1] dark:hover:text-white"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Before/After 对比区域 */}
        <div className="max-w-4xl mx-auto">
          <div
            ref={containerRef}
            className="relative w-full aspect-[16/10] rounded-2xl overflow-hidden border border-[var(--border)] shadow-[var(--shadow)] cursor-ew-resize select-none dark:border-white/10 dark:shadow-[0_20px_80px_rgba(0,0,0,0.5)]"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onMouseMove={handleMouseMove}
            onTouchStart={handleMouseDown}
            onTouchEnd={handleMouseUp}
            onTouchMove={handleTouchMove}
          >
            {/* After 层 (底层 - 全部显示) */}
            <div className={`absolute inset-0 bg-gradient-to-br ${cat.afterGradient}`}>
              {/* 棋盘格表示透明 */}
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage: "linear-gradient(45deg, rgba(255,255,255,0.15) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.15) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.15) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.15) 75%)",
                backgroundSize: "20px 20px",
                backgroundPosition: "0 0, 0 10px, 10px -10px, -10px 0px"
              }} />
              <div className="absolute bottom-6 right-6 px-3 py-1.5 rounded-lg bg-white/20 backdrop-blur-md text-sm text-white font-medium"><UiText id="home.m28bec23b1322" /></div>
              {/* 装饰性图形元素 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full border-2 border-white/20" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full border border-white/10" />
            </div>

            {/* Before 层 (上层 - 通过clip裁剪) */}
            <div
              className={`absolute inset-0 bg-gradient-to-br ${cat.beforeGradient}`}
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMjAiIGN5PSIyMCIgcj0iMiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvc3ZnPg==')] opacity-60" />
              <div className="absolute bottom-6 left-6 px-3 py-1.5 rounded-lg bg-black/30 backdrop-blur-md text-sm text-white font-medium"><UiText id="home.m72cb5a3d00c6" /></div>
              {/* 装饰性图形元素 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full border-2 border-white/10" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 h-56 rounded-full border border-white/5" />
            </div>

            {/* 滑块分割线 */}
            <div
              className="absolute top-0 bottom-0 w-[3px] bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)] z-10 transition-none"
              style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
            >
              {/* 滑块手柄 */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white shadow-[0_4px_20px_rgba(0,0,0,0.5)] flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-gray-700">
                  <path d="M5 3L2 8L5 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M11 3L14 8L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
          </div>

          {/* 说明文字 */}
          <p className="text-center text-[var(--app-muted)] dark:text-white/30 text-sm mt-4"><UiText id="home.mbdad637a707f" />{cat.description}<UiText id="home.me2c35204b294" /></p>
        </div>
      </div>
    </section>
  );
}
