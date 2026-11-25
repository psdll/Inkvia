import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BatchStatusBadge } from "@/components/batch-workbench/batch-status-badge";
import { CanvasEditableNodeName } from "@/components/canvas/CanvasEditableNodeName";
import type { UiLocale } from "@/i18n/locale";
import { UiLocaleProvider } from "@/i18n/ui";
import english from "@/messages/en.json";
import chinese from "@/messages/zh-CN.json";

function renderWorkspace(locale: UiLocale) {
  return renderToStaticMarkup(createElement(UiLocaleProvider, {
    locale,
    messages: locale === "en" ? english : chinese,
    children: createElement(Fragment, null,
      createElement(BatchStatusBadge, {
        status: "success",
        startedAt: "2026-11-25T12:00:00Z",
        finishedAt: "2026-11-25T12:20:00Z",
      }),
      createElement(CanvasEditableNodeName, { name: "图片", onRename: () => {} }),
    ),
  }));
}

describe("workspace localization", () => {
  it("translates a batch status and formats elapsed time in English while preserving a user-supplied project name", () => {
    const html = renderWorkspace("en");
    expect(html).toContain("Completed · Took 1,200s");
    expect(html).toContain(">图片</span>");
  });

  it("keeps the original Chinese batch status, time and project name", () => {
    const html = renderWorkspace("zh-CN");
    expect(html).toContain("已完成 · 耗时 1200 秒");
    expect(html).toContain(">图片</span>");
  });
});
