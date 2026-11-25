import type { CanvasBreakdownData, CanvasBreakdownOutputs, CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import { CANVAS_GROUP_PADDING as PAD } from "@/lib/canvas/group-layout";
import { DEFAULT_CANVAS_AUDIO_NODE_SIZE as AUDIO } from "@/lib/canvas/media-size";
import { buildBreakdownOverviewDoc, buildBreakdownSegmentDoc } from "./export";

/**
 * 拉片 results, laid out compactly in reading order:
 *
 *   [card] [全片创作拆解]  [风格参考 ▢▢▢▢]  [声音 ♪ ♪]
 *                          [片段1] [片段2] [片段3]
 *                          [片段4] [片段5] …          ← a grid, never one long column
 *
 * Every section is a titled frame that moves as a unit. Lines only pair each segment
 * clip with its breakdown (and the card with the overview), so nothing crosses a frame.
 */
export const BREAKDOWN_CARD_SIZE = { width: 520, height: 480 } as const;
const GAP = 100;
/** Frame titles keep their on-screen size, so they grow when zoomed out; leave them room. */
const SECTION_GAP = 240;
const DOC_WIDTH = 680;
const OVERVIEW_HEIGHT = 900;
const SEGMENT_DOC_HEIGHT = 640;
const STYLE_BOX = 300;
const TILE_GAP = 24;
const CLIP_BOX = 480;
const PAIR_GAP = 60;
const STYLE_COUNT = 4;
const FRAME_GRID_BOX = 300;
const FRAME_GRID_COLUMNS = 8;

type IdKind = "prompt" | "image" | "video" | "audio" | "group" | "edge";

function fit(ratio: number, box: number) {
  return ratio >= 1
    ? { width: box, height: Math.round(box / ratio) }
    : { width: Math.round(box * ratio), height: box };
}

function sample<T>(items: readonly T[], count: number) {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, i) => items[Math.round(i * (items.length - 1) / (count - 1))]);
}

/** 1 segment: one column; up to 4: two; more: three. */
function segmentColumns(count: number) {
  return count <= 1 ? 1 : count <= 4 ? 2 : 3;
}

type BreakdownNode = CanvasNode & { data: CanvasBreakdownData };
type SegmentEntry = NonNullable<CanvasBreakdownOutputs["segments"]>[number];

function geometry(node: BreakdownNode) {
  const data = node.data;
  const ratio = data.video?.width && data.video.height ? data.video.width / data.video.height : 16 / 9;
  const style = fit(ratio, STYLE_BOX);
  const clip = fit(ratio, CLIP_BOX);
  const top = node.position.y;
  const docLeft = node.position.x + (node.width ?? BREAKDOWN_CARD_SIZE.width) + GAP;
  const frameLeft = docLeft + DOC_WIDTH + GAP;
  const styleFrame = { width: PAD.x * 2 + STYLE_COUNT * style.width + (STYLE_COUNT - 1) * TILE_GAP, height: PAD.top + Math.max(style.height, AUDIO.height) + PAD.bottom };
  const soundFrame = { width: PAD.x * 2 + AUDIO.width * 2 + TILE_GAP, height: styleFrame.height };
  const rowInner = Math.max(clip.height, SEGMENT_DOC_HEIGHT);
  const segmentFrame = { width: PAD.x * 2 + clip.width + PAIR_GAP + DOC_WIDTH, height: PAD.top + rowInner + PAD.bottom };
  const segmentsTop = top - PAD.top + styleFrame.height + SECTION_GAP;
  const columns = segmentColumns(data.segments.length);
  const segmentAt = (index: number) => ({
    x: frameLeft + ((index - 1) % columns) * (segmentFrame.width + SECTION_GAP),
    y: segmentsTop + Math.floor((index - 1) / columns) * (segmentFrame.height + SECTION_GAP),
  });
  const belowSegments = segmentsTop + Math.ceil(data.segments.length / columns) * (segmentFrame.height + SECTION_GAP);
  return { ratio, style, clip, top, docLeft, frameLeft, styleFrame, soundFrame, segmentFrame, segmentsTop, segmentAt, belowSegments };
}

