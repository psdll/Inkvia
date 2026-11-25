import { describe, expect, it } from "vitest";
import { buildShotsFromCuts, formatBreakdownTime, keyFrameTime, parseSceneCutTimes } from "@/lib/canvas/shot-breakdown/scenes";
import { buildCastPrompt, buildOverviewPrompt, buildShotsPrompt, readCastResult, speechBlock, mergeSegmentResults, mergeShotResults, normalizeSegmentPlan, parseBreakdownJson, readOverviewResult } from "@/lib/canvas/shot-breakdown/prompts";
import { applyBreakdownEvent, createBreakdownData, listBreakdownModels, settleAbandonedBreakdown } from "@/lib/canvas/shot-breakdown/client-state";
import { buildBreakdownCsv, buildBreakdownMarkdown, buildBreakdownOverviewDoc, buildBreakdownSegmentDoc } from "@/lib/canvas/shot-breakdown/export";
import { breakdownOutputIds, planBreakdownFrameGrid, planBreakdownOutputs } from "@/lib/canvas/shot-breakdown/layout";
import { CANVAS_GROUP_PADDING } from "@/lib/canvas/group-layout";
const PAD_TOP = CANVAS_GROUP_PADDING.top;
import { breakdownOverviewSchema, breakdownSegmentSchema, breakdownShotSchema } from "@/lib/canvas/shot-breakdown/types";
import { parseCanvasDocumentV2, createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { validateCanvasNodeBudget } from "@/lib/canvas/limits";

const showinfo = `[Parsed_showinfo_2 @ 0x1] n:   0 pts:  48000 pts_time:2       duration:1000
[Parsed_showinfo_2 @ 0x1] n:   1 pts: 101000 pts_time:4.20833 duration:1000
[Parsed_showinfo_2 @ 0x1] n:   2 pts: 167000 pts_time:6.95833 duration:1000
[Parsed_showinfo_2 @ 0x1] n:   3 pts: 217000 pts_time:9.04167 duration:1000
[Parsed_showinfo_2 @ 0x1] n:   4 pts: 233000 pts_time:9.70833 duration:1000
[Parsed_showinfo_2 @ 0x1] n:   5 pts: 288000 pts_time:12      duration:1000`;

describe("拉片 shot detection", () => {
  it("reads ffmpeg scene cuts and turns them into frame-accurate shots", () => {
    const cuts = parseSceneCutTimes(showinfo);
    expect(cuts).toEqual([2, 4.208, 6.958, 9.042, 9.708, 12]);
    const shots = buildShotsFromCuts(cuts, 15.104);
    expect(shots.map(shot => [shot.start, shot.end])).toEqual([[0, 2], [2, 4.208], [4.208, 6.958], [6.958, 9.042], [9.042, 9.708], [9.708, 12], [12, 15.104]]);
    // Stills are taken inside the shot, never on the cut itself.
    for (const shot of shots) {
      expect(shot.keyTime).toBeGreaterThan(shot.start);
      expect(shot.keyTime).toBeLessThan(shot.end);
    }
  });

  it("drops flash cuts, splits long takes and merges the shortest shots beyond the cap", () => {
    expect(buildShotsFromCuts([3, 3.1, 6], 9).map(shot => shot.start)).toEqual([0, 3, 6]);
    expect(buildShotsFromCuts([], 20, { maxShot: 8 })).toHaveLength(3);
    expect(buildShotsFromCuts([4.9], 5).at(-1)?.end).toBe(5);
    const dense = buildShotsFromCuts(Array.from({ length: 99 }, (_, i) => (i + 1) * 0.5), 50, { maxShots: 40 });
    expect(dense).toHaveLength(40);
    expect(dense[0].start).toBe(0);
    expect(dense.at(-1)?.end).toBe(50);
  });

  it("formats timecodes to a tenth of a second", () => {
    expect(formatBreakdownTime(4.2083)).toBe("00:04.2");
    expect(formatBreakdownTime(3725.5)).toBe("1:02:05.5");
    expect(keyFrameTime(0, 0.2)).toBeCloseTo(0.1);
  });
});

describe("拉片 model output", () => {
  it("parses fenced, prefixed and trailing-comma JSON and reports truncation", () => {
    expect(parseBreakdownJson("好的，结果如下：\n```json\n{\"shots\": [{\"index\": 1,}],}\n```")).toEqual({ shots: [{ index: 1 }] });
    expect(parseBreakdownJson("{\"a\": \"含有 } 的文本\"}")).toEqual({ a: "含有 } 的文本" });
    expect(() => parseBreakdownJson("{\"shots\": [")).toThrow("截断");
  });

  it("keeps detected timing and stills, filling only the model's descriptions", () => {
    const detected = [1, 2].map(index => breakdownShotSchema.parse({ index, start: index - 1, end: index, frameUrl: `/uploads/canvas_breakdowns/${index}.jpg` }));
    const { shots, missing } = mergeShotResults(detected, { shots: [{ index: 1, start: 99, description: "女主站在按摩椅旁", shotSize: "中全景" }] });
    expect(shots[0]).toMatchObject({ index: 1, start: 0, end: 1, frameUrl: "/uploads/canvas_breakdowns/1.jpg", description: "女主站在按摩椅旁", shotSize: "中全景" });
    expect(missing).toEqual([2]);
  });

  it("accepts a clean segment plan and repairs one that skips or overruns shots", () => {
    const shots = [[0, 4], [4, 9], [9, 14], [14, 30]].map(([start, end], i) => ({ index: i + 1, start, end }));
    expect(normalizeSegmentPlan([{ index: 1, title: "开场", shots: [1, 2] }, { index: 2, title: "卖点", shots: [3] }, { index: 3, title: "收尾", shots: [4] }], shots).map(item => item.shots)).toEqual([[1, 2], [3], [4]]);
    const repaired = normalizeSegmentPlan([{ index: 1, title: "全部", shots: [1, 3] }], shots);
    expect(repaired.flatMap(item => item.shots)).toEqual([1, 2, 3, 4]);
    expect(repaired.every(item => item.shots.length > 0)).toBe(true);
  });

  it("tolerates a partial overview and binds segment timing to shots", () => {
    const value = readOverviewResult({ overview: { logline: "一句话", visualDna: "not a list" }, segments: [{ index: "1", title: "开场", shots: ["1", 2] }] });
    expect(value.overview.logline).toBe("一句话");
    expect(value.overview.visualDna).toEqual([]);
    expect(value.segments[0].shots).toEqual([1, 2]);
    const shots = [1, 2].map(index => breakdownShotSchema.parse({ index, start: (index - 1) * 2, end: index * 2 }));
    const [segment] = mergeSegmentResults([{ index: 1, title: "开场", shots: [1, 2] }], shots, { segments: [{ index: 1, videoPrompt: "【成片规格】4秒" }] });
    expect(segment).toMatchObject({ start: 0, end: 4, shots: [1, 2], videoPrompt: "【成片规格】4秒" });
  });

  it("tells the model where a long film's clip sits in the original timeline", () => {
    const prompt = buildShotsPrompt({ duration: 228 }, [{ index: 40, start: 120, end: 123.5, keyTime: 121 }], undefined, { start: 119.7, end: 123.8 });
    expect(prompt).toContain("片段内的 0 秒对应原片 01:59.7");
    expect(prompt).toContain("片段内 00:00.3–00:03.8");
  });
});

describe("拉片 canvas state", () => {
  it("prefers the strongest video-understanding models and hides text-only ones", () => {
    const models = listBreakdownModels([
      { providerId: "openai", modelId: "gpt-5.5" },
      { providerId: "minimax", modelId: "MiniMax-M3" },
      { providerId: "bigmodel", modelId: "glm-5.3-flash" },
      { providerId: "volcengine", modelId: "doubao-seed-evolving" },
    ]);
    expect(models.map(model => model.modelId)).toEqual(["doubao-seed-evolving", "glm-5.3-flash", "MiniMax-M3"]);
  });

  it("applies streamed results and finishes or fails cleanly", () => {
    let data = createBreakdownData({ sourceNodeId: "v", sourceUrl: "/uploads/a.mp4", sourceName: "广告", providerId: "volcengine", model: "doubao-seed-evolving", now: 1 });
    data = applyBreakdownEvent(data, { type: "stage", stage: "frames", progress: 0.14, message: "提取关键帧" });
    data = applyBreakdownEvent(data, { type: "stage", stage: "probe", progress: 0.02, message: "迟到的进度" });
    expect(data.progress).toBe(0.14);
    data = applyBreakdownEvent(data, { type: "shots", shots: [breakdownShotSchema.parse({ index: 1, start: 0, end: 2 })] });
    data = applyBreakdownEvent(data, { type: "done" }, 9);
    expect(data).toMatchObject({ status: "success", progress: 1, finishedAt: 9, title: "广告 · 拉片" });
    expect(applyBreakdownEvent(createBreakdownData({ sourceNodeId: "v", sourceUrl: "/a.mp4", sourceName: "x", providerId: "p", model: "m" }), { type: "error", error: "模型超时" }).status).toBe("failed");
    expect(settleAbandonedBreakdown({ ...data, status: "running" }).status).toBe("failed");
  });

  it("persists a long film's breakdown within the document budget", () => {
    // Field lengths measured on a real Doubao breakdown, rounded up.
    const text = (chars: number) => "镜".repeat(chars);
    const shots = Array.from({ length: 150 }, (_, i) => breakdownShotSchema.parse({
      index: i + 1, start: i * 2, end: i * 2 + 2, frameUrl: `/uploads/canvas_breakdowns/2026-10-25/${"a".repeat(40)}.jpg`,
      description: text(160), narrative: text(60), shotSize: text(4), angle: text(4), movement: text(20), lens: text(40),
      staging: text(160), lighting: text(110), sound: text(60), dialogue: text(60), transition: text(10), imagePrompt: text(200), motionPrompt: text(120),
    }));
    const node = { id: "b", type: "breakdown" as const, position: { x: 0, y: 0 }, width: 1040, height: 660, data: { ...createBreakdownData({ sourceNodeId: "v", sourceUrl: "/uploads/a.mp4", sourceName: "片", providerId: "p", model: "m" }), status: "success" as const, shots } };
    expect(() => validateCanvasNodeBudget(node)).not.toThrow();
    const document = parseCanvasDocumentV2({ ...createEmptyCanvasDocumentV2(), nodes: [node] });
    expect(document.nodes[0].data.kind).toBe("breakdown");
  });

  it("exports Markdown and an Excel-friendly CSV", () => {
    const data = { ...createBreakdownData({ sourceNodeId: "v", sourceUrl: "/a.mp4", sourceName: "广告", providerId: "p", model: "m" }), status: "success" as const,
      shots: [breakdownShotSchema.parse({ index: 1, start: 0, end: 2, description: "女主说 \"你好\", 并转身", shotSize: "中景" })] };
    expect(buildBreakdownMarkdown(data)).toContain("| 1 | 00:00.0–00:02.0 | 2.0s | 女主说 \"你好\", 并转身 |");
    const csv = buildBreakdownCsv(data);
    expect(csv.startsWith("﻿镜号,时间码")).toBe(true);
    expect(csv).toContain("\"女主说 \"\"你好\"\", 并转身\"");
  });
});

describe("拉片 results laid out on the canvas", () => {
  const base = () => {
    let data = createBreakdownData({ sourceNodeId: "v", sourceUrl: "/uploads/a.mp4", sourceName: "广告", providerId: "p", model: "m" });
    data = applyBreakdownEvent(data, { type: "video", video: { duration: 9, width: 1920, height: 1080, fps: 25, hasAudio: true } });
    data = applyBreakdownEvent(data, { type: "shots", shots: [1, 2, 3, 4, 5, 6].map(index => breakdownShotSchema.parse({ index, start: index - 1, end: index, frameUrl: `/f/${index}.jpg`, description: `镜头${index}画面`, shotSize: "中景", dialogue: index === 2 ? "\"你好\"" : "" })) });
    return { id: "b", type: "breakdown" as const, position: { x: 100, y: 200 }, width: 520, height: 420, data };
  };
  let seq = 0;
  const makeId = (kind: string) => `${kind}-${++seq}`;

  it("frames style stills and each segment, links clips to their breakdowns, and adds every result once", () => {
    const node = base();
    const first = planBreakdownOutputs(node, makeId)!;
    const styleGroup = first.nodes[0];
    expect(styleGroup).toMatchObject({ type: "group", data: { kind: "group", title: "风格参考" } });
    expect(first.nodes.slice(1).map(item => [item.parentId, (item.data as { name?: string }).name])).toEqual([1, 2, 3, 4].map(i => [styleGroup.id, `风格参考 ${i}`]));
    expect(first.edges).toEqual([]);
    node.data = { ...node.data, outputs: first.outputs };
    expect(planBreakdownOutputs(node, makeId)).toBeNull();

    node.data = applyBreakdownEvent(node.data, { type: "overview", overview: breakdownOverviewSchema.parse({ logline: "一句话命题" }) });
    node.data = applyBreakdownEvent(node.data, { type: "segments", segments: [
      breakdownSegmentSchema.parse({ index: 1, title: "开场", start: 0, end: 3, shots: [1, 2, 3], videoPrompt: "【成片规格】3秒", clipUrl: "/uploads/canvas_breakdowns/c1.mp4" }),
      breakdownSegmentSchema.parse({ index: 2, title: "收尾", start: 3, end: 6, shots: [4, 5, 6], clipUrl: "/uploads/canvas_breakdowns/c2.mp4" }),
    ] });
    const second = planBreakdownOutputs(node, makeId)!;
    const label = (item: { type?: string; data: unknown }) => { const data = item.data as { title?: string; name?: string }; return `${item.type}:${data.title ?? data.name}`; };
    // Segment 2 has its clip but waits for its prompt before its document appears.
    expect(second.nodes.map(label)).toEqual(["prompt:全片创作拆解", "group:片段 1 · 开场", "video:片段 1 - 开场", "prompt:片段 1 - 镜头拆解", "group:片段 2 · 收尾", "video:片段 2 - 收尾"]);
    const [overviewDoc, group1, clip1, doc1, group2, clip2] = second.nodes;
    expect(clip1.data).toMatchObject({ kind: "video", url: "/uploads/canvas_breakdowns/c1.mp4", posterUrl: "/f/1.jpg" });
    expect([clip1.parentId, doc1.parentId, clip2.parentId]).toEqual([group1.id, group1.id, group2.id]);
    expect(doc1.position.y).toBe(clip1.position.y);
    // Segments form a grid: two segments sit side by side with a clear gap.
    expect(group2.position.y).toBe(group1.position.y);
    expect(group2.position.x).toBeGreaterThan(group1.position.x + (group1.width ?? 0) + 200);
    // Only the card → overview line and clip → breakdown pairs: nothing crosses a frame.
    expect(second.edges.map(edge => [edge.source, edge.target])).toEqual([["b", overviewDoc.id], [clip1.id, doc1.id]]);
    node.data = { ...node.data, outputs: second.outputs };

    node.data = applyBreakdownEvent(node.data, { type: "done" });
    const last = planBreakdownOutputs(node, makeId)!;
    expect(last.nodes.map(label)).toEqual(["prompt:片段 2 - 镜头拆解"]);
    expect(last.nodes[0].parentId).toBe(group2.id);
    expect(last.edges.map(edge => [edge.source, edge.target])).toEqual([[clip2.id, last.nodes[0].id]]);
    expect(breakdownOutputIds(last.outputs)).toHaveLength(1 + 1 + 4 + 2 * 3);
  });

  it("adds the soundtrack and the music bed in a sound frame beside the style stills", () => {
    const node = base();
    node.data = { ...node.data, outputs: planBreakdownOutputs(node, makeId)!.outputs };
    node.data = applyBreakdownEvent(node.data, { type: "audio", audio: { soundtrack: "/s.mp3" } });
    const first = planBreakdownOutputs(node, makeId)!;
    expect(first.nodes.map(item => item.type)).toEqual(["group", "audio"]);
    expect(first.nodes[0].position.y).toBe(-PAD_TOP + 200);
    node.data = { ...node.data, outputs: first.outputs };
    node.data = applyBreakdownEvent(node.data, { type: "audio", audio: { soundtrack: "/s.mp3", background: "/b.mp3" } });
    const second = planBreakdownOutputs(node, makeId)!;
    expect(second.nodes.map(item => [item.type, item.parentId, (item.data as { name?: string }).name])).toEqual([["audio", first.nodes[0].id, "广告 · 背景音乐（去人声）"]]);
  });

  it("lays every keyframe out as a grid in one frame", () => {
    const node = base();
    const grid = planBreakdownFrameGrid(node, makeId)!;
    const [frame, ...tiles] = grid.nodes;
    expect(frame.data).toMatchObject({ kind: "group", title: "全部关键帧 · 6 张" });
    expect(new Set(tiles.map(tile => tile.position.y)).size).toBe(1);
    expect(tiles.every(tile => tile.parentId === frame.id)).toBe(true);
    expect(planBreakdownFrameGrid({ ...node, data: { ...node.data, outputs: grid.outputs } }, makeId)).toBeNull();
  });

  it("asks once for names and the segment plan, then lets the overview reuse them", () => {
    const shots = [{ index: 1, start: 0, end: 2, keyTime: 1 }];
    expect(buildCastPrompt({ duration: 2 }, shots)).toContain('"segments"');
    const cast = [{ name: "新娘", role: "主角", appearance: "白色婚纱" }];
    const overview = buildOverviewPrompt({ duration: 2 }, shots, undefined, cast);
    expect(overview).toContain("- 新娘（主角）：白色婚纱");
    expect(overview).not.toContain('"segments"');
    expect(buildOverviewPrompt({ duration: 2 }, shots)).toContain('"segments"');
    expect(buildShotsPrompt({ duration: 2 }, shots, cast)).toContain("- 新娘（主角）：白色婚纱");
    expect(readCastResult({ characters: [{ name: "新娘" }], segments: [{ index: "1", shots: ["1"] }] }).segments[0].shots).toEqual([1]);
  });

  it("writes documents the canvas text editor renders cleanly", () => {
    const node = base();
    const segment = breakdownSegmentSchema.parse({ index: 1, title: "开场", start: 0, end: 2, shots: [1, 2], videoPrompt: "【成片规格】2秒\n【镜头序列】推近", story: "建立场景" });
    const doc = buildBreakdownSegmentDoc(segment, node.data.shots);
    expect(doc).toContain("# 片段 1 · 镜头拆解（开场）");
    expect(doc).toContain("### 镜头 2 · 00:01.0–00:02.0 · 中景");
    expect(doc).toContain("- **台词/旁白/字幕**：\"你好\"");
    expect(doc).toContain("【成片规格】2秒\n\n【镜头序列】推近");
    expect(doc).not.toMatch(/\n\n\n/);
    expect(doc).not.toContain("|");
    const overview = buildBreakdownOverviewDoc({ ...node.data, overview: breakdownOverviewSchema.parse({ logline: "命题", skeleton: [{ dimension: "开场钩子", construct: "0秒特写", rule: "先给结果" }] }) });
    expect(overview).toContain("### 开场钩子\n\n- **片中构造**：0秒特写\n- **可复用规律**：先给结果");
  });

  it("hands the model the exact speech that falls inside each batch", () => {
    const speech = { lines: [{ start: 0.5, end: 1.8, text: "早上好" }, { start: 7, end: 8, text: "明天见" }] };
    const prompt = buildShotsPrompt({ duration: 9 }, [{ index: 1, start: 0, end: 2, keyTime: 1 }], undefined, undefined, speech);
    expect(prompt).toContain("[00:00.5–00:01.8] 早上好");
    expect(prompt).not.toContain("明天见");
    expect(speechBlock({ lines: [], note: "未启用语音识别" })).toContain("不要编造台词");
  });
});
