import type { CanvasBreakdownData } from "@/lib/canvas/document";
import { formatBreakdownTime } from "./scenes";
import type { BreakdownSegment, BreakdownShot } from "./types";

/** Column order shared by the expanded table, Markdown and CSV exports. */
export const BREAKDOWN_SHOT_COLUMNS: ReadonlyArray<{ key: keyof BreakdownShot | "time" | "duration"; label: string }> = [
  { key: "index", label: "镜号" },
  { key: "time", label: "时间码" },
  { key: "duration", label: "时长" },
  { key: "description", label: "画面描述" },
  { key: "narrative", label: "叙事内容" },
  { key: "shotSize", label: "景别" },
  { key: "angle", label: "摄影机角度" },
  { key: "movement", label: "摄影机运动" },
  { key: "lens", label: "焦距与景深" },
  { key: "staging", label: "调度、构图与焦点" },
  { key: "lighting", label: "光线与色彩" },
  { key: "sound", label: "背景音乐与音效" },
  { key: "dialogue", label: "台词/旁白/字幕" },
  { key: "transition", label: "转场" },
  { key: "imagePrompt", label: "首帧图像提示词" },
  { key: "motionPrompt", label: "视频运动提示词" },
];

export function breakdownShotCell(shot: BreakdownShot, key: (typeof BREAKDOWN_SHOT_COLUMNS)[number]["key"]): string {
  if (key === "time") return `${formatBreakdownTime(shot.start)}–${formatBreakdownTime(shot.end)}`;
  if (key === "duration") return `${(shot.end - shot.start).toFixed(1)}s`;
  const value = shot[key];
  return value === undefined || value === null ? "" : String(value);
}

/** Prompt bundle for one shot: what a creator pastes into an image or video tool. */
export function breakdownShotPrompt(shot: BreakdownShot) {
  return [shot.imagePrompt && `首帧：${shot.imagePrompt}`, shot.motionPrompt && `运动：${shot.motionPrompt}`].filter(Boolean).join("\n") || shot.description;
}

function markdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function buildBreakdownMarkdown(data: CanvasBreakdownData) {
  const lines: string[] = [`# ${data.title || "拉片"}`, ""];
  if (data.video) {
    const size = data.video.width && data.video.height ? ` · ${data.video.width}×${data.video.height}` : "";
    lines.push(`时长 ${data.video.duration.toFixed(1)} 秒${size} · ${data.shots.length} 个镜头 · ${data.segments.length} 个复刻片段${data.model ? ` · 模型 ${data.model}` : ""}`, "");
  }
  const overview = data.overview;
  if (overview) {
    lines.push("## 全片创作拆解", "");
    if (overview.logline) lines.push(`**创意命题**：${overview.logline}`, "");
    if (overview.format) lines.push(`**体裁与用途**：${overview.format}`, "");
    if (overview.visualDna.length) {
      lines.push("### 视觉基因", "", "| 维度 | 全片特征 |", "| --- | --- |");
      overview.visualDna.forEach(row => lines.push(`| ${markdownCell(row.dimension)} | ${markdownCell(row.value)} |`));
      lines.push("");
    }
    if (overview.recurringElements.length) lines.push("### 反复出现的画面元素", "", ...overview.recurringElements.map(item => `- ${item}`), "");
    if (overview.keepPoints.length) lines.push("### 复刻时要保留的要点", "", ...overview.keepPoints.map(item => `- ${item}`), "");
    if (overview.skeleton.length) {
      lines.push("### 创作骨架", "", "| 维度 | 片中构造 | 可复用规律 |", "| --- | --- | --- |");
      overview.skeleton.forEach(row => lines.push(`| ${markdownCell(row.dimension)} | ${markdownCell(row.construct)} | ${markdownCell(row.rule)} |`));
      lines.push("");
    }
    if (overview.techniques.length) lines.push("### 核心创作手法", "", ...overview.techniques.map(item => `- **${item.name}**：${item.effect}`), "");
    if (overview.characters.length) lines.push("### 人物与主体", "", ...overview.characters.map(item => `- **${item.name}**（${item.role}）：${item.appearance}`), "");
    if (overview.music) lines.push(`**音乐**：${overview.music}`, "");
    if (overview.rhythm) lines.push(`**节奏**：${overview.rhythm}`, "");
  }
  if (data.shots.length) {
    lines.push("## 分镜表", "", `| ${BREAKDOWN_SHOT_COLUMNS.map(column => column.label).join(" | ")} |`, `| ${BREAKDOWN_SHOT_COLUMNS.map(() => "---").join(" | ")} |`);
    data.shots.forEach(shot => lines.push(`| ${BREAKDOWN_SHOT_COLUMNS.map(column => markdownCell(breakdownShotCell(shot, column.key))).join(" | ")} |`));
    lines.push("");
  }
  if (data.segments.length) {
    lines.push("## 复刻片段", "");
    for (const segment of data.segments) {
      lines.push(`### 片段${segment.index} ${segment.title}（${formatBreakdownTime(segment.start)}–${formatBreakdownTime(segment.end)}，镜头 ${segment.shots.join("、")}）`, "");
      if (segment.story) lines.push(`- 叙事要素：${segment.story}`);
      if (segment.visual) lines.push(`- 本段视觉变化：${segment.visual}`);
      if (segment.editing) lines.push(`- 剪辑与节奏：${segment.editing}`);
      if (segment.sound) lines.push(`- 声音设计：${segment.sound}`);
      if (segment.videoPrompt) lines.push("", "视频生成提示词：", "", "```", segment.videoPrompt, "```");
      if (segment.firstFramePrompt) lines.push("", `首帧提示词：${segment.firstFramePrompt}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd() + "\n";
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

/** UTF-8 BOM so Excel opens Chinese text correctly. */
export function buildBreakdownCsv(data: CanvasBreakdownData) {
  const rows = [BREAKDOWN_SHOT_COLUMNS.map(column => column.label), ...data.shots.map(shot => BREAKDOWN_SHOT_COLUMNS.map(column => breakdownShotCell(shot, column.key)))];
  return `﻿${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Text-node documents laid out on the canvas. The canvas editor has no tables, so rows become headed lists. */
function paragraphs(value: string) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join("\n\n");
}

/** Models sometimes repeat the field name ("叙事要素：叙事要素：…"); keep the label once. */
function withoutLabel(value: string, label: string) {
  return value.replace(new RegExp(`^(本段)?${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[：:]\\s*`), "");
}

function field(label: string, ...values: Array<string | undefined>) {
  const value = values.filter((item): item is string => Boolean(item)).map(item => withoutLabel(item.trim(), label)).join("；");
  return value ? `- **${label}**：${value}` : "";
}

export function buildBreakdownOverviewDoc(data: CanvasBreakdownData) {
  const lines: string[] = ["# 全片创作拆解", ""];
  if (data.video) lines.push(`${data.sourceName ? `${data.sourceName} · ` : ""}${data.video.duration.toFixed(1)} 秒 · ${data.shots.length} 个镜头${data.segments.length ? ` · ${data.segments.length} 个片段` : ""}`, "");
  const overview = data.overview;
  if (!overview) return lines.join("\n").trimEnd() + "\n";
  if (overview.logline) lines.push("## 创意命题", "", overview.logline, "");
  if (overview.format) lines.push(`体裁与用途：${overview.format}`, "");
  if (overview.visualDna.length) lines.push("## 视觉基因", "", ...overview.visualDna.map(row => `- **${row.dimension}**：${row.value}`), "");
  if (overview.recurringElements.length) lines.push("## 反复出现的画面元素", "", ...overview.recurringElements.map(item => `- ${item}`), "");
  if (overview.keepPoints.length) lines.push("## 复刻时要保留的要点", "", ...overview.keepPoints.map(item => `- ${item}`), "");
  if (overview.skeleton.length) {
    lines.push("## 创作骨架", "");
    for (const row of overview.skeleton) lines.push(`### ${row.dimension}`, "", field("片中构造", row.construct), field("可复用规律", row.rule), "");
  }
  if (overview.techniques.length) lines.push("## 核心创作手法", "", ...overview.techniques.map(item => `- **${item.name}**：${item.effect}`), "");
  if (overview.characters.length) lines.push("## 人物与主体", "", ...overview.characters.map(item => `- **${item.name}**${item.role ? `（${item.role}）` : ""}：${item.appearance}`), "");
  if (overview.music || overview.rhythm) lines.push("## 声音与节奏", "", field("音乐", overview.music), field("节奏", overview.rhythm), "");
  return lines.filter((line, index, all) => line || all[index - 1]).join("\n").trimEnd() + "\n";
}

export function buildBreakdownSegmentDoc(segment: BreakdownSegment, shots: readonly BreakdownShot[]) {
  const byIndex = new Map(shots.map(shot => [shot.index, shot]));
  const range = segment.shots.length > 1 ? `镜头 ${segment.shots[0]}–${segment.shots[segment.shots.length - 1]}` : `镜头 ${segment.shots[0] ?? ""}`;
  const lines: string[] = [
    `# 片段 ${segment.index} · 镜头拆解${segment.title ? `（${segment.title}）` : ""}`, "",
    `时间码：${formatBreakdownTime(segment.start)} → ${formatBreakdownTime(segment.end)}（约 ${(segment.end - segment.start).toFixed(1)} 秒）· ${range}`, "",
    "## 镜头构造", "",
  ];
  for (const index of segment.shots) {
    const shot = byIndex.get(index);
    if (!shot) continue;
    lines.push(`### 镜头 ${shot.index} · ${formatBreakdownTime(shot.start)}–${formatBreakdownTime(shot.end)}${shot.shotSize ? ` · ${shot.shotSize}` : ""}`, "");
    lines.push(
      field("画面骨架", shot.description),
      field("叙事", shot.narrative),
      field("摄影机", shot.angle, shot.movement, shot.lens),
      field("调度、构图与焦点", shot.staging),
      field("光线与色彩", shot.lighting),
      field("声音", shot.sound),
      field("台词/旁白/字幕", shot.dialogue),
      field("转场", shot.transition),
      "",
    );
  }
  if (segment.story || segment.visual || segment.editing || segment.sound) {
    lines.push("## 段落表达", "", field("叙事要素", segment.story), field("视觉变化", segment.visual), field("剪辑与节奏", segment.editing), field("声音设计", segment.sound), "");
  }
  if (segment.videoPrompt) lines.push("## 视频生成提示词", "", paragraphs(segment.videoPrompt), "");
  if (segment.firstFramePrompt) lines.push("## 首帧提示词", "", paragraphs(segment.firstFramePrompt), "");
  return lines.filter((line, index, all) => line || all[index - 1]).join("\n").trimEnd() + "\n";
}
