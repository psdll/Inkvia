import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormData } from "undici";
import { anthropicMessagesAdapter } from "@/lib/llm-routing/adapters/anthropic-messages";
import type { ResolvedLlmRoute } from "@/lib/llm-routing/types";
import { llmVideoBlock, prepareLlmVideo } from "@/lib/media-delivery/llm";

const mocks = vi.hoisted(() => ({ context: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/providers/transport", () => ({ resolveProviderRequestContext: mocks.context, fetchWithProviderEgress: mocks.fetch }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

const MiB = 1024 * 1024;
const ark = { providerId: "volcengine", modelId: "doubao-seed-evolving" };
const minimax = { providerId: "minimax", modelId: "MiniMax-M3" };
let directory = "";
let file = "";

beforeEach(async () => {
  vi.resetAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "llm-video-"));
  file = path.join(directory, "file.mp4");
  await fs.writeFile(file, "video");
  mocks.context.mockImplementation(async (id: string) => ({ provider: {
    id, enabled: true, baseUrl: `https://${id}.test`, apiKey: "test-key",
  }, decision: { id } }));
});

afterEach(async () => { await fs.rm(directory, { force: true, recursive: true }); });

it("inlines small Ark video while retaining its sampling frequency", async () => {
  const source = await prepareLlmVideo(file, ark, { fps: 2 });
  expect(source).toEqual({ url: `data:video/mp4;base64,${Buffer.from("video").toString("base64")}`, fps: 2 });
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("waits for Ark file preprocessing and sends the active file ID", async () => {
  await fs.truncate(file, 11 * MiB);
  mocks.fetch.mockResolvedValueOnce(Response.json({ id: "file-test", status: "processing" }));
  mocks.fetch.mockResolvedValueOnce(Response.json({ id: "file-test", status: "active" }));

  const source = await prepareLlmVideo(file, ark, { fps: 0.5 });
  expect(llmVideoBlock(source!)).toEqual({ type: "video_url", video_url: { file_id: "file-test" } });
  const [decision, url, request] = mocks.fetch.mock.calls[0];
  expect(decision).toEqual({ id: "volcengine" });
  expect(url).toBe("https://volcengine.test/api/v3/files");
  expect(request.headers.Authorization).toBe("Bearer test-key");
  expect(request.body).toBeInstanceOf(FormData);
  expect(request.body.get("purpose")).toBe("user_data");
  expect(request.body.get("file")).toMatchObject({ type: "video/mp4", size: 11 * MiB });
  expect(request.body.get("preprocess_configs[video][model]")).toBe(ark.modelId);
  expect(request.body.get("preprocess_configs[video][fps]")).toBe("0.5");
  expect(mocks.fetch.mock.calls[1][1]).toBe("https://volcengine.test/api/v3/files/file-test");
});

it("falls back to the public URL path for an oversized video after Ark upload fails", async () => {
  await fs.truncate(file, 51 * MiB);
  mocks.fetch.mockResolvedValue(Response.json({ error: "test" }, { status: 503 }));
  await expect(prepareLlmVideo(file, ark)).resolves.toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});

it("passes MiniMax's exact video-understanding file ID to the Anthropic adapter", async () => {
  mocks.fetch.mockResolvedValue(new Response('{"file":{"file_id":9223372036854775807},"base_resp":{"status_code":0}}'));
  const source = await prepareLlmVideo(file, minimax);
  expect(mocks.fetch.mock.calls[0][1]).toBe("https://minimax.test/v1/files/upload");
  expect(mocks.fetch.mock.calls[0][2].body.get("purpose")).toBe("video_understanding");
  const request = anthropicMessagesAdapter.buildRequest({ ...minimax } as ResolvedLlmRoute,
    [{ role: "user", content: [llmVideoBlock(source!)] }], undefined, false);
  expect(JSON.parse(String(request.init.body)).messages[0].content[0]).toEqual({
    type: "video", source: { type: "url", url: "mm_file://9223372036854775807" },
  });
});
