import type { RolePositioningSurface } from "@/lib/role-positioning-surface";
import type { RolePositioningContinuation } from "@/lib/role-positioning-continuation";

export type AccountRolePositioningDraftPayload = {
  systemPrompt: string;
  reversePrompt: string;
  reversePromptApplied: boolean;
  activeReverseTaskId: number | null;
  continuation: RolePositioningContinuation | null;
  selectedRoleSkillId: string | null;
  resultRoleSkill: null | {
    id: string;
    name: string;
    revision: number;
  };
};

export async function putAccountRolePositioningDraft({
  surface,
  draft,
  keepalive = false,
  fetchImpl = fetch,
}: {
  surface: RolePositioningSurface;
  draft: AccountRolePositioningDraftPayload;
  keepalive?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const response = await fetchImpl(
      `/api/role-positioning/draft?surface=${encodeURIComponent(surface)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
        keepalive,
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.success === false) {
      return {
        success: false,
        error: String(data?.error || "角色定位草稿保存失败，请稍后重试"),
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: "角色定位草稿保存失败，请稍后重试" };
  }
}
