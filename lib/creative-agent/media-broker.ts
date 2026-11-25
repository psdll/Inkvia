import { directMediaAuthorization } from './media-authorization';
import type { Decision } from './store-types';
import { matchMediaCandidates, type SelectionReceipt, type CapabilityEvidence } from "./matching";
import { presentGenerationStep } from "./media-presentation";
import { generationAllowance, generationExecution, reserveGenerationQuantity } from "./quantity";
import type { MessageInput } from "./store-types";
import { bindCreativeReferenceFacts } from "./reference-facts";
import { imageSchema, videoSchema, normalizeCreativeMediaRequest, type CreativeAgentMediaReference, type ResolvedReference, type MediaCatalog } from "./media-capabilities";
import "server-only";

import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseFriendlyMessageFromStorage, toFriendlyError } from "@/lib/error-friendly";
import { assertDurableWorkAdmission } from "@/lib/maintenance";
import { GENERATION_FINALIZE_BACKOFF_MS } from "@/lib/generation/finalize-scheduler";
import { v5 as uuidv5 } from "uuid";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { createImageGeneration, type CreateImageGenerationInput } from "@/lib/generation/image-service";
import { createVideoGeneration, type CreateVideoGenerationInput } from "@/lib/generation/video-service";
import { finalizeGeneration, recoverStaleProcessingGeneration } from "@/lib/generation/finalize";
import { getEffectiveCreativeMediaCatalog } from "./effective-media-catalog";
import { getCanvasGenerationOutputs, type CanvasGenerationOutput } from "@/lib/canvas/generation-outputs";
import { getOrCreateGenerationMediaAsset } from "@/lib/canvas/generation-media";
import { getCanvasLocalUploadPositions } from "@/lib/canvas/material-placement";
import { readCreativeAgentMediaSize } from "./media-output";
import { buildCreativeAgentMediaTask } from "./media-task";
import { submitCanvasMutation } from "@/lib/canvas/mutation-service";
import { createPrismaCanvasMutationStore } from "@/lib/canvas/prisma-mutation-store";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { normalizeMediaUrl } from "@/lib/media-url";
import type { CanvasNode } from "@/lib/canvas/document";
import type { CanvasOperation } from "@/lib/canvas/operations";
import { getCanvasTaskResultFrameSize } from "@/lib/canvas/task-references";
import { requireCreativeAgentCanvas } from "./access";
import type { CreativeAgentToolInput, AgentCanvasSnapshot } from "./canvas-tools";
import type { DecisionBinding, DecisionPrompt } from "./store-types";
import { modelGuidanceSummary, readModelGuidance } from "./model-guidance";
import { CreativeAgentError } from "./errors";
import { recordCreativeDebug, withDebugSpan } from "./debug-trace";

const stableId = (value: string) => uuidv5(value, "43b3f8e4-59b6-4189-b3e1-0dfd02485b51");
export type { CreativeAgentMediaReference } from "./media-capabilities";
export type CreativeAgentMediaRecord = { id: number; authUserId: number | null; canvasId: number | null; source: string; type: string; model: string | null; prompt?: string | null; requestKey: string | null; status: string; localPath: string | null; templateData: string | null; externalTaskId?: string | null; errorMsg?: string | null; finishedAt?: Date | string | null };
export type CreativeAgentMediaDependencies = {
 readCanvas(input: CreativeAgentToolInput): Promise<AgentCanvasSnapshot>;
 catalog(): Promise<MediaCatalog>;
 bindReference?: typeof bindCreativeReferenceFacts;
 /** Trusted server-maintained comparisons only; never taken from model tool arguments. No current benchmark data is installed. */
 evidence?(): Promise<CapabilityEvidence[]>;
 claimApproval(input: CreativeAgentToolInput, binding: DecisionBinding, requestKeys: string[]): Promise<{ fresh: boolean }>;
 findGeneration(query: { id?: number; requestKey?: string }): Promise<CreativeAgentMediaRecord | null>;
 createImage(input: CreateImageGenerationInput): ReturnType<typeof createImageGeneration>;
 createVideo(input: CreateVideoGenerationInput): ReturnType<typeof createVideoGeneration>;
 finalize(id: number): ReturnType<typeof finalizeGeneration>;
 retryMetadata?(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord): Promise<{ retryOfGenerationId?: number; retryAttempt?: 1; retryReason?: string }>;
 beforeDispatch?(input: CreativeAgentToolInput): Promise<void>;
 markDispatchStarted?(input: CreativeAgentToolInput, requestKey: string): Promise<void>;
 releaseUnused?(input: CreativeAgentToolInput, requestKeys: string[]): Promise<void>;
 observeOutputs?(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, observation: import("./quantity").GenerationObservation): Promise<{frozen?:boolean} | undefined>;
 startTask?(input: CreativeAgentToolInput, requestKey: string, plan: Awaited<ReturnType<typeof prepared>>): Promise<void>;
 syncTask?(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, outputs: CanvasGenerationOutput[]): Promise<{ revision: string; nodeIds: string[] } | null>;
 attach(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, outputs: CanvasGenerationOutput[]): Promise<{ revision: string; nodeIds: string[] }>;
};

type ApprovalEvidence = {
 decision: { id: string; runId: string; actionId: string; proposalHash: string; state: string; answer: unknown; binding?: unknown };
 run: { id: string; actorUserId: number; canvasId: number; epoch: number; status: string; leaseExpiresAt: Date | string | null; input?: unknown };
 action: { id: string; runId: string; actorUserId: number; canvasId: number; epoch: number; kind: string; state: string };
};
function matchesApprovalBinding(binding: DecisionBinding, approved: unknown) {
 if (binding.version === 2) return hashCanvasMutationPayload(approved) === hashCanvasMutationPayload(binding);
 const { retryLimit: _retry, ...legacy } = binding;
 return hashCanvasMutationPayload(approved) === hashCanvasMutationPayload(binding)
  || hashCanvasMutationPayload(approved) === hashCanvasMutationPayload(legacy);
}
export function assertCreativeAgentMediaApproval(input: CreativeAgentToolInput, binding: DecisionBinding, evidence: ApprovalEvidence) {
 const { decision, run, action } = evidence;
 const v2 = input.matching?.policyVersion === 2 || (run.input as MessageInput | undefined)?.matchingPolicyVersion === 2;
 const execution = input.matching?.execution;
 const validV2 = binding.version === 2 && execution && binding.planId && binding.stepId && binding.receiptId && binding.requestHash && binding.limits && Number.isInteger(binding.retryLimit) && binding.retryLimit === binding.limits.retryCalls && binding.expiresAt && Number.isFinite(Date.parse(binding.expiresAt)) && Date.parse(binding.expiresAt) > Date.now() && hashCanvasMutationPayload({planId:binding.planId,stepId:binding.stepId,receiptId:binding.receiptId,requestHash:binding.requestHash,limits:binding.limits,expiresAt:binding.expiresAt}) === hashCanvasMutationPayload(execution);
 if (v2 && !validV2 || !v2 && binding.version === 2) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "方案的数量、步骤或有效期确认不完整");
 if (!input.mediaApproval || input.mediaApproval.decisionId !== decision.id || input.mediaApproval.proposalHash !== decision.proposalHash
   || decision.runId !== input.runId || decision.actionId !== input.actionId || decision.state !== "answered" || decision.answer !== "approve"
   || !decision.binding || !matchesApprovalBinding(binding, decision.binding)
   || run.id !== input.runId || run.actorUserId !== input.actorUserId || run.canvasId !== input.canvasId || run.epoch !== input.epoch
   || !(run.status === "running" || v2 && run.status === "waiting_action") || !run.leaseExpiresAt || new Date(run.leaseExpiresAt).getTime() <= Date.now()
   || action.id !== input.actionId || action.runId !== input.runId || action.actorUserId !== input.actorUserId || action.canvasId !== input.canvasId
   || action.epoch !== input.epoch || action.kind !== input.kind || action.state !== "claimed") {
  throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "生成确认已失效，请重新核对本次素材、参数和次数");
 }
}

