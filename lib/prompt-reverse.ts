import type { ResolvedProvider } from "@/lib/providers/types";

export type PromptReverseContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type PromptReverseMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: PromptReverseContentPart[] };

export type BuildPromptReverseMessagesInput = {
  systemPrompt: string;
  userPrompt?: string;
  mediaUrls?: string[];
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function selectPromptReverseModel(provider: ResolvedProvider, requestedModel?: string): string {
  const requested = clean(requestedModel);
  if (requested && provider.chatModels.includes(requested)) return requested;
  return provider.chatModels[0] || "";
}

export function buildPromptReverseMessages(input: BuildPromptReverseMessagesInput): PromptReverseMessage[] {
  const systemPrompt = clean(input.systemPrompt);
  const userPrompt = clean(input.userPrompt) || "请根据上传素材生成可直接用于 AI 生图的专业提示词。";
  const mediaUrls = Array.isArray(input.mediaUrls)
    ? Array.from(new Set(input.mediaUrls.map(clean).filter(Boolean))).slice(0, 16)
    : [];

  const content: PromptReverseContentPart[] = [
    {
      type: "text",
      text: [
        "请根据 system 中的角色定位和规则，结合本次用户指令与上传素材，输出最终可直接执行的专业提示词。",
        "优先级要求：用户本次指令优先于系统提示词中的默认数量、默认风格、默认布局与默认策略；如果二者冲突，以用户本次指令为准。",
        "不要解释推理过程，不要输出多余开场白，只输出最终提示词正文。",
        "",
        "用户本次指令：",
        userPrompt,
      ].join("\n"),
    },
  ];

  for (const url of mediaUrls) {
    content.push({ type: "image_url", image_url: { url } });
  }

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content },
  ];
}

function extractContentPartText(part: any): string {
  if (typeof part === "string") return part;
  return clean(part?.text || part?.content || part?.value);
}

export function extractPromptReverseText(data: any): string {
  const source = data?.choices ? data : data?.data || data;
  const content = source?.choices?.[0]?.message?.content ?? source?.choices?.[0]?.text ?? source?.output_text;
  if (typeof content === "string") return clean(content);
  if (Array.isArray(content)) return clean(content.map(extractContentPartText).filter(Boolean).join("\n"));
  if (Array.isArray(source?.output)) {
    return clean(
      source.output
        .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
        .map(extractContentPartText)
        .filter(Boolean)
        .join("\n")
    );
  }
  return "";
}
