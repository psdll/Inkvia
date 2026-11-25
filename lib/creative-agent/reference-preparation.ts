import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import prisma from "@/lib/prisma";
import { submitCanvasMutation } from "@/lib/canvas/mutation-service";
import { createPrismaCanvasMutationStore } from "@/lib/canvas/prisma-mutation-store";
import { getCanvasLocalUploadPositions } from "@/lib/canvas/material-placement";
import { getCanvasMediaNodeSize, DEFAULT_CANVAS_AUDIO_NODE_SIZE } from "@/lib/canvas/media-size";
import type { CanvasNode } from "@/lib/canvas/document";
import type { CanvasMutationRequest } from "@/lib/canvas/mutation-contract";
import { resolveCreativeAgentAttachments, type CreativeAgentAttachmentRecord } from "./attachments";
import { checkedMediaFile, probeRuntimeMedia, type MediaFacts } from "./media-files";
import { creativeAgentNodeHash, creativeAgentStableId, readCreativeAgentCanvas, resolveCreativeAgentSelection, type AgentCanvasSnapshot } from "./canvas-tools";
import { creativeAgentStore } from "./store";
import { requireCreativeAgentCanvas } from "./access";
import { CreativeAgentError } from "./errors";
import type { Run } from "./store-types";
import type { CreativeAgentReference } from "./contracts";

type Mapping = { sha256: string; reference: CreativeAgentReference };
type Dependencies = {
  attachments(input: Run["input"]): Promise<CreativeAgentAttachmentRecord[]>;
  read(run: Run): Promise<AgentCanvasSnapshot>;
  contentHash(url: string, kind: string): Promise<string>;
  mediaFacts(record: CreativeAgentAttachmentRecord): Promise<MediaFacts>;
  loadMapping(run: Run, attachmentId: string): Promise<Mapping | null>;
  saveMapping(run: Run, attachmentId: string, mapping: Mapping): Promise<void>;
  guard(run: Run): Promise<unknown>;
  commit(run: Run, request: CanvasMutationRequest): Promise<{ revision: string }>;
};
const referenceIdentity = (reference: CreativeAgentReference) => JSON.stringify([reference.canvasId, reference.nodeId, reference.batchId, reference.outputId, reference.mediaId, reference.generationId, reference.purpose]);
const mappingKey = (run: Run, id: string) => `creative-agent:reference:v1:${run.actorUserId}:${run.canvasId}:${run.sessionId}:${id}`;
const dependencies: Dependencies = {
  attachments: resolveCreativeAgentAttachments,
  read: run => readCreativeAgentCanvas(run.actorUserId, run.canvasId),
  async contentHash(url, kind) {
    const { local } = await checkedMediaFile(url, kind);
    return createHash("sha256").update(await readFile(local)).digest("hex");
  },
  mediaFacts: record => record.facts ? Promise.resolve(record.facts) : probeRuntimeMedia(record.url, "image"),
  async loadMapping(run, id) {
    const row = await prisma.appSetting.findUnique({ where: { key: mappingKey(run, id) } });
    return row ? JSON.parse(row.value) : null;
  },
  async saveMapping(run, id, mapping) {
    const key = mappingKey(run, id), value = JSON.stringify(mapping);
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  },
  guard: run => creativeAgentStore.assertFence(run.id, run.epoch),
  commit: (run, input) => submitCanvasMutation({ actorUserId: run.actorUserId, canvasId: run.canvasId, input }, createPrismaCanvasMutationStore(prisma)),
};

