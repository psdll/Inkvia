import type { CanvasNode } from "@/lib/canvas/document";
import { buildCanvasImageCandidates, getCanvasLocalVideoPosterSource } from "./media-url";
import { normalizeMediaUrl } from "@/lib/media-url";

function videoThumbnail(url: string, poster?: string) {
  if (poster) return poster;
  const source = normalizeMediaUrl(url);
  // Match the canvas player's server-poster path, at the sidebar's small size.
  return getCanvasLocalVideoPosterSource(source) ? buildCanvasImageCandidates(source, 120)[0].url : url;
}

export type CanvasCurrentMaterial = {
  id: string;
  nodeId: string;
  kind: "image" | "video" | "audio" | "text";
  url: string;
  thumbnailUrl: string;
  name: string;
  temporary?: boolean;
};

export type CanvasMaterialRow =
  | { type: "group"; id: string; nodeId: string; name: string; depth: number; expanded: boolean }
  | { type: "material"; id: string; depth: number; material: CanvasCurrentMaterial };

export function listCanvasMaterialRows(
  nodes: CanvasNode[],
  materials: CanvasCurrentMaterial[],
  { query = "", kind = "all", collapsed = new Set<string>() }: {
    query?: string;
    kind?: "all" | CanvasCurrentMaterial["kind"];
    collapsed?: ReadonlySet<string>;
  } = {},
): CanvasMaterialRow[] {
  const groups = nodes.filter((node) => node.data.kind === "group");
  const groupIds = new Set(groups.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string | undefined, CanvasNode[]>();
  for (const group of groups) {
    const parent = groupIds.has(group.parentId ?? "") ? group.parentId : undefined;
    const siblings = children.get(parent) ?? [];
    siblings.push(group);
    children.set(parent, siblings);
  }
  const members = new Map<string | undefined, CanvasCurrentMaterial[]>();
  for (const material of materials) {
    const parentId = byId.get(material.nodeId)?.parentId;
    const parent = groupIds.has(parentId ?? "") ? parentId : undefined;
    const siblings = members.get(parent) ?? [];
    siblings.push(material);
    members.set(parent, siblings);
  }
  const search = query.trim().toLowerCase();
  const filtering = Boolean(search) || kind !== "all";
  const visited = new Set<string>();
  const visit = (parent: string | undefined, depth: number, ancestorMatches = false): CanvasMaterialRow[] => {
    const rows: CanvasMaterialRow[] = [];
    for (const group of children.get(parent) ?? []) {
      if (visited.has(group.id) || group.data.kind !== "group") continue;
      visited.add(group.id);
      const name = group.data.title.trim() || "未命名分组";
      const matches = ancestorMatches || Boolean(search && name.toLowerCase().includes(search));
      const descendants = visit(group.id, depth + 1, matches);
      if (filtering && !descendants.length) continue;
      const expanded = filtering || !collapsed.has(group.id);
      rows.push({ type: "group", id: `group:${group.id}`, nodeId: group.id, name, depth, expanded });
      if (expanded) rows.push(...descendants);
    }
    for (const material of members.get(parent) ?? []) {
      if (kind !== "all" && material.kind !== kind) continue;
      if (search && !ancestorMatches && !material.name.toLowerCase().includes(search)) continue;
      rows.push({ type: "material", id: material.id, depth, material });
    }
    return rows;
  };
  return visit(undefined, 0);
}

export function listCanvasCurrentMaterials(nodes: CanvasNode[]): CanvasCurrentMaterial[] {
  const items: CanvasCurrentMaterial[] = [];
  let imageNodeCount = 0;
  let videoNodeCount = 0;
  let audioNodeCount = 0;
  let audioTaskCount = 0;
  let textNodeCount = 0;
  let imageResultCount = 0;
  let videoResultCount = 0;

  for (const node of nodes) {
    if (node.data.kind === "image") {
      const url = node.data.url.trim();
      if (!url) continue;
      imageNodeCount += 1;
      items.push({
        id: node.id,
        nodeId: node.id,
        kind: "image",
        url,
        thumbnailUrl: node.data.variants?.thumbnail?.url?.trim() || node.data.variants?.preview?.url?.trim() || url,
        name: node.data.name?.trim() || `图片 ${imageNodeCount}`,
      });
      continue;
    }

    if (node.data.kind === "video") {
      const url = node.data.url.trim();
      if (!url) continue;
      videoNodeCount += 1;
      items.push({
        id: node.id,
        nodeId: node.id,
        kind: "video",
        url,
        thumbnailUrl: videoThumbnail(url, node.data.posterUrl?.trim() || node.data.variants?.poster?.url?.trim() || node.data.variants?.thumbnail?.url?.trim()),
        name: node.data.name?.trim() || `视频 ${videoNodeCount}`,
      });
      continue;
    }

    if (node.data.kind === "audio") {
      const url = node.data.url.trim();
      if (!url) continue;
      audioNodeCount += 1;
      items.push({
        id: node.id,
        nodeId: node.id,
        kind: "audio",
        url,
        thumbnailUrl: url,
        name: node.data.name?.trim() || `音频 ${audioNodeCount}`,
      });
      continue;
    }

    if (node.data.kind === "audioTask") {
      audioTaskCount += 1;
      const url = node.data.status === "success" ? node.data.outputUrl?.trim() || "" : "";
      items.push({
        id: node.id,
        nodeId: node.id,
        kind: "audio",
        url,
        thumbnailUrl: url,
        name: node.data.title?.trim() || (url && node.data.outputName?.trim()) || `音频节点${audioTaskCount}`,
        temporary: !url,
      });
      continue;
    }

    if (node.data.kind === "prompt" || node.data.kind === "llm") {
      textNodeCount += 1;
      items.push({
        id: node.id,
        nodeId: node.id,
        kind: "text",
        url: "",
        thumbnailUrl: "",
        name: node.data.title?.trim() || `文本节点 ${textNodeCount}`,
      });
      continue;
    }

    if (node.data.kind === "imageTask") {
      const latestBatch = node.data.task.batches.at(-1);
      const successfulOutputs = (latestBatch?.outputs || []).filter((output) => (
        output.status === "success" && Boolean(output.url?.trim())
      ));
      if (!latestBatch || !successfulOutputs.length) {
        items.push({
          id: `${node.id}:temp`,
          nodeId: node.id,
          kind: "image",
          url: "",
          thumbnailUrl: "",
          name: node.data.title?.trim() || "临时（__temp）",
          temporary: true,
        });
        continue;
      }
      for (const output of successfulOutputs) {
        const url = output.url?.trim() || "";
        imageResultCount += 1;
        items.push({
          id: `${node.id}:${latestBatch.id}:${output.id}`,
          nodeId: node.id,
          kind: "image",
          url,
          thumbnailUrl: url,
          name: node.data.title?.trim() || output.name?.trim() || `图片结果 ${imageResultCount}`,
        });
      }
      continue;
    }

    if (node.data.kind === "videoTask") {
      const url = node.data.status === "success" ? node.data.outputUrl?.trim() || "" : "";
      if (url) {
        videoResultCount += 1;
        items.push({
          id: `${node.id}:output`,
          nodeId: node.id,
          kind: "video",
          url,
          thumbnailUrl: videoThumbnail(url, node.data.variants?.poster?.url?.trim() || node.data.variants?.thumbnail?.url?.trim()),
          name: node.data.title?.trim() || node.data.outputName?.trim() || `视频结果 ${videoResultCount}`,
        });
      } else {
        items.push({
          id: `${node.id}:temp`,
          nodeId: node.id,
          kind: "video",
          url: "",
          thumbnailUrl: "",
          name: node.data.title?.trim() || "临时（__temp）",
          temporary: true,
        });
      }
    }
  }

  return items;
}
