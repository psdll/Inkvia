import { z } from "zod";
import {
  breakdownCharacterSchema,
  breakdownOverviewSchema,
  breakdownSegmentSchema,
  breakdownShotSchema,
  type BreakdownOverview,
  type BreakdownSegment,
  type BreakdownShot,
  type BreakdownVideo,
} from "./types";
import { formatBreakdownTime, type DetectedShot } from "./scenes";

/**
 * Prompts for the three analysis passes. Quality rules live here, in one place:
 * facts the viewer can see or hear, professional vocabulary, no filler, and output
 * that can be pasted straight into image or video generation.
 */
export const BREAKDOWN_SYSTEM_PROMPT = `你是一位资深的影视导演、摄影指导和剪辑师，长期为广告、短剧、电商短视频做拉片（逐镜头拆解）和复刻。你的拆解会被创作者直接拿去复刻成片，所以必须专业、具体、可执行。

硬性要求：
1. 只写视频里真实可见、可听的内容。看不清或无法判断时写"无法判断"，绝不编造品牌、台词、人物身份或剧情。
2. 禁止空话和套话，例如"画面精美""氛围感强""高级感""视觉冲击力强"。每一句都要落到可执行的细节：具体颜色、材质、方位（画面左/右/前景/背景）、动作方向与速度、光源方向、景别、焦段与景深。
3. 画面中出现的文字（字幕、标语、包装、界面）用引号原样转写，保留中英文与大小写。
4. 同一人物在全片使用同一个称呼，首次出现时写清外观锚点（性别、年龄段、发型发色、服装颜色与款式、显著特征）。
5. 镜头边界、镜号和时间码以系统给出的检测结果为准，不得合并、拆分或改写时间。
6. 使用标准术语：
   景别：大远景、远景、全景、中全景、中景、中近景、近景、特写、大特写；
   机位角度：平视、俯拍、仰拍、顶拍、低机位、高机位、过肩、主观视角、荷兰角；
   摄影机运动：固定、推、拉、摇、移、跟、升、降、环绕、手持、稳定器跟随、变焦、甩镜，可组合并写明方向和速度。
7. 只输出一个合法 JSON 对象，不要输出 JSON 以外的任何文字或解释。`;

function shotTable(shots: readonly Pick<DetectedShot, "index" | "start" | "end">[]) {
  return shots.map(shot => `镜头${shot.index}：${formatBreakdownTime(shot.start)}–${formatBreakdownTime(shot.end)}（${(shot.end - shot.start).toFixed(1)}秒）`).join("\n");
}

function videoLine(video: BreakdownVideo) {
  const size = video.width && video.height ? `，${video.width}×${video.height}（${video.width >= video.height ? "横屏" : "竖屏"}）` : "";
  return `视频总长 ${video.duration.toFixed(1)} 秒${size}${video.hasAudio === false ? "，无音轨" : ""}。`;
}

/** Timestamped speech from ASR; the vision model cannot hear, so this is the source of truth for dialogue. */
export type BreakdownSpeech = { lines: readonly { start: number; end: number; text: string }[]; note?: string };

export function speechBlock(speech: BreakdownSpeech | undefined, range?: { start: number; end: number }, limit = 3000) {
  if (!speech) return "";
  const lines = speech.lines.filter(line => line.text && (!range || (line.end > range.start && line.start < range.end)));
  if (!lines.length) {
    if (speech.note) return `\n声音说明：本次拿不到人声的文字内容。台词字段只写画面里的字幕/文字原文；有人在说话但内容未知时写"有人声，内容未识别"，不要编造台词，也不要提及识别、音频获取等技术过程。\n`;
    return range ? "\n语音识别：这段时间内没有人声台词。\n" : "\n语音识别：全片没有识别到人声台词（可能是纯音乐或音效）。\n";
  }
  let text = "";
  for (const line of lines) {
    const next = `[${formatBreakdownTime(line.start)}–${formatBreakdownTime(line.end)}] ${line.text}\n`;
    if (text.length + next.length > limit) break;
    text += next;
  }
  return `\n语音识别得到的台词/旁白（原片时间，逐字原文，以此为准；按时间归属到对应镜头）：\n${text}`;
}

