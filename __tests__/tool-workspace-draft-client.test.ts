import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteToolWorkspaceMedia,
  fetchToolWorkspaceDraft,
  patchToolWorkspaceDraft,
  readLegacyToolWorkspaceMigration,
  readLocalWorkspaceDraftBackup,
  uploadToolWorkspaceMedia,
  workspaceDraftFingerprint,
  writeLocalWorkspaceDraftBackup,
} from "@/lib/tool-workspace-draft/client";

const draftSessionId = "11111111-1111-4111-8111-111111111111";
const firstMediaId = "22222222-2222-4222-8222-222222222222";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("tool workspace draft browser helpers", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("writes a versioned backup with savedAt and reads it defensively", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T08:00:00.000Z"));
    const storage = fakeStorage();

    const written = writeLocalWorkspaceDraftBackup(storage, "image:7", {
      version: 3,
      payload: { schemaVersion: 1, tool: "image", state: { prompt: "保留" } },
      media: [{ mediaId: firstMediaId, position: 0 }],
    });

    expect(written).toMatchObject({
      schemaVersion: 1,
      version: 3,
      savedAt: "2026-08-10T08:00:00.000Z",
    });
    expect(readLocalWorkspaceDraftBackup(storage, "image:7")).toEqual(written);
    storage.setItem("broken", "{not json");
    expect(readLocalWorkspaceDraftBackup(storage, "broken")).toBeNull();
  });

  it("migrates image parameters and ordered media without File or blob URLs", () => {
    const local = fakeStorage();
    const session = fakeStorage();
    local.setItem("draft_image_v1_7", JSON.stringify({
      prompt: "保留我",
      model: "nano-banana-pro",
      imagePaths: ["blob:temporary", "/uploads/legacy.png"],
      pending: true,
      nested: { uploadError: "old", value: 1 },
    }));
    session.setItem("tool_media_draft_v1:image:7", JSON.stringify({
      draftSessionId,
      items: [{ mediaId: firstMediaId, position: 0 }],
    }));

    const migrated = readLegacyToolWorkspaceMigration({
      tool: "image",
      userId: "7",
      localStorage: local,
      sessionStorage: session,
    });

    expect(migrated?.payload).toMatchObject({
      schemaVersion: 1,
      tool: "image",
      state: { prompt: "保留我", model: "nano-banana-pro", nested: { value: 1 } },
    });
    expect(migrated?.media).toEqual([{ mediaId: firstMediaId, position: 0 }]);
    expect(JSON.stringify(migrated)).not.toContain("blob:temporary");
    expect(JSON.stringify(migrated)).not.toContain("uploadError");
    expect(JSON.stringify(migrated)).not.toContain("pending");
  });

  it("preserves video first/last slots during migration", () => {
    const local = fakeStorage();
    const session = fakeStorage();
    local.setItem("draft_video_v1_7", JSON.stringify({ prompt: "转场", model: "veo" }));
    session.setItem("tool_media_draft_v1:video:7", JSON.stringify({
      draftSessionId,
      items: [{ mediaId: firstMediaId, position: 1, slot: "last" }],
    }));

    expect(readLegacyToolWorkspaceMigration({
      tool: "video",
      userId: "7",
      localStorage: local,
      sessionStorage: session,
    })?.media).toEqual([{ mediaId: firstMediaId, position: 1, slot: "last" }]);
  });

  it("creates stable fingerprints regardless of object key order", () => {
    const media = [{ mediaId: firstMediaId, position: 0 }];
    expect(workspaceDraftFingerprint(
      { schemaVersion: 1, tool: "image", state: { prompt: "x", model: "m" } },
      media,
    )).toBe(workspaceDraftFingerprint(
      { tool: "image", state: { model: "m", prompt: "x" }, schemaVersion: 1 },
      media,
    ));
  });

  it("uses the authenticated API contract for get, patch, upload, and delete", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, draft: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, draft: { version: 2 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, relation: { relationId: "10" }, version: 3 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, detached: true, version: 4 }), { status: 200 }));
    const payload = { schemaVersion: 1, tool: "image", state: { prompt: "保留" } };

    await fetchToolWorkspaceDraft("image", fetcher);
    await patchToolWorkspaceDraft("image", {
      accountGuardUserId: "7",
      expectedVersion: 1,
      payload,
      media: [{ mediaId: firstMediaId, position: 0 }],
    }, fetcher);
    await uploadToolWorkspaceMedia("video", new File(["x"], "frame.png", { type: "image/png" }), "first", "7", fetcher);
    await deleteToolWorkspaceMedia("image", "10", "7", fetcher);

    expect(fetcher.mock.calls[0]).toEqual([
      "/api/tool-workspace-drafts/image",
      { cache: "no-store" },
    ]);
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-Tool-Workspace-Account": "7",
      },
    });
    expect(fetcher.mock.calls[2][0]).toBe("/api/tool-workspace-drafts/video/media");
    expect(fetcher.mock.calls[2][1].body).toBeInstanceOf(FormData);
    expect(fetcher.mock.calls[2][1].body.get("requestKey")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(fetcher.mock.calls[2][1].headers).toEqual({ "X-Tool-Workspace-Account": "7" });
    expect(fetcher.mock.calls[3][0]).toBe("/api/tool-workspace-drafts/image/media/10");
    expect(fetcher.mock.calls[3][1]).toEqual({
      method: "DELETE",
      headers: { "X-Tool-Workspace-Account": "7" },
    });
  });

  it("recovers a timed-out upload by querying the same request key", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    const relation = {
      relationId: "10",
      mediaId: firstMediaId,
      position: 0,
      slot: null,
      kind: "image",
      status: "ready",
      originalName: "frame.png",
      mimeType: "image/png",
      sizeBytes: 1,
      localPreviewUrl: "/uploads/imports/frame.png",
      createdAt: "2026-08-14T08:00:00.000Z",
    };
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") return new Promise<Response>(() => undefined);
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        uploadState: "ready",
        relation,
        version: 3,
      }), { status: 200 }));
    });

    const upload = uploadToolWorkspaceMedia(
      "image",
      new File(["x"], "frame.png", { type: "image/png" }),
      null,
      "7",
      fetcher,
      {
        requestKey: firstMediaId,
        requestTimeoutMs: 10,
        verificationTimeoutMs: 100,
        verificationIntervalMs: 1,
        onStateChange: (state) => states.push(state),
      },
    );
    await vi.advanceTimersByTimeAsync(11);

    await expect(upload).resolves.toEqual({ relation, version: 3 });
    expect(states).toEqual(["uploading", "verifying"]);
    expect(fetcher.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect((fetcher.mock.calls[0][1]?.body as FormData).get("requestKey")).toBe(firstMediaId);
    expect(String(fetcher.mock.calls[1][0])).toContain(`requestKey=${firstMediaId}`);
  });

  it("does not poll when the server definitively rejects a conflicting request key", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: "request key conflict",
      code: "TOOL_WORKSPACE_UPLOAD_REQUEST_KEY_CONFLICT",
    }), { status: 409 }));

    await expect(uploadToolWorkspaceMedia(
      "image",
      new File(["x"], "frame.png", { type: "image/png" }),
      null,
      "7",
      fetcher,
      { requestKey: firstMediaId, verificationTimeoutMs: 1 },
    )).rejects.toMatchObject({
      status: 409,
      code: "TOOL_WORKSPACE_UPLOAD_REQUEST_KEY_CONFLICT",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("stops verification immediately when the signed-in account changes", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("network interrupted"))
      .mockResolvedValue(new Response(JSON.stringify({
        success: false,
        error: "account changed",
        code: "TOOL_WORKSPACE_ACCOUNT_CHANGED",
      }), { status: 409 }));

    await expect(uploadToolWorkspaceMedia(
      "image",
      new File(["x"], "frame.png", { type: "image/png" }),
      null,
      "7",
      fetcher,
      {
        requestKey: firstMediaId,
        verificationTimeoutMs: 10_000,
        verificationIntervalMs: 1_000,
      },
    )).rejects.toMatchObject({
      status: 409,
      code: "TOOL_WORKSPACE_ACCOUNT_CHANGED",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
