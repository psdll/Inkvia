import { hash, type MessageInput } from './store-types';
import { activeFieldFacts, composedQuantity, assertIndependentOutputQuantitySources, assertQuantitySourceSemantics } from './matching-contracts';
import type { GenerationPlan } from './generation-plan';
import { CreativeAgentError } from './errors';
import { requestedMediaOutputMinimum } from './media-authorization';

export type GenerationAllowance = { finalOutputs: number; intermediateOutputs: number; initialCalls: number; retryCalls: number; totalOutputs?: number; totalCalls?: number };
export type SavedGenerationPlan = { id: string; plan: GenerationPlan; expiresAt: string };
export type GenerationExecution = { planId: string; stepId: string; receiptId: string; requestHash: string; limits: GenerationAllowance; expiresAt: string };
export type GenerationReservationInput = { planId: string; stepId: string; receiptId: string; actionId: string; requestKeys: string[]; requestHash: string; retryOf?: string };
export type GenerationObservation = { generationId: number; rawReturned?: number; uniqueOutputs: number; savedOutputs: number };
export type GenerationReservation = Omit<GenerationReservationInput, 'requestKeys'> & { requestKey: string; phase: 'reserved' | 'started' | 'released'; finalOutputs: number; intermediateOutputs: number; expectedOutputs: number; outputUpper?: number; observation?: GenerationObservation };
export type GenerationQuantityLedger = { version: 1; frozen?: boolean; reservations: GenerationReservation[] };
const reject = (code: string, message: string): never => { throw new CreativeAgentError(code, message, 409); };

/** Only previously source-validated, active hard facts can authorize additional work. */
export function generationAllowance(input: Pick<MessageInput, 'requirements'>): GenerationAllowance {
 const facts = input.requirements?.facts ?? [];
 try { assertQuantitySourceSemantics(facts); assertIndependentOutputQuantitySources(facts); }
 catch { return reject('QUANTITY_SOURCE_INVALID', '数量缺少独立且明确的用户来源，请重新核对。'); }
 const value = (field: string) => {
  const composed = composedQuantity(input.requirements, field);
  if (composed !== undefined) return composed;
  const active = activeFieldFacts(facts, field).filter(fact => fact.strength === 'hard');
  if (!active.length) return undefined;
  const values = new Set(active.map(fact => fact.value));
  if (values.size !== 1 || typeof active[0].value !== 'number') return reject('QUANTITY_SOURCE_INVALID', '数量要求存在冲突，请先澄清。');
  return active[0].value as number;
 };
 const intermediateOutputs = value('generation.intermediateOutputs') ?? 0;
 const totalOutputs = value('generation.totalOutputs');
 const finalOutputs = value('generation.finalOutputs') ?? ((value('image.quantity') ?? 0) + (value('video.quantity') ?? 0) || (totalOutputs === undefined ? input.requirements?.continuation?.targets.length ?? 1 : Math.max(0, totalOutputs - intermediateOutputs)));
 return { ...(value("generation.totalCalls") !== undefined ? {totalCalls:value("generation.totalCalls")}:{}), finalOutputs, intermediateOutputs, initialCalls: value('generation.initialCalls') ?? finalOutputs + intermediateOutputs, retryCalls: value('generation.retryCalls') ?? 0, ...(value('generation.totalOutputs') !== undefined ? { totalOutputs: value('generation.totalOutputs') } : {}) };
}
export function generationExecution(input: MessageInput, planId: string, stepId: string): GenerationExecution {
 const saved = input.generationPlans?.[planId], step = saved?.plan.steps.find(step => step.id === stepId);
 if (!saved || !step?.receipt) return reject('SELECTION_RECEIPT_STALE', '当前步骤尚未形成完整方案。');
 const limits = generationAllowance(input);
 const totals = {finalOutputs:0,intermediateOutputs:0,initialCalls:0,maxReturned:0};
 const finalByMedia = {image:0,video:0};
 let unknownUpper = false;
 for (const item of saved.plan.steps) {
  const definition = saved.plan.definition.steps.find(value => value.id === item.id);
  const calls = item.receipt?.output.calls ?? (definition?.mediaType === 'image' ? Number(definition.params.count ?? 1) : 1);
  const outputs = Math.max(calls,item.receipt?.output.expectedReturned ?? item.receipt?.output.minReturned ?? calls);
  totals[item.role === 'final' ? 'finalOutputs' : 'intermediateOutputs'] += outputs;
  if(item.role === 'final' && (item.mediaType ?? definition?.mediaType)) finalByMedia[item.mediaType ?? definition!.mediaType] += outputs;
  totals.initialCalls += calls;
  if (item.receipt?.output.maxReturned === undefined) unknownUpper = true;
  else totals.maxReturned += item.receipt.output.maxReturned;
 }
 if (totals.finalOutputs > limits.finalOutputs || totals.intermediateOutputs > limits.intermediateOutputs || totals.initialCalls > limits.initialCalls || limits.totalCalls !== undefined && totals.initialCalls > limits.totalCalls || limits.totalOutputs !== undefined && (unknownUpper || totals.maxReturned > limits.totalOutputs)) return reject('QUANTITY_LIMIT', '整套方案的数量或调用范围超出本轮已核验要求，不能确认部分步骤后继续超量；请核对原文数量来源并调整完整方案。');
 if(input.mediaAuthorizationVersion === 1 && input.text) {
  const requested = {image:requestedMediaOutputMinimum(input.text,'image'),video:requestedMediaOutputMinimum(input.text,'video')};
  const finalAnswer = activeFieldFacts(input.requirements?.facts ?? [],'generation.finalOutputs').some(fact=>fact.strength === 'hard' && (fact.source.kind === 'answer' || fact.source.correction));
  for(const media of ['image','video'] as const) {
   const field = `${media}.quantity`;
   const corrected = activeFieldFacts(input.requirements?.facts ?? [],field).filter(fact=>fact.strength === 'hard' && (fact.source.kind === 'answer' || fact.source.correction));
   const other = media === 'image' ? 'video' : 'image';
   const singleMediaFinal = finalAnswer && requested[media] !== undefined && requested[other] === undefined && finalByMedia[other] === 0;
   const required = singleMediaFinal ? limits.finalOutputs : corrected.length ? composedQuantity(input.requirements,field) ?? Number(corrected[0].value) : requested[media];
   if(required !== undefined && finalByMedia[media] < required) return reject('GENERATION_PLAN_INCOMPLETE', `当前完整请求需要${required}份${media === 'image' ? '图片' : '视频'}，现有计划只覆盖${finalByMedia[media]}份；请用 generation_plan 列全最终产物与步骤，并记录真实总数或全部组合分项的数量来源，不能将一项单步当作整轮完成。`);
  }
 }
 return { planId, stepId, receiptId: step.receipt.id, requestHash: hash(step.receipt.request), limits, expiresAt: saved.expiresAt };
}

