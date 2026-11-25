import { describe, expect, it, vi } from "vitest";

import {
  startBatchRolePrompt,
  waitForBatchRolePromptTask,
} from "@/lib/batch-role-positioning-client";
import * as batchRoleClient from "@/lib/batch-role-positioning-client";

describe("batch role positioning client", () => {
  it("builds a batch-only fallback when the page prompt is empty", () => {
    const resolveUserPrompt = (batchRoleClient as any).resolveBatchRoleUserPrompt;
    expect(typeof resolveUserPrompt).toBe("function");
    expect(resolveUserPrompt("页面需求", 2)).toBe("页面需求");
    expect(resolveUserPrompt("", 2)).toContain("结合本次上传素材");
    expect(resolveUserPrompt("", 0)).toContain("严格按照用户系统提示词");
  });

  it("starts an async batch-workbench task", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        task: { id: 42, status: "pending" },
      }), { status: 202, headers: { "Content-Type": "application/json" } }),
    );

    await expect(startBatchRolePrompt({
      roleSkillId: "personal:9",
      userPrompt: "用户任务",
      mediaUrls: ["/uploads/a.png", "/uploads/b.png"],
      fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toMatchObject({ id: 42 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/prompt-reverse",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toMatchObject({
      async: true,
      surface: "batch_workbench",
      roleSkillId: "personal:9",
      userPrompt: "用户任务",
      mediaUrls: ["/uploads/a.png", "/uploads/b.png"],
    });
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).not.toHaveProperty("systemPrompt");
  });

  it("polls only the requested task id until success", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        task: { id: 42, status: "running" },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        task: { id: 42, status: "success", generatedPrompt: "结果" },
      })));

    const task = await waitForBatchRolePromptTask({
      taskId: 42,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => undefined,
    });

    expect(task.generatedPrompt).toBe("结果");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "/api/prompt-reverse?id=42&surface=batch_workbench",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("throws the public task failure and stops polling", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      task: { id: 42, status: "failed", errorMsg: "LLM 网络连接失败" },
    })));

    await expect(waitForBatchRolePromptTask({
      taskId: 42,
      fetchImpl: fetchImpl as typeof fetch,
      wait: async () => undefined,
    })).rejects.toThrow("LLM 网络连接失败");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