export type BreakdownCast = readonly { name: string; role: string; appearance: string }[];

function castLines(cast: BreakdownCast | undefined) {
  return cast?.filter(item => item.name).map(item => `- ${item.name}${item.role ? `（${item.role}）` : ""}：${item.appearance}`).join("\n") ?? "";
}

/**
 * A few seconds of light work before the deep passes: fix who is called what and how
 * shots group into segments, so the overview and every shot batch can run at once and
 * still use the same names.
 */
export function buildCastPrompt(video: BreakdownVideo, shots: readonly DetectedShot[], speech?: BreakdownSpeech) {
  return `下面按镜号附上视频每个镜头的一张关键帧。请先确定两件事，后续的全片拆解和逐镜拆解都会沿用。
${videoLine(video)}
镜头列表：
${shotTable(shots)}
${speechBlock(speech, undefined, 1500)}
输出 JSON：
{
  "characters": [{"name": "统一称呼，如 新娘、新郎、女主、产品", "role": "在片中的身份或作用", "appearance": "外观锚点：性别、年龄段、发型发色、服装颜色与款式、显著特征"}],
  "segments": [{"index": 1, "title": "片段标题（8字以内）", "shots": [1, 2]}]
}

规则：
- characters 覆盖所有反复出现的人物和核心产品/道具，同一人只给一个称呼；没有人物时只写产品或主体。
- segments 按叙事节拍把连续镜头分组，每段 1-6 个镜头，单段总时长不超过 15 秒；覆盖全部镜头，镜号连续、不重复、不遗漏。`;
}

const castResultSchema = z.object({
  characters: z.array(breakdownCharacterSchema).catch([]).default([]),
  segments: z.array(z.object({
    index: z.coerce.number().int().positive().catch(0),
    title: z.string().catch("").default(""),
    shots: z.array(z.coerce.number().int().positive()).catch([]).default([]),
  })).catch([]).default([]),
});

export function readCastResult(value: unknown) {
  return castResultSchema.parse(value);
}

export function buildOverviewPrompt(video: BreakdownVideo, shots: readonly DetectedShot[], speech?: BreakdownSpeech, cast?: BreakdownCast) {
  return `请先完整观看视频，并对照后面按镜号标注的关键帧，完成"全片创作拆解"和"复刻片段规划"。
${videoLine(video)}
已用逐帧场景检测得到 ${shots.length} 个镜头：
${shotTable(shots)}
${speechBlock(speech)}${cast?.length ? `\n人物与主体称呼已确定（characters 必须沿用这些称呼，可补充外观细节）：\n${castLines(cast)}\n` : ""}
输出 JSON 结构（字段名必须一致）：
{
  "overview": {
    "logline": "创意命题：一句话说清这支片子讲了什么、靠什么打动人（40-80字）",
    "format": "体裁与用途、目标受众、投放平台与画幅时长的判断",
    "visualDna": [
      {"dimension": "媒介与美术风格", "value": "..."},
      {"dimension": "色彩体系", "value": "主色、辅色、点缀色与冷暖对比，写出具体颜色"},
      {"dimension": "光线体系", "value": "主光/辅光/轮廓光的方向、软硬与色温"},
      {"dimension": "材质与后期", "value": "质感、颗粒、调色、特效、字幕包装"},
      {"dimension": "构图体系", "value": "常用构图与主体位置"},
      {"dimension": "摄影机体系", "value": "常用景别、角度、运动与焦段倾向"},
      {"dimension": "剪辑节奏", "value": "平均镜头时长、切点规律、转场方式"},
      {"dimension": "声音设计", "value": "音乐风格与节拍、音效、人声的使用方式"}
    ],
    "recurringElements": ["反复出现的画面元素或母题，3-6条"],
    "keepPoints": ["复刻时必须保留的要点，4-8条，每条是可检查的约束"],
    "skeleton": [
      {"dimension": "开场钩子", "construct": "片中具体怎么做（带时间码）", "rule": "可复用规律"},
      {"dimension": "叙事结构", "construct": "...", "rule": "..."},
      {"dimension": "镜头语言与时空关系", "construct": "...", "rule": "..."},
      {"dimension": "影像与声音", "construct": "...", "rule": "..."},
      {"dimension": "卖点或情绪的递进", "construct": "...", "rule": "..."},
      {"dimension": "结尾与转化", "construct": "...", "rule": "..."}
    ],
    "techniques": [{"name": "01 · 手法名称", "effect": "在片中的具体位置（时间码）与作用"}],
    "characters": [{"name": "统一称呼，如 女主、男顾客、产品", "role": "在片中的身份或作用", "appearance": "外观锚点，复刻时保持一致所需的全部特征"}],
    "music": "背景音乐的风格、乐器、节拍与情绪走向；无音乐写无",
    "rhythm": "全片节奏曲线：哪里快、哪里慢、高潮在哪里"
  }${cast?.length ? "" : `,
  "segments": [
    {"index": 1, "title": "片段标题（8字以内）", "shots": [1, 2]}
  ]`}
}

${cast?.length ? "\n- characters 至少包含片中主要人物和核心产品/道具。" : `
复刻片段规划规则：
- 按叙事节拍把连续镜头分组，每段 1-6 个镜头，单段总时长不超过 15 秒（便于多镜头视频模型一次生成）。
- 覆盖全部镜头，镜号连续、不重复、不遗漏。
- characters 至少包含片中主要人物和核心产品/道具；没有人物时只写产品或主体。`}`;
}

