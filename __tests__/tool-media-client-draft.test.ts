import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it, vi } from "vitest";
import * as toolMediaClientDraft from "@/lib/tool-media/client-draft";
import {
  appendMultiUploadItems,
  getToolMediaUploadStatusLabel,
  replaceMultiUploadItem,
} from "@/components/ui/multi-upload-dropzone";
import {
  buildToolMediaDraftKey,
  buildToolMediaDraftRequestUrl,
  canStartToolMediaUpload,
  createToolClientUuid,
  createPendingToolMediaItem,
  createPendingToolMediaReplacement,
  getOrCreateToolMediaDraftSession,
  getToolMediaGenerateButtonState,
  hasFailedToolMediaUploads,
  hasPendingToolMediaUploads,
  isToolMediaUploadFile,
  parseToolMediaDraft,
  partitionToolMediaInputs,
  reconcileToolMediaDraftItems,
  releaseToolMediaForCurrentAccount,
  removedToolMediaIds,
  resolveToolMediaUploadCommit,
  restoreToolMediaTemplateItems,
  retryToolMediaUpload,
  serializeToolMediaDraft,
  settleToolMediaUpload,
  type ToolMediaClientItem,
} from "@/lib/tool-media/client-draft";

const draftSessionId = "11111111-1111-4111-8111-111111111111";
const firstId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe("tool media client draft", () => {
  it("shows pending and failed upload states without a ready label", () => {
    expect(getToolMediaUploadStatusLabel({ uploadState: "queued" })).toBe("等待上传");
    expect(getToolMediaUploadStatusLabel({ uploadState: "uploading" })).toBe("正在上传");
    expect(getToolMediaUploadStatusLabel({ uploadState: "verifying" })).toBe("正在确认");
    expect(getToolMediaUploadStatusLabel({ uploadState: "ready" })).toBe("");
    expect(getToolMediaUploadStatusLabel({ uploadState: "failed" })).toBe("上传未完成");
  });

  it("builds workspace legacy paths without validating pending uploads", () => {
    const getWorkspaceLegacyPaths = (
      toolMediaClientDraft as typeof toolMediaClientDraft & {
        getToolMediaWorkspaceLegacyPaths?: (
          items: ToolMediaClientItem[],
        ) => string[];
      }
    ).getToolMediaWorkspaceLegacyPaths;

    expect(getWorkspaceLegacyPaths).toBeTypeOf("function");
    if (!getWorkspaceLegacyPaths) return;

    const pendingFile = new File(["pending"], "pending.png", {
      type: "image/png",
    });
    const previousLegacyItem: ToolMediaClientItem = {
      file: null,
      url: "/uploads/imports/previous.png",
    };

    expect(
      getWorkspaceLegacyPaths([
        { file: pendingFile, url: null },
        createPendingToolMediaReplacement(previousLegacyItem, pendingFile),
        { file: null, url: "/uploads/imports/ready.png" },
        { mediaId: firstId, file: null, url: "/uploads/tool_inputs/ready.png" },
        { file: null, url: "/uploads/tool_inputs/unbound.png" },
      ]),
    ).toEqual([
      "/uploads/imports/previous.png",
      "/uploads/imports/ready.png",
    ]);
  });

  it("keeps a stable in-memory snapshot for returning to the same tool route", () => {
    const memory = toolMediaClientDraft as typeof toolMediaClientDraft & {
      rememberToolMediaItems?: (
        tool: "image" | "video",
        userId: string,
        items: ToolMediaClientItem[],
      ) => void;
      readRememberedToolMediaItems?: (
        tool: "image" | "video",
        userId: string,
      ) => ToolMediaClientItem[] | null;
      forgetRememberedToolMediaItems?: (
        tool: "image" | "video",
        userId: string,
      ) => void;
    };

    expect(memory.rememberToolMediaItems).toBeTypeOf("function");
    expect(memory.readRememberedToolMediaItems).toBeTypeOf("function");
    expect(memory.forgetRememberedToolMediaItems).toBeTypeOf("function");
    if (
      !memory.rememberToolMediaItems
      || !memory.readRememberedToolMediaItems
      || !memory.forgetRememberedToolMediaItems
    ) return;

    memory.forgetRememberedToolMediaItems("image", "7");
    const items: ToolMediaClientItem[] = [
      { mediaId: firstId, file: null, url: "/uploads/tool_inputs/local.png" },
      { file: null, url: "/uploads/imports/product.png" },
      { file: new File(["pending"], "pending.png", { type: "image/png" }), url: null },
    ];
    memory.rememberToolMediaItems("image", "7", items);
    items[0].url = "/mutated-after-save.png";

    const restored = memory.readRememberedToolMediaItems("image", "7");
    expect(restored).toEqual([
      { mediaId: firstId, file: null, url: "/uploads/tool_inputs/local.png" },
      { file: null, url: "/uploads/imports/product.png" },
    ]);
    expect(memory.readRememberedToolMediaItems("video", "7")).toBeNull();
    expect(memory.readRememberedToolMediaItems("image", "8")).toBeNull();

    if (restored) restored[0].url = "/mutated-after-read.png";
    expect(memory.readRememberedToolMediaItems("image", "7")?.[0].url).toBe(
      "/uploads/tool_inputs/local.png",
    );
    memory.forgetRememberedToolMediaItems("image", "7");
  });

  it("creates a valid UUID when randomUUID is unavailable on HTTP", () => {
    vi.stubGlobal("crypto", undefined);
    try {
      const first = createToolClientUuid();
      const second = createToolClientUuid();

      expect(first).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(second).not.toBe(first);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses a user-scoped and tool-scoped session-only key", () => {
    expect(buildToolMediaDraftKey("image", "7")).toBe(
      "tool_media_draft_v1:image:7",
    );
    expect(buildToolMediaDraftKey("video", "7")).toBe(
      "tool_media_draft_v1:video:7",
    );
    expect(buildToolMediaDraftKey("image", "8")).not.toBe(
      buildToolMediaDraftKey("image", "7"),
    );
  });

  it("serializes only the draft session, ordered media IDs and necessary UI state", () => {
    const file = new File(["private bytes"], "private.png", {
      type: "image/png",
    });
    const serialized = serializeToolMediaDraft({
      draftSessionId,
      items: [
        {
          mediaId: secondId,
          file,
          url: "blob:https://app.example/private",
          modelUrl: "https://signed.example/secret?token=secret",
          slot: "last",
        },
        {
          mediaId: firstId,
          url: "/uploads/tool_inputs/first.png",
          slot: "first",
        },
      ],
    });

    expect(JSON.parse(serialized)).toEqual({
      draftSessionId,
      items: [
        { mediaId: secondId, slot: "last", position: 0 },
        { mediaId: firstId, slot: "first", position: 1 },
      ],
    });
    expect(serialized).not.toContain("private bytes");
    expect(serialized).not.toContain("blob:");
    expect(serialized).not.toContain("/uploads/");
    expect(serialized).not.toContain("signed.example");
    expect(parseToolMediaDraft(serialized)).toEqual(JSON.parse(serialized));
  });

  it("creates and reuses one valid draft session per user and tool", () => {
    const storage = fakeStorage();
    const createId = vi.fn(() => draftSessionId);

    const first = getOrCreateToolMediaDraftSession(
      storage,
      "image",
      "7",
      createId,
    );
    const second = getOrCreateToolMediaDraftSession(
      storage,
      "image",
      "7",
      createId,
    );

    expect(first.draftSessionId).toBe(draftSessionId);
    expect(second).toEqual(first);
    expect(createId).toHaveBeenCalledTimes(1);
    expect(storage.getItem(buildToolMediaDraftKey("video", "7"))).toBeNull();
  });

  it("requests the saved media ids so reusable history inputs survive a new draft session", () => {
    expect(
      buildToolMediaDraftRequestUrl({
        draftSessionId,
        items: [
          { mediaId: secondId, slot: "last" },
          { mediaId: firstId, slot: "first" },
        ],
      }),
    ).toBe(
      `/api/tool-media/drafts?draftSessionId=${draftSessionId}&mediaIds=${secondId}%2C${firstId}`,
    );
  });

  it("restores only ready server items named by this session, in saved order", () => {
    const restored = reconcileToolMediaDraftItems(
      {
        draftSessionId,
        items: [
          { mediaId: secondId, slot: "last" },
          { mediaId: firstId, slot: "first" },
        ],
      },
      [
        {
          mediaId: firstId,
          status: "ready",
          localPreviewUrl: "/uploads/first.png",
        },
        {
          mediaId: "44444444-4444-4444-8444-444444444444",
          status: "ready",
          localPreviewUrl: "/uploads/other.png",
        },
        {
          mediaId: secondId,
          status: "processing",
          localPreviewUrl: "/uploads/second.png",
        },
      ],
    );

    expect(restored).toEqual([
      {
        mediaId: firstId,
        file: null,
        url: "/uploads/first.png",
        slot: "first",
      },
    ]);
  });

  it("restores media IDs and legacy paths in their original mixed order", () => {
    const restored = reconcileToolMediaDraftItems(
      {
        draftSessionId,
        items: [
          { mediaId: firstId, position: 0 },
          { mediaId: secondId, position: 2 },
        ],
      },
      [
        {
          mediaId: secondId,
          status: "ready",
          localPreviewUrl: "/uploads/tool_inputs/local-b.png",
        },
        {
          mediaId: firstId,
          status: "ready",
          localPreviewUrl: "/uploads/tool_inputs/local-a.png",
        },
      ],
      [
        { file: null, url: "/uploads/imports/product.png" },
        { file: null, url: "/uploads/imports/history.png" },
      ],
    );

    expect(restored).toEqual([
      {
        mediaId: firstId,
        file: null,
        url: "/uploads/tool_inputs/local-a.png",
      },
      { file: null, url: "/uploads/imports/product.png" },
      {
        mediaId: secondId,
        file: null,
        url: "/uploads/tool_inputs/local-b.png",
      },
      { file: null, url: "/uploads/imports/history.png" },
    ]);
  });

  it("keeps the legacy merge order for drafts saved before positions existed", () => {
    const restored = reconcileToolMediaDraftItems(
      {
        draftSessionId,
        items: [{ mediaId: firstId }],
      },
      [
        {
          mediaId: firstId,
          status: "ready",
          localPreviewUrl: "/uploads/tool_inputs/local.png",
        },
      ],
      [{ file: null, url: "/uploads/imports/legacy.png" }],
    );

    expect(restored).toEqual([
      { file: null, url: "/uploads/imports/legacy.png" },
      {
        mediaId: firstId,
        file: null,
        url: "/uploads/tool_inputs/local.png",
      },
    ]);
  });

  it("restores reusable history media IDs while retaining only safe legacy paths", () => {
    expect(
      restoreToolMediaTemplateItems({
        inputMedia: [
          {
            mediaId: secondId,
            status: "ready",
            localPreviewUrl: "/uploads/tool_inputs/second.png",
            position: 1,
          },
          {
            mediaId: firstId,
            status: "ready",
            localPreviewUrl: "/uploads/tool_inputs/first.png",
            position: 0,
          },
          {
            mediaId: "44444444-4444-4444-8444-444444444444",
            status: "processing",
            localPreviewUrl: "/uploads/tool_inputs/pending.png",
            position: 2,
          },
        ],
        imagePaths: [
          "/uploads/tool_inputs/stale-path-only.png",
          "/uploads/product-library/legacy.png",
          "/uploads/product-library/legacy.png",
          "/uploads/imports/2026-07-24/legacy-import.png",
        ],
      }),
    ).toEqual([
      {
        mediaId: firstId,
        file: null,
        url: "/uploads/tool_inputs/first.png",
      },
      {
        mediaId: secondId,
        file: null,
        url: "/uploads/tool_inputs/second.png",
      },
      {
        file: null,
        url: "/uploads/product-library/legacy.png",
      },
      {
        file: null,
        url: "/uploads/imports/2026-07-24/legacy-import.png",
      },
    ]);
  });

  it.each(["image", "video"])(
    "disables the %s generate button while a new item is pending",
    (tool) => {
      const state = getToolMediaGenerateButtonState({
        items: [
          {
            file: new File(["x"], `${tool}.png`, { type: "image/png" }),
            url: null,
          },
        ],
        phase: "idle",
        hasPrompt: true,
      });

      expect(state).toEqual({ disabled: true, label: "素材上传中…" });
    },
  );

  it.each([
    ["validating", "正在检查素材…"],
    ["submitting", "正在提交模型…"],
    ["idle", "生成"],
  ] as const)("shows the real %s submission phase", (phase, label) => {
    expect(
      getToolMediaGenerateButtonState({
        items: [],
        phase,
        hasPrompt: true,
      }),
    ).toEqual({ disabled: phase !== "idle", label });
  });

  it("blocks generation until every failed material is replaced or deleted", () => {
    expect(
      getToolMediaGenerateButtonState({
        items: [{ file: null, url: "/uploads/old.png", uploadError: "failed" }],
        phase: "idle",
        hasPrompt: true,
      }),
    ).toEqual({ disabled: true, label: "请处理上传失败素材" });
  });

  it("submits new uploads only as ordered media IDs while retaining legacy paths", () => {
    expect(
      partitionToolMediaInputs([
        {
          mediaId: secondId,
          file: null,
          url: "/uploads/tool_inputs/second.png",
        },
        { file: null, url: "/uploads/product-library/legacy.png" },
        { file: null, url: "/uploads/imports/2026-07-24/legacy-import.png" },
        { mediaId: firstId, file: null, url: "/uploads/tool_inputs/first.png" },
      ]),
    ).toEqual({
      manifest: {
        version: 1,
        items: [
          { position: 0, source: "tool_media", mediaId: secondId },
          { position: 1, source: "legacy_path", path: "/uploads/product-library/legacy.png" },
          { position: 2, source: "legacy_path", path: "/uploads/imports/2026-07-24/legacy-import.png" },
          { position: 3, source: "tool_media", mediaId: firstId },
        ],
      },
      toolMediaIds: [secondId, firstId],
      legacyPaths: [
        "/uploads/product-library/legacy.png",
        "/uploads/imports/2026-07-24/legacy-import.png",
      ],
    });

    expect(() =>
      partitionToolMediaInputs([
        { file: null, url: "/uploads/tool_inputs/stale-local-draft.png" },
      ]),
    ).toThrow("第 1 个素材尚未就绪");
  });

  it("routes audio through tool media upload only when the selected model explicitly allows it", () => {
    expect(
      isToolMediaUploadFile(
        new File(["image"], "input.png", { type: "image/png" }),
      ),
    ).toBe(true);
    expect(
      isToolMediaUploadFile(
        new File(["video"], "input.mp4", { type: "video/mp4" }),
      ),
    ).toBe(true);
    expect(
      isToolMediaUploadFile(
        new File(["audio"], "input.mp3", { type: "audio/mpeg" }),
      ),
    ).toBe(false);
    expect(
      isToolMediaUploadFile(
        new File(["audio"], "input.mp3", { type: "audio/mpeg" }),
        { allowAudio: true },
      ),
    ).toBe(true);
  });

  it("protects the old media from removal diff while replacement is uploading", () => {
    const oldItem = {
      mediaId: firstId,
      file: null,
      url: "/uploads/tool_inputs/old.png",
    };
    const pending = createPendingToolMediaReplacement(
      oldItem,
      new File(["new"], "new.png", { type: "image/png" }),
    );

    expect(removedToolMediaIds([oldItem], [pending])).toEqual([]);
    expect(
      JSON.parse(
        serializeToolMediaDraft({
          draftSessionId,
          items: [pending],
        }),
      ),
    ).toEqual({
      draftSessionId,
      items: [{ mediaId: firstId, position: 0 }],
    });
  });

  it("blocks new items and upload effects until draft hydration completes", async () => {
    const file = new File(["new"], "new.png", { type: "image/png" });
    const upload = vi.fn(async () => undefined);
    const blockedItems = appendMultiUploadItems(
      [],
      [{ file, url: null }],
      undefined,
      true,
    );
    const blockedUpload = canStartToolMediaUpload({
      hydrated: false,
      userId: "7",
      draftSessionId,
      draftOwnerUserId: "7",
    });

    if (blockedUpload) await upload();

    expect(blockedItems).toBeNull();
    expect(blockedUpload).toBe(false);
    expect(upload).not.toHaveBeenCalled();

    const acceptedItems = appendMultiUploadItems(
      [],
      [{ file, url: null }],
      undefined,
      false,
    );
    const readyUpload = canStartToolMediaUpload({
      hydrated: true,
      userId: "7",
      draftSessionId,
      draftOwnerUserId: "7",
    });

    if (readyUpload) await upload();

    expect(acceptedItems).toEqual([{ file, url: null }]);
    expect(readyUpload).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("rejects a second file or paint replacement while the first is pending", async () => {
    const oldItem = {
      mediaId: firstId,
      file: null,
      url: "/uploads/tool_inputs/old.png",
    };
    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    const secondFile = new File(["second"], "second.png", {
      type: "image/png",
    });
    const firstReplacement = replaceMultiUploadItem(
      [oldItem],
      0,
      { file: firstFile, url: null },
      undefined,
      false,
    );

    expect(firstReplacement).not.toBeNull();
    const pending = firstReplacement![0];
    const secondReplacement = replaceMultiUploadItem(
      firstReplacement!,
      0,
      { file: secondFile, url: null },
      undefined,
      false,
    );
    const paintReplacement = createPendingToolMediaReplacement(
      pending,
      secondFile,
      { paintOriginalUrl: "/uploads/tool_inputs/old.png" },
    );

    expect(secondReplacement).toBeNull();
    expect(paintReplacement).toBe(pending);
    expect(pending.file).toBe(firstFile);
    expect(pending.replacement?.previousItem).toEqual(oldItem);

    const upload = vi.fn(async () => {
      throw new Error("network failed");
    });
    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload,
    });

    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.item).toMatchObject({
      ...oldItem,
      file: firstFile,
      uploadState: "failed",
      uploadError: "network failed",
    });
    expect(hasFailedToolMediaUploads([result.item!])).toBe(true);
    expect(hasPendingToolMediaUploads([result.item!])).toBe(false);
    expect(result.commit).toBeNull();
  });

  it("preserves the old card when replacement upload fails", async () => {
    const oldItem = {
      mediaId: firstId,
      file: null,
      url: "/uploads/tool_inputs/old.png",
    };
    const pending = createPendingToolMediaReplacement(
      oldItem,
      new File(["new"], "new.png", { type: "image/png" }),
    );

    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => {
        throw new Error("network failed");
      },
    });

    expect(result.item).toMatchObject({
      ...oldItem,
      file: pending.file,
      uploadState: "failed",
      uploadError: "network failed",
    });
    expect(result.error).toBeInstanceOf(Error);
    expect(result.commit).toBeNull();
  });

  it("waits for the ready replacement to be committed before releasing the old media", async () => {
    const oldItem: ToolMediaClientItem = {
      mediaId: firstId,
      file: null,
      url: "/uploads/tool_inputs/old.png",
    };
    const pending = createPendingToolMediaReplacement(
      oldItem,
      new File(["new"], "new.png", { type: "image/png" }),
    );
    const order: string[] = [];
    const release = vi.fn(async (mediaIds: string[]) => {
      order.push(`release:${mediaIds.join(",")}`);
    });

    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => {
        order.push("ready");
        return {
          mediaId: secondId,
          localPreviewUrl: "/uploads/tool_inputs/new.png",
          modelUrl: "https://model.example/new.png",
          status: "ready",
        };
      },
    });

    expect(result.item).toMatchObject({
      mediaId: secondId,
      file: null,
      url: "/uploads/tool_inputs/new.png",
      uploadState: "ready",
    });
    expect(result.error).toBeNull();
    expect(result.commit).toEqual({
      pendingFile: pending.file,
      readyMediaId: secondId,
      previousMediaId: firstId,
    });
    expect(resolveToolMediaUploadCommit([pending], result.commit!)).toEqual({
      complete: false,
      releaseMediaIds: [],
    });
    expect(order).toEqual(["ready"]);

    order.push("publish");
    const committed = resolveToolMediaUploadCommit(
      [result.item!],
      result.commit!,
    );
    await release(committed.releaseMediaIds);

    expect(committed).toEqual({
      complete: true,
      releaseMediaIds: [firstId],
    });
    expect(order).toEqual(["ready", "publish", `release:${firstId}`]);
  });

  it("releases only the newly uploaded media when its pending card was removed", async () => {
    const pending = createPendingToolMediaReplacement(
      {
        mediaId: firstId,
        file: null,
        url: "/uploads/tool_inputs/old.png",
      },
      new File(["new"], "new.png", { type: "image/png" }),
    );
    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => ({
        mediaId: secondId,
        localPreviewUrl: "/uploads/tool_inputs/new.png",
        modelUrl: "https://model.example/new.png",
        status: "ready",
      }),
    });

    expect(resolveToolMediaUploadCommit([], result.commit!)).toEqual({
      complete: true,
      releaseMediaIds: [secondId],
    });
  });

  it("does not attempt release after the authenticated account changes or logs out", async () => {
    const release = vi.fn(async () => undefined);

    const switched = await releaseToolMediaForCurrentAccount({
      ownerUserId: "account-a",
      currentUserId: "account-b",
      mediaIds: [firstId],
      release,
    });
    const loggedOut = await releaseToolMediaForCurrentAccount({
      ownerUserId: "account-a",
      currentUserId: "",
      mediaIds: [firstId],
      release,
    });

    expect(switched).toBe(false);
    expect(loggedOut).toBe(false);
    expect(release).not.toHaveBeenCalled();

    const sameAccount = await releaseToolMediaForCurrentAccount({
      ownerUserId: "account-a",
      currentUserId: "account-a",
      mediaIds: [firstId],
      release,
    });

    expect(sameAccount).toBe(true);
    expect(release).toHaveBeenCalledWith([firstId]);
  });

  it("keeps the upload result shape stable for a ready new item", async () => {
    const pending = {
      file: new File(["new"], "new.png", { type: "image/png" }),
      url: null,
    };
    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => ({
        mediaId: secondId,
        localPreviewUrl: "/uploads/tool_inputs/new.png",
        modelUrl: "https://model.example/new.png",
        status: "ready",
      }),
    });

    expect(result).toEqual({
      item: {
        mediaId: secondId,
        file: null,
        url: "/uploads/tool_inputs/new.png",
      },
      error: null,
      commit: {
        pendingFile: pending.file,
        readyMediaId: secondId,
      },
    });
  });

  it("keeps a new upload pending result out of generation when model URL is missing", async () => {
    const pending = {
      file: new File(["new"], "new.png", { type: "image/png" }),
      url: null,
    };

    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => ({
        mediaId: secondId,
        localPreviewUrl: "/uploads/tool_inputs/new.png",
        status: "ready",
      }),
    });

    expect(result.item).toEqual({
      ...pending,
      uploadError: expect.any(String),
    });
    expect(hasFailedToolMediaUploads([result.item!])).toBe(true);
    expect(hasPendingToolMediaUploads([result.item!])).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.commit).toBeNull();
  });

  it("preserves the server probe and kind on a ready upload card", async () => {
    const pending = createPendingToolMediaItem(
      new File([new Uint8Array([0, 0, 0, 0])], "clip.mp4", { type: "video/mp4" }),
    );
    const probe = {
      version: 1 as const,
      kind: "video" as const,
      detectedMime: "video/mp4",
      container: "mp4",
      width: 1280,
      height: 720,
      durationSeconds: 5,
      frameRate: 30,
      videoCodec: "h264",
      audioCodecs: ["aac"],
    };

    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => ({
        mediaId: firstId,
        localPreviewUrl: "/uploads/tool_inputs/clip.mp4",
        modelUrl: "https://model.example/clip.mp4",
        status: "ready",
        kind: "video",
        probe,
      }),
    });

    expect(result.item).toMatchObject({
      kind: "video",
      byteSize: pending.file?.size,
      probe,
    });
  });

  it("preserves the server probe and byte size when a dragged URL becomes ready", async () => {
    const pending: ToolMediaClientItem = {
      file: null,
      url: "/uploads/products/shared/image/reference.png",
      uploadRequestId: secondId,
      uploadState: "uploading",
    };
    const probe = {
      version: 1 as const,
      kind: "image" as const,
      detectedMime: "image/png",
      width: 1280,
      height: 720,
      frameCount: 1,
    };

    const result = await settleToolMediaUpload({
      pendingItem: pending,
      upload: async () => ({
        mediaId: firstId,
        localPreviewUrl: "/uploads/imports/reference.png",
        modelUrl: "https://model.example/reference.png",
        status: "ready",
        kind: "image",
        sizeBytes: 1234,
        probe,
      }),
    });

    expect(result.error).toBeNull();
    expect(result.item).toMatchObject({
      file: null,
      url: "/uploads/imports/reference.png",
      mediaId: firstId,
      kind: "image",
      byteSize: 1234,
      probe,
      uploadState: "ready",
    });
  });

  it("posts a dragged product-library URL through the tool-media verification endpoint", async () => {
    const uploadFromSource = (
      toolMediaClientDraft as typeof toolMediaClientDraft & {
        uploadEphemeralToolMediaFromSource?: (input: {
          draftSessionId: string;
          sourceUrl: string;
          model?: string;
          fetcher?: typeof fetch;
        }) => Promise<unknown>;
      }
    ).uploadEphemeralToolMediaFromSource;

    expect(uploadFromSource).toBeTypeOf("function");
    if (!uploadFromSource) return;

    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const form = init?.body as FormData;
      expect(form.get("draftSessionId")).toBe(draftSessionId);
      expect(form.get("sourceUrl")).toBe("/uploads/products/shared/image/reference.png");
      expect(form.get("model")).toBe("doubao-seedance-2-0-260128");
      return new Response(JSON.stringify({
        success: true,
        mediaId: firstId,
        localPreviewUrl: "/uploads/imports/reference.png",
        modelUrl: "https://model.example/reference.png",
        status: "ready",
        kind: "image",
        sizeBytes: 1234,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });

    await uploadFromSource({
      draftSessionId,
      sourceUrl: "/uploads/products/shared/image/reference.png",
      model: "doubao-seedance-2-0-260128",
      fetcher: fetcher as any,
    });

    expect(fetcher).toHaveBeenCalledWith("/api/tool-media/upload", expect.objectContaining({
      method: "POST",
    }));
  });

  it("rejects an obvious Seedance MIME violation before sending a network request", async () => {
    const fetcher = vi.fn();

    await expect(toolMediaClientDraft.uploadEphemeralToolMedia({
      draftSessionId,
      model: "doubao-seedance-2-0-260128",
      file: new File(
        [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])],
        "reference.webm",
        { type: "video/webm" },
      ),
      fetcher: fetcher as any,
    })).rejects.toThrow("不支持");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("clears a failed marker when the user replaces the same slot", () => {
    const failedItem: ToolMediaClientItem = {
      mediaId: firstId,
      file: null,
      url: "/uploads/tool_inputs/old.png",
      uploadError: "network failed",
    };
    const retryFile = new File(["retry"], "retry.png", { type: "image/png" });

    const pending = createPendingToolMediaReplacement(failedItem, retryFile);

    expect(pending.uploadError).toBeUndefined();
    expect(pending.replacement?.previousItem).toEqual({
      mediaId: firstId,
      file: null,
      url: "/uploads/tool_inputs/old.png",
    });
  });

  it("keeps an explicit lifecycle and the same request id when a failed upload is retried", async () => {
    const file = new File(["retry"], "retry.png", { type: "image/png" });
    const queued = createPendingToolMediaItem(file, {
      uploadRequestId: secondId,
    });

    expect(queued).toMatchObject({
      file,
      url: null,
      uploadRequestId: secondId,
      uploadState: "queued",
    });
    expect(hasPendingToolMediaUploads([queued])).toBe(true);

    const failed = await settleToolMediaUpload({
      pendingItem: { ...queued, uploadState: "uploading" },
      upload: async () => {
        throw new Error("network failed");
      },
    });

    expect(failed.item).toMatchObject({
      file,
      uploadRequestId: secondId,
      uploadState: "failed",
      uploadError: "network failed",
    });
    expect(hasPendingToolMediaUploads([failed.item!])).toBe(false);
    expect(hasFailedToolMediaUploads([failed.item!])).toBe(true);

    expect(retryToolMediaUpload(failed.item!)).toMatchObject({
      file,
      uploadRequestId: secondId,
      uploadState: "queued",
    });
    expect(retryToolMediaUpload(failed.item!).uploadError).toBeUndefined();
  });
});

