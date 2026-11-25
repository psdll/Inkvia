import type { DirectMediaAuthorization } from './media-authorization';
import type { MediaMatchingContext } from "./matching";
import "server-only";

import { z } from "zod";
import { v5 as uuidv5 } from "uuid";
import prisma from "@/lib/prisma";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { submitCanvasMutation } from "@/lib/canvas/mutation-service";
import { createPrismaCanvasMutationStore, readCanvasBootstrapPage } from "@/lib/canvas/prisma-mutation-store";
import type { CanvasNode } from "@/lib/canvas/document";
import type { CanvasMutationRequest } from "@/lib/canvas/mutation-contract";
import type { CanvasOperation } from "@/lib/canvas/operations";
import type { CreativeAgentSelection } from "./contracts";
import { requireCreativeAgentCanvas } from "./access";
import { CreativeAgentError } from "./errors";
import { creativeAgentStore } from "./store";
import { assertDurableWorkAdmission } from "@/lib/maintenance";

export type CreativeAgentToolInput = {
  actorUserId: number; canvasId: number; runId: string; actionId: string; epoch: number; kind: string; args: unknown;
  matching?: MediaMatchingContext; mediaAuthorization?: DirectMediaAuthorization; mediaApproval?: { decisionId: string; proposalHash: string };
  signal?: AbortSignal;
};
export type AgentCanvasSnapshot = { revision: string; nodes: CanvasNode[]; edgeIds: string[] };
type CanvasReceipt = { revision: string; nodeIds: string[] };
type CanvasToolDependencies = {
  read(input: CreativeAgentToolInput, nodeIds?: string[]): Promise<AgentCanvasSnapshot>;
  receipt(input: CreativeAgentToolInput, mutationId: string): Promise<CanvasReceipt | null>;
  commit(input: CreativeAgentToolInput, request: CanvasMutationRequest): Promise<{ revision: string }>;
};
const namespace = "98782556-9464-4f04-a3cd-5f42f93f6a22";
export const creativeAgentStableId = (value: string) => uuidv5(value, namespace);
const entityId = z.string().min(1).max(256);
const readSchema = z.object({ nodeIds: z.array(entityId).max(100).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() }).strict();
const createSchema = z.object({
  nodes: z.array(z.object({
    kind: z.enum(["prompt", "group"]), title: z.string().min(1).max(150), text: z.string().max(20000).optional(),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
  }).strict()).min(1).max(30),
}).strict();
const patchSchema = z.object({
  nodeId: entityId, expectedHash: z.string().length(64),
  patch: z.object({ text: z.string().max(20000).optional(), title: z.string().min(1).max(150).optional() }).strict()
    .refine(patch => Object.keys(patch).length > 0, "需要指定修改内容"),
}).strict();

export function creativeAgentNodeHash(node: CanvasNode) {
  // Layout is not an asset version. Data changes are significant, including selected output.
  const { generatorPanelSize: _panel, ...data } = node.data as CanvasNode["data"] & { generatorPanelSize?: unknown };
  return hashCanvasMutationPayload({ id: node.id, data });
}

export async function readCreativeAgentCanvas(actorUserId: number, canvasId: number, nodeIds?: string[]): Promise<AgentCanvasSnapshot> {
  const nodes: CanvasNode[] = [];
  const edgeIds: string[] = [];
  let revision: string | undefined;
  let nodeCursor: string | undefined;
  let edgeCursor: string | undefined;
  let hasMore = false;
  // Every page is pinned to the first committed revision by the existing reader.
  do {
    const page = await readCanvasBootstrapPage(prisma, {
      actorUserId, canvasId, readOnly: true, limit: 1000, nodeCursor, edgeCursor, ...(nodeIds ? { nodeIds } : {}),
      ...(revision ? { baseRevision: BigInt(revision) } : {}),
    });
    if (page.kind !== "ok") throw new CreativeAgentError("CANVAS_READ_CHANGED", "画布状态已变化，请重新读取", 409);
    revision = page.revision;
    for (const node of page.nodes) if (!nodes.some(existing => existing.id === node.id)) nodes.push(node);
    for (const edge of page.edges) if (!edgeIds.includes(edge.id)) edgeIds.push(edge.id);
    hasMore = Boolean(page.nextNodeCursor || page.nextEdgeCursor);
    nodeCursor = page.nextNodeCursor || page.nodes.at(-1)?.id || nodeCursor;
    edgeCursor = page.nextEdgeCursor || page.edges.at(-1)?.id || edgeCursor;
  } while (hasMore);
  return { revision: revision!, nodes, edgeIds };
}