/**
 * The overview split in two focused passes that run side by side at the same thinking
 * level: story and structure, and look and sound. Each is half the work of one pass.
 */
export type OverviewPart = "story" | "look";
const OVERVIEW_PART_FIELDS: Record<OverviewPart, { task: string; fields: string }> = {
  story: { task: "创意命题、体裁用途、创作骨架、核心手法、复刻要点和节奏", fields: `    "logline": "创意命题：一句话说清这支片子讲了什么、靠什么打动人（40-80字）",
    "format": "体裁与用途、目标受众、投放平台与画幅时长的判断",
    "skeleton": [
      {"dimension": "开场钩子", "construct": "片中具体怎么做（带时间码）", "rule": "可复用规律"},
      {"dimension": "叙事结构", "construct": "...", "rule": "..."},
      {"dimension": "镜头语言与时空关系", "construct": "...", "rule": "..."},
      {"dimension": "影像与声音", "construct": "...", "rule": "..."},
      {"dimension": "卖点或情绪的递进", "construct": "...", "rule": "..."},
      {"dimension": "结尾与转化", "construct": "...", "rule": "..."}
    ],
    "techniques": [{"name": "01 · 手法名称", "effect": "在片中的具体位置（时间码）与作用"}],
    "keepPoints": ["复刻时必须保留的要点，4-8条，每条是可检查的约束"],
    "rhythm": "全片节奏曲线：哪里快、哪里慢、高潮在哪里"` },
  look: { task: "视觉基因、反复出现的画面元素、人物与主体外观、音乐", fields: `    "visualDna": [
      {"dimension": "媒介与美术风格", "value": "..."},
      {"dimension": "色彩体系", "value": "主色、辅色、点缀色与冷暖对比，写出具体颜色"},
      {"dimension": "光线体系", "value": "主光/辅光/轮廓光的方向、软硬与色温"},
      {"dimension": "材质与后期", "value": "质感、颗粒、调色、特效、字幕包装"},
      {"dimension": "构图体系", "value": "常用构图与主体位置"},
      {"dimension": "摄影机体系", "value": "常用景别、角度、运动与焦段倾向"},
      {"dimension": "剪辑节奏", "value": "平均镜头时长、切点规律、转场方式"},
      {"dimension": "声音设计", "value": "音乐风格与节拍、音效、人声的使用方式"}
    ],
    "recurringElements": ["反复出现的画面元素或母题，3-6条"],
    "characters": [{"name": "统一称呼，如 女主、男顾客、产品", "role": "在片中的身份或作用", "appearance": "外观锚点，复刻时保持一致所需的全部特征"}],
    "music": "背景音乐的风格、乐器、节拍与情绪走向；无音乐写无"` },
};

