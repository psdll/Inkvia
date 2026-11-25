import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { createEmptyCanvasDocumentV2 } from "@/lib/canvas/document";
import { parseCanvasJson, appendCanvasDocument } from "@/lib/canvas/transfer";

const state = vi.hoisted(() => ({ root: "", userId: 42 as number | null }));
vi.mock("@/lib/server-auth", () => ({ getUserId: async () => state.userId }));
vi.mock("@/lib/public-path", () => ({ resolvePublicPath: (...parts: string[]) => path.join(state.root, ...parts), resolvePublicDir: () => state.root }));
import { POST } from "@/app/api/canvas/library/workflows/route";
import { GET } from "@/app/api/canvas/library/route";

beforeEach(async () => { state.root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-workflow-test-")); state.userId = 42; });
afterEach(async () => {
  if (path.dirname(state.root) !== os.tmpdir() || !path.basename(state.root).startsWith("canvas-workflow-test-")) throw new Error("unexpected test directory");
  await fs.rm(state.root, { recursive: true, force: true });
});
describe("workflow library storage", () => {
  it("stores actual JSON, lists it only for its owner, and can restore it as a workflow", async () => {
    const document = createEmptyCanvasDocumentV2();
    document.nodes = [{ id: "prompt", type: "prompt", position: { x: 1, y: 2 }, data: { kind: "prompt", text: "复用流程" } }];
    const response = await POST(new NextRequest("http://localhost/api/canvas/library/workflows", { method: "POST", body: JSON.stringify({ title: "我的流程", document }) }));
    expect(response.status).toBe(200);
    const { item } = await response.json();
    expect(item).toMatchObject({ name: "我的流程.canvas.json", kind: "file", folder: "workflows" });
    const listed = await (await GET(new NextRequest("http://localhost/api/canvas/library"))).json();
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(item.id);
    const restored = parseCanvasJson(await fs.readFile(path.join(state.root, item.url), "utf8"));
    expect(appendCanvasDocument(createEmptyCanvasDocumentV2(), restored).nodes[0].data).toEqual(document.nodes[0].data);
    state.userId = 43;
    expect((await (await GET(new NextRequest("http://localhost/api/canvas/library"))).json()).items).toEqual([]);
  });
  it("rejects unauthenticated and invalid workflow saves", async () => {
    state.userId = null;
    expect((await POST(new NextRequest("http://localhost/api/canvas/library/workflows", { method: "POST", body: "{}" }))).status).toBe(401);
    state.userId = 42;
    expect((await POST(new NextRequest("http://localhost/api/canvas/library/workflows", { method: "POST", body: "{}" }))).status).toBe(400);
    expect(await fs.readdir(state.root)).toEqual([]);
  });
});
