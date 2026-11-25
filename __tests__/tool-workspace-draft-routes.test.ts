import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserId: vi.fn(),
  getToolWorkspaceDraft: vi.fn(),
  saveToolWorkspaceDraft: vi.fn(),
  uploadAndAttachToolWorkspaceMedia: vi.fn(),
  getToolWorkspaceMediaUploadStatus: vi.fn(),
  detachToolWorkspaceMedia: vi.fn(),
  assertRequestContentLengthUnderLimit: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({ getUserId: mocks.getUserId }));
vi.mock("@/lib/tool-workspace-draft/service", () => ({
  getToolWorkspaceDraft: mocks.getToolWorkspaceDraft,
  saveToolWorkspaceDraft: mocks.saveToolWorkspaceDraft,
  uploadAndAttachToolWorkspaceMedia: mocks.uploadAndAttachToolWorkspaceMedia,
  getToolWorkspaceMediaUploadStatus: mocks.getToolWorkspaceMediaUploadStatus,
  detachToolWorkspaceMedia: mocks.detachToolWorkspaceMedia,
}));
vi.mock("@/lib/upload-limits", () => ({
  assertRequestContentLengthUnderLimit: mocks.assertRequestContentLengthUnderLimit,
}));

import { GET, PATCH } from "@/app/api/tool-workspace-drafts/[tool]/route";
import { GET as GET_MEDIA, POST } from "@/app/api/tool-workspace-drafts/[tool]/media/route";
import { DELETE } from "@/app/api/tool-workspace-drafts/[tool]/media/[relationId]/route";

const context = { params: { tool: "image" } };

function pngFile() {
  return new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
    "reference.png",
    { type: "image/png" },
  );
}

