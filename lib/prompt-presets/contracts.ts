export type PromptPresetSource = "custom" | "builtin";

export type PromptPresetDto = {
  id: string;
  name: string;
  category: string;
  content: string;
  source: PromptPresetSource;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type PromptPresetInput = {
  name: string;
  category: string;
  content: string;
};

const MAX_NAME_LENGTH = 128;
const MAX_CATEGORY_LENGTH = 64;
const MAX_CONTENT_LENGTH = 10_000;

function normalizeRequiredText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string") {
    throw new Error(`${field}必须是文本`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field}不能为空`);
  }
  if (normalized.length > maximumLength) {
    throw new Error(`${field}不能超过 ${maximumLength} 个字符`);
  }

  return normalized;
}

export function normalizePromptInput(input: PromptPresetInput): PromptPresetInput {
  const name = normalizeRequiredText(input.name, "名称", MAX_NAME_LENGTH);
  const category = normalizeRequiredText(input.category, "分类", MAX_CATEGORY_LENGTH);
  const content = normalizeRequiredText(input.content, "正文", MAX_CONTENT_LENGTH);

  if (category === "all") {
    throw new Error("分类不能为 all");
  }

  return { name, category, content };
}

export function mergeCanvasPromptContent(positive: unknown, negative: unknown): string {
  const normalizedPositive = typeof positive === "string" ? positive.trim() : "";
  const normalizedNegative = typeof negative === "string" ? negative.trim() : "";

  if (!normalizedPositive) {
    throw new Error("正向提示词不能为空");
  }

  return normalizedNegative
    ? `${normalizedPositive}\n\n负向提示词：${normalizedNegative}`
    : normalizedPositive;
}

function assertPromptPresetSource(source: unknown): asserts source is PromptPresetSource {
  if (source !== "custom" && source !== "builtin") {
    throw new Error("无效的提示词来源");
  }
}

function assertPromptPresetId(id: unknown): asserts id is bigint {
  if (typeof id !== "bigint" || id <= BigInt(0)) {
    throw new Error("无效的提示词 ID");
  }
}

export function toPromptPublicId(source: PromptPresetSource, id: bigint): string {
  assertPromptPresetSource(source);
  assertPromptPresetId(id);
  return `${source}:${id}`;
}

export function parsePromptPublicId(value: string): {
  source: PromptPresetSource;
  id: bigint;
} {
  const match = /^(custom|builtin):([1-9]\d*)$/.exec(value);
  if (!match) {
    throw new Error("无效的提示词公开 ID");
  }

  const [, source, rawId] = match;
  const id = BigInt(rawId);
  assertPromptPresetSource(source);
  assertPromptPresetId(id);
  return { source, id };
}