export function resolveCreativeAgentSelection(canvasId: number, snapshot: AgentCanvasSnapshot, selection: CreativeAgentSelection): CreativeAgentSelection {
  const nodes = new Map(snapshot.nodes.map(node => [node.id, node]));
  if (selection.nodeIds.some(id => !nodes.has(id)) || selection.edgeIds.some(id => !snapshot.edgeIds.includes(id))) {
    throw new CreativeAgentError("SELECTION_CHANGED", "所选画布内容已变化，请重新选择");
  }
  return {
    nodeIds: [...new Set(selection.nodeIds)], edgeIds: [...new Set(selection.edgeIds)],
    references: selection.references.map(ref => {
      const node = nodes.get(ref.nodeId);
      if (!node || ref.canvasId !== canvasId || !selection.nodeIds.includes(ref.nodeId) || ref.kind !== node.data.kind) {
        throw new CreativeAgentError("REFERENCE_INVALID", "引用不属于当前画布选区", 400);
      }
      const hash = creativeAgentNodeHash(node);
      if (ref.semanticHash && ref.semanticHash !== hash) throw new CreativeAgentError("REFERENCE_CHANGED", "引用内容已变化，请重新选择");
      if (node.data.kind === "imageTask") {
        const batch = node.data.task.batches.find(item => item.id === ref.batchId);
        const output = batch?.outputs.find(item => item.id === ref.outputId);
        if (!output || output.status !== "success" || !output.url || (ref.mediaId && ref.mediaId !== output.mediaId)
          || (ref.generationId && ref.generationId !== output.generationId)) {
          throw new CreativeAgentError("REFERENCE_OUTPUT_CHANGED", "引用的图片版本已失效，请重新选择");
        }
      } else if (node.data.kind === "videoTask" || node.data.kind === "audioTask") {
        if (node.data.status !== "success" || !node.data.outputUrl || (ref.outputId && ref.outputId !== node.data.requestKey)
          || (ref.generationId && ref.generationId !== node.data.generationId)
          || (ref.mediaId && (!("mediaId" in node.data) || ref.mediaId !== node.data.mediaId)) || ref.batchId) {
          throw new CreativeAgentError("REFERENCE_OUTPUT_CHANGED", "引用的媒体版本已变化，请重新选择");
        }
      } else if (ref.mediaId && (!("mediaId" in node.data) || ref.mediaId !== node.data.mediaId)) {
        throw new CreativeAgentError("REFERENCE_MEDIA_CHANGED", "引用的媒体已变化，请重新选择");
      }
      if (node.data.kind !== "imageTask" && node.data.kind !== "videoTask" && node.data.kind !== "audioTask" && (ref.batchId || ref.outputId || ref.generationId)) {
        throw new CreativeAgentError("REFERENCE_OUTPUT_INVALID", "该节点不包含指定的生成版本", 400);
      }
      return { ...ref, semanticHash: hash };
    }),
  };
}

const dependencies: CanvasToolDependencies = {
  read: (input, nodeIds) => readCreativeAgentCanvas(input.actorUserId, input.canvasId, nodeIds),
  async receipt(input, mutationId) {
    const row = await prisma.canvasMutation.findFirst({
      where: { canvasId: input.canvasId, actorUserId: input.actorUserId, clientMutationId: mutationId },
      select: { revision: true, operations: true },
    });
    if (!row) return null;
    const operations = row.operations as unknown as CanvasOperation[];
    return { revision: row.revision.toString(), nodeIds: operations.flatMap(op => op.kind === "node.create" ? [op.node.id] : "nodeId" in op ? [op.nodeId] : []) };
  },
  commit: (input, request) => submitCanvasMutation({ actorUserId: input.actorUserId, canvasId: input.canvasId, input: request }, createPrismaCanvasMutationStore(prisma)),
};

