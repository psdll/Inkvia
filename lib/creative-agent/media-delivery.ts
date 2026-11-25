import "server-only";

import type { Run } from "./store-types";

type DeliveryDependencies = {
  pending(): Promise<{ run: Run; generationId: number }[]>;
  read(run: Run, generationId: number): Promise<Record<string, unknown>>;
  publish(run: Run, result: Record<string, unknown>): Promise<unknown>;
};

/** Only reconciles existing receipts. This path has no model or generation submission capability. */
export async function reconcileCreativeAgentMedia(dependencies?: DeliveryDependencies): Promise<number> {
  const deps = dependencies ?? await defaultDependencies();
  let delivered = 0;
  for (const job of await deps.pending()) {
    try {
      await deps.publish(job.run, await deps.read(job.run, job.generationId));
      delivered++;
    } catch (error) {
      // A transient read or a canvas revision race must not hide other completed work.
      console.warn("creative media delivery deferred", { generationId: job.generationId, type: error instanceof Error ? error.name : "unknown" });
    }
  }
  return delivered;
}

let deliveryCursor: { runId: string; generationId: number } | undefined;
async function defaultDependencies(): Promise<DeliveryDependencies> {
  const [{ creativeAgentStore }, { readCreativeAgentMediaDelivery }] = await Promise.all([import("./store"), import("./media-broker")]);
  return {
    pending: async () => {
      let jobs = await creativeAgentStore.pendingMediaDeliveries(deliveryCursor);
      if (!jobs.length && deliveryCursor) { deliveryCursor = undefined; jobs = await creativeAgentStore.pendingMediaDeliveries(); }
      const last = jobs.at(-1);
      deliveryCursor = last ? { runId: last.run.id, generationId: last.generationId } : undefined;
      return jobs;
    },
    read: readCreativeAgentMediaDelivery,
    publish: (run, result) => creativeAgentStore.publishMedia(run, result),
  };
}
