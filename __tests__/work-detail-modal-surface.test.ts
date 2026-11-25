import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkDetailModal, type WorkDetailItem } from "@/components/works/work-detail-modal";

const source = readFileSync(
  resolve(process.cwd(), "components/works/work-detail-modal.tsx"),
  "utf8",
);
const friendlyErrorSource = readFileSync(
  resolve(process.cwd(), "components/ui/friendly-error-block.tsx"),
  "utf8",
);
const themeSource = readFileSync(resolve(process.cwd(), "styles/theme-system.css"), "utf8");

describe("work detail modal surface", () => {
  it.each(["asset", "full"] as const)("shows saved Google sources in %s parameter details", (parameterView) => {
    const item: WorkDetailItem = { id: 1, type: "image_edit", status: "success", prompt: "鸟类海报", localPath: null, createdAt: "2026-10-09", params: { googleGrounding: { renderedContent: "", sources: [{ url: "https://example.com/bird", title: "鸟类资料" }] } } };
    const render = () => renderToStaticMarkup(React.createElement(WorkDetailModal, { open: true, item, onClose: () => {}, parameterView }));
    expect(render()).toContain("Google 搜索来源");
    expect(render()).toContain('href="https://example.com/bird"');
    item.params = {};
    expect(render()).not.toContain("Google 搜索来源");
  });
  it("limits user asset parameters to the five requested fields while preserving admin details", () => {
    const item: WorkDetailItem = { id: 1, type: "image_edit", source: "canvas", status: "success", prompt: "测试提示词", localPath: null, createdAt: "2026-09-20", model: "gemini-3-pro-image", externalTaskId: "task-123", params: { aspectRatio: "9:16", resolution: "2K", imageCount: 4, elapsedMs: 48100, provider: "internal-provider", userPrompt: "内部参数提示词" } };
    const render = (parameterView: "asset" | "full") => renderToStaticMarkup(React.createElement(WorkDetailModal, { open: true, item, onClose: () => {}, parameterView }));
    const html = render("asset");
    for (const text of ["类型", "来源", "模型", "宽高比", "分辨率", "9:16", "2K", "gemini-3-pro-image"]) expect(html).toContain(text);
    for (const text of ["输入数量", "任务元数据", "任务ID", "耗时", "底层模型", "查看全部参数", "internal-provider", "task-123", "内部参数提示词"]) expect(html).not.toContain(text);
    const full = render("full");
    expect(full).toContain("任务元数据");
    expect(full).toContain("查看全部参数");
    expect(readFileSync(resolve(process.cwd(), "app/works/page.tsx"), "utf8")).toContain('parameterView="asset"');
  });
  it("uses a wider panel shell with independently scrollable content", () => {
    expect(source).toContain("max-w-[840px] max-h-[92dvh]");
    expect(source).not.toContain('className="h-14 shrink-0');
    expect(source).toContain('className="min-h-0 overflow-auto bg-[var(--panel-bg)] px-5 pb-5"');
  });

  it("keeps the actions at the right of the task media title", () => {
    const projectImagesStart = source.indexOf(">{mediaTypeLabel}</div>");
    const mediaGridStart = source.indexOf('className="grid grid-cols-1 gap-4 md:grid-cols-2"', projectImagesStart);
    const projectImagesToolbar = source.slice(projectImagesStart, mediaGridStart);

    expect(source).not.toContain("function formatName");
    expect(source).not.toContain("{formatName(item)}");
    expect(source).not.toContain(">项目图片</div>");
    expect(projectImagesStart).toBeGreaterThanOrEqual(0);
    expect(mediaGridStart).toBeGreaterThan(projectImagesStart);
    expect(projectImagesToolbar).toContain('aria-label="更多操作"');
    expect(projectImagesToolbar).toContain('aria-label="关闭"');
  });

  it("uses the shared solid panel background for the shell and content", () => {
    expect(source).toContain(
      "border border-[var(--border)] bg-[var(--panel-bg)] shadow-[var(--shadow)]",
    );
    expect(source).toContain('className="min-h-0 overflow-auto bg-[var(--panel-bg)] px-5 pb-5"');
    expect(source).not.toContain("dark:bg-[#090a0f]");
    expect(themeSource).toContain("--color-bg-card: #202020;");
    expect(themeSource).toContain("--panel-bg: var(--color-bg-card);");
  });

  it("separates content hierarchy with shared theme surfaces instead of dark-only overrides", () => {
    expect(source).not.toContain("bg-[var(--sidebar-bg)]");
    expect(source).not.toContain("bg-[var(--app-bg)]");
    expect(source).not.toContain("object-contain bg-black");
    expect(source).not.toContain("dark:bg-[#101116]");
    expect(source).not.toContain("dark:bg-[#15161c]");
    expect(source).not.toContain("dark:border-white/10");
    expect(source).toContain("bg-[var(--panel-2)]");
  });

  it("aligns media card headers and reduces parameter card nesting", () => {
    expect(source).toContain("min-h-[64px] border-b border-[var(--border)]");
    expect(source).toContain("生成内容预览");
    expect(source).toContain("divide-y divide-[var(--border)]");
    expect(source).toContain("gap-x-8 gap-y-3");
  });

  it("shows the complete failure information in an empty failed result panel", () => {
    expect(source).toContain('import { FriendlyErrorBlock } from "@/components/ui/friendly-error-block"');
    expect(source).toContain("errorMsg?: string | null");
    expect(source).toContain('item.status === "failed"');
    expect(source).toContain('<FriendlyErrorBlock error={item.errorMsg || "未记录失败原因"} defaultOpen />');
    expect(friendlyErrorSource).toContain("defaultOpen = false");
    expect(friendlyErrorSource).toContain('<details className="mt-2" open={defaultOpen}>');
  });

  it("shows a saved original Skill prompt in a full-width scrollable parameter box", () => {
    expect(source).toContain('gp("用户提示词", p.userPrompt, "wide-scroll")');
    expect(source).toContain('e.layout === "wide-scroll" ? "min-w-0 sm:col-span-2"');
    expect(source).toContain("max-h-40 overflow-y-auto whitespace-pre-wrap break-words");
    expect(source).toContain("border-[var(--border)] bg-[var(--input-bg)]");
  });

  it("copies the original user prompt from its parameter box", () => {
    expect(source).toContain('handleCopy("userPrompt", e.value)');
    expect(source).toContain('copiedTarget === "userPrompt" ? "已复制" : "复制提示词"');
  });
});