export async function executeCreativeAgentCanvasTool(input: CreativeAgentToolInput, deps: CanvasToolDependencies = dependencies) {
  if (deps === dependencies) await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, input.kind !== "canvas.read");
  const mutationId = creativeAgentStableId(`${input.runId}:${input.actionId}:canvas`);
  if (input.kind === "canvas.create" || input.kind === "canvas.patch") {
    const receipt = await deps.receipt(input, mutationId);
    if (receipt) {
      const canUndo = deps === dependencies && Boolean(await prisma.appSetting.findUnique({ where: { key: `creative-agent:undo:v1:${input.actionId}` } }));
      return { ...receipt, idempotent: true, canUndo };
    }
  }
  const readArgs = input.kind === "canvas.read" ? readSchema.parse(input.args) : undefined;
  const snapshot = await deps.read(input, readArgs?.nodeIds);
  if (input.kind === "canvas.read") {
    const args = readArgs!;
    const matching = args.nodeIds ? snapshot.nodes.filter(node => args.nodeIds!.includes(node.id)) : snapshot.nodes;
    const offset = args.offset || 0;
    const nodes = matching.slice(offset, offset + (args.limit || 40));
    return { revision: snapshot.revision, total: matching.length, nextOffset: offset + nodes.length < matching.length ? offset + nodes.length : null,
      nodes: nodes.map(node => ({ id: node.id, data: node.data, semanticHash: creativeAgentNodeHash(node) })) };
  }
  if (input.kind === "canvas.focus") {
    const { nodeId } = z.object({ nodeId: entityId }).strict().parse(input.args);
    if (!snapshot.nodes.some(node => node.id === nodeId)) throw new CreativeAgentError("NODE_NOT_FOUND", "节点已不存在", 404);
    return { nodeIds: [nodeId], focus: true };
  }
  let operations: CanvasOperation[];
  let undo: import("./undo").CreativeUndo = [];
  let nodeIds: string[];
  if (input.kind === "canvas.create") {
    const args = createSchema.parse(input.args);
    const right = snapshot.nodes.reduce((x, node) => Math.max(x, node.position.x + (node.width || 360)), 0);
    const nodes: CanvasNode[] = args.nodes.map((item, index) => ({
      id: creativeAgentStableId(`${input.runId}:${input.actionId}:node:${index}`), type: item.kind,
      position: item.position || { x: right + 100 + (index % 3) * 440, y: Math.floor(index / 3) * 400 },
      width: item.kind === "group" ? 400 : 360,
      data: item.kind === "prompt" ? { kind: "prompt", title: item.title, text: item.text || "", format: "markdown" } : { kind: "group", title: item.title, collapsed: false },
    }));
    undo = nodes.map(node => ({ nodeId: node.id, expectedHash: creativeAgentNodeHash(node), previous: null }));
    nodeIds = nodes.map(node => node.id);
    operations = nodes.map((node, index) => ({ opId: `${mutationId}:${index}`, kind: "node.create", node }));
  } else if (input.kind === "canvas.patch") {
    const args = patchSchema.parse(input.args);
    const node = snapshot.nodes.find(node => node.id === args.nodeId);
    if (!node) throw new CreativeAgentError("NODE_NOT_FOUND", "节点已不存在", 404);
    if (creativeAgentNodeHash(node) !== args.expectedHash) throw new CreativeAgentError("TARGET_CHANGED", "节点内容已修改，请重新读取后再修改");
    if (node.data.kind !== "prompt" && node.data.kind !== "group") throw new CreativeAgentError("PATCH_NOT_SUPPORTED", "该节点只能通过对应创作工具修改", 400);
    if (node.data.kind === "group" && args.patch.text !== undefined) throw new CreativeAgentError("PATCH_NOT_SUPPORTED", "分组没有文本内容", 400);
    const updated = { ...node, data: { ...node.data, ...args.patch } } as CanvasNode;
    undo = [{ nodeId: node.id, expectedHash: creativeAgentNodeHash(updated), previous: { ...(args.patch.title !== undefined ? { title: node.data.title || "" } : {}), ...(args.patch.text !== undefined && node.data.kind === "prompt" ? { text: node.data.text } : {}) } }];
    nodeIds = [node.id];
    operations = [{ opId: `${mutationId}:0`, kind: "node.patch", nodeId: node.id, patch: { data: args.patch } }];
  } else throw new CreativeAgentError("TOOL_NOT_SUPPORTED", "创作工具暂不可用", 400);
  if (deps === dependencies && undo.length) {
    const { creativeUndoKey } = await import("./undo");
    const key = creativeUndoKey(input.actionId);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(undo) }, update: {} });
  }
  const result = await deps.commit(input, { protocolVersion: 1, clientMutationId: mutationId, clientSequence: 0, baseRevision: snapshot.revision, operations });
  return { revision: result.revision, nodeIds, canUndo: undo.length > 0 };
}

