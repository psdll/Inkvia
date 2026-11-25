import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { useCreateLocalization } from "@/components/studio/create-localization";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { FriendlyErrorBlock } from "@/components/ui/friendly-error-block";
import { UiLocaleProvider } from "@/i18n/ui";
import type { UiLocale } from "@/i18n/locale";
import en from "@/messages/en.json";
import zh from "@/messages/zh-CN.json";

function CreateControls() {
  const { generationLabel, parameterLabel } = useCreateLocalization();
  return createElement("div", null,
    createElement("button", null, generationLabel("素材上传中…")),
    createElement("button", null, generationLabel("生成")),
    createElement("button", null, parameterLabel("全能参考")),
    createElement("input", { defaultValue: "中文草稿 @图片1" }),
  );
}

function renderLocalized(locale: UiLocale) {
  return renderToStaticMarkup(createElement(UiLocaleProvider, {
    locale,
    messages: locale === "en" ? en : zh,
    children: createElement("main", null,
      createElement(CreateControls),
      createElement(DateRangePicker, {
        from: "2026-11-25",
        to: "2026-11-28",
        onFromChange: () => undefined,
        onToChange: () => undefined,
      }),
      createElement(FriendlyErrorBlock, {
        error: { message: "当前模型最多支持 3 张参考图片", action: "请减少输入数量后重试。" },
      }),
    ),
  }));
}

describe("Create localization of dynamic controls", () => {
  it("translates status, generation, media validation, and date labels in English without changing the prompt", () => {
    const markup = renderLocalized("en");
    expect(markup).toContain("Uploading media…");
    expect(markup).toContain(">Generate</button>");
    expect(markup).toContain("Multimodal reference");
    expect(markup).toContain("Nov 25, 2026");
    expect(markup).toContain("This model supports up to 3 reference images.");
    expect(markup).toContain("Reduce the number of inputs and try again.");
    expect(markup).toContain('value="中文草稿 @图片1"');
  });

  it("keeps Chinese wording and existing date format", () => {
    const markup = renderLocalized("zh-CN");
    expect(markup).toContain("素材上传中…");
    expect(markup).toContain(">生成</button>");
    expect(markup).toContain("全能参考");
    expect(markup).toContain("2026-11-25");
    expect(markup).toContain("当前模型最多支持 3 张参考图片");
    expect(markup).toContain('value="中文草稿 @图片1"');
  });
});
