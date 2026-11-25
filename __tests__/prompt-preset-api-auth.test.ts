import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  ensureLegacyUserPromptsMigrated: vi.fn(),
  ensureLegacyBuiltinPromptsMigrated: vi.fn(),
  ensureCanvasPromptSeeds: vi.fn(),
  listEffectivePromptPresets: vi.fn(),
  createCustomPrompt: vi.fn(),
  updatePromptForUser: vi.fn(),
  deletePromptForUser: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/prompt-presets/migration", () => ({
  ensureLegacyUserPromptsMigrated: mocks.ensureLegacyUserPromptsMigrated,
  ensureLegacyBuiltinPromptsMigrated: mocks.ensureLegacyBuiltinPromptsMigrated,
}));
vi.mock("@/lib/prompt-presets/builtin-seeds", () => ({
  ensureCanvasPromptSeeds: mocks.ensureCanvasPromptSeeds,
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
  listEffectivePromptPresets: mocks.listEffectivePromptPresets,
  createCustomPrompt: mocks.createCustomPrompt,
  updatePromptForUser: mocks.updatePromptForUser,
  deletePromptForUser: mocks.deletePromptForUser,
}));

import {
  GET as getPromptPresets,
  POST as postPromptPreset,
} from "@/app/api/prompt-presets/route";
import {
  DELETE as deletePromptPreset,
  PATCH as patchPromptPreset,
} from "@/app/api/prompt-presets/[presetId]/route";
import {
  GET as getLegacyPresets,
  PUT as putLegacyPresets,
} from "@/app/api/presets/route";

function jsonRequest(url: string, method: string, body: unknown) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function expectError(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(
    expect.objectContaining({ error: expect.any(String) }),
  );
}

describe("authenticated prompt preset API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(null);
    mocks.ensureLegacyUserPromptsMigrated.mockResolvedValue({
      imported: 0,
      skipped: true,
    });
    mocks.ensureLegacyBuiltinPromptsMigrated.mockResolvedValue({
      imported: 0,
      skipped: true,
    });
    mocks.ensureCanvasPromptSeeds.mockResolvedValue({
      imported: 0,
      skipped: true,
    });
    mocks.listEffectivePromptPresets.mockResolvedValue([]);
  });

  it.each([
    ["GET", () => getPromptPresets(new Request("http://test/api/prompt-presets"))],
    [
      "POST",
      () =>
        postPromptPreset(
          jsonRequest("http://test/api/prompt-presets", "POST", {
            name: "标题",
            category: "分类",
            content: "正文",
          }),
        ),
    ],
    [
      "PATCH",
      () =>
        patchPromptPreset(
          jsonRequest("http://test/api/prompt-presets/custom:1", "PATCH", {
            expectedRevision: 1,
            value: { name: "标题", category: "分类", content: "正文" },
          }),
          { params: { presetId: "custom:1" } },
        ),
    ],
    [
      "DELETE",
      () =>
        deletePromptPreset(
          jsonRequest("http://test/api/prompt-presets/custom:1", "DELETE", {
            expectedRevision: 1,
          }),
          { params: { presetId: "custom:1" } },
        ),
    ],
  ])("returns 401 for unauthenticated %s", async (_method, invoke) => {
    await expectError(await invoke(), 401);
    expect(mocks.listEffectivePromptPresets).not.toHaveBeenCalled();
    expect(mocks.createCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.updatePromptForUser).not.toHaveBeenCalled();
    expect(mocks.deletePromptForUser).not.toHaveBeenCalled();
  });

  it.each(["userId", "authUserId", "scope"])(
    "rejects the forbidden %s query parameter",
    async (field) => {
      mocks.getUserId.mockResolvedValue(17);
      const response = await getPromptPresets(
        new Request(`http://test/api/prompt-presets?${field}=999`),
      );

      await expectError(response, 400);
      expect(mocks.listEffectivePromptPresets).not.toHaveBeenCalled();
    },
  );

  it.each(["userId", "authUserId", "scope"])(
    "rejects the forbidden %s body field",
    async (field) => {
      mocks.getUserId.mockResolvedValue(17);
      const response = await postPromptPreset(
        jsonRequest("http://test/api/prompt-presets", "POST", {
          name: "标题",
          category: "分类",
          content: "正文",
          [field]: 999,
        }),
      );

      await expectError(response, 400);
      expect(mocks.createCustomPrompt).not.toHaveBeenCalled();
    },
  );

  it("runs migrations safely before listing the current user's presets", async () => {
    mocks.getUserId.mockResolvedValue(17);
    const presets = [{ id: "builtin:1", source: "builtin" }];
    mocks.listEffectivePromptPresets.mockResolvedValue(presets);

    const response = await getPromptPresets(
      new Request("http://test/api/prompt-presets"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ presets });
    expect(mocks.ensureLegacyUserPromptsMigrated).toHaveBeenCalledWith({
      authUserId: 17,
      presetUserIds: ["17"],
    });
    expect(mocks.ensureLegacyBuiltinPromptsMigrated).toHaveBeenCalledOnce();
    expect(mocks.ensureCanvasPromptSeeds).toHaveBeenCalledOnce();
    expect(mocks.listEffectivePromptPresets).toHaveBeenCalledWith({
      authUserId: 17,
    });
    expect(
      mocks.ensureLegacyUserPromptsMigrated.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.ensureLegacyBuiltinPromptsMigrated.mock.invocationCallOrder[0],
    );
    expect(
      mocks.ensureLegacyBuiltinPromptsMigrated.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.ensureCanvasPromptSeeds.mock.invocationCallOrder[0],
    );
    expect(
      mocks.ensureCanvasPromptSeeds.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.listEffectivePromptPresets.mock.invocationCallOrder[0],
    );
  });

  it("keeps listing stored presets when a best-effort migration step fails", async () => {
    mocks.getUserId.mockResolvedValue(17);
    const presets = [{ id: "custom:1", source: "custom" }];
    mocks.listEffectivePromptPresets.mockResolvedValue(presets);
    mocks.ensureLegacyUserPromptsMigrated.mockRejectedValueOnce(
      new Error("legacy files unavailable"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getPromptPresets(
      new Request("http://test/api/prompt-presets"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ presets });
    expect(mocks.ensureLegacyBuiltinPromptsMigrated).toHaveBeenCalledOnce();
    expect(mocks.ensureCanvasPromptSeeds).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[prompt-presets] read preparation failed at legacy-user-migration",
      expect.any(Error),
    );
    error.mockRestore();
  });

  it("legacy GET strips old identity and scope parameters before authenticated proxying", async () => {
    mocks.getUserId.mockResolvedValue(17);

    const response = await getLegacyPresets(
      new Request(
        "http://test/api/presets?userId=999&scope=video&includeDeleted=1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-replacement-endpoint")).toBe(
      "/api/prompt-presets",
    );
    expect(mocks.listEffectivePromptPresets).toHaveBeenCalledWith({
      authUserId: 17,
    });
  });

  it("legacy PUT is gone and never invokes a write", async () => {
    mocks.getUserId.mockResolvedValue(17);
    const response = await putLegacyPresets(
      jsonRequest(
        "http://test/api/presets?userId=17&scope=image",
        "PUT",
        { presets: [] },
      ),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual(
      expect.objectContaining({
        error: expect.any(String),
        endpoint: "/api/prompt-presets",
      }),
    );
    expect(mocks.createCustomPrompt).not.toHaveBeenCalled();
    expect(mocks.updatePromptForUser).not.toHaveBeenCalled();
    expect(mocks.deletePromptForUser).not.toHaveBeenCalled();
  });
});
