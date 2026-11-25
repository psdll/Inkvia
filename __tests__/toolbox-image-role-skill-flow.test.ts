import { describe, expect, it, vi } from "vitest";

import {
  startToolboxImageRoleSkillPrompt,
  waitForToolboxImageRoleSkillPrompt,
} from "@/lib/role-skills/toolbox-image-client";

describe("toolbox image role skill flow", () => {
  it("starts the selected Skill LLM with the toolbox prompt and uploaded media", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        task: { id: 42, status: "pending" },
      }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );

    await expect(startToolboxImageRoleSkillPrompt({
      roleSkillId: "personal:9",
      userPrompt: "用户原始提示词",
      mediaUrls: ["/uploads/a.png"],
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toMatchObject({ id: 42 });

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({
      async: true,
      surface: "toolbox_image",
      roleSkillId: "personal:9",
      userPrompt: "用户原始提示词",
      mediaUrls: ["/uploads/a.png"],
    });
  });

  it("waits for the exact toolbox task and returns the generated prompt", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        task: { id: 42, status: "running" },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        task: { id: 42, status: "success", generatedPrompt: "LLM 最终提示词" },
      })));

    await expect(waitForToolboxImageRoleSkillPrompt({
      taskId: 42,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => undefined,
    })).resolves.toMatchObject({ generatedPrompt: "LLM 最终提示词" });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/prompt-reverse?id=42&surface=toolbox_image",
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
