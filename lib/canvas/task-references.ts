import { collectCanvasTextReferences } from "@/lib/canvas/text-references";
import type { CanvasDocumentV2, CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import { getCanvasPrimaryImageOutput, isCanvasImageBatchExpanded, parseCanvasAspectRatio } from "@/lib/canvas/image-task";
import { DEFAULT_CANVAS_AUDIO_NODE_SIZE, getCanvasRatioMediaNodeSize } from "@/lib/canvas/media-size";
import { basenameFromPath, inferPromptAssetKind, type PromptReferenceAsset } from "@/lib/prompt-asset-references";
import { editorDocToPromptText, promptTextToEditorDoc, reconcilePromptAssetMentions } from "@/lib/prompt-rich-editor-content";
import type { CanvasReferenceInsertion } from "@/lib/canvas/reference-drop";
import { getCanvasTextTaskFrameSize } from "@/lib/canvas/text-node";
import { normalizeCanvasVideoTaskForModel, resolveCanvasVideoInputMode } from "@/lib/canvas/task-preferences";
import { getVideoModelSpec } from "@/lib/sora2";

type MediaCandidate = Omit<PromptReferenceAsset, "token">;

function mediaFromNode(node: CanvasNode): MediaCandidate[] {
  if (node.data.kind === "image") {
    return [{ id: node.id, sourceNodeId: node.id, kind: "image", url: node.data.url, name: node.data.name || "图片素材" }];
  }
  if (node.data.kind === "video") {
    return [{ id: node.id, sourceNodeId: node.id, kind: "video", url: node.data.url, name: node.data.name || "视频素材" }];
  }
  if (node.data.kind === "audio") {
    return [{ id: node.id, sourceNodeId: node.id, kind: "audio", url: node.data.url, name: node.data.name || "音频素材", durationSeconds: node.data.durationSeconds }];
  }
  if (node.data.kind === "imageTask") {
    const batch = [...node.data.task.batches].reverse().find((candidate) => candidate.outputs.some((output) => output.status === "success" && output.url));
    const output = getCanvasPrimaryImageOutput(batch);
    return output ? [{ id: `${node.id}:primary`, sourceNodeId: node.id, kind: "image", url: output.url!, name: node.data.title || output.name || "生成结果" }] : [];
  }
  if (node.data.kind === "videoTask" && node.data.outputUrl) {
    return [{ id: node.id, sourceNodeId: node.id, kind: "video", url: node.data.outputUrl, name: node.data.title || node.data.outputName || "生成视频", durationSeconds: node.data.duration }];
  }
  if (node.data.kind === "audioTask" && node.data.outputUrl) {
    return [{ id: node.id, sourceNodeId: node.id, kind: "audio", url: node.data.outputUrl, name: node.data.title || node.data.outputName || "生成音频", durationSeconds: node.data.durationSeconds }];
  }
  return [];
}

function configuredTaskMedia(node: CanvasNode | undefined): MediaCandidate[] {
  if (node?.data.kind === "imageTask") {
    return node.data.task.references.map((reference) => ({
      id: reference.id,
      sourceNodeId: reference.sourceNodeId,
      kind: "image" as const,
      url: reference.url,
      name: reference.name,
    }));
  }
  if (node?.data.kind === "videoTask") {
    return (node.data.mediaPaths || []).map((url) => ({
      id: `configured:${url}`,
      kind: inferPromptAssetKind(url),
      url,
      name: basenameFromPath(url) || "参考素材",
    }));
  }
  return [];
}

function getReferenceOrder(node: CanvasNode | undefined): string[] {
  if (node?.data.kind === "imageTask") return node.data.task.referenceOrder || [];
  if (node?.data.kind === "videoTask" || node?.data.kind === "llm" || node?.data.kind === "audioTask") return node.data.referenceOrder || [];
  return [];
}

function setReferenceOrder(node: CanvasNode, referenceOrder: string[]): CanvasNode {
  if (node.data.kind === "imageTask") {
    return { ...node, data: { ...node.data, task: { ...node.data.task, referenceOrder } } };
  }
  if (node.data.kind === "videoTask" || node.data.kind === "llm" || node.data.kind === "audioTask") {
    return { ...node, data: { ...node.data, referenceOrder } };
  }
  return node;
}

export function collectCanvasTaskAssets(document: Pick<CanvasDocumentV2, "nodes" | "edges">, nodeId: string): PromptReferenceAsset[] {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const counts = { image: 0, video: 0, audio: 0 };
  const candidates: MediaCandidate[] = [];
  const target = nodesById.get(nodeId);

  for (const edge of document.edges) {
    if (edge.target !== nodeId) continue;
    const source = nodesById.get(edge.source);
    if (!source) continue;
    // Angle tasks pin the clicked output; a multi-image batch must not replace it.
    const pinned = target?.data.kind === "imageTask" ? target.data.task.pinnedSource || target.data.task.angleSource : undefined;
    const pinnedReferences = target?.data.kind === "imageTask" ? target.data.task.references.filter(ref => ref.pinned && ref.sourceNodeId === source.id).map(ref => ({ ...ref, kind: "image" as const }))
      : target?.data.kind === "videoTask" ? (target.data.pinnedReferences || []).filter(ref => ref.sourceNodeId === source.id && target.data.kind === "videoTask" && target.data.mediaPaths.includes(ref.url)) : [];
    const sourceMedia: MediaCandidate[] = pinnedReferences.length
      ? pinnedReferences.map(ref => ({ id: ref.id, sourceNodeId: source.id, kind: ref.kind, url: ref.url, name: ref.name }))
      : pinned?.sourceNodeId === source.id
      ? [{ id: `${source.id}:${target?.data.kind === "imageTask" && target.data.task.preset === "characterSheet" ? "characterSheet" : "angle"}`, sourceNodeId: source.id, kind: "image", url: pinned.url, name: mediaFromNode(source).find(asset => asset.url === pinned.url)?.name || (target?.data.kind === "imageTask" && target.data.task.preset === "characterSheet" ? "角色参考图" : "角度原图") }]
      : mediaFromNode(source);
    for (const asset of sourceMedia) {
      const url = String(asset.url || "").trim();
      if (!url || seen.has(url)) continue;
      seen.add(url);
      candidates.push({ ...asset, url });
    }
  }

  for (const asset of configuredTaskMedia(target)) {
    const url = String(asset.url || "").trim();
    if (!url || seen.has(url)) continue;
    // A live connection owns its primary image; stale configured copies must not add other results.
    const connectedImage = document.edges.some(edge => {
      if (edge.target !== nodeId) return false;
      const source = nodesById.get(edge.source);
      return source?.data.kind === "imageTask" && (asset.sourceNodeId === source.id
        || source.data.task.batches.some(batch => batch.outputs.some(output => output.url === url)));
    });
    if (connectedImage) continue;
    seen.add(url);
    const source = asset.sourceNodeId ? nodesById.get(asset.sourceNodeId) : undefined;
    const currentName = source && mediaFromNode(source).find(candidate => candidate.url === url)?.name;
    candidates.push({ ...asset, url, name: currentName || asset.name });
  }

  const order = getReferenceOrder(target);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const ordered = candidates
    .map((asset, index) => ({ asset, index, order: orderIndex.get(asset.id) }))
    .sort((left, right) => {
      if (left.order !== undefined && right.order !== undefined) return left.order - right.order;
      if (left.order !== undefined) return -1;
      if (right.order !== undefined) return 1;
      return left.index - right.index;
    })
    .map(({ asset }) => asset);

  const assets = ordered.map((asset) => {
    const kind = asset.kind === "audio" ? "audio" : asset.kind === "video" ? "video" : "image";
    counts[kind] += 1;
    return {
      ...asset,
      token: `${kind === "audio" ? "音频" : kind === "video" ? "视频" : "图片"}${counts[kind]}`,
    };
  });

  return assets;
}

export function hasPendingCanvasTaskUploads(document: CanvasDocumentV2, nodeId: string): boolean {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  const configuredUrls = node?.data.kind === "imageTask"
    ? node.data.task.references.map((reference) => reference.url)
    : node?.data.kind === "videoTask"
      ? node.data.mediaPaths
      : [];
  const connectedUrls = collectCanvasTaskAssets(document, nodeId).map((asset) => asset.url || "");
  return [...configuredUrls, ...connectedUrls].some((url) => String(url || "").trim().toLowerCase().startsWith("blob:"));
}

function connectedMediaSources(document: Pick<CanvasDocumentV2, "nodes" | "edges">, nodeId: string): Set<string> {
  const sources = new Set(document.edges.filter(edge => edge.target === nodeId).map(edge => edge.source));
  return new Set(document.nodes.filter(node => {
    return sources.has(node.id) && ["image", "video", "audio", "imageTask", "videoTask", "audioTask"].includes(node.data.kind);
  }).map(node => node.id));
}

export function hasCanvasTaskMediaReferences(document: CanvasDocumentV2, nodeId: string): boolean {
  const node = document.nodes.find(node => node.id === nodeId);
  return configuredTaskMedia(node).some(asset => Boolean(asset.url?.trim())) || connectedMediaSources(document, nodeId).size > 0;
}

export function collectCanvasVideoReferences(document: Pick<CanvasDocumentV2, "nodes" | "edges">, nodeId: string) {
  const assets = collectCanvasTaskAssets(document, nodeId);
  const sources = connectedMediaSources(document, nodeId);
  const pending = document.nodes.filter(node => sources.has(node.id) && !mediaFromNode(node).some(asset => asset.url?.trim())).map(node => ({
    kind: node.data.kind === "audio" || node.data.kind === "audioTask" ? "audio"
      : node.data.kind === "video" || node.data.kind === "videoTask" ? "video" : "image",
  }));
  return [...assets, ...pending];
}

export function buildCanvasTaskMediaInput(document: CanvasDocumentV2, nodeId: string, prompt: string) {
  const assets = collectCanvasTaskAssets(document, nodeId);
  return {
    prompt,
    textList: collectCanvasTextReferences(document, nodeId).map(reference => reference.content),
    imagePaths: assets.filter((asset) => asset.kind === "image").map((asset) => asset.url || ""),
    mediaPaths: assets.map((asset) => asset.url || ""),
  };
}

function syncPromptAssetTokens(prompt: string, previousAssets: PromptReferenceAsset[], nextAssets: PromptReferenceAsset[]) {
  return editorDocToPromptText(reconcilePromptAssetMentions(
    promptTextToEditorDoc(prompt, previousAssets),
    nextAssets,
  ));
}

export function syncCanvasTaskAssetChanges(document: CanvasDocumentV2, nextDocument: CanvasDocumentV2): CanvasDocumentV2 {
  const nodes = nextDocument.nodes.map((node) => {
    if (node.data.kind !== "imageTask" && node.data.kind !== "videoTask" && node.data.kind !== "llm" && node.data.kind !== "audioTask") return node;
    const previousAssets = collectCanvasTaskAssets(document, node.id);
    const nextAssets = collectCanvasTaskAssets(nextDocument, node.id);
    const previousNode = document.nodes.find((candidate) => candidate.id === node.id);
    const prompt = previousNode?.data.kind === "imageTask"
      ? previousNode.data.task.settings.prompt
      : previousNode?.data.kind === "videoTask" || previousNode?.data.kind === "llm" || previousNode?.data.kind === "audioTask"
        ? previousNode.data.prompt
        : node.data.kind === "imageTask"
          ? node.data.task.settings.prompt
          : node.data.prompt;
    const nextPrompt = syncPromptAssetTokens(prompt, previousAssets, nextAssets);
    if (node.data.kind === "imageTask") {
      return { ...node, data: { ...node.data, task: { ...node.data.task, settings: { ...node.data.task.settings, prompt: nextPrompt } } } };
    }
    if (node.data.kind === "videoTask") {
      const previousSources = connectedMediaSources(document, node.id);
      const nextSources = connectedMediaSources(nextDocument, node.id);
      const addedMedia = [...nextSources].some(source => !previousSources.has(source))
        || nextAssets.some(asset => !previousAssets.some(previous => previous.id === asset.id));
      const data = { ...node.data, prompt: nextPrompt };
      const spec = getVideoModelSpec(data.model);
      const references = collectCanvasVideoReferences(nextDocument, node.id);
      const resetReferenceMode = addedMedia && data.inputMode !== "first_frame" && data.inputMode !== "first_last_frame";
      const missingEditVideo = data.omniReferenceTaskType === "edit" && !references.some(reference => reference.kind === "video");
      if (!resetReferenceMode && !missingEditVideo && resolveCanvasVideoInputMode(data.inputMode, spec, references) === data.inputMode) return { ...node, data };
      return { ...node, data: normalizeCanvasVideoTaskForModel(
        resetReferenceMode ? { ...data, inputMode: undefined, omniReferenceTaskType: "auto" } : data,
        data.model,
        spec,
        references,
      ) };
    }
    return { ...node, data: { ...node.data, prompt: nextPrompt } };
  });
  return { ...nextDocument, nodes };
}

export function syncCanvasTaskPromptsWithEdges(document: CanvasDocumentV2, edges: CanvasEdge[]): CanvasDocumentV2 {
  return syncCanvasTaskAssetChanges(document, { ...document, edges });
}

export function disconnectCanvasEdge(document: CanvasDocumentV2, edgeId: string): CanvasDocumentV2 {
  if (!document.edges.some((edge) => edge.id === edgeId)) return document;
  return syncCanvasTaskAssetChanges(document, {
    ...document,
    edges: document.edges.filter((edge) => edge.id !== edgeId),
  });
}

export function reorderCanvasTaskReferences(document: CanvasDocumentV2, nodeId: string, orderedIds: string[]): CanvasDocumentV2 {
  const currentIds = collectCanvasTaskAssets(document, nodeId).map((asset) => asset.id);
  const available = new Set(currentIds);
  const seen = new Set<string>();
  const referenceOrder = [...orderedIds, ...currentIds].filter((id) => {
    if (!available.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const nextDocument = {
    ...document,
    nodes: document.nodes.map((node) => node.id === nodeId ? setReferenceOrder(node, referenceOrder) : node),
  };
  return syncCanvasTaskAssetChanges(document, nextDocument);
}

export function insertCanvasTaskReferences(
  document: CanvasDocumentV2,
  nextDocument: CanvasDocumentV2,
  target: CanvasReferenceInsertion,
): CanvasDocumentV2 {
  const previousIds = collectCanvasTaskAssets(document, target.nodeId).map((asset) => asset.id);
  const previous = new Set(previousIds);
  const addedIds = collectCanvasTaskAssets(nextDocument, target.nodeId)
    .filter((asset) => !previous.has(asset.id)).map((asset) => asset.id);
  const targetIndex = previousIds.indexOf(target.referenceId || "");
  const insertionIndex = targetIndex < 0 ? previousIds.length : targetIndex + (target.placement === "after" ? 1 : 0);
  const order = [...previousIds.slice(0, insertionIndex), ...addedIds, ...previousIds.slice(insertionIndex)];
  return syncCanvasTaskAssetChanges(document, {
    ...nextDocument,
    nodes: nextDocument.nodes.map((node) => node.id === target.nodeId ? setReferenceOrder(node, order) : node),
  });
}

export function getCanvasTaskFrameSize(aspectRatio: string, maxSize = 320): { width: number; height: number } {
  const size = Math.max(120, Math.round(maxSize));
  const ratio = parseCanvasAspectRatio(aspectRatio, 1);
  if (ratio >= 1) return { width: size, height: Math.round(size / ratio) };
  return { width: Math.round(size * ratio), height: size };
}

export function getCanvasTaskMediaFrameSize(aspectRatio: string) {
  const ratio = parseCanvasAspectRatio(aspectRatio, 1);
  return getCanvasRatioMediaNodeSize(ratio, 1);
}

export function getCanvasTaskPrimaryFrameSize(data: Extract<CanvasNode["data"], { kind: "imageTask" | "videoTask" | "audioTask" }>) {
  if (data.kind === "audioTask") return DEFAULT_CANVAS_AUDIO_NODE_SIZE;
  const latestBatch = data.kind === "imageTask" ? data.task.batches.at(-1) : undefined;
  const successful = (latestBatch?.outputs || []).filter((output) => output.status === "success" && output.url);
  const original = data.kind === "videoTask" && data.status === "success" ? data.variants?.original : getCanvasPrimaryImageOutput(latestBatch);
  if (original?.width && original?.height) return getCanvasTaskMediaFrameSize(`${original.width}:${original.height}`);
  const aspectRatio = data.kind === "imageTask"
    ? successful.length
      ? (latestBatch?.settings.aspectRatio || data.task.settings.aspectRatio)
      : data.task.settings.aspectRatio
    : (data.ratio || "16:9");
  return getCanvasTaskMediaFrameSize(aspectRatio === "adaptive" ? "auto" : aspectRatio);
}

export function getCanvasImageResultLayout(data: Extract<CanvasNode["data"], { kind: "imageTask" }>) {
  const batch = data.task.batches.at(-1);
  const outputs = batch?.outputs.filter(output => output.status === "success" && output.url) || [];
  const expanded = isCanvasImageBatchExpanded(batch);
  const card = getCanvasTaskPrimaryFrameSize(data);
  const columns = expanded ? Math.min(2, outputs.length) : 1;
  const rows = expanded ? Math.ceil(outputs.length / columns) : 1;
  const gap = 12;
  const primaryIndex = (rows - 1) * columns;
  const primaryOutput = getCanvasPrimaryImageOutput(batch);
  if (expanded && primaryOutput) {
    outputs.splice(outputs.findIndex(output => output.id === primaryOutput.id), 1);
    outputs.splice(primaryIndex, 0, primaryOutput);
  }
  return {
    expanded, outputs, card, columns, gap,
    width: card.width * columns + gap * (columns - 1),
    height: card.height * rows + gap * (rows - 1),
    primary: {
      x: 0,
      y: (rows - 1) * (card.height + gap),
      ...card,
    },
  };
}

export function getCanvasTaskResultFrameSize(data: Extract<CanvasNode["data"], { kind: "imageTask" | "videoTask" | "audioTask" }>) {
  if (data.kind !== "imageTask") return getCanvasTaskPrimaryFrameSize(data);
  const { width, height } = getCanvasImageResultLayout(data);
  return { width, height };
}

export function normalizeCanvasTaskNodeSizes(document: CanvasDocumentV2): CanvasDocumentV2 {
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.data.kind !== "imageTask" && node.data.kind !== "videoTask" && node.data.kind !== "audioTask" && node.data.kind !== "llm") return node;
    const size = node.data.kind === "llm" ? getCanvasTextTaskFrameSize(node.data) : getCanvasTaskResultFrameSize(node.data);
    if (node.width === size.width && node.height === size.height) return node;
    changed = true;
    return { ...node, ...size };
  });
  return changed ? { ...document, nodes } : document;
}