/** Only sent, scoped attachments reach this bridge. Documents remain model text. */
export async function prepareCreativeAgentReferences(run: Run, deps: Dependencies = dependencies, signal?: AbortSignal, onVerified?: (records: CreativeAgentAttachmentRecord[]) => void) {
  const guard = async () => { signal?.throwIfAborted(); await deps.guard(run); signal?.throwIfAborted(); };
  await guard();
  if (deps === dependencies) await requireCreativeAgentCanvas(run.actorUserId, run.canvasId, true);
  const records = await deps.attachments({ ...run.input, sessionId: run.sessionId });
  for (let attempt = 0; attempt < 4; attempt++) {
    await guard();
    const snapshot = await deps.read(run);
    const selection = resolveCreativeAgentSelection(run.canvasId, snapshot, run.input.selection);
    const referenceIds = new Set<string>();
    selection.references = selection.references.map(reference => {
      const node = snapshot.nodes.find(node => node.id === reference.nodeId)!;
      return ["image", "video", "audio"].includes(node.data.kind) && "mediaId" in node.data && node.data.mediaId
        ? { ...reference, mediaId: node.data.mediaId } : reference;
    }).filter(reference => {
      const id = referenceIdentity(reference);
      if (referenceIds.has(id)) return false;
      referenceIds.add(id);
      return true;
    });
    const pending: CanvasNode[] = [];
    const mappings: { attachmentId: string; mapping: Mapping }[] = [];
    const hashes = new Map<string, string>();
    for (const record of records) {
      if (record.mimeType === "text/plain") continue;
      const kind = record.mimeType.startsWith("image/") ? "image" : record.facts?.kind;
      if (kind !== "image" && kind !== "video" && kind !== "audio") throw new CreativeAgentError("ATTACHMENT_INVALID", `附件 ${record.name} 不是已验证的媒体`, 400);
      const stableId = creativeAgentStableId(`reference:${run.canvasId}:${kind}:${record.sha256}`);
      const prior = await deps.loadMapping(run, record.id);
      let node = snapshot.nodes.find(node => node.id === stableId || (prior?.sha256 === record.sha256 && node.id === prior.reference.nodeId && creativeAgentNodeHash(node) === prior.reference.semanticHash));
      // Content equality is proved from the original local bytes, never a filename or preview.
      if (node) {
        const data = node.data;
        if (data.kind !== kind || !("url" in data)) node = undefined;
        else if (await deps.contentHash(data.variants?.original?.url || data.url, kind).catch(() => null) !== record.sha256) node = undefined;
      }
      if (!node) for (const candidate of snapshot.nodes) {
        if (candidate.data.kind !== kind || !("url" in candidate.data)) continue;
        const url = candidate.data.variants?.original?.url || candidate.data.url;
        if (!hashes.has(url)) {
          const value = await deps.contentHash(url, kind).catch(() => null);
          if (value) hashes.set(url, value);
        }
        if (hashes.get(url) === record.sha256) { node = candidate; break; }
      }
      node ||= pending.find(item => item.id === stableId);
      if (!node) {
        if (snapshot.nodes.some(item => item.id === stableId)) throw new CreativeAgentError("REFERENCE_CHANGED", `附件 ${record.name} 的源节点已修改，请重新选择`, 409);
        const facts = await deps.mediaFacts(record);
        if (facts.state !== "verified" || facts.kind !== kind || facts.contentVersion !== record.sha256) throw new CreativeAgentError("ATTACHMENT_INVALID", `附件 ${record.name} 的媒体尺寸无法验证或内容已变化`, 400);
        const size = kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE : getCanvasMediaNodeSize(facts.width || 0, facts.height || 0);
        const position = getCanvasLocalUploadPositions([size], { x: 0, y: 0 }, [...snapshot.nodes, ...pending])[0];
        node = { id: stableId, type: kind, position, ...size, data: { kind, origin: "upload", url: record.url, name: record.name } };
        pending.push(node);
      }
      const reference: CreativeAgentReference = { canvasId: run.canvasId, nodeId: node.id, kind, label: record.name, semanticHash: creativeAgentNodeHash(node), ...("mediaId" in node.data && node.data.mediaId ? { mediaId: node.data.mediaId } : {}) };
      if (!selection.nodeIds.includes(node.id)) selection.nodeIds.push(node.id);
      // Keep first appearance order; the same media version is sent once.
      const identity = referenceIdentity(reference);
      if (!referenceIds.has(identity)) { selection.references.push(reference); referenceIds.add(identity); }
      mappings.push({ attachmentId: record.id, mapping: { sha256: record.sha256, reference } });
    }
    await guard();
    let revision = snapshot.revision;
    if (pending.length) {
      const mutationId = creativeAgentStableId(`reference:${run.id}:${run.input.messageId}:${snapshot.revision}:${pending.map(node => node.id).join(":")}`);
      try {
        revision = (await deps.commit(run, { protocolVersion: 1, clientMutationId: mutationId, clientSequence: 0, baseRevision: snapshot.revision, operations: pending.map((node, index) => ({ opId: `${mutationId}:${index}`, kind: "node.create", node })) })).revision;
      } catch (error) {
        if ((error as { code?: string }).code === "CANVAS_REVISION_CONFLICT" && attempt < 3) continue;
        throw error;
      }
    }
    await guard();
    for (const { attachmentId, mapping } of mappings) {
      await guard();
      await deps.saveMapping(run, attachmentId, mapping);
    }
    await guard();
    onVerified?.(records);
    return { selection, revision };
  }
  throw new CreativeAgentError("CANVAS_REVISION_CONFLICT", "画布持续变化，请重试引用准备", 409);
}

