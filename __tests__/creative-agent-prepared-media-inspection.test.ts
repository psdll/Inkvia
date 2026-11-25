import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), fence: vi.fn(), session: vi.fn(), sent: vi.fn(), probe: vi.fn(), vision: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: { findMany: mocks.findMany, findUnique: mocks.findUnique } } }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { assertFence: mocks.fence, getSession: mocks.session, hasSentAttachment: mocks.sent } }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: vi.fn() }));
vi.mock("@/lib/creative-agent/canvas-tools", () => ({ readCreativeAgentCanvas: mocks.read, creativeAgentNodeHash: () => "b".repeat(64), creativeAgentStableId: vi.fn(), resolveCreativeAgentSelection: vi.fn() }));
vi.mock("@/lib/creative-agent/model-catalog", () => ({ resolveCreativeAgentModel: async () => ({ status: "ready", route: { providerId: "test", modelId: "test" } }), creativeAgentSupportsVision: () => true }));
vi.mock("@/lib/creative-agent/media-files", async importOriginal => ({ ...await importOriginal<any>(), probeRuntimeMedia: mocks.probe, runtimeVisionParts: mocks.vision }));
import { inspectCreativeMedia } from "@/lib/creative-agent/media-inspection";
let root: string;
const url = "/uploads/creative-agent/2026-10-16/source.png";
const original = "/uploads/creative-agent/2026-10-16/original.png";
const bytes = Buffer.from("verified original attachment bytes");
const digest = createHash("sha256").update(bytes).digest("hex");
const node = { id: "source", type: "image", position: { x: 0, y: 0 }, data: { kind: "image", url } };
const mappingKey = "creative-agent:reference:v1:7:17:source-session:attachment";
const recordKey = "creative_agent_attachment:7:17:source-session:attachment";
const record = { id: "attachment", actorUserId: 7, canvasId: 17, sessionId: "source-session", name: "product.png", mimeType: "image/png", size: bytes.length, sha256: digest, url };
const mapping = { sha256: digest, reference: { canvasId: 17, nodeId: "source", kind: "image", semanticHash: "b".repeat(64) } };
const input = { actorUserId: 7, canvasId: 17, runId: "run", epoch: 1, actionId: "inspect", kind: "media.inspect", args: { nodeId: "source", semanticHash: "b".repeat(64) } };
beforeEach(async () => {
  vi.resetAllMocks(); root = await mkdtemp(path.join(os.tmpdir(), "prepared-media-inspection-")); vi.stubEnv("UPLOADS_DIR", root);
  await mkdir(path.join(root, "creative-agent/2026-10-16"), { recursive: true });
  await writeFile(path.join(root, url.slice("/uploads/".length)), bytes);
  await writeFile(path.join(root, original.slice("/uploads/".length)), bytes);
  mocks.read.mockResolvedValue({ revision: "1", nodes: [node], edgeIds: [] });
  mocks.findMany.mockResolvedValue([{ key: mappingKey, value: JSON.stringify(mapping) }]);
  mocks.findUnique.mockImplementation(async ({ where }) => where.key === recordKey ? { value: JSON.stringify(record) } : null);
  mocks.fence.mockResolvedValue({ id: "run", actorUserId: 7, canvasId: 17, sessionId: "source-session", input: {} });
  mocks.sent.mockResolvedValue(true); mocks.session.mockResolvedValue({ id: "source-session" });
  mocks.probe.mockResolvedValue({ state: "verified", kind: "image", contentVersion: digest });
  mocks.vision.mockResolvedValue([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,cGl4ZWxz" } }]);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
describe("authorized observation of prepared original media", () => {
  it.each(["source-session", "new-session"])("observes the explicit mapped node from %s", async sessionId => {
    mocks.fence.mockResolvedValue({ id: "run", actorUserId: 7, canvasId: 17, sessionId, input: {} });
    expect(await inspectCreativeMedia(input)).toMatchObject({ observed: true, nodeId: "source" });
    expect(mocks.sent).toHaveBeenCalledWith(7, 17, "source-session", "attachment");
    expect(mocks.probe).toHaveBeenCalledWith(url, "image");
  });
  it("does not trust arbitrary node URLs without a durable mapping", async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await inspectCreativeMedia(input)).toMatchObject({ observed: false });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it.each(["wrong-owner", "wrong-canvas", "wrong-version", "unsent", "source-session-not-owned"])("rejects %s evidence", async reason => {
    if (reason === "wrong-owner") mocks.findMany.mockResolvedValue([{ key: mappingKey.replace(":7:", ":8:"), value: JSON.stringify(mapping) }]);
    if (reason === "wrong-canvas") mocks.findMany.mockResolvedValue([{ key: mappingKey, value: JSON.stringify({ ...mapping, reference: { ...mapping.reference, canvasId: 18 } }) }]);
    if (reason === "wrong-version") mocks.findMany.mockResolvedValue([{ key: mappingKey, value: JSON.stringify({ ...mapping, reference: { ...mapping.reference, semanticHash: "c".repeat(64) } }) }]);
    if (reason === "unsent") mocks.sent.mockResolvedValue(false);
    if (reason === "source-session-not-owned") mocks.session.mockRejectedValue(new Error("session scope invalid"));
    const result = await inspectCreativeMedia(input).catch(() => ({ observed: false }));
    expect(result).toMatchObject({ observed: false }); expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("refuses a corrupted mapping without treating the node URL as authority", async () => {
    mocks.findMany.mockResolvedValue([{ key: mappingKey, value: "null" }]);
    expect(await inspectCreativeMedia(input)).toMatchObject({ observed: false });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("rejects changed attachment original bytes with the file identified", async () => {
    await writeFile(path.join(root, url.slice("/uploads/".length)), Buffer.from("changed"));
    await expect(inspectCreativeMedia(input)).rejects.toMatchObject({ code: "ATTACHMENT_INVALID", message: expect.stringContaining("product.png") });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
  it("tries another proven mapping when an older snapshot is unavailable", async () => {
    mocks.read.mockResolvedValue({ revision: "1", nodes: [{ ...node, data: { ...node.data, url: original } }], edgeIds: [] });
    mocks.findMany.mockResolvedValue([{ key: mappingKey, value: JSON.stringify(mapping) }, { key: mappingKey.replace(":attachment", ":newer"), value: JSON.stringify(mapping) }]);
    mocks.findUnique.mockImplementation(async ({ where }) => where.key === recordKey
      ? { value: JSON.stringify({ ...record, url: "/uploads/creative-agent/2026-10-16/deleted.png" }) }
      : { value: JSON.stringify({ ...record, id: "newer" }) });
    expect(await inspectCreativeMedia(input)).toMatchObject({ observed: true });
    expect(mocks.probe).toHaveBeenCalledWith(url, "image");
  });
  it("allows reused original node URL only when its bytes match the attachment snapshot", async () => {
    mocks.read.mockResolvedValue({ revision: "1", nodes: [{ ...node, data: { ...node.data, url: original } }], edgeIds: [] });
    expect(await inspectCreativeMedia(input)).toMatchObject({ observed: true });
    await writeFile(path.join(root, original.slice("/uploads/".length)), Buffer.from("changed node bytes"));
    mocks.probe.mockClear();
    expect(await inspectCreativeMedia(input)).toMatchObject({ observed: false });
    expect(mocks.probe).not.toHaveBeenCalled();
  });
});
