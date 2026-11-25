import { IMAGE_BATCH_LIMITS } from "@/lib/image-batch/contracts";

export type PromptSegmentV1 = {
  index: number;
  name: string;
  prompt: string;
};

export type PromptSegmentParseErrorCode =
  | "PROMPT_SEGMENTS_NOT_FOUND"
  | "PROMPT_SEGMENT_PREAMBLE"
  | "PROMPT_SEGMENT_HEADER_INVALID"
  | "PROMPT_SEGMENT_SEQUENCE"
  | "PROMPT_SEGMENT_BODY_EMPTY"
  | "PROMPT_SEGMENT_WRAPPER_INVALID"
  | "PROMPT_SEGMENT_LIMIT";

export class PromptSegmentParseError extends Error {
  code: PromptSegmentParseErrorCode;

  constructor(code: PromptSegmentParseErrorCode, message: string) {
    super(message);
    this.name = "PromptSegmentParseError";
    this.code = code;
  }
}

type ParsedHeader = {
  index: number | null;
  name: string;
  wrapped: "(" | "（" | null;
};

function stripOuterCodeFence(value: string) {
  const match = value.match(/^\s*```[^\r\n]*\r?\n([\s\S]*?)\r?\n```\s*$/);
  return match ? match[1] : value;
}

function stripMarkdownDecorators(value: string) {
  let line = value.trim();
  line = line.replace(/^#{1,6}\s+/, "");
  line = line.replace(/^(?:[-*+]|\d+[.)])\s+/, "");
  line = line.replace(/^(?:\*\*|__)/, "");
  line = line.replace(/(?:\*\*|__)$/, "");
  return line.trim();
}

function parseHeaderLine(value: string): ParsedHeader | null {
  let line = stripMarkdownDecorators(value);
  const wrapped = line.startsWith("（") ? "（" : line.startsWith("(") ? "(" : null;
  if (wrapped) line = line.slice(1).trimStart();

  const numberedMatch = line.match(
    /^(?:【|\[)\s*(.+?)\s*(?:｜|\|)\s*提示词\s*(\d+)\s*(?:】|\])$/,
  );
  if (numberedMatch) {
    const theme = numberedMatch[1].trim();
    const index = Number.parseInt(numberedMatch[2], 10);
    if (!theme || !Number.isInteger(index) || index <= 0) return null;
    return { index, name: `${theme}｜提示词${index}`, wrapped };
  }

  const descriptiveMatch = line.match(
    /^(?:【|\[)\s*(.+?)\s*(?:｜|\|)\s*(.+?)\s*(?:】|\])$/,
  );
  if (descriptiveMatch) {
    const title = descriptiveMatch[1].trim();
    const description = descriptiveMatch[2].trim();
    if (!title || !description || /^提示词\s*/.test(description)) return null;
    return { index: null, name: `${title}｜${description}`, wrapped };
  }

  const singlePartMatch = line.match(/^(?:【|\[)\s*(.+?)\s*(?:】|\])$/);
  const title = singlePartMatch?.[1].trim() ?? "";
  return title && !/^(?:｜|\|)/.test(title)
    ? { index: null, name: title, wrapped }
    : null;
}

function looksLikeStandalonePromptHeader(value: string) {
  const line = stripMarkdownDecorators(value);
  return /提示词/.test(line)
    && /^(?:\(|（)?(?:【|\[).*?(?:】|\])(?:\)|）)?$/.test(line);
}

function unwrapBody(lines: string[], wrapped: ParsedHeader["wrapped"], index: number) {
  if (!wrapped) return lines;

  const closing = wrapped === "（" ? "）" : ")";
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last -= 1;
  if (last < 0 || !lines[last].trimEnd().endsWith(closing)) {
    throw new PromptSegmentParseError(
      "PROMPT_SEGMENT_WRAPPER_INVALID",
      `提示词${index}的外层括号未闭合`,
    );
  }

  const next = [...lines];
  next[last] = next[last].trimEnd().slice(0, -1);
  return next;
}

function parseTitlelessSegments(value: string): PromptSegmentV1[] {
  const content = value.trim();
  if (!content) {
    throw new PromptSegmentParseError(
      "PROMPT_SEGMENTS_NOT_FOUND",
      "未识别到非空提示词内容",
    );
  }

  const prompts = (/(?:^|\n)[ \t]*\n/.test(content)
    ? content.split(/\n[ \t]*\n+/)
    : content.split("\n"))
    .map((prompt) => prompt.trim())
    .filter(Boolean);

  if (prompts.length > IMAGE_BATCH_LIMITS.maxItems) {
    throw new PromptSegmentParseError(
      "PROMPT_SEGMENT_LIMIT",
      `最多允许 ${IMAGE_BATCH_LIMITS.maxItems} 段提示词`,
    );
  }

  return prompts.map((prompt, position) => ({
    index: position + 1,
    name: `分段 ${position + 1}`,
    prompt,
  }));
}

export function parsePromptSegmentsV1(value: unknown): PromptSegmentV1[] {
  const normalized = stripOuterCodeFence(
    String(value ?? "").replace(/^\ufeff/, "").replace(/\r\n?/g, "\n"),
  );
  const lines = normalized.split("\n");
  const headers: Array<{ line: number; value: ParsedHeader }> = [];

  lines.forEach((line, lineIndex) => {
    const header = parseHeaderLine(line);
    if (header) {
      headers.push({ line: lineIndex, value: header });
      return;
    }
    if (looksLikeStandalonePromptHeader(line)) {
      throw new PromptSegmentParseError(
        "PROMPT_SEGMENT_HEADER_INVALID",
        `第${lineIndex + 1}行的提示词标题格式不正确`,
      );
    }
  });

  if (!headers.length) {
    return parseTitlelessSegments(normalized);
  }
  if (lines.slice(0, headers[0].line).some((line) => line.trim())) {
    throw new PromptSegmentParseError(
      "PROMPT_SEGMENT_PREAMBLE",
      "第一个提示词标题前存在无法识别的内容",
    );
  }
  if (headers.length > IMAGE_BATCH_LIMITS.maxItems) {
    throw new PromptSegmentParseError(
      "PROMPT_SEGMENT_LIMIT",
      `最多允许 ${IMAGE_BATCH_LIMITS.maxItems} 段提示词`,
    );
  }

  return headers.map((header, position) => {
    const expectedIndex = position + 1;
    if (header.value.index !== null && header.value.index !== expectedIndex) {
      throw new PromptSegmentParseError(
        "PROMPT_SEGMENT_SEQUENCE",
        `提示词序号必须连续，当前位置应为提示词${expectedIndex}`,
      );
    }

    const nextLine = headers[position + 1]?.line ?? lines.length;
    const bodyLines = unwrapBody(
      lines.slice(header.line + 1, nextLine),
      header.value.wrapped,
      expectedIndex,
    );
    const prompt = bodyLines.join("\n").trim();
    if (!prompt) {
      throw new PromptSegmentParseError(
        "PROMPT_SEGMENT_BODY_EMPTY",
        `提示词${expectedIndex}正文为空`,
      );
    }

    return {
      index: expectedIndex,
      name: header.value.name,
      prompt,
    };
  });
}