export function buildOverviewPartPrompt(part: OverviewPart, video: BreakdownVideo, shots: readonly DetectedShot[], speech: BreakdownSpeech | undefined, cast: BreakdownCast) {
  const { task, fields } = OVERVIEW_PART_FIELDS[part];
  return `请先完整观看视频，并对照后面按镜号标注的关键帧，做"全片创作拆解"中的这一部分：${task}。
${videoLine(video)}
已用逐帧场景检测得到 ${shots.length} 个镜头：
${shotTable(shots)}
${speechBlock(speech)}${cast.length ? `\n人物与主体称呼已确定（必须沿用这些称呼${part === "look" ? "，characters 可补充外观细节" : ""}）：\n${castLines(cast)}\n` : ""}
输出 JSON 结构（字段名必须一致，只输出这些字段）：
{
  "overview": {
${fields}
  }
}`;
}

export function buildShotsPrompt(video: BreakdownVideo, shots: readonly DetectedShot[], characters?: BreakdownCast, clip?: { start: number; end: number }, speech?: BreakdownSpeech) {
  const cast = castLines(characters);
  const clipLine = clip
    ? `\n附带的视频只是原片 ${formatBreakdownTime(clip.start)}–${formatBreakdownTime(clip.end)} 的片段：片段内的 0 秒对应原片 ${formatBreakdownTime(clip.start)}。下表时间均为原片时间，括号内是在片段中的位置。`
    : "";
  const table = clip
    ? shots.map(shot => `镜头${shot.index}：${formatBreakdownTime(shot.start)}–${formatBreakdownTime(shot.end)}（${(shot.end - shot.start).toFixed(1)}秒；片段内 ${formatBreakdownTime(shot.start - clip.start)}–${formatBreakdownTime(shot.end - clip.start)}）`).join("\n")
    : shotTable(shots);
  return `请观看视频，逐镜头拆解下面这些镜头。每个镜头后面附有一张该镜头内部的关键帧，用来对照细节；运动、节奏和声音以视频为准。
${videoLine(video)}${clipLine}
本次只拆解这些镜头：
${table}
${cast ? `\n人物与主体称呼（必须沿用）：\n${cast}\n` : ""}${speechBlock(speech, shots.length ? { start: shots[0].start, end: shots[shots.length - 1].end } : undefined, 1500)}
输出 JSON 结构：
{
  "shots": [
    {
      "index": 镜号（数字，与上表一致）,
      "description": "画面描述：主体是谁、在哪里、做了什么，按镜头内时间顺序写，包含可见文字的原文（60-150字）",
      "narrative": "叙事内容：这一镜在全片里的作用（交代、卖点、情绪、转折、行动号召等）",
      "shotSize": "景别（标准术语，镜头内变化写成 中景→特写）",
      "angle": "摄影机角度",
      "movement": "摄影机运动，写明方向与速度，如 缓慢推近、从左向右平移",
      "lens": "焦距与景深，如 长焦压缩/浅景深背景虚化",
      "staging": "调度、构图与焦点：主体在画面中的位置与运动轨迹、前后景层次、焦点落点与转移",
      "lighting": "光线与色彩：主光方向和软硬、色温、主色调",
      "sound": "背景音乐与音效（这一镜里能听到的）",
      "dialogue": "这一镜里的台词/旁白（有语音识别时逐字照抄，标明说话人）与画面文字原文，没有写 无",
      "transition": "与下一镜的衔接：硬切、匹配剪辑、叠化、闪白、甩镜等；最后一镜写 结束",
      "imagePrompt": "复刻这一镜首帧的图像生成提示词：主体与外观锚点、动作姿态、场景与道具、构图与景别、机位角度、光线色彩、材质与画质，80-160字，可直接用于生图",
      "motionPrompt": "复刻这一镜的视频运动提示词：主体动作、摄影机运动、节奏与时长，40-100字，可直接用于图生视频"
    }
  ]
}

要求：shots 必须按镜号包含上表全部 ${shots.length} 个镜头，一个都不能少。`;
}

