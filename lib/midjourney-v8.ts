export const MIDJOURNEY_V8_MODEL_ID = "midjourney-v8-reapi";
export const APIMART_MIDJOURNEY_V8_MODEL_ID = "midjourney-v8-apimart";
export const APIMART_MIDJOURNEY_V8_MODEL_LABEL = "Midjourney";
export const MIDJOURNEY_V8_MODEL_LABEL = "Midjourney-V8.2";
export const MIDJOURNEY_V8_UPSTREAM_MODEL = "midjourney";
export const MIDJOURNEY_V8_VERSION = "8.2";
export const MIDJOURNEY_V8_OUTPUT_COUNT = 4;
export const MIDJOURNEY_V8_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "2:1",
  "1:2",
  "21:9",
  "9:21",
] as const;
export const MIDJOURNEY_V8_SPEEDS = ["relax", "fast", "turbo"] as const;

export type MidjourneyV8Speed = (typeof MIDJOURNEY_V8_SPEEDS)[number];

export function isMidjourneyV8Model(model: unknown): boolean {
  const id = String(model ?? "").trim();
  return id === MIDJOURNEY_V8_MODEL_ID || id === APIMART_MIDJOURNEY_V8_MODEL_ID;
}

export function normalizeMidjourneyV8Ratio(value: unknown): string {
  const ratio = String(value ?? "").trim();
  return (MIDJOURNEY_V8_RATIOS as readonly string[]).includes(ratio) ? ratio : "1:1";
}

export function normalizeMidjourneyV8Speed(value: unknown): MidjourneyV8Speed {
  const speed = String(value ?? "").trim().toLowerCase();
  return (MIDJOURNEY_V8_SPEEDS as readonly string[]).includes(speed)
    ? speed as MidjourneyV8Speed
    : "relax";
}

/** Midjourney V8.2 的进阶参数，对应 APIMart imagine / edits 的结构化字段。 */
export const MIDJOURNEY_V8_QUALITIES = ["0.25", "0.5", "1", "2"] as const;
export type MidjourneyV8Quality = (typeof MIDJOURNEY_V8_QUALITIES)[number];

/** APIMart 支持的 Midjourney 版本（价格各版本相同）。Niji 走 version 7/6 + niji: true。 */
export const MIDJOURNEY_VERSIONS = [
  { value: "8.2", label: "V8.2", strength: "当前最新版，画面更大胆有质感，写实照片和细节最强，适合大多数场景", note: "可用 HD 高清、改写原图；没有质量和极速选项" },
  { value: "8.1", label: "V8.1", strength: "出图最快的一版，忠实还原提示词里的细节，想要“按字面画”时选它", note: "可用 HD 高清、改写原图；没有质量和极速选项" },
  { value: "7", label: "V7", strength: "经典通用版，纹理丰富，人体、手部更自然，适合海报、概念图", note: "可用草稿模式、质量 1/2、极速；参考图只能垫图或借风格" },
  { value: "niji 7", label: "Niji 7", strength: "动漫插画最新版，眼睛和细节更清晰，线条干净、画面偏平涂", note: "可用质量 1/2、极速；参考图只能垫图或借风格" },
  { value: "niji 6", label: "Niji 6", strength: "上一代动漫模型，氛围感更强，宽泛的描述也能出好图", note: "可用质量 0.5/1/2、极速；唯一支持角色参考 --cref 和 --stop" },
] as const;
export type MidjourneyVersion = (typeof MIDJOURNEY_VERSIONS)[number]["value"];
export const DEFAULT_MIDJOURNEY_VERSION: MidjourneyVersion = "8.2";

export function normalizeMidjourneyVersion(value: unknown): MidjourneyVersion | undefined {
  const text = String(value ?? "").trim().toLowerCase().replace(/^v/, "").replace(/^niji\s*/, "niji ");
  return MIDJOURNEY_VERSIONS.find(version => version.value === text)?.value;
}

export function midjourneyVersionLabel(version: unknown) {
  return MIDJOURNEY_VERSIONS.find(item => item.value === normalizeMidjourneyVersion(version))?.label ?? "V8.2";
}

/**
 * 各版本支持的能力，按 Midjourney 官方版本兼容表（docs.midjourney.com/Version）：
 * - HD、改写原图（Edit Model）：只有 V8.1 / V8.2；
 * - 质量 --q：V8.x 不支持，V7 系列 1/2（4 APIMart 不收），V6 系列 0.5/1/2；
 * - 草稿模式：只有 V7（APIMart 写的“v7+”与官方表不符，按官方）；
 * - 极速 turbo：V8.x 不支持；
 * - 角色参考 --cref 与 --stop：只有 V6 系列（Niji 6）。
 */
