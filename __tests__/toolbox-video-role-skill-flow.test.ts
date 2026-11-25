import { describe, expect, it, vi } from "vitest";
import {
  startToolboxRoleSkillPrompt,
  waitForToolboxRoleSkillPrompt,
} from "@/lib/role-skills/toolbox-surface-client";

describe("toolbox video role Skill flow", () => {
  it("starts a video Skill task on the video surface", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      task: { id: 73, status: "pending" },
    }), { status: 202 }));
    await startToolboxRoleSkillPrompt({
      surface: "toolbox_video",
      roleSkillId: "personal:9",
      userPrompt: "视频1做成广告",
      mediaUrls: ["/uploads/a.mp4"],
      fetchImpl,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      async: true,
      surface: "toolbox_video",
      roleSkillId: "personal:9",
    });
  });

  it("polls the same video surface until success", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      task: { id: 73, status: "success", generatedPrompt: "专业视频提示词" },
    })));
    await expect(waitForToolboxRoleSkillPrompt({
      surface: "toolbox_video",
      taskId: 73,
      fetchImpl,
      wait: async () => undefined,
    })).resolves.toMatchObject({ generatedPrompt: "专业视频提示词" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/prompt-reverse?id=73&surface=toolbox_video",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