describe("tool media page lifecycle integration", () => {
  const imageSource = readFileSync(
    new URL("../app/image/image-tool.tsx", import.meta.url),
    "utf8",
  );
  const videoSource = readFileSync(
    new URL("../app/video/video-tool.tsx", import.meta.url),
    "utf8",
  );
  const worksSource = readFileSync(
    new URL("../app/works/page.tsx", import.meta.url),
    "utf8",
  );
  const historySource = readFileSync(
    new URL("../components/history/unified-history-panel.tsx", import.meta.url),
    "utf8",
  );
  const assetsApiSource = readFileSync(
    new URL("../app/api/assets/route.ts", import.meta.url),
    "utf8",
  );

  it("wires authenticated hydration into every document-scoped tool-media upload effect", () => {
    expect(
      imageSource.match(/disabled=\{workspaceControlsDisabled\}/g),
    ).toHaveLength(4);
    expect(
      videoSource.match(/disabled=\{workspaceControlsDisabled\}/g),
    ).toHaveLength(6);
    expect(videoSource).toContain("<RoleSkillTrigger");
    expect(imageSource).toContain(
      "const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable || !modelsConfirmed);",
    );
    expect(videoSource).toContain(
      "const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable);",
    );
    expect(imageSource).toContain("uploadEphemeralToolMedia({");
    expect(videoSource).toContain("uploadEphemeralToolMedia({");
    expect(imageSource).toContain('"toolbox:image"');
    expect(videoSource).toContain('"toolbox:video"');
  });

  it("routes Seedance product-library and history URL drops through immediate tool-media verification", () => {
    expect(videoSource).toContain("uploadEphemeralToolMediaFromSource({");
    expect(videoSource).toContain("isToolMediaSourceItem(item)");
    expect(videoSource).toContain("seedancePolicy");
    expect(videoSource).toContain('uploadState: "uploading"');
  });

  it("restores uploaded media from the document registry or the desktop draft", () => {
    for (const source of [imageSource, videoSource]) {
      expect(source).toMatch(/readDesktopInputDraft<\w+EphemeralInputDraft>\(desktopMode,/);
      expect(source).toMatch(/desktopDraft \|\| ephemeralInputDraftRegistry\.read<\w+EphemeralInputDraft>/);
      expect(source).toMatch(/desktopDraft\s*\? recoverDesktopDraftMedia\(/);
    }
  });

  it("persists the real-face acknowledgement independently for every restricted model", () => {
    expect(videoSource).toContain("validateSeedanceMediaSet({");
    expect(videoSource).toContain("请确认素材不包含直接上传的真实人物脸部");
    expect(videoSource).toContain("seedancePolicy.allowRealPersonFace");
    expect(videoSource).toContain('`studio_seedance_face_notice_v1_${userId}_${model}`');
    expect(videoSource).toMatch(/useIsoLayoutEffect\(\(\) => \{\s+if \(!faceAcknowledgementStorageKey\)/);
    expect(videoSource).toContain('localStorage.getItem(faceAcknowledgementStorageKey) === "acknowledged"');
    expect(videoSource).toContain('localStorage.setItem(faceAcknowledgementStorageKey, "acknowledged")');
    expect(videoSource).toContain("{requiresFaceAcknowledgement && !faceAcknowledged ? (");
    expect(videoSource).not.toContain('!["seedance-2.0", "seedance-2.5"].includes(seedancePolicy.ruleFamily)');
    expect(videoSource).not.toContain('`${model}:${mediaKeys.join("|")}`');
  });

  it("restores the last visible tool media snapshot before background draft validation", () => {
    expect(imageSource).toContain(
      'fetchToolWorkspaceDraft("image")',
    );
    expect(videoSource).toContain('fetchToolWorkspaceDraft("video")');
    expect(imageSource).toContain(
      "readLocalWorkspaceDraftBackup(localStorage, workspaceBackupKey)",
    );
    expect(videoSource).toContain(
      "readLocalWorkspaceDraftBackup(localStorage, workspaceBackupKey)",
    );
  });

  it("keeps failed image and video uploads in their original slot until an explicit retry", () => {
    expect(imageSource).toContain('it.uploadState === undefined || it.uploadState === "queued"');
    expect(videoSource).toContain('it.uploadState === undefined || it.uploadState === "queued"');
    expect(imageSource).toContain("needsImportToImports(it.url) && !it.uploadError");
    expect(videoSource).toContain("needsImportToImports(it.url) && !it.uploadError");
    expect(imageSource).toContain("uploadError:");
    expect(videoSource).toContain("uploadError:");
  });

  it("shows the real protected-source import lifecycle in both tools", () => {
    for (const source of [imageSource, videoSource]) {
      expect(source).toContain("importInputToImportsTracked({");
      expect(source).toMatch(/url: p,\s+uploadState: "ready",\s+uploadError: undefined/);
      expect(source).toContain('uploadState: "failed"');
    }
  });

  it("submits the ordered manifest and releases both generate buttons after acknowledgement", () => {
    expect(imageSource).toContain('form.set("inputManifest", JSON.stringify(manifest))');
    expect(videoSource).toContain('form.set("inputManifest", JSON.stringify(manifest))');
    expect(imageSource).toContain('setSubmissionPhase("validating")');
    expect(videoSource).toContain('setSubmissionPhase("validating")');
    expect(imageSource).toContain('setSubmissionPhase("submitting")');
    expect(videoSource).toContain('setSubmissionPhase("submitting")');
    expect(imageSource).toContain('setSubmissionPhase("idle")');
    expect(videoSource).toContain('setSubmissionPhase("idle")');
    expect(imageSource).toContain('logAction("generation_submit_timing"');
    expect(videoSource).toContain('logAction("generation_submit_timing"');
    expect(historySource).toContain('activeItem.isPending ? "正在提交模型…" : "模型已接收，正在生成"');
  });

  it("uses the HTTP-compatible UUID generator for image and video requests", () => {
    expect(imageSource).toContain("createToolClientUuid()");
    expect(videoSource).toContain("createToolClientUuid()");
    expect(imageSource).not.toContain("crypto.randomUUID()");
    expect(videoSource).not.toContain("crypto.randomUUID()");
  });

  it("resolves old-media release from committed page state within its document session", () => {
    expect(imageSource).toContain(
      "resolveToolMediaUploadCommit(items, commit)",
    );
    expect(videoSource).toContain(
      "resolveToolMediaUploadCommit(items, commit)",
    );
    expect(imageSource).toContain("releaseEphemeralToolMedia({ draftSessionId, mediaIds: uniqueMediaIds })");
    expect(videoSource).toContain("releaseEphemeralToolMedia({ draftSessionId, mediaIds: unusedMediaIds })");
    expect(imageSource).not.toContain(
      "releaseToolMedia(previousIds, previousDraft.draftSessionId",
    );
    expect(videoSource).not.toContain(
      "releaseToolMedia(previousIds, previousDraft.draftSessionId",
    );
    expect(imageSource).not.toContain('addEventListener("beforeunload"');
    expect(videoSource).not.toContain('addEventListener("beforeunload"');
  });

  it("carries reusable history media identities through both image-template entry points", () => {
    expect(worksSource).toContain(
      "inputMedia: Array.isArray(p.inputMedia) ? p.inputMedia : []",
    );
    expect(historySource).toContain(
      "inputMedia: Array.isArray(params.inputMedia) ? params.inputMedia : []",
    );
    expect(assetsApiSource).toContain("prisma.generationInputMedia.findMany({");
    expect(assetsApiSource).toContain("inputMediaByGenerationId");
    expect(imageSource).toContain("restoreToolMediaTemplateItems({");
    expect(imageSource).toContain("if (!userId || !workspaceDraftHydrated) return;");
    expect(
      imageSource.match(/!it\.mediaId && !it\.file && needsImportToImports\(it\.url\)/g),
    ).toHaveLength(3);
  });
});