function assertDirectMediaAuthorization(input: CreativeAgentToolInput, binding: DecisionBinding, run: ApprovalEvidence['run'], action: ApprovalEvidence['action'], decisions: readonly Decision[]) {
 const execution = input.matching?.execution;
 const expected = directMediaAuthorization({ id: run.id, input: run.input as MessageInput }, input.kind, binding, decisions);
 if (!input.mediaAuthorization || !expected || hashCanvasMutationPayload(expected) !== hashCanvasMutationPayload(input.mediaAuthorization)
   || decisions.some(item => item.actionId === input.actionId)
   || !execution || hashCanvasMutationPayload(execution) !== hashCanvasMutationPayload({planId:binding.planId,stepId:binding.stepId,receiptId:binding.receiptId,requestHash:binding.requestHash,limits:binding.limits,expiresAt:binding.expiresAt})
   || binding.retryLimit !== binding.limits?.retryCalls || !binding.expiresAt || !(Date.parse(binding.expiresAt) > Date.now())
   || run.id !== input.runId || run.actorUserId !== input.actorUserId || run.canvasId !== input.canvasId || run.epoch !== input.epoch
   || !['running','waiting_action'].includes(run.status) || !run.leaseExpiresAt || new Date(run.leaseExpiresAt).getTime() <= Date.now()
   || action.id !== input.actionId || action.runId !== input.runId || action.actorUserId !== input.actorUserId || action.canvasId !== input.canvasId
   || action.epoch !== input.epoch || action.kind !== input.kind || action.state !== 'claimed') {
  throw new CreativeAgentError('MEDIA_AUTHORIZATION_REQUIRED', '当前生成授权、目标或方案已变化，请根据本轮有效要求重新准备。');
 }
}