/** Called only while the caller holds the run row lock; returns a fresh JSON snapshot. */
export function reserveGenerationQuantity(input: MessageInput, request: GenerationReservationInput): MessageInput {
 const saved = input.generationPlans?.[request.planId];
 const step = saved?.plan.steps.find(step => step.id === request.stepId), receipt = step?.receipt;
 if (!saved || !receipt || saved.plan.requirementsRevision !== (input.requirements?.revision ?? 0) || receipt.requirementsRevision !== saved.plan.requirementsRevision || receipt.id !== request.receiptId || hash(receipt.request) !== request.requestHash || Date.parse(saved.expiresAt) <= Date.now()) return reject('SELECTION_RECEIPT_STALE', '方案版本、输入或有效期已变化，请重新确认。');
 const state = structuredClone(input), ledger = state.quantityLedger ??= { version: 1, reservations: [] };
 const prior = ledger.reservations.filter(item => item.actionId === request.actionId);
 if (prior.length) {
  if (prior.length !== request.requestKeys.length || prior.some((item, index) => item.requestKey !== request.requestKeys[index] || item.planId !== request.planId || item.stepId !== request.stepId || item.receiptId !== request.receiptId || item.requestHash !== request.requestHash || item.retryOf !== request.retryOf || item.phase === 'released')) return reject('QUANTITY_RESERVATION_CONFLICT', '本次操作已有不同的数量预留。');
  return state;
 }
 if (ledger.frozen) return reject('OUTPUT_CONTRACT_MISMATCH', '实际产物超出方案约定，已停止后续生成并保留全部结果。');
 const allowance = generationAllowance(input), active = ledger.reservations.filter(item => item.phase !== 'released');
 if (!request.requestKeys.length || new Set(request.requestKeys).size !== request.requestKeys.length || active.some(item => request.requestKeys.includes(item.requestKey))) return reject('QUANTITY_RESERVATION_CONFLICT', '生成请求身份重复。');
 if (!request.retryOf && request.requestKeys.length !== receipt.output.calls || request.retryOf && (request.requestKeys.length !== 1 || !active.some(item => item.requestKey === request.retryOf && item.phase === 'started' && item.planId === request.planId && item.stepId === request.stepId) || active.some(item => item.retryOf === request.retryOf))) return reject('QUANTITY_LIMIT', '调用或补试次数不属于已确认方案。');
 if (!request.retryOf && active.some(item => !item.retryOf && item.stepId === request.stepId && (input.generationPlans?.[item.planId]?.plan.rootPlanId ?? item.planId) === (saved.plan.rootPlanId ?? request.planId))) return reject('QUANTITY_RESERVATION_CONFLICT', '同一个方案步骤已有生成请求，不能更换操作身份再次派发。');
 const count = request.requestKeys.length;
 if (allowance.totalCalls !== undefined && active.length + count > allowance.totalCalls) return reject('QUANTITY_LIMIT', '本轮总调用次数包含补试，不能超出。');
 const requested = Math.max(receipt.output.calls, receipt.output.expectedReturned ?? receipt.output.minReturned) / receipt.output.calls;
 const upper = receipt.output.maxReturned === undefined ? undefined : receipt.output.maxReturned / receipt.output.calls;
 const finals = request.retryOf || step.role !== 'final' ? 0 : requested * count;
 const intermediates = request.retryOf || step.role !== 'intermediate' ? 0 : requested * count;
 const sum = (key: 'finalOutputs' | 'intermediateOutputs') => active.reduce((n, item) => n + item[key], 0);
 if (sum('finalOutputs') + finals > allowance.finalOutputs || sum('intermediateOutputs') + intermediates > allowance.intermediateOutputs || active.filter(item => !item.retryOf).length + (request.retryOf ? 0 : count) > allowance.initialCalls || active.filter(item => item.retryOf).length + (request.retryOf ? count : 0) > allowance.retryCalls) return reject('QUANTITY_LIMIT', '本轮生成数量或调用次数已用完；新方案不会重置已用次数。');
 if (allowance.totalOutputs !== undefined && (upper === undefined || active.some(item => item.outputUpper === undefined) || active.reduce((n,item) => n + Math.max(item.outputUpper ?? 0, item.observation?.uniqueOutputs ?? 0), 0) + upper * count > allowance.totalOutputs)) return reject('QUANTITY_LIMIT', '无法在包含中间产物和补试的总生成上限内执行。');
 for (const requestKey of request.requestKeys) ledger.reservations.push({ planId:request.planId, stepId:request.stepId, receiptId:request.receiptId, actionId:request.actionId, requestHash:request.requestHash, ...(request.retryOf ? {retryOf:request.retryOf}:{}), requestKey, phase:'reserved', expectedOutputs:requested, finalOutputs:finals/count, intermediateOutputs:intermediates/count, ...(upper === undefined ? {} : {outputUpper:upper}) });
 return state;
}
export function transitionGenerationReservation(input: MessageInput, requestKey: string, phase: 'started' | 'released'): MessageInput {
 const state = structuredClone(input), reservation = state.quantityLedger?.reservations.find(item => item.requestKey === requestKey);
 if (phase === 'started' && state.quantityLedger?.frozen) return reject('OUTPUT_CONTRACT_MISMATCH', '实际产物超出约定，后续生成已停止。');
 if (!reservation || reservation.phase !== 'reserved' && reservation.phase !== phase) return reject('QUANTITY_RESERVATION_CONFLICT', '已提交或不确定的调用不能释放或重新提交。');
 reservation.phase = phase;
 return state;
}
export function observeGenerationQuantity(input: MessageInput, requestKey: string, observation: GenerationObservation): MessageInput {
 const state = structuredClone(input), ledger = state.quantityLedger, reservation = ledger?.reservations.find(item => item.requestKey === requestKey);
 if (!ledger || !reservation) return state; // Historical v1 delivery has no quantity ledger.
 if (reservation.phase === 'released') return reject('QUANTITY_RESERVATION_CONFLICT', '已释放的调用出现真实产物，需要人工核对。');
 const previous = reservation.observation;
 if (previous && previous.generationId !== observation.generationId) return reject('QUANTITY_RESERVATION_CONFLICT', '同一生成请求出现不同结果身份。');
 reservation.phase = 'started';
 reservation.observation = { ...observation, rawReturned: Math.max(previous?.rawReturned ?? 0, observation.rawReturned ?? 0) || undefined, uniqueOutputs:Math.max(previous?.uniqueOutputs ?? 0,observation.uniqueOutputs),savedOutputs:Math.max(previous?.savedOutputs ?? 0,observation.savedOutputs) };
 if (Math.max(reservation.observation.rawReturned ?? 0,reservation.observation.uniqueOutputs) > (reservation.outputUpper ?? reservation.expectedOutputs)) ledger.frozen = true;
 return state;
}