export function buildSegmentsPrompt(input: {
  video: BreakdownVideo;
  overview?: BreakdownOverview;
  plan: readonly { index: number; title: string; shots: number[] }[];
  shots: readonly BreakdownShot[];
}) {
  const byIndex = new Map(input.shots.map(shot => [shot.index, shot]));
  const plan = input.plan.map(segment => {
    const items = segment.shots.map(index => byIndex.get(index)).filter((shot): shot is BreakdownShot => Boolean(shot));
    const start = items[0]?.start ?? 0;
    const end = items.at(-1)?.end ?? start;
    const lines = items.map(shot => `  镜头${shot.index}（${formatBreakdownTime(shot.start)}–${formatBreakdownTime(shot.end)}，${(shot.end - shot.start).toFixed(1)}秒）${shot.shotSize}｜${shot.angle}｜${shot.movement}｜${shot.description}｜声音：${shot.sound}｜台词：${shot.dialogue}`).join("\n");
    return `片段${segment.index}「${segment.title}」${formatBreakdownTime(start)}–${formatBreakdownTime(end)}（约${(end - start).toFixed(1)}秒）\n${lines}`;
  }).join("\n\n");
  const overview = input.overview;
  return `下面是一支视频的全片拆解和逐镜拆解。请为每个复刻片段写出"段落表达"和可直接用于多镜头视频生成的提示词。
${videoLine(input.video)}
创意命题：${overview?.logline || "无"}
视觉基因：${overview?.visualDna.map(item => `${item.dimension}：${item.value}`).join("；") || "无"}
人物与主体：${overview?.characters.map(item => `${item.name}（${item.appearance}）`).join("；") || "无"}
复刻要点：${overview?.keepPoints.join("；") || "无"}

${plan}

输出 JSON 结构：
{
  "segments": [
    {
      "index": 片段序号,
      "story": "叙事要素：这一段交代了什么、推进了什么",
      "visual": "本段视觉变化：景别、光影、色彩、构图如何变化",
      "editing": "剪辑与节奏：镜头时长、切点、与音乐节拍的关系",
      "sound": "声音设计：音乐、音效、人声",
      "videoPrompt": "多镜头视频生成提示词，严格按以下八个小节书写，每节一段：\\n【成片规格】时长、画幅、风格与质感\\n【主体一致性】人物与产品的外观锚点\\n【场景与美术】场景、道具、陈设\\n【镜头序列】1.（0-X秒）景别，机位与运动，画面内容；2.（X-Y秒）……（时间从本段开头 0 秒起算）\\n【摄影机与构图】\\n【光色与材质】\\n【节奏与声音】\\n【生成约束】必须出现/必须避免的内容",
      "firstFramePrompt": "本段第一帧的图像生成提示词，80-160字"
    }
  ]
}

要求：覆盖全部 ${input.plan.length} 个片段；镜头序列的分镜数量、景别和运动必须与逐镜拆解一致，时长按实际镜头时长分配。`;
}

/** Extracts the first JSON object from model output (fenced or bare, tolerant of trailing commas). */
export function parseBreakdownJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const source = (fenced ?? text).trim();
  const start = source.indexOf("{");
  if (start < 0) throw new Error("模型没有返回 JSON");
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error("模型返回的 JSON 不完整，可能输出被截断");
  const body = source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(body); }
  catch { throw new Error("模型返回的 JSON 无法解析"); }
}

const overviewResultSchema = z.object({
  overview: breakdownOverviewSchema.catch(breakdownOverviewSchema.parse({})),
  segments: z.array(z.object({
    index: z.coerce.number().int().positive().catch(0),
    title: z.string().catch("").default(""),
    shots: z.array(z.coerce.number().int().positive()).catch([]).default([]),
  })).catch([]).default([]),
});