export async function claimCreativeAgentMediaApproval(input: CreativeAgentToolInput, binding: DecisionBinding, requestKeys: string[]) {
  if (!input.mediaApproval && !input.mediaAuthorization) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "请先确认本次生成的参数和次数");
  return prisma.$transaction(async tx => {
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "CreativeAgentRun" WHERE id=${input.runId} FOR UPDATE`);
   await tx.$queryRaw(Prisma.sql`SELECT id FROM "CreativeAgentAction" WHERE id=${input.actionId} FOR UPDATE`);
   const action = await tx.creativeAgentAction.findUnique({ where: { id: input.actionId } });
   const currentRun = await tx.creativeAgentRun.findUnique({ where: { id: input.runId } });
   if (!action || !currentRun) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "生成运行或动作记录不存在");
   let decisionId: string | undefined;
   if (input.mediaAuthorization) {
    const decisions = await tx.creativeAgentDecision.findMany({ where: { runId: input.runId }, orderBy: { createdAt: 'asc' } });
    assertDirectMediaAuthorization(input, binding, currentRun, action, decisions as unknown as Decision[]);
   } else {
    const decision = await tx.creativeAgentDecision.findUnique({ where: { id: input.mediaApproval!.decisionId } });
    if (!decision) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "生成确认记录不存在");
    assertCreativeAgentMediaApproval(input, binding, { action, decision, run: currentRun });
    decisionId = decision.id;
   }
   if (action.inputHash !== hashCanvasMutationPayload(input.args)) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "动作参数已变化，请重新确认");
   if ((currentRun.input as MessageInput | undefined)?.matchingPolicyVersion === 2) {
    const current = currentRun.input as MessageInput;
    const execution = input.matching!.execution!;
    if (hashCanvasMutationPayload(generationExecution(current, execution.planId, execution.stepId)) !== hashCanvasMutationPayload(execution)) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "本轮数量或方案已变化");
    const updated = reserveGenerationQuantity(current, { ...execution, actionId: input.actionId, requestKeys });
    await tx.creativeAgentRun.update({ where: {id:input.runId}, data:{input:updated as unknown as Prisma.InputJsonValue} });
   }
   if (action.result !== null) return { fresh: false };
   await tx.creativeAgentAction.update({ where: { id: input.actionId }, data: { result: { mediaDispatch: { argsHash: binding.argsHash, ...(decisionId ? { decisionId } : { authorization: input.mediaAuthorization! }), units: binding.units, requestKeys } } } });
   return { fresh: true };
  });

}

const defaults: CreativeAgentMediaDependencies = {
 async readCanvas(input) { const { readCreativeAgentCanvas } = await import("./canvas-tools"); return readCreativeAgentCanvas(input.actorUserId, input.canvasId); },
 catalog: getEffectiveCreativeMediaCatalog,
 bindReference: bindCreativeReferenceFacts,
 claimApproval: claimCreativeAgentMediaApproval,
 findGeneration: query => prisma.generation.findUnique({ where: query.requestKey ? { requestKey: query.requestKey } : { id: query.id! } }),
 createImage: createImageGeneration, createVideo: createVideoGeneration,
 async finalize(id) {
  const row = await prisma.generation.findUnique({ where: { id }, select: { status: true } });
  if (row?.status === "processing") await recoverStaleProcessingGeneration(id);
  return finalizeGeneration(id);
 },
 async retryMetadata(input, row) {
  if (!row.requestKey) return {};
  const records = await prisma.$queryRaw<{ result: { retryOfGenerationId: number; retryAttempt: 1; retryReason: string } }[]>(Prisma.sql`SELECT result FROM "CreativeAgentAction"
   WHERE run_id=${input.runId} AND actor_user_id=${input.actorUserId} AND canvas_id=${input.canvasId}
    AND kind IN ('image.generate','video.generate') AND result->>'retryOfGenerationId' IS NOT NULL
    AND result->'requestKeys' ? ${row.requestKey} LIMIT 1`);
  const saved = records[0]?.result;
  return saved ? { retryOfGenerationId: saved.retryOfGenerationId, retryAttempt: saved.retryAttempt, retryReason: saved.retryReason } : {};
 },
 async beforeDispatch(input) {
  const { creativeAgentStore } = await import("./store");
  const run = await creativeAgentStore.assertFence(input.runId, input.epoch);
  if (run.actorUserId !== input.actorUserId || run.canvasId !== input.canvasId) throw new CreativeAgentError("MEDIA_SCOPE_INVALID", "生成任务范围已变化");
 },
 async markDispatchStarted(input, requestKey) {
  if (input.matching?.policyVersion !== 2) return;
  const { creativeAgentStore } = await import("./store");
  await creativeAgentStore.transitionGenerationStep({id:input.runId, ...input}, requestKey, "started");
 },
 async releaseUnused(input, requestKeys) {
  if (input.matching?.policyVersion !== 2) return;
  const { creativeAgentStore } = await import("./store");
  for (const requestKey of requestKeys) await creativeAgentStore.transitionGenerationStep({id:input.runId, ...input}, requestKey, "released");
 },
 async observeOutputs(input,row,observation) {
  if (!row.requestKey) return;
  const { creativeAgentStore } = await import("./store");
  return creativeAgentStore.observeGenerationOutput({id:input.runId,...input},row.requestKey,observation);
 },
 attach: (input, row, outputs) => attachMedia(input, row, outputs, () => defaults.beforeDispatch!(input)),
 startTask: startMediaTask,
 syncTask: (input, row, outputs) => syncMediaTask(input, row, outputs, () => defaults.beforeDispatch!(input)),
};

const taskNodeId = (canvasId: number, requestKey: string) => stableId(`task:${canvasId}:${requestKey}`);
const startMutationId = (canvasId: number, requestKey: string) => stableId(`start:${canvasId}:${requestKey}`);

async function startMediaTask(input: CreativeAgentToolInput, requestKey: string, plan: Awaited<ReturnType<typeof prepared>>, attempt = 0, retryOfRequestKey?: string, title?: string): Promise<void> {
 const clientMutationId = startMutationId(input.canvasId, requestKey);
 const prior = await prisma.canvasMutation.findFirst({ where: { canvasId: input.canvasId, actorUserId: input.actorUserId, clientMutationId }, select: { revision: true } });
 const nodeId = taskNodeId(input.canvasId, retryOfRequestKey || requestKey);
 let revision = prior?.revision.toString();
 if (!prior) {
  await defaults.beforeDispatch!(input);
  const snapshot = await defaults.readCanvas(input);
  plan.args.references.forEach(reference => resolveReference(snapshot, reference));
  let data = buildCreativeAgentMediaTask({ id: 0, type: input.kind === "image.generate" ? "image_edit" : "video_gen", model: plan.args.model, prompt: plan.args.prompt,
   templateData: JSON.stringify({ ...plan.params, model: plan.args.model, imagePaths: plan.references.map(ref => ref.url) }) }, { mediaId: "", url: "" });
  data.title = title?.trim() || (input.kind === "image.generate" ? "Agent 图片" : "Agent 视频");
  // Agent owns submission and polling. A generationId is added only on settlement,
  // so the manual canvas recovery effect cannot submit or poll this request again.
  if (data.kind === "imageTask") {
   data.task.references = plan.references.map((ref, index) => ({ id: `agent-ref-${requestKey}-${index}`, sourceNodeId: ref.nodeId, url: ref.url, name: `参考图 ${index + 1}`, pinned: true }));
   data.task.referenceOrder = data.task.references.map(ref => ref.id);
   data.task.batches = [{ id: `agent-batch-${requestKey}`, createdAt: Date.now(), settings: { ...data.task.settings }, outputs: [{ id: `agent-output-${requestKey}`, requestKey, status: "running", startedAt: Date.now() }] }];
  } else {
   data.pinnedReferences = plan.references.map((ref, index) => ({ id: `agent-ref-${requestKey}-${index}`, sourceNodeId: ref.nodeId, kind: ref.kind, url: ref.url, name: `参考素材 ${index + 1}` }));
   data.referenceOrder = data.pinnedReferences.map(ref => ref.id);
   data.status = "running"; data.requestKey = requestKey; data.startedAt = Date.now();
   delete data.generationId; delete data.mediaId; delete data.outputUrl; delete data.outputName; delete data.variants;
  }
  const previous = retryOfRequestKey ? snapshot.nodes.find(node => node.id === nodeId) : undefined;
  if (retryOfRequestKey) {
   const hasFailedRequest = previous?.data.kind === "imageTask"
    ? previous.data.task.batches.some(batch => batch.outputs.some(output => output.requestKey === retryOfRequestKey && output.status === "failed"))
    : previous?.data.kind === "videoTask" && previous.data.requestKey === retryOfRequestKey && previous.data.status === "failed";
   if (!previous || previous.data.kind !== data.kind || !hasFailedRequest) throw new CreativeAgentError("MEDIA_RETRY_TARGET_CHANGED", "失败任务节点已删除或变化，未自动补试");
   if (data.kind === "imageTask" && previous.data.kind === "imageTask") data = { ...previous.data, task: { ...previous.data.task, batches: [...previous.data.task.batches, ...data.task.batches] } };
   else if (data.kind === "videoTask" && previous.data.kind === "videoTask") data = { ...previous.data, status: "running", requestKey, startedAt: Date.now(), generationId: undefined, mediaId: undefined, outputUrl: undefined, outputName: undefined, variants: undefined, error: undefined, finishedAt: undefined };
  }
  const size = getCanvasTaskResultFrameSize(data);
  const right = snapshot.nodes.reduce((x, node) => Math.max(x, node.position.x + (node.width || 360)), 0);
  const position = getCanvasLocalUploadPositions([size], { x: right + 100, y: 0 }, snapshot.nodes)[0];
  const operations: CanvasOperation[] = retryOfRequestKey ? [{ opId: `${clientMutationId}:data`, kind: "node.patch", nodeId, patch: { data } }] : [{ opId: `${clientMutationId}:node`, kind: "node.create", node: { id: nodeId, type: data.kind, data, position, ...size } },
   ...[...new Set(plan.references.map(ref => ref.nodeId))].map((source, index): CanvasOperation => ({ opId: `${clientMutationId}:edge:${index}`, kind: "edge.create", edge: { id: stableId(`reference:${source}:${nodeId}`), source, target: nodeId, type: "default" } }))];
  await defaults.beforeDispatch!(input);
  try {
   const committed = await submitCanvasMutation({ actorUserId: input.actorUserId, canvasId: input.canvasId, input: { protocolVersion: 1, clientMutationId, clientSequence: 0, baseRevision: snapshot.revision, operations } }, createPrismaCanvasMutationStore(prisma));
   revision = committed.revision;
  } catch (error) {
   if (attempt < 2 && (error as { code?: string })?.code === "CANVAS_REVISION_CONFLICT") return startMediaTask(input, requestKey, plan, attempt + 1, retryOfRequestKey, title);
   throw error;
  }
 }
 const { creativeAgentStore } = await import("./store");
 await creativeAgentStore.appendEvent(input.runId, input.epoch, "canvas.committed", { revision, nodeIds: [nodeId] });
}

async function syncMediaTask(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, outputs: CanvasGenerationOutput[], guard: () => Promise<void>) {
 if (!row.requestKey) return null;
 const started = await prisma.canvasMutation.findFirst({ where: { canvasId: input.canvasId, actorUserId: input.actorUserId, clientMutationId: startMutationId(input.canvasId, row.requestKey) }, select: { revision: true, operations: true } });
 if (!started) return null; // Older results retain the existing attachment path.
 await guard();
 const operations = started.operations as unknown as CanvasOperation[];
 const patch = operations.find(op => op.kind === "node.patch");
 const snapshot = await defaults.readCanvas(input), nodeId = patch?.kind === "node.patch" ? patch.nodeId : taskNodeId(input.canvasId, row.requestKey);
 const node = snapshot.nodes.find(node => node.id === nodeId);
 const title = node && "title" in node.data && typeof node.data.title === "string" && !/^Agent (图片|视频)$/.test(node.data.title) ? node.data.title : undefined;
 const receipt = { revision: snapshot.revision, nodeIds: [nodeId], ...(title ? { title } : {}) };
 if (!node) return { ...receipt, nodeIds: [] };
 if (!["success", "failed", "cancelled", "canceled"].includes(row.status) || (row.status === "success" && !outputs.length)) return receipt;
 const current = node.data;
 const batch = current.kind === "imageTask" ? current.task.batches.find(batch => batch.outputs.some(output => output.requestKey === row.requestKey && output.status === "running")) : undefined;
 if (current.kind === "imageTask" ? !batch : current.kind !== "videoTask" || current.requestKey !== row.requestKey || current.status !== "running") return receipt;
 // Concurrent worker/delivery reads share this mutation ID and must share its payload.
 const finishedAt = row.finishedAt == null ? undefined : new Date(row.finishedAt).getTime();
 let data = current;
 if (row.status === "success") {
  const completed = [];
  for (const output of outputs) {
   const child = output.generationId === row.id ? row : output.generationId ? await defaults.findGeneration({ id: output.generationId }) : null;
   if (!child || child.authUserId !== input.actorUserId || child.source !== "agent" || child.type !== row.type || child.model !== row.model || child.status !== "success" || !child.localPath || normalizeMediaUrl(child.localPath) !== output.url
    || (child.canvasId !== input.canvasId && !(child.canvasId === null && child.id !== row.id && child.externalTaskId && child.externalTaskId === row.externalTaskId && payloadMarker(child) === payloadMarker(row)))) throw new CreativeAgentError("MEDIA_OUTPUT_INVALID", "生成输出尚未形成可核对的持久素材");
   const media = await getOrCreateGenerationMediaAsset(prisma, { id: child.id, authUserId: child.authUserId, type: child.type, localPath: child.localPath });
   const dimensions = await readCreativeAgentMediaSize(media.url, row.type === "video_gen" ? "video" : "image");
   completed.push(buildCreativeAgentMediaTask(child, { ...media, ...dimensions?.original }));
  }
  if (current.kind === "imageTask" && batch) {
   const results = completed.flatMap(task => task.kind === "imageTask" ? task.task.batches[0].outputs : []);
   results.forEach((output, index) => { output.id = index ? `${batch.outputs[0].id}:${index}` : batch.outputs[0].id; output.finishedAt = finishedAt; });
   const savedSettings = completed[0]?.kind === "imageTask" ? completed[0].task.settings : batch.settings;
   data = { ...current, task: { ...current.task,
    settings: hashCanvasMutationPayload(current.task.settings) === hashCanvasMutationPayload(batch.settings) ? savedSettings : current.task.settings,
    batches: current.task.batches.map(item => item === batch ? { ...item, settings: savedSettings, outputs: results, primaryOutputId: results[0]?.id } : item) } };
  } else if (current.kind === "videoTask" && completed[0]?.kind === "videoTask") {
   const output = completed[0];
   data = { ...current, status: "success", generationId: output.generationId, mediaId: output.mediaId, outputUrl: output.outputUrl, outputName: output.outputName, variants: output.variants, finishedAt };
  }
 } else {
  const status = row.status === "failed" ? "failed" : "cancelled";
  if (current.kind === "imageTask" && batch) data = { ...current, task: { ...current.task, batches: current.task.batches.map(item => item === batch ? { ...item, outputs: item.outputs.map(output => ({ ...output, status, generationId: row.id, finishedAt, error: row.errorMsg || "生成未完成" })) } : item) } };
  else if (current.kind === "videoTask") data = { ...current, status, generationId: row.id, finishedAt, error: row.errorMsg || "生成未完成" };
 }
 if (data.kind !== "imageTask" && data.kind !== "videoTask") return receipt;
 const clientMutationId = stableId(`settle:${input.canvasId}:${row.requestKey}:${row.status}`);
 const size = getCanvasTaskResultFrameSize(data);
 await guard();
 const committed = await submitCanvasMutation({ actorUserId: input.actorUserId, canvasId: input.canvasId, input: { protocolVersion: 1, clientMutationId, clientSequence: 0, baseRevision: snapshot.revision,
  operations: [{ opId: `${clientMutationId}:data`, kind: "node.patch", nodeId, patch: { data } }, { opId: `${clientMutationId}:size`, kind: "node.resize", nodeId, ...size }] } }, createPrismaCanvasMutationStore(prisma));
 return { revision: committed.revision, nodeIds: [nodeId], ...(title ? { title } : {}) };
}

async function attachMedia(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, outputs: CanvasGenerationOutput[], guard: () => Promise<void>) {
  await guard();
  const mutationId = stableId(`attach:${input.canvasId}:${row.id}`);
  const receipt = () => prisma.canvasMutation.findFirst({ where: { canvasId: input.canvasId, actorUserId: input.actorUserId, clientMutationId: mutationId }, select: { revision: true, operations: true } });
  const prior = await receipt();
  if (prior) return { revision: prior.revision.toString(), nodeIds: (prior.operations as unknown as { kind: string; node?: CanvasNode }[]).flatMap(op => op.kind === "node.create" && op.node ? [op.node.id] : []) };
  const snapshot = await defaults.readCanvas(input);
  const right = snapshot.nodes.reduce((x, node) => Math.max(x, node.position.x + (node.width || 360)), 0);
  const nodes: CanvasNode[] = [];
  for (const output of outputs) {
   const child = output.generationId === row.id ? row : output.generationId ? await defaults.findGeneration({ id: output.generationId }) : null;
   // Finalizer children may predate canvasId propagation; explicit savedOutputs
   // lineage plus the creation-time digest keeps these scoped to this parent.
   if (!child || child.authUserId !== input.actorUserId || child.source !== "agent" || child.type !== row.type || child.model !== row.model
     || child.status !== "success" || !child.localPath || normalizeMediaUrl(child.localPath) !== output.url
     || (child.canvasId !== input.canvasId && !(child.canvasId === null && child.id !== row.id && child.externalTaskId && child.externalTaskId === row.externalTaskId && payloadMarker(child) === payloadMarker(row)))) {
    throw new CreativeAgentError("MEDIA_OUTPUT_INVALID", "生成输出尚未形成可核对的持久素材");
   }
   const media = await getOrCreateGenerationMediaAsset(prisma, { id: child.id, authUserId: child.authUserId, type: child.type, localPath: child.localPath });
   const kind = row.type === "video_gen" ? "video" : "image";
   const nodeId = stableId(`output:${input.canvasId}:${row.id}:${child.id}`);
   if (snapshot.nodes.some(node => node.id === nodeId)) continue;
   const dimensions = await readCreativeAgentMediaSize(media.url, kind);
   const data = buildCreativeAgentMediaTask(child, { ...media, ...dimensions?.original });
   nodes.push({ id: nodeId, type: data.kind, position: { x: right + 100, y: 0 }, ...(dimensions?.size || { width: 360, height: kind === "video" ? 203 : 360 }), data });
  }
  if (!nodes.length) return { revision: snapshot.revision, nodeIds: outputs.flatMap(output => output.generationId ? [stableId(`output:${input.canvasId}:${row.id}:${output.generationId}`)] : []) };
  const positions = getCanvasLocalUploadPositions(nodes.map(node => ({ width: node.width!, height: node.height! })), { x: right + 100, y: 0 }, snapshot.nodes);
  nodes.forEach((node, index) => { node.position = positions[index]; });
  await guard();
  try {
   const result = await submitCanvasMutation({ actorUserId: input.actorUserId, canvasId: input.canvasId, input: { protocolVersion: 1, clientMutationId: mutationId, clientSequence: 0, baseRevision: snapshot.revision,
    operations: nodes.map((node, index) => ({ opId: `${mutationId}:${index}`, kind: "node.create", node })) } }, createPrismaCanvasMutationStore(prisma));
   return { revision: result.revision, nodeIds: nodes.map(node => node.id) };
  } catch (error) {
   const raced = await receipt();
   if (raced) return { revision: raced.revision.toString(), nodeIds: (raced.operations as unknown as { kind: string; node?: CanvasNode }[]).flatMap(op => op.kind === "node.create" && op.node ? [op.node.id] : []) };
   throw error;
  }
 }

function nodeHash(node: CanvasNode) {
 const { generatorPanelSize: _panel, ...data } = node.data as CanvasNode["data"] & { generatorPanelSize?: unknown };
 return hashCanvasMutationPayload({ id: node.id, data });
}
export function resolveReference(snapshot: AgentCanvasSnapshot, reference: CreativeAgentMediaReference): ResolvedReference {
 const node = snapshot.nodes.find(node => node.id === reference.nodeId);
 if (!node || nodeHash(node) !== reference.semanticHash) throw new CreativeAgentError("REFERENCE_CHANGED", "生成引用的素材版本已变化，请重新读取画布");
 const data = node.data;
 let url: string | undefined, kind: ResolvedReference["kind"];
 if (data.kind === "imageTask") {
  const batch = data.task.batches.find(batch => batch.id === reference.batchId);
  const output = batch?.outputs.find(output => output.id === reference.outputId);
  if (!output || output.status !== "success" || !output.url || (reference.mediaId && reference.mediaId !== output.mediaId) || (reference.generationId && reference.generationId !== output.generationId)) throw new CreativeAgentError("REFERENCE_OUTPUT_CHANGED", "需要指定已完成的图片批次和产物");
  url = output.url; kind = "image";
 } else if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {
  if (reference.batchId || reference.outputId || reference.generationId || (reference.mediaId && reference.mediaId !== data.mediaId)) throw new CreativeAgentError("REFERENCE_OUTPUT_CHANGED", "素材身份与画布不匹配");
  url = data.url; kind = data.kind;
 } else if (data.kind === "videoTask" || data.kind === "audioTask") {
  if (data.status !== "success" || !data.outputUrl || reference.batchId || (reference.outputId && reference.outputId !== data.requestKey)
    || (reference.generationId && reference.generationId !== data.generationId) || (reference.mediaId && (!("mediaId" in data) || reference.mediaId !== data.mediaId))) throw new CreativeAgentError("REFERENCE_OUTPUT_CHANGED", "需要指定已完成的媒体产物");
  url = data.outputUrl; kind = data.kind === "videoTask" ? "video" : "audio";
 } else throw new CreativeAgentError("REFERENCE_KIND_INVALID", "该节点没有可生成引用的媒体", 400);
 if (!url || url.startsWith("blob:") || (!url.startsWith("/uploads/") && !/^https?:\/\//.test(url))) throw new CreativeAgentError("REFERENCE_NOT_READY", "引用素材尚未上传完成", 400);
 return { ...reference, kind, url };
}
function invalid(): never { throw new CreativeAgentError("MEDIA_PARAMS_INVALID", "该模型不支持这组生成参数", 400); }
export async function matchCreativeAgentMedia(input: CreativeAgentToolInput, deps: Pick<CreativeAgentMediaDependencies, "catalog" | "readCanvas" | "bindReference" | "evidence"> = defaults) {
 const mediaType = input.kind === "image.generate" ? "image" : input.kind === "video.generate" ? "video" : invalid();
 const raw = input.args as Record<string, unknown>;
 const { previewMode: _preview, ...validatedRaw } = raw;
 const parsed = (mediaType === "image" ? imageSchema : videoSchema).parse({ ...validatedRaw, model: typeof raw.model === "string" ? raw.model : "selection" });
 const [snapshot, catalog] = await Promise.all([deps.readCanvas(input), deps.catalog()]);
 const cache = new Map<string, Promise<ResolvedReference>>();
 const references = await Promise.all(parsed.references.map(reference => {
  const key = hashCanvasMutationPayload(reference);
  let bound = cache.get(key);
  if (!bound) {
   const resolved = resolveReference(snapshot, reference);
   bound = (deps.bindReference ?? bindCreativeReferenceFacts)(input, snapshot.nodes.find(node => node.id === reference.nodeId)!, resolved);
   cache.set(key, bound);
  }
  return bound;
 }));
 const policy = input.matching?.receipt?.selectionPolicy ?? input.matching;
 const match = matchMediaCandidates({ mediaType, request: raw, references, catalog, preferences: input.matching?.preferences, requirements: input.matching?.requirements, task: policy?.task, priorities: policy?.priorities, outputConstraint: policy?.outputConstraint, evidence: await deps.evidence?.() ?? [] });
 return { match, snapshot, catalog, references };
}

async function prepared(input: CreativeAgentToolInput, deps: CreativeAgentMediaDependencies) {
 let args: ReturnType<typeof imageSchema.parse> | ReturnType<typeof videoSchema.parse>, references: ResolvedReference[], params: Record<string, unknown>, units: number;
 let selectionReceipt: SelectionReceipt | undefined;
 if (input.matching?.policyVersion === 2) {
  const matched = await matchCreativeAgentMedia(input, deps);
  const receipt = matched.match.selected;
  if (!receipt) {
   const exclusions = matched.match.exclusions;
   const code = exclusions.some(item => ["MEDIA_PARAMS_INVALID", "NORMALIZATION_CONFLICT"].includes(item.code)) ? "MEDIA_PARAMS_INVALID" : "MEDIA_MODEL_UNAVAILABLE";
   const fields = [...new Set(exclusions.flatMap(item => item.requirementFields ?? []))];
   const labels: Record<string,string> = {"image.params.aspectRatio":"图片画幅","image.params.resolution":"图片分辨率","image.params.quality":"图片质量","image.params.background":"图片背景","video.params.ratio":"视频画幅","video.params.resolution":"视频分辨率","video.params.duration":"视频时长","video.params.generateAudio":"视频声音","image.params":"图片参数组合","video.params":"视频参数组合","target.output":"修改目标","references.image":"图片参考素材"};
   const missing = fields.map(field=>labels[field]).filter(Boolean);
   const message = code === "MEDIA_PARAMS_INVALID" ? `当前可用模型无法同时满足${missing.length ? `：${missing.join("、")}` : "这组参数与参考素材要求"}。请调整这些要求后重新确认。` : "当前没有满足本轮要求的可用模型，请核对已指定的要求或稍后重试。";
   throw Object.assign(new CreativeAgentError(code,message,400), {exclusions,requirementFields:fields});
  }
  if (input.matching.receipt) {
   const old = input.matching.receipt;
   if (old.id !== receipt.id || hashCanvasMutationPayload(input.args) !== hashCanvasMutationPayload(old.request)) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "选型收据、引用内容或当前能力已变化，请重新制定并确认方案", 409);
  }
  selectionReceipt = receipt;
  args = input.kind === "image.generate" ? imageSchema.parse(receipt.request) : videoSchema.parse(receipt.request);
  references = matched.references; params = receipt.request.params; units = receipt.output.calls;
 } else {
  args = input.kind === "image.generate" ? imageSchema.parse(input.args) : input.kind === "video.generate" ? videoSchema.parse(input.args) : invalid();
  const [snapshot, catalog] = await Promise.all([deps.readCanvas(input), deps.catalog()]);
  references = args.references.map(reference => resolveReference(snapshot, reference));
  ({ params, units } = normalizeCreativeMediaRequest(input.kind, args, references, catalog));
 }
 const binding: DecisionBinding = { kind: input.kind, units, retryLimit: selectionReceipt ? generationAllowance({requirements:input.matching?.requirements}).retryCalls : 1, ...(selectionReceipt ? {version:2 as const, ...input.matching?.execution}:{}), argsHash: hashCanvasMutationPayload({ actorUserId: input.actorUserId, canvasId: input.canvasId, kind: input.kind, model: args.model, prompt: args.prompt, params, references, ...(selectionReceipt ? { selectionReceiptId: selectionReceipt.id } : {}) }) };
 return { args, references, params, binding, selectionReceipt };
}

/** Task 3 can use this same check immediately before reserving/dispatching a ready step. */
export async function revalidateCreativeMediaReceipt(input: CreativeAgentToolInput, deps: CreativeAgentMediaDependencies = defaults) {
 if (input.matching?.policyVersion !== 2 || !input.matching.receipt) throw new CreativeAgentError("SELECTION_RECEIPT_REQUIRED", "缺少当前方案收据", 400);
 return (await prepared(input, deps)).selectionReceipt!;
}

export async function prepareCreativeAgentMedia(input: CreativeAgentToolInput, deps: CreativeAgentMediaDependencies = defaults): Promise<DecisionPrompt> {
 if (deps === defaults) { await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, true); }
 const raw = input.args as Record<string, unknown>;
 const mediaType = input.kind === "image.generate" ? "image" : input.kind === "video.generate" ? "video" : invalid();
 const [snapshot, catalog] = await Promise.all([deps.readCanvas(input), deps.catalog()]);
 const cached = { ...deps, readCanvas: async () => snapshot, catalog: async () => catalog };
 if (raw.model === undefined && input.matching?.policyVersion !== 2) {
  // Validate the request and exact references once before offering any model.
  const args = mediaType === "image" ? imageSchema.parse({ ...raw, model: "selection" }) : videoSchema.parse({ ...raw, model: "selection" });
  args.references.forEach(reference => resolveReference(snapshot, reference));
  const options: { value: string; label: string }[] = [];
  for (const model of catalog[mediaType]) {
   try {
    await prepared({ ...input, args: { ...raw, model: model.id } }, cached);
    options.push({ value: model.id, label: model.label });
   } catch (error) {
    if (!(error instanceof CreativeAgentError) || !["MEDIA_PARAMS_INVALID", "MEDIA_MODEL_UNAVAILABLE"].includes(error.code)) throw error;
   }
  }
  if (!options.length) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "当前没有支持这组素材和参数的可用模型，请调整方案后重新选择。", 400);
  return { title: "选择本次生成模型", question: "请选择本次使用的模型。目录已按当前素材和参数筛选；选择后仍需确认准确生成方案。跳过将不提交生成。", options: [], fields: [{ id: mediaType === "image" ? "imageModel" : "videoModel", title: mediaType === "image" ? "图片模型" : "视频模型", type: "select", required: true, options }] };
 }
 const proposal = await prepared(input, cached);
 const model = catalog[mediaType].find(model => model.id === proposal.args.model)!;
 const modelLabel = model.variants?.find(variant => variant.mode === proposal.params.gptImage25Mode)?.label ?? model.label;
 const ratio = proposal.params.aspectRatio ?? proposal.params.ratio;
 const limits = generationAllowance({requirements:input.matching?.requirements});
 const summary = [`${proposal.binding.units} 次${mediaType === "image" ? "图片" : "视频"}生成，模型：${modelLabel}`, `画幅：${ratio} · 尺寸：${proposal.params.resolution}${mediaType === "video" ? ` · 时长：${proposal.params.duration === -1 ? "自动" : `${proposal.params.duration} 秒`}` : ""}`, `参考素材：${proposal.references.length} 个`, proposal.selectionReceipt ? `本轮交付 ${limits.finalOutputs} 份成品、中间产物最多 ${limits.intermediateOutputs} 份；初次调用最多 ${limits.initialCalls} 次，补试最多 ${limits.retryCalls} 次。${limits.totalOutputs === undefined ? "" : `包括中间产物和补试，总生成最多 ${limits.totalOutputs} 份。`}` : `明确失败且适合重试的失败项自动补试 1 次，包含补试最多 ${proposal.binding.units * 2} 次调用；成功项与提交结果未知的任务不重发。`];
 const references = proposal.references.map(ref => {
  const data = snapshot.nodes.find(node => node.id === ref.nodeId)?.data;
  return { nodeId: ref.nodeId, kind: ref.kind, url: ref.url, label: data && "name" in data ? data.name || ref.nodeId : ref.nodeId };
 });
 return { binding: proposal.binding, title: "确认本次媒体生成", question: summary.join("\n"), media: { ...(proposal.selectionReceipt && input.matching?.execution ? {planSummary:presentGenerationStep(proposal.selectionReceipt,input.matching.execution)} : {}), ...(proposal.selectionReceipt ? { selectionReceipt: proposal.selectionReceipt } : {}), mediaType, model: { id: model.id, label: modelLabel }, prompt: proposal.args.prompt, params: proposal.params, units: proposal.binding.units, references }, options: [{ value: "approve", label: "确认生成" }, { value: "cancel", label: "取消" }] };
}
function payloadMarker(row: CreativeAgentMediaRecord): string | undefined { try { return JSON.parse(row.templateData || "{}").skill?.id; } catch { return undefined; } }
function checkScope(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord) {
 if (row.authUserId !== input.actorUserId || row.canvasId !== input.canvasId || row.source !== "agent" || !["image_edit", "video_gen"].includes(row.type)) throw new CreativeAgentError("MEDIA_SCOPE_INVALID", "生成记录不属于当前画布和用户", 404);
}
function checkReplay(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, plan: Awaited<ReturnType<typeof prepared>>) {
 checkScope(input, row);
 if (row.model !== plan.args.model || row.type !== (input.kind === "image.generate" ? "image_edit" : "video_gen") || payloadMarker(row) !== `creative-agent:${plan.binding.argsHash}`) throw new CreativeAgentError("MEDIA_REQUEST_KEY_CONFLICT", "生成请求身份与已保存参数不一致");
}
async function result(input: CreativeAgentToolInput, row: CreativeAgentMediaRecord, deps: CreativeAgentMediaDependencies) {
 checkScope(input, row);
 const kind = row.type === "video_gen" ? "video" : "image";
 let metadata: Record<string,any> = {}; try { metadata = JSON.parse(row.templateData || "{}"); } catch {}
 const outputs = await Promise.all((metadata.agentOutputContract?.version === 2 || row.status === "success" && row.localPath ? getCanvasGenerationOutputs(row) : []).map(async output => {
  const size = await readCreativeAgentMediaSize(output.url, kind);
  return { ...output, nodeId: output.generationId ? stableId(`output:${input.canvasId}:${row.id}:${output.generationId}`) : undefined, ...(size ? { width: size.original.width, height: size.original.height } : {}) };
 }));
 const observation = metadata.agentOutputContract?.version === 2 ? {generationId:row.id,...metadata.agentOutputObservation,uniqueOutputs:Math.max(metadata.agentOutputObservation?.uniqueOutputs ?? 0, outputs.length),savedOutputs:outputs.length} : undefined;
 const ledger = observation ? await deps.observeOutputs?.(input,row,observation) : undefined;
 const status = row.status === "success" && !outputs.length ? "processing" : row.status;
 const task = await deps.syncTask?.(input, row, outputs);
 const attached = task ?? (outputs.length ? await deps.attach(input, row, outputs) : {});
 if (task) outputs.forEach(output => { output.nodeId = task.nodeIds[0]; });
 recordCreativeDebug({ spanId: `media:${row.requestKey || row.id}`, category: "media", type: "media.status", title: `生成任务 #${row.id} · ${status}`, status: status === "success" ? "success" : ["failed", "cancelled", "canceled"].includes(status) ? "error" : "waiting", eventKey: `media:${row.id}:${hashCanvasMutationPayload({ status, externalTaskId: row.externalTaskId, outputs, error: row.errorMsg, nodeIds: "nodeIds" in attached ? attached.nodeIds : [] })}`, summary: { generationId: row.id, externalTaskId: row.externalTaskId, generationStatus: status, nodeIds: "nodeIds" in attached ? attached.nodeIds : [] }, detail: { generationId: row.id, requestKey: row.requestKey, externalTaskId: row.externalTaskId, status, outputs, ...attached, error: row.errorMsg } });
 return { ...await deps.retryMetadata?.(input, row), generationId: row.id, status, mediaType: kind, model: row.model || "", outputs, ...(observation ? {outputObservation:observation,outputMismatch:ledger?.frozen === true}:{}), ...(row.errorMsg ? { error: row.errorMsg } : {}), ...attached };
}
/** Deliver a previously submitted task even if its conversation has stopped. No submission capability. */
export async function readCreativeAgentMediaDelivery(run: import("./store-types").Run, generationId: number): Promise<Record<string, unknown>> {
 const { creativeAgentStore } = await import("./store");
 const guard = async () => {
  await assertDurableWorkAdmission();
  await requireCreativeAgentCanvas(run.actorUserId, run.canvasId, true);
  await creativeAgentStore.assertMediaDelivery(run, generationId);
 };
 await guard();
 const input: CreativeAgentToolInput = { actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, epoch: run.epoch,
  actionId: `deliver:${run.id}:${generationId}`, kind: "generation.read", args: { generationId } };
 const row = await defaults.findGeneration({ id: generationId });
 if (!row) throw new CreativeAgentError("MEDIA_NOT_FOUND", "生成记录不存在", 404);
 checkScope(input, row);
 await defaults.finalize(generationId);
 const updated = await defaults.findGeneration({ id: generationId });
 if (!updated) throw new CreativeAgentError("MEDIA_NOT_FOUND", "生成记录不存在", 404);
 return result(input, updated, { ...defaults, attach: (input, row, outputs) => attachMedia(input, row, outputs, guard), syncTask: (input, row, outputs) => syncMediaTask(input, row, outputs, guard) });
}

function unknown(generationIds: number[] = [], requestKeys: string[] = []) { return Object.assign(new CreativeAgentError("MEDIA_DISPATCH_UNKNOWN", "生成提交结果尚未确认，已保留本次次数；请查询记录，不要重新提交"), { generationIds, requestKeys }); }
export async function executeCreativeAgentMediaTool(input: CreativeAgentToolInput, deps: CreativeAgentMediaDependencies = defaults): Promise<Record<string, unknown>> {
 if (deps === defaults) { await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, true); }
 input.signal?.throwIfAborted();
 if (input.kind === "generation.models") {
  z.object({}).strict().parse(input.args);
  const catalog = await deps.catalog();
  return { image: catalog.image.map(model => ({ ...model, guidance: modelGuidanceSummary(model.id, "image") })), video: catalog.video.map(model => ({ ...model, guidance: modelGuidanceSummary(model.id, "video") })) };
 }
 if (input.kind === "model.guidance") {
  const args = z.object({ model: z.string().min(1).max(200), mediaType: z.enum(["image", "video"]) }).strict().parse(input.args);
  const catalog = await deps.catalog();
  const available = catalog[args.mediaType].find(model => model.id === args.model);
  if (!available) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "该模型不在当前可用目录内，请先查询 generation_models", 400);
  return { ...readModelGuidance(args.model, args.mediaType), currentCapabilities: available };
 }
 if (input.kind === "generation.read") {
  const { generationId } = z.object({ generationId: z.number().int().positive().safe() }).strict().parse(input.args);
  const row = await deps.findGeneration({ id: generationId });
  if (!row) throw new CreativeAgentError("MEDIA_NOT_FOUND", "生成记录不存在", 404);
  checkScope(input, row);
  await deps.finalize(row.id);
  const updated = await deps.findGeneration({ id: row.id });
  if (!updated) throw new CreativeAgentError("MEDIA_NOT_FOUND", "生成记录已不存在", 404);
  return result(input, updated, deps);
 }
 if (input.matching?.policyVersion === 2 && !input.matching.receipt) throw new CreativeAgentError("SELECTION_RECEIPT_REQUIRED", "请先生成并确认当前方案", 400);
 const proposal = await prepared(input, deps);
 if (!input.mediaApproval && !input.mediaAuthorization) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "请先确认本次生成的素材、参数和次数");
 const requestKeys = Array.from({ length: proposal.binding.units }, (_, index) => stableId(`${input.runId}:${input.actionId}:${input.kind}:${index}`));
 const permit = await deps.claimApproval(input, proposal.binding, requestKeys);
 const existing = await Promise.all(requestKeys.map(requestKey => deps.findGeneration({ requestKey })));
 existing.forEach(row => { if (row) checkReplay(input, row, proposal); });
 if ((!permit.fresh || existing.some(Boolean)) && existing.some(row => !row)) throw unknown(existing.flatMap(row => row ? [row.id] : []), requestKeys);
 const generations: Record<string, unknown>[] = [];
 for (const [index, requestKey] of requestKeys.entries()) {
  input.signal?.throwIfAborted();
  let row = existing[index];
  if (!row) {
   let started = false;
   try {
    await deps.beforeDispatch?.(input);
    const latest = await deps.readCanvas(input);
    proposal.args.references.forEach(reference => resolveReference(latest, reference));
    await deps.startTask?.(input, requestKey, proposal);
    await submitMediaRequest(input, requestKey, proposal, deps, async () => {
     if (input.matching?.policyVersion === 2) await revalidateCreativeMediaReceipt(input, deps);
     await deps.markDispatchStarted?.(input, requestKey); started = true;
    });
   } catch (error) {
    if (!started) {
     await deps.releaseUnused?.(input, requestKeys.slice(index)).catch(() => undefined);
     if (error instanceof CreativeAgentError) throw error;
     throw new CreativeAgentError("MEDIA_NOT_DISPATCHED", "生成尚未提交，准备任务或执行资格发生变化，请核对后继续。", 409);
    }
    recordCreativeDebug({ spanId: `media:${requestKey}`, category: "media", type: "media.unknown", title: "生成提交结果未确认", status: "unknown", summary: { requestKey, actionId: input.actionId } });
    const observed = await deps.findGeneration({ requestKey }).catch(() => null);
    if (observed) checkReplay(input, observed, proposal);
    throw unknown([...generations.map(item => Number(item.generationId)), ...(observed ? [observed.id] : [])], requestKeys);
   }
   row = await deps.findGeneration({ requestKey });
   if (!row) throw unknown(generations.map(item => Number(item.generationId)), requestKeys);
   checkReplay(input, row, proposal);
  }
  const receipt = await result(input, row, deps); generations.push(receipt);
  if (receipt.outputMismatch) { await deps.releaseUnused?.(input,requestKeys.slice(index + 1)); break; }
  // A known failure affects this item only. Cancellation stops the remaining batch.
  if (["cancelled", "canceled"].includes(row.status)) break;
 }
 const nodeIds = generations.flatMap(item => Array.isArray(item.nodeIds) ? item.nodeIds as string[] : []);
 const revision = [...generations].reverse().find(item => typeof item.revision === "string")?.revision;
 return { ...(proposal.selectionReceipt ? { selectionReceipt: proposal.selectionReceipt } : {}), mediaRequest: { args: input.args, ...(input.matching ? { matching: input.matching } : {}), binding: proposal.binding, ...(input.mediaApproval ? { approval: input.mediaApproval } : { authorization: input.mediaAuthorization }) }, ...(generations.length === 1 ? generations[0] : {}), generations, generationIds: generations.map(item => item.generationId), status: generations.length === 1 ? generations[0].status : generations.every(item => item.status === "success") ? "success" : generations.some(item => ["failed", "cancelled", "canceled"].includes(String(item.status))) ? "failed" : "running", ...(revision ? { revision, nodeIds } : {}) };
}