export function midjourneyVersionCapabilities(version: unknown) {
  const v = normalizeMidjourneyVersion(version) ?? DEFAULT_MIDJOURNEY_VERSION;
  const v8 = v === "8.2" || v === "8.1";
  const v6 = v === "niji 6";
  const qualities: readonly MidjourneyV8Quality[] = v8 ? [] : v6 ? ["0.5", "1", "2"] : ["1", "2"];
  return { hd: v8, edits: v8, draft: v === "7", turbo: !v8, qualities, cref: v6, stop: v6 };
}
export type MidjourneyV8ReferenceMode = "edits" | "imagine" | "style";
export type MidjourneyV8Options = {
  stylize?: number;
  chaos?: number;
  weird?: number;
  seed?: number;
  negativePrompt?: string;
  quality?: (typeof MIDJOURNEY_V8_QUALITIES)[number];
  raw?: boolean;
  hd?: boolean;
  draft?: boolean;
  tile?: boolean;
  sref?: string;
  sw?: number;
  iw?: number;
  /** 版本，默认 V8.2 */
  version?: MidjourneyVersion;
  /** 角色参考（仅 Niji 6） */
  cref?: string;
  cw?: number;
  stop?: number;
  /** 有参考图时：edits = 按提示词改写原图（默认，保持原有行为）；imagine = 垫图参考；style = 当作风格参考（sref）。 */
  referenceMode?: MidjourneyV8ReferenceMode;
  /** 原样追加到提示词末尾的其他 --参数。 */
  extra?: string;
};

const RANGES = {
  stylize: [0, 1000, "风格化 --stylize"],
  chaos: [0, 100, "多样性 --chaos"],
  weird: [0, 3000, "怪异度 --weird"],
  seed: [0, 4294967295, "种子 --seed"],
  sw: [0, 1000, "风格参考权重 --sw"],
  iw: [0, 3, "图片权重 --iw"],
  cw: [0, 100, "角色权重 --cw"],
  stop: [10, 100, "提前停止 --stop"],
} as const;

function rangeValue(key: keyof typeof RANGES, raw: unknown, errors: string[], integer = key !== "iw") {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  const [min, max, label] = RANGES[key];
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    errors.push(`${label} 需要是 ${min}–${max} 之间的${integer ? "整数" : "数字"}`);
    return undefined;
  }
  return value;
}

function normalizeQuality(raw: unknown, errors: string[]) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const text = String(raw).trim().replace(/^\./, "0.");
  const value = (MIDJOURNEY_V8_QUALITIES as readonly string[]).find(option => Number(option) === Number(text));
  if (!value) errors.push("质量 --quality 只能是 0.25、0.5、1 或 2");
  return value as MidjourneyV8Options["quality"];
}

