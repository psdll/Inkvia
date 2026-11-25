import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { IMAGE_BATCH_LIMITS } from "@/lib/image-batch/contracts";

export const SEGMENTED_PROMPT_RULE_SETTING_KEY =
  "image_batch.segmented_prompt_rule.v1";
export const SEGMENTED_PROMPT_RULE_MAX_LENGTH = 10_000;

export const DEFAULT_SEGMENTED_PROMPT_RULE_TEXT = `请按以下规则输出可直接创建任务的分段提示词：

1. 标题可选，不得因为缺少标题而拒绝分段。
2. 独占一行的「【标题】」或「[标题]」视为标题，标题后的正文属于该分段，直到下一个标题出现。
3. 没有标题且没有空行时，每个非空行作为一个独立分段。
4. 没有标题但存在空行时，以空行分隔内容块，每个内容块作为一个分段。
5. 每个分段的提示词正文必须非空，可以不提供分段名称。
6. 不要输出开场说明、总结、解释或 JSON，只输出需要分批执行的提示词内容。
7. 最多输出 ${IMAGE_BATCH_LIMITS.maxItems} 个分段。`;

export type SegmentedPromptRuleConfig = {
  revision: number;
  source: "default" | "custom";
  ruleText: string;
  updatedAt: string | null;
};

export type SegmentedPromptRuleErrorCode =
  | "RULE_EMPTY"
  | "RULE_TOO_LONG"
  | "RULE_REVISION_CONFLICT";

export class SegmentedPromptRuleError extends Error {
  code: SegmentedPromptRuleErrorCode;
  status: number;

  constructor(
    code: SegmentedPromptRuleErrorCode,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "SegmentedPromptRuleError";
    this.code = code;
    this.status = status;
  }
}

type AppSettingRow = {
  value: string;
  updatedAt?: Date | string | null;
};

type SegmentedPromptRuleClient = Pick<Prisma.TransactionClient, "appSetting">;

function defaultConfig(): SegmentedPromptRuleConfig {
  return {
    revision: 1,
    source: "default",
    ruleText: DEFAULT_SEGMENTED_PROMPT_RULE_TEXT,
    updatedAt: null,
  };
}

function parseStoredConfig(row: AppSettingRow | null): SegmentedPromptRuleConfig {
  if (!row?.value) return defaultConfig();
  try {
    const parsed = JSON.parse(row.value) as {
      schemaVersion?: unknown;
      revision?: unknown;
      ruleText?: unknown;
    };
    const revision = Number(parsed.revision);
    const ruleText = typeof parsed.ruleText === "string"
      ? parsed.ruleText.trim()
      : "";
    if (
      parsed.schemaVersion !== 1
      || !Number.isInteger(revision)
      || revision < 2
      || !ruleText
      || ruleText.length > SEGMENTED_PROMPT_RULE_MAX_LENGTH
    ) {
      return defaultConfig();
    }
    const updatedAt = row.updatedAt ? new Date(row.updatedAt).toISOString() : null;
    return { revision, source: "custom", ruleText, updatedAt };
  } catch {
    return defaultConfig();
  }
}

function normalizeRuleText(value: unknown) {
  const ruleText = String(value ?? "").trim();
  if (!ruleText) {
    throw new SegmentedPromptRuleError(
      "RULE_EMPTY",
      "自定义解析规则不能为空",
    );
  }
  if (ruleText.length > SEGMENTED_PROMPT_RULE_MAX_LENGTH) {
    throw new SegmentedPromptRuleError(
      "RULE_TOO_LONG",
      `自定义解析规则不能超过 ${SEGMENTED_PROMPT_RULE_MAX_LENGTH} 字`,
    );
  }
  return ruleText;
}

function assertExpectedRevision(current: number, expected: unknown) {
  const expectedRevision = Number(expected);
  if (!Number.isInteger(expectedRevision) || expectedRevision !== current) {
    throw new SegmentedPromptRuleError(
      "RULE_REVISION_CONFLICT",
      "规则已被其他管理员更新，请刷新后重试",
      409,
    );
  }
}

export async function getSegmentedPromptRule(
  client: SegmentedPromptRuleClient = prisma,
): Promise<SegmentedPromptRuleConfig> {
  const row = await client.appSetting.findUnique({
    where: { key: SEGMENTED_PROMPT_RULE_SETTING_KEY },
  });
  return parseStoredConfig(row);
}

export async function saveSegmentedPromptRule(
  input: { ruleText: unknown; expectedRevision: unknown },
  client: SegmentedPromptRuleClient = prisma,
): Promise<SegmentedPromptRuleConfig> {
  const ruleText = normalizeRuleText(input.ruleText);
  const current = await getSegmentedPromptRule(client);
  assertExpectedRevision(current.revision, input.expectedRevision);
  const revision = current.revision + 1;
  const value = JSON.stringify({ schemaVersion: 1, revision, ruleText });
  const row = await client.appSetting.upsert({
    where: { key: SEGMENTED_PROMPT_RULE_SETTING_KEY },
    create: { key: SEGMENTED_PROMPT_RULE_SETTING_KEY, value },
    update: { value },
  });
  return parseStoredConfig(row);
}

export async function resetSegmentedPromptRule(
  input: { expectedRevision: unknown },
  client: SegmentedPromptRuleClient = prisma,
): Promise<SegmentedPromptRuleConfig> {
  const current = await getSegmentedPromptRule(client);
  assertExpectedRevision(current.revision, input.expectedRevision);
  await client.appSetting.deleteMany({
    where: { key: SEGMENTED_PROMPT_RULE_SETTING_KEY },
  });
  return defaultConfig();
}

export function appendSegmentedPromptRule(
  systemPrompt: unknown,
  ruleText: unknown,
) {
  return [
    String(systemPrompt ?? "").trim(),
    "",
    "---",
    "全局分段输出规则（优先于技能内冲突的输出格式）：",
    normalizeRuleText(ruleText),
    "",
    "系统安全约束：标题可选；每个分段正文必须非空；最多 "
      + `${IMAGE_BATCH_LIMITS.maxItems} 个分段；不要输出解析说明。`,
  ].join("\n");
}

export async function resolveSegmentedPromptSystemPrompt(input: {
  surface: string;
  systemPrompt: unknown;
}, client: SegmentedPromptRuleClient = prisma) {
  const systemPrompt = String(input.systemPrompt ?? "").trim();
  if (input.surface !== "batch_workbench") return systemPrompt;
  const config = await getSegmentedPromptRule(client);
  return appendSegmentedPromptRule(systemPrompt, config.ruleText);
}