async function submitMediaRequest(input: CreativeAgentToolInput, requestKey: string, proposal: Awaited<ReturnType<typeof prepared>>, deps: CreativeAgentMediaDependencies, beforeSubmit?: () => Promise<void>) {
 input.signal?.throwIfAborted();
 await deps.beforeDispatch?.(input);
 await beforeSubmit?.();
 const common = { ...(proposal.selectionReceipt ? {agentOutputContract:{version:2 as const,receiptId:proposal.selectionReceipt.id,maxReturned:proposal.selectionReceipt.output.maxReturned === undefined ? undefined : proposal.selectionReceipt.output.maxReturned / proposal.selectionReceipt.output.calls}}:{}), authUserId: input.actorUserId, canvasId: input.canvasId, source: "agent" as const, requestKey, model: proposal.args.model, prompt: proposal.args.prompt, skill: { id: `creative-agent:${proposal.binding.argsHash}`, name: "画布创作 Agent", revision: 1 } };
 recordCreativeDebug({ spanId: `media:${requestKey}`, category: "media", type: "media.prepared", title: `提交${input.kind === "image.generate" ? "图片" : "视频"} · ${proposal.args.model}`, status: "running", summary: { requestKey, modelId: proposal.args.model, actionId: input.actionId }, detail: { originalArguments: input.args, normalized: { ...common, ...proposal.params, references: proposal.references }, approval: input.mediaApproval } });
 try {
  await withDebugSpan(`media:${requestKey}`, async () => {
   if (input.kind === "image.generate") {
    const { count: _count, ...params } = proposal.params;
    await deps.createImage({ ...common, ...params, imagePaths: proposal.references.map(ref => ref.url), n: 1, ...(proposal.selectionReceipt ? { exactProviderModel: proposal.selectionReceipt.route.providerModel } : {}) });
   } else await deps.createVideo({ ...common, ...proposal.params, mediaPaths: proposal.references.map(ref => ref.url) } as CreateVideoGenerationInput);
  });
 } catch (error) {
  // Services also persist transport and post-success storage errors as failed.
  // Only explicit rejection categories prove that this submission did not complete.
  const failure = error as { generationId?: number; friendlyError?: { code?: string } };
  const rejected = ["RATE_LIMIT", "BILLING_OVERDUE", "AUTH_DENIED", "MODEL_UNAVAILABLE", "CONTENT_REJECTED", "INPUT_LIMIT", "VALIDATION"];
  if (!failure.generationId || !failure.friendlyError?.code || !rejected.includes(failure.friendlyError.code)) throw error;
  const observed = await deps.findGeneration({ requestKey });
  if (!observed || observed.id !== failure.generationId || observed.status !== "failed") throw error;
  checkReplay(input, observed, proposal);
 }

}

