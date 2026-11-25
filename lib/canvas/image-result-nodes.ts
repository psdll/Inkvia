import type { CanvasDocumentV2, CanvasNode } from "./document";
import { CANVAS_GROUP_GAP } from "./group-layout";
import { getCanvasImageOutputName } from "./material-name";
import { getCanvasTaskResultFrameSize } from "./task-references";
import { getCanvasLocalUploadPositions } from "./material-placement";

/** Split completed outputs into independent nodes; grouping remains an explicit user action. */
export function splitCanvasImageResults(document: CanvasDocumentV2): CanvasDocumentV2 {
  let next = document;
  for (const node of document.nodes) {
    if (node.data.kind !== "imageTask") continue;
    const task = node.data.task;
    const batch = task.batches.at(-1);
    if (!batch || batch.outputs.length < 2
      || batch.outputs.some(output => ["idle", "submitting", "running"].includes(output.status))
      || !batch.outputs.some(output => output.status === "success" && output.url)) continue;

    const columns = Math.min(2, batch.outputs.length);
    const size = getCanvasTaskResultFrameSize(node.data);
    const children: CanvasNode[] = batch.outputs.map((output, index) => {
      const singleBatch = { ...batch, outputs: [{ ...output, name: getCanvasImageOutputName(document, node.id, batch.id, output.id) }] };
      const data: CanvasNode["data"] = {
        kind: "imageTask",
        task: {
          ...task,
          // The original keeps its history and requested count. New independent nodes generate one image.
          settings: index === 0 ? task.settings : { ...batch.settings, count: 1 },
          batches: index === 0 ? [...task.batches.slice(0, -1), singleBatch] : [singleBatch],
        },
      };
      return {
        ...node,
        id: index === 0 ? node.id : `image-result-${node.id}-${batch.id}-${output.id}`,
        data,
        ...getCanvasTaskResultFrameSize(data),
        position: {
          x: node.position.x + (index % columns) * (size.width + CANVAS_GROUP_GAP),
          y: node.position.y + Math.floor(index / columns) * (size.height + CANVAS_GROUP_GAP),
        },
      };
    });
    const occupied = next.nodes
      .filter(candidate => candidate.id !== node.id && candidate.parentId === node.parentId && !candidate.hidden)
      .map(candidate => ({ ...candidate, parentId: undefined }));
    occupied.push({ ...children[0], parentId: undefined });
    for (const child of children.slice(1)) {
      child.position = getCanvasLocalUploadPositions(
        [{ width: child.width!, height: child.height! }], child.position, occupied,
      )[0];
      occupied.push({ ...child, parentId: undefined });
    }
    const incoming = next.edges.filter(edge => edge.target === node.id);
    const outgoing = next.edges.filter(edge => edge.source === node.id
      && next.nodes.find(target => target.id === edge.target)?.data.kind !== "compare");
    next = {
      ...next,
      nodes: next.nodes.flatMap(candidate => candidate.id === node.id ? children : [candidate]),
      edges: [...next.edges, ...children.slice(1).flatMap(child => [
        ...incoming.map(edge => ({ ...edge, id: `${edge.id}-${child.id}`, target: child.id })),
        ...outgoing.map(edge => ({ ...edge, id: `${edge.id}-${child.id}`, source: child.id })),
      ])],
    };
  }
  return next;
}

/** Restore results that older versions automatically split into separate nodes. */
export function mergeCanvasImageResultNodes(document: CanvasDocumentV2): CanvasDocumentV2 {
  const replacements = new Map<string, string>();
  const restored = new Map<string, CanvasNode>();
  for (const node of document.nodes) {
    if (node.data.kind !== "imageTask") continue;
    const task = node.data.task;
    const batch = task.batches.at(-1);
    if (!batch) continue;
    const outputs = [...batch.outputs];
    for (const child of document.nodes) {
      if (child.id === node.id || child.parentId !== node.parentId || child.data.kind !== "imageTask") continue;
      const childBatch = child.data.task.batches.at(-1);
      const output = childBatch?.outputs[0];
      if (!output || childBatch?.id !== batch.id || childBatch.outputs.length !== 1
        || child.id !== `image-result-${node.id}-${batch.id}-${output.id}`) continue;
      if (!outputs.some(item => item.id === output.id)) outputs.push(output);
      replacements.set(child.id, node.id);
    }
    if (outputs.length !== batch.outputs.length) restored.set(node.id, {
      ...node,
      data: { ...node.data, task: { ...task, batches: [...task.batches.slice(0, -1), { ...batch, outputs }] } },
    });
  }
  if (!replacements.size) return document;
  const identities = new Set<string>();
  const edges = document.edges.flatMap(edge => {
    const source = replacements.get(edge.source) || edge.source;
    const target = replacements.get(edge.target) || edge.target;
    const identity = JSON.stringify([source, target, edge.sourceHandle, edge.targetHandle, edge.type]);
    if (source === target || identities.has(identity)) return [];
    identities.add(identity);
    return [{ ...edge, source, target }];
  });
  return {
    ...document,
    nodes: document.nodes.filter(node => !replacements.has(node.id)).map(node => restored.get(node.id) || node),
    edges,
  };
}
