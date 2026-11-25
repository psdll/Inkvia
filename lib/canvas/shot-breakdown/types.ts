import { z } from "zod";

/**
 * Shot breakdown (拉片) result stored on a canvas `breakdown` node.
 *
 * Shot boundaries come from frame-accurate scene detection; the model only describes
 * what each detected shot shows. Every text field is optional so partial results can
 * be streamed onto the canvas while later analysis passes are still running.
 */
const text = z.string().max(4000).catch("").default("");

export const breakdownShotSchema = z.object({
  index: z.number().int().positive(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  /** Representative still extracted from inside the shot (not on the cut). */
  frameUrl: z.string().optional(),
  /** 画面描述：主体、动作、环境，按镜头内的先后顺序。 */
  description: text,
  /** 叙事内容：这一镜在全片里承担的作用。 */
  narrative: text,
  /** 景别 */
  shotSize: text,
  /** 摄影机角度 */
  angle: text,
  /** 摄影机运动 */
  movement: text,
  /** 焦距与景深 */
  lens: text,
  /** 调度、构图与焦点 */
  staging: text,
  /** 光线与色彩 */
  lighting: text,
  /** 背景音乐与音效 */
  sound: text,
  /** 台词、旁白与画面文字 */
  dialogue: text,
  /** 与下一镜的衔接方式 */
  transition: text,
  /** 复刻首帧用的图像生成提示词 */
  imagePrompt: text,
  /** 复刻本镜用的视频运动提示词 */
  motionPrompt: text,
});

export const breakdownRowSchema = z.object({ dimension: text, value: text });
export const breakdownSkeletonSchema = z.object({ dimension: text, construct: text, rule: text });
export const breakdownTechniqueSchema = z.object({ name: text, effect: text });
export const breakdownCharacterSchema = z.object({ name: text, role: text, appearance: text });

export const breakdownOverviewSchema = z.object({
  /** 创意命题：一句话说清这支片子讲了什么。 */
  logline: text,
  /** 体裁、用途、目标受众与平台。 */
  format: text,
  /** 视觉基因：媒介与美术风格、色彩、光线、材质与后期、构图、摄影机。 */
  visualDna: z.array(breakdownRowSchema).catch([]).default([]),
  recurringElements: z.array(z.string().max(400)).catch([]).default([]),
  /** 复刻时必须保留的要点。 */
  keepPoints: z.array(z.string().max(400)).catch([]).default([]),
  /** 创作骨架：维度 / 片中构造 / 可复用规律。 */
  skeleton: z.array(breakdownSkeletonSchema).catch([]).default([]),
  techniques: z.array(breakdownTechniqueSchema).catch([]).default([]),
  characters: z.array(breakdownCharacterSchema).catch([]).default([]),
  music: text,
  rhythm: text,
});

export const breakdownSegmentSchema = z.object({
  index: z.number().int().positive(),
  title: text,
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  shots: z.array(z.number().int().positive()).catch([]).default([]),
  /** 段落表达 */
  story: text,
  visual: text,
  editing: text,
  sound: text,
  /** 可直接用于多镜头视频生成的完整提示词。 */
  videoPrompt: text,
  /** 本段首帧的图像提示词。 */
  firstFramePrompt: text,
  /** 从原片切出的本段视频，放到画布上对照。 */
  clipUrl: z.string().max(500).optional(),
});

export const breakdownVideoSchema = z.object({
  duration: z.number().nonnegative(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
  fps: z.number().nonnegative().optional(),
  hasAudio: z.boolean().optional(),
});

export const BREAKDOWN_STAGES = ["queued", "probe", "scenes", "frames", "overview", "shots", "segments", "done"] as const;
export type BreakdownStage = typeof BREAKDOWN_STAGES[number];

export type BreakdownShot = z.infer<typeof breakdownShotSchema>;
export type BreakdownOverview = z.infer<typeof breakdownOverviewSchema>;
export type BreakdownSegment = z.infer<typeof breakdownSegmentSchema>;
export type BreakdownVideo = z.infer<typeof breakdownVideoSchema>;

/** Streamed from the server as newline-delimited JSON. */
export type BreakdownAudio = { soundtrack?: string; background?: string };

export type BreakdownEvent =
  | { type: "stage"; stage: BreakdownStage; progress: number; message: string }
  | { type: "video"; video: BreakdownVideo }
  | { type: "shots"; shots: BreakdownShot[] }
  | { type: "overview"; overview: BreakdownOverview }
  | { type: "segments"; segments: BreakdownSegment[] }
  | { type: "warning"; message: string }
  | { type: "done" }
  | { type: "error"; error: string }
  /** The film's soundtrack, and its music bed with voices removed when the local separator is installed. */
  | { type: "audio"; audio: BreakdownAudio }
  /** First event of a new run: the background job id a reopened page reconnects to. */
  | { type: "job"; jobId: string }
  /** Keeps proxies from closing the stream while a model thinks for minutes. */
  | { type: "ping" };

export const BREAKDOWN_STAGE_LABELS: Record<BreakdownStage, string> = {
  queued: "排队中",
  probe: "读取视频",
  scenes: "检测镜头切点",
  frames: "提取关键帧",
  overview: "全片拆解",
  shots: "逐镜拆解",
  segments: "生成复刻片段",
  done: "完成",
};
