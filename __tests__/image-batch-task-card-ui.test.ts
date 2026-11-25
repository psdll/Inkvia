import { existsSync } from "node:fs";
import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

const read = (path: string) => {
  expect(existsSync(path), `${path} must exist`).toBe(true);
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
};

describe("batch task result UI", () => {
  it("renders spinner, elapsed seconds, failure retry, and successful regeneration", () => {
    const result = read("components/batch-workbench/batch-task-result.tsx");
    expect(result).toContain("Loader2");
    expect(result).toContain("Clock3");
    expect(result).toContain("生成中 ·");
    expect(result).toContain("生成失败");
    expect(result).toContain("重试");
    expect(result).toContain("重新生成");
    expect(result).toContain('aria-label="下载生成结果"');
    expect(result).toContain("Download");
    expect(result).toContain("downloadUrl");
    expect(result).toContain("href={downloadUrl}");
    expect(result).not.toContain("href={path}");
    expect(result).toContain("h-7 shrink-0");
    expect(result).toContain("text-[11px]");
    expect(result).toContain("aria-busy");
    expect(result).toContain("animate-spin");
    expect(result).not.toContain("line-clamp");
  });

  it("keeps result actions item scoped", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");
    const page = read("components/batch-workbench/batch-workbench-page.tsx");
    const result = read("components/batch-workbench/batch-task-result.tsx");
    expect(card).toContain("pendingAction");
    expect(card).toContain("actionError");
    expect(card).toContain("onRetry");
    expect(card).toContain("onRegenerate");
    expect(card).toContain("<BatchTaskResult");
    expect(page).toContain("pendingItemActionIdsRef.current.has(item.id)");
    expect(page).toContain("pendingItemActionIdsRef.current.add(item.id)");
    expect(page).toContain("pendingItemActionIdsRef.current.delete(item.id)");
    expect(page).toContain("markHistoryBatchQueued(group.batchId, [item.id])");
    expect(result).toContain("disabled={pendingAction !== null}");
  });

  it("keeps queued tasks at zero seconds until the worker writes startedAt", () => {
    const result = read("components/batch-workbench/batch-task-result.tsx");

    expect(result).not.toContain("localStartedAt");
    expect(result).toContain("elapsedSeconds(\n    output?.startedAt,");
    expect(result).toContain("if (!active || !output?.startedAt) return;");
  });

  it("resizes the prompt popover in both batch modes beyond the card", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");

    expect(card).toContain("h-52 w-[calc(100%-1.5rem)]");
    expect(card).toContain("min-h-28 min-w-48 max-h-[60vh] max-w-[70vw]");
    expect(card).toContain('className="h-full w-full resize-none');
    expect(card).toContain(
      'promptEditorOpen\n          ? "overflow-visible"\n          : "overflow-hidden"',
    );
    expect(card).toContain(
      "rounded-md min-h-28 min-w-48 max-h-[60vh] max-w-[70vw] resize overflow-auto",
    );
    expect(card).not.toContain('batchMode === "multi_prompt" && promptEditorOpen');
    expect(card).not.toContain("rounded-2xl overflow-hidden");
  });

  it("delays the hover preview in both batch modes and suppresses it while editing", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");
    const scheduleStart = card.indexOf("const schedulePromptTooltip");
    const scheduleEnd = card.indexOf("React.useEffect", scheduleStart);
    const schedulePrompt = card.slice(scheduleStart, scheduleEnd);

    expect(card).toContain("const PROMPT_TOOLTIP_DELAY_MS = 800;");
    expect(card).toContain("window.setTimeout");
    expect(card).toContain(
      "document.querySelector('[data-region=\"task-prompt-region\"] textarea')",
    );
    expect(card).toContain("onMouseEnter");
    expect(card).toContain("onMouseLeave");
    expect(card).toContain('role="tooltip"');
    expect(card).toContain("createPortal");
    expect(scheduleStart).toBeGreaterThanOrEqual(0);
    expect(scheduleEnd).toBeGreaterThan(scheduleStart);
    expect(schedulePrompt).not.toContain('batchMode !== "multi_prompt"');
    expect(card).not.toContain("title={item.prompt}");
    expect(card).not.toContain(
      'title={batchMode === "multi_prompt" ? undefined : item.prompt}',
    );
  });

  it("keeps prompt hover available during generation while edit locking stays item scoped", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");
    const scheduleStart = card.indexOf("const schedulePromptTooltip");
    const scheduleEnd = card.indexOf("React.useEffect", scheduleStart);
    const schedulePrompt = card.slice(scheduleStart, scheduleEnd);
    const promptSectionRef = card.indexOf("ref={promptEditorRef}");
    const promptSectionStart = card.lastIndexOf("<section", promptSectionRef);
    const promptButtonStart = card.indexOf("<button", promptSectionRef);
    const promptSectionOpening = card.slice(promptSectionStart, promptButtonStart);
    const promptButtonEnd = card.indexOf("</button>", promptButtonStart);
    const promptButton = card.slice(promptButtonStart, promptButtonEnd);

    expect(card).toContain("promptBusy: boolean;");
    expect(schedulePrompt).not.toContain("busy");
    expect(promptSectionOpening).toContain("onMouseEnter");
    expect(promptSectionOpening).toContain("onMouseLeave");
    expect(promptButton).not.toContain("onMouseEnter");
    expect(promptButton).toContain("disabled={promptBusy}");
    expect(card).toContain("disabled={busy}");
  });

  it("contains every wheel gesture inside both batch-mode media rows", () => {
    const card = read("components/batch-workbench/batch-task-card.tsx");
    const gallery = read("components/batch-workbench/batch-media-gallery.tsx");
    const nativeHandler = gallery.indexOf(
      "const handleWheel = (event: WheelEvent) => {",
    );
    const containment = gallery.indexOf("event.preventDefault();", nativeHandler);
    const noOverflowReturn = gallery.indexOf(
      "if (target.scrollWidth <= target.clientWidth) return;",
      containment,
    );

    expect(card).toMatch(
      /const containTaskMediaWheel =\s+batchMode === "multi_prompt" \|\| batchMode === "style_replication";/,
    );
    expect(
      card.match(/containHorizontalWheel=\{containTaskMediaWheel\}/g),
    ).toHaveLength(2);
    expect(gallery).toContain("containHorizontalWheel = false");
    expect(gallery).toContain(
      'containHorizontalWheel ? "overscroll-x-contain" : ""',
    );
    expect(nativeHandler).toBeGreaterThanOrEqual(0);
    expect(containment).toBeGreaterThan(nativeHandler);
    expect(noOverflowReturn).toBeGreaterThan(containment);
    expect(gallery.slice(containment, noOverflowReturn)).toMatch(
      /event\.preventDefault\(\);\s+event\.stopPropagation\(\);/,
    );
    expect(gallery).toContain(
      'target.addEventListener("wheel", handleWheel, { passive: false });',
    );
    expect(gallery).toContain(
      'target.removeEventListener("wheel", handleWheel);',
    );
    expect(gallery).not.toContain("containHorizontalGesture");
  });
});
