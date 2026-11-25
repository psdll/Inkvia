import "server-only";
import { subjectIntentSchema } from "./conversation-context";
import { z } from "zod";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { requirementFactSchema } from "./matching-contracts";
import { imageSchema, videoSchema, refSchema, type CreativeAgentMediaReference, type ResolvedReference } from "./media-capabilities";
import { matchCreativeAgentMedia, type CreativeAgentMediaDependencies } from "./media-broker";
import { bindCreativeReferenceFacts } from "./reference-facts";
import type { CreativeAgentToolInput } from "./canvas-tools";
import type { SelectionReceipt, MatchingExclusion } from "./matching";
import { CreativeAgentError } from "./errors";

const dependency = z.object({ stepId: z.string().min(1).max(64), outputIndex: z.number().int().min(0).max(99) }).strict();
const reference = refSchema;
const step = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), role: z.enum(["final", "intermediate"]), mediaType: z.enum(["image", "video"]), prompt: z.string().trim().min(1).max(20000), params: z.record(z.unknown()).default({}), references: z.array(z.union([reference, dependency])).max(16).default([]), dependsOn: z.array(z.string().min(1).max(64)).max(32).default([]), previewMode: z.enum(["normal", "draft"]).optional() }).strict();
export const generationPlanSchema = z.object({ subject: subjectIntentSchema.optional(), facts: z.array(requirementFactSchema).max(64).optional(), task: z.string().max(500).optional(), priorities: z.array(z.enum(["quality", "speed", "consistency"])).max(3).optional(), steps: z.array(step).min(1).max(32) }).strict();
export type GenerationPlanInput = z.infer<typeof generationPlanSchema>;
export type GenerationPlan = { version: 1; definition: GenerationPlanInput; rootPlanId?: string; requirementsRevision: number; steps: { id: string; role: "final" | "intermediate"; mediaType: "image" | "video"; dependsOn: string[]; status: "ready" | "blocked" | "unavailable"; receipt?: SelectionReceipt; missingOutputs?: z.infer<typeof dependency>[]; exclusions?: MatchingExclusion[] }[]; totals: { plannedCalls: number; readyCalls: number; unreadySteps: number; minReturned: number; maxReturned?: number }; evidenceLimits: string[] };
export type PlanOutputBindings = Record<string, CreativeAgentMediaReference[]>;

/** Reusable finalization boundary: Task 3 supplies actual journaled outputs, never guessed node IDs. */
export async function createCreativeGenerationPlan(input: CreativeAgentToolInput, deps?: Pick<CreativeAgentMediaDependencies, "catalog" | "readCanvas" | "bindReference" | "evidence">, bindings: PlanOutputBindings = {}): Promise<GenerationPlan> {
  const args = generationPlanSchema.parse(input.args);
  const byId = new Map(args.steps.map(step => [step.id, step]));
  if (byId.size !== args.steps.length) throw new CreativeAgentError("PLAN_DEPENDENCY_INVALID", "计划步骤ID必须唯一", 400);
  const dependencies = (step: GenerationPlanInput["steps"][number]) => [...new Set([...step.dependsOn, ...step.references.flatMap(ref => "stepId" in ref ? [ref.stepId] : [])])];
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id) || !byId.has(id)) throw new CreativeAgentError("PLAN_DEPENDENCY_INVALID", "计划依赖包含循环或不存在的步骤", 400);
    visiting.add(id); dependencies(byId.get(id)!).forEach(visit); visiting.delete(id); visited.add(id);
  };
  args.steps.forEach(step => {
    visit(step.id);
    (step.mediaType === "image" ? imageSchema.shape.params : videoSchema.shape.params).parse(step.params);
  });
  if (!deps) {
    const [{ getEffectiveCreativeMediaCatalog }, { readCreativeAgentCanvas }] = await Promise.all([import("./effective-media-catalog"), import("./canvas-tools")]);
    deps = { catalog: getEffectiveCreativeMediaCatalog, readCanvas: current => readCreativeAgentCanvas(current.actorUserId, current.canvasId), bindReference: bindCreativeReferenceFacts };
  }
  const [catalog, snapshot, evidence] = await Promise.all([deps.catalog(), deps.readCanvas(input), deps.evidence?.() ?? []]);
  const referenceCache = new Map<string, Promise<ResolvedReference>>();
  const cached = { ...deps, evidence: async () => evidence, catalog: async () => catalog, readCanvas: async () => snapshot, bindReference: (current: CreativeAgentToolInput, node: Parameters<typeof bindCreativeReferenceFacts>[1], ref: ResolvedReference) => {
    const key = hashCanvasMutationPayload(ref);
    let promise = referenceCache.get(key);
    if (!promise) { promise = (deps!.bindReference ?? bindCreativeReferenceFacts)(current, node, ref); referenceCache.set(key, promise); }
    return promise;
  } };
  const plan: GenerationPlan = { version: 1, definition: structuredClone(args), requirementsRevision: input.matching?.requirements?.revision ?? 0, steps: [], totals: { plannedCalls: 0, readyCalls: 0, unreadySteps: 0, minReturned: 0, maxReturned: 0 }, evidenceLimits: ["本计划不提交生成；实际执行须满足当前运行的授权与数量约束。", "全局数量预留、依赖继续和重试上限由执行阶段校验。"] };
  for (const step of args.steps) {
    const dependsOn = dependencies(step);
    const missingOutputs = step.references.flatMap(ref => "stepId" in ref && !bindings[ref.stepId]?.[ref.outputIndex] ? [ref] : []);
    plan.totals.plannedCalls += step.mediaType === "image" ? imageSchema.shape.params.parse(step.params).count : 1;
    if (missingOutputs.length || dependsOn.some(id => !Object.hasOwn(bindings, id))) {
      plan.steps.push({ id: step.id, role: step.role, mediaType: step.mediaType, dependsOn, status: "blocked", missingOutputs });
      plan.totals.unreadySteps++; delete plan.totals.maxReturned; continue;
    }
    const references = step.references.map(ref => "stepId" in ref ? bindings[ref.stepId][ref.outputIndex] : ref);
    const { match } = await matchCreativeAgentMedia({ ...input, kind: `${step.mediaType}.generate`, args: { prompt: step.prompt, params: step.params, references, ...(step.previewMode ? { previewMode: step.previewMode } : {}) }, matching: { policyVersion: 2, ...input.matching, task: args.task, priorities: args.priorities } }, cached);
    plan.steps.push({ id: step.id, role: step.role, mediaType: step.mediaType, dependsOn, status: match.selected ? "ready" : "unavailable", ...(match.selected ? { receipt: match.selected } : {}), exclusions: match.exclusions });
    if (match.selected) {
      plan.totals.readyCalls += match.selected.output.calls; plan.totals.minReturned += match.selected.output.minReturned;
      if (match.selected.output.maxReturned === undefined) delete plan.totals.maxReturned;
      else if (plan.totals.maxReturned !== undefined) plan.totals.maxReturned += match.selected.output.maxReturned;
    } else { plan.totals.unreadySteps++; delete plan.totals.maxReturned; }
  }
  return plan;
}
