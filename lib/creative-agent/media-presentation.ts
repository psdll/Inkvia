import type { GenerationExecution } from "./quantity";
import type { SelectionReceipt } from "./matching";
export type CreativeAgentMediaPresentation = {
  selectionReceipt?: SelectionReceipt;
  planSummary?: ReturnType<typeof presentGenerationStep>;
  mediaType: "image" | "video";
  model: { id: string; label: string };
  prompt: string;
  params: Record<string, unknown>;
  units: number;
  references: { nodeId: string; kind: "image" | "video" | "audio"; url: string; label?: string }[];
};

/** Small, credential-free contract for confirmation and activity UI. */
export function presentGenerationStep(receipt: SelectionReceipt, execution: GenerationExecution, plan?: import("./generation-plan").GenerationPlan) {
  const wholePlan = plan ? {
    finalOutputs: plan.steps.filter(step => step.role === "final").reduce((n,step) => n + (step.receipt?.output.expectedReturned ?? step.receipt?.output.exactReturned ?? Number(plan.definition.steps.find(item=>item.id===step.id)?.params.count ?? 1)),0),
    intermediateOutputs: plan.steps.filter(step => step.role === "intermediate").reduce((n,step) => n + (step.receipt?.output.expectedReturned ?? step.receipt?.output.exactReturned ?? Number(plan.definition.steps.find(item=>item.id===step.id)?.params.count ?? 1)),0),
    initialCalls:plan.totals.plannedCalls, steps:plan.steps.length, currentStep:plan.steps.findIndex(step=>step.id===execution.stepId)+1,
    unreadySteps:plan.totals.unreadySteps, minReturned:plan.totals.minReturned, ...(plan.totals.maxReturned === undefined ? {} : {maxReturned:plan.totals.maxReturned}),
  } : undefined;
  return { ...(wholePlan ? {wholePlan} : {}), planId: execution.planId, stepId: execution.stepId, limits: execution.limits, output: receipt.output, selectedWhy: receipt.reasons };
}