export function readOverviewResult(value: unknown) {
  return overviewResultSchema.parse(value);
}

/**
 * Keeps the model's segment plan only when it is a clean partition of the shots;
 * otherwise falls back to consecutive groups that stay within the duration budget.
 */
export function normalizeSegmentPlan(
  plan: readonly { index: number; title: string; shots: number[] }[],
  shots: readonly Pick<DetectedShot, "index" | "start" | "end">[],
  maxSeconds = 15,
) {
  const expected = shots.map(shot => shot.index);
  const flat = plan.flatMap(segment => segment.shots);
  const byIndex = new Map(shots.map(shot => [shot.index, shot]));
  const contiguous = plan.every(segment => segment.shots.length > 0 && segment.shots.every((value, i) => i === 0 || value === segment.shots[i - 1] + 1));
  const withinBudget = plan.every(segment => {
    const first = byIndex.get(segment.shots[0]);
    const last = byIndex.get(segment.shots[segment.shots.length - 1]);
    // A single long take cannot be split further, so it is always its own segment.
    return first && last && (segment.shots.length === 1 || last.end - first.start <= maxSeconds + 0.5);
  });
  if (flat.length === expected.length && flat.every((value, i) => value === expected[i]) && contiguous && withinBudget) {
    return plan.map((segment, i) => ({ index: i + 1, title: segment.title.trim() || `片段${i + 1}`, shots: [...segment.shots] }));
  }
  const groups: { index: number; title: string; shots: number[] }[] = [];
  let current: number[] = [];
  let currentStart = 0;
  for (const shot of shots) {
    if (current.length && (shot.end - currentStart > maxSeconds || current.length >= 6)) {
      groups.push({ index: groups.length + 1, title: `片段${groups.length + 1}`, shots: current });
      current = [];
    }
    if (!current.length) currentStart = shot.start;
    current.push(shot.index);
  }
  if (current.length) groups.push({ index: groups.length + 1, title: `片段${groups.length + 1}`, shots: current });
  return groups;
}

const shotResultSchema = z.object({
  shots: z.array(z.record(z.unknown())).catch([]).default([]),
});

/** Merges model fields onto detected shots; timing and frames always come from detection. */
export function mergeShotResults(detected: readonly BreakdownShot[], value: unknown): { shots: BreakdownShot[]; missing: number[] } {
  const rows = shotResultSchema.parse(value).shots;
  const byIndex = new Map<number, Record<string, unknown>>();
  rows.forEach((row, position) => {
    const index = Number(row.index);
    byIndex.set(Number.isInteger(index) && index > 0 ? index : detected[position]?.index ?? -1, row);
  });
  const missing: number[] = [];
  const shots = detected.map(shot => {
    const row = byIndex.get(shot.index);
    if (!row) { missing.push(shot.index); return shot; }
    const parsed = breakdownShotSchema.parse({ ...row, index: shot.index, start: shot.start, end: shot.end, frameUrl: shot.frameUrl });
    return parsed;
  });
  return { shots, missing };
}

const segmentResultSchema = z.object({
  segments: z.array(z.record(z.unknown())).catch([]).default([]),
});

export function mergeSegmentResults(
  plan: readonly { index: number; title: string; shots: number[] }[],
  shots: readonly BreakdownShot[],
  value: unknown,
): BreakdownSegment[] {
  const rows = segmentResultSchema.parse(value).segments;
  const byIndex = new Map(rows.map((row, position) => [Number(row.index) || position + 1, row]));
  const shotByIndex = new Map(shots.map(shot => [shot.index, shot]));
  return plan.map(segment => {
    const first = shotByIndex.get(segment.shots[0]);
    const last = shotByIndex.get(segment.shots[segment.shots.length - 1]);
    return breakdownSegmentSchema.parse({
      ...(byIndex.get(segment.index) ?? {}),
      index: segment.index,
      title: segment.title,
      shots: segment.shots,
      start: first?.start ?? 0,
      end: last?.end ?? first?.start ?? 0,
    });
  });
}
