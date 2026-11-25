import { CreativeAgentError } from "../errors";
import type { ResolvedReference } from "../media-capabilities";

const LABEL = { image: "图片", video: "视频", audio: "音频" } as const;
type Kind = keyof typeof LABEL;
const ALIAS: Record<string, Kind> = { 图片: "image", 图: "image", 照片: "image", image: "image", img: "image", 视频: "video", video: "video", 音频: "audio", audio: "audio" };

/** 本次参考素材的 @ 编号：按 refs 顺序、按类型分别编号，与画布任务节点左侧的参考顺序一致 */
export function referenceTokens(references: readonly Pick<ResolvedReference, "kind">[]) {
  const counts: Record<Kind, number> = { image: 0, video: 0, audio: 0 };
  return references.map(reference => `${LABEL[reference.kind]}${++counts[reference.kind]}`);
}

/**
 * 统一提示词里引用素材的写法，画布上显示成素材标签，生成服务再按模型转换：
 * - “@图1”“@图 1”“@图片 1”“@image1”都写成 @图片1（视频、音频同理）
 * - 只有一张参考图却写成“原图”“参考图”的，改成 @图片1
 * - 有参考素材但一个 @ 都没写（如改图），在开头补“参考@图片1，”
 * - 编号超出本次参考素材数量时报错，让 Agent 改正后重试，不浪费一次生成
 */
export function normalizeReferenceTokens(prompt: string, references: readonly Pick<ResolvedReference, "kind">[], options: { prefix?: boolean } = {}) {
  const tokens = referenceTokens(references);
  let text = prompt.replace(/@\s*(图片|照片|图|视频|音频|image|img|video|audio)\s*(\d+)/gi, (_, kind: string, number: string) => `@${LABEL[ALIAS[kind.toLowerCase()]]}${Number(number)}`);
  const used = [...text.matchAll(/@(图片|视频|音频)(\d+)/g)];
  const counts = { 图片: 0, 视频: 0, 音频: 0 } as Record<string, number>;
  for (const token of tokens) counts[token.replace(/\d+$/, "")] += 1;
  const invalid = used.filter(([, label, number]) => Number(number) < 1 || Number(number) > counts[label]);
  if (invalid.length) {
    const available = tokens.length ? `本次参考素材是 ${tokens.map(token => `@${token}`).join("、")}` : "本次没有放参考素材（refs 为空）";
    throw new CreativeAgentError("REFERENCE_TOKEN_INVALID", `提示词里的 ${[...new Set(invalid.map(match => match[0]))].join("、")} 没有对应的素材：${available}。请按 refs 顺序改正编号，或把要引用的素材加进 refs`, 400);
  }
  if (!tokens.length) return text;
  if (!used.length && tokens.length === 1 && tokens[0] === "图片1") text = text.replace(/(原图片|原图|参考图片|参考图)/g, "@图片1");
  if (options.prefix && !/@(图片|视频|音频)\d+/.test(text)) text = `参考${tokens.map(token => `@${token}`).join("、")}，${text}`;
  return text;
}
