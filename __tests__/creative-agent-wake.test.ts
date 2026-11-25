import { describe, expect, it, vi } from "vitest";
import { registerCreativeAgentWake, wakeCreativeAgentWorker } from "@/lib/creative-agent/worker-wake";
it("coalesces same-process enqueue wakes and never overlaps the tick", async () => {
  let release!: () => void;
  const first = new Promise<void>(r => { release = r; });
  const tick = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
  const stop = registerCreativeAgentWake(tick);
  for (let i = 0; i < 10; i++) wakeCreativeAgentWorker();
  await Promise.resolve(); expect(tick).toHaveBeenCalledTimes(1);
  wakeCreativeAgentWorker(); wakeCreativeAgentWorker();
  await Promise.resolve(); expect(tick).toHaveBeenCalledTimes(1);
  release(); await new Promise<void>(r => setImmediate(r));
  expect(tick).toHaveBeenCalledTimes(2); stop();
  wakeCreativeAgentWorker(); await Promise.resolve(); expect(tick).toHaveBeenCalledTimes(2);
});
