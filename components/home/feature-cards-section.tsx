"use client";
import { UiText } from "@/i18n/ui";


import React, { useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Wand2, Video, Palette, Layers, ChevronLeft, ChevronRight } from "lucide-react";

interface FeatureCard {
  title: string;
  description: string;
  icon: React.ReactNode;
  gradient: string;
  href: string;
  tag?: string;
}

const FEATURES: FeatureCard[] = [
  {
    title: "AI 图像编辑",
    description: "基于文本描述智能编辑图片内容，修改背景、添加元素、调整风格。",
    icon: <ImagePlus className="w-6 h-6" />,
    gradient: "from-blue-500 to-cyan-600",
    href: "/studio?tool=image",
    tag: "新功能",
  },
  {
    title: "AI 视频生成",
    description: "将静态图片转换为动态视频，支持多种运动模式和风格效果。",
    icon: <Video className="w-6 h-6" />,
    gradient: "from-violet-500 to-purple-600",
    href: "/studio?tool=video",
  },
  {
    title: "风格迁移",
    description: "将照片转换为各种艺术风格，油画、水彩、动漫等多种风格任选。",
    icon: <Palette className="w-6 h-6" />,
    gradient: "from-amber-500 to-orange-600",
    href: "/studio",
  },
  {
    title: "智能抠图",
    description: "精准识别主体轮廓，一键移除背景，支持复杂场景和细节保留。",
    icon: <Wand2 className="w-6 h-6" />,
    gradient: "from-emerald-500 to-teal-600",
    href: "/studio",
  },
  {
    title: "批量处理",
    description: "支持多张图片同时处理，提高工作效率，适合商业批量需求。",
    icon: <Layers className="w-6 h-6" />,
    gradient: "from-red-500 to-pink-600",
    href: "/studio",
  },
];

const TAB_ITEMS = [
  { key: "popular", label: "人气 AI 工具" },
  { key: "image", label: "AI 图像编辑" },
  { key: "batch", label: "高效批量处理" },
];

export function FeatureCardsSection() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState("popular");

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    const amount = 340;
    scrollRef.current.scrollBy({ left: dir === "left" ? -amount : amount, behavior: "smooth" });
  };

  return (
    <section className="py-20 md:py-28">
      <div className="max-w-7xl mx-auto">
        {/* 标题 */}
        <div className="mb-10">
          <h2 className="text-3xl md:text-5xl font-bold text-[var(--app-fg)] dark:text-white mb-6"><UiText id="home.mc0bc0e331e47" /><span className="text-yellow-500 dark:text-yellow-400"><UiText id="home.mb993107f9d60" /></span>
          </h2>

          {/* 分类 Tab */}
          <div className="flex flex-wrap gap-3">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                  activeTab === tab.key
                    ? "bg-[var(--panel-2)] border border-[var(--border)] text-[var(--app-fg)] dark:bg-white/[0.12] dark:border-white/20 dark:text-white"
                    : "bg-transparent border border-[var(--border)] text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] dark:border-white/8 dark:text-white/50 dark:hover:bg-white/[0.06] dark:hover:text-white/70"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 滚动卡片容器 */}
        <div className="relative group">
          <div
            ref={scrollRef}
            className="flex gap-5 overflow-x-auto pb-4 scrollbar-hide snap-x snap-mandatory"
            style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          >
            {FEATURES.map((feature, idx) => (
              <Link
                key={idx}
                href={feature.href}
                className="flex-shrink-0 w-[300px] snap-start group/card"
              >
                <div className="relative h-full rounded-2xl overflow-hidden bg-[var(--panel-bg)] border border-[var(--border)] hover:border-[var(--border-2)] transition-all duration-500 hover:shadow-[var(--shadow)] hover:-translate-y-1 dark:bg-white/[0.04] dark:border-white/[0.08] dark:hover:border-white/20 dark:hover:shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
                  {/* 卡片顶部渐变区域 */}
                  <div className={`relative h-48 bg-gradient-to-br ${feature.gradient} overflow-hidden`}>
                    {/* 装饰背景 */}
                    <div className="absolute inset-0 opacity-30" style={{
                      backgroundImage: "radial-gradient(circle at 30% 50%, rgba(255,255,255,0.2) 0%, transparent 50%), radial-gradient(circle at 70% 30%, rgba(255,255,255,0.15) 0%, transparent 40%)"
                    }} />
                    {/* 网格装饰 */}
                    <div className="absolute inset-0 opacity-10" style={{
                      backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
                      backgroundSize: "24px 24px"
                    }} />
                    {/* 图标 */}
                    <div className="absolute top-4 right-4 w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center text-white">
                      {feature.icon}
                    </div>
                    {/* 标签 */}
                    {feature.tag && (
                      <div className="absolute top-4 left-4 px-2.5 py-1 rounded-lg bg-black/30 backdrop-blur-sm text-[11px] text-white font-semibold">
                        {feature.tag}
                      </div>
                    )}
                    {/* 底部装饰线 */}
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white/60 to-transparent dark:from-[#0a0a0f]/80" />
                  </div>

                  {/* 卡片内容区 */}
                  <div className="p-5">
                    <h3 className="text-lg font-bold text-[var(--app-fg)] mb-2 group-hover/card:text-yellow-500 transition-colors dark:text-white dark:group-hover/card:text-yellow-400">
                      {feature.title}
                    </h3>
                    <p className="text-sm text-[var(--app-muted)] leading-relaxed line-clamp-3 dark:text-white/40">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* 滚动指示条 */}
          <div className="flex justify-center mt-6">
            <div className="w-20 h-1 rounded-full bg-[var(--border)] overflow-hidden dark:bg-white/10">
              <div className="w-1/3 h-full rounded-full bg-[var(--app-muted)] dark:bg-white/40" />
            </div>
          </div>

          {/* 导航箭头 */}
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              onClick={() => scroll("left")}
              className="w-10 h-10 rounded-full bg-[var(--panel-bg)] border border-[var(--border)] flex items-center justify-center text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-all shadow-[var(--shadow-2)] dark:bg-white/[0.06] dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.12] dark:hover:text-white"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => scroll("right")}
              className="w-10 h-10 rounded-full bg-[var(--panel-bg)] border border-[var(--border)] flex items-center justify-center text-[var(--app-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--app-fg)] transition-all shadow-[var(--shadow-2)] dark:bg-white/[0.06] dark:border-white/10 dark:text-white/60 dark:hover:bg-white/[0.12] dark:hover:text-white"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
