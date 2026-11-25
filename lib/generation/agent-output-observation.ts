/** Internal observation metadata; never a substitute for provider count contracts. */
export type AgentOutputContract = { version: 2; receiptId: string; maxReturned?: number };
export type AgentOutputRecovery = { version: 1; key?: string; items: { outputIndex: number; state: 'pending' | 'saved' | 'failed' }[] };
export class AgentOutputSavePendingError extends Error {
  constructor() { super('生成已返回，素材保存待恢复；不会重新生成。'); this.name = 'AgentOutputSavePendingError'; }
}
/** Persist every source privately before the existing finalizer downloads any item. */
export async function prepareAgentImageRecovery(images: string[], template: Record<string, any>, dependencies: {
  preserveDuplicates?: boolean;
  capture(sources: string[]): Promise<string>;
  persist(template: Record<string, any>): Promise<unknown>;
}) {
  const unique = dependencies.preserveDuplicates ? images.filter(Boolean) : [...new Set(images.filter(Boolean))];
  const key = await dependencies.capture(unique);
  const recovery: AgentOutputRecovery = { version: 1, key, items: unique.map((_, outputIndex) => ({ outputIndex, state: 'pending' })) };
  const result = { ...template, phase: 'saving', agentOutputObservation: { rawReturned: images.length, uniqueOutputs: unique.length, savedOutputs: 0 }, agentOutputRecovery: recovery, savedOutputs: [] };
  await dependencies.persist(result);
  return result;
}
