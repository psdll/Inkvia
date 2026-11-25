import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("account role-positioning draft client", () => {
  it("returns a readable failure result instead of rejecting the UI save", async () => {
    const modulePath = resolve(
      process.cwd(),
      "lib/account-role-positioning-draft-client.ts",
    );
    expect(existsSync(modulePath)).toBe(true);
    if (!existsSync(modulePath)) return;

    const { putAccountRolePositioningDraft } = await import(
      "@/lib/account-role-positioning-draft-client"
    );
    const fetchImpl = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "角色定位账号草稿表未初始化" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    ));

    await expect(putAccountRolePositioningDraft({
      surface: "toolbox_image",
      draft: {
        systemPrompt: "latest",
        reversePrompt: "",
        reversePromptApplied: false,
        activeReverseTaskId: null,
        continuation: null,
        selectedRoleSkillId: "personal:9",
        resultRoleSkill: null,
      },
      fetchImpl,
    })).resolves.toEqual({
      success: false,
      error: "角色定位账号草稿表未初始化",
    });
  });
});
