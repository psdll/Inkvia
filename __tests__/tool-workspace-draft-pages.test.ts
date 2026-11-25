import { readChineseUiSource as readFileSync } from "./helpers/chinese-ui-source";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("tool workspace settings and ephemeral inputs", () => {
  it("hydrates image settings from the account draft but keeps inputs in document memory", () => {
    const image = read("app/image/image-tool.tsx");
    expect(image).toContain('fetchToolWorkspaceDraft("image")');
    expect(image).toContain("workspaceDraftHydrated");
    expect(image).toContain("saveImageWorkspaceDraftNow");
    expect(image).toContain('window.addEventListener("pagehide"');
    expect(image).toContain("expectedVersion");
    expect(image).toContain("readLegacyToolWorkspaceMigration");
    expect(image).toContain("ephemeralInputDraftRegistry");
    expect(image).toContain("uploadEphemeralToolMedia");
    expect(image).toContain("releaseEphemeralToolMedia");
    expect(image).not.toContain("uploadToolWorkspaceMedia");
    expect(image).not.toContain("deleteToolWorkspaceMedia");
    expect(image).not.toMatch(/localStorage\.getItem\(draftKey\)[\s\S]{0,600}setPrompt/);
  });

  it("serializes image settings without prompt text or input media", () => {
    const image = read("app/image/image-tool.tsx");
    for (const field of [
      "model",
      "aspectRatio",
      "resolution",
      "customSize",
      "taskStyle",
      "parallelCount",
      "outputQuantity",
      "seedreamOutputMode",
      "seedreamOutputCount",
      "officialQuality",
      "officialOutputCount",
      "officialBackground",
      "officialModeration",
      "officialOutputFormat",
      "officialOutputCompression",
      "nanoOfficialSeed",
    ]) {
      expect(image).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(image).toContain('const media: Array<{ mediaId: string; position: number }> = [];');
    expect(image).not.toMatch(/const imageWorkspaceSnapshot[\s\S]{0,900}\bprompt\b/);
    expect(image).not.toMatch(/const imageWorkspaceSnapshot[\s\S]{0,900}\bimagePaths\b/);
    expect(image).not.toMatch(/state:\s*\{[^}]*toolboxRoleSkill[\s\S]*\}/);
    expect(image).not.toMatch(/state:\s*\{[^}]*reversePrompt[\s\S]*\}/);
  });

  it("persists video settings without prompt text, avatars, or input media", () => {
    const video = read("app/video/video-tool.tsx");
    expect(video).toContain('fetchToolWorkspaceDraft("video")');
    expect(video).toContain("workspaceDraftHydrated");
    expect(video).toContain("saveVideoWorkspaceDraftNow");
    expect(video).toContain('window.addEventListener("pagehide"');
    expect(video).toContain("readLegacyToolWorkspaceMigration");
    expect(video).toContain("ephemeralInputDraftRegistry");
    expect(video).toContain("uploadEphemeralToolMedia");
    expect(video).toContain("releaseEphemeralToolMedia");
    expect(video).not.toContain("uploadToolWorkspaceMedia");
    expect(video).not.toContain("deleteToolWorkspaceMedia");
    for (const field of [
      "model",
      "inputMode",
      "resolution",
      "ratio",
      "duration",
      "seed",
      "returnLastFrame",
      "generateAudio",
      "cameraFixed",
      "watermark",
      "webSearch",
    ]) {
      expect(video).toMatch(new RegExp(`\\b${field}\\b`));
    }
    expect(video).toContain('slot?: "first" | "last"');
    expect(video).toContain('const media: Array<{ mediaId: string; position: number; slot?: "first" | "last" }> = [];');
    expect(video).not.toMatch(/const videoWorkspaceSnapshot[\s\S]{0,900}\bprompt\b/);
    expect(video).not.toMatch(/const videoWorkspaceSnapshot[\s\S]{0,900}\bimagePaths\b/);
    expect(video).not.toMatch(/state:\s*\{[^}]*paramOpen[\s\S]*\}/);
    expect(video).not.toMatch(/state:\s*\{[^}]*submissionPhase[\s\S]*\}/);
  });

  it("keeps offline backups read-only and never force-overwrites a version conflict", () => {
    const image = read("app/image/image-tool.tsx");
    const video = read("app/video/video-tool.tsx");

    expect(image).toContain(
      "const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable || !modelsConfirmed);",
    );
    expect(video).toContain(
      "const workspaceControlsDisabled = Boolean(userId) && (!workspaceDraftHydrated || !workspaceDraftWritable);",
    );
    expect(image).toContain('inert={workspaceControlsDisabled ? ("" as any) : undefined}');
    expect(video).toContain("inert={workspaceControlsDisabled}");
    for (const source of [image, video]) {
      expect(source).toContain("workspaceDraftWritable");
      expect(source).toContain("setWorkspaceDraftWritable(false)");
      expect(source).toMatch(/if \(!workspaceDraftHydrated \|\| !workspaceDraftWritable/);
      expect(source).toContain("disabled={workspaceControlsDisabled}");
      expect(source).toContain("当前输入仍可继续使用");
      expect(source).not.toMatch(
        /TOOL_WORKSPACE_DRAFT_VERSION_CONFLICT[\s\S]{0,700}expectedVersion:\s*latest\?\.version/,
      );
    }
  });

  it("serializes uploads with workspace saves until the uploaded item reaches the snapshot", () => {
    const image = read("app/image/image-tool.tsx");
    const video = read("app/video/video-tool.tsx");

    for (const source of [image, video]) {
      expect(source).toContain("workspaceMediaMutationQueueRef.current.enqueueUpload(uploadMutation)");
      expect(source).toContain("await nextWorkspaceSnapshotFrame()");
    }
  });

  it("keeps image and video upload recovery state isolated in their own item arrays", () => {
    const image = read("app/image/image-tool.tsx");
    const video = read("app/video/video-tool.tsx");
    const dropzone = read("components/ui/multi-upload-dropzone.tsx");

    for (const source of [image, video]) {
      expect(source).toContain("uploadRequestId");
      expect(source).toContain("onStateChange");
      expect(source).toContain("uploadState: state");
      expect(source).toMatch(/items\.findIndex\([\s\S]{0,220}uploadState/);
    }
    expect(image).toContain("uploadEphemeralToolMedia({");
    expect(video).toContain("uploadEphemeralToolMedia({");
    expect(dropzone).toContain("retryToolMediaUpload");
    expect(dropzone).toContain("上传未完成");
    expect(dropzone).toContain("重试");
  });
});
