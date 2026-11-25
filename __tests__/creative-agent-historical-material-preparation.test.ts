import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: {} }));
const input = { actorUserId: 7, canvasId: 17, runId: "run", epoch: 1 };
const run = { id: "run", actorUserId: 7, canvasId: 17, sessionId: "session", input: { text: "follow up", attachments: [], selection: { nodeIds: ["current"], edgeIds: [], references: [] } } };
async function setup() {
  const module = await import("@/lib/creative-agent/reference-preparation") as any;
  expect(module.prepareHistoricalCreativeAgentReferences).toBeTypeOf("function");
  return { prepare: module.prepareHistoricalCreativeAgentReferences, deps: { store: { assertFence: vi.fn(async () => run), getHistoricalAttachmentIds: vi.fn(async () => ["old-a", "old-b"]) }, prepare: vi.fn(async () => ({ selection: { references: ["mapped"] }, revision: "2" })) } };
}
describe("on-demand legacy attachment preparation", () => {
  it("prepares only explicitly requested previously sent attachments", async () => {
    const { prepare, deps } = await setup();
    expect(await prepare(input, ["old-b"], deps)).toMatchObject({ revision: "2" });
    expect(deps.store.assertFence).toHaveBeenCalledWith("run", 1);
    expect(deps.prepare).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session", input: expect.objectContaining({ attachments: [{ id: "old-b" }], selection: { nodeIds: [], edgeIds: [], references: [] } }) }), undefined, undefined);
  });
  it("rejects drafts and attachment IDs outside sent session history", async () => {
    const { prepare, deps } = await setup();
    await expect(prepare(input, ["draft-other"], deps)).rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
    expect(deps.prepare).not.toHaveBeenCalled();
  });
  it("rejects cross-canvas tool context", async () => {
    const { prepare, deps } = await setup();
    await expect(prepare({ ...input, canvasId: 99 }, ["old-a"], deps)).rejects.toMatchObject({ code: "RUN_SCOPE_INVALID" });
    expect(deps.prepare).not.toHaveBeenCalled();
  });
});
