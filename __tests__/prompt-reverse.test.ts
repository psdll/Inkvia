import { describe, expect, it } from "vitest";
import {
  buildPromptReverseMessages,
  extractPromptReverseText,
  selectPromptReverseModel,
} from "@/lib/prompt-reverse";
import type { ResolvedProvider } from "@/lib/providers/types";

const provider: ResolvedProvider = {
  id: "apimart",
  name: "APIMART",
  protocol: "apimart",
  baseUrl: "https://api.apimart.ai/v1",
  apiKey: "secret",
  hasKey: true,
  egressMode: "proxy",
  allowLegacyFallback: true,
  imageModels: [],
  videoModels: [],
  chatModels: ["gpt-5.5", "deepseek-v4-flash"],
  modelProtocols: {},
};

describe("prompt reverse helpers", () => {
  it("builds multimodal messages where user instructions are explicitly higher priority", () => {
    const messages = buildPromptReverseMessages({
      systemPrompt: "默认生成 4 张详情页",
      userPrompt: "这次只输出 1 张主图",
      mediaUrls: ["https://example.com/a.png"],
    });

    expect(messages[0]).toEqual({ role: "system", content: "默认生成 4 张详情页" });
    expect(messages[1].role).toBe("user");
    const userMessage = messages[1] as Extract<(typeof messages)[number], { role: "user" }>;
    const textPart = userMessage.content[0];
    expect(textPart.type).toBe("text");
    expect(textPart.type === "text" ? textPart.text : "").toContain("用户本次指令优先");
    expect(textPart.type === "text" ? textPart.text : "").toContain("这次只输出 1 张主图");
    expect(messages[1].content[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://example.com/a.png" },
    });
  });

  it("selects a requested enabled chat model or falls back to the first enabled chat model", () => {
    expect(selectPromptReverseModel(provider, "deepseek-v4-flash")).toBe("deepseek-v4-flash");
    expect(selectPromptReverseModel(provider, "missing-model")).toBe("gpt-5.5");
    expect(selectPromptReverseModel({ ...provider, chatModels: [] }, "")).toBe("");
  });

  it("extracts text from common APIMART OpenAI-compatible response shapes", () => {
    expect(
      extractPromptReverseText({
        choices: [{ message: { content: " final prompt " } }],
      }),
    ).toBe("final prompt");

    expect(
      extractPromptReverseText({
        data: { choices: [{ message: { content: [{ type: "text", text: "from parts" }] } }] },
      }),
    ).toBe("from parts");
  });
});
