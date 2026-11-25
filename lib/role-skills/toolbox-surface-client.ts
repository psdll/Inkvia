import type { RolePositioningSurface } from "@/lib/role-positioning-surface";

export type ToolboxRoleSkillSurface = Extract<
  RolePositioningSurface,
  "toolbox_image" | "toolbox_video"
>;

export type ToolboxRoleSkillTask = {
  id: number;
  status: string;
  llmProviderId?: string;
  model?: string;
  generatedPrompt?: string;
  errorMsg?: string;
  skill?: null | {
    id: string;
    name: string;
    revision: number;
  };
};

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    throw new Error(String(data?.error || fallback));
  }
  return data;
}

export async function startToolboxRoleSkillPrompt({
  surface,
  roleSkillId,
  userPrompt,
  mediaUrls,
  fetchImpl = fetch,
}: {
  surface: ToolboxRoleSkillSurface;
  roleSkillId: string;
  userPrompt: string;
  mediaUrls: string[];
  fetchImpl?: typeof fetch;
}) {
  const response = await fetchImpl("/api/prompt-reverse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      async: true,
      surface,
      roleSkillId,
      userPrompt,
      mediaUrls,
    }),
  });
  const data = await readJson(response, "技能生成提示词失败");
  const task = data?.task as ToolboxRoleSkillTask | undefined;
  if (!Number.isInteger(task?.id) || Number(task?.id) <= 0) {
    throw new Error("技能任务创建失败，请重试");
  }
  return task as ToolboxRoleSkillTask;
}

function defaultWait(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function waitForToolboxRoleSkillPrompt({
  surface,
  taskId,
  signal,
  fetchImpl = fetch,
  wait = defaultWait,
}: {
  surface: ToolboxRoleSkillSurface;
  taskId: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}) {
  while (!signal?.aborted) {
    const response = await fetchImpl(
      `/api/prompt-reverse?id=${taskId}&surface=${surface}`,
      { cache: "no-store", signal },
    );
    const data = await readJson(response, "技能任务加载失败，请重试");
    const task = data?.task as ToolboxRoleSkillTask | undefined;
    if (!task || task.id !== taskId) {
      throw new Error("技能任务响应不匹配，请重试");
    }
    if (task.status === "success") {
      if (!String(task.generatedPrompt || "").trim()) {
        throw new Error("LLM 未返回可用提示词，请重试");
      }
      return task;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(String(task.errorMsg || "技能生成提示词失败，请重试"));
    }
    await wait(2500, signal);
  }

  throw new DOMException("Aborted", "AbortError");
}
