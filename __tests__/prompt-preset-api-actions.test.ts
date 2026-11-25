import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  createCustomPrompt: vi.fn(),
  updatePromptForUser: vi.fn(),
  deletePromptForUser: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/prompt-presets/migration", () => ({
  ensureLegacyUserPromptsMigrated: vi.fn(),
  ensureLegacyBuiltinPromptsMigrated: vi.fn(),
}));
vi.mock("@/lib/prompt-presets/builtin-seeds", () => ({
  ensureCanvasPromptSeeds: vi.fn(),
}));
vi.mock("@/lib/prompt-presets/repository", () => ({
  PromptPresetRepositoryError: class PromptPresetRepositoryError extends Error {
    constructor(
      public readonly code: "invalid" | "not-found" | "conflict",
      message: string,
    ) {
      super(message);
    }
  },
  listEffectivePromptPresets: vi.fn(),
  createCustomPrompt: mocks.createCustomPrompt,
  updatePromptForUser: mocks.updatePromptForUser,
  deletePromptForUser: mocks.deletePromptForUser,
}));

import {
  POST as postPromptPreset,
} from "@/app/api/prompt-presets/route";
import {
  DELETE as deletePromptPreset,
  PATCH as patchPromptPreset,
} from "@/app/api/prompt-presets/[presetId]/route";
import { PromptPresetRepositoryError } from "@/lib/prompt-presets/repository";

const customDto = {
  id: "custom:44",
  name: "标题",
  category: "分类",
  content: "正文",
  source: "custom" as const,
  revision: 1,
  createdAt: "2026-07-30T00:00:00.000Z",
  updatedAt: "2026-07-30T00:00:00.000Z",
};

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function responseJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("prompt preset API actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUserId.mockResolvedValue(17);
  });

  it("creates a normalized custom preset with 201", async () => {
    mocks.createCustomPrompt.mockResolvedValue(customDto);

    const response = await postPromptPreset(
      jsonRequest("http://test/api/prompt-presets", "POST", {
        name: "  标题  ",
        category: "  分类  ",
        content: "  正文  ",
      }),
    );

    expect(response.status).toBe(201);
    expect(await responseJson(response)).toEqual(customDto);
    expect(mocks.createCustomPrompt).toHaveBeenCalledWith({
      authUserId: 17,
      value: { name: "标题", category: "分类", content: "正文" },
    });
  });

  it("rejects POST without a category", async () => {
    const response = await postPromptPreset(
      jsonRequest("http://test/api/prompt-presets", "POST", {
        name: "标题",
        content: "正文",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createCustomPrompt).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without leaking an internal error", async () => {
    const response = await postPromptPreset(
      new Request("http://test/api/prompt-presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(await responseJson(response)).toEqual({
      error: expect.any(String),
    });
  });

  it("edits a builtin as a new custom preset", async () => {
    mocks.updatePromptForUser.mockResolvedValue(customDto);

    const response = await patchPromptPreset(
      jsonRequest("http://test/api/prompt-presets/builtin:3", "PATCH", {
        expectedRevision: 2,
        value: {
          name: "标题",
          category: "分类",
          content: "正文",
        },
      }),
      { params: { presetId: "builtin:3" } },
    );

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual(customDto);
    expect(mocks.updatePromptForUser).toHaveBeenCalledWith({
      authUserId: 17,
      publicId: "builtin:3",
      expectedRevision: 2,
      value: {
        name: "标题",
        category: "分类",
        content: "正文",
      },
    });
  });

  it("rejects forbidden identity fields nested in PATCH value", async () => {
    const response = await patchPromptPreset(
      jsonRequest("http://test/api/prompt-presets/custom:4", "PATCH", {
        expectedRevision: 1,
        value: {
          name: "标题",
          category: "分类",
          content: "正文",
          userId: 999,
        },
      }),
      { params: { presetId: "custom:4" } },
    );

    expect(response.status).toBe(400);
    expect(mocks.updatePromptForUser).not.toHaveBeenCalled();
  });

  it("maps stale revisions to 409", async () => {
    mocks.updatePromptForUser.mockRejectedValue(
      new PromptPresetRepositoryError("conflict", "数据库中的内部冲突细节"),
    );

    const response = await patchPromptPreset(
      jsonRequest("http://test/api/prompt-presets/custom:4", "PATCH", {
        expectedRevision: 1,
        value: {
          name: "标题",
          category: "分类",
          content: "正文",
        },
      }),
      { params: { presetId: "custom:4" } },
    );

    expect(response.status).toBe(409);
  });

  it("rejects an invalid public preset ID with 400", async () => {
    const response = await patchPromptPreset(
      jsonRequest("http://test/api/prompt-presets/4", "PATCH", {
        expectedRevision: 1,
        value: {
          name: "标题",
          category: "分类",
          content: "正文",
        },
      }),
      { params: { presetId: "4" } },
    );

    expect(response.status).toBe(400);
    expect(mocks.updatePromptForUser).not.toHaveBeenCalled();
  });

  it("deletes a builtin only for the authenticated user", async () => {
    mocks.deletePromptForUser.mockResolvedValue(undefined);

    const response = await deletePromptPreset(
      jsonRequest("http://test/api/prompt-presets/builtin:8", "DELETE", {
        expectedRevision: 3,
      }),
      { params: { presetId: "builtin:8" } },
    );

    expect(response.status).toBe(200);
    expect(await responseJson(response)).toEqual({ ok: true });
    expect(mocks.deletePromptForUser).toHaveBeenCalledWith({
      authUserId: 17,
      publicId: "builtin:8",
      expectedRevision: 3,
    });
  });

  it("allows deleting a builtin without a request body", async () => {
    mocks.deletePromptForUser.mockResolvedValue(undefined);

    const response = await deletePromptPreset(
      new Request("http://test/api/prompt-presets/builtin:8", {
        method: "DELETE",
      }),
      { params: { presetId: "builtin:8" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.deletePromptForUser).toHaveBeenCalledWith({
      authUserId: 17,
      publicId: "builtin:8",
      expectedRevision: undefined,
    });
  });

  it("requires expectedRevision when deleting a custom preset", async () => {
    const response = await deletePromptPreset(
      jsonRequest("http://test/api/prompt-presets/custom:8", "DELETE", {}),
      { params: { presetId: "custom:8" } },
    );

    expect(response.status).toBe(400);
    expect(mocks.deletePromptForUser).not.toHaveBeenCalled();
  });

  it("maps not-found to 404 and unknown failures to a generic 500", async () => {
    mocks.deletePromptForUser
      .mockRejectedValueOnce(
        new PromptPresetRepositoryError("not-found", "内部记录不存在细节"),
      )
      .mockRejectedValueOnce(new Error("secret database connection string"));

    const request = () =>
      jsonRequest("http://test/api/prompt-presets/builtin:8", "DELETE", {});
    const context = { params: { presetId: "builtin:8" } };
    const notFound = await deletePromptPreset(request(), context);
    const unknown = await deletePromptPreset(request(), context);

    expect(notFound.status).toBe(404);
    expect(unknown.status).toBe(500);
    expect(JSON.stringify(await responseJson(unknown))).not.toContain("secret");
  });
});
