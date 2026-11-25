import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LlmModelModalities } from "@/components/admin/LlmModelModalities";
import { ProviderModelUsageGroups } from "@/components/admin/ProviderModelUsageGroups";
import { BAILIAN_LLM_MODELS } from "@/lib/bailian-llm-models";
import { getLlmModelModalities } from "@/lib/llm-routing/model-modalities";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

describe("LLM input/output labels", () => {
  it("prefers official DeepSeek capabilities on every platform", () => {
    for (const providerId of ["deepseek", "reapi", "apimart", "custom"]) {
      expect(getLlmModelModalities(providerId, "deepseek-v4-pro")).toEqual({ input: ["text"], output: ["text"] });
      for (const modelId of ["deepseek-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"]) {
        expect(getLlmModelModalities(providerId, modelId)).toEqual({ input: ["text", "image"], output: ["text"] });
      }
    }
  });

  it("shares official references for the same model across platforms", () => {
    for (const providerId of ["bailian", "reapi", "apimart", "custom"]) {
      expect(getLlmModelModalities(providerId, "qwen3.8-max")).toEqual({ input: ["text", "image", "video"], output: ["text"] });
      expect(getLlmModelModalities(providerId, "gpt-5.6-sol")).toEqual({ input: ["text", "image"], output: ["text"] });
      expect(getLlmModelModalities(providerId, "gpt-5.5")).toEqual({ input: ["text", "image"], output: ["text"] });
    }
  });

  it("uses OpenAI text and image input with text output for every verified GPT ID", () => {
    for (const modelId of ["gpt-5.5", "gpt-5.5-high", "gpt-5.6-terra", "gpt-5.6-sol"]) {
      for (const providerId of ["apimart", "easyrouter", "aicoming-haiya", "tuzi", "reapi", "custom"]) {
        expect(getLlmModelModalities(providerId, modelId)).toEqual({ input: ["text", "image"], output: ["text"] });
        const html = renderToStaticMarkup(React.createElement(LlmModelModalities, { providerId, modelId }));
        expect(html).toContain('aria-label="输入模态：图片"');
        expect(html).toContain('aria-label="输出模态：文本"');
        expect(html.match(/<svg /g)).toHaveLength(3);
      }
    }
  });

  it("renders Omni audio as input and text as output with accessible icon labels", () => {
    const html = renderToStaticMarkup(React.createElement(LlmModelModalities, { providerId: "bailian", modelId: "qwen3.8-omni-flash" }));
    expect(html.replace(/<[^>]*>/g, "")).toBe("输入模态输出模态");
    expect(html.match(/<svg /g)).toHaveLength(5);
    expect(html).toContain('aria-label="输入模态：音频" title="音频"');
    expect(html).toContain('aria-label="输出模态：文本" title="文本"');
  });

  it("renders Seed Audio reference modalities and audio output on every platform", () => {
    for (const providerId of ["volcengine-speech", "custom"]) {
      expect(getLlmModelModalities(providerId, "seed-audio-1.0")).toEqual({ input: ["text", "image", "audio"], output: ["audio"] });
      const html = renderToStaticMarkup(React.createElement(LlmModelModalities, { providerId, modelId: "seed-audio-1.0" }));
      expect(html).toContain('aria-label="输入模态：图片"');
      expect(html).toContain('aria-label="输入模态：音频"');
      expect(html).toContain('aria-label="输出模态：音频"');
      expect(html).not.toContain('aria-label="输出模态：文本"');
      expect(html.match(/<svg /g)).toHaveLength(4);
    }
  });

  it("does not guess capabilities for unknown or similarly named models", () => {
    for (const modelId of ["custom-vision", "qwen3.8-flash-unknown", "deepseek-v4.2-flash", "gpt-5.5-unknown", "gpt-5.6-terra-unknown", "toString", "__proto__"]) {
      for (const providerId of ["custom", "reapi", "apimart"]) {
        expect(getLlmModelModalities(providerId, modelId)).toBeNull();
      }
    }
    const html = renderToStaticMarkup(React.createElement(LlmModelModalities, { providerId: "custom", modelId: "unknown" }));
    expect(html).toBe("");
  });

  it.each(["speech-2.8-hd", "speech-2.8-turbo"])("renders %s as text input and audio output across platforms", (modelId) => {
    for (const providerId of ["minimax", "apimart", "custom"]) {
      expect(getLlmModelModalities(providerId, modelId)).toEqual({ input: ["text"], output: ["audio"] });
      const html = renderToStaticMarkup(React.createElement(LlmModelModalities, { providerId, modelId }));
      expect(html).toContain('aria-label="输入模态：文本"');
      expect(html).toContain('aria-label="输出模态：音频"');
      expect(html.match(/<svg /g)).toHaveLength(2);
    }
    expect(getLlmModelModalities("minimax", `${modelId}-unknown`)).toBeNull();
  });

  it("covers every registered Bailian LLM with its documented modalities", () => {
    for (const modelId of BAILIAN_LLM_MODELS) {
      expect(getLlmModelModalities("bailian", modelId)).toEqual({
        input: modelId === "qwen3.8-omni-flash" ? ["text", "image", "audio", "video"] : ["text", "image", "video"],
        output: ["text"],
      });
    }
  });

  it.each([true, false])("shows modalities for LLM and known audio rows (compact=%s)", (compact) => {
    const html = renderToStaticMarkup(React.createElement(ProviderModelUsageGroups, {
      compact,
      providerId: "bailian",
      imageModels: ["qwen-image-3"],
      audioModels: ["seed-audio-1.0", "speech-2.8-hd", "speech-2.8-turbo", "unknown-audio"],
      chatModels: [...BAILIAN_LLM_MODELS],
      videoModels: ["wan3.0-video"],
      chatModelDraft: "",
      chatModelOptions: [],
      canManageChat: false,
      savedChatModels: [...BAILIAN_LLM_MODELS],
      scenarios: [],
      routeActions: {},
      routesDisabled: false,
      mutationsDisabled: false,
      onChatModelDraftChange: () => {},
      onAddChatModel: () => {},
      onActivateRoute: () => {},
      onRemove: () => {},
    }));
    for (const modelId of [...BAILIAN_LLM_MODELS, "seed-audio-1.0", "speech-2.8-hd", "speech-2.8-turbo"]) {
      if (!compact) {
        expect(html).toContain(`aria-label="${modelId} 输入输出模态"`);
        continue;
      }
      const cell = html.match(/<td\b[^>]*>[\s\S]*?<\/td>/g)?.find(value => value.includes(`>${modelId}</span>`));
      expect(cell).toContain(`aria-label="${modelId} 输入输出模态"`);
      expect(cell).toContain("输入模态");
      expect(cell).toContain("输出模态");
    }
    expect(html.match(/输入输出模态/g)).toHaveLength(BAILIAN_LLM_MODELS.length + 3);
  });
});
