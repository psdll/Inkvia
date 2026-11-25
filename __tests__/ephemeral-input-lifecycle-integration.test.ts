import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("document-scoped creation inputs", () => {


  it("keeps image batch modes isolated in the current document", () => {
    const source = read("components/batch-workbench/batch-workbench-page.tsx");

    expect(source).toContain('return `batch:image:${mode}`');
    expect(source).toContain("ephemeralInputDraftRegistry.read<ImageBatchEphemeralDraft>");
    expect(source).not.toContain('searchParams.set("templateMode"');
    expect(source).not.toContain("batch_workbench_template_v2_");
  });

  it("uses a document-only Live workspace session while leaving history on the server", () => {
    const source = read("hooks/use-live-video-batch-workspace.ts");
    const service = read("lib/live-video-batch/service.ts");

    expect(source).toContain('ephemeralInputDraftRegistry.write<LiveVideoEphemeralInputDraft>');
    expect(source).toContain("draftSessionId=${encodeURIComponent(workspaceSessionId)}");
    expect(service).toContain("liveVideoEphemeralDraftRequestKey");
    expect(service).toContain("LIVE_VIDEO_EPHEMERAL_DRAFT_PREFIX");
    expect(source).toContain("historyOnly=1");
  });

  it("keeps manual Skill selection out of the account draft", () => {
    const source = read("hooks/use-account-role-positioning-draft.ts");

    expect(source).toContain("selectedRoleSkillId: null");
  });

  it("passes reused creations through document memory instead of browser storage", () => {
    const producers = [
      read("app/works/page.tsx"),
      read("components/home/inspiration-discovery-section.tsx"),
      read("components/history/unified-history-panel.tsx"),
      read("lib/video-template-reuse.ts"),
    ].join("\n");
    const consumers = [
      read("app/image/image-tool.tsx"),
      read("app/video/video-tool.tsx"),
    ].join("\n");

    expect(producers).toContain("writeEphemeralToolTemplate");
    expect(consumers).toContain("takeEphemeralToolTemplate");
    expect(`${producers}\n${consumers}`).not.toContain("studio_apply_face_template_v1_");
    expect(`${producers}\n${consumers}`).not.toContain("studio_apply_image_template_v1_");
    expect(`${producers}\n${consumers}`).not.toContain("studio_apply_video_template_v1_");
    expect(producers).not.toMatch(/localStorage\.setItem\(\s*[`\"]draft_(face|image|video)_v\d_/);
  });

  it("removes old asset mentions before history regeneration templates reach the toolbox", () => {
    const history = read("components/history/unified-history-panel.tsx");

    expect(history).toContain("stripPromptAssetMentions");
    expect(history).toContain("stripPromptAssetMentions(typeof item.prompt === \"string\" ? item.prompt : \"\")");
  });

  it("clears document drafts when the authenticated session ends", () => {
    const source = read("components/auth/AuthProvider.tsx");

    expect(source).toContain("ephemeralInputDraftRegistry.clearOwner");
  });
});
