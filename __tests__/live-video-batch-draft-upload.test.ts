import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeToolWorkspaceTool } from "@/lib/tool-workspace-draft/contracts";

describe("live video batch draft uploads", () => {
  it("rejects Live from the generic tool-workspace draft namespace", () => {
    expect(() => normalizeToolWorkspaceTool("live_video_batch")).toThrow(
      expect.objectContaining({ code: "TOOL_WORKSPACE_TOOL_INVALID" }),
    );
  });

  it("keeps the Live left-side draft inside the live-video batch API family", () => {
    const hook = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");

    expect(hook).not.toContain("tool-workspace-draft");
    expect(hook).not.toContain("uploadToolWorkspaceMedia");
    expect(hook).not.toContain("fetchToolWorkspaceDraft");
    expect(hook).toContain("response.draft");
    expect(hook).toContain("/api/live-video-batches/${current.id}/media");
  });

  it("uploads and removes left-side media through a dedicated Live draft route", () => {
    const route = "app/api/live-video-batches/[batchId]/media/route.ts";
    expect(existsSync(route)).toBe(true);

    const source = readFileSync(route, "utf8");
    expect(source).toContain("uploadAndAttachLiveVideoDraftMediaFiles");
    expect(source).toContain('form.getAll("file")');
    expect(source).toContain("uploadedFileCount: files.length");
    expect(source).toContain("detachLiveVideoDraftMedia");
  });

  it("uses the shared batch storage profile instead of the tool import profile", () => {
    const service = readFileSync("lib/live-video-batch/service.ts", "utf8");
    const start = service.indexOf("export async function uploadAndAttachLiveVideoDraftMediaFiles");
    const end = service.indexOf("export async function detachLiveVideoDraftMedia", start);
    const uploadBlock = service.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(uploadBlock).toContain('storageProfile: "batch"');
    expect(uploadBlock).toContain("metadata: { batchId: batch.id }");
    expect(uploadBlock).toContain("liveVideoBatchItem.create");
  });

  it("shows local Live previews before each bounded upload request finishes", () => {
    const hook = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");
    const workspace = readFileSync(
      "components/batch-workbench/live-video-batch-workspace.tsx",
      "utf8",
    );

    expect(hook).toContain("URL.createObjectURL(file)");
    expect(hook).toContain("chunkBatchUploadFiles(files)");
    expect(hook).toContain('form.append("file", file)');
    expect(hook).toContain("response.uploadedFileCount");
    expect(workspace).toContain("controller.pendingMedia");
  });

  it("creates formal groups from the Live draft instead of accepting detached media ids", () => {
    const hook = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");
    const createStart = hook.indexOf("const createBatch =");
    const createEnd = hook.indexOf("const runBatchAction", createStart);
    const createBlock = hook.slice(createStart, createEnd);

    expect(createBlock).toContain("sourceBatchId: current.id");
    expect(createBlock).not.toContain("mediaIds:");
    expect(createBlock).not.toContain("media: []");
  });
});