/** Legacy attachments are prepared only after an explicit tool selection, never on conversation load. */
export async function prepareHistoricalCreativeAgentReferences(
  input: Pick<import("./canvas-tools").CreativeAgentToolInput, "actorUserId" | "canvasId" | "runId" | "epoch" | "signal">,
  attachmentIds: string[],
  deps: { store: Pick<typeof creativeAgentStore, "assertFence" | "getHistoricalAttachmentIds">; prepare: typeof prepareCreativeAgentReferences } = { store: creativeAgentStore, prepare: prepareCreativeAgentReferences },
) {
  input.signal?.throwIfAborted();
  const run = await deps.store.assertFence(input.runId, input.epoch);
  if (run.actorUserId !== input.actorUserId || run.canvasId !== input.canvasId) throw new CreativeAgentError("RUN_SCOPE_INVALID", "历史附件操作范围不匹配", 403);
  if (!attachmentIds.length || attachmentIds.length > 6 || new Set(attachmentIds).size !== attachmentIds.length) throw new CreativeAgentError("ATTACHMENT_INVALID", "请选择一至六个不同的历史附件", 400);
  const sent = new Set(await deps.store.getHistoricalAttachmentIds(run));
  for (const id of attachmentIds) if (!sent.has(id)) throw new CreativeAgentError("ATTACHMENT_NOT_FOUND", `历史附件 ${id} 不属于当前对话已发送的消息`, 404);
  return deps.prepare({ ...run, input: { ...run.input, attachments: attachmentIds.map(id => ({ id })), selection: { nodeIds: [], edgeIds: [], references: [] } } }, undefined, input.signal);
}

/** Authorize one explicitly requested node from durable sent-attachment evidence, including a later session. */
export async function resolvePreparedCreativeMedia(
  input: Pick<import("./canvas-tools").CreativeAgentToolInput, "actorUserId" | "canvasId" | "runId" | "epoch" | "signal">,
  node: CanvasNode,
): Promise<string | null> {
  input.signal?.throwIfAborted();
  const run = await creativeAgentStore.assertFence(input.runId, input.epoch);
  if (run.actorUserId !== input.actorUserId || run.canvasId !== input.canvasId) throw new CreativeAgentError("RUN_SCOPE_INVALID", "媒体观察范围不匹配", 403);
  const data = node.data;
  if (data.kind !== "image" && data.kind !== "video" && data.kind !== "audio") return null;
  const prefix = `creative-agent:reference:v1:${input.actorUserId}:${input.canvasId}:`;
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: prefix }, value: { contains: node.id } }, select: { key: true, value: true } });
  let unavailable: CreativeAgentError | undefined;
  for (const row of rows) {
    if (!row.key.startsWith(prefix)) continue;
    const suffix = row.key.slice(prefix.length), separator = suffix.lastIndexOf(":");
    if (separator <= 0 || separator === suffix.length - 1) continue;
    const sessionId = suffix.slice(0, separator), attachmentId = suffix.slice(separator + 1);
    let mapping: Mapping;
    try { mapping = JSON.parse(row.value); } catch { continue; }
    if (!mapping || typeof mapping !== "object") continue;
    if (mapping.reference?.nodeId !== node.id || mapping.reference.canvasId !== input.canvasId || mapping.reference.kind !== data.kind
      || mapping.reference.semanticHash !== creativeAgentNodeHash(node) || !/^[a-f0-9]{64}$/.test(mapping.sha256)) continue;
    if (!await creativeAgentStore.hasSentAttachment(input.actorUserId, input.canvasId, sessionId, attachmentId)) continue;
    let record: CreativeAgentAttachmentRecord;
    try {
      [record] = await resolveCreativeAgentAttachments({ actorUserId: input.actorUserId, canvasId: input.canvasId, sessionId, attachments: [{ id: attachmentId }] });
    } catch (error) {
      if (error instanceof CreativeAgentError && error.status !== 403 && ["ATTACHMENT_INVALID", "ATTACHMENT_NOT_FOUND"].includes(error.code)) { unavailable = error; continue; }
      throw error;
    }
    const recordKind = record.mimeType.startsWith("image/") ? "image" : record.facts?.kind;
    if (record.sha256 !== mapping.sha256 || recordKind !== data.kind) continue;
    // A reused canvas original may use another URL. Prove byte equality; never authorize the URL alone.
    const hash = await dependencies.contentHash(data.variants?.original?.url || data.url, data.kind).catch(() => null);
    if (hash !== mapping.sha256) continue;
    input.signal?.throwIfAborted();
    await creativeAgentStore.assertFence(input.runId, input.epoch);
    return record.url;
  }
  if (unavailable) throw unavailable;
  return null;
}
