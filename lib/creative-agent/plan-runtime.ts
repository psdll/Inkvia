import 'server-only';
import { hash, type Run } from './store-types';
import { CreativeAgentError } from './errors';
import { creativeAgentNodeHash, readCreativeAgentCanvas, executeCreativeAgentTool } from './canvas-tools';
import { createCreativeGenerationPlan, type PlanOutputBindings } from './generation-plan';
import { createCreativeTools } from './tools';
import { creativeAgentStore, type CreativeAgentStore } from './store';
import type { AgentCanvasSnapshot } from './canvas-tools';
import type { CreativeAgentMediaReference } from './media-capabilities';

type Dependencies = {
 store?: CreativeAgentStore;
 readCanvas?: (actorUserId: number, canvasId: number) => Promise<AgentCanvasSnapshot>;
 finalize?: typeof createCreativeGenerationPlan;
 executeStep?: (run: Run, planId: string, stepId: string) => Promise<unknown>;
 signal?: AbortSignal;
};
/** No model loop or new scheduler: only journaled plans and real, attached outputs. */
export async function advancePersistedPlan(run: Run, observations: Record<string, any>[], dependencies: Dependencies = {}): Promise<'complete' | 'waiting' | 'dispatched'> {
 if (run.input.matchingPolicyVersion !== 2) return 'complete';
 const store = dependencies.store ?? creativeAgentStore;
 const current = await store.getRun(run.id, run.actorUserId);
 if (current.input.quantityLedger?.frozen) throw new CreativeAgentError('OUTPUT_CONTRACT_MISMATCH', '实际产物超出约定，已保留全部结果并停止后续生成。');
 const plans = current.input.generationPlans ?? {};
 if (!Object.keys(plans).length) return 'complete';
 const actions = await store.actionReceipts(run.id);
 const rootId = (id: string) => plans[id]?.plan.rootPlanId ?? id;
 const executionFor = (action: typeof actions[number]) => action.result?.mediaRequest?.matching?.execution ?? action.result?.planExecution;
 const activated = new Set(actions.flatMap(action => {
  const id = executionFor(action)?.planId;
  return typeof id === 'string' ? [rootId(id)] : [];
 }));
 const replacements = new Map(actions.filter(action => action.result?.retryOfGenerationId).map(action => [action.result.retryOfGenerationId, action.result.generationIds?.[0]]));
 const byGeneration = new Map(observations.map(receipt => [receipt.generationId, receipt]));
 let snapshot: AgentCanvasSnapshot | undefined;
 for (const planId of activated) {
  const saved = plans[planId];
  if (!saved) throw new CreativeAgentError('SELECTION_RECEIPT_STALE', '无法读取完整方案，不能猜测后续步骤。');
  const bindings: PlanOutputBindings = {};
  const completed = new Set<string>();
  const pending = new Set<string>();
  const completedOutputs = new Map<string, Record<string, any>[]>();
  for (const step of saved.plan.steps) {
   const action = actions.find(action => {
    const execution = executionFor(action);
    return execution && rootId(execution.planId) === planId && execution.stepId === step.id && !action.result?.retryOfGenerationId;
   });
   if (!action) continue;
   if (action.result?.cancelled) throw new CreativeAgentError('PLAN_STEP_CANCELLED', action.result?.message || '用户已取消或要求修改此步骤，后续计划未继续派发。');
   if (action.state === 'failed') throw new CreativeAgentError(action.result?.code || (action.result?.rejectedBeforeDispatch ? 'MEDIA_NOT_DISPATCHED' : 'PLAN_STEP_FAILED'), action.result?.message || '此步骤已确定失败，后续计划未继续派发。');
   if (action.state !== 'succeeded') throw new CreativeAgentError('MEDIA_DISPATCH_UNKNOWN', '此步骤已有执行记录，结果确认前不能再次提交。');
   const ids: number[] = (action.result?.generationIds ?? []).map((id:number) => replacements.get(id) ?? id);
   const results = ids.map(id => byGeneration.get(id));
   if (results.some(item => item && ['failed','cancelled','canceled'].includes(item.status))) throw new CreativeAgentError('PLAN_DEPENDENCY_FAILED', '前序步骤未成功，依赖它的后续生成已停止。');
   if (!ids.length || results.some(item => !item || item.status !== 'success' || !item.revision || !item.outputs?.length || !item.nodeIds?.length)) { pending.add(step.id); continue; }
   completed.add(step.id);
   completedOutputs.set(step.id, results as Record<string, any>[]);
  }
  for (const step of saved.plan.steps.filter(item => completed.has(item.id))) {
   const results = completedOutputs.get(step.id)!;
   // Only outputs needed by unfinished steps need a fresh node/hash binding.
   if (!saved.plan.definition.steps.some(next => !completed.has(next.id) && next.references.some(ref => 'stepId' in ref && ref.stepId === step.id))) { bindings[step.id] = []; continue; }
   snapshot ??= await (dependencies.readCanvas ?? readCreativeAgentCanvas)(run.actorUserId, run.canvasId);
   bindings[step.id] = results.flatMap(item => item!.outputs.map((output: {nodeId?:string; url:string; generationId?:number}) => {
    const node = snapshot!.nodes.find(node => node.id === output.nodeId && item!.nodeIds.includes(node.id));
    if (!node) throw new CreativeAgentError('REFERENCE_NOT_READY', '已生成素材尚未完成画布回写，请先恢复素材。');
    const base: CreativeAgentMediaReference = { nodeId:node.id, semanticHash:creativeAgentNodeHash(node) };
    const data = node.data;
    if (data.kind === 'imageTask') {
     for (const batch of data.task.batches) {
      const generated = batch.outputs.find(candidate => candidate.status === 'success' && candidate.url === output.url && (!output.generationId || candidate.generationId === output.generationId));
      if (generated) return {...base,batchId:batch.id,outputId:generated.id,...(generated.generationId ? {generationId:generated.generationId}:{})};
     }
    } else if ((data.kind === 'videoTask' || data.kind === 'audioTask') && data.status === 'success' && data.outputUrl === output.url) return {...base,generationId:data.generationId,outputId:data.requestKey};
    else if ((data.kind === 'image' || data.kind === 'video' || data.kind === 'audio') && data.url === output.url) return {...base,mediaId:data.mediaId};
    throw new CreativeAgentError('REFERENCE_OUTPUT_CHANGED', '前序产物与当前画布素材不一致，请重新确认。');
   }));
  }
  for (const step of saved.plan.steps) {
   if (completed.has(step.id) || pending.has(step.id)) continue;
   if (step.dependsOn.some(id => !completed.has(id))) continue;
   dependencies.signal?.throwIfAborted(); await store.assertFence(run.id, run.epoch);
   let selectedPlanId = planId;
   if (step.status !== 'ready') {
    const finalized = await (dependencies.finalize ?? createCreativeGenerationPlan)({actorUserId:run.actorUserId,canvasId:run.canvasId,runId:run.id,actionId:planId,epoch:run.epoch,kind:'generation.plan',args:saved.plan.definition,matching:{policyVersion:2,preferences:current.input.effectivePreferences,requirements:current.input.requirements}}, undefined, bindings);
    if (finalized.steps.find(item => item.id === step.id)?.status !== 'ready') throw new CreativeAgentError('SELECTION_RECEIPT_STALE','后续步骤当前无法满足要求，请重新制定方案。');
    selectedPlanId = `${planId}:bound:${step.id}:${hash(bindings)}`;
    await store.saveGenerationPlan(run, selectedPlanId, {...finalized, rootPlanId:planId});
   }
   if (dependencies.executeStep) await dependencies.executeStep(current, selectedPlanId, step.id);
   else {
    const updated = await store.getRun(run.id, run.actorUserId);
    const receipt = updated.input.generationPlans![selectedPlanId].plan.steps.find(item => item.id === step.id)!.receipt!;
    const tool = createCreativeTools({...updated,epoch:run.epoch},store,executeCreativeAgentTool).find(tool => tool.name === `${step.mediaType}_generate`)!;
    await tool.execute(`plan:${planId}:${step.id}`,{...receipt.request,plan:{actionId:selectedPlanId,stepId:step.id}},dependencies.signal);
   }
   return 'dispatched';
  }
  if (completed.size < saved.plan.steps.length) return 'waiting';
 }
 return 'complete';
}
