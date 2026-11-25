import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
import { CreativeAgentStore } from "@/lib/creative-agent/store";
import { hash, HttpError, type Run } from "@/lib/creative-agent/store-types";

const at = new Date("2026-10-16T00:00:00Z");
const run = { id: "r", actorUserId: 1, canvasId: 2, createdAt: at.toISOString() } as Run;
const result = { generationId: 12, status: "success", mediaType: "image", outputs: [{ url: "/uploads/retried.png", nodeId: "same-task" }], nodeIds: ["same-task"], revision: "4" };
function setup(previous?: Record<string, unknown>) {
 const retry = { retryOfGenerationId: 10, retryAttempt: 1, retryReason: "处理超时", mediaDispatch: { requestKeys: ["private-key"] } };
 const query = vi.fn(async (sql: string) => {
  if (sql.startsWith('SELECT * FROM "CreativeAgentRun"')) return [{ id: "r", actor_user_id: 1, canvas_id: 2, created_at: at, updated_at: at, status: "stopped" }];
  if (sql.startsWith("SELECT a.result")) return [{ result: retry }];
  if (sql.startsWith("SELECT payload")) return previous ? [{ payload: previous }] : [];
  if (sql.startsWith("SELECT g.id")) return [{ id: 12 }];
  return [];
 });
 const execute = vi.fn(async (..._args: unknown[]) => 1);
 const tx = { $queryRawUnsafe: query, $executeRawUnsafe: execute };
 const store = new CreativeAgentStore({ ...tx, $transaction: async (fn: any) => fn(tx) } as any);
 return { store, execute };
}
describe("persisted retry media delivery", () => {
 it("restores retry lineage from its scoped action during read-only late delivery", async () => {
  const { store, execute } = setup(); await store.publishMedia(run, result);
  const event = execute.mock.calls.find(call => call[2] === "media.updated")!;
  expect(JSON.parse(String(event[3]))).toMatchObject({ generationId: 12, retryOfGenerationId: 10, retryAttempt: 1, retryReason: "处理超时" });
  expect(String(event[3])).not.toContain("private-key");
 });
 it("can enrich a settled receipt without regressing it to running", async () => {
  const { store, execute } = setup({ generationId: 12, status: "success", outputs: [] });
  await store.publishMedia(run, result);
  expect(execute.mock.calls.some(call => call[2] === "media.updated")).toBe(true);
  execute.mockClear(); await store.publishMedia(run, { ...result, status: "running", outputs: [] });
  expect(execute).not.toHaveBeenCalled();
 });
});


it("R27 media call lookup scopes the event frontier and validates receipt ownership", async () => {
  const raw = { prompt: "original" };
  const current = { ...run, input: { revision: 3 } } as Run;
  const payload = { actionId: "action-a", recovery: { revision: 3, rawArgsHash: hash(raw) } };
  const query = vi.fn(async () => [{ payload }]);
  const store = new CreativeAgentStore({ $queryRawUnsafe: query } as any);
  const action: any = { id: "action-a", runId: "r", actorUserId: 1, canvasId: 2, kind: "image.generate", state: "unknown" };
  Object.assign(store, { getAction: vi.fn(async () => action) });
  expect(await store.getMediaToolCallAction(current, "image.generate", "original-call", raw)).toEqual({ action, exact: true });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("type='message.revised'"), "r", "image.generate", "original-call");
  for (const [field, value] of [["actorUserId", 99], ["canvasId", 99], ["runId", "another-run"], ["kind", "video.generate"]] as const) {
    const previous = action[field]; action[field] = value;
    await expect(store.getMediaToolCallAction(current, "image.generate", "original-call", raw)).rejects.toMatchObject({ code: "media_recovery_unverified" });
    action[field] = previous;
  }
  await expect(store.getMediaToolCallAction({ ...current, input: { ...current.input, revision: 4 } }, "image.generate", "original-call", raw)).rejects.toMatchObject({ code: "media_recovery_unverified" });
});

it("R27 exact start with no claimed action keeps pending approval work resumable", async () => {
  const raw = { prompt: "pending approval" };
  const current = { ...run, input: {} } as Run;
  const query = vi.fn(async () => [{ payload: { actionId: "pending", recovery: { revision: 0, rawArgsHash: hash(raw) } } }]);
  const store = new CreativeAgentStore({ $queryRawUnsafe: query } as any);
  Object.assign(store, { getAction: vi.fn(async () => { throw new HttpError(404, "action_not_found", "not claimed"); }) });
  expect(await store.getMediaToolCallAction(current, "image.generate", "pending-call", raw)).toBeNull();
});