/** 校验来自参数面板的进阶参数；非法值返回中文错误，未设置的字段不出现在结果里。 */
export function normalizeMidjourneyV8Options(input: unknown): { options: MidjourneyV8Options; errors: string[] } {
  const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const errors: string[] = [];
  const options: MidjourneyV8Options = {};
  for (const key of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
    const value = rangeValue(key, source[key], errors);
    if (value !== undefined) options[key] = value;
  }
  const quality = normalizeQuality(source.quality, errors);
  if (quality) options.quality = quality;
  for (const key of ["raw", "hd", "draft", "tile"] as const) if (source[key] === true) options[key] = true;
  const negative = String(source.negativePrompt ?? "").trim();
  if (negative) options.negativePrompt = negative;
  const sref = String(source.sref ?? "").trim();
  if (sref) {
    if (sref.split(/\s+/).some(url => !/^https?:\/\//i.test(url))) errors.push("风格参考 --sref 必须是公开 HTTP(S) 图片链接");
    else options.sref = sref;
  }
  const cref = String(source.cref ?? "").trim();
  if (cref) {
    if (cref.split(/\s+/).some(url => !/^https?:\/\//i.test(url))) errors.push("角色参考 --cref 必须是公开 HTTP(S) 图片链接");
    else options.cref = cref;
  }
  if (source.version !== undefined && source.version !== "") {
    const version = normalizeMidjourneyVersion(source.version);
    if (version) options.version = version;
    else errors.push(`不支持的 Midjourney 版本 ${String(source.version)}，可选：${MIDJOURNEY_VERSIONS.map(item => item.label).join("、")}`);
  }
  if (source.referenceMode === "imagine" || source.referenceMode === "edits" || source.referenceMode === "style") options.referenceMode = source.referenceMode;
  const extra = String(source.extra ?? "").trim();
  if (extra) options.extra = extra;
  return { options, errors };
}

/** “不要出现”里 Midjourney 会直接拒绝的词：不要衣服会被当成裸露要求（上游报 “--no 后不能有 clothes”）。 */
const BLOCKED_NEGATIVE_WORDS = /\b(clothes|clothing|clothed|unclothed|garments?)\b|衣服|衣物|服装/i;
/** “不要出现”里会被 Midjourney 当成裸露要求拒绝的词（没有则返回 undefined）。 */
export function midjourneyBlockedNegativeWord(text: string | undefined) {
  return text?.match(BLOCKED_NEGATIVE_WORDS)?.[0];
}

/** 合并面板和提示词之后、提交之前的最终校验：按版本检查参数，拦下上游必然拒绝的组合。 */
export function validateMidjourneyOptions(options: MidjourneyV8Options, speed?: MidjourneyV8Speed): string[] {
  const errors: string[] = [];
  const version = options.version ?? DEFAULT_MIDJOURNEY_VERSION;
  const label = midjourneyVersionLabel(version);
  const can = midjourneyVersionCapabilities(version);
  if (options.hd && !can.hd) errors.push(`${label} 不支持 HD 高清（只有 V8.1 / V8.2 支持）`);
  if (options.draft && !can.draft) errors.push(`${label} 不支持草稿模式（只有 V7 支持）`);
  if (speed === "turbo" && !can.turbo) errors.push(`${label} 不支持极速模式，请改用快速或慢速`);
  if (options.quality && !can.qualities.includes(options.quality)) errors.push(can.qualities.length
    ? `${label} 的质量只能选 ${can.qualities.join(" / ")}`
    : `${label} 不支持质量参数（--q），请去掉`);
  if ((options.cref || options.cw !== undefined) && !can.cref) errors.push(`${label} 不支持角色参考 --cref / --cw（只有 Niji 6 支持）`);
  if (options.stop !== undefined && !can.stop) errors.push(`${label} 不支持 --stop（只有 Niji 6 支持）`);
  const blocked = midjourneyBlockedNegativeWord(options.negativePrompt);
  if (blocked) errors.push(`“不要出现”（--no）里不能写「${blocked}」：Midjourney 会把“不要衣服”当成裸露要求直接拒绝。请删掉，或写成具体款式，例如 plain black shirt`);
  return errors;
}

/** V8.2 不支持、或会改变计费/出图数量的参数：提交前拦下并给出原因，避免白白失败。 */
const UNSUPPORTED_FLAGS: Record<string, string> = {
  oref: "当前接口不支持 --oref",
  ow: "当前接口不支持 --ow",
  repeat: "--repeat 会成倍扣费和出图，请改用多次生成",
  r: "--repeat 会成倍扣费和出图，请改用多次生成",
  video: "当前模型不支持 --video",
  motion: "当前模型不支持 --motion",
  test: "V8.2 不支持 --test",
  testp: "V8.2 不支持 --testp",
  creative: "V8.2 不支持 --creative",
  uplight: "V8.2 不支持 --uplight",
  upbeta: "V8.2 不支持 --upbeta",
  fast: "速度请在参数面板里选择，不要写 --fast",
  relax: "速度请在参数面板里选择，不要写 --relax",
  turbo: "速度请在参数面板里选择，不要写 --turbo",
};

const SINGLE_VALUE_FLAGS = new Set(["ar", "aspect", "s", "stylize", "c", "chaos", "w", "weird", "seed", "sameseed", "sw", "iw", "cw", "stop", "q", "quality", "style", "v", "version", "niji"]);
const BOOLEAN_FLAGS = new Set(["raw", "hd", "draft", "tile"]);

/**
 * 解析提示词里的 Midjourney --参数：识别的参数转成结构化字段并从提示词中移除，
 * 未识别的原样放进 extra 交给上游；V8.2 不支持的参数返回中文错误。
 * 参数只读到行尾或下一个 --参数为止，所以画布在提示词后面追加的说明段落不会被误当成参数值。
 */
export function parseMidjourneyV8PromptFlags(prompt: string): {
  prompt: string;
  size?: string;
  options: MidjourneyV8Options;
  errors: string[];
} {
  const text = String(prompt ?? "");
  if (!/(^|\s)--[a-zA-Z]/.test(text)) return { prompt: text.trim(), options: {}, errors: [] };
  const errors: string[] = [];
  const values: Record<string, unknown> = {};
  const extra: string[] = [];
  const negatives: string[] = [];
  let size: string | undefined;
  const handle = (name: string, value: string, raw: string) => {
    if (UNSUPPORTED_FLAGS[name]) { errors.push(UNSUPPORTED_FLAGS[name]); return; }
    switch (name) {
      case "ar": case "aspect":
        if (/^\d+:\d+$/.test(value)) size = value;
        else errors.push(`比例 --ar ${value} 格式不对，应写成 16:9 这样`);
        return;
      case "s": case "stylize": values.stylize = value; return;
      case "c": case "chaos": values.chaos = value; return;
      case "w": case "weird": values.weird = value; return;
      case "seed": case "sameseed": values.seed = value; return;
      case "sw": values.sw = value; return;
      case "iw": values.iw = value; return;
      case "q": case "quality": values.quality = value; return;
      case "no": if (value) negatives.push(value); return;
      case "raw": case "hd": case "draft": case "tile": values[name] = true; return;
      case "sref": values.sref = value; return;
      case "style":
        if (value.toLowerCase() === "raw") values.raw = true;
        else extra.push(raw);
        return;
      case "v": case "version": {
        const version = normalizeMidjourneyVersion(value === "8" ? "8.2" : value);
        if (version) values.version = version;
        else errors.push(`不支持 --v ${value}，可选版本：${MIDJOURNEY_VERSIONS.filter(item => !item.value.startsWith("niji")).map(item => item.value).join("、")}（Niji 用 --niji 7 / --niji 6）`);
        return;
      }
      case "niji": {
        const version = normalizeMidjourneyVersion(`niji ${value || "7"}`);
        if (version) values.version = version;
        else errors.push(`不支持 --niji ${value}，可选：--niji 7、--niji 6`);
        return;
      }
      case "cw": values.cw = value; return;
      case "stop": values.stop = value; return;
      case "cref": values.cref = value; return;
      default:
        extra.push(raw);
    }
  };
  const lines = text.split("\n").map(line => {
    const first = line.search(/(^|\s)--[a-zA-Z]/);
    if (first < 0) return line;
    const kept: string[] = [line.slice(0, first)];
    const segments = line.slice(first).trim().split(/\s+(?=--[a-zA-Z])/);
    for (const segment of segments) {
      const match = segment.match(/^--([a-zA-Z]+)\s*(.*)$/);
      if (!match) { kept.push(segment); continue; }
      const name = match[1].toLowerCase();
      const rest = match[2].trim();
      if (BOOLEAN_FLAGS.has(name)) {
        handle(name, "", `--${match[1]}`);
        if (rest) kept.push(rest);
      } else if (SINGLE_VALUE_FLAGS.has(name)) {
        const [value = "", ...after] = rest.split(/\s+/);
        handle(name, value, `--${match[1]} ${value}`.trim());
        if (after.length) kept.push(after.join(" "));
      } else if (name === "sref" || name === "cref") {
        const urls = rest.split(/\s+/).filter(token => /^https?:\/\//i.test(token));
        handle(name, urls.join(" ") || rest, segment);
        const after = rest.split(/\s+/).filter(token => token && !/^https?:\/\//i.test(token));
        if (urls.length && after.length) kept.push(after.join(" "));
      } else {
        handle(name, rest, segment);
      }
    }
    return kept.join(" ").replace(/\s+$/, "");
  });
  if (negatives.length) values.negativePrompt = negatives.join(", ");
  if (extra.length) values.extra = extra.join(" ");
  const normalized = normalizeMidjourneyV8Options(values);
  return {
    prompt: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    ...(size ? { size } : {}),
    options: normalized.options,
    errors: [...errors, ...normalized.errors],
  };
}

/** 提示词里写的参数优先于面板选项（用户明确写出来的意图）。 */
export function mergeMidjourneyV8Options(panel: MidjourneyV8Options, fromPrompt: MidjourneyV8Options): MidjourneyV8Options {
  const merged: MidjourneyV8Options = { ...panel, ...fromPrompt };
  if (panel.extra && fromPrompt.extra) merged.extra = `${panel.extra} ${fromPrompt.extra}`;
  if (panel.negativePrompt && fromPrompt.negativePrompt) merged.negativePrompt = `${panel.negativePrompt}, ${fromPrompt.negativePrompt}`;
  return merged;
}

