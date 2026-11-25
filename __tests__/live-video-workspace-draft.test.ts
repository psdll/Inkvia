import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeToolWorkspaceTool } from "@/lib/tool-workspace-draft/contracts";

describe("Live workspace draft isolation", () => {
  it("rejects Live from the generic tool-workspace draft namespace", () => {
    expect(() => normalizeToolWorkspaceTool("live_video_batch")).toThrow(
      expect.objectContaining({ code: "TOOL_WORKSPACE_TOOL_INVALID" }),
    );
  });

  it("keeps the Live client on the live-video batch route family", () => {
    const source = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");

    expect(source).toContain('"/api/live-video-batches"');
    expect(source).not.toContain("tool-workspace-draft");
    expect(source).not.toContain("uploadToolWorkspaceMedia");
  });

  it("keeps a manual Skill override in document memory and restores only the administrator default on reload", () => {
    const source = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");
    const route = readFileSync("app/api/live-video-batches/route.ts", "utf8");

    expect(source).toContain("defaultSkillId");
    expect(source).toContain("overrideSkillId");
    expect(source).toContain("overrideSkillId || defaultSkillId");
    expect(source).toContain("LiveVideoEphemeralInputDraft");
    expect(source).toContain("workspaceSessionId");
    expect(source).toContain("draftSessionId=${encodeURIComponent(workspaceSessionId)}");
    expect(source).not.toContain("workspaceSkillPublicId:");
    expect(source).toContain("skillPublicId: overrideSkillIdRef.current || undefined");
    expect(source).toContain("defaultSkill: LiveVideoDefaultSkill | null");
    expect(route).toContain("getLiveVideoDefaultSkill");
  });

  it("keeps enabled models available when loading the authenticated workspace fails", () => {
    const source = readFileSync("hooks/use-live-video-batch-workspace.ts", "utf8");

    expect(source).toContain("setModels(availableModels)");
    expect(source).toMatch(/setModels\(availableModels\)[\s\S]+await apiRequest<ApiEnvelope & \{/);
    expect(source).not.toContain("const [modelResponse, batchResponse] = await Promise.all([");
  });
});