/** New canvas nodes and edges for results that arrived since the last call, or null when nothing is new. */
export function planBreakdownOutputs(node: BreakdownNode, makeId: (kind: IdKind) => string) {
  const data = node.data;
  const outputs: CanvasBreakdownOutputs = { ...data.outputs, segments: [...(data.outputs?.segments ?? [])] };
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const link = (source: string, target: string) => edges.push({ id: makeId("edge"), source, target, type: "default" });
  const g = geometry(node);

  if (data.overview && !outputs.overview) {
    const id = makeId("prompt");
    outputs.overview = id;
    nodes.push({ id, type: "prompt", position: { x: g.docLeft, y: g.top }, width: DOC_WIDTH, height: OVERVIEW_HEIGHT,
      data: { kind: "prompt", title: "全片创作拆解", text: buildBreakdownOverviewDoc(data), format: "markdown" } });
    link(node.id, id);
  }

  const stills = data.shots.filter(shot => shot.frameUrl);
  if (stills.length && !outputs.styles?.length) {
    const picked = sample(stills, STYLE_COUNT);
    const group = makeId("group");
    outputs.styleGroup = group;
    nodes.push({ id: group, type: "group", position: { x: g.frameLeft, y: g.top - PAD.top }, zIndex: -1, ...g.styleFrame,
      data: { kind: "group", title: "风格参考", collapsed: false, tone: "neutral" } });
    outputs.styles = picked.map((shot, i) => {
      const id = makeId("image");
      nodes.push({ id, type: "image", parentId: group, position: { x: PAD.x + i * (g.style.width + TILE_GAP), y: PAD.top }, ...g.style,
        data: { kind: "image", url: shot.frameUrl!, name: `风格参考 ${i + 1}`, origin: "generated" } });
      return id;
    });
  }

  const tracks = ([["soundtrack", "原片音轨"], ["background", "背景音乐（去人声）"]] as const).filter(([key]) => data.audio?.[key] && !outputs[key]);
  if (tracks.length) {
    if (!outputs.soundGroup) {
      outputs.soundGroup = makeId("group");
      nodes.push({ id: outputs.soundGroup, type: "group", position: { x: g.frameLeft + g.styleFrame.width + SECTION_GAP, y: g.top - PAD.top }, zIndex: -1, ...g.soundFrame,
        data: { kind: "group", title: "声音", collapsed: false, tone: "neutral" } });
    }
    const base = data.sourceName ? `${data.sourceName.replace(/\.[^.]+$/, "")} · ` : "";
    for (const [key, name] of tracks) {
      const id = makeId("audio");
      outputs[key] = id;
      nodes.push({ id, type: "audio", parentId: outputs.soundGroup, position: { x: PAD.x + (key === "soundtrack" ? 0 : AUDIO.width + TILE_GAP), y: PAD.top }, ...AUDIO,
        data: { kind: "audio", url: data.audio![key]!, name: `${base}${name}`, origin: "generated" } });
    }
  }

  const finished = data.status === "success";
  for (const segment of data.segments) {
    const entry: SegmentEntry = { ...outputs.segments!.find(item => item.index === segment.index), index: segment.index };
    const wantsClip = Boolean(segment.clipUrl) && !entry.clip;
    const wantsDoc = Boolean(segment.videoPrompt || finished) && !entry.doc;
    if (!wantsClip && !wantsDoc) continue;
    if (!entry.group) {
      entry.group = makeId("group");
      nodes.push({ id: entry.group, type: "group", position: g.segmentAt(segment.index), zIndex: -1, ...g.segmentFrame,
        data: { kind: "group", title: `片段 ${segment.index}${segment.title ? ` · ${segment.title}` : ""}`, collapsed: false, tone: "neutral" } });
    }
    if (wantsClip) {
      entry.clip = makeId("video");
      const poster = data.shots.find(shot => shot.index === segment.shots[0])?.frameUrl;
      nodes.push({ id: entry.clip, type: "video", parentId: entry.group, position: { x: PAD.x, y: PAD.top }, ...g.clip,
        data: { kind: "video", url: segment.clipUrl!, name: `片段 ${segment.index}${segment.title ? ` - ${segment.title}` : ""}`, origin: "generated", ...(poster ? { posterUrl: poster } : {}) } });
    }
    if (wantsDoc) {
      entry.doc = makeId("prompt");
      nodes.push({ id: entry.doc, type: "prompt", parentId: entry.group, position: { x: PAD.x + g.clip.width + PAIR_GAP, y: PAD.top }, width: DOC_WIDTH, height: SEGMENT_DOC_HEIGHT,
        data: { kind: "prompt", title: `片段 ${segment.index} - 镜头拆解`, text: buildBreakdownSegmentDoc(segment, data.shots), format: "markdown" } });
    }
    // The pairing line appears once both halves exist.
    if (entry.clip && entry.doc) link(entry.clip, entry.doc);
    outputs.segments = [...outputs.segments!.filter(item => item.index !== segment.index), entry].sort((a, b) => a.index - b.index);
  }
  return nodes.length || edges.length ? { nodes, edges, outputs } : null;
}

/** Every keyframe as a grid in one frame below the segments; null when there are none or it exists. */
export function planBreakdownFrameGrid(node: BreakdownNode, makeId: (kind: IdKind) => string) {
  const data = node.data;
  const stills = data.shots.filter(shot => shot.frameUrl);
  if (!stills.length || data.outputs?.framesGroup) return null;
  const g = geometry(node);
  const tile = fit(g.ratio, FRAME_GRID_BOX);
  const columns = Math.min(FRAME_GRID_COLUMNS, stills.length);
  const rows = Math.ceil(stills.length / columns);
  const group = makeId("group");
  const nodes: CanvasNode[] = [{
    id: group, type: "group", position: { x: g.frameLeft, y: data.segments.length ? g.belowSegments : g.segmentsTop }, zIndex: -1,
    width: PAD.x * 2 + columns * tile.width + (columns - 1) * TILE_GAP, height: PAD.top + rows * tile.height + (rows - 1) * TILE_GAP + PAD.bottom,
    data: { kind: "group", title: `全部关键帧 · ${stills.length} 张`, collapsed: false, tone: "neutral" },
  }];
  stills.forEach((shot, i) => nodes.push({
    id: makeId("image"), type: "image", parentId: group,
    position: { x: PAD.x + (i % columns) * (tile.width + TILE_GAP), y: PAD.top + Math.floor(i / columns) * (tile.height + TILE_GAP) }, ...tile,
    data: { kind: "image", url: shot.frameUrl!, name: `镜头${shot.index} 关键帧`, origin: "generated" },
  }));
  const outputs: CanvasBreakdownOutputs = { ...data.outputs, framesGroup: group };
  return { nodes, outputs };
}

/** Ids of every node a breakdown laid out, for clearing them before a re-run. */
export function breakdownOutputIds(outputs: CanvasBreakdownOutputs | undefined) {
  if (!outputs) return [];
  return [outputs.overview, outputs.styleGroup, outputs.soundGroup, outputs.soundtrack, outputs.background, outputs.framesGroup, ...(outputs.styles ?? []),
    ...(outputs.segments ?? []).flatMap(item => [item.group, item.clip, item.doc])]
    .filter((id): id is string => Boolean(id));
}
