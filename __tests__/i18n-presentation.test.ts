import { describe, expect, it, vi } from "vitest";
import { formatUiDate, formatUiNumber, formatUiRelativeTime } from "@/i18n/format";
import { formatUiError, formatUiLabel } from "@/i18n/source-messages";
import { apiErrorMessage } from "@/i18n/api-message";

const { locale } = vi.hoisted(() => ({ locale: { value: "zh-CN" } }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: locale.value }) }) }));

describe("localized presentation", () => {
  it("keeps the Chinese status and translates the English status", () => {
    expect(formatUiLabel("zh-CN", "进行中")).toBe("进行中");
    expect(formatUiLabel("en", "进行中")).toBe("In progress");
  });

  it("uses localized dates, grouped numbers and relative times while retaining legacy Chinese formatting", () => {
    const date = "2026-11-25T12:30:00Z";
    const options = { dateStyle: "long", timeZone: "UTC" } as const;
    expect(formatUiDate("en", date, options)).toBe("November 25, 2026");
    expect(formatUiDate("zh-CN", date, options, () => "2026年11月25日")).toBe("2026年11月25日");
    expect(formatUiNumber("en", 12500.5)).toBe("12,500.5");
    expect(formatUiNumber("zh-CN", 12500.5, undefined, () => "12500.5")).toBe("12500.5");
    expect(formatUiRelativeTime("en", -1, "day")).toBe("yesterday");
    expect(formatUiRelativeTime("zh-CN", -1, "day", () => "昨天")).toBe("昨天");
  });

  it("localizes status templates without altering the data inserted into them", () => {
    const original = "模型 我的模型 调用占比 80.0%";
    expect(formatUiLabel("en", original)).toBe("我的模型 accounts for 80.0% of requests.");
    expect(formatUiLabel("zh-CN", original)).toBe(original);
  });

  it("localizes a dynamic API error from the request cookie and preserves the default Chinese text", () => {
    const original = "请求体不是合法的 JSON";
    locale.value = "zh-CN";
    expect(apiErrorMessage(original)).toBe(original);
    locale.value = "en";
    expect(apiErrorMessage(original)).toBe("The request body is not valid JSON.");
    expect(apiErrorMessage("用户名不能为空")).toBe("Enter a username.");
    expect(apiErrorMessage(null)).toBeNull();
    locale.value = "unexpected";
    expect(apiErrorMessage(original)).toBe(original);
  });

  it("uses a localized fallback for unknown provider errors and passes through English errors", () => {
    expect(formatUiError("en", new Error("第三方自定义失败消息"), "上传失败")).toBe("Upload failed");
    expect(formatUiError("en", "HTTP 429: Too Many Requests")).toBe("HTTP 429: Too Many Requests");
    expect(formatUiError("zh-CN", "第三方自定义失败消息")).toBe("第三方自定义失败消息");
  });
});