describe("tool workspace draft routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserId.mockResolvedValue(7);
    mocks.getToolWorkspaceDraft.mockResolvedValue(null);
    mocks.saveToolWorkspaceDraft.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      tool: "image",
      payload: { schemaVersion: 1, tool: "image", state: { prompt: "保留" } },
      version: 1,
      updatedAt: "2026-08-10T08:00:00.000Z",
      media: [],
    });
    mocks.uploadAndAttachToolWorkspaceMedia.mockResolvedValue({
      relation: { relationId: "10", mediaId: "22222222-2222-4222-8222-222222222222" },
      version: 2,
    });
    mocks.getToolWorkspaceMediaUploadStatus.mockResolvedValue({ uploadState: "pending" });
    mocks.detachToolWorkspaceMedia.mockResolvedValue({ detached: true, released: true, version: 3 });
  });

  it("derives ownership from the login session when reading and saving", async () => {
    const getResponse = await GET(
      new Request("http://localhost/api/tool-workspace-drafts/image"),
      context,
    );
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({ success: true, draft: null });
    expect(mocks.getToolWorkspaceDraft).toHaveBeenCalledWith({ authUserId: 7, tool: "image" });

    const payload = { schemaVersion: 1, tool: "image", state: { prompt: "保留" } };
    const patchResponse = await PATCH(
      new Request("http://localhost/api/tool-workspace-drafts/image", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-tool-workspace-account": "7",
        },
        body: JSON.stringify({ authUserId: 99, expectedVersion: 0, payload }),
      }),
      context,
    );
    expect(patchResponse.status).toBe(200);
    expect(mocks.saveToolWorkspaceDraft).toHaveBeenCalledWith({
      authUserId: 7,
      tool: "image",
      expectedVersion: 0,
      payload,
      media: undefined,
    });
  });

  it("uploads one file and accepts only the supported video slots", async () => {
    const form = new FormData();
    form.set("file", pngFile());
    form.set("slot", "first");
    form.set("requestKey", "22222222-2222-4222-8222-222222222222");

    const response = await POST(
      new Request("http://localhost/api/tool-workspace-drafts/video/media", {
        method: "POST",
        headers: { "x-tool-workspace-account": "7" },
        body: form,
      }),
      { params: { tool: "video" } },
    );

    expect(response.status).toBe(201);
    expect(mocks.assertRequestContentLengthUnderLimit).toHaveBeenCalledOnce();
    expect(mocks.uploadAndAttachToolWorkspaceMedia).toHaveBeenCalledWith(expect.objectContaining({
      authUserId: 7,
      tool: "video",
      slot: "first",
      requestKey: "22222222-2222-4222-8222-222222222222",
      file: expect.objectContaining({ name: "reference.png" }),
    }));
  });

  it("queries an authenticated upload request without exposing another account", async () => {
    mocks.getToolWorkspaceMediaUploadStatus.mockResolvedValue({
      uploadState: "ready",
      relation: { relationId: "10", mediaId: "22222222-2222-4222-8222-222222222222" },
      version: 2,
    });

    const response = await GET_MEDIA(
      new Request("http://localhost/api/tool-workspace-drafts/image/media?requestKey=22222222-2222-4222-8222-222222222222", {
        headers: { "x-tool-workspace-account": "7" },
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.getToolWorkspaceMediaUploadStatus).toHaveBeenCalledWith({
      authUserId: 7,
      tool: "image",
      requestKey: "22222222-2222-4222-8222-222222222222",
    });
    expect(await response.json()).toMatchObject({ success: true, uploadState: "ready" });
  });

  it("rejects malformed relation ids before detaching", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/tool-workspace-drafts/image/media/not-a-number", {
        method: "DELETE",
        headers: { "x-tool-workspace-account": "7" },
      }),
      { params: { tool: "image", relationId: "not-a-number" } },
    );

    expect(response.status).toBe(400);
    expect(mocks.detachToolWorkspaceMedia).not.toHaveBeenCalled();
  });

  it("detaches an owned relation using a bigint id", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/tool-workspace-drafts/image/media/10", {
        method: "DELETE",
        headers: { "x-tool-workspace-account": "7" },
      }),
      { params: { tool: "image", relationId: "10" } },
    );

    expect(response.status).toBe(200);
    expect(mocks.detachToolWorkspaceMedia).toHaveBeenCalledWith({
      authUserId: 7,
      tool: "image",
      relationId: BigInt(10),
    });
  });

  it("rejects stale mutations after the browser account changes", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/tool-workspace-drafts/image", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-tool-workspace-account": "8",
        },
        body: JSON.stringify({
          expectedVersion: 0,
          payload: { schemaVersion: 1, tool: "image", state: {} },
        }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "TOOL_WORKSPACE_ACCOUNT_CHANGED",
    });
    expect(mocks.saveToolWorkspaceDraft).not.toHaveBeenCalled();
  });

  it("returns 401 from every route before touching draft services", async () => {
    mocks.getUserId.mockResolvedValue(null);
    const form = new FormData();
    form.set("file", pngFile());

    const responses = await Promise.all([
      GET(new Request("http://localhost/api/tool-workspace-drafts/image"), context),
      PATCH(new Request("http://localhost/api/tool-workspace-drafts/image", { method: "PATCH" }), context),
      POST(
        new Request("http://localhost/api/tool-workspace-drafts/image/media", { method: "POST", body: form }),
        context,
      ),
      GET_MEDIA(
        new Request("http://localhost/api/tool-workspace-drafts/image/media?requestKey=22222222-2222-4222-8222-222222222222"),
        context,
      ),
      DELETE(
        new Request("http://localhost/api/tool-workspace-drafts/image/media/10", { method: "DELETE" }),
        { params: { tool: "image", relationId: "10" } },
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401]);
    expect(mocks.getToolWorkspaceDraft).not.toHaveBeenCalled();
    expect(mocks.saveToolWorkspaceDraft).not.toHaveBeenCalled();
    expect(mocks.uploadAndAttachToolWorkspaceMedia).not.toHaveBeenCalled();
    expect(mocks.detachToolWorkspaceMedia).not.toHaveBeenCalled();
  });
});