export async function executeCreativeAgentTool(input: CreativeAgentToolInput) {
  const run = await creativeAgentStore.assertFence(input.runId, input.epoch);
  if (run.actorUserId !== input.actorUserId || run.canvasId !== input.canvasId) {
    throw new CreativeAgentError("RUN_SCOPE_INVALID", "任务操作范围不匹配", 403);
  }
  await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, true);
  await assertDurableWorkAdmission();
  if (input.kind === "material.prepare") {
    const { attachmentIds } = z.object({ attachmentIds: z.array(z.string().uuid()).min(1).max(6) }).strict().parse(input.args);
    const prepared = await (await import("./reference-preparation")).prepareHistoricalCreativeAgentReferences(input, attachmentIds);
    return { ...prepared, nodeIds: prepared.selection.nodeIds, references: prepared.selection.references, message: `已准备 ${prepared.selection.references.length} 个参考素材，现有节点已复用。` };
  }
  if (input.kind === "media.inspect") return (await import("./media-inspection")).inspectCreativeMedia({ ...input, args: input.args as Record<string, unknown> });
  if (input.kind.startsWith("project.")) return (await import("./project-state")).executeCreativeProjectTool({ ...input, args: input.args as Record<string, unknown> });
  if (input.kind === "artifact.review") {
    const snapshot = await readCreativeAgentCanvas(input.actorUserId, input.canvasId);
    return (await import("./artifact-review")).reviewCreativeArtifact(input.args, snapshot.nodes.map(node => node.id));
  }
  if (input.kind === "history.read") {
    const { query, offset = 0 } = z.object({ query: z.string().min(1).max(200), offset: z.number().int().nonnegative().optional() }).parse(input.args);
    const transcript = await creativeAgentStore.getTranscript(run.sessionId) as { role: string; content: unknown; timestamp?: number }[];
    const matches = transcript.flatMap(message => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      const text = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.filter(part => part.type === "text").map(part => part.text).join("\n") : "";
      const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      return at < 0 ? [] : [{ role: message.role, timestamp: message.timestamp, text: text.slice(Math.max(0, at - 1500), at + 6000), excerpt: text.length > 6000 }];
    });
    return { total: matches.length, matches: matches.slice(offset, offset + 5), nextOffset: offset + 5 < matches.length ? offset + 5 : null };
  }
  if (input.kind.startsWith("canvas.")) return executeCreativeAgentCanvasTool(input);
  if (["image.generate", "video.generate", "generation.read", "generation.models", "model.guidance"].includes(input.kind)) {
    return (await import("./media-broker")).executeCreativeAgentMediaTool(input);
  }
  throw new CreativeAgentError("TOOL_NOT_SUPPORTED", "创作工具暂不可用", 400);
}