/** A terminal provider failure is different from a failed transport or result download. */
export function canAutomaticallyRetryMedia(row: Pick<CreativeAgentMediaRecord, "status" | "errorMsg">) {
 if (row.status !== "failed") return false;
 const error = parseFriendlyMessageFromStorage(row.errorMsg);
 const code = toFriendlyError(error.raw || error.message).code;
 // Neither failed + UNKNOWN nor a generic TIMEOUT proves upstream failure:
 // both can describe a lost response or a local save error after successful billing.
 return code === "RATE_LIMIT";
}

/** A new request is possible only after a durable reservation under the original, explicit retry budget. */
export async function executeCreativeAgentMediaRetry(parentInput: CreativeAgentToolInput, failedGenerationId: number): Promise<Record<string, unknown> | null> {
 await requireCreativeAgentCanvas(parentInput.actorUserId, parentInput.canvasId, true);
 await assertDurableWorkAdmission(); parentInput.signal?.throwIfAborted();
 await defaults.beforeDispatch!(parentInput);
 const failed = await defaults.findGeneration({ id: failedGenerationId });
 if (!failed || !canAutomaticallyRetryMedia(failed) || !failed.requestKey) return null;
 checkScope(parentInput, failed);
 const parent = await prisma.creativeAgentAction.findUnique({ where: { id: parentInput.actionId } });
 const stored = parent?.result as Record<string, any> | null;
 if (!parent || parent.state !== "succeeded" || stored?.retryOfGenerationId || !stored?.generationIds?.includes(failedGenerationId) || !stored.mediaRequest) return null;
 if (stored.mediaRequest.matching?.policyVersion === 2 && !(stored.mediaRequest.binding?.retryLimit > 0)) return null;
 const source = { ...parentInput, args: stored.mediaRequest.args, ...(stored.mediaRequest.matching ? { matching: stored.mediaRequest.matching } : {}), mediaApproval: stored.mediaRequest.approval, mediaAuthorization: stored.mediaRequest.authorization };
 const proposal = await prepared(source, defaults);
 const requestKey = stableId(`retry:${failed.requestKey}:1`);
 const input = { ...source, actionId: stableId(`retry-action:${parent.id}:${failedGenerationId}:1`) };
 const metadata = { retryParentActionId: parent.id, retryOfGenerationId: failedGenerationId, retryAttempt: 1 as const, retryReason: failed.errorMsg || "生成服务返回失败" };
 const reserved = { ...metadata, mediaDispatch: { requestKeys: [requestKey] }, requestKeys: [requestKey] };
 const permit = await prisma.$transaction(async tx => {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "CreativeAgentRun" WHERE id=${input.runId} FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "CreativeAgentAction" WHERE id=${parent.id} FOR UPDATE`);
  const [original, decision, latest, currentRun, decisions] = await Promise.all([
   tx.creativeAgentAction.findUnique({ where: { id: parent.id } }),
   tx.creativeAgentDecision.findUnique({ where: { actionId: parent.id }, include: { run: true } }),
   tx.generation.findUnique({ where: { id: failedGenerationId } }),
   tx.creativeAgentRun.findUnique({ where: { id: input.runId } }),
   tx.creativeAgentDecision.findMany({ where: { runId: input.runId }, orderBy: { createdAt: 'asc' } }),
  ]);
  const binding = (source.mediaAuthorization ? stored.mediaRequest.binding : decision?.binding) as DecisionBinding | null;
  if (!original || original.state !== "succeeded" || !currentRun || (!source.mediaAuthorization && !decision) || !binding || (binding.version === 2 ? !(binding.retryLimit! > 0) : binding.retryLimit !== 1) || !latest || !canAutomaticallyRetryMedia(latest)) return null;
  // Recheck all approval scope and parameter facts with the current lease. The original
  // dispatch action keeps its old epoch; this is a separately fenced child action.
  if (source.mediaAuthorization) assertDirectMediaAuthorization(source, proposal.binding, currentRun, { ...original, epoch: input.epoch, state: 'claimed' }, decisions as unknown as Decision[]);
  else assertCreativeAgentMediaApproval(source, proposal.binding, { decision: decision!, run: { ...currentRun, status: currentRun.status === "waiting_action" ? "running" : currentRun.status }, action: { ...original, epoch: input.epoch, state: "claimed" } });
  if (original.inputHash !== hashCanvasMutationPayload(source.args) || hashCanvasMutationPayload(binding) !== hashCanvasMutationPayload(stored!.mediaRequest.binding)) throw new CreativeAgentError("MEDIA_APPROVAL_REQUIRED", "原生成参数或补试预算已变化");
  const keys = Array.from({ length: binding.units }, (_, index) => stableId(`${input.runId}:${parent.id}:${input.kind}:${index}`));
  if (!keys.includes(latest.requestKey || "")) return null;
  checkReplay(source, latest, proposal);
  const existing = await tx.creativeAgentAction.findUnique({ where: { id: input.actionId } });
  if (existing) return { fresh: false };
  if (binding.version === 2) {
   const current = currentRun.input as MessageInput, execution = source.matching!.execution!;
   if (hashCanvasMutationPayload(generationExecution(current, execution.planId, execution.stepId)) !== hashCanvasMutationPayload(execution)) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "补试方案或数量要求已变化");
   const updated = reserveGenerationQuantity(current, {...execution, actionId:input.actionId, requestKeys:[requestKey], retryOf:failed.requestKey!});
   await tx.creativeAgentRun.update({where:{id:input.runId},data:{input:updated as unknown as Prisma.InputJsonValue}});
  }
  await tx.creativeAgentAction.create({ data: { id: input.actionId, runId: input.runId, actorUserId: input.actorUserId, canvasId: input.canvasId, epoch: input.epoch, kind: input.kind, inputHash: hashCanvasMutationPayload(source.args), state: "claimed", result: reserved } });
  return { fresh: true };
 });
 if (!permit) return null;
 let row = await defaults.findGeneration({ requestKey });
 if (!permit.fresh && !row) throw unknown([], [requestKey]);
 const { creativeAgentStore } = await import("./store");
 let dispatchStarted = false;
 try {
  if (!row) {
   await startMediaTask(input, requestKey, proposal, 0, failed.requestKey);
   await submitMediaRequest(input, requestKey, proposal, defaults, async () => {
    if (source.matching?.policyVersion === 2) await revalidateCreativeMediaReceipt(source);
    await defaults.markDispatchStarted!(input,requestKey); dispatchStarted = true;
   });
   row = await defaults.findGeneration({ requestKey });
   if (!row) throw unknown([], [requestKey]);
  }
  checkReplay(input, row, proposal);
  const receipt = { ...await result(input, row, defaults), ...metadata, ...(stored.selectionReceipt ? { selectionReceipt: stored.selectionReceipt } : {}), mediaRequest: stored.mediaRequest, generationIds: [row.id], requestKeys: [requestKey] };
  if (permit.fresh) await creativeAgentStore.completeAction(input.actionId, { runId: input.runId, epoch: input.epoch, state: "succeeded", result: receipt });
  return receipt;
 } catch (error) {
  const targetChanged = (error as { code?: string })?.code === "MEDIA_RETRY_TARGET_CHANGED" || !dispatchStarted && source.matching?.policyVersion === 2;
  if (targetChanged && permit.fresh) await defaults.releaseUnused!(input,[requestKey]).catch(() => undefined);
  if (permit.fresh) await creativeAgentStore.completeAction(input.actionId, { runId: input.runId, epoch: input.epoch, state: targetChanged ? "failed" : "unknown", result: targetChanged ? { ...metadata, message: "失败任务节点已变化，补试未提交" } : { ...reserved, message: "补试提交结果待确认，不能重复提交" } }).catch(() => undefined);
  // A transport or worker interruption never returns a retryable failed receipt.
  if (targetChanged) throw error;
  throw unknown(row ? [row.id] : [], [requestKey]);
 }
}

/**
 * Agent v3：模型与参数已由服务端选定并校验，这里直接建任务节点并提交。
 * 不再经过审批卡、选型收据和数量账本；同一 requestKey 重复调用只会读取已有任务，不会重复提交。
 */
export async function submitCreativeAgentMediaV3(input: CreativeAgentToolInput, request: { model: string; prompt: string; references: CreativeAgentMediaReference[]; params: Record<string, unknown> }, requestKey: string, title: string): Promise<Record<string, unknown>> {
 await requireCreativeAgentCanvas(input.actorUserId, input.canvasId, true);
 input.signal?.throwIfAborted();
 const [snapshot, catalog] = await Promise.all([defaults.readCanvas(input), defaults.catalog()]);
 const references = request.references.map(reference => resolveReference(snapshot, reference));
 const normalized = normalizeCreativeMediaRequest(input.kind, request, references, catalog);
 const args = normalized.args as Awaited<ReturnType<typeof prepared>>["args"];
 const binding: DecisionBinding = { kind: input.kind, units: 1, argsHash: hashCanvasMutationPayload({ actorUserId: input.actorUserId, canvasId: input.canvasId, kind: input.kind, model: args.model, prompt: args.prompt, params: normalized.params, references }) };
 const proposal = { args, references, params: normalized.params, binding } as Awaited<ReturnType<typeof prepared>>;
 let row = await defaults.findGeneration({ requestKey });
 if (!row) {
  await startMediaTask(input, requestKey, proposal, 0, undefined, title);
  await submitMediaRequest(input, requestKey, proposal, defaults);
  row = await defaults.findGeneration({ requestKey });
  if (!row) throw unknown([], [requestKey]);
 }
 checkReplay(input, row, proposal);
 return result(input, row, defaults);
}

export type CreativeAgentMediaWaitInput = Pick<CreativeAgentToolInput, "actorUserId" | "canvasId" | "runId" | "epoch" | "signal">;
export type CreativeAgentMediaWaitOptions = {
 generationIds: number[];
 pollOnce?: boolean;
 onCommitted(value: { generationId: number; revision: string; nodeIds: string[] }): Promise<void>;
 onProgress?(receipt: Record<string, unknown>): Promise<void>;
};
export async function waitForCreativeAgentMedia(input: CreativeAgentMediaWaitInput, options: CreativeAgentMediaWaitOptions, deps: CreativeAgentMediaDependencies = defaults): Promise<{ generations: Record<string, unknown>[]; pendingGenerationIds: number[] }> {
 const pending = new Set(options.generationIds);
 const results = new Map<number, Record<string, unknown>>();
 const failures: number[] = [];
 while (pending.size) {
  input.signal?.throwIfAborted();
  if (deps === defaults) await assertDurableWorkAdmission();
  // Sequential reads also serialize result attachment against one canvas revision.
  for (const generationId of pending) {
   input.signal?.throwIfAborted();
   let receipt: Record<string, unknown>;
   try {
    await deps.beforeDispatch?.({ ...input, actionId: `settle:${input.runId}:${generationId}`, kind: "generation.read", args: { generationId } });
    receipt = await executeCreativeAgentMediaTool({ ...input, actionId: `settle:${input.runId}:${generationId}`, kind: "generation.read", args: { generationId } }, deps);
   } catch (error) {
    // These reads never submit a generation. A local edit racing stable node.create
    // can therefore be retried against the next committed canvas revision.
    if (["CANVAS_REVISION_CONFLICT", "CANVAS_READ_CHANGED"].includes(String((error as { code?: string })?.code))) continue;
    throw error;
   }
   if (results.get(generationId)?.status !== receipt.status) await options.onProgress?.(receipt);
   results.set(generationId, receipt);
   if (["failed", "cancelled", "canceled"].includes(String(receipt.status))) {
    failures.push(generationId); pending.delete(generationId); continue;
   }
   if (receipt.status === "processing" && !(receipt.outputs as unknown[])?.length) {
    const row = await deps.findGeneration({ id: generationId });
    if (row?.status === "success" && !row.localPath) throw new CreativeAgentError("MEDIA_OUTPUT_INVALID", "生成记录没有已保存的媒体，不能视为完成");
   }
   if (receipt.status !== "success") continue;
   if (typeof receipt.revision !== "string" || !Array.isArray(receipt.nodeIds)) throw new CreativeAgentError("MEDIA_OUTPUT_INVALID", "生成结果尚未完成画布回写");
   await options.onCommitted({ generationId, revision: receipt.revision, nodeIds: receipt.nodeIds as string[] });
   pending.delete(generationId);
  }
  if (options.pollOnce && pending.size) return { generations: [...results.values()], pendingGenerationIds: [...pending] };
  if (pending.size) await delay(GENERATION_FINALIZE_BACKOFF_MS, undefined, { signal: input.signal });
 }
 if (failures.length) throw Object.assign(new CreativeAgentError("MEDIA_GENERATION_FAILED", "本次有生成任务失败或取消，已保留其他完成的画布结果"), { generationIds: failures, generations: [...results.values()] });
 return { generations: options.generationIds.filter((id, index, ids) => ids.indexOf(id) === index).map(id => results.get(id)!), pendingGenerationIds: [] };
}
