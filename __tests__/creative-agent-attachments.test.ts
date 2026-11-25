import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveBufferFile } from "@/lib/storage";
import { withPersonalMaterial } from "@/lib/canvas/personal-library";
import { resolveCreativeAgentAttachments, importPersonalMaterialAttachment, readCreativeAgentAttachments, uploadCreativeAgentAttachment } from "@/lib/creative-agent/attachments";

const settings = vi.hoisted(() => ({ create: vi.fn(), findUnique: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ default: { appSetting: settings } }));
vi.mock("@/lib/storage", () => ({ saveBufferFile: vi.fn(), resolveUploadsRootDirectory: () => process.env.UPLOADS_DIR }));
vi.mock("@/lib/canvas/personal-library", () => ({ withPersonalMaterial: vi.fn() }));
vi.mock("@/lib/creative-agent/access", () => ({ requireCreativeAgentCanvas: vi.fn() }));
vi.mock("@/lib/creative-agent/store", () => ({ creativeAgentStore: { getSession: vi.fn() } }));

let root: string;
let source: string;
const records = new Map<string, string>();
beforeEach(async () => {
  vi.clearAllMocks();
  records.clear();
  root = await mkdtemp(path.join(os.tmpdir(), "creative-agent-attachments-"));
  source = path.join(root, "library.png");
  vi.stubEnv("UPLOADS_DIR", root);
  vi.mocked(saveBufferFile).mockImplementation(async bytes => {
    const relative = "creative-agent/2026-10-15/snapshot.png";
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), bytes);
    return `/uploads/${relative}`;
  });
  settings.create.mockImplementation(async ({ data }: { data: { key: string; value: string } }) => {
    records.set(data.key, data.value);
    return data;
  });
  settings.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    const value = records.get(where.key);
    return value ? { key: where.key, value } : null;
  });
  vi.mocked(withPersonalMaterial).mockImplementation(async (_user, _id, action) => action({
    id: "material", folderId: null, name: "产品.png", fileName: "library.png",
    kind: "image", mime: "image/png", size: 0, createdAt: "2026-10-15",
  }, source));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

const attach = async (origin: "upload" | "library", bytes: Buffer) => {
  if (origin === "library") {
    await writeFile(source, bytes);
    return importPersonalMaterialAttachment(7, 17, "session", "material");
  }
  return uploadCreativeAgentAttachment(7, 17, "session", new File([new Uint8Array(bytes)], "产品.png", { type: "image/png" }));
};

describe.each(["upload", "library"] as const)("%s image attachments", origin => {
  it("accepts a valid image above 4 MB, preserves its original bytes, and sends a bounded vision image", async () => {
    const bytes = await sharp(randomBytes(1500 * 1100 * 3), { raw: { width: 1500, height: 1100, channels: 3 } }).png().toBuffer();
    expect(bytes.length).toBeGreaterThan(4_000_000);
    const attachment = await attach(origin, bytes);
    expect(attachment).toMatchObject({ status: "ready", size: bytes.length, mimeType: "image/png" });
    expect((await readFile(path.join(root, "creative-agent/2026-10-15/snapshot.png"))).equals(bytes)).toBe(true);
    const parts = await readCreativeAgentAttachments({ actorUserId: 7, canvasId: 17, sessionId: "session", attachments: [{ id: attachment.id }] }, true);
    const image = parts.find(part => part.type === "image")!;
    expect(image.type).toBe("image");
    if (image.type !== "image") throw new Error("missing vision image");
    expect(Buffer.byteLength(image.data)).toBeLessThan(4_500_000);
    const metadata = await sharp(Buffer.from(image.data, "base64")).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 1024 });
    expect(metadata.height).toBeLessThanOrEqual(1024);
  });

  it("rejects images beyond the 30 MB media-reader limit before saving", async () => {
    await expect(attach(origin, Buffer.alloc(30_000_001))).rejects.toMatchObject({ code: "ATTACHMENT_TOO_LARGE", message: expect.stringContaining("30 MB") });
    expect(saveBufferFile).not.toHaveBeenCalled();
  });

  it("still rejects invalid image bytes", async () => {
    await expect(attach(origin, Buffer.from("not an image"))).rejects.toMatchObject({ code: "ATTACHMENT_IMAGE_INVALID" });
    expect(saveBufferFile).not.toHaveBeenCalled();
  });
});

it("identifies the unavailable file instead of silently omitting a sent reference", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const attachment = await attach("upload", bytes);
  await rm(path.join(root, "creative-agent/2026-10-15/snapshot.png"));
  await expect(readCreativeAgentAttachments({ actorUserId: 7, canvasId: 17, sessionId: "session", attachments: [{ id: attachment.id }] }, true)).rejects.toMatchObject({ code: "ATTACHMENT_INVALID", message: expect.stringContaining("产品.png") });
});

it("keeps missing legacy metadata identifiable without failing conversation history", async () => {
  const module = await import("@/lib/creative-agent/attachments") as any;
  expect(module.describeCreativeAgentAttachments).toBeTypeOf("function");
  expect(await module.describeCreativeAgentAttachments({ actorUserId: 7, canvasId: 17, sessionId: "session", attachments: [{ id: "legacy-missing" }] })).toEqual([expect.objectContaining({ id: "legacy-missing", error: expect.stringContaining("legacy-missing") })]);
});

it("Task5 reuses verified bytes and normalization only within one attachment preparation", async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const attachment = await attach("upload", bytes);
  const input = { actorUserId: 7, canvasId: 17, sessionId: "session", attachments: [{ id: attachment.id }] };
  const verified = await resolveCreativeAgentAttachments(input);
  settings.findUnique.mockClear();
  const first = await readCreativeAgentAttachments(input, true, verified);
  const second = await readCreativeAgentAttachments(input, true, verified);
  expect(first).toEqual(second);
  expect(settings.findUnique).not.toHaveBeenCalled();
  await expect(readCreativeAgentAttachments({ ...input, actorUserId: 8 }, true, verified)).rejects.toThrow();
  await writeFile(path.join(root, "creative-agent/2026-10-15/snapshot.png"), "changed");
  await expect(readCreativeAgentAttachments(input, true)).rejects.toMatchObject({ code: "ATTACHMENT_INVALID" });
});
