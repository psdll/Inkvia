export type PromptReverseTaskItem = {
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

export function resolveBatchRoleUserPrompt(userPrompt: unknown, mediaCount: number) {
  const prompt = String(userPrompt || "").trim();
  if (prompt) return prompt;
  return mediaCount > 0
    ? "请结合本次上传素材，严格按照用户系统提示词要求生成分段提示词。"
    : "请严格按照用户系统提示词要求直接生成分段提示词。";
}

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    throw new Error(String(data?.error || fallback));
  }
  return data;
}

type StartBatchRolePromptInput = {
  userPrompt: string;
  mediaUrls: string[];
  fetchImpl?: typeof fetch;
} & (
  | { roleSkillId: string; systemPrompt?: never }
  | { systemPrompt: string; roleSkillId?: never }
);

export async function startBatchRolePrompt(input: StartBatchRolePromptInput) {
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl("/api/prompt-reverse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      async: true,
      surface: "batch_workbench",
      ...(input.roleSkillId
        ? { roleSkillId: input.roleSkillId }
        : { systemPrompt: input.systemPrompt }),
      userPrompt: input.userPrompt,
      mediaUrls: input.mediaUrls,
    }),
  });
  const data = await readJson(response, "生成分段提示词失败");
  const task = data?.task as PromptReverseTaskItem | undefined;
  if (!Number.isInteger(task?.id) || Number(task?.id) <= 0) {
    throw new Error("角色定位任务创建失败，请重试");
  }
  return task as PromptReverseTaskItem;
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

export async function waitForBatchRolePromptTask(input: {
  taskId: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}) {
  const fetchImpl = input.fetchImpl || fetch;
  const wait = input.wait || defaultWait;

  while (!input.signal?.aborted) {
    const response = await fetchImpl(
      `/api/prompt-reverse?id=${input.taskId}&surface=batch_workbench`,
      { cache: "no-store", signal: input.signal },
    );
    const data = await readJson(response, "角色定位任务加载失败，请重试");
    const task = data?.task as PromptReverseTaskItem | undefined;
    if (!task || task.id !== input.taskId) {
      throw new Error("角色定位任务响应不匹配，请重试");
    }
    if (task.status === "success") {
      if (!String(task.generatedPrompt || "").trim()) {
        throw new Error("LLM 未返回可用提示词，请重试");
      }
      return task;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(String(task.errorMsg || "生成分段提示词失败，请重试"));
    }
    await wait(2500, input.signal);
  }

  throw new DOMException("Aborted", "AbortError");
}
