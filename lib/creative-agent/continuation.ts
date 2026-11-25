import { isShortContinuationDirective, isNegatedMediaInstruction } from './media-authorization';
import 'server-only';
import { z } from 'zod';
import { v5 as uuidv5 } from 'uuid';
import { refSchema } from './media-capabilities';
import { requirementSourceSchema } from './matching-contracts';
import { hash, type Run } from './store-types';
import { generationOutputPaths } from '@/lib/generation/output-paths';
import { CreativeAgentError } from './errors';
import type { SelectionReceipt } from './matching';
import type { ResolvedReference } from './media-capabilities';

export const continuationSchema = z.object({ directive: requirementSourceSchema, targets: z.array(z.object({ sourceActionId: z.string().min(1).max(256), reference: refSchema }).strict()).min(1).max(16) }).strict();
export type ContinuationInput = z.infer<typeof continuationSchema>;
export type VerifiedContinuation = { directive: ContinuationInput['directive']; targets: { sourceActionId: string; sourceRunId: string; sourceReceiptId: string; requestHash: string; generationId: number; reference: z.infer<typeof refSchema>; contentVersion: string; mediaType: 'image' | 'video'; params: Record<string, string | number | boolean> }[] };
type Source = { id: string; run_id: string; session_id: string; actor_user_id: number; canvas_id: number; created_at: Date | string; state: string; kind: string; result: Record<string, any> };
type Generation = { id: number; authUserId: number | null; canvasId: number | null; source: string | null; model: string | null; status: string; localPath: string | null; templateData: string | null; requestKey?: string | null };
const reject = (message: string): never => { throw new CreativeAgentError('CONTINUATION_INVALID', message, 400); };
/** Resolve only durable, scoped results. Old approval, model choice and retry budgets are not inherited. */
export async function verifyContinuation(run: Run, input: ContinuationInput, deps: { source(id: string): Promise<Source | undefined>; generations(ids: number[]): Promise<Generation[]>; bind(reference: z.infer<typeof refSchema>): Promise<ResolvedReference>; latestRun(): Promise<{id:string; outputCount:number} | undefined> }): Promise<VerifiedContinuation> {
  const directive = input.directive;
  if (directive.kind !== 'message' || directive.sourceId !== run.input.messageId || directive.fieldId || directive.channel) return reject('续改须引用本轮用户的修改指令。');
  const start = directive.start ?? run.input.text.indexOf(directive.quote), end = directive.end ?? start + directive.quote.length;
  if (start < 0 || run.input.text.slice(start,end) !== directive.quote || directive.start === undefined && run.input.text.indexOf(directive.quote,start+1) !== -1) return reject('续改指令与本轮原文不一致。');
  const shortFollowup=run.input.mediaAuthorizationVersion===1 && input.targets.length===1 && directive.quote.trim()===run.input.text.trim() && isShortContinuationDirective(directive.quote);
  if (!shortFollowup && (!/(?:改|调整|修改|编辑|edit|change)/i.test(directive.quote) || !/(?:其他不变|其余不变|保持|保留|不变|keep|preserve)/i.test(directive.quote) || [...run.input.text.matchAll(/(?:改|调整|修改|编辑|edit|change)/ig)].some(match=>isNegatedMediaInstruction(run.input.text.slice(0,match.index),run.input.text.slice(match.index!+match[0].length))))) return reject('请明确要修改的结果及需要保留的设置。');
  if (input.targets.length > 1 && /只(?:改|修改|调整)[^，。]{0,40}(?:第[^，。]{1,6}张|那张|那条|那段|这一张|一张)/.test(run.input.text)) return reject('本轮只要求修改一个结果，请精确指定该结果。');
  const identities = input.targets.map(target => hash(target.reference));
  if (new Set(identities).size !== identities.length) return reject('同一个修改目标不能重复计数。');
  const selected = run.input.selection.references;
  const explicitlySelected = input.targets.every(target => selected.some(ref => ref.nodeId === target.reference.nodeId && ref.batchId === target.reference.batchId && ref.outputId === target.reference.outputId));
  if (input.targets.length > 1 && !explicitlySelected) return reject('请明确选择本次要修改的这一组结果。');
  const targets: VerifiedContinuation['targets'] = [];
  const verifiedOutputs = new Set<string>();
  for (const target of input.targets) {
    const source = await deps.source(target.sourceActionId);
    if (!source || source.run_id === run.id || source.session_id !== run.sessionId || source.actor_user_id !== run.actorUserId || source.canvas_id !== run.canvasId || source.state !== 'succeeded' || !['image.generate','video.generate'].includes(source.kind) || new Date(source.created_at).getTime() >= Date.parse(run.createdAt)) return reject('continuation.targets[].sourceActionId 必须是本对话较早成功 image_generate/video_generate 返回的 actionId，且对应 reference；不能用 generation_plan/requirements 的ID、generationId或nodeId。');
    const receipt = source.result.selectionReceipt as SelectionReceipt | undefined;
    if (!receipt?.id || !receipt.request || hash(receipt.request) !== hash(source.result.mediaRequest?.args)) return reject('来源缺少一致的原始生成设置。');
    let retryRequestKey: string | undefined;
    if (source.result.retryOfGenerationId !== undefined || source.result.retryParentActionId !== undefined) {
      const parent = typeof source.result.retryParentActionId === 'string' ? await deps.source(source.result.retryParentActionId) : undefined;
      const failedId = source.result.retryOfGenerationId;
      if (!parent || parent.id === source.id || parent.run_id !== source.run_id || parent.session_id !== source.session_id || parent.actor_user_id !== source.actor_user_id || parent.canvas_id !== source.canvas_id || parent.kind !== source.kind || parent.state !== 'succeeded' || parent.result.retryOfGenerationId !== undefined || !Number.isSafeInteger(failedId) || !parent.result.generationIds?.includes(failedId) || hash(parent.result.selectionReceipt) !== hash(receipt) || hash(parent.result.mediaRequest) !== hash(source.result.mediaRequest)) return reject('补试来源与原生成操作不一致。');
      const failed = (await deps.generations([failedId])).find(row => row.id === failedId && row.authUserId === run.actorUserId && row.canvasId === run.canvasId && row.source === 'agent' && row.model === receipt.request.model && row.status === 'failed');
      if (!failed?.requestKey || source.result.retryAttempt !== 1 || source.id !== uuidv5(`retry-action:${parent.id}:${failedId}:1`, '43b3f8e4-59b6-4189-b3e1-0dfd02485b51')) return reject('补试来源缺少可核验的失败任务关联。');
      retryRequestKey = uuidv5(`retry:${failed.requestKey}:1`, '43b3f8e4-59b6-4189-b3e1-0dfd02485b51');
    }
    const resolved = await deps.bind(target.reference);
    if (resolved.facts?.state !== 'verified' || !resolved.facts.contentVersion || resolved.kind !== receipt.mediaType) return reject('修改目标尚未通过素材版本核验。');
    const ids = Array.isArray(source.result.generationIds) ? source.result.generationIds : [source.result.generationId];
    const rows = await deps.generations(ids.filter((id: unknown): id is number => Number.isSafeInteger(id)));
    const row = rows.find(row => row.authUserId === run.actorUserId && row.canvasId === run.canvasId && row.source === 'agent' && row.status === 'success' && (!retryRequestKey || row.requestKey === retryRequestKey) && row.model === receipt.request.model && generationOutputPaths(row).includes(resolved.url));
    if (!row) return reject('所选素材不是该生成操作的已完成产物。');
    // Optional reference fields and duplicate canvas nodes must not multiply one result.
    const outputIdentity = hash({ generationId: row.id, url: resolved.url, contentVersion: resolved.facts.contentVersion });
    if (verifiedOutputs.has(outputIdentity)) return reject('同一个已核验结果不能重复计数。');
    verifiedOutputs.add(outputIdentity);
    let saved: Record<string, any>; try { saved = JSON.parse(row.templateData || '{}'); } catch { return reject('来源生成设置无法核验。'); }
    if (saved.agentOutputContract?.receiptId !== receipt.id) return reject('来源结果与原始生成方案不一致。');
    const latest = !explicitlySelected ? await deps.latestRun() : undefined;
    const describedSingle = /只(?:改|修改|调整)[^，。]{1,40}(?:那张|那条|那段|这一张)/.test(directive.quote);
    if (!explicitlySelected && (latest?.id !== source.run_id || latest.outputCount !== 1 && !describedSingle)) return reject('存在多个可能的修改目标，请先指定其中一个。');
    const params: Record<string, string | number | boolean> = {};
    for (const key of receipt.mediaType === 'image' ? ['aspectRatio','resolution','quality','background'] : ['ratio','resolution','duration','generateAudio']) {
      const value = receipt.request.params[key];
      if (value === undefined || value === '') continue;
      if (!['string','number','boolean'].includes(typeof value)) return reject('来源参数格式无效。');
      if (saved[key] === undefined || saved[key] !== value) return reject('来源设置与已提交记录不一致，不能推测需要保留的参数。');
      params[key] = value as string | number | boolean;
    }
    if (!Object.keys(params).length) return reject('来源没有可核验的生成参数。');
    targets.push({ sourceActionId: source.id, sourceRunId: source.run_id, sourceReceiptId: receipt.id, requestHash: hash(receipt.request), generationId: row.id, reference: target.reference, contentVersion: resolved.facts.contentVersion, mediaType: receipt.mediaType, params });
  }
  return { directive: { ...directive, start, end }, targets };
}
